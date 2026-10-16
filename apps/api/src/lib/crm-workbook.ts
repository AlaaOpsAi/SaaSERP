/**
 * The customer's CRM workbook (DB_CRM_Segm, sheet DB): import it into the CRM and
 * export the CRM back in exactly the same 56 columns, in the same order.
 *
 * One row = one business relationship of a customer (the same email can appear on
 * several rows). Rows with the same email become one customer with several
 * relationships; an email or mobile already in the CRM adds to that customer.
 */
import ExcelJS from 'exceljs';
import type { Db } from '../db.js';
import { contactName } from './contact.js';
import { findDuplicate } from './customers.js';
import { badRequest } from './errors.js';

/** Row 2 of sheet DB, exactly as in the workbook. */
export const DB_HEADERS = [
  'CID', '?x', 'REL', 'SEGM', 'Y\nREG', 'M\nREG', 'D\nREG', 'Title', 'First & Middle \nName', 'Last Name', 'Position | Profession', 'CO Name',
  'P | C', 'M | F', 'Nationality (Country)', 'Cntry\nCODE', 'TEL 1', 'Cntry\nCODE', 'TEL 2', 'EMAIL', 'Cntry\nCODE', 'TEL Fix',
  'Country (ADDR.)', 'City', 'ZIP\nCODE', 'Address Details', ' Web Page', 'ID | COREG', 'CO License Number', 'Y\nB|E', 'M\nB|E', 'D\nB|E',
  'AGE', 'LOC Birth \n| Establish.', 'Highest \nEDU Degree', 'Degree #1 INDUSTRY', 'Degree #2 INDUSTRY', 'Degree NAME', 'Degree obtained (Y)',
  'Degree Country', 'Y of\nExp', 'MGR\nExp.\n', 'Companies worked for', 'Fields of Experience', 'Languages + Level', 'Driving License',
  'NEWS Letter', 'Contact MODE', 'USER', 'CONTR ID', 'Comments', 'EMAIL CTRL', 'CID ASSIST', 'CID COPY', 'REPETED CID', 'ALERT !!!',
] as const;

// The three "Cntry CODE" columns sit right before the number they belong to.
const COL = {
  cid: 0, rel: 2, segm: 3, regY: 4, regM: 5, regD: 6, title: 7, first: 8, last: 9, position: 10, company: 11, pc: 12, gender: 13,
  nationality: 14, code1: 15, tel1: 16, code2: 17, tel2: 18, email: 19, code3: 20, landline: 21, country: 22, city: 23, zip: 24,
  address: 25, web: 26, idReg: 27, license: 28, beY: 29, beM: 30, beD: 31, age: 32, birthPlace: 33, edu: 34, deg1: 35, deg2: 36,
  degName: 37, degYear: 38, degCountry: 39, yearsExp: 40, mgrExp: 41, companies: 42, fields: 43, languages: 44, driving: 45,
  news: 46, mode: 47, user: 48, contract: 49, comments: 50,
} as const;

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function cellValue(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('error' in v) return null;
  }
  const s = String(v).trim();
  return s === '' || s === 'end' || s === '#N/A' ? null : s;
}

/**
 * "A B D U L A Z I Z" → "ABDULAZIZ": names typed with spaces between the letters
 * (mostly single letters) are joined. Each change is listed in the import report to check.
 */
export function cleanName(s: string | null): { value: string | null; changed: boolean } {
  if (!s) return { value: null, changed: false };
  const trimmed = s.replace(/\s+/g, ' ').trim();
  const parts = trimmed.split(' ');
  const singles = parts.filter((p) => p.length === 1).length;
  const value = parts.length >= 3 && singles / parts.length >= 0.5 ? parts.join('') : trimmed;
  return { value, changed: value !== trimmed };
}

