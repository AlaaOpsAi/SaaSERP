import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import { config } from '../config.js';
import { withTenant, withoutTenant } from '../db.js';
import { seedTenantDefaults } from '../lib/defaults.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const signupSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Use letters, digits and dashes'),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  business_unit_code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}$/).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  phone: z.string().trim().max(40).optional(),
  note: z.string().trim().max(1000).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  workspace: z.string().trim().toLowerCase().optional(),
});

const INACTIVE_MESSAGES: Record<string, string> = {
  pending: 'Your workspace is waiting for approval. We will let you know as soon as it is activated.',
  rejected: 'Your workspace request was not approved.',
  suspended: 'This workspace has been suspended. Please contact support.',
};

/** Tell the platform operator about a new sign-up (Slack/Teams/Zapier-style incoming webhook). */
function notifySignup(body: z.infer<typeof signupSchema>) {
  if (!config.signupWebhookUrl) return;
  const text = `New workspace waiting for approval: ${body.company_name} (${body.slug}) — ${body.name} <${body.email}>`
    + (body.phone ? `, ${body.phone}` : '') + (body.note ? `\n> ${body.note}` : '');
  fetch(config.signupWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const raw = parts.length > 1 ? parts.map((p) => p[0]).join('') : name.slice(0, 3);
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'USR';
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (req) => {
    const body = signupSchema.parse(req.body);
    const taken = await withoutTenant(async (db) => {
      const { rows } = await db.query('SELECT auth_slug_taken($1) AS taken', [body.slug]);
      return rows[0].taken as boolean;
    });
    if (taken) throw conflict('That workspace name is already taken');

    const tenantId = randomUUID();
    const buCode =
      body.business_unit_code || body.company_name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'A';
    const user = await withTenant(tenantId, async (db) => {
      await db.query(
        `INSERT INTO tenants (id, slug, name, currency, status, contact_phone, signup_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, body.slug, body.company_name, body.currency ?? 'KWD',
         config.autoApproveSignups ? 'active' : 'pending', body.phone ?? null, body.note ?? null],
      );
      await db.query(
        `INSERT INTO business_units (tenant_id, code, name) VALUES (current_tenant_id(), $1, $2)`,
        [buCode, body.company_name],
      );
      await seedTenantDefaults(db);
      const { rows } = await db.query(
        `INSERT INTO users (tenant_id, email, name, code, role, password_hash)
         VALUES (current_tenant_id(), $1, $2, $3, 'owner', $4)
         RETURNING id, role`,
        [body.email, body.name, initials(body.name), await hashPassword(body.password)],
      );
      return rows[0] as { id: string; role: 'owner' };
    });

    if (!config.autoApproveSignups) {
      notifySignup(body);
      return { status: 'pending' as const, workspace: body.slug };
    }
    const token = app.jwt.sign({ sub: user.id, tid: tenantId, role: user.role }, { expiresIn: '12h' });
    return { status: 'active' as const, workspace: body.slug, token };
  });

  app.post('/auth/login', async (req) => {
    const body = loginSchema.parse(req.body);
    const matches = await withoutTenant(async (db) => {
      const { rows } = await db.query('SELECT * FROM auth_find_users($1)', [body.email]);
      return rows as { user_id: string; tenant_id: string; tenant_slug: string; tenant_name: string;
                       password_hash: string | null; is_active: boolean; tenant_status: string; status_reason: string | null }[];
    });

    let candidates = matches.filter((m) => m.is_active);
    if (body.workspace) candidates = candidates.filter((m) => m.tenant_slug === body.workspace);

    const verified = [];
    for (const m of candidates) {
      if (await verifyPassword(body.password, m.password_hash)) verified.push(m);
    }
    if (verified.length === 0) throw new HttpError(401, 'Invalid email or password');
    if (verified.length > 1) {
      throw badRequest('This email belongs to several workspaces; choose one', {
        workspaces: verified.map((v) => ({ slug: v.tenant_slug, name: v.tenant_name })),
      });
    }

    const match = verified[0];
    if (match.tenant_status !== 'active') {
      throw new HttpError(403, INACTIVE_MESSAGES[match.tenant_status] ?? 'This workspace is not active', {
        tenant_status: match.tenant_status,
        reason: match.tenant_status === 'pending' ? null : match.status_reason,
      });
    }
    const role = await withTenant(match.tenant_id, async (db) => {
      const { rows } = await db.query(
        'UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING role',
        [match.user_id],
      );
      return rows[0].role;
    });
    const token = app.jwt.sign({ sub: match.user_id, tid: match.tenant_id, role }, { expiresIn: '12h' });
    return { token };
  });

  app.get('/auth/me', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.code, u.role, u.data_scope, u.manager_id,
                app_sees_all() AS sees_all, app_team_ids() AS team_ids,
                json_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan,
                                  'currency', t.currency, 'timezone', t.timezone,
                                  'fixed_cost_pct', t.fixed_cost_pct,
                                  'credit_facility_pct', t.credit_facility_pct) AS tenant
         FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.is_active`,
        [req.user.sub],
      );
      if (!rows[0]) throw new HttpError(401, 'Session expired');
      return rows[0];
    }),
  );
}
