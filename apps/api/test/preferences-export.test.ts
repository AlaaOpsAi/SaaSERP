import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('language and appearance', () => {
  it('stores personal preferences and company defaults', async () => {
    const c = await newTenant(app);
    const prefs = await c.patch('/me/preferences', { locale: 'ar', theme: 'dark', accent: '#7c3aed', density: 'compact', fontScale: 1.1 });
    expect(prefs.body).toEqual({ locale: 'ar', theme: 'dark', accent: '#7c3aed', density: 'compact', fontScale: 1.1 });
    // Partial update keeps the rest; null removes a key.
    expect((await c.patch('/me/preferences', { accent: null })).body).toEqual({ locale: 'ar', theme: 'dark', density: 'compact', fontScale: 1.1 });
    expect((await c.patch('/me/preferences', { accent: 'purple' })).status).toBe(400);
    expect((await c.patch('/me/preferences', { locale: 'Arabic' })).status).toBe(400);

    await c.patch('/tenant', { default_locale: 'ar', branding: { accent: '#0f766e' } });
    const me = (await c.get('/auth/me')).body;
    expect(me.preferences.locale).toBe('ar');
    expect(me.tenant).toMatchObject({ default_locale: 'ar', branding: { accent: '#0f766e' } });
  });

  it('gives default pick-lists Arabic labels and lets admins translate', async () => {
    const c = await newTenant(app);
    const lookups = (await c.get('/lookups')).body;
    expect(lookups.source.find((l: any) => l.code === 'INSTA').translations).toEqual({ ar: 'إنستغرام' });
    const created = (await c.post('/lookups', { type: 'source', code: 'EXPO', label: 'Wedding expo', translations: { ar: 'معرض الأعراس', fr: 'Salon du mariage' } })).body;
    expect(created.translations).toEqual({ ar: 'معرض الأعراس', fr: 'Salon du mariage' });
    const patched = (await c.patch(`/lookups/${created.id}`, { translations: { ar: 'معرض' } })).body;
    expect(patched.translations).toEqual({ ar: 'معرض' });
  });
});

describe('full workspace export', () => {
  it('exports every table and the permissions, never passwords, admins only, and tells the owners', async () => {
    const owner = await newTenant(app);
    await owner.post('/users', { name: 'Ada Admin', email: 'ada@x.com', role: 'admin', password: 'password123' });
    await owner.post('/users', { name: 'Sam Sales', email: 'sam@x.com', role: 'sales', password: 'password123' });
    await owner.post('/bookings', { name: 'Exported wedding', status: 'DEF', manual_revenue: 1000, contact: { name: 'Mona', phone: '1' } });
    const ada = client(app, (await login(app, 'ada@x.com', 'password123', owner.slug)).json().token);
    const sam = client(app, (await login(app, 'sam@x.com', 'password123', owner.slug)).json().token);

    expect((await sam.get('/export/workspace')).status).toBe(403);

    const json = await ada.get('/export/workspace?format=json');
    expect(json.status).toBe(200);
    const t = json.body.tables;
    expect(Object.keys(t)).toEqual(expect.arrayContaining(['workspace', 'users', 'lookups', 'bookings', 'contacts', 'payments',
      'activities', 'delegations', 'user_permissions', 'role_permissions', 'booking_log']));
    expect(JSON.stringify(json.body)).not.toContain('scrypt$');
    expect(t.users.every((u: any) => !('password_hash' in u))).toBe(true);
    expect(t.bookings[0]).toMatchObject({ name: 'Exported wedding', revenue: 1000 });
    expect(t.role_permissions.find((r: any) => r.action.startsWith('Record payments'))).toMatchObject({ finance: 'yes', sales: '—' });
    expect(t.user_permissions.find((u: any) => u.user === 'Sam Sales')).toMatchObject({ role: 'sales', sees: 'own + team' });

    const xlsx = await app.inject({ method: 'GET', url: '/api/export/workspace', headers: { authorization: `Bearer ${ada.token}` } });
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['README', 'users', 'bookings', 'lookups', 'role_permissions']));
    expect(wb.getWorksheet('bookings')!.rowCount).toBe(2);

    const bell = (await owner.get('/notifications')).body;
    expect(bell.items[0].text).toContain('Ada Admin exported the full workspace data');
  });
});
