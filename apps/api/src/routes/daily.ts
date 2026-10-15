import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import type { Db } from '../db.js';
import { logAccess } from '../lib/access.js';

/**
 * Daily activity report: for one day, what each salesperson did (calls, meetings,
 * follow-ups), the outcome of every meeting, what was planned, what is overdue,
 * and the contracts they opened or moved. Managers see their whole team.
 */
const query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** A period instead of one day, e.g. a month: from=2026-10-01&to=2026-10-31. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  owner_id: z.string().uuid().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});

export interface DailyPerson {
  user_id: string; name: string; code: string | null; role: string;
  calls: number; meetings: number; followups: number; marketing: number; done: number;
  planned: number; overdue: number; new_contracts: number; won: number; lost: number;
  items: DailyItem[];
}
export interface DailyItem {
  id: string; type: string; subject: string; at: string; completed_at: string | null; location: string | null;
  outcome: string | null; notes: string | null; booking_id: string | null; booking_no: string | null; booking_name: string | null;
  contact_name: string | null; state: 'done' | 'planned' | 'overdue';
}

const MARKETING = ['campaign', 'social_post', 'exhibition', 'advertisement', 'content'];

async function dailyReport(db: Db, people: string[] | null, from: string | undefined, to: string | undefined, ownerId?: string) {
  const today = (await db.query(`SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM tenants WHERE id = current_tenant_id()`)).rows[0].d;
  const day = from ?? today;
  const last = to ?? day;
  // A specific person only within the caller's own view (their team, or everyone for whole-company users).
  const ids = ownerId && (!people || people.includes(ownerId)) ? [ownerId] : people;
  // Everyone who sells (or manages sellers) in the caller's view; sees-all callers get the whole company.
  const { rows: users } = await db.query(
    `SELECT id AS user_id, name, code, role FROM users
     WHERE is_active AND role IN ('owner', 'admin', 'manager', 'sales', 'marketing') AND ($1::uuid[] IS NULL OR id = ANY($1))
     ORDER BY name`,
    [ids],
  );
  const userIds = users.map((u) => u.user_id);

  // Activities done that day, due that day, or overdue at the end of it.
  const { rows: acts } = await db.query(
    `WITH tz AS (SELECT timezone FROM tenants WHERE id = current_tenant_id())
     SELECT a.id, a.owner_id, a.type, a.subject, a.due_at AS at, a.completed_at, a.location, a.outcome, a.notes,
            a.booking_id, b.booking_no, b.name AS booking_name, c.name AS contact_name,
            CASE WHEN a.completed_at IS NOT NULL THEN 'done'
                 WHEN (a.due_at AT TIME ZONE tz.timezone)::date >= greatest($2::date, $4::date) THEN 'planned'
                 ELSE 'overdue' END AS state
     FROM activities a CROSS JOIN tz
     LEFT JOIN bookings b ON b.id = a.booking_id
     LEFT JOIN contacts c ON c.id = coalesce(a.contact_id, b.contact_id)
     WHERE a.owner_id = ANY($1)
       AND ((a.completed_at IS NOT NULL AND (a.completed_at AT TIME ZONE tz.timezone)::date BETWEEN $2 AND $3)
         OR (a.completed_at IS NULL AND (a.due_at AT TIME ZONE tz.timezone)::date <= $3))
     ORDER BY coalesce(a.completed_at, a.due_at)`,
    [userIds, day, last, today],
  );

  // Contracts opened, won and lost that day.
  const { rows: moves } = await db.query(
    `WITH tz AS (SELECT timezone FROM tenants WHERE id = current_tenant_id())
     SELECT h.changed_by AS user_id,
            count(*) FILTER (WHERE h.from_status IS NULL) AS new_contracts,
            count(*) FILTER (WHERE h.to_status = 'DEF' AND h.from_status IS NOT NULL) AS won,
            count(*) FILTER (WHERE h.to_status IN ('LOS', 'CXL')) AS lost
     FROM booking_status_history h CROSS JOIN tz
     WHERE h.changed_by = ANY($1) AND (h.changed_at AT TIME ZONE tz.timezone)::date BETWEEN $2 AND $3
     GROUP BY h.changed_by`,
    [userIds, day, last],
  );
  const moveBy = new Map(moves.map((m) => [m.user_id, m]));

  const report: DailyPerson[] = users.map((u) => {
    const items = acts.filter((a) => a.owner_id === u.user_id).map(({ owner_id: _o, ...a }) => a as DailyItem);
    const done = items.filter((a) => a.state === 'done');
    const m = moveBy.get(u.user_id);
    return {
      ...u,
      calls: done.filter((a) => a.type === 'call').length,
      meetings: done.filter((a) => a.type === 'meeting' || a.type === 'site_visit').length,
      followups: done.filter((a) => !['call', 'meeting', 'site_visit', ...MARKETING].includes(a.type)).length,
      marketing: done.filter((a) => MARKETING.includes(a.type)).length,
      done: done.length,
      planned: items.filter((a) => a.state === 'planned').length,
      overdue: items.filter((a) => a.state === 'overdue').length,
      new_contracts: Number(m?.new_contracts ?? 0),
      won: Number(m?.won ?? 0),
      lost: Number(m?.lost ?? 0),
      items,
    };
  });
  return { date: day, from: day, to: last, people: report };
}

