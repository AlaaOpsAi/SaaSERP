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

export interface Scope {
  seesAll: boolean;
  /** The user and everyone who reports to them, at any depth. */
  teamIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    scope?: Scope;
  }
}

/** Set the row-level-security context for this transaction. */
async function applyScope(db: Db, userId: string, role: Role, dataScope: 'all' | 'team'): Promise<Scope> {
  const seesAll = role === 'owner' || role === 'admin' || dataScope === 'all';
  const { rows } = await db.query(
    `WITH RECURSIVE team(id, depth) AS (
       SELECT $1::uuid, 0
       UNION
       SELECT u.id, t.depth + 1 FROM users u JOIN team t ON u.manager_id = t.id WHERE t.depth < 20
     ) SELECT array_agg(id) AS ids FROM team`,
    [userId],
  );
  const teamIds: string[] = rows[0].ids ?? [userId];
  await db.query(
    `SELECT set_config('app.see_all', $1, true), set_config('app.user_id', $2, true), set_config('app.team_ids', $3, true)`,
    [seesAll ? 'on' : 'off', userId, teamIds.join(',')],
  );
  return { seesAll, teamIds };
}

/** Throw unless the caller may hand a record to `ownerId` (themselves or someone in their team). */
export function assertCanAssign(req: FastifyRequest, ownerId: string | null | undefined) {
  if (!req.scope || req.scope.seesAll || ownerId === undefined) return;
  if (ownerId === null || !req.scope.teamIds.includes(ownerId)) {
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
