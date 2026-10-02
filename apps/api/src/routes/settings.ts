import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, can, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { notify } from '../lib/notify.js';
import { deleteRow, getRow, insertRow, updateRow } from '../lib/sql.js';

const id = z.object({ id: z.string().uuid() });
const pct = z.number().min(0).max(1);

const tenantPatch = z.object({
  default_locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  branding: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() }),
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
  manager_id: z.string().uuid().nullish(),
  data_scope: z.enum(['all', 'team']).optional(),
});
const userPatch = userCreate.partial();

/** Roles that see the whole workspace unless told otherwise. */
const SEES_ALL_BY_DEFAULT = new Set(['owner', 'admin', 'finance']);

/** A manager must exist and must not be the user or anyone below them (no loops). */
async function assertManager(db: Db, userId: string | null, managerId: string | null | undefined) {
  if (!managerId) return;
  if (managerId === userId) throw badRequest('Someone cannot report to themselves');
  await getRow(db, 'users', managerId, 'Manager');
  if (!userId) return;
  const { rows } = await db.query(
    `WITH RECURSIVE below(id, depth) AS (
       SELECT $1::uuid, 0
       UNION SELECT u.id, b.depth + 1 FROM users u JOIN below b ON u.manager_id = b.id WHERE b.depth < 20
     ) SELECT 1 FROM below WHERE id = $2`,
    [userId, managerId],
  );
  if (rows[0]) throw badRequest('That would create a loop: the chosen manager already reports to this person');
}

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
  translations: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string().trim().max(200)).optional(),
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

