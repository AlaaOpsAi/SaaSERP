/**
 * SaaSERP is sold as modules. Each one is a subscription (tenants.modules), and the modules
 * other than Contracts also have a basic tier that every workspace gets without one:
 *
 *   contracts  contracts, CRM, activities, diary, documents, dashboard and reports (no basic tier)
 *   hr         basic: employee directory and org chart · full: personal data, documents, expiry
 *              alerts, change requests, import, printed form
 *   finance    basic: the payments and figures on contracts · full: planned
 *
 * A workspace asks for a subscription under Admin & IT → Modules; the platform operator turns it on.
 */
import type { Db } from '../db.js';
import { HttpError } from './errors.js';

export const MODULES = {
  contracts: { name: 'Contracts', available: true, basic: false },
  hr: { name: 'HR', available: true, basic: true },
  finance: { name: 'Finance', available: false, basic: true },
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export async function modulesOf(db: Db): Promise<string[]> {
  const { rows } = await db.query('SELECT modules FROM tenants WHERE id = current_tenant_id()');
  return rows[0]?.modules ?? [];
}

export async function hasModule(db: Db, key: ModuleKey) {
  return (await modulesOf(db)).includes(key);
}

/** Refuse the subscribed part of a module when the workspace does not have it. */
export async function requireModule(db: Db, key: ModuleKey) {
  if (!(await hasModule(db, key))) {
    throw new HttpError(403, MODULES[key].basic
      ? `This needs the full ${MODULES[key].name} module. An owner can request it under Admin & IT → Modules.`
      : `Your workspace does not subscribe to the ${MODULES[key].name} module. An owner can request it under Admin & IT → Modules.`, { module: key });
  }
}
