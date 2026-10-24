import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { client, login, makeApp, newTenant, platform, type Client } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await pool.end(); });

type Owner = Client & { slug: string; tenantId: string };

async function person(owner: Owner, name: string, role: string, extra: Record<string, unknown> = {}) {
  const email = `${name.toLowerCase()}-${owner.slug}@example.com`;
  const u = (await owner.post('/users', { name, email, role, password: 'password123', ...extra })).body;
  return { user: u, c: client(app, (await login(app, email, 'password123', owner.slug)).json().token) };
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

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('modules', () => {
  it('gives HR basic to everyone and HR full after a request the operator grants', async () => {
    const owner = await newTenant(app);
    expect((await owner.get('/auth/me')).body.tenant.modules).toEqual(['contracts']);
    expect((await owner.get('/hr/employees')).body.tier).toBe('basic');
    const blocked = await owner.get('/hr/expiring');
    expect(blocked.status).toBe(403);
    expect(blocked.body.details).toEqual({ module: 'hr' });

    const { c: sara } = await person(owner, 'Sara', 'sales');
    expect((await sara.post('/modules/hr/request', {})).status).toBe(403);
    expect((await owner.post('/modules/hr/request', { note: 'For 89 employees' })).status).toBe(200);
    expect((await owner.post('/modules/hr/request', {})).status).toBe(409);
    expect((await owner.get('/modules')).body.modules.find((m: any) => m.key === 'hr')).toMatchObject({ active: false, requested: true });

    const ops = await platform(app);
    const t = (await ops.get('/platform/tenants')).body.tenants.find((x: any) => x.id === owner.tenantId);
    expect(t.requested_modules).toEqual(['hr']);
    expect((await ops.put(`/platform/tenants/${owner.tenantId}/modules`, { modules: ['contracts', 'hr'] })).body.modules).toEqual(['contracts', 'hr']);

    expect((await owner.get('/modules')).body.modules.find((m: any) => m.key === 'hr')).toMatchObject({ active: true, requested: false });
    expect((await owner.get('/hr/employees')).body.tier).toBe('full');
    expect((await owner.get('/hr/expiring')).status).toBe(200);
    const bell = (await owner.get('/notifications')).body;
    expect(JSON.stringify(bell)).toContain('Module now active: HR');
  });
});

describe('module tiers', () => {
  it('needs the Contracts subscription for contracts, while HR basic keeps working', async () => {
    const owner = await newTenant(app);
    const depts = (await owner.get('/departments')).body;
    const { c: hana } = await person(owner, 'Hana', 'sales', { department_id: depts.find((d: any) => d.name === 'HR').id });
    const { user: ali, c: aliC } = await person(owner, 'Ali', 'sales');

    // HR basic: the directory lists sign-ins without a record; HR adds job fields only.
    const dir = (await hana.get('/hr/employees')).body;
    expect(dir).toMatchObject({ tier: 'basic', can_edit: true });
    expect(dir.employees.map((e: any) => e.first_name)).toEqual(expect.arrayContaining(['Hana', 'Ali']));
    const rec = (await hana.post('/hr/employees', { user_id: ali.id, first_name: 'Ali', position: 'Coordinator', status: 'active', salary: 900, civil_id: '123', work_phone: '2222' })).body;
    const view = (await hana.get(`/hr/employees/${rec.id}`)).body;
    expect(view).toMatchObject({ tier: 'basic', position: 'Coordinator', work_phone: '2222', documents: [] });
    expect(view.salary).toBeUndefined();
    expect(view.civil_id).toBeUndefined();
    expect((await aliC.get(`/hr/employees/${rec.id}`)).status).toBe(200);
    expect((await aliC.post(`/hr/employees/${rec.id}/requests`, { text: 'please update' })).status).toBe(403);
    expect((await hana.post('/hr/alerts/run')).status).toBe(403);

    // Without Contracts: contract pages are refused, HR basic still works.
    await (await platform(app)).put(`/platform/tenants/${owner.tenantId}/modules`, { modules: [] });
    const refused = await owner.get('/bookings');
    expect(refused.status).toBe(403);
    expect(refused.body.details).toEqual({ module: 'contracts' });
    expect((await owner.get('/reports/dashboard?year=2026')).status).toBe(403);
    expect((await owner.get('/hr/employees')).status).toBe(200);
    expect((await owner.get('/users')).status).toBe(200);
  });
});

describe('HR records', () => {
  async function hrWorkspace() {
    const owner = await newTenant(app);
    const ops = await platform(app);
    await ops.put(`/platform/tenants/${owner.tenantId}/modules`, { modules: ['contracts', 'hr'] });
    await ops.patch(`/platform/tenants/${owner.tenantId}`, { max_users: 20 });
    return owner;
  }

  it('shows each person only what their level allows, and only HR edits', async () => {
    const owner = await hrWorkspace();
    const depts = (await owner.get('/departments')).body;
    const hrDept = depts.find((d: any) => d.name === 'HR');
    const { c: hana } = await person(owner, 'Hana', 'sales', { department_id: hrDept.id });
    const { c: mona, user: monaUser } = await person(owner, 'Mona', 'manager', { level: 4 });
    const { c: ali, user: aliUser } = await person(owner, 'Ali', 'sales', { manager_id: monaUser.id });
    const { c: dina } = await person(owner, 'Dina', 'manager', { level: 3 });
    const { c: omar } = await person(owner, 'Omar', 'sales');

    // People in the HR department have the HR right without being admins.
    expect((await hana.get('/auth/me')).body.rights.hr).toBe(true);
    expect((await ali.get('/auth/me')).body.rights.hr).toBe(false);

    const created = await hana.post('/hr/employees', {
      user_id: aliUser.id, first_name: 'Ali', last_name: 'Saleh', position: 'Sales coordinator', status: 'active',
      salary: 900, allowance_housing: 150, chronic_illness: 'Asthma',
      emergency_contacts: [{ name: 'Sami', relation: 'Brother', address: null, phone: '99887766' }],
    });
    expect(created.status).toBe(200);
    expect(created.body.employee_no).toBe(aliUser.employee_no);
    const id = created.body.id;
    expect((await ali.post('/hr/employees', { first_name: 'X', status: 'active' })).status).toBe(403);

    const view = async (c: Client) => (await c.get(`/hr/employees/${id}`));
    // HR: everything.
    expect((await view(hana)).body).toMatchObject({ salary: 900, chronic_illness: 'Asthma', access: { edit: true } });
    // Level 3: pay, not health.
    expect((await view(dina)).body).toMatchObject({ salary: 900, chronic_illness: null, access: { edit: false } });
    // His manager (level 4): the record, no pay, no health.
    expect((await view(mona)).body).toMatchObject({ first_name: 'Ali', salary: null, allowance_housing: null, chronic_illness: null });
    // Himself: everything, read only.
    expect((await view(ali)).body).toMatchObject({ salary: 900, chronic_illness: 'Asthma', access: { own: true, edit: false } });
    expect((await ali.patch(`/hr/employees/${id}`, { phone_kw: '12345678' })).status).toBe(403);
    // Someone else at level 5: not even the record.
    expect((await view(omar)).status).toBe(404);
    // The directory shows Omar only himself (a sign-in without a record), and Mona her team.
    expect((await omar.get('/hr/employees')).body.employees.map((e: any) => e.first_name)).toEqual(['Omar']);
    expect((await mona.get('/hr/employees')).body.employees.map((e: any) => e.first_name).sort()).toEqual(['Ali', 'Mona']);

    // He asks HR to change something; HR is told, then he is told when it's done.
    const req = await ali.post(`/hr/employees/${id}/requests`, { text: 'New phone: 55667788' });
    expect(req.status).toBe(200);
    expect(JSON.stringify((await hana.get('/notifications')).body)).toContain('New phone: 55667788');
    expect((await omar.post(`/hr/employees/${id}/requests`, { text: 'hello there' })).status).toBe(404);
    expect((await hana.patch(`/hr/employees/${id}`, { phone_kw: '55667788' })).status).toBe(200);
    expect((await hana.patch(`/hr/requests/${req.body.id}`, { status: 'done' })).status).toBe(200);
    expect(JSON.stringify((await ali.get('/notifications')).body)).toContain('HR updated your record');

    // Every view is logged.
    const log = (await owner.get('/it/status')).body.access_log;
    expect(log.some((l: any) => l.action === 'view_employee')).toBe(true);
  });

  it('warns HR and the manager before documents expire, once per stage', async () => {
    const owner = await hrWorkspace();
    const { user: monaUser, c: mona } = await person(owner, 'Mona', 'manager');
    const boss = (await owner.post('/hr/employees', { user_id: monaUser.id, first_name: 'Mona', status: 'active' })).body;
    const e = (await owner.post('/hr/employees', {
      first_name: 'Rita', manager_id: boss.id, status: 'active', joining_date: '2024-02-01',
      passport_expiry: inDays(45), civil_id_expiry: inDays(-2),
    })).body;
    expect(e.employee_no).toMatch(/^E2024\d{3}$/);

    expect((await owner.post('/hr/alerts/run')).body.sent).toBe(2);
    expect((await owner.post('/hr/alerts/run')).body.sent).toBe(0);
    const bell = JSON.stringify((await mona.get('/notifications')).body);
    expect(bell).toContain('Passport of Rita');
    expect(bell).toContain('Civil ID of Rita');
    expect(bell).toContain('expired');

    const soon = (await owner.get('/hr/expiring?days=60')).body;
    expect(soon.map((x: any) => x.what).sort()).toEqual(['Civil ID', 'Passport']);
    expect((await owner.get('/hr/employees')).body.employees.find((x: any) => x.id === e.id).expiring_in).toBe(-2);

    // A document with an expiry joins the alerts; it opens in the watermarked viewer.
    const pdf = Buffer.from('%PDF-1.4\n%test\n');
    const doc = await upload(owner, `/hr/employees/${e.id}/documents?kind=work_permit&expiry_date=${inDays(20)}`, pdf, 'permit.pdf');
    expect(doc.status).toBe(200);
    expect((await owner.post('/hr/alerts/run')).body.sent).toBe(1);
  });

  it('imports the employee register and links managers and sign-ins', async () => {
    const owner = await hrWorkspace();
    const { user: lina } = await person(owner, 'Lina', 'sales');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DB');
    ws.addRow(['EMPLOYEE #', 'ABR', 'FIRST NAME', 'LAST NAME', 'COMPANY', 'BRANCH', 'POSITION', 'REPORT TO', 'EMPL.TYPE', 'STATUS',
      'NATIONALITY', 'CIVIL ID', 'CID EXPIRY DT', 'SALARY', 'STARTING DT']);
    ws.addRow(['E2016001', 'MIM', 'Maya', 'Mol', 'CONF-X', 'HQ', 'CEO', 'CEO', 'Full Time', 'ACTIVE', 'Hungary', '2781', new Date(Date.UTC(2027, 0, 31)), 5000, '30/6/2016']);
    ws.addRow([lina.employee_no, 'LIN', 'Lina', 'Ali', 'CONF-X', 'HQ', 'Sales', 'CEO', 'Full Time', 'NOT', 'Kuwait', null, null, 800, null]);
    ws.addRow(['not an id', '', 'Nobody']);
    const data = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await upload(owner, '/hr/import', data, 'EMPLOYEE_DB.xlsx');
    expect(res.body).toEqual({ created: 2, updated: 0, skipped: 1 });
    expect((await upload(owner, '/hr/import', data, 'EMPLOYEE_DB.xlsx')).body).toEqual({ created: 0, updated: 2, skipped: 1 });

    const list = (await owner.get('/hr/employees')).body.employees;
    const maya = list.find((x: any) => x.first_name === 'Maya');
    const linaRec = list.find((x: any) => x.first_name === 'Lina');
    expect(maya).toMatchObject({ employee_no: 'E2016001', joining_date: '2016-06-30', status: 'active', salary: 5000 });
    expect(linaRec).toMatchObject({ status: 'inactive', manager_name: 'Maya Mol', user_id: lina.id });
    expect((await owner.get(`/hr/employees/${maya.id}`)).body.civil_id_expiry).toBe('2027-01-31');
  });
});
