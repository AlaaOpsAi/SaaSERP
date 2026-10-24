import type { Db } from '../db.js';
import { badRequest } from './errors.js';

export type BookingStatus = 'ENQ' | 'TEN' | 'DEF' | 'LOS' | 'CXL';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  ENQ: 'Enquiry',
  TEN: 'Offer sent',
  DEF: 'Signed',
  LOS: 'Lost',
  CXL: 'Cancelled',
};

/**
 * Allowed status moves by hand (customer comment 9, the daily report's STATUS CONDITIONS).
 * TEN also needs an offer printed or attached, and DEF a signed copy: see assertConditions.
 */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  ENQ: ['TEN', 'DEF', 'LOS', 'CXL'],
  TEN: ['ENQ', 'DEF', 'LOS', 'CXL'],
  DEF: ['TEN', 'CXL'],
  LOS: ['ENQ', 'TEN', 'CXL'],
  CXL: ['TEN'],
};

/** Statuses that hold space firmly on the function diary. */
export const BLOCKING: BookingStatus[] = ['DEF'];

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

/** An offer printed from the app (proposal / contract) or attached as a file. */
export async function hasOffer(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM documents WHERE booking_id = $1 AND kind IN ('proposal', 'contract'))
         OR EXISTS (SELECT 1 FROM booking_files WHERE booking_id = $1 AND kind IN ('offer', 'signed_proposal', 'signed_contract')) AS ok`,
    [bookingId]);
  return Boolean(rows[0]?.ok);
}

/** The client's signed offer or contract, attached. */
export async function hasSignedCopy(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM booking_files WHERE booking_id = $1 AND kind IN ('signed_contract', 'signed_proposal')) AS ok`, [bookingId]);
  return Boolean(rows[0]?.ok);
}

/** STATUS CONDITIONS: TEN needs an offer, DEF a signed copy. */
export async function assertConditions(db: Db, bookingId: string, to: BookingStatus) {
  if (to === 'TEN' && !(await hasOffer(db, bookingId))) {
    throw badRequest('Print an offer from the contract, or attach the offer you sent, before marking it Offer sent');
  }
  if (to === 'DEF' && !(await hasSignedCopy(db, bookingId))) {
    throw badRequest('Attach the signed offer or contract before marking it Signed');
  }
}

/**
 * The automatic status move (customer comment 9): an enquiry becomes TEN once an offer is printed
 * or attached. DEF is always set by hand. Money no longer changes the status; it sets the
 * PAYMENT status (DP / PAID) and the fully-paid date.
 */
export type StatusEvent = 'offer' | 'money_changed';

export async function syncStatus(db: Db, bookingId: string, event: StatusEvent, userId: string | null, onBehalfOf: string | null = null) {
  if (event === 'offer') {
    const { rows } = await db.query<{ status: BookingStatus }>('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    if (rows[0]?.status === 'ENQ') {
      await db.query(`UPDATE bookings SET status = 'TEN' WHERE id = $1`, [bookingId]);
      await db.query(
        `INSERT INTO booking_status_history (tenant_id, booking_id, from_status, to_status, reason, changed_by, on_behalf_of)
         VALUES (current_tenant_id(), $1, 'ENQ', 'TEN', 'Automatic: offer sent', $2, $3)`,
        [bookingId, userId, onBehalfOf]);
    }
  }
  // The fully-paid date follows the money on signed contracts.
  await db.query(
    `UPDATE bookings b
     SET fully_paid_date = CASE WHEN f.outstanding <= 0 AND f.paid > 0 THEN f.last_paid_on ELSE NULL END
     FROM booking_finance f
     WHERE f.booking_id = b.id AND b.id = $1 AND b.status = 'DEF'`,
    [bookingId],
  );
}

/** PAYMENT column: PAID when fully paid, else what Finance set, else DP once money came in. */
export const PAYMENT_SQL = `CASE WHEN f.paid > 0 AND f.paid >= coalesce(b.contract_value, f.revenue) THEN 'PAID'
  WHEN b.payment_status IS NOT NULL THEN b.payment_status WHEN f.paid > 0 THEN 'DP' END`;
