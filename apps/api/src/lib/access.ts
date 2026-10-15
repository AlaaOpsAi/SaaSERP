import type { Db } from '../db.js';

/** Sign-ins and data exports, shown to admins under Admin → IT. */
export async function logAccess(db: Db, userId: string, action: 'sign_in' | 'export', detail?: string, ip?: string) {
  await db.query(
    `INSERT INTO access_log (tenant_id, user_id, action, detail, ip) VALUES (current_tenant_id(), $1, $2, $3, $4)`,
    [userId, action, detail ?? null, ip ?? null],
  );
}
