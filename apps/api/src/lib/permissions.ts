/**
 * Data permissions by level (customer comment 7). Each user has a level 1–6; each level allows
 * or denies three data actions, and a user can have personal exceptions on top:
 *
 *   rights = defaults for the level ← the workspace's settings for that level ← personal exceptions
 *
 * Owners always have every right, so nobody can lock the workspace out of its own data.
 * People without "download" see documents in the watermarked viewer instead (routes/viewer.ts).
 */
import type { Db } from '../db.js';
import { forbidden } from './errors.js';

export const DATA_RIGHTS = ['export', 'download', 'print'] as const;
export type DataRight = (typeof DATA_RIGHTS)[number];
export type Rights = Record<DataRight, boolean>;

export const LEVELS: Record<number, string> = {
  1: 'Owner & Admin (IT)', 2: 'Partners', 3: 'Directors / top management', 4: 'Mid-managers',
  5: 'Sales & sales coordinators', 6: 'Data entry',
};

/** The starting point for each level; a workspace changes it under Admin & IT → Permissions. */
export const DEFAULT_LEVEL_RIGHTS: Record<number, Rights> = {
  1: { export: true, download: true, print: true },
  2: { export: true, download: true, print: true },
  3: { export: true, download: true, print: true },
  4: { export: false, download: true, print: true },
  5: { export: false, download: false, print: false },
  6: { export: false, download: false, print: false },
};

/** Level for someone who hasn't been given one, from their role. */
export function levelForRole(role: string, dataScope?: string | null): number {
  if (role === 'owner' || role === 'admin') return 1;
  if (role === 'manager') return dataScope === 'all' ? 3 : 4;
  if (role === 'finance') return 4;
  if (role === 'sales' || role === 'marketing') return 5;
  return 6;
}

const pick = (v: unknown): Partial<Rights> => {
  const out: Partial<Rights> = {};
  if (v && typeof v === 'object') for (const r of DATA_RIGHTS) if (typeof (v as Rights)[r] === 'boolean') out[r] = (v as Rights)[r];
  return out;
};

/** Rights per level for a workspace: the defaults with its own settings applied. */
export function levelRights(tenantSettings: unknown): Record<number, Rights> {
  const out: Record<number, Rights> = {};
  for (const level of Object.keys(DEFAULT_LEVEL_RIGHTS).map(Number)) {
    out[level] = { ...DEFAULT_LEVEL_RIGHTS[level], ...pick((tenantSettings as Record<string, unknown> | null)?.[level]) };
  }
  return out;
}

/** What this user may do with data. */
export async function rightsOf(db: Db, userId: string): Promise<Rights & { level: number }> {
  const { rows } = await db.query(
    `SELECT u.role, u.data_scope, u.level, u.permission_overrides, t.level_permissions
     FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [userId]);
  const u = rows[0];
  if (!u) return { level: 6, ...DEFAULT_LEVEL_RIGHTS[6] };
  const level = u.level ?? levelForRole(u.role, u.data_scope);
  if (u.role === 'owner') return { level, export: true, download: true, print: true };
  return { level, ...levelRights(u.level_permissions)[level], ...pick(u.permission_overrides) };
}

const MESSAGES: Record<DataRight, string> = {
  export: 'You do not have permission to export data. Ask an admin if you need it.',
  download: 'You can view this document on screen, but not download it.',
  print: 'You do not have permission to print documents.',
};

export async function requireRight(db: Db, userId: string, right: DataRight) {
  if (!(await rightsOf(db, userId))[right]) throw forbidden(MESSAGES[right]);
}
