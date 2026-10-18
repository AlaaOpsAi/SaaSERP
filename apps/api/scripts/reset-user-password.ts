/**
 * Set a new password for a workspace user, from the server: the safety net when nobody who
 * could do it under Admin & IT → Team can sign in (e.g. the only owner forgot their password).
 *
 * Usage:  npm run user:password -w apps/api -- <workspace id> <email or employee ID> <new password>
 * Docker: docker compose exec app node apps/api/dist/scripts/reset-user-password.js <workspace> <login> <password>
 *
 * The change is recorded in the workspace's access log (Admin → IT) as a password reset.
 */
import { fileURLToPath } from 'node:url';
import { pool, withTenant, withoutTenant } from '../src/db.js';
import { logAccess } from '../src/lib/access.js';
import { hashPassword } from '../src/lib/password.js';

const EMPLOYEE_NO = /^E\d{7,8}$/i;

export async function resetUserPassword(workspace: string, login: string, password: string) {
  if (password.length < 8) throw new Error('Use a password of at least 8 characters');
  const matches = await withoutTenant(async (db) => {
    const { rows } = EMPLOYEE_NO.test(login)
      ? await db.query('SELECT * FROM auth_find_users_by_employee_no($1)', [login.toUpperCase()])
      : await db.query('SELECT * FROM auth_find_users($1)', [login.toLowerCase()]);
    return rows as { user_id: string; tenant_id: string; tenant_slug: string; is_active: boolean }[];
  });
  const user = matches.find((m) => m.tenant_slug === workspace.toLowerCase());
  if (!user) throw new Error(`No user "${login}" with a login in workspace "${workspace}"`);
  if (!user.is_active) throw new Error(`"${login}" is deactivated; reactivate them first (Admin & IT → Team)`);
  await withTenant(user.tenant_id, async (db) => {
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.user_id, await hashPassword(password)]);
    await logAccess(db, user.user_id, 'password_reset', 'server command');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [workspace, login, password] = process.argv.slice(2);
  if (!workspace || !login || !password) {
    console.error('Usage: reset-user-password <workspace id> <email or employee ID> <new password>');
    process.exit(1);
  }
  resetUserPassword(workspace, login, password).then(
    async () => {
      console.log(`New password set for ${login} in workspace ${workspace}. They can sign in now.`);
      await pool.end();
    },
    async (err) => {
      console.error(err.message);
      await pool.end();
      process.exit(1);
    },
  );
}
