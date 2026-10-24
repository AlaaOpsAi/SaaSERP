import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import type { Db } from '../db.js';
import { logAccess } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import {
  accessTo, BASIC_FIELDS, basicOnly, checkExpiries, DOC_LABELS, expiries, hrUsers, importEmployees, nextEmployeeNo, redact, viewerOf, type Viewer,
} from '../lib/hr.js';
import { hasModule, requireModule } from '../lib/modules.js';
import { notify } from '../lib/notify.js';
import { requireRight } from '../lib/permissions.js';
import { cleanName, MIME, removeStored, saveFile, sniff } from '../lib/storage.js';
import { uploaded } from './documents.js';

/**
 * HR module, phase 1: employee records, their documents, change requests and expiry alerts.
 * HR basic (every workspace): the directory and org chart, edited by HR. HR full (subscription):
 * the whole record, documents, alerts, requests and the import. Who sees what is in lib/hr.ts.
 */
const id = z.object({ id: z.string().uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const text = (max = 200) => z.string().trim().max(max).nullable().transform((v) => v || null);
const money = z.number().min(0).max(1e9).nullable();
const contact = z.object({ name: text(120), relation: text(60), address: text(300), phone: text(40) });

const employeeSchema = z.object({
  user_id: z.string().uuid().nullable(),
  employee_no: z.string().trim().toUpperCase().regex(/^E\d{7,8}$/, 'Use an employee ID like E2026001').nullable(),
  first_name: z.string().trim().min(1).max(80),
  last_name: text(80), initials: text(10), company: text(80), branch: text(80),
  department_id: z.string().uuid().nullable(), position: text(120), manager_id: z.string().uuid().nullable(),
  employment_type: text(40), status: z.enum(['active', 'inactive']),
  joining_date: date, end_date: date, end_reason: text(200),
  nationality: text(60), civil_id: text(40), civil_id_expiry: date, sponsor: text(120), passport_no: text(40),
  passport_expiry: date, work_permit_expiry: date, iqama_transfer_date: date, iqama_cancel_date: date,
  gender: z.enum(['F', 'M']).nullable(), birth_date: date, birth_place: text(80), marital_status: text(40),
  religion: text(40), children: z.number().int().min(0).max(30).nullable(), education: text(120), major: text(120),
  work_phone: text(40), work_email: text(160), driving_license: text(80), chronic_illness: text(500), allergies: text(500), criminal_record: text(500),
  address_kw: text(300), phone_kw: text(40), email_personal: text(160), address_home: text(300), phone_home: text(40), email_home: text(160),
  emergency_contacts: z.array(contact).max(2),
  salary: money, allowance_extra: money, allowance_housing: money, allowance_ticket: money, allowance_transport: money,
  notes: text(2000),
}).partial();

const SELECT = `
  SELECT e.*, d.name AS department, m.first_name || coalesce(' ' || m.last_name, '') AS manager_name, m.user_id AS manager_user_id,
         u.name AS user_name, u.email AS user_email
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees m ON m.id = e.manager_id
  LEFT JOIN users u ON u.id = e.user_id`;

type Row = Record<string, unknown> & { id: string; user_id: string | null; manager_user_id: string | null };

async function load(db: Db, v: Viewer, employeeId: string) {
  const e = (await db.query<Row>(`${SELECT} WHERE e.id = $1`, [employeeId])).rows[0];
  if (!e) throw notFound('Employee');
  const access = accessTo(v, e);
  if (!access.see) throw notFound('Employee');
  return { e, access };
}

/** HR staff, in HR basic or full. */
async function hrStaff(db: Db, req: FastifyRequest) {
  await requireRight(db, req.user.sub, 'hr');
}

/** HR staff, with the HR subscription. */
async function hrFull(db: Db, req: FastifyRequest) {
  await requireModule(db, 'hr');
  await requireRight(db, req.user.sub, 'hr');
}

/** Without the HR subscription only the directory fields are written. */
function forTier<T extends Record<string, unknown>>(body: T, full: boolean): T {
  if (full) return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => (BASIC_FIELDS as readonly string[]).includes(k))) as T;
}

