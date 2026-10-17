import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { DB_HEADERS } from '../src/lib/crm-workbook.js';
import { makeApp, newTenant, type Client } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const put = (c: Client, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url: `/api${url}`, payload: payload as object, headers: { authorization: `Bearer ${c.token}` } });

async function uploadXlsx(c: Client, url: string, data: Buffer) {
  const boundary = '----crm-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="crm.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: 'POST', url: `/api${url}`, payload, headers: { authorization: `Bearer ${c.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return { status: res.statusCode, body: res.json() };
}

/** A workbook in the customer's layout: row 1 numbers, row 2 headers, then data. */
async function workbook(rows: Record<number, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('PAR');
  const ws = wb.addWorksheet('DB');
  ws.addRow(DB_HEADERS.map((_, i) => i + 1));
  ws.addRow([...DB_HEADERS]);
  for (const r of rows) ws.addRow(DB_HEADERS.map((_, i) => r[i] ?? null));
  ws.addRow(['end']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('CRM rules', () => {
  it('needs an email or a mobile, and refuses a second customer with the same one', async () => {
    const c = await newTenant(app);
    const none = await c.post('/contacts', { first_name: 'Hessa' });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('Give an email or a mobile number');

    const hessa = (await c.post('/contacts', { first_name: 'Hessa', family_name: 'Al Otaibi', phone: '+965 9652 8423', email: 'Hessa@Mail.com' })).body;
    expect(hessa.customer_no).toBe('C0000000001');
    // Same mobile without the country code, or the same email in other letters: refused, naming the customer.
    const again = await c.post('/contacts', { first_name: 'H', phone: '96528423' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('Already exists under customer: C0000000001 Hessa Al Otaibi');
    expect((await c.post('/accounts', { name: 'X Co', email: 'hessa@mail.com' })).status).toBe(409);
    // The live check while typing, ignoring the customer being edited.
    expect((await c.get('/customers/check?email=hessa@mail.com')).body.duplicate).toMatchObject({ customer_no: 'C0000000001', field: 'email' });
    expect((await c.get(`/customers/check?email=hessa@mail.com&kind=contacts&id=${hessa.id}`)).body.duplicate).toBeNull();
    // Editing keeps the rule.
    const other = (await c.post('/contacts', { first_name: 'Noor', phone: '94793704' })).body;
    expect((await c.patch(`/contacts/${other.id}`, { email: 'hessa@mail.com' })).status).toBe(409);
    expect((await c.patch(`/contacts/${other.id}`, { phone: null })).body.error).toBe('Give an email or a mobile number');
    // Leaving fields out of an edit never clears them.
    expect((await c.patch(`/contacts/${hessa.id}`, { city: 'Salmiya', newsletter: true })).body).toMatchObject({ phone: '+965 9652 8423', city: 'Salmiya', newsletter: true });
  });

  it('keeps several relationships per customer, and an applicant profile', async () => {
    const c = await newTenant(app);
    const b = (await c.post('/bookings', { name: 'Manpower supply' })).body;
    const p = (await c.post('/contacts', { first_name: 'Abdulaziz', phone: '67682111', civil_id: '298010100123', gender: 'M', title: 'MR' })).body;
    expect((await c.post(`/contacts/${p.id}/relationships`, { relation: 'APPL', segment: 'MANPOWER', booking_id: b.id })).status).toBe(200);
    expect((await c.post(`/contacts/${p.id}/relationships`, { relation: 'CLIENT', relation_old: 'KNOW' })).status).toBe(200);
    expect((await put(c, `/contacts/${p.id}/applicant`, { education: 'BACHELOR', degree_name: 'BSc Electrical Engineering', degree_year: 2023, years_experience: 1 })).statusCode).toBe(200);
    const detail = (await c.get(`/contacts/${p.id}`)).body;
    expect(detail.relationships.map((r: any) => r.relation).sort()).toEqual(['APPL', 'CLIENT']);
    expect(detail.relationships.find((r: any) => r.relation === 'APPL')).toMatchObject({ booking_no: b.booking_no, registered_by_name: 'Owner Person' });
    expect(detail.applicant).toMatchObject({ education: 'BACHELOR', degree_year: 2023 });
    expect((await c.get('/contacts?relation=APPL')).body.map((x: any) => x.id)).toEqual([p.id]);
    const lists = (await c.get('/lookups')).body;
    for (const type of ['relation', 'relation_old', 'segment', 'industry', 'title', 'contact_mode', 'education']) {
      expect(Array.isArray(lists) ? lists.some((l: any) => l.type === type) : lists[type]?.length > 0).toBe(true);
    }
  });

  it('gives every user an employee ID: E + year of hiring + serial', async () => {
    const c = await newTenant(app);
    const year = new Date().getFullYear();
    const a = (await c.post('/users', { name: 'Glory Staff', code: 'GLO', role: 'sales', is_active: false, hired_on: '2025-03-01' })).body;
    const b = (await c.post('/users', { name: 'Lojine Staff', code: 'LJN', role: 'sales', is_active: false, hired_on: '2025-07-01' })).body;
    expect([a.employee_no, b.employee_no]).toEqual(['E2025001', 'E2025002']);
    const users = (await c.get('/users')).body;
    expect(users.find((u: any) => u.name === 'Owner Person').employee_no).toBe(`E${year}001`);
  });
});

describe('CRM workbook', () => {
  it('imports the DB layout (merging by email) and exports the same 56 columns', async () => {
    const c = await newTenant(app);
    await c.post('/users', { name: 'Glory', code: 'GLORY', role: 'sales', is_active: false });
    const contract = (await c.post('/bookings', { name: 'Manpower' })).body;
    const data = await workbook([
      { 0: 'C000001', 1: 1, 2: 'APPL', 3: 'Manpower | HR', 4: 2025, 5: 5, 6: 8, 7: 'Mr.', 8: 'A B D U L A Z I Z ', 9: 'ALFARHAN', 10: 'Electrical Engineer',
        11: 'TOURISTIC ENTERPRISES', 12: 'P', 13: 'M', 14: 'Kuwait', 15: 965, 16: 67682111, 19: 'Abdul@Example.com', 22: 'Kuwait', 23: 'Farwaniya',
        34: 'Bachelor', 35: 'Engineering', 37: 'BSc Electrical', 38: 2023, 40: 1, 41: 'NO', 46: 'NO', 47: 'WA', 48: 'Glory', 49: contract.booking_no },
      // Same email again: one customer, a second relationship.
      { 0: 'C000002', 2: 'CLIENT', 3: 'Banking | Finance', 4: 2026, 5: 3, 6: 4, 8: 'Abdulaziz', 9: 'ALFARHAN', 12: 'P', 19: 'abdul@example.com', 46: 'YES', 48: 'Lojine' },
      { 0: 'C000003', 2: 'SUPPL', 3: 'Art | Photography', 11: 'Bloemen', 12: 'C', 15: 965, 16: 22260071, 19: 'info@bloemen.test', 26: 'www.bloemen.test', 28: 'LIC-77' },
      { 0: 'C000004', 2: 'PARTNER', 8: 'No contact' },
    ]);
    const res = await uploadXlsx(c, '/import/crm', data);
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    expect(res.body).toMatchObject({ rows: 4, people_created: 1, companies_created: 1, merged: 1, relationships: 3, applicants: 1 });
    expect(res.body.cleaned_names).toEqual(['Row 3: ABDULAZIZ']);
    expect(res.body.unknown_users).toEqual(['Lojine']);
    expect(res.body.skipped).toEqual(['Row 6: no email and no mobile']);

    const people = (await c.get('/contacts?q=abdul@example.com')).body;
    expect(people).toHaveLength(1);
    const person = (await c.get(`/contacts/${people[0].id}`)).body;
    expect(person).toMatchObject({ first_name: 'ABDULAZIZ', phone: '+965 67682111', legacy_no: 'C000001', title: 'MR', gender: 'M', contact_mode: 'WA', newsletter: false });
    expect(person.relationships.map((r: any) => r.relation).sort()).toEqual(['APPL', 'CLIENT']);
    expect(person.relationships.find((r: any) => r.relation === 'APPL')).toMatchObject({ booking_no: contract.booking_no, registered_by_name: 'Glory', segment: 'MANPOWER' });
    expect(person.applicant).toMatchObject({ education: 'BACHELOR', companies: 'TOURISTIC ENTERPRISES (Electrical Engineer)' });
    const company = (await c.get('/accounts?q=Bloemen')).body[0];
    expect(company).toMatchObject({ license_no: 'LIC-77', web: 'www.bloemen.test', segment: 'ART' });

    // Importing the same file again adds nothing new.
    const again = (await uploadXlsx(c, '/import/crm', data)).body;
    expect(again).toMatchObject({ people_created: 0, companies_created: 0, relationships: 0 });

    const xlsx = await app.inject({ method: 'GET', url: '/api/reports/crm.xlsx', headers: { authorization: `Bearer ${c.token}` } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('DB')!;
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual([...DB_HEADERS]);
    const exported = [3, 4, 5].map((r) => (ws.getRow(r).values as unknown[]).slice(1));
    const applicantRow = exported.find((r) => r[2] === 'APPL')!;
    expect(applicantRow.slice(0, 4)).toEqual([person.customer_no, 1, 'APPL', 'Manpower | HR']);
    expect(applicantRow[15]).toBe('965');
    expect(applicantRow[16]).toBe('67682111');
    expect(applicantRow[48]).toBe('GLORY');
    expect(applicantRow[49]).toBe(contract.booking_no);
  });
});
