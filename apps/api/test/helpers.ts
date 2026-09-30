import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

export async function makeApp() {
  return buildApp();
}

export interface Client {
  token: string;
  get: <T = any>(url: string) => Promise<{ status: number; body: T }>;
  post: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  patch: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  del: <T = any>(url: string) => Promise<{ status: number; body: T }>;
}

export function client(app: FastifyInstance, token: string): Client {
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url: `/api${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as object,
    });
    return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
  };
  return {
    token,
    get: (u) => call('GET', u),
    post: (u, p) => call('POST', u, p ?? {}),
    patch: (u, p) => call('PATCH', u, p),
    del: (u) => call('DELETE', u),
  } as Client;
}

/** Sign up a fresh workspace and return an owner client. */
export async function newTenant(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const payload = {
    company_name: `Co ${suffix}`,
    slug: `co-${suffix}`,
    name: 'Owner Person',
    email: `owner-${suffix}@example.com`,
    password: 'password123',
    business_unit_code: 'W',
    ...overrides,
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload });
  if (res.statusCode !== 200) throw new Error(res.body);
  return { ...client(app, res.json().token), slug: payload.slug, email: payload.email };
}

/** A venue with one exclusive room and one shareable location. */
export async function makeVenue(c: Client) {
  const venue = (await c.post('/venues', { name: `Hotel ${randomUUID().slice(0, 6)}` })).body;
  const ballroom = (await c.post('/function-spaces', { venue_id: venue.id, name: 'Ballroom', capacity: 300 })).body;
  const garden = (await c.post('/function-spaces', { venue_id: venue.id, name: 'Garden', allow_overlap: true })).body;
  return { venue, ballroom, garden };
}
