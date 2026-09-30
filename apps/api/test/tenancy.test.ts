import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool, withTenant } from '../src/db.js';
import { client, makeApp, newTenant } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('multi-tenancy', () => {
  it('isolates data between workspaces', async () => {
    const a = await newTenant(app);
    const b = await newTenant(app);
    const booking = (await a.post('/bookings', { name: 'A private wedding', contact: { name: 'Mona', phone: '111' } })).body;

    expect((await b.get(`/bookings/${booking.id}`)).status).toBe(404);
    expect((await b.get('/bookings')).body.rows).toHaveLength(0);
    expect((await b.get('/contacts')).body).toHaveLength(0);
    expect((await b.patch(`/bookings/${booking.id}`, { name: 'hijack' })).status).toBe(404);
    expect((await a.get(`/bookings/${booking.id}`)).body.name).toBe('A private wedding');
  });

  it('enforces isolation in the database even without WHERE clauses', async () => {
    const a = await newTenant(app);
    const b = await newTenant(app);
    await a.post('/bookings', { name: 'Only for A' });
    const me = (await b.get('/auth/me')).body;
    const rows = await withTenant(me.tenant.id, async (db) => (await db.query('SELECT name FROM bookings')).rows);
    expect(rows.map((r) => r.name)).not.toContain('Only for A');

    // No tenant context at all: nothing is visible.
    const conn = await pool.connect();
    try {
      expect((await conn.query('SELECT count(*) FROM bookings')).rows[0].count).toBe(0);
      expect((await conn.query('SELECT count(*) FROM users')).rows[0].count).toBe(0);
    } finally {
      conn.release();
    }
  });

  it('rejects writes that target another tenant', async () => {
    const a = await newTenant(app);
    const b = await newTenant(app);
    const bMe = (await b.get('/auth/me')).body;
    const aMe = (await a.get('/auth/me')).body;
    await expect(
      withTenant(aMe.tenant.id, (db) =>
        db.query(`INSERT INTO lookups (tenant_id, type, code, label) VALUES ($1, 'source', 'X', 'X')`, [bMe.tenant.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('asks which workspace to use when an email belongs to several', async () => {
    const email = `shared-${Date.now()}@example.com`;
    const a = await newTenant(app, { email });
    await newTenant(app, { email });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'password123' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.workspaces).toHaveLength(2);
    const ok = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email, password: 'password123', workspace: a.slug },
    });
    expect(ok.statusCode).toBe(200);
    const me = (await client(app, ok.json().token).get('/auth/me')).body;
    expect(me.tenant.slug).toBe(a.slug);
  });

  it('rejects bad passwords and duplicate workspace slugs', async () => {
    const a = await newTenant(app);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    const dup = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { company_name: 'Dup', slug: a.slug, name: 'X Y', email: 'x@y.com', password: 'password123' },
    });
    expect(dup.statusCode).toBe(409);
  });
});

describe('roles and plan limits', () => {
  it('blocks viewers from selling and sales from admin settings', async () => {
    const owner = await newTenant(app);
    await owner.post('/users', { name: 'Vera Viewer', email: 'viewer@x.com', role: 'viewer', password: 'password123' });
    await owner.post('/users', { name: 'Sam Sales', email: 'sales@x.com', role: 'sales', password: 'password123' });
    const login = async (email: string) =>
      client(app, (await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email, password: 'password123', workspace: owner.slug } })).json().token);
    const viewer = await login('viewer@x.com');
    const sales = await login('sales@x.com');

    expect((await viewer.get('/bookings')).status).toBe(200);
    expect((await viewer.post('/bookings', { name: 'nope' })).status).toBe(403);
    expect((await sales.post('/bookings', { name: 'yes' })).status).toBe(201);
    expect((await sales.post('/lookups', { type: 'source', code: 'X', label: 'X' })).status).toBe(403);
    expect((await sales.patch('/tenant', { fixed_cost_pct: 0 })).status).toBe(403);
  });

  it('limits login users to the plan allowance', async () => {
    const owner = await newTenant(app);
    for (let i = 0; i < 4; i++) {
      expect((await owner.post('/users', { name: `User ${i}`, email: `u${i}@x.com`, password: 'password123' })).status).toBe(200);
    }
    const over = await owner.post('/users', { name: 'One too many', email: 'u9@x.com', password: 'password123' });
    expect(over.status).toBe(400);
    // Account managers without a login do not count.
    expect((await owner.post('/users', { name: 'Imported AM', code: 'IAM', is_active: false })).status).toBe(200);
  });
});
