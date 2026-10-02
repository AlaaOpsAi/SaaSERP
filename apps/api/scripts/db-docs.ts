/**
 * Generates docs/DATABASE.md from the live database catalog: ERD diagrams
 * (Mermaid), every table with columns, keys, indexes, checks, row-level
 * security policies and triggers, every view and function, all with the
 * descriptions stored as COMMENTs (see migrations/005).
 *
 * Usage: npm run docs:db -w apps/api      (needs a migrated database)
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'DATABASE.md');

/** Diagram groups, so each ERD stays readable. */
const GROUPS: [title: string, tables: string[]][] = [
  ['Workspace, people and access', ['tenants', 'users', 'delegations', 'notifications', 'platform_admins']],
  ['Configuration and clients', ['tenants', 'business_units', 'booking_sequences', 'lookups', 'venues', 'function_spaces', 'accounts', 'contacts', 'users']],
  ['Sales: bookings and everything inside them', ['bookings', 'booking_events', 'booking_items', 'payments', 'booking_payouts', 'activities',
    'booking_status_history', 'booking_log', 'contacts', 'accounts', 'venues', 'function_spaces', 'business_units', 'users']],
];

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function main() {
  const db = new pg.Client({ connectionString: config.migrationDatabaseUrl });
  await db.connect();
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

  const tables = await q<{ name: string; comment: string | null; rls: boolean; rows: number }>(`
    SELECT c.relname AS name, obj_description(c.oid) AS comment, c.relrowsecurity AS rls, c.reltuples::bigint AS rows
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY c.relname`);
  const columns = await q<{ table: string; name: string; type: string; nullable: boolean; def: string | null; comment: string | null; pos: number }>(`
    SELECT c.relname AS table, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
           pg_get_expr(d.adbin, d.adrelid) AS def, col_description(c.oid, a.attnum) AS comment, a.attnum AS pos
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`);
  const constraints = await q<{ table: string; name: string; type: string; def: string; cols: string[]; ref_table: string | null }>(`
    SELECT c.relname AS table, k.conname AS name, k.contype AS type, pg_get_constraintdef(k.oid) AS def,
           ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid = k.conrelid AND attnum = ANY (k.conkey)) AS cols,
           r.relname AS ref_table
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid LEFT JOIN pg_class r ON r.oid = k.confrelid
    WHERE c.relnamespace = 'public'::regnamespace ORDER BY c.relname, k.contype, k.conname`);
  const indexes = await q<{ table: string; name: string; def: string }>(`
    SELECT tablename AS table, indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public'
      AND indexname NOT IN (SELECT conname FROM pg_constraint) ORDER BY tablename, indexname`);
  const policies = await q<{ table: string; name: string; permissive: string; cmd: string; qual: string | null; check: string | null }>(`
    SELECT tablename AS table, policyname AS name, permissive, cmd, qual, with_check AS check
    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`);
  const triggers = await q<{ table: string; name: string; def: string }>(`
    SELECT c.relname AS table, t.tgname AS name, pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname`);
  const views = await q<{ name: string; comment: string | null; def: string; invoker: boolean }>(`
    SELECT c.relname AS name, obj_description(c.oid) AS comment, pg_get_viewdef(c.oid, true) AS def,
           coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' ORDER BY c.relname`);
  const functions = await q<{ name: string; args: string; returns: string; lang: string; definer: boolean; volatility: string; comment: string | null; src: string }>(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS returns,
           l.lanname AS lang, p.prosecdef AS definer,
           CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile' END AS volatility,
           obj_description(p.oid) AS comment, p.prosrc AS src
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY p.proname`);
  const migrations = await q<{ name: string; applied_at: Date }>('SELECT name, applied_at FROM schema_migrations ORDER BY name');
  await db.end();

  const colsOf = (t: string) => columns.filter((c) => c.table === t);
  /** Stored description, or a standard one for common columns. */
  const describe = (t: string, c: { name: string; comment: string | null }) => {
    if (c.comment) return c.comment;
    if (c.name === 'id') return 'Primary key.';
    if (c.name === 'tenant_id') return 'Workspace the row belongs to; row-level security filters on it.';
    if (c.name === 'created_at') return 'When the row was created.';
    if (c.name === 'updated_at') return 'When the row last changed (trigger).';
    const fk = fks.find((k) => k.table === t && k.cols.length === 1 && k.cols[0] === c.name);
    if (fk) return `References \`${fk.ref_table}\`.`;
    return '';
  };
  const fks = constraints.filter((k) => k.type === 'f');
  const pkCols = (t: string) => constraints.find((k) => k.table === t && k.type === 'p')?.cols ?? [];
  const fkCols = (t: string) => new Set(fks.filter((k) => k.table === t).flatMap((k) => k.cols));
  const mType = (t: string) => t.replace(/\(.*\)/, '').replace(/ with(out)? time zone/, '').replace(/[^a-zA-Z0-9_]/g, '_');

  const out: string[] = [];
  const w = (s = '') => out.push(s);

  w('# Database reference');
  w();
  w('> Generated by `npm run docs:db -w apps/api` from the live PostgreSQL catalog. Descriptions come from `COMMENT ON` statements in the migrations, so this file always matches the real schema. **Do not edit by hand**: change the migration and regenerate.');
  w();
  w(`PostgreSQL schema \`public\` · ${tables.length} tables · ${views.length} views · ${functions.length} functions · ${policies.length} row-level-security policies · migrations: ${migrations.map((m) => `\`${m.name}\``).join(', ')}`);
  w();
  w('## Contents');
  w();
  w('1. [How the database is organised](#how-the-database-is-organised)');
  w('2. [Entity-relationship diagrams](#entity-relationship-diagrams)');
  w('3. [Tables](#tables)');
  w('4. [Views](#views)');
  w('5. [Functions](#functions)');
  w('6. [Row-level security policies](#row-level-security-policies)');
  w('7. [Database roles](#database-roles)');
  w();
  w('## How the database is organised');
  w();
  w('- **Multi-tenant, shared schema.** Every business table has `tenant_id`. Row-level security (RLS) only shows rows of the tenant set for the transaction (`app.tenant_id`, read by `current_tenant_id()`).');
  w('- **Team visibility and cover** are extra *restrictive* RLS policies on bookings and everything inside them. They use the signed-in user and their team, set per request (`app.see_all`, `app.user_id`, `app.team_ids` for reading, `app.write_ids` for changing).');
  w('- **Money** is `numeric(14,3)` (KWD has three decimals). Derived figures (margin, net profit, outstanding...) are never stored; the `booking_finance` view computes them.');
  w('- **Audit**: status changes go to `booking_status_history`, and every other booking change to `booking_log`, both with *on behalf of* when someone was covering.');
  w('- **SECURITY DEFINER functions** are the only way to read across tenants or teams: login lookup, the operator console, room-clash checks and the diary.');
  w();

  w('## Entity-relationship diagrams');
  w();
  w('Primary keys are marked `PK`, foreign keys `FK`. Only key columns are drawn; full column lists are in [Tables](#tables).');
  for (const [title, group] of GROUPS) {
    w();
    w(`### ${title}`);
    w();
    w('```mermaid');
    w('erDiagram');
    for (const t of group) {
      const keys = colsOf(t).filter((c) => pkCols(t).includes(c.name) || fkCols(t).has(c.name) || ['name', 'status', 'booking_no', 'code', 'type', 'email', 'slug'].includes(c.name));
      w(`  ${t} {`);
      for (const c of keys) w(`    ${mType(c.type)} ${c.name}${pkCols(t).includes(c.name) ? ' PK' : fkCols(t).has(c.name) ? ' FK' : ''}`);
      w('  }');
    }
    const seen = new Set<string>();
    for (const k of fks) {
      if (!group.includes(k.table) || !k.ref_table || !group.includes(k.ref_table)) continue;
      if (k.cols.includes('tenant_id') && k.ref_table === 'tenants' && title !== 'Workspace, people and access') continue;
      // Keep the sales diagram readable: of the links to users, only draw ownership.
      if (title.startsWith('Sales') && k.ref_table === 'users' && !k.cols.includes('owner_id')) continue;
      const key = `${k.ref_table}-${k.table}-${k.cols.join()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const optional = k.cols.some((c) => colsOf(k.table).find((x) => x.name === c)?.nullable);
      w(`  ${k.ref_table} ||--o{ ${k.table} : "${k.cols.join(', ')}${optional ? ' (optional)' : ''}"`);
    }
    w('```');
  }
  w();

  w('## Tables');
  w();
  w('| Table | Purpose | RLS |');
  w('|---|---|---|');
  for (const t of tables) w(`| [\`${t.name}\`](#table-${t.name}) | ${esc(t.comment)} | ${t.rls ? 'yes' : '—'} |`);
  for (const t of tables) {
    w();
    w(`### Table: ${t.name}`);
    w();
    w(t.comment ?? '');
    w();
    w('| Column | Type | Null | Default | Description |');
    w('|---|---|---|---|---|');
    for (const c of colsOf(t.name)) {
      const tag = pkCols(t.name).includes(c.name) ? ' 🔑' : fkCols(t.name).has(c.name) ? ' 🔗' : '';
      w(`| \`${c.name}\`${tag} | ${esc(c.type)} | ${c.nullable ? 'yes' : ''} | ${c.def ? `\`${esc(c.def)}\`` : ''} | ${esc(describe(t.name, c))} |`);
    }
    const tk = constraints.filter((k) => k.table === t.name);
    const tf = tk.filter((k) => k.type === 'f');
    if (tf.length) {
      w();
      w('**References:** ' + tf.map((k) => `\`${k.cols.join(', ')}\` → [\`${k.ref_table}\`](#table-${k.ref_table})${/ON DELETE (\w+( \w+)?)/.exec(k.def)?.[0] ? ` (${/ON DELETE (\w+( \w+)?)/.exec(k.def)![0].toLowerCase()})` : ''}`).join(' · '));
    }
    const refBy = fks.filter((k) => k.ref_table === t.name && k.table !== t.name);
    if (refBy.length) w(`\n**Referenced by:** ${[...new Set(refBy.map((k) => k.table))].map((x) => `\`${x}\``).join(', ')}`);
    const uniq = tk.filter((k) => k.type === 'u');
    if (uniq.length) w(`\n**Unique:** ${uniq.map((k) => `(${k.cols.join(', ')})`).join(', ')}`);
    const checks = tk.filter((k) => k.type === 'c');
    if (checks.length) {
      w('\n**Rules (checks):**');
      for (const k of checks) w(`- \`${esc(k.def)}\``);
    }
    const ix = indexes.filter((i) => i.table === t.name);
    if (ix.length) w(`\n**Indexes:** ${ix.map((i) => `\`${i.name}\``).join(', ')}`);
    const pol = policies.filter((p) => p.table === t.name);
    if (pol.length) w(`\n**RLS policies:** ${pol.map((p) => `\`${p.name}\` (${p.cmd.toLowerCase()}, ${p.permissive.toLowerCase()})`).join(', ')}`);
    const trg = triggers.filter((x) => x.table === t.name);
    if (trg.length) w(`\n**Triggers:** ${trg.map((x) => `\`${x.name}\``).join(', ')}`);
  }
  w();

  w('## Views');
  for (const v of views) {
    w();
    w(`### View: ${v.name}`);
    w();
    w(`${v.comment ?? ''}${v.invoker ? ' Runs with the caller\'s rights (`security_invoker`).' : ''}`);
    w();
    w('| Column | Type | Description |');
    w('|---|---|---|');
    for (const c of colsOf(v.name)) w(`| \`${c.name}\` | ${esc(c.type)} | ${esc(c.comment)} |`);
    w();
    w('<details><summary>Definition</summary>');
    w();
    w('```sql');
    w(v.def.trim());
    w('```');
    w('</details>');
  }
  w();

  w('## Functions');
  w();
  w('| Function | Returns | Kind | Purpose |');
  w('|---|---|---|---|');
  for (const f of functions) {
    w(`| \`${f.name}(${esc(f.args)})\` | ${esc(f.returns)} | ${f.lang}, ${f.volatility}${f.definer ? ', **security definer**' : ''} | ${esc(f.comment)} |`);
  }
  for (const f of functions) {
    w();
    w(`<details><summary><code>${f.name}</code> source</summary>`);
    w();
    w(`\`\`\`${f.lang === 'plpgsql' ? 'sql' : 'sql'}`);
    w(f.src.trim());
    w('```');
    w('</details>');
  }
  w();

  w('## Row-level security policies');
  w();
  w('Permissive `tenant_isolation` policies keep tenants apart. **Restrictive** `team_*` policies are added on top for team visibility and cover; both must pass.');
  w();
  w('| Table | Policy | Applies to | Type | Rule |');
  w('|---|---|---|---|---|');
  for (const p of policies) w(`| \`${p.table}\` | \`${p.name}\` | ${p.cmd} | ${p.permissive.toLowerCase()} | \`${esc(p.qual ?? p.check)}\` |`);
  w();

  w('## Database roles');
  w();
  w('| Role | Used by | Rights |');
  w('|---|---|---|');
  w('| `saaserp_owner` | migrations, backups, docs generator, admin tools | owns all tables; not subject to RLS (sees every tenant) |');
  w('| `saaserp_app` | the API at runtime | read/write on tables, **always subject to RLS** (one tenant, one team at a time); no access to `schema_migrations` |');
  w('| `postgres` | database server superuser | everything; use only for maintenance |');
  w();
  w('See [OPERATIONS.md](OPERATIONS.md) for connecting and backups.');
  w();

  await writeFile(OUT, out.join('\n'));
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
