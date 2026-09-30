import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant, type Db } from './db.js';
import { forbidden } from './lib/errors.js';

export type Role = 'owner' | 'admin' | 'manager' | 'sales' | 'finance' | 'viewer';

export interface AuthUser {
  sub: string; // user id
  tid: string; // tenant id
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
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
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}

export const authed = requireRole(can.read);

/** Run a handler body inside the caller's tenant. */
export function tx<T>(req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenant(req.user.tid, fn);
}

export function hasRole(req: FastifyRequest, roles: Role[]): boolean {
  return roles.includes(req.user.role);
}
