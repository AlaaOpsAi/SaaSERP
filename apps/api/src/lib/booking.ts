import type { Db } from '../db.js';
import { badRequest } from './errors.js';

export type BookingStatus = 'ENQ' | 'TEN' | 'DEF' | 'ACT' | 'PAID' | 'LOS' | 'CXL';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  ENQ: 'Enquiry',
  TEN: 'Offer sent',
  DEF: 'Signed',
  ACT: 'Actualised',
  PAID: 'Fully paid',
  LOS: 'Lost',
  CXL: 'Cancelled',
};

/** Allowed status moves by hand. Anything else is rejected. */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  ENQ: ['TEN', 'DEF', 'LOS', 'CXL'],
  TEN: ['ENQ', 'DEF', 'LOS', 'CXL'],
  DEF: ['TEN', 'ACT', 'PAID', 'CXL'],
  ACT: ['DEF', 'PAID', 'CXL'],
  PAID: ['DEF', 'ACT', 'CXL'],
  LOS: ['ENQ', 'TEN'],
  CXL: ['TEN'],
};

/** Confirmed statuses: they hold space firmly on the function diary and count as revenue. */
export const BLOCKING: BookingStatus[] = ['DEF', 'ACT', 'PAID'];

export function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw badRequest(`Cannot move a booking from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}`);
  }
}

/**
 * Next booking number for a business unit and year: <CODE><YEAR><NNN>,
 * e.g. W2026001 (the format used by the daily report). The row lock on
 * booking_sequences serialises concurrent creations.
 */
export async function nextBookingNo(db: Db, businessUnitId: string, year: number): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO booking_sequences (tenant_id, business_unit_id, year, last_value)
     VALUES (current_tenant_id(), $1, $2, 1)
     ON CONFLICT (tenant_id, business_unit_id, year)
     DO UPDATE SET last_value = booking_sequences.last_value + 1
     RETURNING last_value, (SELECT code FROM business_units WHERE id = $1) AS code`,
    [businessUnitId, year],
  );
  const { last_value, code } = rows[0];
  if (!code) throw badRequest('Unknown business unit');
  return `${code}${year}${String(last_value).padStart(3, '0')}`;
}

export interface Conflict {
  event_id: string;
  event_name: string;
  booking_id: string | null;
  booking_no: string;
  booking_name: string;
  status: BookingStatus;
  space_name: string;
  start_at: string;
  end_at: string;
  /** False when the clashing booking belongs to another team: its details are hidden. */
  visible: boolean;
}

/**
 * Events of *other* bookings that overlap the given booking's events in the
 * same (non-shareable) function space and firmly hold it (DEF / ACT).
 * Checked across the whole workspace, including bookings of other teams.
 * Pass `eventOverride` to test a not-yet-saved event.
 */
export async function findConflicts(
  db: Db,
  bookingId: string,
  eventOverride?: { id?: string; function_space_id: string | null; start_at: string; end_at: string },
): Promise<Conflict[]> {
  if (eventOverride && !eventOverride.function_space_id) return [];
  const { rows } = await db.query<Conflict>(
    'SELECT * FROM booking_conflicts($1, $2, $3, $4, $5)',
    [bookingId, eventOverride?.function_space_id ?? null, eventOverride?.start_at ?? null, eventOverride?.end_at ?? null, BLOCKING],
  );
  return rows.map((c) =>
    c.visible ? c : { ...c, event_name: 'Booked', booking_id: null, booking_name: "Another team's booking" });
}

/**
 * Statuses that follow what the customer does (customer comment 8):
 *  - a proposal or contract issued moves an enquiry to TEN;
 *  - the client's signed contract or proposal uploaded moves ENQ / TEN to DEF;
 *  - on a confirmed contract, the money received picks DEF, ACT (part paid) or PAID (fully paid),
 *    both ways, whenever payments, the contract value or the revenue lines change.
 * Documents only ever move a contract forward. Each move is written in the history.
 */
export type StatusEvent = 'document_issued' | 'signed_uploaded' | 'money_changed';

export async function syncStatus(db: Db, bookingId: string, event: StatusEvent, userId: string | null, onBehalfOf: string | null = null) {
  const { rows } = await db.query<{ status: BookingStatus; paid: number; billable: number }>(
    `SELECT b.status, f.paid, coalesce(b.contract_value, f.revenue) AS billable
     FROM bookings b JOIN booking_finance f ON f.booking_id = b.id WHERE b.id = $1`,
    [bookingId],
  );
  if (!rows[0]) return;
  const { status: from, paid, billable } = rows[0];
  let to = from;
  let reason = '';
  if (event === 'document_issued' && from === 'ENQ') { to = 'TEN'; reason = 'Automatic: offer issued'; }
  if (event === 'signed_uploaded' && (from === 'ENQ' || from === 'TEN')) { to = 'DEF'; reason = 'Automatic: signed copy uploaded'; }
  // Money decides on money events, and when a signed copy has just confirmed the contract.
  if (BLOCKING.includes(to) && (event === 'money_changed' || to !== from)) {
    const byMoney: BookingStatus = paid > 0 && paid >= billable ? 'PAID' : paid > 0 ? 'ACT' : 'DEF';
    if (byMoney !== to) {
      to = byMoney;
      reason = byMoney === 'PAID' ? 'Automatic: fully paid' : byMoney === 'ACT' ? 'Automatic: part paid' : reason || 'Automatic: no money received';
    }
  }
  // Never double-book a room automatically: a clash waits for someone to confirm by hand.
  if (to !== from && BLOCKING.includes(to) && !BLOCKING.includes(from) && (await findConflicts(db, bookingId)).length) to = from;
  if (to !== from) {
    await db.query('UPDATE bookings SET status = $2 WHERE id = $1', [bookingId, to]);
    await db.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, from_status, to_status, reason, changed_by, on_behalf_of)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6)`,
      [bookingId, from, to, reason, userId, onBehalfOf],
    );
  }
  // The fully-paid date follows the money on confirmed contracts.
  await db.query(
    `UPDATE bookings b
     SET fully_paid_date = CASE WHEN f.outstanding <= 0 AND f.paid > 0 THEN f.last_paid_on ELSE NULL END
     FROM booking_finance f
     WHERE f.booking_id = b.id AND b.id = $1 AND b.status IN ('DEF', 'ACT', 'PAID')`,
    [bookingId],
  );
}
