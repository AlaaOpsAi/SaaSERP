import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformOnly, platformUser } from '../auth.js';
import { withoutTenant, withTenant } from '../db.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { MODULE_KEYS, MODULES } from '../lib/modules.js';
import { notify } from '../lib/notify.js';
import { verifyPassword } from '../lib/password.js';

type TenantStatus = 'pending' | 'active' | 'rejected' | 'suspended';

/** Which operator action may move a workspace from which status. */
const ACTIONS: Record<string, { from: TenantStatus[]; to: TenantStatus; needsReason: boolean }> = {
  approve: { from: ['pending', 'rejected'], to: 'active', needsReason: false },
  reject: { from: ['pending'], to: 'rejected', needsReason: true },
  suspend: { from: ['active'], to: 'suspended', needsReason: true },
  reactivate: { from: ['suspended'], to: 'active', needsReason: false },
};

const plan = z.enum(['trial', 'starter', 'pro', 'enterprise']);
const actionBody = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
  plan: plan.optional(),
  max_users: z.number().int().min(1).max(10000).optional(),
});
const params = z.object({ id: z.string().uuid(), action: z.enum(['approve', 'reject', 'suspend', 'reactivate']) });

/**
 * Operator console: review sign-ups and manage workspaces across tenants.
 * Uses SECURITY DEFINER functions, since operators have no tenant context.
 */
export async function platformRoutes(app: FastifyInstance) {
  app.post('/platform/login', async (req) => {
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string() }).parse(req.body);
    const admin = await withoutTenant(async (db) => {
      const { rows } = await db.query('SELECT id, email, name, password_hash FROM platform_admins WHERE email = $1', [email]);
      return rows[0] as { id: string; email: string; name: string; password_hash: string } | undefined;
    });
    if (!admin || !(await verifyPassword(password, admin.password_hash))) throw new HttpError(401, 'Invalid email or password');
    await withoutTenant((db) => db.query('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [admin.id]));
    return { token: app.jwt.sign({ sub: admin.id, scope: 'platform', email: admin.email }, { expiresIn: '8h' }) };
  });

  app.get('/platform/me', { preHandler: platformOnly }, (req) =>
    withoutTenant(async (db) => {
      const { rows } = await db.query('SELECT id, email, name FROM platform_admins WHERE id = $1', [platformUser(req).sub]);
      if (!rows[0]) throw new HttpError(401, 'Session expired');
      return rows[0];
    }),
  );

  app.get('/platform/tenants', { preHandler: platformOnly }, () =>
    withoutTenant(async (db) => {
      const { rows } = await db.query('SELECT * FROM platform_tenants()');
      const mods = new Map((await db.query('SELECT * FROM platform_tenant_modules()')).rows.map((m) => [m.id, m]));
      const counts = { pending: 0, active: 0, rejected: 0, suspended: 0 };
      for (const r of rows) counts[r.status as TenantStatus]++;
      const tenants = rows.map((r) => ({ ...r, modules: mods.get(r.id)?.modules ?? ['sales'], requested_modules: mods.get(r.id)?.requested ?? [] }));
      return { tenants, counts, catalog: MODULE_KEYS.map((key) => ({ key, ...MODULES[key] })) };
    }),
  );

  app.post('/platform/tenants/:id/:action', { preHandler: platformOnly }, (req) =>
    withoutTenant(async (db) => {
      const { id, action } = params.parse(req.params);
      const body = actionBody.parse(req.body ?? {});
      const rule = ACTIONS[action];
      const current = (await db.query('SELECT status FROM platform_tenants() WHERE id = $1', [id])).rows[0];
      if (!current) throw notFound('Workspace');
      if (!rule.from.includes(current.status)) throw badRequest(`Cannot ${action} a workspace that is ${current.status}`);
      if (rule.needsReason && !body.reason) throw badRequest('Please give a reason; the customer will see it');
      const { rows } = await db.query('SELECT * FROM platform_update_tenant($1, $2, $3, $4, $5, $6)', [
        id, rule.to, body.reason ?? null, body.plan ?? null, body.max_users ?? null, platformUser(req).email,
      ]);
      return rows[0];
    }),
  );

  app.patch('/platform/tenants/:id', { preHandler: platformOnly }, (req) =>
    withoutTenant(async (db) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({ plan: plan.optional(), max_users: z.number().int().min(1).max(10000).optional() }).parse(req.body);
      const { rows } = await db.query('SELECT * FROM platform_update_tenant($1, NULL, NULL, $2, $3, $4)', [
        id, body.plan ?? null, body.max_users ?? null, platformUser(req).email,
      ]);
      if (!rows[0]) throw notFound('Workspace');
      return rows[0];
    }),
  );

  // Modules a workspace subscribes to; open requests are granted or declined with it.
  app.put('/platform/tenants/:id/modules', { preHandler: platformOnly }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { modules } = z.object({ modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).max(20) }).parse(req.body);
    const before = await withoutTenant(async (db) => (await db.query('SELECT modules FROM platform_tenant_modules() WHERE id = $1', [id])).rows[0]);
    if (!before) throw notFound('Workspace');
    const after: string[] = await withoutTenant(async (db) =>
      (await db.query('SELECT platform_set_modules($1, $2, $3) AS m', [id, modules, platformUser(req).email])).rows[0].m);
    // Tell the workspace owners what changed.
    const added = after.filter((m) => !before.modules.includes(m));
    if (added.length) {
      await withTenant(id, async (db) => {
        const owners = (await db.query(`SELECT id FROM users WHERE role = 'owner' AND is_active`)).rows;
        const names = added.map((m) => MODULES[m as keyof typeof MODULES]?.name ?? m).join(', ');
        for (const o of owners) await notify(db, o.id, `Module now active: ${names}`, '/settings?tab=modules');
      });
    }
    return { modules: after };
  });
}
