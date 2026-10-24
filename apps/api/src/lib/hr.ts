/**
 * HR module, phase 1: who sees which part of an employee record, the expiry alerts,
 * and the one-time import of the employee register (EMPLOYEE_DB.xlsx).
 *
 * Every workspace has HR basic, the employee directory (BASIC_FIELDS); the HR subscription
 * adds the rest of the record, documents, alerts, requests and the import. Without it the
 * extra data stays stored but is not shown.
 *
 *   see        HR right or levels 1–3: everyone · managers: their team · everyone: their own record
 *   pay        HR right, levels 1–3, and the employee themselves
 *   sensitive  health and criminal record: HR right, owners, and the employee themselves
 *   edit       HR right only; employees ask HR for changes instead
 */
import ExcelJS from 'exceljs';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { withoutTenant, withTenant } from '../db.js';
import { notify } from './notify.js';
import { rightsOf } from './permissions.js';

export const BASIC_FIELDS = [
  'id', 'user_id', 'employee_no', 'first_name', 'last_name', 'initials', 'company', 'branch', 'department_id', 'department',
  'position', 'manager_id', 'manager_name', 'manager_user_id', 'reports_to_text', 'employment_type', 'status',
  'joining_date', 'end_date', 'work_phone', 'work_email', 'user_name', 'user_email', 'created_at', 'updated_at',
] as const;

/** HR basic: only the directory fields. */
export function basicOnly<T extends Record<string, unknown>>(e: T): Partial<T> {
  return Object.fromEntries(Object.entries(e).filter(([k]) => (BASIC_FIELDS as readonly string[]).includes(k))) as Partial<T>;
}

export const PAY_FIELDS = ['salary', 'allowance_extra', 'allowance_housing', 'allowance_ticket', 'allowance_transport'] as const;
export const SENSITIVE_FIELDS = ['chronic_illness', 'allergies', 'criminal_record'] as const;

export interface Viewer { userId: string; role: string; level: number; hr: boolean; teamIds: string[] }
export interface Access { see: boolean; pay: boolean; sensitive: boolean; edit: boolean; own: boolean }

export async function viewerOf(db: Db, req: FastifyRequest): Promise<Viewer> {
  const r = await rightsOf(db, req.user.sub);
  return { userId: req.user.sub, role: req.user.role, level: r.level, hr: r.hr, teamIds: req.scope?.teamIds ?? [req.user.sub] };
}

/** What this person may see of one employee (with the user who manages that employee). */
export function accessTo(v: Viewer, e: { user_id: string | null; manager_user_id?: string | null }): Access {
  const own = Boolean(e.user_id) && e.user_id === v.userId;
  const top = v.hr || v.level <= 3;
  const team = (Boolean(e.user_id) && v.teamIds.includes(e.user_id!)) || e.manager_user_id === v.userId;
  return {
    see: top || own || team,
    pay: top || own,
    sensitive: v.hr || v.role === 'owner' || own,
    edit: v.hr,
    own,
  };
}

/** Blank out what this person may not see. */
export function redact<T extends Record<string, unknown>>(e: T, a: Access): T {
  const out: Record<string, unknown> = { ...e };
  if (!a.pay) for (const f of PAY_FIELDS) out[f] = null;
  if (!a.sensitive) for (const f of SENSITIVE_FIELDS) out[f] = null;
  return out as T;
}

/** Active people with the HR right: they get requests and expiry alerts. */
export async function hrUsers(db: Db): Promise<string[]> {
  const { rows } = await db.query(`SELECT id FROM users WHERE is_active AND email IS NOT NULL`);
  const out: string[] = [];
  for (const u of rows) if ((await rightsOf(db, u.id)).hr) out.push(u.id);
  return out;
}

/** Next free employee number for a joining year: E + year + 3 digits, as in the employee register. */
export async function nextEmployeeNo(db: Db, year: number) {
  const { rows } = await db.query(
    `SELECT max(substr(no, 6)::int) AS last FROM (
       SELECT employee_no AS no FROM employees UNION ALL SELECT employee_no FROM users
     ) x WHERE no ~ $1`, [`^E${year}\\d{3,4}$`]);
  return `E${year}${String((rows[0]?.last ?? 0) + 1).padStart(3, '0')}`;
}

