/**
 * SaaSERP is sold as modules (customer comment 8): every workspace has Sales & Contracts,
 * and subscribes to others (HR, later Finance …). A workspace asks for a module under
 * Admin & IT → Modules; the platform operator turns it on. Modules work together, and
 * when one is missing the others keep working with less (e.g. without HR, people keep
 * their Employee ID, department and level, but there are no employee records).
 */
import type { Db } from '../db.js';
import { HttpError } from './errors.js';

export const MODULES = {
  sales: { name: 'Sales & Contracts', available: true, always: true },
  hr: { name: 'HR', available: true, always: false },
  finance: { name: 'Finance', available: false, always: false },
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export async function modulesOf(db: Db): Promise<string[]> {
  const { rows } = await db.query('SELECT modules FROM tenants WHERE id = current_tenant_id()');
  return rows[0]?.modules ?? ['sales'];
}

export async function hasModule(db: Db, key: ModuleKey) {
  return (await modulesOf(db)).includes(key);
}

/** Refuse a module's pages and data when the workspace does not subscribe to it. */
export async function requireModule(db: Db, key: ModuleKey) {
  if (!(await hasModule(db, key))) {
    throw new HttpError(403, `Your workspace does not subscribe to the ${MODULES[key].name} module. An owner can request it under Admin & IT → Modules.`, { module: key });
  }
}
