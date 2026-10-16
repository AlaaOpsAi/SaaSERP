import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { contactName } from '../lib/contact.js';
import { assertNoDuplicate, findDuplicate } from '../lib/customers.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const listQuery = z.object({
  q: z.string().trim().optional(),
  relation: z.string().optional(),
  segment: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const email = z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null));
// Blank becomes null; a field left out stays out (so a partial update never clears it).
const text = z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null));

/** Fields of the CRM workbook shared by people and companies. */
const common = {
  phone: text,
  mobile2: text,
  landline: text,
  email,
  address: text,
  country: text,
  city: text,
  zip: text,
  web: text,
  segment: text,
  industry: text,
  newsletter: z.boolean().optional(),
  contact_mode: text,
  notes: text,
};

const accountSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(['company', 'agency', 'government', 'individual']).default('company'),
  business_type: text,
  registration_no: text,
  license_no: text,
  tax_id: text,
  legal_rep: text,
  parent_account_id: z.string().uuid().nullish(),
  established_on: date.nullish(),
  owner_id: z.string().uuid().nullish(),
  ...common,
});

const contactSchema = z.object({
  name: z.string().trim().min(1).optional(),
  first_name: text,
  family_name: text,
  title: text,
  gender: z.enum(['M', 'F']).nullish(),
  position: text,
  account_id: z.string().uuid().nullish(),
  nationality: text,
  social_handle: text,
  civil_id: text,
  birth_date: date.nullish(),
  ...common,
});

const relationshipSchema = z.object({
  relation: z.string().min(1, 'Choose the relationship'),
  relation_old: text,
  segment: text,
  booking_id: z.string().uuid().nullish(),
  registered_on: date.optional(),
  registered_by: z.string().uuid().nullish(),
  comments: text,
});

const applicantSchema = z.object({
  education: text,
  degree_industry: text,
  degree_industry2: text,
  degree_name: text,
  degree_year: z.number().int().min(1950).max(2100).nullish(),
  degree_country: text,
  years_experience: z.number().min(0).max(80).nullish(),
  manager_experience: z.boolean().nullish(),
  companies: text,
  experience_fields: text,
  languages: text,
  driving_license: text,
});

type Kind = 'contacts' | 'accounts';

/** Consent is stamped with the moment it was given. */
function consent<T extends { newsletter?: boolean }>(body: T) {
  if (body.newsletter === undefined) return body;
  return { ...body, newsletter_at: body.newsletter ? new Date().toISOString() : null };
}

/** Every customer needs a way to reach them: an email or a mobile number. */
function assertReachable(v: { email?: string | null; phone?: string | null }) {
  if (!v.email && !v.phone) throw badRequest('Give an email or a mobile number');
}

async function relationshipsOf(db: Db, column: 'contact_id' | 'account_id', ownerId: string) {
  return (await db.query(
    `SELECT r.*, b.booking_no, b.name AS booking_name, u.name AS registered_by_name, u.code AS registered_by_code
     FROM customer_relationships r
     LEFT JOIN bookings b ON b.id = r.booking_id LEFT JOIN users u ON u.id = r.registered_by
     WHERE r.${column} = $1 ORDER BY r.registered_on DESC, r.created_at DESC`, [ownerId])).rows;
}

const RELATIONS = `(SELECT string_agg(DISTINCT r.relation, ',') FROM customer_relationships r WHERE r.%s = x.id) AS relations`;

