import ExcelJS from 'exceljs';
import type { Db } from '../db.js';

/**
 * Imports the "daily report" workbook layout:
 *   - PAR sheet        -> pick-lists, business units, venues, account managers
 *   - CONTRACTS sheet  -> bookings, contacts, meetings, payouts, payments
 * Row 1 holds totals, row 2 headers, data starts at row 3 and stops at "end".
 * Re-importing is idempotent: bookings are matched on their contract ID.
 */

// 0-based column positions in the CONTRACTS sheet.
const C = {
  id: 0, co: 1, cat: 2, status: 3, y: 4, m: 5, d: 6, hall: 7, rev: 8, cost: 9, contract: 12, cf: 14,
  commPct: 18, commStatus: 20, commPaid: 21, sharePct: 22, shareStatus: 24, sharePaid: 25,
  share1Pct: 26, share1Name: 28, share1Paid: 29, paidY: 30, paidM: 31, paidD: 32,
  source: 35, am: 36, desc: 37, loc: 38, pax: 39, rate: 40, term: 41,
  enqY: 42, enqM: 43, enqD: 44, fuY: 45, fuM: 46, fuD: 47, feedback: 48, lost: 49,
  email: 50, country: 51, address: 52, insta: 53, clientName: 54, phone: 55, meetings: 56,
} as const;

export interface ImportSummary {
  bookings_created: number;
  bookings_updated: number;
  rows_skipped: number;
  contacts_created: number;
  venues_created: number;
  users_created: number;
  lookups_created: number;
  activities_created: number;
  errors: { row: number; booking_no?: string; message: string }[];
}

type Cell = ExcelJS.CellValue;

/** Plain value of a cell: formula results, rich text and errors resolved. */
function plain(v: Cell): string | number | Date | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('error' in v) return null;
    if ('result' in v) return plain(v.result as Cell);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return null;
  }
  return v;
}

