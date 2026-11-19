import type { Db } from '../db.js';

/** The module a notification comes from, shown as a tag before its text (customer comment 10). */
export type NoticeModule = 'CON' | 'HR' | 'ADM' | 'FIN' | 'SYS';

/** Module from the page the notification links to, when the caller doesn't say. */
function moduleOf(link?: string): NoticeModule {
  if (!link) return 'ADM';
  if (link.startsWith('/hr')) return 'HR';
  if (link.startsWith('/settings?tab=modules')) return 'SYS';
  if (/^\/(bookings|clients|activities|delegations|diary|dashboard)/.test(link)) return 'CON';
  return 'ADM';
}

/** In-app notification (the bell). Silently skips missing users. */
export async function notify(db: Db, userId: string | null | undefined, text: string, link?: string, module?: NoticeModule) {
  if (!userId) return;
  await db.query(
    `INSERT INTO notifications (tenant_id, user_id, text, link, module)
     SELECT current_tenant_id(), id, $2, $3, $4 FROM users WHERE id = $1`,
    [userId, text, link ?? null, module ?? moduleOf(link)],
  );
}
