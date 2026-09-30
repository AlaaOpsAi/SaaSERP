import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool } from '../src/db.js';
import { makeApp, makeVenue, newTenant } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('booking numbers', () => {
  it('numbers bookings per business unit and event year', async () => {
    const c = await newTenant(app);
    const x = (await c.post('/business-units', { code: 'X', name: 'CONFX' })).body;
    const n = async (payload: object) => (await c.post('/bookings', { name: 'b', ...payload })).body.booking_no;
    expect(await n({ event_date: '2026-03-01' })).toBe('W2026001');
    expect(await n({ event_date: '2026-05-01' })).toBe('W2026002');
    expect(await n({ event_date: '2027-01-15' })).toBe('W2027001');
    expect(await n({ event_date: '2026-05-01', business_unit_id: x.id })).toBe('X2026001');
  });
});

describe('finance (daily report formulas)', () => {
  it('computes margin, overheads, net profit, commission, shares and outstanding', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Gala', status: 'DEF', event_date: '2026-02-01', credit_facility: true })).body;
    await c.post(`/bookings/${b.id}/items`, { description: 'Dinner', quantity: 100, unit_price: 8, unit_cost: 5 });
    await c.post(`/bookings/${b.id}/items`, { description: 'Flowers', quantity: 1, unit_price: 200, unit_cost: 100 });
    await c.post(`/bookings/${b.id}/payouts`, { kind: 'commission', payee_name: 'AM', pct: 0.1 });
    await c.post(`/bookings/${b.id}/payouts`, { kind: 'share', payee_name: 'Partner', pct: 0.5 });

    const d = (await c.get(`/bookings/${b.id}`)).body;
    expect(d.revenue).toBe(1000);
    expect(d.cost).toBe(600);
    expect(d.gross_margin).toBe(400);
    expect(d.margin_pct).toBe(0.4);
    expect(d.fixed_cost).toBe(80); // 20% of GM
    expect(d.cf_cost).toBe(80); // 20% of GM, credit facility
    expect(d.net_profit).toBe(240);
    expect(d.commission).toBe(24);
    expect(d.shares).toBe(108); // 50% of (240 - 24)
    expect(d.payouts.map((p: any) => p.amount).sort()).toEqual([108, 24]);
    expect(d.outstanding).toBe(1000);

    await c.post(`/bookings/${b.id}/payments`, { paid_on: '2026-02-10', amount: 600 });
    expect((await c.get(`/bookings/${b.id}`)).body.outstanding).toBe(400);
    expect((await c.get(`/bookings/${b.id}`)).body.fully_paid_date).toBeNull();
    await c.post(`/bookings/${b.id}/payments`, { paid_on: '2026-02-20', amount: 400 });
    const paid = (await c.get(`/bookings/${b.id}`)).body;
    expect(paid.outstanding).toBe(0);
    expect(paid.fully_paid_date).toBe('2026-02-20');
    expect(paid.aging_days).toBe(19);
  });

  it('uses manual figures without lines and applies tenant percentages', async () => {
    const c = await newTenant(app);
    await c.patch('/tenant', { fixed_cost_pct: 0.1 });
    const b = (await c.post('/bookings', {
      name: 'Manual', status: 'DEF', manual_revenue: 500, manual_cost: 300, contract_value: 450,
    })).body;
    expect(b.gross_margin).toBe(200);
    expect(b.fixed_cost).toBe(20);
    expect(b.cf_cost).toBe(0);
    expect(b.net_profit).toBe(180);
    expect(b.diff).toBe(50);
    expect(b.outstanding).toBe(450); // contract value is what the client owes
  });
});

