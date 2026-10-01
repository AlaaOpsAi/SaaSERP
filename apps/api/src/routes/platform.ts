import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformOnly, platformUser } from '../auth.js';
import { withoutTenant } from '../db.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
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
      const counts = { pending: 0, active: 0, rejected: 0, suspended: 0 };
      for (const r of rows) counts[r.status as TenantStatus]++;
      return { tenants: rows, counts };
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
}
