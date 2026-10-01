import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, type Client, login, makeApp, newTenant, platform } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Owner > Mona (manager) > Jou, Gha (sales); Sami (sales) in another branch; Fadi finance. */
async function org() {
  const owner = await newTenant(app);
  await (await platform(app)).patch(`/platform/tenants/${owner.tenantId}`, { max_users: 20 });
  const add = async (name: string, role: string, manager?: string) =>
    (await owner.post('/users', { name, role, email: `${name.toLowerCase()}@x.com`, password: 'password123', manager_id: manager })).body;
  const mona = await add('Mona', 'manager');
  const jou = await add('Jou', 'sales', mona.id);
  const gha = await add('Gha', 'sales', mona.id);
  const sami = await add('Sami', 'sales');
  const as = async (n: string): Promise<Client> =>
    client(app, (await login(app, `${n.toLowerCase()}@x.com`, 'password123', owner.slug)).json().token);
  const u = { mona, jou, gha, sami };
  const c = { owner, mona: await as('Mona'), jou: await as('Jou'), gha: await as('Gha'), sami: await as('Sami') };
  const jouBooking = (await c.jou.post('/bookings', { name: 'Jou wedding', status: 'DEF', manual_revenue: 500 })).body;
  const jouTask = (await c.jou.post('/activities', {
    booking_id: jouBooking.id, type: 'call', subject: 'Call the bride', due_at: new Date().toISOString(),
  })).body;
  return { u, c, jouBooking, jouTask };
}

const names = async (c: Client) => (await c.get('/bookings')).body.rows.map((b: { name: string }) => b.name);

describe('delegation', () => {
  it('opens the delegator\'s records only during the dates, then closes them again', async () => {
    const { u, c } = await org();
    expect(await names(c.gha)).toEqual([]);
    const future = await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(5), ends_on: day(10) });
    expect(future.status).toBe(201);
    expect(future.body.state).toBe('upcoming');
    expect(await names(c.gha)).toEqual([]);
    const past = (await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(-10), ends_on: day(-2) })).body;
    expect(past.state).toBe('ended');
    expect(await names(c.gha)).toEqual([]);
    const now = (await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(0), ends_on: day(3) })).body;
    expect(now.state).toBe('active');
    expect(await names(c.gha)).toEqual(['Jou wedding']);
    expect((await c.gha.get('/auth/me')).body.covering[0]).toMatchObject({ delegator_name: 'Jou', access: 'act' });
    expect((await c.jou.get('/auth/me')).body.covered_by[0]).toMatchObject({ delegate_name: 'Gha' });
    await c.jou.post(`/delegations/${now.id}/revoke`);
    expect(await names(c.gha)).toEqual([]);
  });

  it('view only lets the delegate look but not change; act lets them work, recorded on behalf', async () => {
    const { u, c, jouBooking } = await org();
    const d = (await c.jou.post('/delegations', { delegate_id: u.sami.id, starts_on: day(0), access: 'view' })).body;
    expect((await c.sami.get(`/bookings/${jouBooking.id}`)).status).toBe(200);
    const denied = await c.sami.patch(`/bookings/${jouBooking.id}`, { pax: 99 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain('not change them');
    await c.jou.post(`/delegations/${d.id}/revoke`);

    await c.jou.post('/delegations', { delegate_id: u.sami.id, starts_on: day(0) });
    expect((await c.sami.patch(`/bookings/${jouBooking.id}`, { pax: 120 })).status).toBe(200);
    await c.sami.post(`/bookings/${jouBooking.id}/status`, { status: 'ACT' });
    const detail = (await c.owner.get(`/bookings/${jouBooking.id}`)).body;
    expect(detail.log.find((l: any) => l.action === 'updated')).toMatchObject({ actor_name: 'Sami', on_behalf_of_name: 'Jou', details: { fields: ['pax'] } });
    expect(detail.history.at(-1)).toMatchObject({ to_status: 'ACT', changed_by_name: 'Sami', on_behalf_of_name: 'Jou' });
    // Sami may create a booking for Jou while covering, but not for an outsider like Gha.
    expect((await c.sami.post('/bookings', { name: 'New enquiry for Jou', owner_id: u.jou.id })).status).toBe(201);
    expect((await c.sami.post('/bookings', { name: 'x', owner_id: u.gha.id })).status).toBe(403);
  });

  it('never lets a delegate take money actions', async () => {
    const { u, c, jouBooking } = await org();
    // Mona's peer manager Omar covers for Mona (whose team includes Jou), with team included.
    const omar = (await c.owner.post('/users', { name: 'Omar', role: 'manager', email: 'omar@x.com', password: 'password123' })).body;
    const omarC = client(app, (await login(app, 'omar@x.com', 'password123', c.owner.slug)).json().token);
    await c.mona.post('/delegations', { delegate_id: omar.id, starts_on: day(0), include_team: true });
    expect((await omarC.get(`/bookings/${jouBooking.id}`)).status).toBe(200);
    const pay = await omarC.post(`/bookings/${jouBooking.id}/payments`, { paid_on: day(0), amount: 100 });
    expect(pay.status).toBe(403);
    expect(pay.body.error).toContain('Payments and commissions stay with finance');
    expect((await omarC.post(`/bookings/${jouBooking.id}/payouts`, { kind: 'commission', payee_name: 'X', pct: 0.1 })).status).toBe(403);
    // Mona herself (Jou's manager) still can.
    expect((await c.mona.post(`/bookings/${jouBooking.id}/payments`, { paid_on: day(0), amount: 100 })).status).toBe(200);
    void u;
  });

  it('hands over open follow-ups and records who completed them', async () => {
    const { u, c, jouTask } = await org();
    await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(0), handover_activities: true });
    const mine = (await c.gha.get('/activities?scope=mine')).body;
    expect(mine.map((a: any) => a.subject)).toContain('Call the bride');
    expect(mine.find((a: any) => a.id === jouTask.id).not_mine).toBe(true);
    await c.gha.post(`/activities/${jouTask.id}/complete`, { outcome: 'Confirmed menu' });
    const done = (await c.jou.get('/activities?scope=mine&state=done')).body[0];
    expect(done).toMatchObject({ completed_by_name: 'Gha', completed_on_behalf_of_name: 'Jou', outcome: 'Confirmed menu' });
    expect((await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(0), access: 'view', handover_activities: true })).status).toBe(400);
  });

  it('is self-service for your own records, manager-run for the team, and tells the manager', async () => {
    const { u, c } = await org();
    expect((await c.jou.post('/delegations', { delegator_id: u.gha.id, delegate_id: u.sami.id, starts_on: day(0) })).status).toBe(403);
    expect((await c.mona.post('/delegations', { delegator_id: u.gha.id, delegate_id: u.jou.id, starts_on: day(0) })).status).toBe(201);
    expect((await c.sami.post('/delegations', { delegator_id: u.jou.id, delegate_id: u.sami.id, starts_on: day(0) })).status).toBe(403);
    const inactive = (await c.owner.post('/users', { name: 'NoLogin', code: 'NL', is_active: false })).body;
    expect((await c.jou.post('/delegations', { delegate_id: inactive.id, starts_on: day(0) })).body.error).toContain('cannot sign in');

    await c.jou.post('/delegations', { delegate_id: u.sami.id, starts_on: day(0), ends_on: day(7) });
    const monaBell = (await c.mona.get('/notifications')).body;
    expect(monaBell.unread).toBeGreaterThan(0);
    expect(monaBell.items[0].text).toContain('Jou is covered by Sami');
    expect((await c.sami.get('/notifications')).body.items[0].text).toContain('You are covering for Jou');
    await c.mona.post('/notifications/read');
    expect((await c.mona.get('/notifications')).body.unread).toBe(0);
    // Each sees the right list.
    expect((await c.sami.get('/delegations')).body).toHaveLength(1);
    expect((await c.mona.get('/delegations')).body).toHaveLength(2);
  });
});