function text(v: Cell): string | null {
  const p = plain(v);
  if (p === null) return null;
  const s = (p instanceof Date ? p.toISOString().slice(0, 10) : String(p)).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

function num(v: Cell): number | null {
  const p = plain(v);
  if (p === null || p === '' || p instanceof Date) return null;
  const n = typeof p === 'number' ? p : Number(String(p).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isoDate(y: Cell, m: Cell, d: Cell): string | null {
  const [yy, mm, dd] = [num(y), num(m), num(d)];
  if (!yy || !mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const date = new Date(Date.UTC(yy, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1) return null;
  return date.toISOString().slice(0, 10);
}

function cellDate(v: Cell): string | null {
  const p = plain(v);
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p)) return p.slice(0, 10);
  return null;
}

/** "7pm", "19:30", Excel time fractions or Date objects -> "HH:MM". */
export function parseTime(v: Cell): string {
  const p = plain(v);
  if (p instanceof Date) return `${String(p.getUTCHours()).padStart(2, '0')}:${String(p.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof p === 'number' && p >= 0 && p < 1) {
    const mins = Math.round(p * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = typeof p === 'string' ? p.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/) : null;
  if (!m) return '12:00';
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23) return '12:00';
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

const CLIENT_LOCATIONS = new Set(['HOME', 'CLIENT LOC']);
const STATUSES = new Set(['INQ', 'TEN', 'DEF', 'ACT', 'LOS', 'CXL']);

class Resolver {
  private cache = new Map<string, string | null>();
  constructor(private db: Db, private summary: ImportSummary) {}

  /** Forget cached ids, e.g. after a savepoint rollback discarded some of them. */
  reset() {
    this.cache.clear();
  }

  private async cached(key: string, fn: () => Promise<string | null>) {
    if (!this.cache.has(key)) this.cache.set(key, await fn());
    return this.cache.get(key)!;
  }

  businessUnit(code: string, name?: string) {
    return this.cached(`bu:${code}`, async () => {
      const { rows } = await this.db.query(
        `INSERT INTO business_units (tenant_id, code, name) VALUES (current_tenant_id(), $1, $2)
         ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
        [code, name ?? code],
      );
      return rows[0].id;
    });
  }

  async lookup(type: string, code: string, label?: string) {
    const key = code.toUpperCase().slice(0, 40);
    return this.cached(`lk:${type}:${key}`, async () => {
      const { rows } = await this.db.query(
        `INSERT INTO lookups (tenant_id, type, code, label, sort_order)
         VALUES (current_tenant_id(), $1, $2, $3, 100)
         ON CONFLICT (tenant_id, type, code) DO NOTHING RETURNING id`,
        [type, key, label ?? code],
      );
      if (rows[0]) this.summary.lookups_created++;
      return key;
    });
  }

  user(code: string) {
    const key = code.toUpperCase().slice(0, 6);
    return this.cached(`user:${key}`, async () => {
      const found = await this.db.query('SELECT id FROM users WHERE code = $1', [key]);
      if (found.rows[0]) return found.rows[0].id;
      const { rows } = await this.db.query(
        `INSERT INTO users (tenant_id, name, code, role, is_active)
         VALUES (current_tenant_id(), $1, $1, 'sales', false) RETURNING id`,
        [key],
      );
      this.summary.users_created++;
      return rows[0].id;
    });
  }

  venue(name: string) {
    const key = name.toUpperCase();
    if (key === '???' || key === '') return Promise.resolve(null);
    return this.cached(`venue:${key}`, async () => {
      const found = await this.db.query('SELECT id FROM venues WHERE upper(name) = $1', [key]);
      if (found.rows[0]) return found.rows[0].id;
      const { rows } = await this.db.query(
        `INSERT INTO venues (tenant_id, name, kind) VALUES (current_tenant_id(), $1, $2) RETURNING id`,
        [name, CLIENT_LOCATIONS.has(key) ? 'client_location' : 'hotel'],
      );
      this.summary.venues_created++;
      return rows[0].id;
    });
  }

  space(venueId: string, venueName: string, hall: string) {
    const clientLoc = CLIENT_LOCATIONS.has(venueName.toUpperCase());
    const name = clientLoc ? 'Client location' : hall;
    return this.cached(`space:${venueId}:${name.toUpperCase()}`, async () => {
      const found = await this.db.query(
        'SELECT id FROM function_spaces WHERE venue_id = $1 AND upper(name) = upper($2)',
        [venueId, name],
      );
      if (found.rows[0]) return found.rows[0].id;
      const { rows } = await this.db.query(
        `INSERT INTO function_spaces (tenant_id, venue_id, name, allow_overlap)
         VALUES (current_tenant_id(), $1, $2, $3) RETURNING id`,
        [venueId, name, clientLoc],
      );
      return rows[0].id;
    });
  }

  async contact(c: { name: string | null; phone: string | null; email: string | null; country: string | null;
                     address: string | null; insta: string | null }) {
    if (!c.name && !c.phone && !c.email) return null;
    const key = c.phone ? `p:${c.phone}` : c.email ? `e:${c.email}` : `n:${c.name}`;
    return this.cached(`contact:${key}`, async () => {
      const found = c.phone
        ? await this.db.query('SELECT id FROM contacts WHERE phone = $1 LIMIT 1', [c.phone])
        : c.email
          ? await this.db.query('SELECT id FROM contacts WHERE email = $1 LIMIT 1', [c.email])
          : await this.db.query('SELECT id FROM contacts WHERE name = $1 AND phone IS NULL LIMIT 1', [c.name]);
      if (found.rows[0]) return found.rows[0].id;
      const { rows } = await this.db.query(
        `INSERT INTO contacts (tenant_id, name, phone, email, nationality, address, social_handle)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6) RETURNING id`,
        [c.name ?? `Client ${c.phone ?? c.email}`, c.phone, c.email, c.country, c.address, c.insta],
      );
      this.summary.contacts_created++;
      return rows[0].id;
    });
  }
}

async function importPar(ws: ExcelJS.Worksheet, r: Resolver) {
  const rows: Cell[][] = [];
  ws.eachRow((row, n) => {
    if (n > 1) rows.push((row.values as Cell[]).slice(1));
  });
  for (const row of rows) {
    const co = text(row[2]);
    if (co && /^[A-Z0-9]{1,4}$/i.test(co)) await r.businessUnit(co.toUpperCase(), text(row[3]) ?? co);
    const evtCode = text(row[9]);
    if (evtCode) await r.lookup('event_type', evtCode, text(row[10]) ?? evtCode);
    const src = text(row[11]);
    if (src) await r.lookup('source', src, src);
    const am = text(row[12]);
    if (am) await r.user(am);
    const bt = text(row[15]);
    if (bt) await r.lookup('business_type', bt, text(row[16]) ?? bt);
    const bank = text(row[18]);
    if (bank) await r.lookup('bank_account', bank, bank);
    const method = text(row[7]);
    if (method) await r.lookup('payment_method', method, method);
    const loc = text(row[19]);
    if (loc) await r.venue(loc);
  }
}