/** Name the user who already holds this email or initials, instead of a bare unique-violation. */
async function assertUnique(db: Db, fields: { email?: string | null; code?: string | null }, exceptId?: string) {
  for (const field of ['email', 'code'] as const) {
    const value = fields[field];
    if (!value) continue;
    const { rows } = await db.query(
      `SELECT id, name, code, email, is_active FROM users WHERE ${field} = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
      [value, exceptId ?? null],
    );
    if (rows[0]) {
      const other = rows[0];
      const who = `${other.name}${other.code ? ` (${other.code})` : ''}`;
      throw conflict(
        field === 'email'
          ? `${who} already uses the email ${value}. If they are the same person, merge the two users.`
          : `${who} already uses the initials ${value}. If they are the same person, merge the two users.`,
        { field, existing_user: other },
      );
    }
  }
}

/** Login users (active, with an email) may not exceed the plan allowance. */
async function assertSeat(db: Db, exceptId?: string) {
  const { rows } = await db.query(
    `SELECT t.max_users,
            (SELECT count(*) FROM users WHERE is_active AND email IS NOT NULL AND ($1::uuid IS NULL OR id <> $1)) AS n
     FROM tenants t WHERE t.id = current_tenant_id()`,
    [exceptId ?? null],
  );
  if (rows[0].n >= rows[0].max_users) {
    throw badRequest(`Your plan allows ${rows[0].max_users} login users. Deactivate someone or ask us to raise the limit.`);
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole(can.admin) };

  // ---- tenant ------------------------------------------------------------
  app.patch('/tenant', admin, (req) =>
    tx(req, (db) => {
      const { branding, ...rest } = tenantPatch.parse(req.body);
      return updateRow(db, 'tenants', req.user.tid, { ...rest, branding: branding ? JSON.stringify(branding) : undefined }, 'Tenant');
    }),
  );

  // ---- users -------------------------------------------------------------
  app.get('/users', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query(
        `SELECT id, email, name, code, role, is_active, last_login_at, created_at, manager_id, data_scope,
                (app_sees_all() OR id = ANY (app_write_ids())) AS in_my_team
         FROM users ORDER BY is_active DESC, name`,
      );
      return rows;
    }),
  );

  app.post('/users', admin, (req) =>
    tx(req, async (db) => {
      const { password, ...body } = userCreate.parse(req.body);
      if (body.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only owners can add owners');
      await assertUnique(db, body);
      await assertManager(db, null, body.manager_id);
      body.data_scope ??= SEES_ALL_BY_DEFAULT.has(body.role) ? 'all' : 'team';
      if (body.is_active && body.email) {
        await assertSeat(db);
        if (!password) throw badRequest('Set a password so this user can sign in');
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
      const current = await getRow<{ email: string | null; is_active: boolean; password_hash: string | null }>(db, 'users', userId, 'User');
      await assertUnique(db, body, userId);
      if (body.manager_id !== undefined) await assertManager(db, userId, body.manager_id);
      const email = body.email === undefined ? current.email : body.email;
      const active = body.is_active ?? current.is_active;
      if (active && email) {
        // Becoming a login user takes a seat and needs a password.
        if (!(current.is_active && current.email)) await assertSeat(db, userId);
        if (!current.password_hash && !password) throw badRequest('Set a password so this user can sign in');
      }
      const user = await updateRow<Record<string, unknown>>(db, 'users', userId, {
        ...body,
        password_hash: password ? await hashPassword(password) : undefined,
      }, 'User');
      delete user.password_hash;
      return user;
    }),
  );

  // Transfer: someone is leaving. Their work moves to a colleague; history and paid commission stay.
  app.post('/users/:id/transfer', { preHandler: requireRole(can.manage) }, (req) =>
    tx(req, async (db) => {
      const { id: fromId } = id.parse(req.params);
      const body = z.object({
        to_user_id: z.string().uuid(),
        bookings: z.enum(['open', 'all', 'none']).default('open'),
        activities: z.boolean().default(true),
        clients: z.boolean().default(true),
        reports: z.boolean().default(true),
        deactivate: z.boolean().default(true),
      }).parse(req.body);
      const scope = req.scope!;
      if (fromId === req.user.sub) throw badRequest('You cannot transfer your own work; ask your manager or an admin');
      if (fromId === body.to_user_id) throw badRequest('Choose a different person to take over');
      const from = await getRow<{ name: string; role: string }>(db, 'users', fromId, 'User');
      const to = await getRow<{ name: string; is_active: boolean }>(db, 'users', body.to_user_id, 'User');
      if (!scope.seesAll && (!scope.teamIds.includes(fromId) || !scope.teamIds.includes(body.to_user_id))) {
        throw forbidden('You can transfer work only between people in your team');
      }
      if (from.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only owners can transfer an owner');
      if (!to.is_active) throw badRequest(`${to.name} is not active`);

      const statuses = body.bookings === 'open' ? ['INQ', 'TEN', 'DEF'] : ['INQ', 'TEN', 'DEF', 'ACT', 'LOS', 'CXL'];
      const moved = { bookings: 0, activities: 0, clients: 0, reports: 0 };
      if (body.bookings !== 'none') {
        const r = await db.query(
          `UPDATE bookings SET owner_id = $2 WHERE owner_id = $1 AND status = ANY($3) RETURNING id`,
          [fromId, body.to_user_id, statuses],
        );
        moved.bookings = r.rowCount ?? 0;
        if (r.rows.length) {
          await db.query(
            `INSERT INTO booking_log (tenant_id, booking_id, actor_id, action, details)
             SELECT current_tenant_id(), unnest($1::uuid[]), $2, 'transferred', $3`,
            [r.rows.map((x) => x.id), req.user.sub, JSON.stringify({ from: from.name, to: to.name })],
          );
        }
      }
      if (body.activities) {
        moved.activities = (await db.query(
          'UPDATE activities SET owner_id = $2 WHERE owner_id = $1 AND completed_at IS NULL', [fromId, body.to_user_id])).rowCount ?? 0;
      }
      if (body.clients) {
        moved.clients = (await db.query('UPDATE accounts SET owner_id = $2 WHERE owner_id = $1', [fromId, body.to_user_id])).rowCount ?? 0;
      }
      if (body.reports) {
        moved.reports = (await db.query(
          'UPDATE users SET manager_id = $2 WHERE manager_id = $1 AND id <> $2', [fromId, body.to_user_id])).rowCount ?? 0;
      }
      if (body.deactivate) {
        await db.query('UPDATE users SET is_active = false WHERE id = $1', [fromId]);
        await db.query(
          `UPDATE delegations SET revoked_at = now(), revoked_by = $2
           WHERE (delegator_id = $1 OR delegate_id = $1) AND revoked_at IS NULL`,
          [fromId, req.user.sub],
        );
      }
      await notify(db, body.to_user_id,
        `${from.name}'s work was transferred to you: ${moved.bookings} bookings, ${moved.activities} follow-ups, ${moved.clients} clients.`, '/bookings');
      return { moved, deactivated: body.deactivate };
    }),
  );

  // Merge a duplicate user into another: their bookings, activities, clients and
  // payouts move to the target, which also takes over the initials if it has none.
  app.post('/users/:id/merge-into/:targetId', admin, (req) =>
    tx(req, async (db) => {
      const { id: sourceId, targetId } = z.object({ id: z.string().uuid(), targetId: z.string().uuid() }).parse(req.params);
      if (sourceId === targetId) throw badRequest('Choose two different users');
      if (sourceId === req.user.sub) throw badRequest('You cannot merge away your own account; merge the other user into yours');
      const source = await getRow<{ role: string; code: string | null }>(db, 'users', sourceId, 'User');
      await getRow(db, 'users', targetId, 'User');
      if (source.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only owners can merge an owner');
      const moves: [string, string][] = [
        ['bookings', 'owner_id'], ['bookings', 'created_by'], ['activities', 'owner_id'], ['accounts', 'owner_id'],
        ['booking_payouts', 'user_id'], ['payments', 'created_by'], ['booking_status_history', 'changed_by'],
      ];
      const moved: Record<string, number> = {};
      for (const [table, column] of moves) {
        const r = await db.query(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [sourceId, targetId]);
        moved[`${table}.${column}`] = r.rowCount ?? 0;
      }
      // The duplicate's reports now report to the kept user (unless that is the kept user itself).
      await db.query('UPDATE users SET manager_id = $2 WHERE manager_id = $1 AND id <> $2', [sourceId, targetId]);
      await db.query(
        'UPDATE users SET manager_id = (SELECT manager_id FROM users WHERE id = $1) WHERE id = $2 AND manager_id = $1',
        [sourceId, targetId],
      );
      await db.query('DELETE FROM users WHERE id = $1', [sourceId]);
      if (source.code) {
        await db.query('UPDATE users SET code = coalesce(code, $2) WHERE id = $1', [targetId, source.code]);
      }
      const { rows } = await db.query('SELECT id, email, name, code, role, is_active FROM users WHERE id = $1', [targetId]);
      return { user: rows[0], moved };
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
  const lookupRow = (b: { translations?: Record<string, string> } & Record<string, unknown>) =>
    ({ ...b, translations: b.translations ? JSON.stringify(b.translations) : undefined });
  app.post('/lookups', admin, (req) => tx(req, (db) => insertRow(db, 'lookups', lookupRow(lookupSchema.parse(req.body)))));
  app.patch('/lookups/:id', admin, (req) =>
    tx(req, (db) => updateRow(db, 'lookups', id.parse(req.params).id, lookupRow(lookupSchema.partial().parse(req.body)), 'Lookup')),
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
