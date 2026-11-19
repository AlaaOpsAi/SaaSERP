-- Every notification says which module it comes from (customer comment 10):
-- CON contracts, HR, ADM admin & IT, FIN finance, SYS workspace / subscription.
ALTER TABLE notifications ADD COLUMN module text NOT NULL DEFAULT 'ADM'
  CHECK (module IN ('CON', 'HR', 'ADM', 'FIN', 'SYS'));
UPDATE notifications SET module = CASE
  WHEN link LIKE '/hr%' THEN 'HR'
  WHEN link LIKE '/bookings%' OR link LIKE '/clients%' OR link LIKE '/activities%' OR link LIKE '/delegations%' OR link LIKE '/diary%' THEN 'CON'
  WHEN link LIKE '/settings?tab=modules%' THEN 'SYS'
  ELSE 'ADM' END;
COMMENT ON COLUMN notifications.module IS 'Module the notification comes from: CON, HR, ADM, FIN, SYS (shown as a tag before the text).';
