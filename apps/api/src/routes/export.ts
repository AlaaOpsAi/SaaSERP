import ExcelJS from 'exceljs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { notify } from '../lib/notify.js';

/**
 * Full workspace export for admins: every table of the workspace (as the admin
 * sees it, i.e. everything), plus a permissions matrix. Password hashes are
 * never exported.
 */

interface Sheet { name: string; purpose: string; sql: string }

const SHEETS: Sheet[] = [
  { name: 'workspace', purpose: 'Company settings: plan, currency, time zone, profit percentages, language, branding.',
    sql: `SELECT id, slug, name, plan, max_users, currency, timezone, fixed_cost_pct, credit_facility_pct, default_locale, branding,
                 status, created_at FROM tenants WHERE id = current_tenant_id()` },
  { name: 'users', purpose: 'Everyone in the workspace with role, reporting line and what they can see (no passwords).',
    sql: `SELECT u.id, u.name, u.code, u.email, u.role, u.data_scope, u.is_active, u.manager_id, m.name AS manager_name,
                 u.preferences, u.last_login_at, u.created_at
          FROM users u LEFT JOIN users m ON m.id = u.manager_id ORDER BY u.name` },
  { name: 'delegations', purpose: 'Cover arrangements between colleagues (who covers whom, when, with what access).',
    sql: `SELECT d.*, a.name AS delegator_name, b.name AS delegate_name FROM delegations d
          JOIN users a ON a.id = d.delegator_id JOIN users b ON b.id = d.delegate_id ORDER BY d.starts_on` },
  { name: 'business_units', purpose: 'Brands / companies and their booking-number prefix.', sql: 'SELECT * FROM business_units ORDER BY code' },
  { name: 'lookups', purpose: 'All pick-lists (event types, sources, lost reasons, payment methods...) with translations.',
    sql: 'SELECT * FROM lookups ORDER BY type, sort_order, code' },
  { name: 'venues', purpose: 'Venues and locations.', sql: 'SELECT * FROM venues ORDER BY name' },
  { name: 'function_spaces', purpose: 'Rooms inside venues.',
    sql: 'SELECT s.*, v.name AS venue_name FROM function_spaces s JOIN venues v ON v.id = s.venue_id ORDER BY v.name, s.name' },
  { name: 'accounts', purpose: 'Client companies.', sql: 'SELECT * FROM accounts ORDER BY name' },
  { name: 'contacts', purpose: 'Client people.', sql: 'SELECT * FROM contacts ORDER BY name' },
  { name: 'bookings', purpose: 'All bookings with computed finance figures (revenue, margin, net profit, outstanding...).',
    sql: `SELECT b.*, bu.code AS business_unit_code, u.name AS owner_name, c.name AS contact_name, v.name AS venue_name,
                 f.revenue, f.cost, f.gross_margin, f.margin_pct, f.fixed_cost, f.cf_cost, f.net_profit, f.commission, f.shares,
                 f.paid, f.outstanding, f.aging_days
          FROM bookings b JOIN booking_finance f ON f.booking_id = b.id JOIN business_units bu ON bu.id = b.business_unit_id
          LEFT JOIN users u ON u.id = b.owner_id LEFT JOIN contacts c ON c.id = b.contact_id LEFT JOIN venues v ON v.id = b.venue_id
          ORDER BY b.booking_no` },
  { name: 'booking_events', purpose: 'Functions on the diary.', sql: 'SELECT * FROM booking_events ORDER BY start_at' },
  { name: 'booking_items', purpose: 'Revenue and cost lines.', sql: 'SELECT * FROM booking_items ORDER BY booking_id, sort_order' },
  { name: 'payments', purpose: 'Client payments.', sql: 'SELECT * FROM payments ORDER BY paid_on' },
  { name: 'payouts', purpose: 'Commission and partner shares with computed amounts.', sql: 'SELECT * FROM booking_payout_amounts ORDER BY booking_id' },
  { name: 'activities', purpose: 'Meetings, calls, follow-ups and tasks.', sql: 'SELECT * FROM activities ORDER BY due_at' },
  { name: 'status_history', purpose: 'Every booking status change.', sql: 'SELECT * FROM booking_status_history ORDER BY changed_at' },
  { name: 'booking_log', purpose: 'Audit trail of booking changes, including "on behalf of".', sql: 'SELECT * FROM booking_log ORDER BY created_at' },
];

