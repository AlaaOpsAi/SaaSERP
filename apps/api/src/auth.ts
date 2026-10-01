import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant, type Db } from './db.js';
import { forbidden, HttpError } from './lib/errors.js';

export type Role = 'owner' | 'admin' | 'manager' | 'sales' | 'finance' | 'viewer';

export interface AuthUser {
  sub: string; // user id
  tid: string; // tenant id
  role: Role;
}

/** Platform operators sign in separately and never carry a tenant. */
export interface PlatformUser {
  sub: string; // platform admin id
  scope: 'platform';
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser | PlatformUser;
    user: AuthUser;
  }
}

/** Who may do what. Owners and admins can do everything. */
export const can = {
  read: ['owner', 'admin', 'manager', 'sales', 'finance', 'viewer'],
  sell: ['owner', 'admin', 'manager', 'sales'],
  finance: ['owner', 'admin', 'manager', 'finance'],
  manage: ['owner', 'admin', 'manager'],
  admin: ['owner', 'admin'],
} satisfies Record<string, Role[]>;

export function requireRole(roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    await req.jwtVerify();
    if (!req.user.tid || !roles.includes(req.user.role)) throw forbidden();
  };
}

export const authed = requireRole(can.read);

/**
 * Run a handler body inside the caller's tenant, narrowed to what the caller may see.
 * The workspace status and the user are re-checked on every request, so suspending a
 * workspace or deactivating a user takes effect immediately.
 */
export function tx<T>(req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenant(req.user.tid, async (db) => {
    const { rows } = await db.query(
      `SELECT t.status, u.is_active, u.role, u.data_scope
       FROM tenants t LEFT JOIN users u ON u.id = $1 WHERE t.id = current_tenant_id()`,
      [req.user.sub],
    );
    const status = rows[0]?.status;
    if (status !== 'active') {
      throw new HttpError(403, 'This workspace is not active', { tenant_status: status ?? 'missing' });
    }
    if (!rows[0].is_active) throw new HttpError(401, 'Your account is no longer active');
    req.scope = await applyScope(db, req.user.sub, rows[0].role, rows[0].data_scope);
    return fn(db);
  });
}

export interface Covering {
  delegationId: string;
  delegatorId: string;
  access: 'view' | 'act';
  /** Owners whose records this delegation opens (the delegator, plus their team if included). */
  ownerIds: string[];
  handoverActivities: boolean;
}

export interface Scope {
  seesAll: boolean;
  /** The user and everyone who reports to them, at any depth. */
  teamIds: string[];
  /** Active delegations to this user (people they are covering for). */
  covering: Covering[];
  /** Owners the user may change records of: own team + "view & act" delegations. */
  writeIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    scope?: Scope;
  }
}

const SUBTREE = `WITH RECURSIVE team(id, depth) AS (
    SELECT unnest($1::uuid[]), 0
    UNION
    SELECT u.id, t.depth + 1 FROM users u JOIN team t ON u.manager_id = t.id WHERE t.depth < 20
  ) SELECT coalesce(array_agg(DISTINCT id), '{}') AS ids FROM team`;

async function subtree(db: Db, roots: string[]): Promise<string[]> {
  if (!roots.length) return [];
  return (await db.query(SUBTREE, [roots])).rows[0].ids;
}

/** Set the row-level-security context for this transaction. */
async function applyScope(db: Db, userId: string, role: Role, dataScope: 'all' | 'team'): Promise<Scope> {
  const seesAll = role === 'owner' || role === 'admin' || dataScope === 'all';
  const teamIds = await subtree(db, [userId]);

  // Delegations in force today (workspace calendar). Delegations do not chain.
  const { rows: active } = await db.query(
    `SELECT d.id, d.delegator_id, d.access, d.include_team, d.handover_activities
     FROM delegations d JOIN tenants t ON t.id = d.tenant_id JOIN users u ON u.id = d.delegator_id
     WHERE d.delegate_id = $1 AND d.revoked_at IS NULL
       AND d.starts_on <= (now() AT TIME ZONE t.timezone)::date
       AND (d.ends_on IS NULL OR d.ends_on >= (now() AT TIME ZONE t.timezone)::date)`,
    [userId],
  );
  const covering: Covering[] = [];
  for (const d of active) {
    covering.push({
      delegationId: d.id, delegatorId: d.delegator_id, access: d.access, handoverActivities: d.handover_activities,
      ownerIds: d.include_team ? await subtree(db, [d.delegator_id]) : [d.delegator_id],
    });
  }
  const readIds = [...new Set([...teamIds, ...covering.flatMap((c) => c.ownerIds)])];
  const writeIds = [...new Set([...teamIds, ...covering.filter((c) => c.access === 'act').flatMap((c) => c.ownerIds)])];
  await db.query(
    `SELECT set_config('app.see_all', $1, true), set_config('app.user_id', $2, true),
            set_config('app.team_ids', $3, true), set_config('app.write_ids', $4, true)`,
    [seesAll ? 'on' : 'off', userId, readIds.join(','), writeIds.join(',')],
  );
  return { seesAll, teamIds, covering, writeIds };
}

/**
 * When the caller touches a record only because they are covering for someone,
 * the delegator they act for (for the audit trail); otherwise null.
 */
export function onBehalfOf(req: FastifyRequest, ownerId: string | null | undefined): string | null {
  const scope = req.scope;
  if (!scope || !ownerId || scope.seesAll || scope.teamIds.includes(ownerId)) return null;
  return scope.covering.find((c) => c.ownerIds.includes(ownerId))?.delegatorId ?? null;
}

/** Throw unless the caller may hand a record to `ownerId` (themselves or someone in their team). */
export function assertCanAssign(req: FastifyRequest, ownerId: string | null | undefined) {
  if (!req.scope || req.scope.seesAll || ownerId === undefined) return;
  // Own team, or someone you are covering for with "view & act".
  if (ownerId === null || !req.scope.writeIds.includes(ownerId)) {
    throw forbidden('You can only assign bookings to yourself or people in your team');
  }
}

export const platformOnly = async (req: FastifyRequest) => {
  await req.jwtVerify();
  if ((req.user as unknown as PlatformUser).scope !== 'platform') throw forbidden();
};

export function platformUser(req: FastifyRequest): PlatformUser {
  return req.user as unknown as PlatformUser;
}

export function hasRole(req: FastifyRequest, roles: Role[]): boolean {
  return roles.includes(req.user.role);
}
