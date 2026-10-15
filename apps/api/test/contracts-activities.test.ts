import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant, type Client } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function withSales(owner: Client & { slug: string }, dataScope: 'all' | 'team' = 'all') {
  await owner.post('/users', { name: 'Sara Sales', email: 'sara@x.com', code: 'SAR', role: 'sales', password: 'password123', data_scope: dataScope });
  return client(app, (await login(app, 'sara@x.com', 'password123', owner.slug)).json().token);
}

describe('contract fields of the new daily report', () => {
  it('stores branch, design, split client name and computes the DIFF CTRL', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', {
      name: 'Wedding', status: 'DEF', branch: 'RB', design: 'WX12', contract_value: 2000,
      contact: { first_name: 'Latifa', family_name: 'Al Ali', phone: '6623', social_handle: '@latifa', nationality: 'KUWAIT', address: 'Salmiya' },
    })).body;
    expect(b).toMatchObject({ branch: 'RB', design: 'WX12', contact_name: 'Latifa Al Ali', contact_first_name: 'Latifa',
      contact_family_name: 'Al Ali', contact_social_handle: '@latifa', contact_nationality: 'KUWAIT', diff_ctrl: -2000 });

    // Renaming keeps the display name in step.
    await c.patch(`/contacts/${b.contact_id}`, { family_name: 'Al Sabah' });
    expect((await c.get(`/bookings/${b.id}`)).body.contact_name).toBe('Latifa Al Sabah');
  });

  it('lets sales record the down payment, but never while covering', async () => {
    const owner = await newTenant(app);
    const sara = await withSales(owner);
    const b = (await sara.post('/bookings', { name: 'Henna night', status: 'DEF', contract_value: 1500 })).body;
    const dp = await sara.post(`/bookings/${b.id}/down-payment`, { paid_on: '2026-10-01', amount: 500 });
    expect(dp.status).toBe(200);
    expect(dp.body.kind).toBe('deposit');
    expect((await sara.post(`/bookings/${b.id}/down-payment`, { paid_on: '2026-10-01', amount: -5 })).status).toBe(400);
    const after = (await sara.get(`/bookings/${b.id}`)).body;
    expect(after.paid).toBe(500);
    expect(after.diff_ctrl).toBe(-1000);
    // Other receipts are still finance's job.
    expect((await sara.post(`/bookings/${b.id}/payments`, { paid_on: '2026-10-02', amount: 100 })).status).toBe(403);
  });
});

