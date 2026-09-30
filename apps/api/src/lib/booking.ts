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
  booking_id: string;
  booking_no: string;
  booking_name: string;
  status: BookingStatus;
  space_name: string;
  start_at: string;
  end_at: string;
}

/**
 * Events of *other* bookings that overlap the given booking's events in the
 * same (non-shareable) function space and firmly hold it (DEF / ACT).
 * Pass `eventOverride` to test a not-yet-saved event.
 */
export async function findConflicts(
  db: Db,
  bookingId: string,
  eventOverride?: { id?: string; function_space_id: string | null; start_at: string; end_at: string },
): Promise<Conflict[]> {
  const params: unknown[] = [bookingId, BLOCKING];
  let source: string;
  if (eventOverride) {
    if (!eventOverride.function_space_id) return [];
    params.push(eventOverride.function_space_id, eventOverride.start_at, eventOverride.end_at);
    source = `SELECT $3::uuid AS function_space_id, $4::timestamptz AS start_at, $5::timestamptz AS end_at`;
  } else {
    source = `SELECT function_space_id, start_at, end_at FROM booking_events
              WHERE booking_id = $1 AND function_space_id IS NOT NULL`;
  }
  const { rows } = await db.query(
    `WITH mine AS (${source})
     SELECT DISTINCT e.id AS event_id, e.name AS event_name, b.id AS booking_id, b.booking_no,
            b.name AS booking_name, b.status, s.name AS space_name, e.start_at, e.end_at
     FROM mine m
     JOIN function_spaces s ON s.id = m.function_space_id AND NOT s.allow_overlap
     JOIN booking_events e ON e.function_space_id = m.function_space_id
                          AND tstzrange(e.start_at, e.end_at) && tstzrange(m.start_at, m.end_at)
     JOIN bookings b ON b.id = e.booking_id
     WHERE b.id <> $1 AND b.status = ANY($2)
     ORDER BY e.start_at`,
    params,
  );
  return rows;
}
