import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import { conflict } from '../lib/errors.js';
import { MODULE_KEYS, MODULES, modulesOf } from '../lib/modules.js';

/** Admin & IT → Modules: the subscriptions the workspace has, and asking for more. */
export async function moduleRoutes(app: FastifyInstance) {
  app.get('/modules', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const active = await modulesOf(db);
      const requests = (await db.query(
        `SELECT r.module, r.status, r.requested_at, r.decided_at, u.name AS requested_by_name
         FROM module_requests r LEFT JOIN users u ON u.id = r.requested_by
         ORDER BY r.requested_at DESC LIMIT 20`)).rows;
      return {
        modules: MODULE_KEYS.map((key) => ({
          key, name: MODULES[key].name, available: MODULES[key].available, basic: MODULES[key].basic,
          active: active.includes(key),
          requested: requests.some((r) => r.module === key && r.status === 'pending'),
        })),
        requests,
      };
    }),
  );

  app.post('/modules/:key/request', { preHandler: requireRole(can.admin) }, (req) =>
    tx(req, async (db) => {
      const { key } = z.object({ key: z.enum(MODULE_KEYS as [string, ...string[]]) }).parse(req.params);
      const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
      if ((await modulesOf(db)).includes(key)) throw conflict('Your workspace already has this module');
      const { rows } = await db.query(
        `INSERT INTO module_requests (module, note, requested_by) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, module) WHERE status = 'pending' DO NOTHING RETURNING *`,
        [key, note ?? null, req.user.sub]);
      if (!rows[0]) throw conflict('This module has already been requested');
      return rows[0];
    }),
  );
}
