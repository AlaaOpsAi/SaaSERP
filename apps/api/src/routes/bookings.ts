import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authed, can, hasRole, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { assertTransition, BLOCKING, findConflicts, nextBookingNo, type BookingStatus } from '../lib/booking.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { deleteRow, getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.number().finite();
const status = z.enum(['INQ', 'TEN', 'DEF', 'ACT', 'LOS', 'CXL']);

const inlineContact = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().nullish(),
  email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
  nationality: z.string().nullish(),
  address: z.string().nullish(),
  social_handle: z.string().nullish(),
});

const bookingFields = z.object({
  name: z.string().trim().min(1).max(200),
  business_unit_id: z.string().uuid(),
  event_type: z.string().nullish(),
  source: z.string().nullish(),
  owner_id: z.string().uuid().nullish(),
  account_id: z.string().uuid().nullish(),
  contact_id: z.string().uuid().nullish(),
  venue_id: z.string().uuid().nullish(),
  function_space_id: z.string().uuid().nullish(),
  hall_text: z.string().nullish(),
  event_date: date.nullish(),
  end_date: date.nullish(),
  pax: z.number().int().min(0).nullish(),
  rate: money.nullish(),
  term_days: z.number().int().min(0).nullish(),
  inquiry_date: date,
  decision_due_date: date.nullish(),
  last_followup_date: date.nullish(),
  next_followup_date: date.nullish(),
  followup_notes: z.string().nullish(),
  description: z.string().nullish(),
  lost_reason: z.string().nullish(),
  cancel_reason: z.string().nullish(),
  manual_revenue: money.nullish(),
  manual_cost: money.nullish(),
  contract_value: money.nullish(),
  credit_facility: z.boolean(),
  fully_paid_date: date.nullish(),
  currency: z.string().length(3).toUpperCase(),
});

const bookingCreate = bookingFields.partial().extend({
  name: bookingFields.shape.name,
  status: status.default('INQ'),
  contact: inlineContact.optional(),
  force: z.boolean().optional(),
});
const bookingPatch = bookingFields.omit({ business_unit_id: true }).partial();

const statusChange = z.object({
  status,
  reason: z.string().trim().min(1).optional(),
  force: z.boolean().optional(),
});

