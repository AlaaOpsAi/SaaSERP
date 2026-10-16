import type { Db } from '../db.js';
import { conflict } from './errors.js';

/**
 * One customer per email and per mobile number (CRM rules): a second person or
 * company with the same email or mobile is refused with the customer it belongs to.
 */
export interface Duplicate { kind: 'contacts' | 'accounts'; id: string; customer_no: string; name: string; field: 'email' | 'phone' }

const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '');

export async function findDuplicate(
  db: Pick<Db, 'query'>,
  v: { email?: string | null; phone?: string | null },
  exclude?: { kind: 'contacts' | 'accounts'; id: string },
): Promise<Duplicate | null> {
  const email = v.email?.trim().toLowerCase() || null;
  const phone = digits(v.phone);
  // Local numbers match with or without the country code: compare the last 8 digits.
  const tail = phone.length >= 8 ? phone.slice(-8) : null;
  if (!email && !tail) return null;
  for (const kind of ['contacts', 'accounts'] as const) {
    const skip = exclude?.kind === kind ? exclude.id : null;
    const { rows } = await db.query(
      `SELECT id, customer_no, name,
              CASE WHEN $1::text IS NOT NULL AND lower(email) = $1 THEN 'email' ELSE 'phone' END AS field
       FROM ${kind}
       WHERE ($3::uuid IS NULL OR id <> $3)
         AND (($1::text IS NOT NULL AND lower(email) = $1)
              OR ($2::text IS NOT NULL AND length(regexp_replace(phone, '\\D', '', 'g')) >= 8
                  AND right(regexp_replace(phone, '\\D', '', 'g'), 8) = $2))
       ORDER BY customer_no LIMIT 1`,
      [email, tail, skip],
    );
    if (rows[0]) return { kind, ...rows[0] };
  }
  return null;
}

export async function assertNoDuplicate(db: Pick<Db, 'query'>, v: { email?: string | null; phone?: string | null }, exclude?: { kind: 'contacts' | 'accounts'; id: string }) {
  const d = await findDuplicate(db, v, exclude);
  if (d) throw conflict(`Already exists under customer: ${d.customer_no} ${d.name}`, { duplicate: d });
}
