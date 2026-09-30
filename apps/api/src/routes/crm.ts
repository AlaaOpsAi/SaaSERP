import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import { deleteRow, getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const accountSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(['company', 'agency', 'government', 'individual']).default('company'),
  business_type: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
  address: z.string().nullish(),
  country: z.string().nullish(),
  notes: z.string().nullish(),
  owner_id: z.string().uuid().nullish(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1),
  account_id: z.string().uuid().nullish(),
  phone: z.string().nullish(),
  email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
  nationality: z.string().nullish(),
  address: z.string().nullish(),
  social_handle: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function crmRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.sell) };

  app.get('/accounts', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { q, limit } = listQuery.parse(req.query);
      const { rows } = await db.query(
        `SELECT a.*, u.name AS owner_name,
                (SELECT count(*) FROM bookings b WHERE b.account_id = a.id) AS booking_count
         FROM accounts a LEFT JOIN users u ON u.id = a.owner_id
         WHERE ($1::text IS NULL OR a.name ILIKE '%' || $1 || '%' OR a.phone ILIKE '%' || $1 || '%')
         ORDER BY a.name LIMIT $2`,
        [q || null, limit],
      );
      return rows;
    }),
  );
  app.get('/accounts/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const account = await getRow<Record<string, unknown>>(db, 'accounts', id.parse(req.params).id, 'Account');
      const contacts = await db.query('SELECT * FROM contacts WHERE account_id = $1 ORDER BY name', [account.id]);
      const bookings = await db.query(
        `SELECT b.id, b.booking_no, b.name, b.status, b.event_date, f.revenue
         FROM bookings b JOIN booking_finance f ON f.booking_id = b.id
         WHERE b.account_id = $1 ORDER BY b.event_date DESC NULLS LAST`,
        [account.id],
      );
      return { ...account, contacts: contacts.rows, bookings: bookings.rows };
    }),
  );
  app.post('/accounts', sell, (req) => tx(req, (db) => insertRow(db, 'accounts', accountSchema.parse(req.body))));
  app.patch('/accounts/:id', sell, (req) =>
    tx(req, (db) => updateRow(db, 'accounts', id.parse(req.params).id, accountSchema.partial().parse(req.body), 'Account')),
  );
  app.delete('/accounts/:id', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'accounts', id.parse(req.params).id, 'Account');
      return { ok: true };
    }),
  );

  app.get('/contacts', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { q, limit } = listQuery.parse(req.query);
      const { rows } = await db.query(
        `SELECT c.*, a.name AS account_name,
                (SELECT count(*) FROM bookings b WHERE b.contact_id = c.id) AS booking_count
         FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
         WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%'
                OR c.email ILIKE '%' || $1 || '%' OR c.social_handle ILIKE '%' || $1 || '%')
         ORDER BY c.name LIMIT $2`,
        [q || null, limit],
      );
      return rows;
    }),
  );
  app.get('/contacts/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const contact = await getRow<Record<string, unknown>>(db, 'contacts', id.parse(req.params).id, 'Contact');
      const bookings = await db.query(
        `SELECT b.id, b.booking_no, b.name, b.status, b.event_date, f.revenue
         FROM bookings b JOIN booking_finance f ON f.booking_id = b.id
         WHERE b.contact_id = $1 ORDER BY b.event_date DESC NULLS LAST`,
        [contact.id],
      );
      return { ...contact, bookings: bookings.rows };
    }),
  );
  app.post('/contacts', sell, (req) => tx(req, (db) => insertRow(db, 'contacts', contactSchema.parse(req.body))));
  app.patch('/contacts/:id', sell, (req) =>
    tx(req, (db) => updateRow(db, 'contacts', id.parse(req.params).id, contactSchema.partial().parse(req.body), 'Contact')),
  );
  app.delete('/contacts/:id', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'contacts', id.parse(req.params).id, 'Contact');
      return { ok: true };
    }),
  );
}
