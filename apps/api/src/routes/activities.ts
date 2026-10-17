import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, onBehalfOf, requireRole, tx } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { logChange, writable } from '../lib/guard.js';
import { getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
export const MEETING_TYPES = ['meeting', 'site_visit'];
/** Marketing work that is not about one client: may be saved without a contract or customer. */
export const MARKETING_TYPES = ['campaign', 'social_post', 'exhibition', 'advertisement', 'content'] as const;

/** Every client-facing activity belongs to a contract (enquiry) or a customer. */
function assertLinked(a: { type?: string; booking_id?: string | null; contact_id?: string | null; account_id?: string | null }) {
  if ((MARKETING_TYPES as readonly string[]).includes(a.type ?? '')) return;
  if (!a.booking_id && !a.contact_id && !a.account_id) {
    throw badRequest('Link the activity to a contract ID or a customer ID');
  }
}

const activitySchema = z.object({
  booking_id: z.string().uuid().nullish(),
  account_id: z.string().uuid().nullish(),
  contact_id: z.string().uuid().nullish(),
  owner_id: z.string().uuid().nullish(),
  type: z.enum(['meeting', 'call', 'followup', 'site_visit', 'email', 'task', ...MARKETING_TYPES]),
  subject: z.string().trim().min(1),
  due_at: z.string().datetime({ offset: true }),
  location: z.string().nullish(),
  notes: z.string().nullish(),
  outcome: z.string().nullish(),
  completed_at: z.string().datetime({ offset: true }).nullish(),
});

const listQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  state: z.enum(['open', 'overdue', 'today', 'done', 'all']).default('open'),
  from: z.string().optional(),
  to: z.string().optional(),
  booking_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  /** Comma separated, e.g. "meeting,site_visit" for the meetings calendar. */
  type: z.string().regex(/^[a-z_,]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export { syncBookingFollowup };

export async function activityRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.activity) };

  app.get('/activities', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const q = listQuery.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.scope === 'mine') {
        // "Mine" also holds the open follow-ups of people I am covering for (when they handed them over).
        const handover = (req.scope?.covering ?? []).filter((c) => c.handoverActivities).map((c) => c.delegatorId);
        where.push(`(a.owner_id = ${p(req.user.sub)} OR (a.completed_at IS NULL AND a.owner_id = ANY(${p(handover)}::uuid[])))`);
      }
      if (q.booking_id) where.push(`a.booking_id = ${p(q.booking_id)}`);
      if (q.owner_id) where.push(`a.owner_id = ${p(q.owner_id)}`);
      if (q.type) where.push(`a.type = ANY(${p(q.type.split(',').filter(Boolean))})`);
      if (q.state === 'open') where.push('a.completed_at IS NULL');
      if (q.state === 'done') where.push('a.completed_at IS NOT NULL');
      if (q.state === 'overdue') where.push('a.completed_at IS NULL AND a.due_at < now()');
      if (q.state === 'today') {
        where.push(`a.completed_at IS NULL AND (a.due_at AT TIME ZONE t.timezone)::date = (now() AT TIME ZONE t.timezone)::date`);
      }
      if (q.from) where.push(`a.due_at >= ${p(q.from)}`);
      if (q.to) where.push(`a.due_at < ${p(q.to)}`);
      const { rows } = await db.query(
        `SELECT a.*, u.name AS owner_name, u.code AS owner_code, cb.name || coalesce(' (' || cb.employee_no || ')', '') AS completed_by_name, cob.name || coalesce(' (' || cob.employee_no || ')', '') AS completed_on_behalf_of_name,
                (a.owner_id <> ${p(req.user.sub)}) AS not_mine, b.booking_no, b.name AS booking_name, b.status AS booking_status,
                c.name AS contact_name, c.phone AS contact_phone, ac.name AS account_name,
                coalesce(ac.customer_no, c.customer_no) AS customer_no
         FROM activities a
         JOIN tenants t ON t.id = a.tenant_id
         LEFT JOIN users u ON u.id = a.owner_id
         LEFT JOIN users cb ON cb.id = a.completed_by
         LEFT JOIN users cob ON cob.id = a.completed_on_behalf_of
         LEFT JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN contacts c ON c.id = coalesce(a.contact_id, b.contact_id)
         LEFT JOIN accounts ac ON ac.id = a.account_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY a.completed_at IS NOT NULL, a.due_at LIMIT ${p(q.limit)}`,
        params,
      );
      return rows;
    }),
  );

  app.post('/activities', sell, (req) =>
    tx(req, async (db) => {
      const body = activitySchema.parse(req.body);
      assertLinked(body);
      const ctx = body.booking_id ? await writable(db, req, body.booking_id) : null;
      const activity = await insertRow(db, 'activities', {
        ...body,
        owner_id: body.owner_id === undefined ? req.user.sub : body.owner_id,
      });
      if (ctx) await logChange(db, req, ctx, `${body.type.replace('_', ' ')} scheduled`, { subject: body.subject });
      await syncBookingFollowup(db, body.booking_id);
      return activity;
    }),
  );

  app.patch('/activities/:id', sell, (req) =>
    tx(req, async (db) => {
      const current = await getRow<{ booking_id: string | null; contact_id: string | null; account_id: string | null; type: string }>(
        db, 'activities', id.parse(req.params).id, 'Activity');
      if (current.booking_id) await writable(db, req, current.booking_id);
      const body = activitySchema.partial().parse(req.body);
      // Changing the link or the type must keep the activity linked (older unlinked ones can still be edited).
      if (['booking_id', 'contact_id', 'account_id', 'type'].some((k) => k in body)) assertLinked({ ...current, ...body });
      const activity = await updateRow<{ booking_id: string | null }>(db, 'activities', id.parse(req.params).id, body, 'Activity');
      await syncBookingFollowup(db, activity.booking_id);
      return activity;
    }),
  );

  app.post('/activities/:id/complete', sell, (req) =>
    tx(req, async (db) => {
      const { outcome } = z.object({ outcome: z.string().nullish() }).parse(req.body ?? {});
      const current = await getRow<{ booking_id: string | null; owner_id: string | null; subject: string; type: string }>(
        db, 'activities', id.parse(req.params).id, 'Activity');
      // The meeting outcome feeds the daily activity report, so it cannot be skipped.
      if (MEETING_TYPES.includes(current.type) && !outcome?.trim()) {
        throw badRequest('Write the outcome of the meeting before marking it done');
      }
      const ctx = current.booking_id ? await writable(db, req, current.booking_id) : null;
      // Completing someone else's follow-up while covering for them is recorded as such.
      const behalf = current.owner_id && current.owner_id !== req.user.sub ? onBehalfOf(req, current.owner_id) : null;
      const activity = await updateRow<{ booking_id: string | null }>(
        db, 'activities', id.parse(req.params).id,
        { completed_at: new Date().toISOString(), outcome: outcome ?? undefined, completed_by: req.user.sub,
          completed_on_behalf_of: behalf ?? ctx?.onBehalfOf ?? null }, 'Activity');
      if (ctx) await logChange(db, req, { ...ctx, onBehalfOf: behalf ?? ctx.onBehalfOf }, 'follow-up completed', { subject: current.subject, outcome });
      await syncBookingFollowup(db, activity.booking_id);
      return activity;
    }),
  );

  // Plan: move the open activities of one week to the same days of the next week.
  app.post('/activities/carry-over', sell, (req) =>
    tx(req, async (db) => {
      const q = z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        owner_id: z.string().uuid().optional(), days: z.number().int().min(1).max(31).default(7),
      }).parse(req.body);
      const { rowCount } = await db.query(
        `UPDATE activities a SET due_at = a.due_at + make_interval(days => $4)
         FROM tenants t
         WHERE t.id = a.tenant_id AND a.completed_at IS NULL AND a.owner_id = $3
           AND (a.due_at AT TIME ZONE t.timezone)::date BETWEEN $1 AND $2`,
        [q.from, q.to, q.owner_id ?? req.user.sub, q.days],
      );
      return { moved: rowCount ?? 0 };
    }),
  );

  // Find a contract or a customer to link an activity to (by number, name or phone).
  app.get('/links', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query);
      const like = `%${q}%`;
      const contracts = (await db.query(
        `SELECT b.id, b.booking_no AS code, b.name, b.status, c.name AS client, c.phone
         FROM bookings b LEFT JOIN contacts c ON c.id = b.contact_id
         WHERE b.booking_no ILIKE $1 OR b.name ILIKE $1 OR c.name ILIKE $1 OR c.phone ILIKE $1
         ORDER BY b.inquiry_date DESC LIMIT 8`, [like])).rows;
      const customers = (await db.query(
        `SELECT id, 'contact' AS kind, customer_no AS code, name, phone FROM contacts
         WHERE customer_no ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1 OR social_handle ILIKE $1
         UNION ALL
         SELECT id, 'account', customer_no, name, phone FROM accounts
         WHERE customer_no ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1
         ORDER BY code LIMIT 8`, [like])).rows;
      return { contracts, customers };
    }),
  );

}

/**
 * Keep the booking's LAST FOLLOWUP / next follow-up dates in step with its
 * activities, as the daily report tracks them per booking.
 */
async function syncBookingFollowup(db: import('../db.js').Db, bookingId: string | null | undefined) {
  if (!bookingId) return;
  await db.query(
    `UPDATE bookings b SET
       last_followup_date = coalesce(
         (SELECT max((a.completed_at AT TIME ZONE t.timezone)::date) FROM activities a WHERE a.booking_id = b.id),
         b.last_followup_date),
       next_followup_date =
         (SELECT min((a.due_at AT TIME ZONE t.timezone)::date) FROM activities a
          WHERE a.booking_id = b.id AND a.completed_at IS NULL)
     FROM tenants t WHERE t.id = b.tenant_id AND b.id = $1`,
    [bookingId],
  );
}
