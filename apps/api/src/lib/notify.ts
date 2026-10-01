import type { Db } from '../db.js';

/** In-app notification (the bell). Silently skips missing users. */
export async function notify(db: Db, userId: string | null | undefined, text: string, link?: string) {
  if (!userId) return;
  await db.query(
    `INSERT INTO notifications (tenant_id, user_id, text, link)
     SELECT current_tenant_id(), id, $2, $3 FROM users WHERE id = $1`,
    [userId, text, link ?? null],
  );
}