export async function hrRoutes(app: FastifyInstance) {
  // The directory: everyone for HR and levels 1–3, the team for managers, oneself for everyone else.
  // People with a sign-in but no HR record yet are listed too, so the directory is complete.
  app.get('/hr/employees', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const full = await hasModule(db, 'hr');
      const v = await viewerOf(db, req);
      const rows = (await db.query<Row>(`${SELECT} ORDER BY e.status, e.first_name, e.last_name`)).rows;
      const users = (await db.query(
        `SELECT u.id AS user_id, u.name, u.employee_no, u.job_title, u.email, u.manager_id, d.name AS department, m.name AS manager_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.is_active AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id)
         ORDER BY u.name`)).rows;
      const soon = new Map<string, number>();
      if (full) for (const x of await expiries(db, 60)) soon.set(x.employee_id, Math.min(soon.get(x.employee_id) ?? 999, x.days_left));
      // Org chart: each person's place under their manager (HR "reports to", else the sign-in's manager).
      const keyOfUser = new Map<string, string>([...rows.filter((e) => e.user_id).map((e) => [e.user_id!, e.id] as [string, string]),
        ...users.map((u) => [u.user_id, `u:${u.user_id}`] as [string, string])]);
      const userManager = new Map<string, string | null>(
        (await db.query('SELECT id, manager_id FROM users')).rows.map((u) => [u.id, u.manager_id]));
      const list = [
        ...rows.map((e) => ({ e, a: accessTo(v, e) })).filter(({ a }) => a.see).map(({ e, a }) => {
          const r = redact(e, a);
          const managerUser = e.user_id ? userManager.get(e.user_id) : null;
          return {
            key: r.id, id: r.id, employee_no: r.employee_no, first_name: r.first_name, last_name: r.last_name, company: r.company,
            branch: r.branch, department: r.department, position: r.position, manager_name: r.manager_name,
            employment_type: r.employment_type, status: r.status, joining_date: r.joining_date, work_phone: r.work_phone,
            work_email: r.work_email ?? r.user_email, user_id: r.user_id,
            parent_key: (r.manager_id as string | null) ?? (managerUser ? keyOfUser.get(managerUser) ?? null : null),
            nationality: full ? r.nationality : null, salary: full ? r.salary : null, expiring_in: soon.get(r.id) ?? null,
          };
        }),
        ...users.filter((u) => accessTo(v, { user_id: u.user_id, manager_user_id: u.manager_id }).see).map((u) => ({
          key: `u:${u.user_id}`, id: null, employee_no: u.employee_no, first_name: u.name, last_name: null, company: null, branch: null,
          department: u.department, position: u.job_title, manager_name: u.manager_name, employment_type: null, status: 'active',
          joining_date: null, work_phone: null, work_email: u.email, user_id: u.user_id,
          parent_key: u.manager_id ? keyOfUser.get(u.manager_id) ?? null : null, nationality: null, salary: null, expiring_in: null,
        })),
      ];
      return { tier: full ? 'full' : 'basic', can_edit: v.hr, employees: list };
    }),
  );

  app.get('/hr/employees/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const full = await hasModule(db, 'hr');
      const v = await viewerOf(db, req);
      const { e, access } = await load(db, v, id.parse(req.params).id);
      if (!full) {
        return { ...basicOnly(e), emergency_contacts: [], documents: [], requests: [], expiring: [], access: { ...access, pay: false, sensitive: false }, tier: 'basic' };
      }
      await logAccess(db, req.user.sub, 'view_employee', `${e.first_name} ${e.last_name ?? ''} (${e.employee_no})`.replace(/\s+/g, ' '), req.ip);
      const documents = (await db.query(
        `SELECT d.id, d.kind, d.number, d.expiry_date, d.file_name, d.mime, d.size_bytes, d.uploaded_at, u.name AS uploaded_by_name
         FROM employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.employee_id = $1 ORDER BY d.uploaded_at DESC`, [e.id])).rows;
      const requests = (await db.query(
        `SELECT r.id, r.text, r.status, r.requested_at, r.resolved_at, u.name AS requested_by_name, h.name AS resolved_by_name
         FROM employee_requests r LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users h ON h.id = r.resolved_by
         WHERE r.employee_id = $1 ORDER BY r.requested_at DESC`, [e.id])).rows;
      const soon = (await expiries(db, 60)).filter((x) => x.employee_id === e.id).map(({ what, expiry, days_left }) => ({ what, expiry, days_left }));
      return { ...redact(e, access), documents, requests, expiring: soon, access, tier: 'full' };
    }),
  );

  // Pick-lists for the form: sign-ins not yet linked, and possible managers.
  app.get('/hr/options', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrStaff(db, req);
      const users = (await db.query(
        `SELECT u.id, u.name, u.employee_no FROM users u
         WHERE u.is_active AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id) ORDER BY u.name`)).rows;
      const managers = (await db.query(
        `SELECT id, first_name || coalesce(' ' || last_name, '') AS name, employee_no, position FROM employees
         WHERE status = 'active' ORDER BY first_name`)).rows;
      return { users, managers, document_kinds: DOC_LABELS };
    }),
  );

  app.post('/hr/employees', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrStaff(db, req);
      const body = forTier(employeeSchema.required({ first_name: true }).parse(req.body), await hasModule(db, 'hr'));
      let no = body.employee_no;
      if (!no && body.user_id) no = (await db.query('SELECT employee_no FROM users WHERE id = $1', [body.user_id])).rows[0]?.employee_no ?? null;
      if (!no) no = await nextEmployeeNo(db, Number((body.joining_date ?? new Date().toISOString()).slice(0, 4)));
      if ((await db.query('SELECT 1 FROM employees WHERE employee_no = $1', [no])).rows[0]) throw badRequest(`${no} already has an employee record`);
      const rec: Record<string, unknown> = { ...body, employee_no: no, created_by: req.user.sub };
      if (body.emergency_contacts) rec.emergency_contacts = JSON.stringify(body.emergency_contacts);
      const cols = Object.keys(rec).filter((k) => rec[k] !== undefined);
      const { rows } = await db.query(
        `INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((c) => rec[c]));
      return { id: rows[0].id, employee_no: no };
    }),
  );

  app.patch('/hr/employees/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrStaff(db, req);
      const employeeId = id.parse(req.params).id;
      const body = forTier(employeeSchema.parse(req.body), await hasModule(db, 'hr'));
      if (body.manager_id === employeeId) throw badRequest('An employee cannot report to themselves');
      if (body.employee_no && (await db.query('SELECT 1 FROM employees WHERE employee_no = $1 AND id <> $2', [body.employee_no, employeeId])).rows[0]) {
        throw badRequest(`${body.employee_no} already has an employee record`);
      }
      const rec: Record<string, unknown> = { ...body };
      if (body.emergency_contacts) rec.emergency_contacts = JSON.stringify(body.emergency_contacts);
      const cols = Object.keys(rec).filter((k) => rec[k] !== undefined);
      if (!cols.length) return { ok: true };
      const { rowCount } = await db.query(
        `UPDATE employees SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [employeeId, ...cols.map((c) => rec[c])]);
      if (!rowCount) throw notFound('Employee');
      return { ok: true };
    }),
  );

  // ---- documents ---------------------------------------------------------------
  app.post('/hr/employees/:id/documents', { preHandler: authed }, async (req) => {
    const employeeId = id.parse(req.params).id;
    const q = z.object({
      kind: z.enum(Object.keys(DOC_LABELS) as [string, ...string[]]),
      number: z.string().trim().max(60).optional(),
      expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query);
    const file = await uploaded(req);
    const type = sniff(file.data);
    if (type !== 'pdf' && type !== 'jpg' && type !== 'png') throw badRequest('Upload a picture (JPEG or PNG) or a PDF');
    return tx(req, async (db) => {
      await hrFull(db, req);
      if (!(await db.query('SELECT 1 FROM employees WHERE id = $1', [employeeId])).rows[0]) throw notFound('Employee');
      const key = await saveFile(req.user.tid, file.data, type);
      const { rows } = await db.query(
        `INSERT INTO employee_documents (employee_id, kind, number, expiry_date, file_name, mime, size_bytes, storage_key, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, kind, number, expiry_date, file_name, mime, size_bytes, uploaded_at`,
        [employeeId, q.kind, q.number ?? null, q.expiry_date ?? null, cleanName(file.name, `document.${type}`), MIME[type], file.data.length, key, req.user.sub]);
      return rows[0];
    });
  });

  app.delete('/hr/employee-documents/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrFull(db, req);
      const { rows } = await db.query('DELETE FROM employee_documents WHERE id = $1 RETURNING storage_key', [id.parse(req.params).id]);
      if (!rows[0]) throw notFound('Document');
      await removeStored(rows[0].storage_key);
      return { ok: true };
    }),
  );

  // ---- change requests: employees can't edit their record, they ask HR ------------
  app.post('/hr/employees/:id/requests', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await requireModule(db, 'hr');
      const v = await viewerOf(db, req);
      const { e, access } = await load(db, v, id.parse(req.params).id);
      if (!access.own && !access.edit) throw forbidden('Only the employee or HR can ask for changes to this record');
      const { text: body } = z.object({ text: z.string().trim().min(3).max(2000) }).parse(req.body);
      const { rows } = await db.query(
        `INSERT INTO employee_requests (employee_id, text, requested_by) VALUES ($1, $2, $3) RETURNING *`, [e.id, body, req.user.sub]);
      for (const userId of await hrUsers(db)) {
        if (userId !== req.user.sub) await notify(db, userId, `Change requested for ${e.first_name} ${e.last_name ?? ''} (${e.employee_no}): ${body.slice(0, 80)}`.replace(/\s+/g, ' '), `/hr/${e.id}`);
      }
      return rows[0];
    }),
  );

  app.get('/hr/requests', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrFull(db, req);
      return (await db.query(
        `SELECT r.*, e.first_name || coalesce(' ' || e.last_name, '') AS employee_name, e.employee_no, u.name AS requested_by_name
         FROM employee_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN users u ON u.id = r.requested_by
         WHERE r.status = 'open' ORDER BY r.requested_at`)).rows;
    }),
  );

  app.patch('/hr/requests/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrFull(db, req);
      const { status } = z.object({ status: z.enum(['open', 'done']) }).parse(req.body);
      const { rows } = await db.query(
        `UPDATE employee_requests SET status = $2, resolved_by = CASE WHEN $2 = 'done' THEN $3::uuid END,
                resolved_at = CASE WHEN $2 = 'done' THEN now() END
         WHERE id = $1 RETURNING *, (SELECT user_id FROM employees WHERE id = employee_id) AS employee_user_id`,
        [id.parse(req.params).id, status, req.user.sub]);
      if (!rows[0]) throw notFound('Request');
      if (status === 'done' && rows[0].requested_by && rows[0].requested_by !== req.user.sub) {
        await notify(db, rows[0].requested_by, 'HR updated your record as you asked', `/hr/${rows[0].employee_id}`);
      }
      return rows[0];
    }),
  );

  // ---- expiries ------------------------------------------------------------------
  app.get('/hr/expiring', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await requireModule(db, 'hr');
      const v = await viewerOf(db, req);
      const { days } = z.object({ days: z.coerce.number().int().min(0).max(365).default(60) }).parse(req.query);
      return (await expiries(db, days)).filter((x) => accessTo(v, x).see).sort((a, b) => a.days_left - b.days_left);
    }),
  );

  // Normally runs on its own every few hours; HR can run it now.
  app.post('/hr/alerts/run', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      await hrFull(db, req);
      return { sent: await checkExpiries(db) };
    }),
  );

  // ---- one-time import of the employee register (EMPLOYEE_DB.xlsx, sheet DB) -------
  app.post('/hr/import', { preHandler: authed }, async (req) => {
    const file = await uploaded(req);
    return tx(req, async (db) => {
      await hrFull(db, req);
      try {
        return await importEmployees(db, file.data, req.user.sub);
      } catch (err) {
        if (err instanceof Error && !('statusCode' in err)) throw badRequest(`Could not read the workbook: ${err.message}`);
        throw err;
      }
    });
  });
}
