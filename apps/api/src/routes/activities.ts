import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import { deleteRow, getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });

const activitySchema = z.object({
  booking_id: z.string().uuid().nullish(),
  account_id: z.string().uuid().nullish(),
  contact_id: z.string().uuid().nullish(),
  owner_id: z.string().uuid().nullish(),
  type: z.enum(['meeting', 'call', 'followup', 'site_visit', 'email', 'task']),
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
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function activityRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.sell) };

  app.get('/activities', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const q = listQuery.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.scope === 'mine') where.push(`a.owner_id = ${p(req.user.sub)}`);
      if (q.booking_id) where.push(`a.booking_id = ${p(q.booking_id)}`);
      if (q.state === 'open') where.push('a.completed_at IS NULL');
      if (q.state === 'done') where.push('a.completed_at IS NOT NULL');
      if (q.state === 'overdue') where.push('a.completed_at IS NULL AND a.due_at < now()');
      if (q.state === 'today') {
        where.push(`a.completed_at IS NULL AND (a.due_at AT TIME ZONE t.timezone)::date = (now() AT TIME ZONE t.timezone)::date`);
      }
      if (q.from) where.push(`a.due_at >= ${p(q.from)}`);
      if (q.to) where.push(`a.due_at < ${p(q.to)}`);
      const { rows } = await db.query(
        `SELECT a.*, u.name AS owner_name, b.booking_no, b.name AS booking_name, b.status AS booking_status,
                c.name AS contact_name, c.phone AS contact_phone, ac.name AS account_name
         FROM activities a
         JOIN tenants t ON t.id = a.tenant_id
         LEFT JOIN users u ON u.id = a.owner_id
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
      const activity = await insertRow(db, 'activities', {
        ...body,
        owner_id: body.owner_id === undefined ? req.user.sub : body.owner_id,
      });
      await syncBookingFollowup(db, body.booking_id);
      return activity;
    }),
  );

  app.patch('/activities/:id', sell, (req) =>
    tx(req, async (db) => {
      const activity = await updateRow<{ booking_id: string | null }>(
        db, 'activities', id.parse(req.params).id, activitySchema.partial().parse(req.body), 'Activity');
      await syncBookingFollowup(db, activity.booking_id);
      return activity;
    }),
  );

  app.post('/activities/:id/complete', sell, (req) =>
    tx(req, async (db) => {
      const { outcome } = z.object({ outcome: z.string().nullish() }).parse(req.body ?? {});
      const activity = await updateRow<{ booking_id: string | null }>(
        db, 'activities', id.parse(req.params).id,
        { completed_at: new Date().toISOString(), outcome: outcome ?? undefined }, 'Activity');
      await syncBookingFollowup(db, activity.booking_id);
      return activity;
    }),
  );

  app.delete('/activities/:id', sell, (req) =>
    tx(req, async (db) => {
      const activity = await getRow<{ booking_id: string | null }>(db, 'activities', id.parse(req.params).id, 'Activity');
      await deleteRow(db, 'activities', id.parse(req.params).id, 'Activity');
      await syncBookingFollowup(db, activity.booking_id);
      return { ok: true };
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