describe('fields hidden per role', () => {
  it('hides the finance columns from sales by default, in the API, on writes and in the Excel export', async () => {
    const owner = await newTenant(app);
    const sara = await withSales(owner);
    const b = (await owner.post('/bookings', { name: 'Gala', status: 'DEF', manual_revenue: 1000, manual_cost: 400, owner_id: null })).body;
    expect(b.net_profit).not.toBeNull();

    const seen = (await sara.get(`/bookings/${b.id}`)).body;
    expect(seen).toMatchObject({ revenue: null, cost: null, net_profit: null, commission: null, outstanding: null, items: [], payouts: [] });
    expect(seen.name).toBe('Gala');
    const list = (await sara.get('/bookings')).body;
    expect(list.rows[0].revenue).toBeNull();
    expect(list.totals.revenue).toBeNull();
    expect((await sara.get('/auth/me')).body.hidden_fields).toEqual(['finance']);

    // Hidden fields are ignored on writes.
    await sara.patch(`/bookings/${b.id}`, { manual_revenue: 1, pax: 90 });
    const now = (await owner.get(`/bookings/${b.id}`)).body;
    expect(now.revenue).toBe(1000);
    expect(now.pax).toBe(90);

    const xlsx = await app.inject({ method: 'GET', url: '/api/reports/contracts.xlsx?year=' + new Date().getFullYear(), headers: { authorization: `Bearer ${sara.token}` } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const headers = (wb.getWorksheet('CONTRACTS')!.getRow(1).values as unknown[]).filter(Boolean);
    expect(headers).toEqual(expect.arrayContaining(['CONTRACT ID', 'BRANCH', 'TOTAL CONTRACT VALUE', 'MONEY RECEIVED DP', 'DESIGN']));
    expect(headers).not.toContain('NET PROFIT');
    expect(headers).not.toContain('REV');
  });

  it('lets the admin hide source and account manager per role; owners always see all', async () => {
    const owner = await newTenant(app);
    const sara = await withSales(owner);
    const b = (await sara.post('/bookings', { name: 'Birthday', source: 'INSTA' })).body;
    expect((await sara.patch('/tenant', { field_visibility: { sales: ['source'] } })).status).toBe(403);
    expect((await owner.patch('/tenant', { field_visibility: { sales: ['source', 'owner', 'finance'] } })).status).toBe(200);
    expect((await owner.patch('/tenant', { field_visibility: { sales: ['salary'] } })).status).toBe(400);

    const seen = (await sara.get(`/bookings/${b.id}`)).body;
    expect(seen.source).toBeNull();
    expect(seen.owner_name).toBeNull();
    // Changing a hidden field is ignored, so the value stays.
    await sara.patch(`/bookings/${b.id}`, { source: 'CALL' });
    expect((await owner.get(`/bookings/${b.id}`)).body).toMatchObject({ source: 'INSTA', owner_name: 'Sara Sales' });
  });

  it('stores the home-screen icon order', async () => {
    const owner = await newTenant(app);
    await owner.patch('/tenant', { home_order: ['contracts', 'dashboard', 'crm'] });
    expect((await owner.get('/auth/me')).body.tenant.home_order).toEqual(['contracts', 'dashboard', 'crm']);
  });
});

describe('meetings and the daily activity report', () => {
  it('requires a meeting outcome and reports each salesperson\'s day', async () => {
    const owner = await newTenant(app);
    const sara = await withSales(owner, 'team');
    const b = (await sara.post('/bookings', { name: 'Engagement', contact: { name: 'Noura', phone: '9' } })).body;
    const now = new Date();
    const meeting = (await sara.post('/activities', { booking_id: b.id, type: 'meeting', subject: 'Venue tour', due_at: now.toISOString(), location: 'Radisson' })).body;
    const call = (await sara.post('/activities', { booking_id: b.id, type: 'call', subject: 'Price call', due_at: now.toISOString() })).body;
    await sara.post('/activities', { booking_id: b.id, type: 'followup', subject: 'Old one', due_at: new Date(now.getTime() - 3 * 86400_000).toISOString() });

    expect((await sara.post(`/activities/${meeting.id}/complete`, {})).status).toBe(400);
    expect((await sara.post(`/activities/${meeting.id}/complete`, { outcome: 'Liked the ballroom, sending quote' })).status).toBe(200);
    expect((await sara.post(`/activities/${call.id}/complete`, {})).status).toBe(200);

    const meetings = (await sara.get('/activities?scope=all&state=all&type=meeting,site_visit')).body;
    expect(meetings.map((m: any) => m.subject)).toEqual(['Venue tour']);

    const report = (await owner.get('/reports/daily-activity')).body;
    const row = report.people.find((p: any) => p.name === 'Sara Sales');
    expect(row).toMatchObject({ calls: 1, meetings: 1, done: 2, overdue: 1, new_contracts: 1 });
    expect(row.items.find((i: any) => i.type === 'meeting')).toMatchObject({ outcome: 'Liked the ballroom, sending quote', booking_no: b.booking_no, contact_name: 'Noura' });

    // A salesperson only sees themselves (and their team).
    const own = (await sara.get('/reports/daily-activity')).body;
    expect(own.people.map((p: any) => p.name)).toEqual(['Sara Sales']);

    const xlsx = await app.inject({ method: 'GET', url: '/api/reports/daily-activity?format=xlsx', headers: { authorization: `Bearer ${owner.token}` } });
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Details']);
  });
});
