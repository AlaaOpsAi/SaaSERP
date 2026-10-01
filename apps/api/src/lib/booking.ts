import type { Db } from '../db.js';
import { badRequest } from './errors.js';

export type BookingStatus = 'INQ' | 'TEN' | 'DEF' | 'ACT' | 'LOS' | 'CXL';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  INQ: 'Inquiry',
  TEN: 'Tentative',
  DEF: 'Definite',
  ACT: 'Actualised',
  LOS: 'Lost',
  CXL: 'Cancelled',
};

/** Allowed status moves. Anything else is rejected. */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  INQ: ['TEN', 'DEF', 'LOS', 'CXL'],
  TEN: ['INQ', 'DEF', 'LOS', 'CXL'],
  DEF: ['TEN', 'ACT', 'CXL'],
  ACT: ['DEF'],
  LOS: ['INQ', 'TEN'],
  CXL: ['TEN'],
};

/** Statuses that hold space firmly on the function diary. */
export const BLOCKING: BookingStatus[] = ['DEF', 'ACT'];

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
