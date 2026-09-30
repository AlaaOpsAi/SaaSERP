/**
 * Import a daily-report workbook into an existing workspace.
 * Usage: npm run import:xlsx -- <workspace-slug> <path/to/file.xlsx>
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { config } from '../src/config.js';
import { pool, withTenant } from '../src/db.js';
import { importWorkbook } from '../src/lib/importer.js';

const [slug, file] = process.argv.slice(2);
if (!slug || !file) {
  console.error('Usage: npm run import:xlsx -- <workspace-slug> <file.xlsx>');
  process.exit(1);
}

// Resolve the tenant id with the owner connection (tenants are RLS-protected).
const owner = new pg.Client({ connectionString: config.migrationDatabaseUrl });
await owner.connect();
const { rows } = await owner.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
await owner.end();
if (!rows[0]) {
  console.error(`No workspace named "${slug}"`);
  process.exit(1);
}

const summary = await withTenant(rows[0].id, async (db) => importWorkbook(db, await readFile(file)));
console.log(JSON.stringify(summary, null, 2));
await pool.end();
