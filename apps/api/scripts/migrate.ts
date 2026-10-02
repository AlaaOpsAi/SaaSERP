/**
 * Applies migrations/*.sql in order as the table-owner role, then grants the
 * runtime role DML rights (it stays subject to row-level security).
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

// scripts/ when run with tsx, dist/scripts/ when compiled.
const here = dirname(fileURLToPath(import.meta.url));
const dir = [join(here, '..', 'migrations'), join(here, '..', '..', 'migrations')].find((d) => existsSync(d))!;

export async function migrate(url = config.migrationDatabaseUrl, appRole = config.appDbRole) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    const role = pg.escapeIdentifier(appRole);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`REVOKE ALL ON schema_migrations FROM ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
    // Optional read-only reporting role (see docs/OPERATIONS.md): SELECT on everything.
    const ro = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'saaserp_readonly'");
    if (ro.rows[0]) {
      await client.query('GRANT USAGE ON SCHEMA public TO saaserp_readonly');
      await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO saaserp_readonly');
      await client.query('REVOKE SELECT ON platform_admins FROM saaserp_readonly');
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(
    () => console.log('migrations up to date'),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
