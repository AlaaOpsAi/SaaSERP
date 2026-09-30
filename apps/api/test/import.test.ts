import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { parseTime } from '../src/lib/importer.js';
import { makeApp, newTenant } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A tiny workbook in the daily-report layout. */
async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CONTRACTS');
  ws.addRow(['totals']);
  ws.addRow(['CONTRACT ID', 'CO', 'CAT', 'STATUS']);
  const row = (values: Record<number, unknown>) => {
    const arr: unknown[] = [];
    for (const [k, v] of Object.entries(values)) arr[Number(k)] = v;
    ws.addRow(arr);
  };
  row({ 0: 'W2026001', 1: 'W', 2: 'W', 3: 'LOS', 4: 2026, 7: 'HOME', 35: 'INSTA', 36: 'JOU', 37: 'Wedding at home', 38: 'HOME',
        39: 80, 42: 2026, 43: 1, 44: 4, 49: 'poor followup', 51: 'KUWAIT', 54: 'Latifa', 55: 66232308,
        56: 2026, 57: 1, 58: 10, 59: '7pm', 60: 'Office', 61: 'Showed samples' });
  row({ 0: 'W2026002', 1: 'W', 2: 'E', 3: 'DEF', 4: 2026, 5: 3, 6: 15, 7: 'MIRQAB Ballroom', 8: 5000, 9: 3000,
        12: 5000, 14: 'CF', 18: 0.1, 20: 'PAID', 22: 0.5, 30: 2026, 31: 3, 32: 20, 35: 'RADISSON', 36: 'MEL',
        38: 'FOUR SEASONS', 39: 200, 42: 2026, 43: 1, 44: 11, 54: 'Bader', 55: 99026171 });
  row({ 0: 'W2026003', 1: 'W', 2: 'W', 3: 'TEN', 4: 2026, 5: 3, 6: 15, 7: 'MIRQAB Ballroom', 36: 'MEL',
        38: 'FOUR SEASONS', 42: 2026, 43: 2, 44: 1, 55: 66232308 });
  row({ 0: 'end' });
  const par = wb.addWorksheet('PAR');
  par.addRow(['Category', 'Currency', 'CO', '', 'Y', 'M', 'D', 'TYPE', 'PAID BY', 'CONTRACT TYPE', '', 'SOURCE', 'AM']);
  par.addRow(['IT', 'KWD', 'X', 'CONFX GROUP', 2026, 1, 1, 'BANK', 'Melinda', 'C', 'Corporate & Conference', 'TIKTOK', 'GHA']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(token: string, file: Buffer) {
  const boundary = '----saaserp';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.xlsx"\r\n` +
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST', url: '/api/import/workbook', payload,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}

describe('workbook import', () => {
  it('parses meeting times', () => {
    expect(parseTime('7pm')).toBe('19:00');
    expect(parseTime('10:30 am')).toBe('10:30');
    expect(parseTime(0.75)).toBe('18:00');
    expect(parseTime(null)).toBe('12:00');
  });

  it('imports contracts, clients, venues and payouts idempotently', async () => {
    const c = await newTenant(app);
    const file = await workbook();
    const first = await upload(c.token, file);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ bookings_created: 3, errors: [], contacts_created: 2 });

    const again = (await upload(c.token, file)).json();
    expect(again).toMatchObject({ bookings_created: 0, bookings_updated: 3, contacts_created: 0 });

    const list = (await c.get('/bookings?sort=booking_no')).body.rows;
    expect(list.map((b: any) => [b.booking_no, b.status])).toEqual([['W2026001', 'LOS'], ['W2026002', 'DEF'], ['W2026003', 'TEN']]);

    const def = (await c.get(`/bookings/${list[1].id}`)).body;
    expect(def.revenue).toBe(5000);
    expect(def.gross_margin).toBe(2000);
    expect(def.net_profit).toBe(1200); // 2000 - 20% fixed - 20% CF
    expect(def.commission).toBe(120);
    expect(def.shares).toBe(540);
    expect(def.outstanding).toBe(0);
    expect(def.space_name).toBe('MIRQAB Ballroom');
    expect(def.events).toHaveLength(1);
    expect(def.owner_code).toBe('MEL');

    const lost = (await c.get(`/bookings/${list[0].id}`)).body;
    expect(lost.lost_reason).toBe('poor followup');
    expect(lost.contact_phone).toBe('66232308');
    expect(lost.activities[0]).toMatchObject({ subject: 'Meeting #1', location: 'Office', notes: 'Showed samples' });
    // Same phone number -> same client.
    expect((await c.get(`/bookings/${list[2].id}`)).body.contact_id).toBe(lost.contact_id);

    // New bookings continue after the imported numbers.
    expect((await c.post('/bookings', { name: 'new', event_date: '2026-08-01' })).body.booking_no).toBe('W2026004');
    const bus = (await c.get('/business-units')).body.map((b: any) => b.code);
    expect(bus).toContain('X');
  });
});
