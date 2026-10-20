import type { Db } from '../db.js';

/** Sign-ins, data exports and password changes, shown to admins under Admin → IT. */
export async function logAccess(db: Db, userId: string, action: 'sign_in' | 'export' | 'password_change' | 'password_reset' | 'password_request' | 'view_document', detail?: string, ip?: string) {
  await db.query(
    `INSERT INTO access_log (tenant_id, user_id, action, detail, ip) VALUES (current_tenant_id(), $1, $2, $3, $4)`,
    [userId, action, detail ?? null, ip ?? null],
  );
}
