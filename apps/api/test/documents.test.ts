import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { fillTemplate } from '../src/lib/docgen.js';
import { amountInWords } from '../src/lib/words.js';
import { client, login, makeApp, newTenant, type Client, book } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%test\n');

/** POST a file as multipart/form-data. */
async function upload(c: Client, url: string, data: Buffer, name: string, type = 'application/octet-stream') {
  const boundary = '----saaserp-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST', url: `/api${url}`, payload,
    headers: { authorization: `Bearer ${c.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}

async function member(owner: Client & { slug: string }, name: string, role: string) {
  const email = `${name.toLowerCase()}@x.com`;
  await owner.post('/users', { name, email, role, password: 'password123' });
  return client(app, (await login(app, email, 'password123', owner.slug)).json().token);
}

const text = (docx: Buffer) => new PizZip(docx).file('word/document.xml')!.asText().replace(/<[^>]+>/g, '');

describe('signed contract upload', () => {
  it('accepts JPEG, PNG or PDF at any status and flags DEF contracts without a signed copy', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    const b = (await book(sara, { name: 'Hessa wedding', status: 'TEN' })).body;
    // Any status: a contract takes other files without changing its status.
    expect((await upload(sara, `/bookings/${b.id}/files?kind=other`, PNG, 'venue.png')).status).toBe(200);
    expect((await sara.get(`/bookings/${b.id}`)).body.status).toBe('TEN');
    // Only real pictures or PDFs, whatever the name says.
    const fake = await upload(sara, `/bookings/${b.id}/files`, Buffer.from('MZ not a pdf'), 'contract.pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.error).toBe('Upload a picture (JPEG or PNG) or a PDF');

    // Signed (DEF) needs the signed copy first (customer comment 9).
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(400);
    const up = await upload(sara, `/bookings/${b.id}/files?kind=signed_contract`, PDF, 'signed.pdf');
    expect(up.body).toMatchObject({ kind: 'signed_contract', mime: 'application/pdf', file_name: 'signed.pdf' });
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(200);
    const detail = (await sara.get(`/bookings/${b.id}`)).body;
    expect(detail.signed_missing).toBe(false);
    expect(detail.files.map((f: any) => f.kind).sort()).toEqual(['offer', 'other', 'signed_contract']);

    // Downloading needs the download right (level 5 views on screen only); then it is a short-lived link without a login header.
    expect((await sara.get(`/booking-files/${up.body.id}/link`)).status).toBe(403);
    const { url } = (await owner.get(`/booking-files/${up.body.id}/link`)).body;
    const file = await app.inject({ method: 'GET', url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'GET', url: url.replace(/.$/, (ch: string) => (ch === 'A' ? 'B' : 'A')) })).statusCode).toBe(400);

    // Removing it (deactivate) flags the signed contract again; a viewer cannot upload.
    expect((await sara.post(`/booking-files/${up.body.id}/deactivate`, { reason: 'wrong file' })).status).toBe(200);
    expect((await sara.get(`/bookings/${b.id}`)).body.signed_missing).toBe(true);
    const list = (await owner.get('/bookings?signed_missing=true')).body;
    expect(list.rows.map((r: any) => r.id)).toEqual([b.id]);
    const viewer = await member(owner, 'Vic', 'viewer');
    expect((await upload(viewer, `/bookings/${b.id}/files`, PDF, 'x.pdf')).status).toBe(403);
  });
});

describe('issuing contracts, proposals and annexes', () => {
  it('fills the template with the contract data, numbers it and keeps a copy', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    const b = (await book(sara, {
      name: 'Hessa wedding', status: 'ENQ', event_date: '2026-12-03', pax: 350, contract_value: 2370,
      contact: { first_name: 'حصة', family_name: 'العتيبي', phone: '96528423' },
    })).body;
    const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api${url}`, payload: payload as object, headers: { authorization: `Bearer ${sara.token}` } });
    expect((await put(`/bookings/${b.id}/contract-lines`, { lines: [
      { work_type: 'ديكورات التسكير', details: 'اعمدة خشبية', quantity: 1, unit_price: 1370 },
      { work_type: 'تكييف', quantity: 2, unit_price: 500 },
    ] })).statusCode).toBe(200);
    expect((await put(`/bookings/${b.id}/annex-lines`, { lines: [{ service: 'مدخل العروس', service_alt: 'Bride Entrance', quantity: 1, notes: 'VIP' }] })).statusCode).toBe(200);

    const options = (await sara.get(`/bookings/${b.id}/templates`)).body;
    expect(options.proposal[0]).toMatchObject({ id: 'builtin', language: 'bilingual' });
    const p1 = (await sara.post(`/bookings/${b.id}/documents`, { kind: 'proposal', template_id: 'builtin', notes: 'Valid 14 days' })).body;
    expect(p1.doc_no).toBe(`${b.booking_no}-P1`);
    // Printing the offer moves the enquiry to TEN (customer comments 8 and 9).
    const sent = (await sara.get(`/bookings/${b.id}`)).body;
    expect(sent.status).toBe('TEN');
    expect(sent.history.at(-1)).toMatchObject({ from_status: 'ENQ', to_status: 'TEN', reason: 'Automatic: offer sent' });
    const p2 = (await sara.post(`/bookings/${b.id}/documents`, { kind: 'proposal', template_id: 'builtin' })).body;
    expect(p2.doc_no).toBe(`${b.booking_no}-P2`);
    const annex = (await sara.post(`/bookings/${b.id}/documents`, { kind: 'annex', template_id: 'builtin' })).body;
    expect(annex.doc_no).toBe(`${b.booking_no}-A1`);

    await owner.put('/permissions', { 5: { download: true } });
    const { url } = (await sara.get(`/documents/${p1.id}/link?format=docx`)).body;
    const docx = (await app.inject({ method: 'GET', url })).rawPayload;
    const body = text(docx);
    for (const s of ['عرض سعر', `${b.booking_no}-P1`, 'حصة العتيبي', '96528423', '03/12/2026', '350', 'ديكورات التسكير', '1,370', '2,370 KWD',
      'Two thousand three hundred and seventy Kuwaiti Dinars only', 'ألفان وثلاثمائة وسبعون دينار كويتي فقط لا غير', 'Valid 14 days']) {
      expect(body).toContain(s);
    }
    expect(text((await app.inject({ method: 'GET', url: (await sara.get(`/documents/${annex.id}/link?format=docx`)).body.url })).rawPayload))
      .toContain('Bride Entrance');

    // A signed copy marks the latest proposal as signed.
    await upload(sara, `/bookings/${b.id}/files?kind=signed_proposal`, PNG, 'signed.png');
    const docs = (await sara.get(`/bookings/${b.id}`)).body.documents;
    expect(docs.find((d: any) => d.id === p2.id).signed_at).toBeTruthy();
    expect(docs.find((d: any) => d.id === p1.id).signed_at).toBeNull();
  });

  it('uses the company template for its business type, in its language', async () => {
    const owner = await newTenant(app);
    const units = (await owner.get('/business-units')).body;
    const standard = await readFile(new URL('../templates/standard-contract.docx', import.meta.url));
    // A broken template is refused with a clear message.
    const broken = new PizZip(standard);
    broken.file('word/document.xml', broken.file('word/document.xml')!.asText().replace('{doc_no}', '{doc_no'));
    const bad = await upload(owner, `/templates?name=Bad&kinds=contract&language=ar`, broken.generate({ type: 'nodebuffer' }), 'bad.docx');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/^The template could not be filled/);

    const t = await upload(owner, `/templates?name=Wedding contract&kinds=contract,proposal&language=ar&business_unit_ids=${units[0].id}`, standard, 'wedding.docx');
    expect(t.status).toBe(200);
    const b = (await book(owner, { name: 'Gala', status: 'DEF' })).body;
    const options = (await owner.get(`/bookings/${b.id}/templates`)).body;
    expect(options.contract.map((x: any) => x.name)).toEqual(['Wedding contract']);
    expect(options.annex[0].id).toBe('builtin');
    // Once the company has its own, the standard one is no longer offered.
    expect((await owner.post(`/bookings/${b.id}/documents`, { kind: 'contract', template_id: 'builtin' })).status).toBe(400);
    const doc = (await owner.post(`/bookings/${b.id}/documents`, { kind: 'contract', template_id: t.body.id })).body;
    expect(doc.doc_no).toBe(`${b.booking_no}-C1`);
    const sales = await member(owner, 'Sam', 'sales');
    expect((await upload(sales, `/templates?name=X&kinds=contract&language=ar`, standard, 'x.docx')).status).toBe(403);
  });

  it('tops a table up with blank rows ({#lines_pad_N})', async () => {
    const standard = await readFile(new URL('../templates/standard-contract.docx', import.meta.url));
    const zip = new PizZip(standard);
    const xml = zip.file('word/document.xml')!.asText();
    zip.file('word/document.xml', xml.replace('</w:body>', '<w:p><w:r><w:t>[{#lines_pad_3}x{/lines_pad_3}]</w:t></w:r></w:p></w:body>'));
    const fill = (lines: number) => text(fillTemplate(zip.generate({ type: 'nodebuffer' }), {
      lines: Array.from({ length: lines }, () => ({})), annex: [],
    }));
    expect(fill(1)).toContain('[xx]');
    expect(fill(3)).toContain('[]');
    expect(fill(5)).toContain('[]');
  });

  it('writes amounts in words in English and Arabic', () => {
    expect(amountInWords(1, 'KWD').en).toBe('One Kuwaiti Dinar only');
    expect(amountInWords(12500.25, 'KWD')).toEqual({
      en: 'Twelve thousand five hundred Kuwaiti Dinars and 250 Fils only',
      ar: 'اثنا عشر ألف وخمسمائة دينار كويتي و250 فلس فقط لا غير',
    });
    expect(amountInWords(2000, 'KWD').ar).toBe('ألفان دينار كويتي فقط لا غير');
    expect(amountInWords(3000, 'KWD').ar).toBe('ثلاثة آلاف دينار كويتي فقط لا غير');
  });
});

