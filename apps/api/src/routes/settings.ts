import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { deleteRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
const pct = z.number().min(0).max(1);

const tenantPatch = z.object({
  name: z.string().trim().min(2).max(120),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(3),
  fixed_cost_pct: pct,
  credit_facility_pct: pct,
}).partial();

const roles = z.enum(['owner', 'admin', 'manager', 'sales', 'finance', 'viewer']);
const userCreate = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email().nullish(),
  code: z.string().trim().toUpperCase().min(1).max(6).nullish(),
  role: roles.default('sales'),
  password: z.string().min(8).optional(),
  is_active: z.boolean().default(true),
});
const userPatch = userCreate.partial();

const buSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/),
  name: z.string().trim().min(1),
  is_active: z.boolean().optional(),
});

const lookupSchema = z.object({
  type: z.string().regex(/^[a-z_]+$/),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const venueSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(['hotel', 'hall', 'client_location', 'own', 'other']).default('hotel'),
  address: z.string().nullish(),
  is_active: z.boolean().optional(),
});

const spaceSchema = z.object({
  venue_id: z.string().uuid(),
  name: z.string().trim().min(1),
  capacity: z.number().int().positive().nullish(),
  area_sqm: z.number().positive().nullish(),
  allow_overlap: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole(can.admin) };

  // ---- tenant ------------------------------------------------------------
  app.patch('/tenant', admin, (req) =>
    tx(req, (db) => updateRow(db, 'tenants', req.user.tid, tenantPatch.parse(req.body), 'Tenant')),
  );

  // ---- users -------------------------------------------------------------
  app.get('/users', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT id, email, name, code, role, is_active, last_login_at, created_at
         FROM users ORDER BY is_active DESC, name`,
      );
      return rows;
    }),
  );

  app.post('/users', admin, (req) =>
    tx(req, async (db) => {
      const { password, ...body } = userCreate.parse(req.body);
      if (body.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only owners can add owners');
      if (body.is_active && body.email) {
        const { rows } = await db.query(
          `SELECT t.max_users, (SELECT count(*) FROM users WHERE is_active AND email IS NOT NULL) AS n
           FROM tenants t WHERE t.id = current_tenant_id()`,
        );
        if (rows[0].n >= rows[0].max_users) {
          throw badRequest(`Your plan allows ${rows[0].max_users} login users. Upgrade to add more.`);
        }
      }
      const user = await insertRow<Record<string, unknown>>(db, 'users', {
        ...body,
        password_hash: password ? await hashPassword(password) : undefined,
      });
      delete user.password_hash;
      return user;
    }),
  );

  app.patch('/users/:id', admin, (req) =>
    tx(req, async (db) => {
      const { id: userId } = id.parse(req.params);
      const { password, ...body } = userPatch.parse(req.body);
      if (body.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only owners can grant owner');
      if (userId === req.user.sub && (body.is_active === false || (body.role && body.role !== req.user.role))) {
        throw badRequest('You cannot deactivate yourself or change your own role');
      }
      const user = await updateRow<Record<string, unknown>>(db, 'users', userId, {
        ...body,
        password_hash: password ? await hashPassword(password) : undefined,
      }, 'User');
      delete user.password_hash;
      return user;
    }),
  );

  // ---- business units ----------------------------------------------------
  app.get('/business-units', { preHandler: authed }, (req) =>
    tx(req, async (db) => (await db.query('SELECT * FROM business_units ORDER BY code')).rows),
  );
  app.post('/business-units', admin, (req) => tx(req, (db) => insertRow(db, 'business_units', buSchema.parse(req.body))));
  app.patch('/business-units/:id', admin, (req) =>
    tx(req, (db) => updateRow(db, 'business_units', id.parse(req.params).id, buSchema.partial().parse(req.body), 'Business unit')),
  );

  // ---- lookups -----------------------------------------------------------
  app.get('/lookups', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query('SELECT * FROM lookups ORDER BY type, sort_order, label');
      const grouped: Record<string, unknown[]> = {};
      for (const r of rows) (grouped[r.type] ??= []).push(r);
      return grouped;
    }),
  );
  app.post('/lookups', admin, (req) => tx(req, (db) => insertRow(db, 'lookups', lookupSchema.parse(req.body))));
  app.patch('/lookups/:id', admin, (req) =>
    tx(req, (db) => updateRow(db, 'lookups', id.parse(req.params).id, lookupSchema.partial().parse(req.body), 'Lookup')),
  );
  app.delete('/lookups/:id', admin, (req) =>
    tx(req, async (db) => {
      await deleteRow(db, 'lookups', id.parse(req.params).id, 'Lookup');
      return { ok: true };
    }),
  );

  // ---- venues & function spaces -----------------------------------------
  app.get('/venues', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT v.*, coalesce(json_agg(s ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]') AS spaces
         FROM venues v LEFT JOIN function_spaces s ON s.venue_id = v.id
         GROUP BY v.id ORDER BY v.name`,
      );
      return rows;
    }),
  );
  app.post('/venues', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, (db) => insertRow(db, 'venues', venueSchema.parse(req.body))),
  );
  app.patch('/venues/:id', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, (db) => updateRow(db, 'venues', id.parse(req.params).id, venueSchema.partial().parse(req.body), 'Venue')),
  );
  app.post('/function-spaces', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, (db) => insertRow(db, 'function_spaces', spaceSchema.parse(req.body))),
  );
  app.patch('/function-spaces/:id', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, (db) =>
      updateRow(db, 'function_spaces', id.parse(req.params).id, spaceSchema.partial().parse(req.body), 'Function space'),
    ),
  );
}
