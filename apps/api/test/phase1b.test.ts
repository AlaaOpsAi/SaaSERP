import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, makeVenue, newTenant, type Client } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function member(owner: Client & { slug: string }, name: string, role: string, scope: 'all' | 'team' = 'all') {
  const email = `${name.toLowerCase()}@x.com`;
  await owner.post('/users', { name, email, role, password: 'password123', data_scope: scope });
  return client(app, (await login(app, email, 'password123', owner.slug)).json().token);
}

describe('customer IDs', () => {
  it('numbers people and companies in one series per company, and finds them by number', async () => {
    const c = await newTenant(app);
    const p1 = (await c.post('/contacts', { first_name: 'Latifa', phone: '1' })).body;
    const co = (await c.post('/accounts', { name: 'Gulf Bank' })).body;
    const p2 = (await c.post('/contacts', { name: 'Noura' })).body;
    expect([p1.customer_no, co.customer_no, p2.customer_no]).toEqual(['C-00001', 'C-00002', 'C-00003']);
    // Another company starts again at C-00001.
    const other = await newTenant(app);
    expect((await other.post('/contacts', { name: 'X' })).body.customer_no).toBe('C-00001');

    const found = (await c.get('/links?q=C-00002')).body;
    expect(found.customers.map((x: any) => x.name)).toEqual(['Gulf Bank']);
    expect((await c.get('/contacts?q=C-00003')).body.map((x: any) => x.name)).toEqual(['Noura']);
  });
});

describe('activities', () => {
  it('must be linked to a contract or a customer, except marketing work', async () => {
    const c = await newTenant(app);
    const due = new Date().toISOString();
    const res = await c.post('/activities', { type: 'call', subject: 'Cold call', due_at: due });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Link the activity to a contract ID or a customer ID');

    const customer = (await c.post('/contacts', { name: 'New lead', phone: '55' })).body;
    expect((await c.post('/activities', { type: 'call', subject: 'First call', due_at: due, contact_id: customer.id })).status).toBe(200);
    const b = (await c.post('/bookings', { name: 'Enquiry' })).body;
    expect((await c.post('/activities', { type: 'meeting', subject: 'Visit', due_at: due, booking_id: b.id })).status).toBe(200);
    expect((await c.post('/activities', { type: 'social_post', subject: 'Instagram reel', due_at: due })).status).toBe(200);
  });

  it('lets marketing log activities but not touch contracts', async () => {
    const owner = await newTenant(app);
    const mona = await member(owner, 'Mona', 'marketing');
    const due = new Date().toISOString();
    expect((await mona.post('/activities', { type: 'campaign', subject: 'Wedding season ads', due_at: due })).status).toBe(200);
    expect((await mona.post('/bookings', { name: 'Not allowed' })).status).toBe(403);
    expect((await mona.get('/auth/me')).body.hidden_fields).toEqual(['finance']);
    const report = (await owner.get('/reports/daily-activity')).body;
    expect(report.people.map((p: any) => p.name)).toContain('Mona');
    // Someone with a team view cannot pull another person's report by id.
    const sam = await member(owner, 'Sam', 'sales', 'team');
    const monaId = report.people.find((p: any) => p.name === 'Mona').user_id;
    expect((await sam.get(`/reports/daily-activity?owner_id=${monaId}`)).body.people.map((p: any) => p.name)).toEqual(['Sam']);
  });

  it('carries open activities of a week over to the next week', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Gala' })).body;
    const monday = '2026-11-02';
    const a = (await c.post('/activities', { booking_id: b.id, type: 'call', subject: 'Call', due_at: `${monday}T07:00:00Z` })).body;
    const done = (await c.post('/activities', { booking_id: b.id, type: 'call', subject: 'Done one', due_at: `${monday}T08:00:00Z` })).body;
    await c.post(`/activities/${done.id}/complete`, {});
    expect((await c.post('/activities/carry-over', { from: '2026-11-01', to: '2026-11-07' })).body.moved).toBe(1);
    const all = (await c.get('/activities?scope=mine&state=all')).body;
    expect(all.find((x: any) => x.id === a.id).due_at).toBe('2026-11-09T07:00:00.000Z');
  });

  it('reports a whole month', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Gala' })).body;
    const a = (await c.post('/activities', { booking_id: b.id, type: 'call', subject: 'Call', due_at: new Date().toISOString() })).body;
    await c.post(`/activities/${a.id}/complete`, {});
    const now = new Date();
    const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const r = (await c.get(`/reports/daily-activity?from=${first}&to=${first.slice(0, 8)}28`)).body;
    expect(r.from).toBe(first);
    expect(r.people[0]).toMatchObject({ calls: 1, new_contracts: 1 });
  });
});