/** What each role may do (mirrors `can` in auth.ts). */
function permissionRows() {
  const actions: [string, keyof typeof can][] = [
    ['View bookings, clients, reports', 'read'], ['Create and edit bookings, events, lines, follow-ups, clients', 'sell'],
    ['Record payments, commissions and shares', 'finance'], ['Venues, deletes, override room clashes, transfer work', 'manage'],
    ['Settings, users, pick-lists, import, full export', 'admin'],
  ];
  const roles = ['owner', 'admin', 'manager', 'sales', 'finance', 'viewer'] as const;
  return actions.map(([label, key]) => ({
    action: label, ...Object.fromEntries(roles.map((r) => [r, (can[key] as readonly string[]).includes(r) ? 'yes' : '—'])),
  }));
}

async function collect(db: Db) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const s of SHEETS) tables[s.name] = (await db.query(s.sql)).rows;
  // Team per user: everyone below them in the reporting tree.
  const team = await db.query(
    `WITH RECURSIVE t(root, id, depth) AS (
       SELECT id, id, 0 FROM users
       UNION SELECT t.root, u.id, t.depth + 1 FROM users u JOIN t ON u.manager_id = t.id WHERE t.depth < 20
     ) SELECT root AS user_id, count(*) - 1 AS people_below FROM t GROUP BY root`,
  );
  const below = new Map(team.rows.map((r) => [r.user_id, Number(r.people_below)]));
  tables.user_permissions = tables.users.map((u) => ({
    user: u.name, code: u.code, role: u.role, active: u.is_active, reports_to: u.manager_name,
    sees: u.role === 'owner' || u.role === 'admin' || u.data_scope === 'all' ? 'whole company' : 'own + team',
    people_below: below.get(u.id as string) ?? 0,
  }));
  tables.role_permissions = permissionRows();
  return tables;
}

async function audit(db: Db, req: FastifyRequest, format: string) {
  const { rows } = await db.query(`SELECT id FROM users WHERE role = 'owner' AND is_active AND id <> $1`, [req.user.sub]);
  const who = (await db.query('SELECT name FROM users WHERE id = $1', [req.user.sub])).rows[0]?.name ?? 'An admin';
  for (const r of rows) await notify(db, r.id, `${who} exported the full workspace data (${format}).`);
}

const cell = (v: unknown) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

export async function exportRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole(can.admin) };
  const q = z.object({ format: z.enum(['xlsx', 'json']).default('xlsx') });

  app.get('/export/workspace', admin, async (req, reply) => {
    const { format } = q.parse(req.query);
    const { tables, slug } = await tx(req, async (db) => {
      const t = await collect(db);
      await audit(db, req, format);
      return { tables: t, slug: (t.workspace[0]?.slug as string) ?? 'workspace' };
    });
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      reply.header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${slug}-export-${stamp}.json"`);
      return { exported_at: new Date().toISOString(), format_version: 1, tables };
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SaaSERP';
    const readme = wb.addWorksheet('README');
    readme.columns = [{ header: 'Sheet', key: 'sheet', width: 22 }, { header: 'Rows', key: 'rows', width: 8 }, { header: 'What it contains', key: 'purpose', width: 100 }];
    const purposes: Record<string, string> = Object.fromEntries(SHEETS.map((s) => [s.name, s.purpose]));
    purposes.user_permissions = 'Each user: role, manager, and whether they see the whole company or their team.';
    purposes.role_permissions = 'What each role is allowed to do.';
    for (const [name, rows] of Object.entries(tables)) readme.addRow({ sheet: name, rows: rows.length, purpose: purposes[name] });
    readme.addRow({});
    readme.addRow({ sheet: `Exported ${new Date().toISOString()}` });
    readme.getRow(1).font = { bold: true };

    for (const [name, rows] of Object.entries(tables)) {
      const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
      const keys = rows.length ? Object.keys(rows[0]) : ['(empty)'];
      ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
      for (const r of rows) ws.addRow(Object.fromEntries(keys.map((k) => [k, cell(r[k])])));
      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
      if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    }
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${slug}-export-${stamp}.xlsx"`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
}
