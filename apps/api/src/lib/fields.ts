/**
 * Contract fields an admin can hide per role (Admin → Contract fields).
 * Hidden fields are removed from API responses and ignored on writes, so a
 * hidden figure never reaches the screen, an export or a direct API call.
 * Owners and admins always see everything.
 */
import type { Role } from '../auth.js';

export const CONTRACT_FIELDS = {
  business_unit: { read: ['business_unit_code'], write: [] },
  branch: { read: ['branch'], write: ['branch'] },
  design: { read: ['design'], write: ['design'] },
  event_type: { read: ['event_type'], write: ['event_type'] },
  pax: { read: ['pax'], write: ['pax'] },
  rate: { read: ['rate', 'term_days'], write: ['rate', 'term_days'] },
  contract_value: { read: ['contract_value', 'diff_ctrl'], write: ['contract_value'] },
  money_received: { read: ['paid', 'diff_ctrl', 'payments'], write: [] },
  credit_facility: { read: ['credit_facility'], write: ['credit_facility'] },
  source: { read: ['source'], write: ['source'] },
  owner: { read: ['owner_name', 'owner_code'], write: ['owner_id'] },
  /** The finance columns hidden in the daily report: filled from Finance, never typed by sales. */
  finance: {
    read: ['manual_revenue', 'manual_cost', 'revenue', 'cost', 'gross_margin', 'margin_pct', 'diff', 'fixed_cost',
      'cf_cost', 'net_profit', 'commission', 'shares', 'outstanding', 'aging_days', 'fully_paid_date', 'items', 'payouts'],
    write: ['manual_revenue', 'manual_cost', 'fully_paid_date', 'payment_status'],
  },
} as const satisfies Record<string, { read: readonly string[]; write: readonly string[] }>;

export type ContractField = keyof typeof CONTRACT_FIELDS;
export const FIELD_KEYS = Object.keys(CONTRACT_FIELDS) as ContractField[];

export const DEFAULT_VISIBILITY: Partial<Record<Role, ContractField[]>> = { sales: ['finance'], marketing: ['finance'], viewer: ['finance'] };

/** The fields hidden from a role under the company's settings. */
export function hiddenFor(role: Role, visibility: Record<string, string[]> | null | undefined): ContractField[] {
  if (role === 'owner' || role === 'admin') return [];
  const list = (visibility ?? DEFAULT_VISIBILITY)[role] ?? [];
  return list.filter((f): f is ContractField => f in CONTRACT_FIELDS);
}

const EMPTY_LISTS = new Set(['items', 'payouts', 'payments']);

/** Blank out hidden fields of a booking row (list or detail). */
export function redactBooking<T extends Record<string, unknown>>(row: T, hidden: readonly ContractField[]): T {
  if (!hidden.length) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of hidden) {
    for (const key of CONTRACT_FIELDS[f].read) {
      if (key in out) out[key] = EMPTY_LISTS.has(key) ? [] : null;
    }
  }
  return out as T;
}

/** Drop writes to hidden fields (they keep their current value). */
export function stripHidden<T extends Record<string, unknown>>(body: T, hidden: readonly ContractField[]): T {
  if (!hidden.length) return body;
  const out: Record<string, unknown> = { ...body };
  for (const f of hidden) for (const key of CONTRACT_FIELDS[f].write) delete out[key];
  return out as T;
}
