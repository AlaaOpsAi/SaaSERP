-- Delegation (covering for a colleague), an audit trail of who changed what on whose
-- behalf, and in-app notifications.

CREATE TABLE delegations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delegator_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- whose records
  delegate_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- who covers
  starts_on            date NOT NULL,
  ends_on              date,                                                   -- NULL = until revoked
  access               text NOT NULL DEFAULT 'act' CHECK (access IN ('view', 'act')),
  include_team         boolean NOT NULL DEFAULT false,  -- also everyone below the delegator
  handover_activities  boolean NOT NULL DEFAULT false,  -- delegator's open follow-ups show in the delegate's list
  note                 text,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz,
  revoked_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (delegator_id <> delegate_id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX delegations_delegate_idx ON delegations (tenant_id, delegate_id) WHERE revoked_at IS NULL;

-- Who did what on a booking, and for whom when acting as a delegate.
CREATE TABLE booking_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  on_behalf_of  uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_log_booking_idx ON booking_log (booking_id, created_at);

ALTER TABLE booking_status_history ADD COLUMN on_behalf_of uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE activities
  ADD COLUMN completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN completed_on_behalf_of uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        text NOT NULL,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delegations', 'booking_log', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Read vs write visibility.
-- app.team_ids  = what the user may READ  (own team + everything delegated to them)
-- app.write_ids = what the user may CHANGE (own team + "view & act" delegations)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_write_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.write_ids', true), ''), ',')::uuid[], '{}')
$$;

CREATE FUNCTION app_can_write(p_owner uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_sees_all()
      OR p_owner = ANY (app_write_ids())
      OR (p_created_by IS NOT NULL AND p_created_by = app_user_id())
$$;

-- Replace the single FOR ALL policies with read (SELECT) and write policies.
DROP POLICY team_visibility ON bookings;
CREATE POLICY team_read ON bookings AS RESTRICTIVE FOR SELECT USING (app_can_see(owner_id, created_by));
CREATE POLICY team_insert ON bookings AS RESTRICTIVE FOR INSERT WITH CHECK (app_can_write(owner_id, created_by));
CREATE POLICY team_update ON bookings AS RESTRICTIVE FOR UPDATE
  USING (app_can_write(owner_id, created_by)) WITH CHECK (app_can_write(owner_id, created_by));
CREATE POLICY team_delete ON bookings AS RESTRICTIVE FOR DELETE USING (app_can_write(owner_id, created_by));

CREATE FUNCTION app_booking_writable(p_booking uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM bookings b WHERE b.id = p_booking AND app_can_write(b.owner_id, b.created_by))
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_events', 'booking_items', 'payments', 'booking_payouts', 'booking_status_history', 'booking_log'] LOOP
    IF t <> 'booking_log' THEN
      EXECUTE format('DROP POLICY team_visibility ON %I', t);
    END IF;
    EXECUTE format('CREATE POLICY team_read ON %I AS RESTRICTIVE FOR SELECT
                      USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id))', t);
    EXECUTE format('CREATE POLICY team_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_booking_writable(booking_id))', t);
    EXECUTE format('CREATE POLICY team_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_booking_writable(booking_id)) WITH CHECK (app_booking_writable(booking_id))', t);
    EXECUTE format('CREATE POLICY team_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_booking_writable(booking_id))', t);
  END LOOP;
END $$;

DROP POLICY team_visibility ON activities;
CREATE POLICY team_read ON activities AS RESTRICTIVE FOR SELECT
  USING (CASE WHEN booking_id IS NOT NULL THEN EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)
              ELSE app_can_see(owner_id, NULL) END);
CREATE POLICY team_insert ON activities AS RESTRICTIVE FOR INSERT
  WITH CHECK (CASE WHEN booking_id IS NOT NULL THEN app_booking_writable(booking_id) ELSE app_can_write(owner_id, NULL) END);
CREATE POLICY team_update ON activities AS RESTRICTIVE FOR UPDATE
  USING (CASE WHEN booking_id IS NOT NULL THEN app_booking_writable(booking_id) ELSE app_can_write(owner_id, NULL) END)
  WITH CHECK (CASE WHEN booking_id IS NOT NULL THEN app_booking_writable(booking_id) ELSE app_can_write(owner_id, NULL) END);
CREATE POLICY team_delete ON activities AS RESTRICTIVE FOR DELETE
  USING (CASE WHEN booking_id IS NOT NULL THEN app_booking_writable(booking_id) ELSE app_can_write(owner_id, NULL) END);