const listQuery = z.object({
  status: z.string().optional(), // comma separated
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  owner_id: z.string().uuid().optional(),
  source: z.string().optional(),
  event_type: z.string().optional(),
  lost_reason: z.string().optional(),
  venue_id: z.string().uuid().optional(),
  business_unit_id: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  from: date.optional(),
  to: date.optional(),
  followup_due: z.coerce.boolean().optional(),
  sort: z.enum(['event_date', '-event_date', 'inquiry_date', '-inquiry_date', 'booking_no', '-booking_no', '-revenue']).default('-inquiry_date'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const eventSchema = z.object({
  name: z.string().trim().min(1),
  function_space_id: z.string().uuid().nullish(),
  setup_style: z.string().nullish(),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  expected_pax: z.number().int().min(0).nullish(),
  guaranteed_pax: z.number().int().min(0).nullish(),
  notes: z.string().nullish(),
});

const itemSchema = z.object({
  event_id: z.string().uuid().nullish(),
  category: z.string().min(1).default('F&B'),
  description: z.string().trim().min(1),
  quantity: z.number().finite().default(1),
  unit_price: money.default(0),
  unit_cost: money.default(0),
  sort_order: z.number().int().optional(),
});

const paymentSchema = z.object({
  paid_on: date,
  amount: money.refine((v) => v !== 0, 'Amount cannot be zero'),
  method: z.string().default('BANK'),
  bank_account: z.string().nullish(),
  reference: z.string().nullish(),
  notes: z.string().nullish(),
});

const payoutSchema = z.object({
  kind: z.enum(['commission', 'share']),
  payee_name: z.string().trim().min(1),
  user_id: z.string().uuid().nullish(),
  pct: z.number().min(0).max(1),
  status: z.enum(['pending', 'paid']).default('pending'),
  paid_on: date.nullish(),
});

const SORTS: Record<string, string> = {
  event_date: 'b.event_date ASC NULLS LAST',
  '-event_date': 'b.event_date DESC NULLS LAST',
  inquiry_date: 'b.inquiry_date ASC',
  '-inquiry_date': 'b.inquiry_date DESC, b.booking_no DESC',
  booking_no: 'b.booking_no ASC',
  '-booking_no': 'b.booking_no DESC',
  '-revenue': 'f.revenue DESC',
};

/** Shared SELECT for booking rows with display names and finance figures. */
const BOOKING_SELECT = `
  SELECT b.*, bu.code AS business_unit_code,
         u.name AS owner_name, u.code AS owner_code,
         c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
         a.name AS account_name,
         v.name AS venue_name, s.name AS space_name,
         f.revenue, f.cost, f.gross_margin, f.margin_pct, f.diff, f.fixed_cost, f.cf_cost,
         f.net_profit, f.commission, f.shares, f.paid, f.outstanding, f.aging_days
  FROM bookings b
  JOIN business_units bu ON bu.id = b.business_unit_id
  JOIN booking_finance f ON f.booking_id = b.id
  LEFT JOIN users u ON u.id = b.owner_id
  LEFT JOIN contacts c ON c.id = b.contact_id
  LEFT JOIN accounts a ON a.id = b.account_id
  LEFT JOIN venues v ON v.id = b.venue_id
  LEFT JOIN function_spaces s ON s.id = b.function_space_id`;

async function loadBooking(db: Db, bookingId: string) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
  if (!rows[0]) throw notFound('Booking');
  return rows[0];
}

async function bookingDetail(db: Db, bookingId: string) {
  const booking = await loadBooking(db, bookingId);
  // One client per transaction: queries run sequentially.
  const q = async (sql: string) => (await db.query(sql, [bookingId])).rows;
  const events = await q(
    `SELECT e.*, s.name AS space_name, v.name AS venue_name
     FROM booking_events e
     LEFT JOIN function_spaces s ON s.id = e.function_space_id
     LEFT JOIN venues v ON v.id = s.venue_id
     WHERE e.booking_id = $1 ORDER BY e.start_at`,
  );
  const items = await q('SELECT * FROM booking_items WHERE booking_id = $1 ORDER BY sort_order, created_at');
  const activities = await q(
    `SELECT a.*, u.name AS owner_name FROM activities a LEFT JOIN users u ON u.id = a.owner_id
     WHERE a.booking_id = $1 ORDER BY a.due_at`,
  );
  const payments = await q('SELECT * FROM payments WHERE booking_id = $1 ORDER BY paid_on, created_at');
  const payouts = await q('SELECT * FROM booking_payout_amounts WHERE booking_id = $1 ORDER BY kind, created_at');
  const history = await q(
    `SELECT h.*, u.name AS changed_by_name FROM booking_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.booking_id = $1 ORDER BY h.changed_at`,
  );
  const conflicts = await findConflicts(db, bookingId);
  return {
    ...booking,
    events,
    items,
    activities,
    payments,
    payouts,
    history,
    conflicts,
  };
}

async function findOrCreateContact(db: Db, c: z.infer<typeof inlineContact>): Promise<string> {
  if (c.phone) {
    const { rows } = await db.query('SELECT id FROM contacts WHERE phone = $1 LIMIT 1', [c.phone]);
    if (rows[0]) return rows[0].id;
  }
  const row = await insertRow<{ id: string }>(db, 'contacts', c);
  return row.id;
}

async function bookingStatus(db: Db, bookingId: string): Promise<BookingStatus> {
  return (await getRow<{ status: BookingStatus }>(db, 'bookings', bookingId, 'Booking')).status;
}

function canForce(req: FastifyRequest, force?: boolean) {
  return Boolean(force) && hasRole(req, can.manage);
}

export async function bookingRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.sell) };
  const finance = { preHandler: requireRole(can.finance) };

  app.get('/bookings', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const q = listQuery.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.status) where.push(`b.status = ANY(${p(q.status.split(',').map((s) => s.trim().toUpperCase()))})`);
      if (q.year) where.push(`extract(year FROM coalesce(b.event_date, b.inquiry_date)) = ${p(q.year)}`);
      if (q.month) where.push(`extract(month FROM coalesce(b.event_date, b.inquiry_date)) = ${p(q.month)}`);
      if (q.owner_id) where.push(`b.owner_id = ${p(q.owner_id)}`);
      if (q.source) where.push(`b.source = ${p(q.source)}`);
      if (q.event_type) where.push(`b.event_type = ${p(q.event_type)}`);
      if (q.lost_reason) where.push(`b.lost_reason = ${p(q.lost_reason)}`);
      if (q.venue_id) where.push(`b.venue_id = ${p(q.venue_id)}`);
      if (q.business_unit_id) where.push(`b.business_unit_id = ${p(q.business_unit_id)}`);
      if (q.from) where.push(`b.event_date >= ${p(q.from)}`);
      if (q.to) where.push(`b.event_date <= ${p(q.to)}`);
      if (q.followup_due) where.push(`b.status IN ('INQ','TEN') AND b.next_followup_date <= current_date`);
      if (q.q) {
        const like = p(`%${q.q}%`);
        where.push(`(b.booking_no ILIKE ${like} OR b.name ILIKE ${like} OR c.name ILIKE ${like}
                      OR c.phone ILIKE ${like} OR a.name ILIKE ${like} OR b.description ILIKE ${like})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const baseParams = [...params];
      const rows = (
        await db.query(
          `${BOOKING_SELECT} ${whereSql} ORDER BY ${SORTS[q.sort]} LIMIT ${p(q.limit)} OFFSET ${p(q.offset)}`,
          params,
        )
      ).rows;
      const totals = (
        await db.query(
          `SELECT count(*) AS count,
                  count(*) FILTER (WHERE b.status IN ('DEF','ACT')) AS definite,
                  coalesce(sum(f.revenue) FILTER (WHERE b.status IN ('DEF','ACT')), 0) AS revenue,
                  coalesce(sum(f.gross_margin) FILTER (WHERE b.status IN ('DEF','ACT')), 0) AS gross_margin,
                  coalesce(sum(f.net_profit) FILTER (WHERE b.status IN ('DEF','ACT')), 0) AS net_profit,
                  coalesce(sum(f.outstanding), 0) AS outstanding
           FROM bookings b JOIN booking_finance f ON f.booking_id = b.id
           LEFT JOIN contacts c ON c.id = b.contact_id LEFT JOIN accounts a ON a.id = b.account_id
           ${whereSql}`,
          baseParams,
        )
      ).rows[0];
      return { rows, totals };
    }),
  );

  app.get('/bookings/:id', { preHandler: authed }, (req) =>
    tx(req, (db) => bookingDetail(db, id.parse(req.params).id)),
  );

  app.post('/bookings', sell, (req, reply) =>
    tx(req, async (db) => {
      const { contact, force, status: initialStatus, ...body } = bookingCreate.parse(req.body);

      let businessUnitId = body.business_unit_id;
      if (!businessUnitId) {
        const { rows } = await db.query('SELECT id FROM business_units WHERE is_active ORDER BY code LIMIT 1');
        if (!rows[0]) throw badRequest('Create a business unit first');
        businessUnitId = rows[0].id as string;
      }
      if (!body.contact_id && contact) body.contact_id = await findOrCreateContact(db, contact);
      if (body.function_space_id && !body.venue_id) {
        const space = await getRow<{ venue_id: string }>(db, 'function_spaces', body.function_space_id, 'Function space');
        body.venue_id = space.venue_id;
      }

      if (!body.currency) {
        const { rows } = await db.query('SELECT currency FROM tenants WHERE id = current_tenant_id()');
        body.currency = rows[0].currency;
      }
      const year = Number((body.event_date ?? body.inquiry_date ?? new Date().toISOString()).slice(0, 4));
      const booking = await insertRow<{ id: string; status: BookingStatus }>(db, 'bookings', {
        ...body,
        business_unit_id: businessUnitId,
        booking_no: await nextBookingNo(db, businessUnitId, year),
        status: initialStatus,
        owner_id: body.owner_id === undefined ? req.user.sub : body.owner_id,
        created_by: req.user.sub,
      });
      await db.query(
        `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, changed_by)
         VALUES (current_tenant_id(), $1, $2, $3)`,
        [booking.id, initialStatus, req.user.sub],
      );

      // A booking with a date and a room gets a default evening event on the diary.
      if (body.event_date && body.function_space_id) {
        await db.query(
          `INSERT INTO booking_events (tenant_id, booking_id, function_space_id, name, start_at, end_at, expected_pax)
           SELECT current_tenant_id(), $1, $2, 'Main event',
                  ($3::date + time '18:00') AT TIME ZONE t.timezone,
                  ($3::date + time '23:59') AT TIME ZONE t.timezone, $4
           FROM tenants t WHERE t.id = current_tenant_id()`,
          [booking.id, body.function_space_id, body.event_date, body.pax ?? null],
        );
      }

      if (BLOCKING.includes(initialStatus)) {
        const conflicts = await findConflicts(db, booking.id);
        if (conflicts.length && !canForce(req, force)) {
          throw conflict('The function space is already booked for this time', { conflicts });
        }
      }
      reply.code(201);
      return bookingDetail(db, booking.id);
    }),
  );

  app.patch('/bookings/:id', sell, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const body = bookingPatch.parse(req.body);
      if (body.function_space_id && body.venue_id === undefined) {
        const space = await getRow<{ venue_id: string }>(db, 'function_spaces', body.function_space_id, 'Function space');
        body.venue_id = space.venue_id;
      }
      await updateRow(db, 'bookings', bookingId, body, 'Booking');
      return bookingDetail(db, bookingId);
    }),
  );

  app.post('/bookings/:id/status', sell, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const { status: to, reason, force } = statusChange.parse(req.body);
      const from = await bookingStatus(db, bookingId);
      assertTransition(from, to);
      if (from === to) return bookingDetail(db, bookingId);
      if ((to === 'LOS' || to === 'CXL') && !reason) {
        throw badRequest(to === 'LOS' ? 'A lost reason is required' : 'A cancellation reason is required');
      }
      if (from === 'ACT' && !hasRole(req, can.manage)) throw badRequest('Only managers can reopen an actualised booking');

      if (BLOCKING.includes(to)) {
        const conflicts = await findConflicts(db, bookingId);
        if (conflicts.length && !canForce(req, force)) {
          throw conflict('The function space is already booked for this time', { conflicts });
        }
      }

      await db.query(
        `UPDATE bookings SET status = $2,
                lost_reason   = CASE WHEN $2 = 'LOS' THEN $3 ELSE lost_reason END,
                cancel_reason = CASE WHEN $2 = 'CXL' THEN $3 ELSE cancel_reason END
         WHERE id = $1`,
        [bookingId, to, reason ?? null],
      );
      await db.query(
        `INSERT INTO booking_status_history (tenant_id, booking_id, from_status, to_status, reason, changed_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5)`,
        [bookingId, from, to, reason ?? null, req.user.sub],
      );
      return bookingDetail(db, bookingId);
    }),
  );

  app.delete('/bookings/:id', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'bookings', id.parse(req.params).id, 'Booking');
      return { ok: true };
    }),
  );

  // ---- events --------------------------------------------------------------

  async function checkEventConflicts(
    req: FastifyRequest,
    db: Db,
    bookingId: string,
    event: { function_space_id?: string | null; start_at: string; end_at: string },
    force?: boolean,
  ) {
    if (!BLOCKING.includes(await bookingStatus(db, bookingId))) return;
    const conflicts = await findConflicts(db, bookingId, {
      function_space_id: event.function_space_id ?? null,
      start_at: event.start_at,
      end_at: event.end_at,
    });
    if (conflicts.length && !canForce(req, force)) {
      throw conflict('The function space is already booked for this time', { conflicts });
    }
  }

  app.post('/bookings/:id/events', sell, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const { force, ...body } = eventSchema.extend({ force: z.boolean().optional() }).parse(req.body);
      if (new Date(body.end_at) <= new Date(body.start_at)) throw badRequest('End must be after start');
      await checkEventConflicts(req, db, bookingId, body, force);
      return insertRow(db, 'booking_events', { ...body, booking_id: bookingId });
    }),
  );

  app.patch('/booking-events/:id', sell, (req) =>
    tx(req, async (db) => {
      const eventId = id.parse(req.params).id;
      const { force, ...body } = eventSchema.partial().extend({ force: z.boolean().optional() }).parse(req.body);
      const current = await getRow<{ booking_id: string; function_space_id: string | null; start_at: Date; end_at: Date }>(
        db, 'booking_events', eventId, 'Event');
      const merged = {
        function_space_id: body.function_space_id === undefined ? current.function_space_id : body.function_space_id,
        start_at: body.start_at ?? current.start_at.toISOString(),
        end_at: body.end_at ?? current.end_at.toISOString(),
      };
      if (new Date(merged.end_at) <= new Date(merged.start_at)) throw badRequest('End must be after start');
      await checkEventConflicts(req, db, current.booking_id, merged, force);
      return updateRow(db, 'booking_events', eventId, body, 'Event');
    }),
  );

  app.delete('/booking-events/:id', sell, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'booking_events', id.parse(req.params).id, 'Event');
      return { ok: true };
    }),
  );

  // ---- revenue / cost lines ----------------------------------------------

  app.post('/bookings/:id/items', sell, (req) =>
    tx(req, (db) => insertRow(db, 'booking_items', { ...itemSchema.parse(req.body), booking_id: id.parse(req.params).id })),
  );
  app.patch('/booking-items/:id', sell, (req) =>
    tx(req, (db) => updateRow(db, 'booking_items', id.parse(req.params).id, itemSchema.partial().parse(req.body), 'Line')),
  );
  app.delete('/booking-items/:id', sell, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'booking_items', id.parse(req.params).id, 'Line');
      return { ok: true };
    }),
  );

  // ---- payments ------------------------------------------------------------

  app.post('/bookings/:id/payments', finance, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const payment = await insertRow(db, 'payments', {
        ...paymentSchema.parse(req.body),
        booking_id: bookingId,
        created_by: req.user.sub,
      });
      await syncFullyPaid(db, bookingId);
      return payment;
    }),
  );
  app.delete('/payments/:id', finance, (req) =>
    tx(req, async (db) => {
      const payment = await getRow<{ booking_id: string }>(db, 'payments', id.parse(req.params).id, 'Payment');
      await deleteRow(db, 'payments', id.parse(req.params).id, 'Payment');
      await syncFullyPaid(db, payment.booking_id);
      return { ok: true };
    }),
  );

  // ---- commission & shares ----------------------------------------------

  app.post('/bookings/:id/payouts', finance, (req) =>
    tx(req, (db) => insertRow(db, 'booking_payouts', { ...payoutSchema.parse(req.body), booking_id: id.parse(req.params).id })),
  );
  app.patch('/booking-payouts/:id', finance, (req) =>
    tx(req, (db) => {
      const body = payoutSchema.partial().parse(req.body);
      if (body.status === 'paid' && body.paid_on === undefined) body.paid_on = new Date().toISOString().slice(0, 10);
      return updateRow(db, 'booking_payouts', id.parse(req.params).id, body, 'Payout');
    }),
  );
  app.delete('/booking-payouts/:id', finance, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'booking_payouts', id.parse(req.params).id, 'Payout');
      return { ok: true };
    }),
  );
}

/** Stamp (or clear) the fully-paid date once receipts cover the billable amount. */
async function syncFullyPaid(db: Db, bookingId: string) {
  await db.query(
    `UPDATE bookings b
     SET fully_paid_date = CASE WHEN f.outstanding <= 0 AND f.paid > 0 THEN f.last_paid_on ELSE NULL END
     FROM booking_finance f
     WHERE f.booking_id = b.id AND b.id = $1 AND b.status IN ('DEF', 'ACT')`,
    [bookingId],
  );
}
