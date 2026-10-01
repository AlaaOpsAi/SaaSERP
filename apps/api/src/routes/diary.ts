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

      // Every occupied room is shown; details of other teams' bookings are hidden.
      const events = await db.query('SELECT * FROM diary_events($1, $2, $3, $4)', [q.from, q.to, q.include_lost, q.venue_id ?? null]);
      const rows = events.rows.map((e) =>
        e.visible ? e : { ...e, name: 'Booked', booking_id: null, booking_no: '', booking_name: 'Another team', owner_code: null, expected_pax: null });
      return { spaces: spaces.rows, events: rows };
    }),
  );
}