const phoneOf = (code: string | null, number: string | null) => {
  if (!number) return null;
  const n = number.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) return n;
  return code ? `+${code.replace(/\D/g, '')} ${n}` : n;
};
const ymd = (y: string | null, m: string | null, d: string | null) => {
  const Y = Number(y), M = Number(m || 1), D = Number(d || 1);
  if (!Y || Y < 1900 || Y > 2100 || M < 1 || M > 12 || D < 1 || D > 31) return null;
  return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
};
const yes = (v: string | null) => (v ? /^(yes|y|1|true)$/i.test(v) : false);

export interface CrmImportReport {
  rows: number; people_created: number; companies_created: number; merged: number; relationships: number; applicants: number;
  cleaned_names: string[]; unknown_users: string[]; unknown_contracts: string[]; skipped: string[];
}

export async function importCrmWorkbook(db: Db, buffer: Buffer, actorId: string): Promise<CrmImportReport> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw badRequest('This is not an Excel workbook (.xlsx)'); }
  // The sheet whose second row starts with CID (normally "DB").
  const ws = wb.worksheets.find((s) => norm(s.getRow(2).getCell(1).value) === 'cid' && norm(s.getRow(2).getCell(3).value) === 'rel');
  if (!ws) throw badRequest('No sheet with the CRM layout (row 2: CID, ?x, REL, SEGM…) was found');
  const headers = (ws.getRow(2).values as ExcelJS.CellValue[]).slice(1).map(norm);
  const expected = DB_HEADERS.map(norm);
  const missing = ['cid', 'rel', 'email', 'tel 1', 'p | c'].filter((h) => !headers.includes(h));
  if (missing.length) throw badRequest(`Columns missing in row 2: ${missing.join(', ')}`);
  if (headers.slice(0, 51).join('|') !== expected.slice(0, 51).join('|')) {
    throw badRequest('The columns are not in the CRM workbook order (DB_CRM_Segm, sheet DB). Keep the columns as they are.');
  }

  const lookups = (await db.query(`SELECT type, code, label FROM lookups WHERE type IN ('relation', 'segment', 'industry', 'title', 'contact_mode', 'education')`)).rows;
  const code = (type: string, v: string | null) => {
    if (!v) return null;
    const hit = lookups.find((l) => l.type === type && (norm(l.code) === norm(v) || norm(l.label) === norm(v)));
    return hit?.code ?? v;
  };
  const users = (await db.query('SELECT id, name, code FROM users')).rows;
  const report: CrmImportReport = { rows: 0, people_created: 0, companies_created: 0, merged: 0, relationships: 0, applicants: 0, cleaned_names: [], unknown_users: [], unknown_contracts: [], skipped: [] };
  const seen = new Map<string, { kind: 'contacts' | 'accounts'; id: string }>();

  for (let r = 3; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values as ExcelJS.CellValue[];
    const v = (i: number) => cellValue(raw[i + 1]);
    const first = cleanName(v(COL.first));
    const last = cleanName(v(COL.last));
    const email = v(COL.email)?.toLowerCase() ?? null;
    const phone = phoneOf(v(COL.code1), v(COL.tel1));
    const isCompany = v(COL.pc)?.toUpperCase() === 'C';
    const companyName = v(COL.company);
    if (!first.value && !last.value && !email && !(isCompany && companyName)) continue;
    report.rows++;
    if (!email && !phone) { report.skipped.push(`Row ${r}: no email and no mobile`); continue; }
    for (const n of [first, last]) if (n.changed) report.cleaned_names.push(`Row ${r}: ${n.value}`);

    const relation = code('relation', v(COL.rel)) ?? 'CLIENT';
    const isApplicant = relation === 'APPL';
    const segment = code('segment', v(COL.segm));
    const userText = v(COL.user);
    const user = userText ? users.find((u) => norm(u.code) === norm(userText) || norm(u.name) === norm(userText) || norm(u.name).split(' ')[0] === norm(userText)) : null;
    if (userText && !user && !report.unknown_users.includes(userText)) report.unknown_users.push(userText);
    const contractNo = v(COL.contract);
    const booking = contractNo ? (await db.query('SELECT id FROM bookings WHERE booking_no = $1', [contractNo])).rows[0] : null;
    if (contractNo && !booking && !report.unknown_contracts.includes(contractNo)) report.unknown_contracts.push(contractNo);

    const shared = {
      phone, mobile2: phoneOf(v(COL.code2), v(COL.tel2)), landline: phoneOf(v(COL.code3), v(COL.landline)), email,
      country: v(COL.country), city: v(COL.city), zip: v(COL.zip), address: v(COL.address), web: v(COL.web),
      segment, newsletter: yes(v(COL.news)), contact_mode: code('contact_mode', v(COL.mode)), legacy_no: v(COL.cid),
    };

    // Same email in this file, or already a customer: one customer, another relationship.
    const key = email ?? phone!;
    let target = seen.get(key) ?? null;
    if (!target) {
      const dup = await findDuplicate(db, { email, phone });
      if (dup) target = { kind: dup.kind, id: dup.id };
      if (target) report.merged++;
    } else report.merged++;

    if (!target) {
      if (isCompany) {
        const { rows } = await db.query(
          `INSERT INTO accounts (tenant_id, name, kind, phone, mobile2, landline, email, country, city, zip, address, web, segment, newsletter,
                                 newsletter_at, contact_mode, legacy_no, registration_no, license_no, established_on, created_by)
           VALUES (current_tenant_id(), $1, 'company', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $12 THEN now() END, $13, $14, $15, $16, $17, $18)
           RETURNING id`,
          [companyName ?? contactName({ first_name: first.value, family_name: last.value }), shared.phone, shared.mobile2, shared.landline, shared.email,
            shared.country, shared.city, shared.zip, shared.address, shared.web, shared.segment, shared.newsletter, shared.contact_mode, shared.legacy_no,
            v(COL.idReg), v(COL.license), ymd(v(COL.beY), v(COL.beM), v(COL.beD)), user?.id ?? actorId]);
        target = { kind: 'accounts', id: rows[0].id };
        report.companies_created++;
      } else {
        // An applicant's company is where they work now (kept on the profile), not a customer.
        let accountId: string | null = null;
        if (companyName && !isApplicant) {
          const found = (await db.query('SELECT id FROM accounts WHERE lower(name) = lower($1) LIMIT 1', [companyName])).rows[0];
          accountId = found?.id ?? (await db.query(
            `INSERT INTO accounts (tenant_id, name, kind, created_by) VALUES (current_tenant_id(), $1, 'company', $2) RETURNING id`, [companyName, user?.id ?? actorId])).rows[0].id;
          if (!found) report.companies_created++;
        }
        const name = contactName({ first_name: first.value, family_name: last.value }) || email!;
        const { rows } = await db.query(
          `INSERT INTO contacts (tenant_id, name, first_name, family_name, title, gender, position, account_id, nationality, phone, mobile2, landline,
                                 email, country, city, zip, address, web, civil_id, birth_date, segment, newsletter, newsletter_at, contact_mode, legacy_no, created_by)
           VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                   CASE WHEN $21 THEN now() END, $22, $23, $24)
           RETURNING id`,
          [name, first.value, last.value, code('title', v(COL.title)), ['M', 'F'].includes(v(COL.gender)?.toUpperCase() ?? '') ? v(COL.gender)!.toUpperCase() : null,
            v(COL.position), accountId, v(COL.nationality), shared.phone, shared.mobile2, shared.landline, shared.email, shared.country, shared.city,
            shared.zip, shared.address, shared.web, v(COL.idReg), ymd(v(COL.beY), v(COL.beM), v(COL.beD)), shared.segment, shared.newsletter,
            shared.contact_mode, shared.legacy_no, user?.id ?? actorId]);
        target = { kind: 'contacts', id: rows[0].id };
        report.people_created++;
      }
    }
    seen.set(key, target);

    const column = target.kind === 'contacts' ? 'contact_id' : 'account_id';
    const exists = (await db.query(
      `SELECT 1 FROM customer_relationships WHERE ${column} = $1 AND relation = $2 AND booking_id IS NOT DISTINCT FROM $3`,
      [target.id, relation, booking?.id ?? null])).rows[0];
    if (!exists) {
      const comments = [v(COL.comments), userText && !user ? `Registered by ${userText}` : null, contractNo && !booking ? `Contract ${contractNo}` : null]
        .filter(Boolean).join(' · ') || null;
      await db.query(
        `INSERT INTO customer_relationships (tenant_id, ${column}, relation, segment, booking_id, registered_on, registered_by, comments)
         VALUES (current_tenant_id(), $1, $2, $3, $4, coalesce($5::date, current_date), $6, $7)`,
        [target.id, relation, segment, booking?.id ?? null, ymd(v(COL.regY), v(COL.regM), v(COL.regD)), user?.id ?? null, comments]);
      report.relationships++;
    }

    const hasProfile = [COL.edu, COL.deg1, COL.degName, COL.degYear, COL.yearsExp, COL.companies, COL.fields, COL.languages, COL.driving].some((i) => v(i));
    if (target.kind === 'contacts' && (isApplicant || hasProfile)) {
      await db.query(
        `INSERT INTO applicant_profiles (tenant_id, contact_id, education, degree_industry, degree_industry2, degree_name, degree_year, degree_country,
                                         years_experience, manager_experience, companies, experience_fields, languages, driving_license, updated_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (contact_id) DO UPDATE SET
           education = coalesce(EXCLUDED.education, applicant_profiles.education), degree_industry = coalesce(EXCLUDED.degree_industry, applicant_profiles.degree_industry),
           degree_industry2 = coalesce(EXCLUDED.degree_industry2, applicant_profiles.degree_industry2), degree_name = coalesce(EXCLUDED.degree_name, applicant_profiles.degree_name),
           degree_year = coalesce(EXCLUDED.degree_year, applicant_profiles.degree_year), degree_country = coalesce(EXCLUDED.degree_country, applicant_profiles.degree_country),
           years_experience = coalesce(EXCLUDED.years_experience, applicant_profiles.years_experience),
           manager_experience = coalesce(EXCLUDED.manager_experience, applicant_profiles.manager_experience),
           companies = coalesce(EXCLUDED.companies, applicant_profiles.companies), experience_fields = coalesce(EXCLUDED.experience_fields, applicant_profiles.experience_fields),
           languages = coalesce(EXCLUDED.languages, applicant_profiles.languages), driving_license = coalesce(EXCLUDED.driving_license, applicant_profiles.driving_license),
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [target.id, code('education', v(COL.edu)), v(COL.deg1), v(COL.deg2), v(COL.degName), Number(v(COL.degYear)) || null, v(COL.degCountry),
          v(COL.yearsExp) !== null && !Number.isNaN(Number(v(COL.yearsExp))) ? Number(v(COL.yearsExp)) : null,
          v(COL.mgrExp) ? yes(v(COL.mgrExp)) : null,
          [v(COL.companies), isApplicant && companyName ? `${companyName}${v(COL.position) ? ` (${v(COL.position)})` : ''}` : null].filter(Boolean).join('; ') || null,
          v(COL.fields), v(COL.languages), v(COL.driving), actorId]);
      report.applicants++;
    }
  }
  return report;
}

/** The CRM in the workbook's DB layout: one row per relationship, same 56 columns. */
export async function exportCrmWorkbook(db: Db): Promise<Buffer> {
  const { rows } = await db.query(`
    WITH customers AS (
      SELECT 'P' AS pc, c.id, c.customer_no, c.title, c.first_name, c.family_name, c.name, c.position, a.name AS company, c.gender, c.nationality,
             c.phone, c.mobile2, c.landline, c.email, c.country, c.city, c.zip, c.address, c.web, c.civil_id AS id_reg, NULL::text AS license_no,
             c.birth_date AS be_date, c.segment, c.newsletter, c.contact_mode, c.created_at, c.created_by
      FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
      UNION ALL
      SELECT 'C', a.id, a.customer_no, NULL, NULL, NULL, a.name, NULL, a.name, NULL, a.country,
             a.phone, a.mobile2, a.landline, a.email, a.country, a.city, a.zip, a.address, a.web, a.registration_no, a.license_no,
             a.established_on, a.segment, a.newsletter, a.contact_mode, a.created_at, a.created_by
      FROM accounts a)
    SELECT x.*, r.relation, coalesce(r.segment, x.segment) AS rel_segment, coalesce(r.registered_on, x.created_at::date) AS registered_on,
           coalesce(ru.code, ru.name, cu.code, cu.name) AS user_code, b.booking_no, r.comments,
           t.label AS title_label, sg.label AS segment_label, cm.label AS mode_label,
           p.education, p.degree_industry, p.degree_industry2, p.degree_name, p.degree_year, p.degree_country, p.years_experience,
           p.manager_experience, p.companies, p.experience_fields, p.languages, p.driving_license
    FROM customers x
    LEFT JOIN customer_relationships r ON (x.pc = 'P' AND r.contact_id = x.id) OR (x.pc = 'C' AND r.account_id = x.id)
    LEFT JOIN users ru ON ru.id = r.registered_by LEFT JOIN users cu ON cu.id = x.created_by
    LEFT JOIN bookings b ON b.id = r.booking_id
    LEFT JOIN applicant_profiles p ON x.pc = 'P' AND p.contact_id = x.id
    LEFT JOIN lookups t ON t.type = 'title' AND t.code = x.title
    LEFT JOIN lookups sg ON sg.type = 'segment' AND sg.code = coalesce(r.segment, x.segment)
    LEFT JOIN lookups cm ON cm.type = 'contact_mode' AND cm.code = x.contact_mode
    ORDER BY x.customer_no, registered_on`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DB');
  ws.addRow(DB_HEADERS.map((_, i) => i + 1));
  ws.addRow([...DB_HEADERS]);
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).alignment = { wrapText: true, vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  const split = (p: string | null) => {
    if (!p) return [null, null];
    const m = /^\+(\d{1,4})\s+(.+)$/.exec(p);
    return m ? [m[1], m[2]] : [null, p];
  };
  const emails = new Map<string, number>();
  rows.forEach((x) => x.email && emails.set(x.email, (emails.get(x.email) ?? 0) + 1));
  rows.forEach((x, i) => {
    const reg = x.registered_on ? new Date(x.registered_on) : null;
    const be = x.be_date ? new Date(x.be_date) : null;
    const [c1, t1] = split(x.phone); const [c2, t2] = split(x.mobile2); const [c3, t3] = split(x.landline);
    const age = be ? Math.floor((Date.now() - be.getTime()) / (365.25 * 86_400_000)) : null;
    ws.addRow([
      x.customer_no, 1, x.relation, x.segment_label ?? x.rel_segment, reg?.getFullYear() ?? null, reg ? reg.getMonth() + 1 : null, reg?.getDate() ?? null,
      x.title_label ?? x.title, x.pc === 'P' ? (x.first_name ?? x.name) : null, x.pc === 'P' ? x.family_name : null, x.position, x.company, x.pc, x.gender,
      x.nationality, c1, t1, c2, t2, x.email, c3, t3, x.country, x.city, x.zip, x.address, x.web, x.id_reg, x.license_no,
      be?.getFullYear() ?? null, be ? be.getMonth() + 1 : null, be?.getDate() ?? null, age, null,
      x.education, x.degree_industry, x.degree_industry2, x.degree_name, x.degree_year, x.degree_country, x.years_experience === null ? null : Number(x.years_experience),
      x.manager_experience === null ? null : x.manager_experience ? 'YES' : 'NO', x.companies, x.experience_fields, x.languages, x.driving_license,
      x.newsletter ? 'YES' : 'NO', x.mode_label ?? x.contact_mode, x.user_code, x.booking_no, x.comments,
      x.email ? (emails.get(x.email) ?? 1) - 1 : 0, i, x.customer_no, null, null,
    ]);
  });
  ws.columns.forEach((c, i) => { c.width = [0, 2, 12, 13, 14].includes(i) ? 8 : 16; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
