import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createPlatformAdmin } from '../scripts/create-platform-admin.js';
import { buildApp } from '../src/app.js';

export async function makeApp() {
  return buildApp();
}

export interface Client {
  token: string;
  get: <T = any>(url: string) => Promise<{ status: number; body: T }>;
  post: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  patch: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  put: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  del: <T = any>(url: string) => Promise<{ status: number; body: T }>;
  /** Multipart upload of one file. */
  upload: <T = any>(url: string, data: Buffer, name: string) => Promise<{ status: number; body: T }>;
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
    put: (u, p) => call('PUT', u, p),
    del: (u) => call('DELETE', u),
    upload: async (url, data, name) => {
      const boundary = '----saaserp-test';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        data, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({ method: 'POST', url: `/api${url}`, payload,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
      return { status: res.statusCode, body: res.json() };
    },
  } as Client;
}

export const PLATFORM_ADMIN = { email: 'ops@platform.test', password: 'platform-secret-1' };
let platformToken: string | null = null;

/** A signed-in platform operator (created on first use). */
export async function platform(app: FastifyInstance): Promise<Client> {
  if (!platformToken) {
    await createPlatformAdmin(PLATFORM_ADMIN.email, PLATFORM_ADMIN.password, 'Ops', process.env.MIGRATION_DATABASE_URL);
    const res = await app.inject({ method: 'POST', url: '/api/platform/login', payload: PLATFORM_ADMIN });
    platformToken = res.json().token;
  }
  return client(app, platformToken!);
}

/** Sign up a workspace; it stays pending until an operator approves it. */
export async function signup(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const payload: Record<string, unknown> & { slug: string; email: string } = {
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
  return { body: res.json(), ...payload };
}

export async function login(app: FastifyInstance, email: string, password = 'password123', workspace?: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password, workspace } });
}

/** Sign up, approve as the operator, sign in, and return an owner client. */
export async function newTenant(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const s = await signup(app, overrides);
  const ops = await platform(app);
  const { tenants } = (await ops.get('/platform/tenants')).body;
  const tenant = tenants.find((t: { slug: string }) => t.slug === s.slug);
  const approved = await ops.post(`/platform/tenants/${tenant.id}/approve`, {});
  if (approved.status !== 200) throw new Error(JSON.stringify(approved.body));
  const res = await login(app, s.email, s.password as string, s.slug);
  if (res.statusCode !== 200) throw new Error(res.body);
  return { ...client(app, res.json().token), slug: s.slug, email: s.email, tenantId: tenant.id as string };
}

/** A venue with one exclusive room and one shareable location. */
export async function makeVenue(c: Client) {
  const venue = (await c.post('/venues', { name: `Hotel ${randomUUID().slice(0, 6)}` })).body;
  const ballroom = (await c.post('/function-spaces', { venue_id: venue.id, name: 'Ballroom', capacity: 300 })).body;
  const garden = (await c.post('/function-spaces', { venue_id: venue.id, name: 'Garden', allow_overlap: true })).body;
  return { venue, ballroom, garden };
}

export const TEST_PDF = Buffer.from('%PDF-1.4\n%test\n');

/**
 * Create a contract and bring it to the status asked for, the way users do (customer comment 9):
 * every contract starts as ENQ; attaching the offer makes it TEN; DEF is set by hand once the
 * signed copy is attached. Returns the last response, like a plain POST would.
 */
export async function book(c: Client, payload: Record<string, unknown>) {
  const { status: want, force, ...rest } = payload;
  const res = await c.post('/bookings', rest);
  if (res.status >= 300 || !want || want === 'ENQ') return res;
  const id = res.body.id;
  await c.upload(`/bookings/${id}/files?kind=offer`, TEST_PDF, 'offer.pdf');
  if (want === 'DEF') {
    await c.upload(`/bookings/${id}/files?kind=signed_contract`, TEST_PDF, 'signed.pdf');
    const moved = await c.post(`/bookings/${id}/status`, { status: 'DEF', force });
    if (moved.status >= 300) return moved;
  }
  const detail = await c.get(`/bookings/${id}`);
  return { status: 201, body: detail.body };
}
