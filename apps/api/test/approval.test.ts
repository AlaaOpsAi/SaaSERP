import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant, platform, signup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const findTenant = async (slug: string) => {
  const ops = await platform(app);
  return (await ops.get('/platform/tenants')).body.tenants.find((t: { slug: string }) => t.slug === slug);
};

describe('workspace approval', () => {
  it('keeps new sign-ups pending until an operator approves them', async () => {
    const s = await signup(app, { phone: '+965 5000 0000', note: 'Wedding planner, 5 staff' });
    expect(s.body).toEqual({ status: 'pending', workspace: s.slug });

    const pending = await login(app, s.email);
    expect(pending.statusCode).toBe(403);
    expect(pending.json().details.tenant_status).toBe('pending');

    const t = await findTenant(s.slug);
    expect(t).toMatchObject({ status: 'pending', contact_phone: '+965 5000 0000', signup_note: 'Wedding planner, 5 staff',
                              owner_email: s.email, users: 1, bookings: 0 });

    const ops = await platform(app);
    const approved = await ops.post(`/platform/tenants/${t.id}/approve`, { plan: 'starter', max_users: 10 });
    expect(approved.body).toMatchObject({ status: 'active', plan: 'starter', max_users: 10, reviewed_by: 'ops@platform.test' });
    expect((await login(app, s.email)).statusCode).toBe(200);
  });

  it('rejects with a reason the customer sees, and can reconsider', async () => {
    const s = await signup(app);
    const t = await findTenant(s.slug);
    const ops = await platform(app);
    expect((await ops.post(`/platform/tenants/${t.id}/reject`, {})).status).toBe(400);
    await ops.post(`/platform/tenants/${t.id}/reject`, { reason: 'Could not verify the company' });
    const res = await login(app, s.email);
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toEqual({ tenant_status: 'rejected', reason: 'Could not verify the company' });
    expect((await ops.post(`/platform/tenants/${t.id}/suspend`, { reason: 'x' })).status).toBe(400);
    expect((await ops.post(`/platform/tenants/${t.id}/approve`, {})).body.status).toBe('active');
  });

  it('suspending a workspace ends its existing sessions immediately', async () => {
    const owner = await newTenant(app);
    expect((await owner.get('/bookings')).status).toBe(200);
    const ops = await platform(app);
    await ops.post(`/platform/tenants/${owner.tenantId}/suspend`, { reason: 'Unpaid invoice' });
    const blocked = await owner.get('/bookings');
    expect(blocked.status).toBe(403);
    expect(blocked.body.details.tenant_status).toBe('suspended');
    await ops.post(`/platform/tenants/${owner.tenantId}/reactivate`, {});
    expect((await owner.get('/bookings')).status).toBe(200);
  });

  it('keeps the operator console away from tenant users and vice versa', async () => {
    const owner = await newTenant(app);
    expect((await owner.get('/platform/tenants')).status).toBe(403);
    const ops = await platform(app);
    expect((await ops.get('/bookings')).status).toBe(403);
    expect((await client(app, 'not-a-token').get('/platform/tenants')).status).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/platform/login', payload: { email: 'ops@platform.test', password: 'wrong' } });
    expect(bad.statusCode).toBe(401);
  });

  it('lets the operator change plan limits', async () => {
    const owner = await newTenant(app);
    const ops = await platform(app);
    await ops.patch(`/platform/tenants/${owner.tenantId}`, { max_users: 2 });
    expect((await owner.post('/users', { name: 'One', email: 'one@x.com', password: 'password123' })).status).toBe(200);
    expect((await owner.post('/users', { name: 'Two', email: 'two@x.com', password: 'password123' })).status).toBe(400);
  });
});
