import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authed, hasRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const createSchema = z.object({
  delegator_id: z.string().uuid().optional(), // default: me
  delegate_id: z.string().uuid(),
  starts_on: date,
  ends_on: date.nullish(),
  access: z.enum(['view', 'act']).default('act'),
  include_team: z.boolean().default(false),
  handover_activities: z.boolean().default(false),
  note: z.string().trim().max(500).nullish(),
});

const SELECT = `
  SELECT d.*, a.name AS delegator_name, a.code AS delegator_code, b.name AS delegate_name, b.code AS delegate_code,
         c.name AS created_by_name,
         CASE WHEN d.revoked_at IS NOT NULL THEN 'revoked'
              WHEN d.starts_on > (now() AT TIME ZONE t.timezone)::date THEN 'upcoming'
              WHEN d.ends_on IS NOT NULL AND d.ends_on < (now() AT TIME ZONE t.timezone)::date THEN 'ended'
              ELSE 'active' END AS state
  FROM delegations d
  JOIN tenants t ON t.id = d.tenant_id
  JOIN users a ON a.id = d.delegator_id
  JOIN users b ON b.id = d.delegate_id
  LEFT JOIN users c ON c.id = d.created_by`;

const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'further notice');

/** You manage a delegation if it is yours, or the delegator is below you, or you are an admin. */
function canManage(req: FastifyRequest, delegatorId: string) {
  return delegatorId === req.user.sub || hasRole(req, ['owner', 'admin'])
    || (hasRole(req, ['manager']) && Boolean(req.scope?.teamIds.includes(delegatorId)));
}

async function managerOf(db: Db, userId: string): Promise<string | null> {
  return (await db.query('SELECT manager_id FROM users WHERE id = $1', [userId])).rows[0]?.manager_id ?? null;
}

export async function delegationRoutes(app: FastifyInstance) {
  app.get('/delegations', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const s = req.scope!;
      const { rows } = await db.query(
        `${SELECT} WHERE $1 OR d.delegator_id = ANY($2::uuid[]) OR d.delegate_id = $3
         ORDER BY (d.revoked_at IS NULL) DESC, d.starts_on DESC LIMIT 200`,
        [s.seesAll && hasRole(req, ['owner', 'admin', 'manager']), s.teamIds, req.user.sub],
      );
      return rows;
    }),
  );

  app.post('/delegations', { preHandler: authed }, (req, reply) =>
    tx(req, async (db) => {
      const body = createSchema.parse(req.body);
      const delegatorId = body.delegator_id ?? req.user.sub;
      if (!canManage(req, delegatorId)) throw forbidden('You can set up cover for yourself or for people in your team');
      if (delegatorId === body.delegate_id) throw badRequest('Choose someone else to cover');
      if (body.ends_on && body.ends_on < body.starts_on) throw badRequest('The end date must be on or after the start date');
      if (body.handover_activities && body.access === 'view') throw badRequest('Follow-ups can only be handed over with "view & act" access');
      const delegate = (await db.query('SELECT id, name, is_active, email FROM users WHERE id = $1', [body.delegate_id])).rows[0];
      if (!delegate) throw notFound('User');
      if (!delegate.is_active || !delegate.email) throw badRequest(`${delegate.name} cannot sign in, so cannot cover`);
      const delegator = (await db.query('SELECT id, name FROM users WHERE id = $1', [delegatorId])).rows[0];
      if (!delegator) throw notFound('User');

      const { rows } = await db.query(
        `INSERT INTO delegations (tenant_id, delegator_id, delegate_id, starts_on, ends_on, access, include_team,
                                  handover_activities, note, created_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [delegatorId, body.delegate_id, body.starts_on, body.ends_on ?? null, body.access, body.include_team,
         body.handover_activities, body.note ?? null, req.user.sub],
      );
      const period = `${fmt(body.starts_on)} – ${fmt(body.ends_on ?? null)}`;
      const what = `${body.access === 'act' ? 'view & act on' : 'view'} ${body.include_team ? `${delegator.name}'s and their team's` : `${delegator.name}'s`} records`;
      await notify(db, body.delegate_id, `You are covering for ${delegator.name} (${period}): you can ${what}.`, '/delegations');
      if (delegatorId !== req.user.sub) await notify(db, delegatorId, `${delegate.name} will cover for you (${period}).`, '/delegations');
      // Self-service, but the delegator's manager always hears about it.
      const manager = await managerOf(db, delegatorId);
      if (manager && manager !== req.user.sub) {
        await notify(db, manager, `${delegator.name} is covered by ${delegate.name} (${period}).`, '/delegations');
      }
      reply.code(201);
      return (await db.query(`${SELECT} WHERE d.id = $1`, [rows[0].id])).rows[0];
    }),
  );

  app.patch('/delegations/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { ends_on } = z.object({ ends_on: date.nullable() }).parse(req.body);
      const d = (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
      if (!d) throw notFound('Delegation');
      if (!canManage(req, d.delegator_id)) throw forbidden();
      if (d.state === 'revoked') throw badRequest('This cover was already ended');
      if (ends_on && ends_on < d.starts_on) throw badRequest('The end date must be on or after the start date');
      await db.query('UPDATE delegations SET ends_on = $2 WHERE id = $1', [id, ends_on]);
      await notify(db, d.delegate_id, `Your cover for ${d.delegator_name} now runs until ${fmt(ends_on)}.`, '/delegations');
      return (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
    }),
  );

  app.post('/delegations/:id/revoke', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const d = (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
      if (!d) throw notFound('Delegation');
      // The delegate may also step down.
      if (!canManage(req, d.delegator_id) && d.delegate_id !== req.user.sub && d.created_by !== req.user.sub) throw forbidden();
      if (d.revoked_at) return d;
      await db.query('UPDATE delegations SET revoked_at = now(), revoked_by = $2 WHERE id = $1', [id, req.user.sub]);
      for (const userId of [d.delegate_id, d.delegator_id]) {
        if (userId !== req.user.sub) {
          await notify(db, userId, `Cover of ${d.delegator_name} by ${d.delegate_name} has ended.`, '/delegations');
        }
      }
      return (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
    }),
  );

  // ---- notifications (the bell) ---------------------------------------------

  app.get('/notifications', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT id, text, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [req.user.sub],
      );
      const unread = (await db.query('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.sub])).rows[0].n;
      return { items: rows, unread };
    }),
  );
  app.post('/notifications/read', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.sub]);
      return { ok: true };
    }),
  );
}