describe('status conditions of the daily report (comment 9)', () => {
  it('starts as ENQ, goes to TEN with an offer, to DEF by hand with a signed copy; payment shows DP / PAID', async () => {
    const owner = await newTenant(app);
    const sara = await member(owner, 'Sara', 'sales');
    expect((await sara.post('/bookings', { name: 'Noor wedding', status: 'DEF' })).status).toBe(400);
    const b = (await sara.post('/bookings', { name: 'Noor wedding', contract_value: 1000 })).body;
    expect(b.status).toBe('ENQ');
    const get = async () => (await owner.get(`/bookings/${b.id}`)).body;

    // No offer yet: TEN and DEF are refused.
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'TEN' })).status).toBe(400);
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(400);
    // Printing an offer moves it to TEN on its own.
    await sara.post(`/bookings/${b.id}/documents`, { kind: 'proposal', template_id: 'builtin' });
    expect((await get()).status).toBe('TEN');
    expect((await get()).history.at(-1)).toMatchObject({ from_status: 'ENQ', to_status: 'TEN', reason: 'Automatic: offer sent' });

    // The signed copy does not change the status; DEF is set by hand once it is there.
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(400);
    await upload(sara, `/bookings/${b.id}/files?kind=signed_proposal`, PDF, 'signed.pdf');
    expect((await get()).status).toBe('TEN');
    expect((await sara.post(`/bookings/${b.id}/status`, { status: 'DEF' })).status).toBe(200);
    expect(await get()).toMatchObject({ status: 'DEF', signed_missing: false, payment: null });

    // Payment: DP once money came in, PAID when it reaches the contract value; Finance can set the others.
    await sara.post(`/bookings/${b.id}/down-payment`, { paid_on: '2026-10-01', amount: 400, method: 'CASH' });
    expect((await get()).payment).toBe('DP');
    await owner.patch(`/bookings/${b.id}`, { payment_status: 'INVOICED' });
    expect((await get()).payment).toBe('INVOICED');
    await owner.post(`/bookings/${b.id}/payments`, { paid_on: '2026-10-10', amount: 600, method: 'BANK' });
    expect(await get()).toMatchObject({ status: 'DEF', payment: 'PAID', fully_paid_date: '2026-10-10' });

    // Attaching an offer to an enquiry also makes it TEN.
    const c = (await sara.post('/bookings', { name: 'Rania dinner' })).body;
    await upload(sara, `/bookings/${c.id}/files?kind=offer`, PDF, 'offer.pdf');
    expect((await owner.get(`/bookings/${c.id}`)).body.status).toBe('TEN');
    // Lost needs a reason from the list, with an optional "specify" text; any status can be cancelled, Lost too.
    expect((await sara.post(`/bookings/${c.id}/status`, { status: 'LOS', reason: 'made up' })).status).toBe(400);
    expect((await sara.post(`/bookings/${c.id}/status`, { status: 'LOS', reason: 'BUDGET', note: 'went to a cheaper hotel' })).status).toBe(200);
    expect((await owner.get(`/bookings/${c.id}`)).body).toMatchObject({ lost_reason: 'BUDGET', lost_reason_note: 'went to a cheaper hotel' });
    expect((await sara.post(`/bookings/${c.id}/status`, { status: 'CXL', reason: 'duplicate' })).status).toBe(200);
  });
});
