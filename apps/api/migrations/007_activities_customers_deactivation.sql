-- Phase 1b of the customer's plan: Marketing role, customer IDs, "deactivate instead
-- of delete", marketing activity types and the sign-in / export log for Admin & IT.

-- ---------------------------------------------------------------------------
-- Marketing role: logs its own activities (campaigns, posts, events) and sees clients.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'sales', 'marketing', 'finance', 'viewer'));

-- Marketing activity types. These may be saved without a client or contract;
-- every other activity must be linked to one (checked by the API).
ALTER TABLE activities DROP CONSTRAINT activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (type IN (
  'meeting', 'call', 'followup', 'site_visit', 'email', 'task',
  'campaign', 'social_post', 'exhibition', 'advertisement', 'content'));

-- ---------------------------------------------------------------------------
-- Customer ID: C-00001, C-00002 … one series per company for people and companies.
-- ---------------------------------------------------------------------------
CREATE TABLE customer_counters (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_value int NOT NULL DEFAULT 0
);
ALTER TABLE customer_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_counters
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE contacts ADD COLUMN customer_no text;
ALTER TABLE accounts ADD COLUMN customer_no text;

-- Number existing clients in the order they were created.
WITH ordered AS (
  SELECT tenant_id, id, 'contacts' AS tbl, created_at FROM contacts
  UNION ALL SELECT tenant_id, id, 'accounts', created_at FROM accounts
), numbered AS (
  SELECT *, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS n FROM ordered
), c AS (
  UPDATE contacts x SET customer_no = 'C-' || lpad(n::text, 5, '0') FROM numbered
  WHERE numbered.tbl = 'contacts' AND numbered.id = x.id RETURNING x.tenant_id
), a AS (
  UPDATE accounts x SET customer_no = 'C-' || lpad(n::text, 5, '0') FROM numbered
  WHERE numbered.tbl = 'accounts' AND numbered.id = x.id RETURNING x.tenant_id
)
INSERT INTO customer_counters (tenant_id, last_value)
SELECT tenant_id, max(n) FROM numbered GROUP BY tenant_id;

