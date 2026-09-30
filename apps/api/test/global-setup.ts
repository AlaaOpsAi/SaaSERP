import pg from 'pg';

/** Rebuild the test database schema from the migrations before the run. */
export default async function setup() {
  const url =
    process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://saaserp_owner:saaserp_owner@localhost:5432/saaserp_test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { migrate } = await import('../scripts/migrate.js');
  await migrate(url, process.env.APP_DB_ROLE ?? 'saaserp_app');
}