describe('deactivate instead of delete', () => {
  it('hides a mistaken contract everywhere; sales only for own early-stage contracts; admins restore or delete', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    const venue = await makeVenue(owner);
    const mine = (await sara.post('/bookings', { name: 'Typo booking', status: 'TEN', event_date: '2026-12-01', function_space_id: venue.ballroom.id })).body;
    const def = (await owner.post('/bookings', { name: 'Definite', status: 'DEF', owner_id: (await sara.get('/auth/me')).body.id })).body;

    expect((await sara.post(`/bookings/${mine.id}/deactivate`, {})).status).toBe(400); // reason required
    expect((await sara.post(`/bookings/${def.id}/deactivate`, { reason: 'mistake' })).status).toBe(403);
    expect((await sara.post(`/bookings/${mine.id}/deactivate`, { reason: 'Duplicate of W2026001' })).status).toBe(200);

    // Gone from lists, details, reports and the diary; the room is free again.
    expect((await owner.get(`/bookings/${mine.id}`)).status).toBe(404);
    expect((await owner.get('/bookings')).body.rows.map((r: any) => r.name)).toEqual(['Definite']);
    const diary = (await owner.get('/diary?from=2026-12-01&to=2026-12-01')).body;
    expect(diary.events).toHaveLength(0);
    const again = await owner.post('/bookings', { name: 'Same room', status: 'DEF', event_date: '2026-12-01', function_space_id: venue.ballroom.id });
    expect(again.status).toBe(201);

    // Only managers see the deactivated list; only admins delete, and only deactivated records.
    expect((await sara.get('/deactivated')).status).toBe(403);
    const list = (await owner.get('/deactivated')).body;
    expect(list.bookings[0]).toMatchObject({ name: 'Typo booking', deactivate_reason: 'Duplicate of W2026001', deactivated_by_name: 'Sara' });
    expect((await sara.del(`/bookings/${mine.id}`)).status).toBe(403);
    expect((await owner.del(`/bookings/${def.id}`)).status).toBe(400);

    expect((await owner.post(`/bookings/${mine.id}/restore`, {})).status).toBe(200);
    expect((await owner.get(`/bookings/${mine.id}`)).body.name).toBe('Typo booking');
    await owner.post(`/bookings/${mine.id}/deactivate`, { reason: 'Really a mistake' });
    expect((await owner.del(`/bookings/${mine.id}`)).status).toBe(200);
    expect((await owner.get('/deactivated')).body.bookings).toHaveLength(0);
  });

  it('deactivates customers without contracts, and activities by their owner', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    const free = (await sara.post('/contacts', { name: 'Wrong person' })).body;
    const used = (await sara.post('/bookings', { name: 'B', contact: { name: 'Real client', phone: '9' } })).body;
    expect((await sara.post(`/contacts/${free.id}/deactivate`, { reason: 'typo' })).status).toBe(200);
    expect((await sara.post(`/contacts/${used.contact_id}/deactivate`, { reason: 'typo' })).status).toBe(403);
    expect((await sara.get('/contacts')).body.map((x: any) => x.name)).toEqual(['Real client']);

    const act = (await owner.post('/activities', { type: 'call', subject: 'Owner call', due_at: new Date().toISOString(), contact_id: used.contact_id })).body;
    expect((await sara.post(`/activities/${act.id}/deactivate`, { reason: 'not mine' })).status).toBe(403);
    expect((await owner.post(`/activities/${act.id}/deactivate`, { reason: 'duplicate' })).status).toBe(200);
    expect((await owner.get('/activities?scope=all&state=all')).body).toHaveLength(0);
  });
});

describe('Admin & IT', () => {
  it('shows version, database, backups and the sign-in and export log to admins only', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    await app.inject({ method: 'GET', url: '/api/reports/contracts.xlsx', headers: { authorization: `Bearer ${owner.token}` } });
    expect((await sara.get('/it/status')).status).toBe(403);
    const res = await owner.get('/it/status');
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    const it = res.body;
    expect(it.database.migration).toMatch(/^\d{3}_/);
    expect(it.backups).toHaveProperty('configured');
    const actions = it.access_log.map((l: any) => `${l.user_name}:${l.action}`);
    expect(actions).toEqual(expect.arrayContaining(['Sara:sign_in', `${it.access_log.find((l: any) => l.action === 'export').user_name}:export`]));
  });
});
