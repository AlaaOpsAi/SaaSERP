import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import type { Db } from '../db.js';

const query = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
  business_unit_id: z.string().uuid().optional(),
});

// Period basis: the event date, or the enquiry date while no date is set
// (the Y/M/D columns of the daily report).
const PERIOD = 'coalesce(b.event_date, b.inquiry_date)';
const WON = `b.status IN ('DEF','ACT')`;

function scope(q: z.infer<typeof query>) {
  return {
    where: `extract(year FROM ${PERIOD}) = $1 AND ($2::uuid IS NULL OR b.business_unit_id = $2)`,
    params: [q.year, q.business_unit_id ?? null] as unknown[],
  };
}

const FROM = `FROM bookings b JOIN booking_finance f ON f.booking_id = b.id`;

async function dashboard(db: Db, q: z.infer<typeof query>) {
  const { where, params } = scope(q);

  const kpis = (
    await db.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE ${WON}) AS definite,
              count(*) FILTER (WHERE b.status IN ('INQ','TEN')) AS open,
              count(*) FILTER (WHERE b.status = 'LOS') AS lost,
              count(*) FILTER (WHERE b.status = 'CXL') AS cancelled,
              coalesce(sum(f.revenue) FILTER (WHERE ${WON}), 0) AS revenue,
              coalesce(sum(f.cost) FILTER (WHERE ${WON}), 0) AS cost,
              coalesce(sum(f.gross_margin) FILTER (WHERE ${WON}), 0) AS gross_margin,
              coalesce(sum(f.net_profit) FILTER (WHERE ${WON}), 0) AS net_profit,
              coalesce(sum(f.commission) FILTER (WHERE ${WON}), 0) AS commission,
              coalesce(sum(f.shares) FILTER (WHERE ${WON}), 0) AS shares,
              coalesce(sum(f.outstanding), 0) AS outstanding,
              coalesce(sum(coalesce(b.contract_value, f.revenue)) FILTER (WHERE b.status IN ('INQ','TEN')), 0) AS pipeline_value,
              coalesce(sum(b.pax) FILTER (WHERE ${WON}), 0) AS pax
       ${FROM} WHERE ${where}`,
      params,
    )
  ).rows[0];
  kpis.conversion_rate = kpis.total ? kpis.definite / kpis.total : null;
  const decided = kpis.definite + kpis.lost + kpis.cancelled;
  kpis.win_rate = decided ? kpis.definite / decided : null;
  kpis.margin_pct = kpis.revenue ? kpis.gross_margin / kpis.revenue : null;

  const byMonth = (
    await db.query(
      `SELECT m AS month,
              count(b.id) AS total,
              count(b.id) FILTER (WHERE ${WON}) AS definite,
              count(b.id) FILTER (WHERE b.status IN ('INQ','TEN')) AS open,
              count(b.id) FILTER (WHERE b.status IN ('LOS','CXL')) AS lost,
              coalesce(sum(f.revenue) FILTER (WHERE ${WON}), 0) AS revenue,
              coalesce(sum(f.gross_margin) FILTER (WHERE ${WON}), 0) AS gross_margin
       FROM generate_series(1, 12) m
       LEFT JOIN bookings b ON extract(month FROM ${PERIOD}) = m AND ${where}
       LEFT JOIN booking_finance f ON f.booking_id = b.id
       GROUP BY m ORDER BY m`,
      params,
    )
  ).rows;

  const grouped = async (expr: string, label: string) =>
    (
      await db.query(
        `SELECT ${expr} AS key, ${label} AS label,
                count(*) AS total,
                count(*) FILTER (WHERE ${WON}) AS definite,
                count(*) FILTER (WHERE b.status = 'LOS') AS lost,
                coalesce(sum(f.revenue) FILTER (WHERE ${WON}), 0) AS revenue,
                coalesce(sum(f.net_profit) FILTER (WHERE ${WON}), 0) AS net_profit
         ${FROM}
         LEFT JOIN users u ON u.id = b.owner_id
         LEFT JOIN lookups l_src ON l_src.type = 'source' AND l_src.code = b.source
         LEFT JOIN lookups l_evt ON l_evt.type = 'event_type' AND l_evt.code = b.event_type
         WHERE ${where}
         GROUP BY 1, 2 ORDER BY total DESC`,
        params,
      )
    ).rows;

  const bySource = await grouped(`coalesce(b.source, '—')`, `coalesce(l_src.label, b.source, 'Unknown')`);
  const byOwner = await grouped(`coalesce(u.code, '—')`, `coalesce(u.name, 'Unassigned')`);
  const byEventType = await grouped(`coalesce(b.event_type, '—')`, `coalesce(l_evt.label, b.event_type, 'Unknown')`);
  const byStatus = (await db.query(`SELECT b.status, count(*) AS total ${FROM} WHERE ${where} GROUP BY 1`, params)).rows;

  const lostReasons = (
    await db.query(
      `SELECT coalesce(l.label, b.lost_reason) AS reason, count(*) AS total
       ${FROM} LEFT JOIN lookups l ON l.type = 'lost_reason' AND l.code = b.lost_reason
       WHERE ${where} AND b.status = 'LOS'
       GROUP BY 1 ORDER BY total DESC LIMIT 12`,
      params,
    )
  ).rows;

  const upcoming = (
    await db.query(
      `SELECT b.id, b.booking_no, b.name, b.status, b.event_date, b.pax, v.name AS venue_name, f.revenue, f.outstanding
       ${FROM} LEFT JOIN venues v ON v.id = b.venue_id
       WHERE b.status IN ('TEN','DEF') AND b.event_date BETWEEN current_date AND current_date + 30
       ORDER BY b.event_date LIMIT 15`,
    )
  ).rows;

  const followups = (
    await db.query(
      `SELECT count(*) FILTER (WHERE next_followup_date < current_date) AS overdue,
              count(*) FILTER (WHERE next_followup_date = current_date) AS today,
              count(*) FILTER (WHERE next_followup_date IS NULL) AS unscheduled
       FROM bookings WHERE status IN ('INQ','TEN')`,
    )
  ).rows[0];

  return { year: q.year, kpis, by_month: byMonth, by_status: byStatus, by_source: bySource, by_owner: byOwner,
           by_event_type: byEventType, lost_reasons: lostReasons, upcoming, followups };
}

async function receivables(db: Db) {
  const { rows } = await db.query(
    `SELECT b.id, b.booking_no, b.name, b.status, b.event_date, c.name AS contact_name, c.phone AS contact_phone,
            u.code AS owner_code, f.revenue, f.contract_value, f.paid, f.outstanding, f.aging_days, f.last_paid_on
     ${FROM} LEFT JOIN contacts c ON c.id = b.contact_id LEFT JOIN users u ON u.id = b.owner_id
     WHERE f.outstanding > 0
     ORDER BY f.aging_days DESC, f.outstanding DESC`,
  );
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  for (const r of rows) {
    const d = r.aging_days as number;
    const k = d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'over90';
    buckets[k] += r.outstanding as number;
  }
  return { rows, buckets, total: rows.reduce((s, r) => s + (r.outstanding as number), 0) };
}

async function payoutsDue(db: Db) {
  const { rows } = await db.query(
    `SELECT p.id, p.kind, p.payee_name, p.pct, p.amount, p.status, p.paid_on,
            b.id AS booking_id, b.booking_no, b.name AS booking_name, b.event_date, b.fully_paid_date
     FROM booking_payout_amounts p JOIN bookings b ON b.id = p.booking_id
     WHERE b.status IN ('DEF','ACT')
     ORDER BY p.status, b.event_date`,
  );
  return rows;
}

/** The CONTRACTS sheet, regenerated from live data. */
async function exportWorkbook(db: Db, q: z.infer<typeof query>): Promise<Buffer> {
  const { where, params } = scope(q);
  const { rows } = await db.query(
    `SELECT b.*, bu.code AS bu_code, u.code AS owner_code, c.name AS contact_name, c.phone AS contact_phone,
            c.email AS contact_email, c.nationality, c.address AS contact_address, c.social_handle,
            v.name AS venue_name, s.name AS space_name, f.*
     ${FROM}
     JOIN business_units bu ON bu.id = b.business_unit_id
     LEFT JOIN users u ON u.id = b.owner_id
     LEFT JOIN contacts c ON c.id = b.contact_id
     LEFT JOIN venues v ON v.id = b.venue_id
     LEFT JOIN function_spaces s ON s.id = b.function_space_id
     WHERE ${where} ORDER BY b.booking_no`,
    params,
  );
  const payouts = await db.query(
    `SELECT booking_id, kind, payee_name, pct, amount, status, paid_on FROM booking_payout_amounts ORDER BY created_at`,
  );
  const byBooking = new Map<string, typeof payouts.rows>();
  for (const p of payouts.rows) {
    const list = byBooking.get(p.booking_id) ?? [];
    list.push(p);
    byBooking.set(p.booking_id, list);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SaaSERP';
  const ws = wb.addWorksheet('CONTRACTS', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = [
    { header: 'CONTRACT ID', key: 'booking_no', width: 12 },
    { header: 'CO', key: 'bu_code', width: 5 },
    { header: 'CAT', key: 'event_type', width: 6 },
    { header: 'STATUS', key: 'status', width: 8 },
    { header: 'EVENT DATE', key: 'event_date', width: 12 },
    { header: 'HALL', key: 'hall', width: 20 },
    { header: 'REV', key: 'revenue', width: 11 },
    { header: 'COST', key: 'cost', width: 11 },
    { header: 'GROSS MARGIN', key: 'gross_margin', width: 12 },
    { header: 'P %', key: 'margin_pct', width: 8 },
    { header: 'TOTAL CONTRACT VALUE', key: 'contract_value', width: 12 },
    { header: 'DIFF', key: 'diff', width: 10 },
    { header: 'CREDIT FACILITY', key: 'cf', width: 8 },
    { header: 'FIX COST', key: 'fixed_cost', width: 10 },
    { header: 'CF COST', key: 'cf_cost', width: 10 },
    { header: 'NET PROFIT', key: 'net_profit', width: 11 },
    { header: 'COMM TO PAY', key: 'commission', width: 11 },
    { header: 'SHARES TO PAY', key: 'shares', width: 11 },
    { header: 'PAYOUTS', key: 'payouts', width: 30 },
    { header: 'PAID', key: 'paid', width: 11 },
    { header: 'FULLY PAID', key: 'fully_paid_date', width: 12 },
    { header: 'CLIENT OUTSTAND.', key: 'outstanding', width: 12 },
    { header: 'AGING DAYS', key: 'aging_days', width: 8 },
    { header: 'SOURCE', key: 'source', width: 10 },
    { header: 'AM', key: 'owner_code', width: 6 },
    { header: 'REQUEST DESCRIPTION & NOTES', key: 'description', width: 40 },
    { header: 'LOC', key: 'venue_name', width: 16 },
    { header: 'PAX', key: 'pax', width: 7 },
    { header: 'RATE', key: 'rate', width: 8 },
    { header: 'TERM DAYS', key: 'term_days', width: 7 },
    { header: 'ENQUIRY DATE', key: 'inquiry_date', width: 12 },
    { header: 'LAST FOLLOWUP', key: 'last_followup_date', width: 12 },
    { header: 'FOLLOWUP CLIENT FEEDBACK', key: 'followup_notes', width: 30 },
    { header: 'LOST REASON', key: 'lost_reason', width: 24 },
    { header: 'CLIENT EMAIL', key: 'contact_email', width: 22 },
    { header: 'COUNTRY', key: 'nationality', width: 10 },
    { header: 'CLIENT ADDRESS', key: 'contact_address', width: 20 },
    { header: 'INSTA ID', key: 'social_handle', width: 14 },
    { header: 'CLIENT NAME', key: 'contact_name', width: 20 },
    { header: 'CLIENT PHONE', key: 'contact_phone', width: 12 },
  ];
  for (const r of rows) {
    ws.addRow({
      ...r,
      hall: r.space_name ?? r.hall_text,
      cf: r.credit_facility ? 'CF' : '',
      payouts: (byBooking.get(r.booking_id) ?? [])
        .map((p) => `${p.payee_name} ${Math.round(p.pct * 100)}% = ${p.amount} (${p.status})`)
        .join('; '),
    });
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  header.alignment = { wrapText: true, vertical: 'middle' };
  header.height = 32;
  for (const key of ['revenue', 'cost', 'gross_margin', 'contract_value', 'diff', 'fixed_cost', 'cf_cost',
                     'net_profit', 'commission', 'shares', 'paid', 'outstanding', 'rate']) {
    ws.getColumn(key).numFmt = '#,##0.000';
  }
  ws.getColumn('margin_pct').numFmt = '0.0%';
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const total = ws.addRow({ booking_no: 'TOTAL DEF/ACT' });
  total.font = { bold: true };
  for (const key of ['revenue', 'cost', 'gross_margin', 'net_profit', 'commission', 'shares', 'paid', 'outstanding']) {
    total.getCell(key).value = rows
      .filter((r) => r.status === 'DEF' || r.status === 'ACT')
      .reduce((s, r) => s + Number(r[key] ?? 0), 0);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/dashboard', { preHandler: authed }, (req) => tx(req, (db) => dashboard(db, query.parse(req.query))));
  app.get('/reports/receivables', { preHandler: authed }, (req) => tx(req, (db) => receivables(db)));
  app.get('/reports/payouts', { preHandler: authed }, (req) => tx(req, (db) => payoutsDue(db)));
  app.get('/reports/contracts.xlsx', { preHandler: authed }, async (req, reply) => {
    const q = query.parse(req.query);
    const buf = await tx(req, (db) => exportWorkbook(db, q));
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="contracts-${q.year}.xlsx"`);
    return reply.send(buf);
  });
}
