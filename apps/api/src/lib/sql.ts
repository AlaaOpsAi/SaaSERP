import type { Db } from '../db.js';
import { notFound } from './errors.js';

type Row = Record<string, unknown>;

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

/** Keys come from zod-validated objects, so they are always known columns. */
function entries(data: Row): [string, unknown][] {
  return Object.entries(data).filter(([, v]) => v !== undefined);
}

export async function insertRow<T = Row>(db: Db, table: string, data: Row): Promise<T> {
  const cols = entries(data);
  const sql = `INSERT INTO ${ident(table)} (tenant_id, ${cols.map(([k]) => ident(k)).join(', ')})
               VALUES (current_tenant_id(), ${cols.map((_, i) => `$${i + 1}`).join(', ')})
               RETURNING *`;
  const { rows } = await db.query(sql, cols.map(([, v]) => v));
  return rows[0] as T;
}

export async function updateRow<T = Row>(
  db: Db,
  table: string,
  id: string,
  data: Row,
  what = 'Record',
  extraWhere = '',
  extraParams: unknown[] = [],
): Promise<T> {
  const cols = entries(data);
  if (cols.length === 0) {
    const { rows } = await db.query(
      `SELECT * FROM ${ident(table)} WHERE id = $1 ${extraWhere.replaceAll('$X', '$2')}`,
      [id, ...extraParams],
    );
    if (!rows[0]) throw notFound(what);
    return rows[0] as T;
  }
  const n = cols.length;
  const sql = `UPDATE ${ident(table)} SET ${cols.map(([k], i) => `${ident(k)} = $${i + 1}`).join(', ')}
               WHERE id = $${n + 1} ${extraWhere.replaceAll('$X', `$${n + 2}`)} RETURNING *`;
  const { rows } = await db.query(sql, [...cols.map(([, v]) => v), id, ...extraParams]);
  if (!rows[0]) throw notFound(what);
  return rows[0] as T;
}

export async function deleteRow(db: Db, table: string, id: string, what = 'Record', extraWhere = '', extraParams: unknown[] = []) {
  const { rowCount } = await db.query(
    `DELETE FROM ${ident(table)} WHERE id = $1 ${extraWhere.replaceAll('$X', '$2')}`,
    [id, ...extraParams],
  );
  if (!rowCount) throw notFound(what);
}

export async function getRow<T = Row>(db: Db, table: string, id: string, what = 'Record'): Promise<T> {
  const { rows } = await db.query(`SELECT * FROM ${ident(table)} WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound(what);
  return rows[0] as T;
}
