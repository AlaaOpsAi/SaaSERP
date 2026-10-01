import type { FastifyRequest } from 'fastify';
import { onBehalfOf } from '../auth.js';
import type { Db } from '../db.js';
import { forbidden, notFound } from './errors.js';

export interface WriteContext {
  bookingId: string;
  ownerId: string | null;
  /** Set when the caller acts as a delegate for the booking's owner. */
  onBehalfOf: string | null;
}

/**
 * Make sure the caller may change this booking, with a clear message when they
 * can only view it (a "view only" delegation). Money actions (payments,
 * commissions) are never done by a delegate.
 */
export async function writable(db: Db, req: FastifyRequest, bookingId: string, opts: { money?: boolean } = {}): Promise<WriteContext> {
  const { rows } = await db.query(
    `SELECT b.owner_id, app_booking_writable(b.id) AS writable, u.name AS owner_name
     FROM bookings b LEFT JOIN users u ON u.id = b.owner_id WHERE b.id = $1`,
    [bookingId],
  );
  if (!rows[0]) throw notFound('Booking');
  if (!rows[0].writable) {
    throw forbidden(`You can view ${rows[0].owner_name ?? 'these'} records while covering, but not change them`);
  }
  const behalf = onBehalfOf(req, rows[0].owner_id);
  if (opts.money && behalf) {
    throw forbidden("Payments and commissions stay with finance and the owner's managers while you are covering");
  }
  return { bookingId, ownerId: rows[0].owner_id, onBehalfOf: behalf };
}

/** Booking id of a child record (event, line, payment, payout), or 404. */
export async function bookingOf(db: Db, table: string, id: string, what: string): Promise<string> {
  const { rows } = await db.query(`SELECT booking_id FROM ${table} WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound(what);
  return rows[0].booking_id;
}

/** Append to the booking's audit trail. */
export async function logChange(db: Db, req: FastifyRequest, ctx: WriteContext, action: string, details: object = {}) {
  await db.query(
    `INSERT INTO booking_log (tenant_id, booking_id, actor_id, on_behalf_of, action, details)
     VALUES (current_tenant_id(), $1, $2, $3, $4, $5)`,
    [ctx.bookingId, req.user.sub, ctx.onBehalfOf, action, JSON.stringify(details)],
  );
}