async function importContractRow(db: Db, r: Resolver, row: Cell[], summary: ImportSummary) {
  const bookingNo = text(row[C.id]);
  const co = text(row[C.co])?.toUpperCase();
  if (!bookingNo || !co) {
    summary.rows_skipped++;
    return;
  }
  const buId = await r.businessUnit(co);

  const rawStatus = text(row[C.status])?.toUpperCase() ?? 'INQ';
  const status = STATUSES.has(rawStatus) ? rawStatus : 'INQ';
  const lostText = text(row[C.lost]);
  const eventDate = isoDate(row[C.y], row[C.m], row[C.d]);
  const inquiryDate = isoDate(row[C.enqY], row[C.enqM], row[C.enqD]) ?? eventDate ?? new Date().toISOString().slice(0, 10);

  const cat = text(row[C.cat]);
  const source = text(row[C.source]);
  const am = text(row[C.am]);
  const locName = text(row[C.loc]);
  const hall = text(row[C.hall]);
  const venueId = locName ? await r.venue(locName) : null;
  // Only real holds get a room on the diary; lost enquiries keep the free-text hall.
  const holdsSpace = status === 'TEN' || status === 'DEF' || status === 'ACT';
  const spaceId = venueId && hall && holdsSpace ? await r.space(venueId, locName!, hall) : null;
  const phone = text(row[C.phone]);
  const contactId = await r.contact({
    name: text(row[C.clientName]),
    phone,
    email: text(row[C.email])?.toLowerCase() ?? null,
    country: text(row[C.country]),
    address: text(row[C.address]),
    insta: text(row[C.insta]),
  });

  const revenue = num(row[C.rev]);
  const cost = num(row[C.cost]);
  const contractValue = num(row[C.contract]);
  const description = text(row[C.desc]);
  const clientName = text(row[C.clientName]);

  const fields = {
    business_unit_id: buId,
    name: [clientName, description].filter(Boolean).join(' – ').slice(0, 200) || bookingNo,
    status,
    event_type: cat ? await r.lookup('event_type', cat) : null,
    source: source ? await r.lookup('source', source) : null,
    owner_id: am ? await r.user(am) : null,
    contact_id: contactId,
    venue_id: venueId,
    function_space_id: spaceId,
    hall_text: hall,
    event_date: eventDate,
    pax: num(row[C.pax]) === null ? null : Math.round(num(row[C.pax])!),
    rate: num(row[C.rate]),
    term_days: num(row[C.term]) === null ? null : Math.round(num(row[C.term])!),
    inquiry_date: inquiryDate,
    last_followup_date: isoDate(row[C.fuY], row[C.fuM], row[C.fuD]),
    followup_notes: text(row[C.feedback]),
    description,
    lost_reason: status === 'LOS' ? (lostText ?? 'Not recorded') : lostText,
    cancel_reason: status === 'CXL' ? (lostText ?? 'Not recorded') : null,
    manual_revenue: revenue || null,
    manual_cost: cost || null,
    contract_value: contractValue || null,
    credit_facility: text(row[C.cf])?.toUpperCase() === 'CF',
    fully_paid_date: isoDate(row[C.paidY], row[C.paidM], row[C.paidD]),
  };

  const cols = Object.keys(fields);
  const values = Object.values(fields);
  const existing = await db.query('SELECT id FROM bookings WHERE booking_no = $1', [bookingNo]);
  let bookingId: string;
  if (existing.rows[0]) {
    bookingId = existing.rows[0].id;
    await db.query(
      `UPDATE bookings SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [bookingId, ...values],
    );
    summary.bookings_updated++;
  } else {
    const { rows } = await db.query(
      `INSERT INTO bookings (tenant_id, booking_no, ${cols.join(', ')})
       VALUES (current_tenant_id(), $1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [bookingNo, ...values],
    );
    bookingId = rows[0].id;
    summary.bookings_created++;
    await db.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, reason)
       VALUES (current_tenant_id(), $1, $2, 'Imported from workbook')`,
      [bookingId, status],
    );

    if (fields.fully_paid_date && (status === 'DEF' || status === 'ACT')) {
      const amount = contractValue || revenue;
      if (amount) {
        await db.query(
          `INSERT INTO payments (tenant_id, booking_id, paid_on, amount, method, reference)
           VALUES (current_tenant_id(), $1, $2, $3, 'BANK', 'Imported: fully paid')`,
          [bookingId, fields.fully_paid_date, amount],
        );
      }
    }
    if (eventDate && spaceId && status !== 'LOS' && status !== 'CXL') {
      await db.query(
        `INSERT INTO booking_events (tenant_id, booking_id, function_space_id, name, start_at, end_at, expected_pax)
         SELECT current_tenant_id(), $1, $2, 'Main event',
                ($3::date + time '18:00') AT TIME ZONE t.timezone,
                ($3::date + time '23:59') AT TIME ZONE t.timezone, $4
         FROM tenants t WHERE t.id = current_tenant_id()`,
        [bookingId, spaceId, eventDate, fields.pax],
      );
    }
  }

  // Payouts and meetings are replaced on every import so re-runs stay in sync.
  await db.query(`DELETE FROM booking_payouts WHERE booking_id = $1`, [bookingId]);
  const payouts: [string, string, number | null, string | null, string | null][] = [
    ['commission', am ?? 'Account manager', num(row[C.commPct]), text(row[C.commStatus]), cellDate(row[C.commPaid])],
    ['share', 'Partner share', num(row[C.sharePct]), text(row[C.shareStatus]), cellDate(row[C.sharePaid])],
    ['share', text(row[C.share1Name]) ?? 'Partner share #1', num(row[C.share1Pct]), null, cellDate(row[C.share1Paid])],
  ];
  for (const [kind, payee, rawPct, st, paidOn] of payouts) {
    if (!rawPct) continue;
    const pct = rawPct > 1 ? rawPct / 100 : rawPct;
    const paid = Boolean(paidOn) || st?.toUpperCase() === 'PAID';
    await db.query(
      `INSERT INTO booking_payouts (tenant_id, booking_id, kind, payee_name, pct, status, paid_on)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6)`,
      [bookingId, kind, payee, pct, paid ? 'paid' : 'pending', paidOn],
    );
  }

  await db.query(`DELETE FROM activities WHERE booking_id = $1 AND subject LIKE 'Meeting #%'`, [bookingId]);
  for (let i = 0; i < 5; i++) {
    const base = C.meetings + i * 6;
    const day = isoDate(row[base], row[base + 1], row[base + 2]);
    if (!day) continue;
    await db.query(
      `INSERT INTO activities (tenant_id, booking_id, contact_id, owner_id, type, subject, due_at, location, notes, completed_at)
       SELECT current_tenant_id(), $1, $2, $3, 'meeting', $4,
              ($5::date + $6::time) AT TIME ZONE t.timezone, $7, $8,
              CASE WHEN ($5::date + $6::time) AT TIME ZONE t.timezone < now()
                   THEN ($5::date + $6::time) AT TIME ZONE t.timezone END
       FROM tenants t WHERE t.id = current_tenant_id()`,
      [bookingId, contactId, fields.owner_id, `Meeting #${i + 1}`, day, parseTime(row[base + 3]),
       text(row[base + 4]), text(row[base + 5])],
    );
    summary.activities_created++;
  }
}

