import { createCanvas } from '@napi-rs/canvas';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant, type Client, book } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await pool.end(); });

/** A small real PNG and a one-page PDF, so the viewer has something to draw. */
const pngCanvas = createCanvas(40, 30);
pngCanvas.getContext('2d').fillRect(0, 0, 40, 30);
const PNG = pngCanvas.toBuffer('image/png');
function onePagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 40 100 Td (Contract) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => { const at = body.length; body += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

async function upload(c: Client, url: string, data: Buffer, name: string) {
  const boundary = '----saaserp-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: 'POST', url: `/api${url}`, payload,
    headers: { authorization: `Bearer ${c.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return { status: res.statusCode, body: res.json() };
}

async function person(owner: Client & { slug: string }, name: string, role: string, extra: Record<string, unknown> = {}) {
  const email = `${name.toLowerCase()}-${owner.slug}@example.com`;
  const u = (await owner.post('/users', { name, email, role, password: 'password123', ...extra })).body;
  return { user: u, c: client(app, (await login(app, email, 'password123', owner.slug)).json().token) };
}

describe('levels, departments and data rights', () => {
  it('gives every person a level and department, with rights per level', async () => {
    const owner = await newTenant(app);
    const depts = (await owner.get('/departments')).body;
    expect(depts.map((d: { name: string }) => d.name)).toEqual(['Management', 'Sales', 'Marketing', 'Finance', 'Operations', 'Partners', 'HR']);
    const sales = depts.find((d: { name: string }) => d.name === 'Sales');

    const { user: ali, c: aliC } = await person(owner, 'Ali', 'sales', { department_id: sales.id });
    expect(ali).toMatchObject({ level: 5, department_id: sales.id });
    const me = (await aliC.get('/auth/me')).body;
    expect(me).toMatchObject({ level: 5, department: 'Sales', rights: { export: false, download: false, print: false, hr: false } });
    expect((await owner.get('/auth/me')).body.rights).toEqual({ export: true, download: true, print: true, hr: true });

    // Export is refused on the server, not just hidden.
    expect((await aliC.get('/reports/contracts.xlsx?year=2026')).status).toBe(403);
    expect((await aliC.get('/reports/daily-activity?format=xlsx')).status).toBe(403);
    expect((await owner.get('/reports/contracts.xlsx?year=2026')).status).toBe(200);

    // The workspace changes level 5; a personal exception goes on top.
    expect((await owner.put('/permissions', { 5: { export: true } })).status).toBe(200);
    expect((await aliC.get('/auth/me')).body.rights.export).toBe(true);
    await owner.patch(`/users/${ali.id}`, { permission_overrides: { export: false } });
    expect((await aliC.get('/auth/me')).body.rights.export).toBe(false);

    // Nobody but an owner changes their own level or rights.
    const { user: admin, c: adminC } = await person(owner, 'Rana', 'admin');
    expect((await adminC.patch(`/users/${admin.id}`, { level: 1, job_title: 'IT' })).status).toBe(200); // unchanged level is fine
    expect((await adminC.patch(`/users/${admin.id}`, { permission_overrides: { download: false } })).status).toBe(400);
    expect((await aliC.put('/permissions', { 5: { download: true } })).status).toBe(403);

    expect((await owner.post('/departments', { name: 'Sales' })).status).toBe(409);
    expect((await owner.post('/departments', { name: 'Events' })).status).toBe(200);
  });

  it('shows documents to view-only people as watermarked pages, never the file', async () => {
    const owner = await newTenant(app);
    const { c: sara } = await person(owner, 'Sara', 'sales');
    const b = (await book(sara, { name: 'Hessa wedding', status: 'TEN' })).body;
    const pdf = (await upload(sara, `/bookings/${b.id}/files?kind=signed_proposal`, onePagePdf(), 'proposal.pdf')).body;
    const photo = (await upload(sara, `/bookings/${b.id}/files?kind=other`, PNG, 'photo.png')).body;

    // Level 5 by default: no download …
    expect((await sara.get(`/booking-files/${pdf.id}/link`)).status).toBe(403);
    // … but the viewer works, page by page, with a short-lived token.
    const view = (await sara.get(`/viewer/file/${pdf.id}`)).body;
    expect(view).toMatchObject({ title: 'proposal.pdf', pages: 1, rights: { download: false, print: false } });
    const page = await app.inject({ method: 'GET', url: `/api/viewer/page?t=${encodeURIComponent(view.token)}&n=1` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('image/png');
    expect(page.headers['cache-control']).toContain('no-store');
    expect(page.rawPayload.subarray(1, 4).toString()).toBe('PNG');

    const img = (await sara.get(`/viewer/file/${photo.id}`)).body;
    expect(img.pages).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/viewer/page?t=${encodeURIComponent(img.token)}&n=1` })).statusCode).toBe(200);

    // A tampered token is refused; the view is logged for the admins.
    const bad = await app.inject({ method: 'GET', url: `/api/viewer/page?t=${encodeURIComponent(view.token.replace(/.$/, 'x'))}&n=1` });
    expect(bad.statusCode).toBe(400);
    const log = (await owner.get('/it/status')).body.access_log;
    expect(log.some((l: { action: string; detail: string }) => l.action === 'view_document' && l.detail === 'proposal.pdf')).toBe(true);

    // The owner downloads as before.
    expect((await owner.get(`/booking-files/${pdf.id}/link`)).status).toBe(200);
  });

  it('keeps contract views per person and exports a pivot only with the export right', async () => {
    const owner = await newTenant(app);
    const { c: sara } = await person(owner, 'Sara', 'sales');
    const table = { title: 'Pivot', header: ['AM', 'Total'], rows: [['SAR', 3], ['Total', 3]], bold: [1] };

    expect((await sara.post('/reports/table.xlsx', table)).status).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/api/reports/table.xlsx', payload: table, headers: { authorization: `Bearer ${owner.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    // A whole year loads at once.
    expect((await sara.get('/bookings?limit=5000')).status).toBe(200);

    // Saved views live with the person's own preferences.
    const views = { layout: { mode: 'pivot' }, views: [{ name: 'My open enquiries', filters: [{ id: 'status', value: ['ENQ'] }] }] };
    expect((await sara.patch('/me/preferences', { contract_list: views })).body.contract_list).toEqual(views);
    expect((await sara.get('/auth/me')).body.preferences.contract_list).toEqual(views);
    expect((await owner.get('/auth/me')).body.preferences.contract_list).toBeUndefined();
  });

  it('lets only admins save contract views, for everyone', async () => {
    const owner = await newTenant(app);
    const { c: sara } = await person(owner, 'Sara', 'sales');
    const views = { standard: 'Sales', views: [{ name: 'Sales', order: ['booking_no'], visible: { booking_no: true }, sorting: [], filters: [] }] };
    expect((await sara.patch('/tenant', { contract_views: views })).status).toBe(403);
    expect((await owner.patch('/tenant', { contract_views: views })).status).toBe(200);
    expect((await sara.get('/auth/me')).body.tenant.contract_views).toEqual(views);
  });
});
