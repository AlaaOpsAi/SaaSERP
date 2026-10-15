import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, requireRole, tx } from '../auth.js';

/**
 * Admin & IT: what an administrator needs to look after the system — version,
 * database, the last backup, and who signed in or exported data.
 * BACKUP_DIR is where the backup service writes (mounted read-only into the app).
 */
const BACKUP_DIR = process.env.BACKUP_DIR ?? '/app/backups';
const STARTED = new Date();

async function lastBackup() {
  try {
    const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.dump'));
    const stats = await Promise.all(files.map(async (f) => ({ file: f, ...(await stat(join(BACKUP_DIR, f))) })));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const last = stats[0];
    return { configured: true, count: stats.length, last: last ? { file: last.file, at: last.mtime.toISOString(), bytes: last.size } : null };
  } catch {
    return { configured: false, count: 0, last: null };
  }
}

export async function itRoutes(app: FastifyInstance) {
  app.get('/it/status', { preHandler: requireRole(can.admin) }, (req) =>
    tx(req, async (db) => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
      const db_info = (await db.query(
        `SELECT pg_size_pretty(pg_database_size(current_database())) AS size, version() AS server,
                app_schema_version() AS migration`,
      )).rows[0];
      const counts = (await db.query(
        `SELECT (SELECT count(*) FROM users WHERE is_active) AS active_users,
                (SELECT count(*) FROM bookings) AS contracts,
                (SELECT count(*) FROM contacts) AS customers,
                (SELECT count(*) FROM activities) AS activities`,
      )).rows[0];
      const log = (await db.query(
        `SELECT l.created_at, l.action, l.detail, l.ip, u.name AS user_name, u.role
         FROM access_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT $1`, [q.limit],
      )).rows;
      return {
        version: process.env.npm_package_version ?? '0.1.0',
        started_at: STARTED.toISOString(),
        node: process.version,
        database: { ...db_info, server: String(db_info.server).split(' ').slice(0, 2).join(' ') },
        counts,
        backups: await lastBackup(),
        access_log: log,
      };
    }),
  );
}