describe('status workflow', () => {
  it('requires reasons, blocks invalid moves and records history', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Lead' })).body;
    expect(b.status).toBe('INQ');
    expect((await c.post(`/bookings/${b.id}/status`, { status: 'LOS' })).status).toBe(400);
    const lost = await c.post(`/bookings/${b.id}/status`, { status: 'LOS', reason: 'BUDGET' });
    expect(lost.body.lost_reason).toBe('BUDGET');
    expect((await c.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(400);
    await c.post(`/bookings/${b.id}/status`, { status: 'TEN' });
    const def = (await c.post(`/bookings/${b.id}/status`, { status: 'DEF' })).body;
    expect(def.history.map((h: any) => h.to_status)).toEqual(['INQ', 'LOS', 'TEN', 'DEF']);
  });
});

describe('function diary conflicts', () => {
  it('prevents double-booking an exclusive room but allows shareable spaces', async () => {
    const c = await newTenant(app);
    const { ballroom, garden } = await makeVenue(c);
    const first = await c.post('/bookings', { name: 'First', status: 'DEF', event_date: '2026-06-01', function_space_id: ballroom.id });
    expect(first.status).toBe(201);
    expect(first.body.events).toHaveLength(1);
    expect(first.body.venue_id).toBe(ballroom.venue_id);

    const clash = await c.post('/bookings', { name: 'Clash', status: 'DEF', event_date: '2026-06-01', function_space_id: ballroom.id });
    expect(clash.status).toBe(409);
    expect(clash.body.details.conflicts[0].booking_no).toBe(first.body.booking_no);

    // Tentative holds are allowed and flagged on the diary, but cannot go definite.
    const ten = (await c.post('/bookings', { name: 'Tentative', status: 'TEN', event_date: '2026-06-01', function_space_id: ballroom.id })).body;
    expect(ten.conflicts).toHaveLength(1);
    expect((await c.post(`/bookings/${ten.id}/status`, { status: 'DEF' })).status).toBe(409);
    // Managers (owner) may force it.
    expect((await c.post(`/bookings/${ten.id}/status`, { status: 'DEF', force: true })).status).toBe(200);

    const g1 = await c.post('/bookings', { name: 'G1', status: 'DEF', event_date: '2026-06-01', function_space_id: garden.id });
    const g2 = await c.post('/bookings', { name: 'G2', status: 'DEF', event_date: '2026-06-01', function_space_id: garden.id });
    expect([g1.status, g2.status]).toEqual([201, 201]);

    const diary = (await c.get('/diary?from=2026-06-01&to=2026-06-01')).body;
    expect(diary.spaces).toHaveLength(2);
    expect(diary.events.filter((e: any) => e.function_space_id === ballroom.id && e.overlaps)).toHaveLength(2);
  });

  it('checks conflicts when events are moved on a definite booking', async () => {
    const c = await newTenant(app);
    const { ballroom } = await makeVenue(c);
    await c.post('/bookings', { name: 'Holder', status: 'DEF', event_date: '2026-07-01', function_space_id: ballroom.id });
    const other = (await c.post('/bookings', { name: 'Other', status: 'DEF' })).body;
    const clash = await c.post(`/bookings/${other.id}/events`, {
      name: 'Dinner', function_space_id: ballroom.id,
      start_at: '2026-07-01T20:00:00+03:00', end_at: '2026-07-01T22:00:00+03:00',
    });
    expect(clash.status).toBe(409);
    const ok = await c.post(`/bookings/${other.id}/events`, {
      name: 'Lunch', function_space_id: ballroom.id,
      start_at: '2026-07-01T12:00:00+03:00', end_at: '2026-07-01T15:00:00+03:00',
    });
    expect(ok.status).toBe(200);
    const moved = await c.patch(`/booking-events/${ok.body.id}`, { end_at: '2026-07-01T19:00:00+03:00' });
    expect(moved.status).toBe(409);
  });
});

describe('activities and reports', () => {
  it('keeps follow-up dates in sync and reports conversion', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Follow me', event_date: '2026-09-09' })).body;
    const act = (await c.post('/activities', {
      booking_id: b.id, type: 'call', subject: 'Call back', due_at: '2026-01-05T10:00:00+03:00',
    })).body;
    expect((await c.get(`/bookings/${b.id}`)).body.next_followup_date).toBe('2026-01-05');
    expect((await c.get('/bookings?followup_due=true')).body.rows).toHaveLength(1);
    await c.post(`/activities/${act.id}/complete`, { outcome: 'Wants a quote' });
    const after = (await c.get(`/bookings/${b.id}`)).body;
    expect(after.next_followup_date).toBeNull();
    expect(after.last_followup_date).not.toBeNull();

    await c.post('/bookings', { name: 'Won', status: 'DEF', event_date: '2026-09-10', manual_revenue: 1000, manual_cost: 400 });
    const lost = (await c.post('/bookings', { name: 'Gone', event_date: '2026-09-11' })).body;
    await c.post(`/bookings/${lost.id}/status`, { status: 'LOS', reason: 'PRICE' });

    const dash = (await c.get('/reports/dashboard?year=2026')).body;
    expect(dash.kpis.total).toBe(3);
    expect(dash.kpis.definite).toBe(1);
    expect(dash.kpis.revenue).toBe(1000);
    expect(dash.kpis.conversion_rate).toBeCloseTo(1 / 3);
    expect(dash.kpis.win_rate).toBe(0.5);
    expect(dash.lost_reasons).toEqual([{ reason: 'Price too high', total: 1 }]);
    expect(dash.by_month[8].total).toBe(3);

    const xlsx = await app.inject({ method: 'GET', url: '/api/reports/contracts.xlsx?year=2026', headers: { authorization: `Bearer ${c.token}` } });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
