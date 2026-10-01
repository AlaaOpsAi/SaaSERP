import pg from 'pg';
import { config } from './config.js';

// NUMERIC -> JS number (amounts are stored with 3 decimals, well within double precision).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// DATE -> 'YYYY-MM-DD' string, never shifted by the server time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.PoolClient;

/**
 * Run `fn` inside a transaction scoped to one tenant. Row-level security
 * policies read app.tenant_id, so every query in `fn` only sees that
 * tenant's rows even if a WHERE clause is forgotten.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    // Server-side work (login, sign-up, imports, scripts) sees the whole tenant;
    // requests made by a user narrow this to their team in auth.tx().
    await client.query("SELECT set_config('app.see_all', 'on', true)");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction with no tenant context: only SECURITY DEFINER functions see data. */
export async function withoutTenant<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
