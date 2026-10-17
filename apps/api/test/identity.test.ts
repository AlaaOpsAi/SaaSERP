import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant, type Client } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await pool.end(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const BAD_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function put(c: Client, url: string, data: Buffer) {
  const boundary = '----saaserp-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'PUT', url: `/api${url}`, payload,
    headers: { authorization: `Bearer ${c.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('employee ID, name card and company identity', () => {
  it('gives 3-digit employee IDs and signs in with the employee ID', async () => {
    const owner = await newTenant(app);
    const sara = (await owner.post('/users', {
      name: 'Sara Ali', email: `sara-${owner.slug}@example.com`, role: 'sales', password: 'password123', hired_on: '2021-03-01', job_title: 'Account manager',
    })).body;
    expect(sara.employee_no).toMatch(/^E2021\d{3}$/);

    // Employee IDs repeat across workspaces, so the workspace may be needed; here it's given.
    const res = await login(app, sara.employee_no.toLowerCase(), 'password123', owner.slug);
    expect(res.statusCode).toBe(200);
    const me = (await client(app, res.json().token).get('/auth/me')).body;
    expect(me).toMatchObject({ name: 'Sara Ali', job_title: 'Account manager', employee_no: sara.employee_no });

    expect((await login(app, sara.employee_no, 'wrong-password', owner.slug)).statusCode).toBe(401);
    expect((await login(app, 'not-an-id', 'password123', owner.slug)).statusCode).toBe(400);
  });

  it("shows the company's colour and logo, falling back to the group logo", async () => {
    const owner = await newTenant(app);
    const unit = (await owner.post('/business-units', { code: 'WX', name: 'WED-X', accent: '#E6007E' })).body;
    const user = (await owner.post('/users', {
      name: 'Lina', email: `lina-${owner.slug}@example.com`, password: 'password123', business_unit_id: unit.id,
    })).body;
    const lina = client(app, (await login(app, user.email, 'password123', owner.slug)).json().token);

    let me = (await lina.get('/auth/me')).body;
    expect(me.company).toMatchObject({ code: 'WX', accent: '#E6007E' });
    expect(me.logo).toEqual({ light: null, dark: null });

    // Group logo first: everyone without a company logo sees it, in both themes.
    expect((await put(owner, '/logos/group/light', PNG)).status).toBe(200);
    me = (await lina.get('/auth/me')).body;
    expect(me.logo.light).toMatch(new RegExp(`^/api/logos/${owner.tenantId}/group/light\\?v=`));
    expect(me.logo.dark).toBe(me.logo.light);

    // The company's own logo replaces it.
    expect((await put(owner, `/logos/${unit.id}/dark`, SVG)).status).toBe(200);
    me = (await lina.get('/auth/me')).body;
    expect(me.logo.dark).toContain(`/${unit.id}/dark`);

    // The image is public and cached; an SVG can't run anything.
    const img = await app.inject({ method: 'GET', url: me.logo.dark });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/svg+xml');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(img.headers['cache-control']).toContain('immutable');

    expect((await put(owner, `/logos/${unit.id}/light`, BAD_SVG)).status).toBe(400);
    expect((await put(owner, '/logos/group/light', Buffer.from('hello'))).status).toBe(400);
    expect((await put(lina, '/logos/group/light', PNG)).status).toBe(403);
    expect((await owner.patch(`/users/${user.id}`, { business_unit_id: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    // An update changes only what it sends: the role and status stay.
    const updated = (await owner.patch(`/users/${user.id}`, { job_title: 'Planner' })).body;
    expect(updated).toMatchObject({ job_title: 'Planner', role: 'sales', is_active: true });
    expect((await owner.patch(`/users/${user.id}`, { role: 'manager' })).body.role).toBe('manager');
    expect((await owner.patch(`/users/${user.id}`, { job_title: 'Lead planner' })).body.role).toBe('manager');
  });
});
