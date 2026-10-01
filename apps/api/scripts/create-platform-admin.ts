/**
 * Create (or reset the password of) a platform operator who approves workspaces.
 * Usage: npm run platform:admin -w apps/api -- <email> <password> "<name>"
 * Docker: docker compose exec app node apps/api/dist/scripts/create-platform-admin.js <email> <password> "<name>"
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';
import { hashPassword } from '../src/lib/password.js';

export async function createPlatformAdmin(email: string, password: string, name: string, url = config.migrationDatabaseUrl) {
  if (password.length < 10) throw new Error('Use a password of at least 10 characters');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_admins (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
      [email.toLowerCase(), name, await hashPassword(password)],
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [email, password, name = 'Platform admin'] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: create-platform-admin <email> <password> [name]');
    process.exit(1);
  }
  createPlatformAdmin(email, password, name).then(
    () => console.log(`Platform admin ${email} is ready. Sign in at /platform`),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
