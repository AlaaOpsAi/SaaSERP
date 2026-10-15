import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authed, can, hasRole, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { logChange, writable } from '../lib/guard.js';
import { syncBookingFollowup } from './activities.js';

/**
 * "Deactivate instead of delete". A record entered by mistake is deactivated with a
 * reason: the database then hides it from every screen, list, report and export
 * (policy hide_deactivated). Managers and admins can restore it; only admins can
 * delete it for good, and only once it is deactivated.
 *
 *   contracts:  sales — own contracts, while Inquiry/Tentative and without payments
 *   customers:  sales — only while no contract uses them
 *   activities: the activity's owner
 *   managers and admins — any record they can see
 */
const KINDS = {
  bookings: { table: 'bookings', label: 'Contract' },
  contacts: { table: 'contacts', label: 'Customer' },
  accounts: { table: 'accounts', label: 'Company' },
  activities: { table: 'activities', label: 'Activity' },
} as const;
type Kind = keyof typeof KINDS;

const params = z.object({ id: z.string().uuid() });

/** Let this transaction read deactivated records (after the permission checks). */
const showDeactivated = (db: Db) => db.query(`SELECT set_config('app.show_deactivated', 'on', true)`);

async function assertMayDeactivate(db: Db, req: FastifyRequest, kind: Kind, id: string) {
  const manager = hasRole(req, can.manage);
  if (kind === 'bookings') {
    const ctx = await writable(db, req, id);
    if (manager) return ctx;
    if (ctx.onBehalfOf) throw forbidden('Ask a manager to deactivate a contract you are covering for');
    const { rows } = await db.query(
      `SELECT b.status, b.owner_id, b.created_by, (SELECT count(*) FROM payments p WHERE p.booking_id = b.id) AS payments
       FROM bookings b WHERE b.id = $1`, [id]);
    const b = rows[0];
    if (b.owner_id !== req.user.sub && b.created_by !== req.user.sub) throw forbidden('You can only deactivate your own contracts');
    if (!['INQ', 'TEN'].includes(b.status)) throw forbidden('Only enquiries and tentative contracts can be deactivated; ask a manager');
    if (Number(b.payments) > 0) throw forbidden('This contract has payments; ask a manager');
    return ctx;
  }
  const { rows } = await db.query(`SELECT * FROM ${KINDS[kind].table} WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound(KINDS[kind].label);
  if (manager) return null;
  if (kind === 'activities') {
    if (rows[0].owner_id !== req.user.sub) throw forbidden('You can only deactivate your own activities');
    return null;
  }
  const column = kind === 'contacts' ? 'contact_id' : 'account_id';
  const used = await db.query(`SELECT 1 FROM bookings WHERE ${column} = $1 LIMIT 1`, [id]);
  if (used.rows[0]) throw forbidden('This customer has contracts; ask a manager');
  return null;
}

export async function deactivationRoutes(app: FastifyInstance) {
  const anyone = { preHandler: requireRole(can.activity) };
  const managers = { preHandler: requireRole(can.manage) };
  const admins = { preHandler: requireRole(can.admin) };

  for (const kind of Object.keys(KINDS) as Kind[]) {
  app.post(`/${kind}/:id/deactivate`, anyone, (req) =>
    tx(req, async (db) => {
      const { id } = params.parse(req.params);
      const { reason } = z.object({ reason: z.string().trim().min(3, 'Give a reason') }).parse(req.body);
      // Marketing may deactivate its own activities; contracts and customers belong to sales.
      if (kind !== 'activities' && !hasRole(req, can.sell)) throw forbidden();
      const ctx = await assertMayDeactivate(db, req, kind, id);
      if (ctx) await logChange(db, req, ctx, 'deactivated', { reason });
      const linked = kind === 'activities' ? (await db.query('SELECT booking_id FROM activities WHERE id = $1', [id])).rows[0]?.booking_id : null;
      await showDeactivated(db);
      await db.query(
        `UPDATE ${KINDS[kind].table} SET deactivated_at = now(), deactivated_by = $2, deactivate_reason = $3 WHERE id = $1`,
        [id, req.user.sub, reason],
      );
      if (linked) await syncBookingFollowup(db, linked);
      return { ok: true };
    }),
  );

  app.post(`/${kind}/:id/restore`, managers, (req) =>
    tx(req, async (db) => {
      const { id } = params.parse(req.params);
      await showDeactivated(db);
      const { rows } = await db.query(
        `UPDATE ${KINDS[kind].table} SET deactivated_at = NULL, deactivated_by = NULL, deactivate_reason = NULL
         WHERE id = $1 AND deactivated_at IS NOT NULL RETURNING id`, [id]);
      if (!rows[0]) throw notFound(`Deactivated ${KINDS[kind].label.toLowerCase()}`);
      if (kind === 'bookings') await logChange(db, req, { bookingId: id, ownerId: null, onBehalfOf: null }, 'restored');
      return { ok: true };
    }),
  );

  // Permanent delete: admins only, and only what was deactivated first.
  app.delete(`/${kind}/:id`, admins, (req) =>
    tx(req, async (db) => {
      const { id } = params.parse(req.params);
      await showDeactivated(db);
      const { rows } = await db.query(`SELECT deactivated_at FROM ${KINDS[kind].table} WHERE id = $1`, [id]);
      if (!rows[0]) throw notFound(KINDS[kind].label);
      if (!rows[0].deactivated_at) throw badRequest('Deactivate it first; only deactivated records can be deleted');
      if (kind === 'contacts' || kind === 'accounts') {
        const column = kind === 'contacts' ? 'contact_id' : 'account_id';
        const used = await db.query(`SELECT 1 FROM bookings WHERE ${column} = $1 LIMIT 1`, [id]);
        if (used.rows[0]) throw badRequest('Contracts still use this customer, so it cannot be deleted');
      }
      await db.query(`DELETE FROM ${KINDS[kind].table} WHERE id = $1`, [id]);
      return { ok: true };
    }),
  );
  }

  // Admin → Deactivated records.
  app.get('/deactivated', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      if (!hasRole(req, can.manage)) throw forbidden();
      await showDeactivated(db);
      const who = `LEFT JOIN users d ON d.id = x.deactivated_by`;
      const pick = 'x.id, x.deactivated_at, x.deactivate_reason, d.name AS deactivated_by_name';
      const q = async (sql: string) => (await db.query(sql)).rows;
      return {
        bookings: await q(`SELECT ${pick}, x.booking_no AS code, x.name, x.status FROM bookings x ${who}
                           WHERE x.deactivated_at IS NOT NULL ORDER BY x.deactivated_at DESC LIMIT 500`),
        contacts: await q(`SELECT ${pick}, x.customer_no AS code, x.name, x.phone FROM contacts x ${who}
                           WHERE x.deactivated_at IS NOT NULL ORDER BY x.deactivated_at DESC LIMIT 500`),
        accounts: await q(`SELECT ${pick}, x.customer_no AS code, x.name, x.phone FROM accounts x ${who}
                           WHERE x.deactivated_at IS NOT NULL ORDER BY x.deactivated_at DESC LIMIT 500`),
        activities: await q(`SELECT ${pick}, x.type AS code, x.subject AS name, x.due_at FROM activities x ${who}
                             WHERE x.deactivated_at IS NOT NULL ORDER BY x.deactivated_at DESC LIMIT 500`),
      };
    }),
  );
}
