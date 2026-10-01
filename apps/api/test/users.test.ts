import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { login, makeApp, newTenant, platform } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('team users', () => {
  it('explains a duplicate email / initials and lets you merge the duplicates', async () => {
    const owner = await newTenant(app);
    // As after an Excel import: an account manager with initials but no login, owning bookings…
    const imported = (await owner.post('/users', { name: 'JOU', code: 'JOU', is_active: false })).body;
    const booking = (await owner.post('/bookings', { name: 'Imported wedding', owner_id: imported.id })).body;
    // …and the same person added again as a login user.
    const login1 = (await owner.post('/users', { name: 'Joumana', email: 'joumana@x.com', password: 'password123' })).body;

    // Activating the imported user with the same email: a clear message, not a raw database error.
    const clash = await owner.patch(`/users/${imported.id}`, { is_active: true, email: 'joumana@x.com', password: 'password123' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('Joumana already uses the email joumana@x.com. If they are the same person, merge the two users.');
    expect(clash.body.details).toMatchObject({ field: 'email', existing_user: { id: login1.id } });
    const codeClash = await owner.patch(`/users/${login1.id}`, { code: 'JOU' });
    expect(codeClash.body.error).toContain('JOU (JOU) already uses the initials JOU');

    // Merge the imported placeholder into the real login user.
    const merged = await owner.post(`/users/${imported.id}/merge-into/${login1.id}`);
    expect(merged.status).toBe(200);
    expect(merged.body.user).toMatchObject({ id: login1.id, code: 'JOU', email: 'joumana@x.com' });
    expect((await owner.get(`/bookings/${booking.id}`)).body.owner_id).toBe(login1.id);
    expect((await owner.get('/users')).body.map((u: { name: string }) => u.name)).not.toContain('JOU');
    expect((await login(app, 'joumana@x.com', 'password123', owner.slug)).statusCode).toBe(200);
  });

  it('needs a password to give someone a login, and respects the plan limit', async () => {
    const owner = await newTenant(app);
    const am = (await owner.post('/users', { name: 'Lojain', code: 'LOJ', is_active: false })).body;
    const noPw = await owner.patch(`/users/${am.id}`, { is_active: true, email: 'loj@x.com' });
    expect(noPw.status).toBe(400);
    expect(noPw.body.error).toBe('Set a password so this user can sign in');
    expect((await owner.patch(`/users/${am.id}`, { is_active: true, email: 'loj@x.com', password: 'password123' })).status).toBe(200);

    // Plan of 2 login users: owner + Lojain. Activating a third is refused, even via edit.
    const ops = await platform(app);
    await ops.patch(`/platform/tenants/${owner.tenantId}`, { max_users: 2 });
    const third = (await owner.post('/users', { name: 'Melinda', code: 'MEL', is_active: false })).body;
    const over = await owner.patch(`/users/${third.id}`, { is_active: true, email: 'mel@x.com', password: 'password123' });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('plan allows 2 login users');
    // Editing an existing login user is not blocked by the limit.
    expect((await owner.patch(`/users/${am.id}`, { name: 'Lojain A.' })).status).toBe(200);
  });

  it('refuses to merge your own account away', async () => {
    const owner = await newTenant(app);
    const me = (await owner.get('/auth/me')).body;
    const other = (await owner.post('/users', { name: 'Other', code: 'OTH', is_active: false })).body;
    expect((await owner.post(`/users/${me.id}/merge-into/${other.id}`)).status).toBe(400);
    expect((await owner.post(`/users/${other.id}/merge-into/${other.id}`)).status).toBe(400);
  });
});