const TYPE: Record<string, string> = {
  meeting: 'Meeting', call: 'Call', followup: 'Follow-up', site_visit: 'Site visit', email: 'Email', task: 'Task',
  campaign: 'Campaign', social_post: 'Social media post', exhibition: 'Exhibition / event', advertisement: 'Advertisement', content: 'Content',
};

async function workbook(r: Awaited<ReturnType<typeof dailyReport>>) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SaaSERP';
  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  sum.columns = [
    { header: 'Salesperson', key: 'name', width: 24 }, { header: 'Code', key: 'code', width: 7 },
    { header: 'Calls', key: 'calls', width: 8 }, { header: 'Meetings', key: 'meetings', width: 9 },
    { header: 'Follow-ups', key: 'followups', width: 10 }, { header: 'Marketing', key: 'marketing', width: 10 },
    { header: 'Done', key: 'done', width: 7 },
    { header: 'Still planned', key: 'planned', width: 12 }, { header: 'Overdue', key: 'overdue', width: 9 },
    { header: 'New contracts', key: 'new_contracts', width: 13 }, { header: 'Won', key: 'won', width: 6 },
    { header: 'Lost / cancelled', key: 'lost', width: 14 },
  ];
  r.people.forEach((p) => sum.addRow(p));
  const det = wb.addWorksheet('Details', { views: [{ state: 'frozen', ySplit: 1 }] });
  det.columns = [
    { header: 'Salesperson', key: 'person', width: 22 }, { header: 'State', key: 'state', width: 9 },
    { header: 'Type', key: 'type', width: 11 }, { header: 'Time', key: 'at', width: 18 },
    { header: 'Subject', key: 'subject', width: 32 }, { header: 'Contract', key: 'booking', width: 30 },
    { header: 'Client', key: 'contact_name', width: 20 }, { header: 'Location', key: 'location', width: 16 },
    { header: 'Outcome', key: 'outcome', width: 50 },
  ];
  for (const p of r.people) {
    for (const a of p.items) {
      det.addRow({
        ...a, person: p.name, type: TYPE[a.type] ?? a.type, at: new Date(a.completed_at ?? a.at),
        booking: a.booking_no ? `${a.booking_no} ${a.booking_name ?? ''}` : '',
      });
    }
  }
  det.getColumn('at').numFmt = 'dd/mm/yyyy hh:mm';
  det.getColumn('outcome').alignment = { wrapText: true, vertical: 'top' };
  for (const ws of [sum, det]) {
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function dailyRoutes(app: FastifyInstance) {
  app.get('/reports/daily-activity', { preHandler: authed }, async (req, reply) => {
    const q = query.parse(req.query);
    const result = await tx(req, (db) =>
      dailyReport(db, req.scope?.seesAll ? null : req.scope?.teamIds ?? [req.user.sub], q.from ?? q.date, q.to ?? q.date, q.owner_id));
    if (q.format === 'json') return result;
    await tx(req, (db) => logAccess(db, req.user.sub, 'export', `Activity report ${result.from}${result.to !== result.from ? ` to ${result.to}` : ''} (xlsx)`, req.ip));
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="activity-${result.from}${result.to !== result.from ? `_${result.to}` : ''}.xlsx"`);
    return reply.send(await workbook(result));
  });
}
