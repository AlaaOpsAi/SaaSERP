import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import { config } from '../config.js';
import { withTenant, withoutTenant } from '../db.js';
import { seedTenantDefaults } from '../lib/defaults.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { logAccess } from '../lib/access.js';
import { notify } from '../lib/notify.js';
import { rightsOf } from '../lib/permissions.js';
import { logoUrls } from './branding.js';

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

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2a78d6');
export const localeCode = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a language code like en or ar');
const preferencesSchema = z.object({
  locale: localeCode.nullable(),
  theme: z.enum(['system', 'light', 'dark']).nullable(),
  accent: hex.nullable(),
  density: z.enum(['comfortable', 'compact']).nullable(),
  fontScale: z.number().min(0.85).max(1.3).nullable(),
  /** The contract list's column layout and personal saved views (customer comment 8). */
  contract_list: z.record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 100_000, 'Too many saved views').nullable(),
}).partial();

/** The employee ID (E2021001) can be typed instead of the email. */
const EMPLOYEE_NO = /^E\d{7,8}$/i;
const loginSchema = z.object({
  // "email" keeps its name for the phone app; it also takes an employee ID.
  email: z.string().trim().toLowerCase().refine((v) => EMPLOYEE_NO.test(v) || z.string().email().safeParse(v).success,
    'Enter your email or employee ID'),
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
      const { rows } = EMPLOYEE_NO.test(body.email)
        ? await db.query('SELECT * FROM auth_find_users_by_employee_no($1)', [body.email.toUpperCase()])
        : await db.query('SELECT * FROM auth_find_users($1)', [body.email]);
      return rows as { user_id: string; tenant_id: string; tenant_slug: string; tenant_name: string;
                       password_hash: string | null; is_active: boolean; tenant_status: string; status_reason: string | null }[];
    });

    let candidates = matches.filter((m) => m.is_active);
    if (body.workspace) candidates = candidates.filter((m) => m.tenant_slug === body.workspace);

    const verified = [];
    for (const m of candidates) {
      if (await verifyPassword(body.password, m.password_hash)) verified.push(m);
    }
    if (verified.length === 0) throw new HttpError(401, 'Invalid email, employee ID or password');
    if (verified.length > 1) {
      throw badRequest(`This ${EMPLOYEE_NO.test(body.email) ? 'employee ID' : 'email'} belongs to several workspaces; choose one`, {
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
      await logAccess(db, match.user_id, 'sign_in', undefined, req.ip);
      return rows[0].role;
    });
    const token = app.jwt.sign({ sub: match.user_id, tid: match.tenant_id, role }, { expiresIn: '12h' });
    return { token };
  });

  // "Forgot password?" on the sign-in page: the workspace's owners and admins are told, and one
  // of them sets a new password under Admin & IT → Team. The answer is always the same, so the
  // page can't be used to find out who has an account; repeats within 15 minutes are ignored.
  app.post('/auth/forgot-password', async (req) => {
    const body = loginSchema.pick({ email: true, workspace: true }).parse(req.body);
    const matches = await withoutTenant(async (db) => {
      const { rows } = EMPLOYEE_NO.test(body.email)
        ? await db.query('SELECT * FROM auth_find_users_by_employee_no($1)', [body.email.toUpperCase()])
        : await db.query('SELECT * FROM auth_find_users($1)', [body.email]);
      return rows as { user_id: string; tenant_id: string; tenant_slug: string; is_active: boolean; tenant_status: string }[];
    });
    const targets = matches.filter((m) => m.is_active && m.tenant_status === 'active'
      && (!body.workspace || m.tenant_slug === body.workspace));
    for (const m of targets) {
      await withTenant(m.tenant_id, async (db) => {
        const recent = await db.query(
          `SELECT 1 FROM access_log WHERE user_id = $1 AND action = 'password_request' AND created_at > now() - interval '15 minutes'`,
          [m.user_id],
        );
        if (recent.rows[0]) return;
        const { rows: [who] } = await db.query('SELECT name, employee_no FROM users WHERE id = $1', [m.user_id]);
        const admins = await db.query(
          `SELECT id FROM users WHERE role IN ('owner', 'admin') AND is_active AND email IS NOT NULL AND id <> $1`, [m.user_id]);
        const label = `${who.name}${who.employee_no ? ` (${who.employee_no})` : ''}`;
        for (const a of admins.rows) {
          await notify(db, a.id, `${label} forgot their password and asked for a new one. Set it under Team.`,
            `/settings?tab=team&user=${m.user_id}`);
        }
        await logAccess(db, m.user_id, 'password_request', admins.rows.length ? undefined : 'no other admin to tell', req.ip);
      });
    }
    return { ok: true };
  });

  // Change your own password: the current one is needed, so a borrowed open session can't take over the account.
  app.post('/me/password', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const body = z.object({
        current_password: z.string().min(1),
        new_password: z.string().min(8, 'Use at least 8 characters'),
      }).parse(req.body);
      const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
      if (!(await verifyPassword(body.current_password, rows[0]?.password_hash ?? null))) {
        throw badRequest('Your current password is not correct');
      }
      if (body.new_password === body.current_password) throw badRequest('Choose a password different from the current one');
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.sub, await hashPassword(body.new_password)]);
      await logAccess(db, req.user.sub, 'password_change', undefined, req.ip);
      return { ok: true };
    }),
  );

  // Personal look & language. Only the keys sent are changed; null removes a key.
  app.patch('/me/preferences', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const body = preferencesSchema.parse(req.body);
      const { rows } = await db.query(
        `UPDATE users SET preferences = jsonb_strip_nulls(preferences || $2::jsonb) WHERE id = $1 RETURNING preferences`,
        [req.user.sub, JSON.stringify(body)],
      );
      return rows[0].preferences;
    }),
  );

  app.get('/auth/me', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.code, u.role, u.data_scope, u.manager_id, u.preferences,
                u.job_title, u.employee_no, u.level,
                (SELECT name FROM departments WHERE id = u.department_id) AS department,
                CASE WHEN bu.id IS NULL THEN NULL
                     ELSE json_build_object('id', bu.id, 'code', bu.code, 'name', bu.name, 'accent', bu.accent) END AS company,
                bu.id AS unit_id, bu.logo_light AS unit_light, bu.logo_dark AS unit_dark,
                t.logo_light AS group_light, t.logo_dark AS group_dark,
                app_sees_all() AS sees_all, app_team_ids() AS team_ids,
                json_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan,
                                  'currency', t.currency, 'timezone', t.timezone,
                                  'fixed_cost_pct', t.fixed_cost_pct,
                                  'credit_facility_pct', t.credit_facility_pct,
                                  'default_locale', t.default_locale, 'branding', t.branding,
                                  'home_order', t.home_order, 'field_visibility', t.field_visibility,
                                  'modules', t.modules) AS tenant,
                (SELECT e.id FROM employees e WHERE e.user_id = u.id AND 'hr' = ANY (t.modules)) AS employee_id
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN business_units bu ON bu.id = u.business_unit_id
         WHERE u.id = $1 AND u.is_active`,
        [req.user.sub],
      );
      if (!rows[0]) throw new HttpError(401, 'Session expired');
      // Who I am covering for right now, and who is covering for me.
      const covering = (await db.query(
        `SELECT d.id, u.name AS delegator_name, d.access, d.ends_on, d.include_team FROM delegations d
         JOIN users u ON u.id = d.delegator_id WHERE d.id = ANY($1::uuid[])`,
        [(req.scope?.covering ?? []).map((c) => c.delegationId)],
      )).rows;
      const coveredBy = (await db.query(
        `SELECT d.id, u.name AS delegate_name, d.access, d.ends_on FROM delegations d
         JOIN tenants t ON t.id = d.tenant_id JOIN users u ON u.id = d.delegate_id
         WHERE d.delegator_id = $1 AND d.revoked_at IS NULL
           AND d.starts_on <= (now() AT TIME ZONE t.timezone)::date
           AND (d.ends_on IS NULL OR d.ends_on >= (now() AT TIME ZONE t.timezone)::date)`,
        [req.user.sub],
      )).rows;
      const { unit_id, unit_light, unit_dark, group_light, group_dark, ...me } = rows[0];
      const logo = logoUrls(req.user.tid, { unit_id, unit_light, unit_dark, group_light, group_dark });
      const rights = await rightsOf(db, req.user.sub);
      return { ...me, logo, level: rights.level, rights: { export: rights.export, download: rights.download, print: rights.print, hr: rights.hr }, team_ids: req.scope?.teamIds ?? me.team_ids, covering, covered_by: coveredBy, hidden_fields: req.scope?.hidden ?? [] };
    }),
  );
}