/** Keep generated booking numbers ahead of the imported ones. */
async function bumpSequences(db: Db) {
  await db.query(
    `INSERT INTO booking_sequences (tenant_id, business_unit_id, year, last_value)
     SELECT b.tenant_id, b.business_unit_id, substring(b.booking_no FROM '(\\d{4})\\d{3,}$')::int,
            max(substring(b.booking_no FROM '\\d{4}(\\d{3,})$')::int)
     FROM bookings b JOIN business_units bu ON bu.id = b.business_unit_id
     WHERE b.booking_no ~ ('^' || bu.code || '\\d{7,}$')
     GROUP BY 1, 2, 3
     ON CONFLICT (tenant_id, business_unit_id, year)
     DO UPDATE SET last_value = greatest(booking_sequences.last_value, EXCLUDED.last_value)`,
  );
}

export async function importWorkbook(db: Db, buffer: Buffer | ArrayBuffer): Promise<ImportSummary> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const summary: ImportSummary = {
    bookings_created: 0, bookings_updated: 0, rows_skipped: 0, contacts_created: 0, venues_created: 0,
    users_created: 0, lookups_created: 0, activities_created: 0, errors: [],
  };
  const r = new Resolver(db, summary);

  const par = wb.getWorksheet('PAR');
  if (par) await importPar(par, r);

  const ws = wb.getWorksheet('CONTRACTS') ?? wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no CONTRACTS sheet');

  for (let n = 3; n <= ws.rowCount; n++) {
    const row = (ws.getRow(n).values as Cell[]).slice(1);
    const first = text(row[0]);
    if (first?.toLowerCase() === 'end') break;
    if (!first) continue;
    await db.query('SAVEPOINT import_row');
    try {
      await importContractRow(db, r, row, summary);
      await db.query('RELEASE SAVEPOINT import_row');
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT import_row');
      r.reset();
      summary.errors.push({ row: n, booking_no: first, message: (err as Error).message });
    }
  }
  await bumpSequences(db);
  return summary;
}