// ---- expiry alerts ------------------------------------------------------------

export const DOC_LABELS: Record<string, string> = {
  civil_id: 'Civil ID', passport: 'Passport', cv: 'CV', work_permit: 'Work permit', medical: 'Medical certificate',
  criminal_record: 'Criminal record certificate', iban: 'IBAN certificate', contract: 'Employment contract', other: 'Document',
};

/** Expiry dates of active employees: on the record and on uploaded documents. */
export async function expiries(db: Db, withinDays: number) {
  const { rows } = await db.query(
    `WITH tz AS (SELECT (now() AT TIME ZONE timezone)::date AS today FROM tenants WHERE id = current_tenant_id()),
     d AS (
       SELECT e.id AS employee_id, 'Civil ID' AS what, e.civil_id_expiry AS expiry FROM employees e WHERE e.status = 'active'
       UNION ALL SELECT e.id, 'Passport', e.passport_expiry FROM employees e WHERE e.status = 'active'
       UNION ALL SELECT e.id, 'Work permit', e.work_permit_expiry FROM employees e WHERE e.status = 'active'
       UNION ALL SELECT d.employee_id, d.kind, d.expiry_date FROM employee_documents d
                 JOIN employees e ON e.id = d.employee_id AND e.status = 'active'
     )
     SELECT DISTINCT ON (d.employee_id, d.what, d.expiry) d.employee_id, d.what, d.expiry, d.expiry - tz.today AS days_left,
            e.first_name, e.last_name, e.employee_no, e.user_id,
            coalesce(m.user_id, u.manager_id) AS manager_user_id
     FROM d CROSS JOIN tz
     JOIN employees e ON e.id = d.employee_id
     LEFT JOIN employees m ON m.id = e.manager_id
     LEFT JOIN users u ON u.id = e.user_id
     WHERE d.expiry IS NOT NULL AND d.expiry - tz.today <= $1
     ORDER BY d.employee_id, d.what, d.expiry`, [withinDays]);
  return rows.map((r) => ({ ...r, what: DOC_LABELS[r.what] ?? r.what })) as {
    employee_id: string; what: string; expiry: string; days_left: number; first_name: string; last_name: string | null;
    employee_no: string; user_id: string | null; manager_user_id: string | null;
  }[];
}

const STAGES = [0, 30, 60];

/** Warn HR and the employee's manager 60 and 30 days before an expiry, and when it has expired. Once per stage. */
export async function checkExpiries(db: Db) {
  const hr = await hrUsers(db);
  let sent = 0;
  for (const x of await expiries(db, 60)) {
    const stage = STAGES.find((s) => x.days_left <= s)!;
    const { rows } = await db.query(
      `INSERT INTO employee_alerts (employee_id, what, expiry, stage) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING 1`, [x.employee_id, x.what, x.expiry, stage]);
    if (!rows[0]) continue;
    const name = `${[x.first_name, x.last_name].filter(Boolean).join(' ')} (${x.employee_no})`;
    const [y, m, d] = x.expiry.split('-');
    const text = x.days_left < 0 ? `${x.what} of ${name} expired on ${d}/${m}/${y}`
      : x.days_left === 0 ? `${x.what} of ${name} expires today`
        : `${x.what} of ${name} expires on ${d}/${m}/${y} (in ${x.days_left} days)`;
    for (const userId of new Set([...hr, ...(x.manager_user_id ? [x.manager_user_id] : [])])) {
      await notify(db, userId, text, `/hr/${x.employee_id}`);
    }
    sent++;
  }
  return sent;
}

/** Run the check in every workspace that has HR. Called by the server every few hours. */
export async function checkAllExpiries() {
  const tenants: string[] = await withoutTenant(async (db) => (await db.query('SELECT hr_tenants() AS id')).rows.map((r) => r.id));
  for (const id of tenants) await withTenant(id, checkExpiries).catch(() => undefined);
}

