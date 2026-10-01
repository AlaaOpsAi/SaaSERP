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
 * Run a handler body inside the caller's tenant. The workspace status is
 * re-checked on every request, so suspending a workspace ends its sessions.
 */
export function tx<T>(req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenant(req.user.tid, async (db) => {
    const { rows } = await db.query('SELECT status FROM tenants WHERE id = current_tenant_id()');
    const status = rows[0]?.status;
    if (status !== 'active') {
      throw new HttpError(403, 'This workspace is not active', { tenant_status: status ?? 'missing' });
    }
    return fn(db);
  });
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
