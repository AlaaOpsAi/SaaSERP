import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import { badRequest } from '../lib/errors.js';

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_id: z.string().uuid().optional(),
  include_lost: z.coerce.boolean().default(false),
});

/**
 * Function diary: every function space with the events that occupy it in a
 * date window, plus which of them collide.
 */
export async function diaryRoutes(app: FastifyInstance) {
  app.get('/diary', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const q = query.parse(req.query);
      if (q.to < q.from) throw badRequest('"to" must not be before "from"');
      const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
      if (days > 93) throw badRequest('The diary shows at most 3 months at a time');

      const spaces = await db.query(
        `SELECT s.id, s.name, s.capacity, s.allow_overlap, v.id AS venue_id, v.name AS venue_name
         FROM function_spaces s JOIN venues v ON v.id = s.venue_id
         WHERE s.is_active AND v.is_active AND ($1::uuid IS NULL OR v.id = $1)
         ORDER BY v.name, s.name`,
        [q.venue_id ?? null],
      );

      const events = await db.query(
        `WITH win AS (
           SELECT ($1::date::timestamp AT TIME ZONE t.timezone) AS lo,
                  (($2::date + 1)::timestamp AT TIME ZONE t.timezone) AS hi
           FROM tenants t WHERE t.id = current_tenant_id()
         )
         SELECT e.id, e.name, e.function_space_id, e.start_at, e.end_at, e.expected_pax, e.setup_style,
                b.id AS booking_id, b.booking_no, b.name AS booking_name, b.status, u.code AS owner_code,
                EXISTS (
                  SELECT 1 FROM booking_events o
                  JOIN bookings ob ON ob.id = o.booking_id
                  JOIN function_spaces os ON os.id = o.function_space_id AND NOT os.allow_overlap
                  WHERE o.function_space_id = e.function_space_id AND o.id <> e.id AND ob.id <> b.id
                    AND ob.status IN ('TEN','DEF','ACT')
                    AND tstzrange(o.start_at, o.end_at) && tstzrange(e.start_at, e.end_at)
                ) AS overlaps
         FROM booking_events e
         JOIN bookings b ON b.id = e.booking_id
         LEFT JOIN users u ON u.id = b.owner_id
         CROSS JOIN win
         WHERE e.function_space_id IS NOT NULL
           AND tstzrange(e.start_at, e.end_at) && tstzrange(win.lo, win.hi)
           AND ($3 OR b.status NOT IN ('LOS', 'CXL'))
         ORDER BY e.start_at`,
        [q.from, q.to, q.include_lost],
      );
      return { spaces: spaces.rows, events: events.rows };
    }),
  );
}