// ---- import of the employee register --------------------------------------------

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
/** Column headers of EMPLOYEE_DB.xlsx (sheet DB) → record fields. */
const COLUMNS: Record<string, string> = {
  EMPLOYEE: 'employee_no', ABR: 'initials', FIRSTNAME: 'first_name', LASTNAME: 'last_name', COMPANY: 'company',
  BRANCH: 'branch', POSITION: 'position', REPORTTO: 'reports_to_text', EMPLTYPE: 'employment_type', STATUS: 'status',
  NATIONALITY: 'nationality', CIVILID: 'civil_id', CIDEXPIRYDT: 'civil_id_expiry', SPONSOR: 'sponsor', PASSPORT: 'passport_no',
  PPEXPIRYDT: 'passport_expiry', SALARY: 'salary', EXTRA: 'allowance_extra', HOUSING: 'allowance_housing',
  TICKET: 'allowance_ticket', TRANSP: 'allowance_transport', STARTINGDT: 'joining_date', ENDDT: 'end_date', REASON: 'end_reason',
  IQAMATRDT: 'iqama_transfer_date', IQAMACXDT: 'iqama_cancel_date', PHONEKW: 'phone_kw', PHONEHOME: 'phone_home',
  EMAILPERSO: 'email_personal', BD: 'birth_date', MARITAL: 'marital_status', KIDS: 'children',
};
const DATES = new Set(['civil_id_expiry', 'passport_expiry', 'joining_date', 'end_date', 'iqama_transfer_date', 'iqama_cancel_date', 'birth_date']);
const NUMBERS = new Set(['salary', 'allowance_extra', 'allowance_housing', 'allowance_ticket', 'allowance_transport', 'children']);

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if ('richText' in v) return v.richText.map((p) => p.text).join('');
  }
  return v;
}

function toDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(v ?? '').trim().match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

export async function importEmployees(db: Db, data: Buffer, userId: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('DB') ?? wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets');
  const header = new Map<number, string>();
  ws.getRow(1).eachCell((c, col) => { const f = COLUMNS[norm(cellValue(c.value))]; if (f && ![...header.values()].includes(f)) header.set(col, f); });
  const summary = { created: 0, updated: 0, skipped: 0 };
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, unknown> = {};
    for (const [col, f] of header) {
      const raw = cellValue(row.getCell(col).value);
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      if (DATES.has(f)) rec[f] = toDate(raw);
      else if (NUMBERS.has(f)) { const n = Number(String(raw).replace(/[^0-9.-]/g, '')); if (Number.isFinite(n)) rec[f] = n; }
      else rec[f] = String(raw).trim();
    }
    const no = String(rec.employee_no ?? '').toUpperCase();
    if (!/^E\d{7,8}$/.test(no) || !rec.first_name) { summary.skipped++; continue; }
    rec.employee_no = no;
    rec.status = String(rec.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'inactive';
    const cols = Object.keys(rec);
    const { rows } = await db.query(
      `INSERT INTO employees (${cols.join(', ')}, user_id, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')},
               (SELECT id FROM users WHERE employee_no = $${cols.indexOf('employee_no') + 1}), $${cols.length + 1})
       ON CONFLICT (tenant_id, employee_no) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
       RETURNING (xmax = 0) AS created`,
      [...cols.map((c) => rec[c]), userId]);
    if (rows[0].created) summary.created++; else summary.updated++;
  }
  // "Report to" holds a position (e.g. CEO): link the manager when exactly one employee has it.
  await db.query(
    `UPDATE employees e SET manager_id = m.id
     FROM (SELECT upper(position) AS position, min(id::text)::uuid AS id FROM employees
           WHERE status = 'active' AND position IS NOT NULL GROUP BY upper(position) HAVING count(*) = 1) m
     WHERE e.manager_id IS NULL AND upper(e.reports_to_text) = m.position AND e.id <> m.id`);
  return summary;
}
