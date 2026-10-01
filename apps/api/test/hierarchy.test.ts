import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, type Client, login, makeApp, makeVenue, newTenant } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

/**
 * Owner (whole company)
 * └─ Dina, sales director
 *    ├─ Mona, sales manager
 *    │  └─ Tala, team lead
 *    │     └─ Rami, account manager
 *    └─ (Mona's peer) Omar, sales manager
 *       └─ Sami, account manager
 * Fadi, finance (whole company)
 */
async function org() {
  const owner = await newTenant(app);
  const add = async (name: string, role: string, manager?: string, extra: object = {}) =>
    (await owner.post('/users', { name, role, email: `${name.toLowerCase()}@x.com`, password: 'password123', manager_id: manager, ...extra })).body;
  const ops = (await import('./helpers.js')).platform;
  await (await ops(app)).patch(`/platform/tenants/${owner.tenantId}`, { max_users: 20 });
  const dina = await add('Dina', 'manager');
  const mona = await add('Mona', 'manager', dina.id);
  const tala = await add('Tala', 'sales', mona.id);
  const rami = await add('Rami', 'sales', tala.id);
  const omar = await add('Omar', 'manager', dina.id);
  const sami = await add('Sami', 'sales', omar.id);
  const fadi = await add('Fadi', 'finance');
  const as = async (name: string): Promise<Client> =>
    client(app, (await login(app, `${name.toLowerCase()}@x.com`, 'password123', owner.slug)).json().token);
  const users = { dina, mona, tala, rami, omar, sami, fadi };
  const c = { owner, dina: await as('Dina'), mona: await as('Mona'), tala: await as('Tala'), rami: await as('Rami'),
              omar: await as('Omar'), sami: await as('Sami'), fadi: await as('Fadi') };
  // One definite booking owned by each person.
  const bookings: Record<string, string> = {};
  for (const [name, u] of Object.entries(users)) {
    if (name === 'fadi') continue;
    bookings[name] = (await owner.post('/bookings', { name: `${name} deal`, status: 'DEF', owner_id: u.id, manual_revenue: 1000 })).body.id;
  }
  return { users, c, bookings };
}

const visibleNames = async (c: Client) => (await c.get('/bookings?sort=booking_no')).body.rows.map((b: { name: string }) => b.name.split(' ')[0]).sort();

describe('team hierarchy', () => {
  it('lets each manager see everyone below them, at every level, and nobody beside or above', async () => {
    const { c } = await org();
    expect(await visibleNames(c.owner)).toEqual(['dina', 'mona', 'omar', 'rami', 'sami', 'tala']);
    expect(await visibleNames(c.dina)).toEqual(['dina', 'mona', 'omar', 'rami', 'sami', 'tala']);
    expect(await visibleNames(c.mona)).toEqual(['mona', 'rami', 'tala']);
    expect(await visibleNames(c.tala)).toEqual(['rami', 'tala']);
    expect(await visibleNames(c.rami)).toEqual(['rami']);
    expect(await visibleNames(c.omar)).toEqual(['omar', 'sami']);
    expect(await visibleNames(c.fadi)).toHaveLength(6); // finance sees the whole company
  });

  it('scopes booking details, dashboards and finance reports the same way', async () => {
    const { c, bookings } = await org();
    expect((await c.rami.get(`/bookings/${bookings.sami}`)).status).toBe(404);
    expect((await c.mona.get(`/bookings/${bookings.rami}`)).status).toBe(200);
    expect((await c.mona.patch(`/bookings/${bookings.omar}`, { name: 'x' })).status).toBe(404);
    const year = new Date().getFullYear();
    expect((await c.mona.get(`/reports/dashboard?year=${year}`)).body.kpis.revenue).toBe(3000);
    expect((await c.dina.get(`/reports/dashboard?year=${year}`)).body.kpis.revenue).toBe(6000);
    expect((await c.rami.get('/reports/receivables')).body.rows).toHaveLength(1);
    // Payments on another team's booking are invisible too.
    await c.owner.post(`/bookings/${bookings.sami}/payments`, { paid_on: '2026-01-01', amount: 100 });
    expect((await c.mona.get(`/bookings/${bookings.sami}`)).status).toBe(404);
    expect((await c.omar.get(`/bookings/${bookings.sami}`)).body.paid).toBe(100);
  });

  it('only lets people hand bookings to themselves or their team', async () => {
    const { c, users } = await org();
    expect((await c.mona.post('/bookings', { name: 'For Rami', owner_id: users.rami.id })).status).toBe(201);
    const outside = await c.mona.post('/bookings', { name: 'For Sami', owner_id: users.sami.id });
    expect(outside.status).toBe(403);
    expect(outside.body.error).toBe('You can only assign bookings to yourself or people in your team');
    const mine = (await c.rami.post('/bookings', { name: 'Mine' })).body;
    expect((await c.rami.patch(`/bookings/${mine.id}`, { owner_id: users.sami.id })).status).toBe(403);
    expect((await c.dina.patch(`/bookings/${mine.id}`, { owner_id: users.sami.id })).status).toBe(200);
  });

  it('still blocks double-booking a room held by another team, without revealing it', async () => {
    const { c } = await org();
    const { ballroom } = await makeVenue(c.owner);
    await c.sami.post('/bookings', { name: 'Sami secret gala', status: 'DEF', event_date: '2026-12-01', function_space_id: ballroom.id });
    const clash = await c.rami.post('/bookings', { name: 'Rami gala', status: 'DEF', event_date: '2026-12-01', function_space_id: ballroom.id });
    expect(clash.status).toBe(409);
    expect(clash.body.details.conflicts[0]).toMatchObject({ booking_name: "Another team's booking", booking_id: null, visible: false });
    const diary = (await c.rami.get('/diary?from=2026-12-01&to=2026-12-01')).body;
    expect(diary.events).toHaveLength(1);
    expect(diary.events[0]).toMatchObject({ name: 'Booked', booking_name: 'Another team', booking_id: null });
    expect((await c.omar.get('/diary?from=2026-12-01&to=2026-12-01')).body.events[0].booking_name).toBe('Sami secret gala');
  });

  it('keeps the tree free of loops and reports team membership', async () => {
    const { c, users } = await org();
    const loop = await c.owner.patch(`/users/${users.dina.id}`, { manager_id: users.rami.id });
    expect(loop.status).toBe(400);
    expect(loop.body.error).toContain('loop');
    expect((await c.owner.patch(`/users/${users.dina.id}`, { manager_id: users.dina.id })).status).toBe(400);
    const list = (await c.mona.get('/users')).body as { name: string; in_my_team: boolean }[];
    expect(list.filter((u) => u.in_my_team).map((u) => u.name).sort()).toEqual(['Mona', 'Rami', 'Tala']);
    const me = (await c.mona.get('/auth/me')).body;
    expect(me).toMatchObject({ sees_all: false, data_scope: 'team' });
    expect(me.team_ids).toHaveLength(3);
    // Moving Tala (with Rami) under Omar moves their bookings out of Mona's view.
    await c.owner.patch(`/users/${users.tala.id}`, { manager_id: users.omar.id });
    expect(await visibleNames(c.mona)).toEqual(['mona']);
    expect(await visibleNames(c.omar)).toEqual(['omar', 'rami', 'sami', 'tala']);
  });

  it('can widen a manager to the whole company', async () => {
    const { c, users } = await org();
    await c.owner.patch(`/users/${users.omar.id}`, { data_scope: 'all' });
    expect(await visibleNames(c.omar)).toHaveLength(6);
  });
});