CREATE FUNCTION assign_customer_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NEW.customer_no IS NULL THEN
    INSERT INTO customer_counters (tenant_id, last_value) VALUES (NEW.tenant_id, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_value = customer_counters.last_value + 1
    RETURNING last_value INTO n;
    NEW.customer_no := 'C-' || lpad(n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_customer_no BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION assign_customer_no();
CREATE TRIGGER accounts_customer_no BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION assign_customer_no();
CREATE UNIQUE INDEX contacts_customer_no_idx ON contacts (tenant_id, customer_no);
CREATE UNIQUE INDEX accounts_customer_no_idx ON accounts (tenant_id, customer_no);

-- ---------------------------------------------------------------------------
-- Deactivate instead of delete: a record entered by mistake is hidden from every
-- screen, list, report and export, but kept with who deactivated it, when and why.
-- The database filters it out unless a request explicitly asks for deactivated
-- records (Admin → Deactivated records, restore, permanent delete).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings', 'contacts', 'accounts', 'activities'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN deactivated_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN deactivated_by uuid REFERENCES users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN deactivate_reason text', t);
    EXECUTE format(
      $p$CREATE POLICY hide_deactivated ON %I AS RESTRICTIVE FOR SELECT
         USING (deactivated_at IS NULL OR current_setting('app.show_deactivated', true) = 'on')$p$, t);
    EXECUTE format('COMMENT ON COLUMN %I.deactivated_at IS %L', t,
      'Set when the record was deactivated (entered by mistake). Deactivated records are hidden everywhere except Admin → Deactivated records.');
    EXECUTE format('COMMENT ON COLUMN %I.deactivate_reason IS %L', t, 'Why it was deactivated (required).');
    EXECUTE format('COMMENT ON COLUMN %I.deactivated_by IS %L', t, 'Who deactivated it.');
  END LOOP;
END $$;

-- The clash check and the diary read across the whole company (SECURITY DEFINER, so
-- row-level security does not apply): leave deactivated contracts out explicitly.
CREATE OR REPLACE FUNCTION booking_conflicts(p_booking uuid, p_space uuid, p_start timestamptz, p_end timestamptz, p_statuses text[])
RETURNS TABLE (event_id uuid, event_name text, booking_id uuid, booking_no text, booking_name text, status text,
               space_name text, start_at timestamptz, end_at timestamptz, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT p_space AS function_space_id, p_start AS start_at, p_end AS end_at WHERE p_space IS NOT NULL
    UNION ALL
    SELECT e.function_space_id, e.start_at, e.end_at FROM booking_events e
    WHERE p_space IS NULL AND e.booking_id = p_booking AND e.function_space_id IS NOT NULL
      AND e.tenant_id = current_tenant_id()
  )
  SELECT DISTINCT e.id, e.name, b.id, b.booking_no, b.name, b.status, s.name, e.start_at, e.end_at,
         app_can_see(b.owner_id, b.created_by)
  FROM mine m
  JOIN function_spaces s ON s.id = m.function_space_id AND NOT s.allow_overlap AND s.tenant_id = current_tenant_id()
  JOIN booking_events e ON e.function_space_id = m.function_space_id
                       AND tstzrange(e.start_at, e.end_at) && tstzrange(m.start_at, m.end_at)
  JOIN bookings b ON b.id = e.booking_id
  WHERE b.tenant_id = current_tenant_id() AND b.id <> p_booking AND b.status = ANY (p_statuses)
    AND b.deactivated_at IS NULL
  ORDER BY e.start_at
$$;

CREATE OR REPLACE FUNCTION diary_events(p_from date, p_to date, p_include_lost boolean, p_venue uuid)
RETURNS TABLE (id uuid, name text, function_space_id uuid, start_at timestamptz, end_at timestamptz, expected_pax int,
               setup_style text, booking_id uuid, booking_no text, booking_name text, status text, owner_code text,
               overlaps boolean, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT (p_from::timestamp AT TIME ZONE t.timezone) AS lo, ((p_to + 1)::timestamp AT TIME ZONE t.timezone) AS hi
    FROM tenants t WHERE t.id = current_tenant_id()
  )
  SELECT e.id, e.name, e.function_space_id, e.start_at, e.end_at, e.expected_pax, e.setup_style,
         b.id, b.booking_no, b.name, b.status, u.code,
         EXISTS (
           SELECT 1 FROM booking_events o
           JOIN bookings ob ON ob.id = o.booking_id
           JOIN function_spaces os ON os.id = o.function_space_id AND NOT os.allow_overlap
           WHERE o.function_space_id = e.function_space_id AND o.id <> e.id AND ob.id <> b.id
             AND ob.status IN ('TEN', 'DEF', 'ACT') AND ob.tenant_id = current_tenant_id()
             AND ob.deactivated_at IS NULL
             AND tstzrange(o.start_at, o.end_at) && tstzrange(e.start_at, e.end_at)
         ),
         app_can_see(b.owner_id, b.created_by)
  FROM booking_events e
  JOIN bookings b ON b.id = e.booking_id
  JOIN function_spaces s ON s.id = e.function_space_id
  LEFT JOIN users u ON u.id = b.owner_id
  CROSS JOIN win
  WHERE e.tenant_id = current_tenant_id()
    AND tstzrange(e.start_at, e.end_at) && tstzrange(win.lo, win.hi)
    AND (p_include_lost OR b.status NOT IN ('LOS', 'CXL'))
    AND (p_venue IS NULL OR s.venue_id = p_venue)
    AND b.deactivated_at IS NULL
  ORDER BY e.start_at
$$;

-- ---------------------------------------------------------------------------
-- Admin & IT: sign-in and export log.
-- ---------------------------------------------------------------------------
CREATE TABLE access_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  detail     text,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_idx ON access_log (tenant_id, created_at DESC);
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON access_log
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE access_log IS 'Sign-ins and data exports per workspace, shown under Admin → IT.';
COMMENT ON TABLE customer_counters IS 'Last customer number used per workspace (C-00001 …), shared by people and companies.';
COMMENT ON COLUMN contacts.customer_no IS 'Customer ID shown to users (C-00001), assigned automatically.';
COMMENT ON COLUMN accounts.customer_no IS 'Customer ID shown to users (C-00001), assigned automatically.';
COMMENT ON FUNCTION assign_customer_no() IS 'Trigger: gives a new client or company the next customer number of its workspace.';

-- Marketing, like sales, does not see the finance figures unless an admin allows it.
ALTER TABLE tenants ALTER COLUMN field_visibility SET DEFAULT '{"sales": ["finance"], "marketing": ["finance"], "viewer": ["finance"]}';
UPDATE tenants SET field_visibility = field_visibility || '{"marketing": ["finance"]}' WHERE NOT field_visibility ? 'marketing';

-- Admin → IT shows the database schema version; the app login cannot read schema_migrations itself.
CREATE FUNCTION app_schema_version() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT max(name) FROM schema_migrations $$;
COMMENT ON FUNCTION app_schema_version() IS 'Latest applied migration, for Admin → IT (SECURITY DEFINER).';