export async function crmRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.sell) };

  /** Live check while typing: is this email or mobile already a customer? */
  app.get('/customers/check', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const q = z.object({ email: z.string().optional(), phone: z.string().optional(), kind: z.enum(['contacts', 'accounts']).optional(), id: z.string().uuid().optional() }).parse(req.query);
      return { duplicate: await findDuplicate(db, q, q.kind && q.id ? { kind: q.kind, id: q.id } : undefined) };
    }),
  );

  app.get('/accounts', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { q, limit, relation, segment } = listQuery.parse(req.query);
      const { rows } = await db.query(
        `SELECT x.*, u.name AS owner_name, ${RELATIONS.replace('%s', 'account_id')},
                (SELECT count(*) FROM bookings b WHERE b.account_id = x.id) AS booking_count
         FROM accounts x LEFT JOIN users u ON u.id = x.owner_id
         WHERE ($1::text IS NULL OR x.name ILIKE '%' || $1 || '%' OR x.phone ILIKE '%' || $1 || '%' OR x.email ILIKE '%' || $1 || '%'
                OR x.customer_no ILIKE '%' || $1 || '%' OR x.legacy_no ILIKE '%' || $1 || '%')
           AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM customer_relationships r WHERE r.account_id = x.id AND r.relation = $3))
           AND ($4::text IS NULL OR x.segment = $4)
         ORDER BY x.name LIMIT $2`,
        [q || null, limit, relation || null, segment || null],
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
      const extra = (await db.query(
        `SELECT p.name AS parent_account_name, u.name AS created_by_name FROM accounts a
         LEFT JOIN accounts p ON p.id = a.parent_account_id LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`, [account.id])).rows[0];
      return { ...account, ...extra, contacts: contacts.rows, bookings: bookings.rows, relationships: await relationshipsOf(db, 'account_id', account.id as string) };
    }),
  );
  app.post('/accounts', sell, (req) =>
    tx(req, async (db) => {
      const body = consent(accountSchema.parse(req.body));
      assertReachable(body);
      await assertNoDuplicate(db, body);
      return insertRow(db, 'accounts', { ...body, created_by: req.user.sub });
    }),
  );
  app.patch('/accounts/:id', sell, (req) =>
    tx(req, async (db) => {
      const accountId = id.parse(req.params).id;
      const body = consent(accountSchema.partial().parse(req.body));
      const current = await getRow<{ email: string | null; phone: string | null }>(db, 'accounts', accountId, 'Account');
      const next = { email: body.email !== undefined ? body.email : current.email, phone: body.phone !== undefined ? body.phone : current.phone };
      if (body.email !== undefined || body.phone !== undefined) {
        assertReachable(next);
        await assertNoDuplicate(db, next, { kind: 'accounts', id: accountId });
      }
      if (body.parent_account_id === accountId) throw badRequest('A company cannot be its own parent');
      return updateRow(db, 'accounts', accountId, body, 'Account');
    }),
  );

  app.get('/contacts', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { q, limit, relation, segment } = listQuery.parse(req.query);
      const { rows } = await db.query(
        `SELECT x.*, a.name AS account_name, ${RELATIONS.replace('%s', 'contact_id')},
                (SELECT count(*) FROM bookings b WHERE b.contact_id = x.id) AS booking_count
         FROM contacts x LEFT JOIN accounts a ON a.id = x.account_id
         WHERE ($1::text IS NULL OR x.name ILIKE '%' || $1 || '%' OR x.phone ILIKE '%' || $1 || '%' OR x.email ILIKE '%' || $1 || '%'
                OR x.social_handle ILIKE '%' || $1 || '%' OR x.customer_no ILIKE '%' || $1 || '%' OR x.legacy_no ILIKE '%' || $1 || '%'
                OR x.civil_id ILIKE '%' || $1 || '%')
           AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM customer_relationships r WHERE r.contact_id = x.id AND r.relation = $3))
           AND ($4::text IS NULL OR x.segment = $4)
         ORDER BY x.name LIMIT $2`,
        [q || null, limit, relation || null, segment || null],
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
      const extra = (await db.query(
        `SELECT a.name AS account_name, u.name AS created_by_name FROM contacts c
         LEFT JOIN accounts a ON a.id = c.account_id LEFT JOIN users u ON u.id = c.created_by WHERE c.id = $1`, [contact.id])).rows[0];
      const applicant = (await db.query('SELECT * FROM applicant_profiles WHERE contact_id = $1', [contact.id])).rows[0] ?? null;
      return { ...contact, ...extra, bookings: bookings.rows, relationships: await relationshipsOf(db, 'contact_id', contact.id as string), applicant };
    }),
  );
  app.post('/contacts', sell, (req) =>
    tx(req, async (db) => {
      const body = consent(contactSchema.parse(req.body));
      const name = contactName(body);
      if (!name) throw badRequest('Client name is required');
      assertReachable(body);
      await assertNoDuplicate(db, body);
      return insertRow(db, 'contacts', { ...body, name, created_by: req.user.sub });
    }),
  );
  app.patch('/contacts/:id', sell, (req) =>
    tx(req, async (db) => {
      const contactId = id.parse(req.params).id;
      const body = consent(contactSchema.partial().parse(req.body));
      const current = await getRow<{ first_name: string | null; family_name: string | null; name: string; email: string | null; phone: string | null }>(db, 'contacts', contactId, 'Contact');
      // Changing the first or family name keeps the display name in step.
      if (body.first_name !== undefined || body.family_name !== undefined) {
        const name = contactName({ name: body.name ?? current.name, first_name: body.first_name ?? current.first_name, family_name: body.family_name ?? current.family_name });
        if (name) body.name = name;
      }
      if (body.email !== undefined || body.phone !== undefined) {
        const next = { email: body.email !== undefined ? body.email : current.email, phone: body.phone !== undefined ? body.phone : current.phone };
        assertReachable(next);
        await assertNoDuplicate(db, next, { kind: 'contacts', id: contactId });
      }
      return updateRow(db, 'contacts', contactId, body, 'Contact');
    }),
  );

  // ---- business relationships (Client, Applicant, Supplier, …) --------------------

  for (const kind of ['contacts', 'accounts'] as Kind[]) {
    const column = kind === 'contacts' ? 'contact_id' : 'account_id';
    app.post(`/${kind}/:id/relationships`, sell, (req) =>
      tx(req, async (db) => {
        const ownerId = id.parse(req.params).id;
        await getRow(db, kind, ownerId, kind === 'contacts' ? 'Contact' : 'Account');
        const body = relationshipSchema.parse(req.body);
        return insertRow(db, 'customer_relationships', { ...body, [column]: ownerId, registered_by: body.registered_by ?? req.user.sub });
      }),
    );
  }
  app.patch('/customer-relationships/:id', sell, (req) =>
    tx(req, (db) => updateRow(db, 'customer_relationships', id.parse(req.params).id, relationshipSchema.partial().parse(req.body), 'Relationship')),
  );
  app.delete('/customer-relationships/:id', sell, (req) =>
    tx(req, async (db) => {
      const { rowCount } = await db.query('DELETE FROM customer_relationships WHERE id = $1', [id.parse(req.params).id]);
      if (!rowCount) throw notFound('Relationship');
      return { ok: true };
    }),
  );

  // ---- applicant profile ------------------------------------------------------------

  app.put('/contacts/:id/applicant', sell, (req) =>
    tx(req, async (db) => {
      const contactId = id.parse(req.params).id;
      await getRow(db, 'contacts', contactId, 'Contact');
      const body = applicantSchema.parse(req.body);
      const cols = Object.keys(body);
      const { rows } = await db.query(
        `INSERT INTO applicant_profiles (tenant_id, contact_id, ${cols.join(', ')}, updated_by, updated_at)
         VALUES (current_tenant_id(), $1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, now())
         ON CONFLICT (contact_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [contactId, ...cols.map((c) => (body as Record<string, unknown>)[c] ?? null), req.user.sub]);
      return rows[0];
    }),
  );
}