describe('transfer when someone leaves', () => {
  it('moves open work to a colleague, keeps history, and deactivates the leaver', async () => {
    const { u, c, jouBooking, jouTask } = await org();
    const lost = (await c.jou.post('/bookings', { name: 'Old lost lead' })).body;
    await c.jou.post(`/bookings/${lost.id}/status`, { status: 'LOS', reason: 'BUDGET' });
    await c.jou.post('/delegations', { delegate_id: u.gha.id, starts_on: day(0) });

    expect((await c.sami.post(`/users/${u.jou.id}/transfer`, { to_user_id: u.gha.id })).status).toBe(403);
    expect((await c.mona.post(`/users/${u.jou.id}/transfer`, { to_user_id: u.sami.id })).status).toBe(403);
    const res = await c.mona.post(`/users/${u.jou.id}/transfer`, { to_user_id: u.gha.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ moved: { bookings: 1, activities: 1 }, deactivated: true });

    const moved = (await c.owner.get(`/bookings/${jouBooking.id}`)).body;
    expect(moved.owner_id).toBe(u.gha.id);
    expect(moved.log.at(-1)).toMatchObject({ action: 'transferred', details: { from: 'Jou', to: 'Gha' } });
    expect((await c.owner.get(`/bookings/${lost.id}`)).body.owner_id).toBe(u.jou.id); // closed history stays
    expect((await c.gha.get('/activities?scope=mine')).body.map((a: any) => a.id)).toContain(jouTask.id);
    expect((await login(app, 'jou@x.com', 'password123', c.owner.slug)).statusCode).toBe(401);
    expect((await c.jou.get('/bookings')).status).toBe(401); // existing session ends
    expect((await c.gha.get('/delegations')).body[0].state).toBe('revoked');
    expect((await c.gha.get('/notifications')).body.items[0].text).toContain("Jou's work was transferred to you");
  });
});
