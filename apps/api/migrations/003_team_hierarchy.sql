-- Reporting hierarchy and team-scoped visibility.
--
-- users.manager_id builds a tree of any depth (Director > Manager > Team lead > Account manager).
-- users.data_scope = 'all'  -> sees the whole workspace
--                    'team' -> sees records owned by themselves or anyone below them
-- Owners and admins always see everything.
--
-- The API sets, per transaction:
--   app.see_all  = 'on' | 'off'
--   app.user_id  = the signed-in user
--   app.team_ids = comma-separated ids of the user and everyone below them
-- RESTRICTIVE policies combine with the tenant policies, so both must pass.

ALTER TABLE users
  ADD COLUMN manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN data_scope text NOT NULL DEFAULT 'all' CHECK (data_scope IN ('all', 'team')),
  ADD CONSTRAINT users_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id);
CREATE INDEX users_manager_idx ON users (tenant_id, manager_id);
-- Existing users keep seeing everything; new users get a default from their role (set by the API).

CREATE FUNCTION app_sees_all() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.see_all', true), 'off') = 'on'
$$;

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_team_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.team_ids', true), ''), ',')::uuid[], '{}')
$$;

/** Can the signed-in user see a record owned by p_owner (and created by p_created_by)? */
CREATE FUNCTION app_can_see(p_owner uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_sees_all()
      OR p_owner = ANY (app_team_ids())
      OR (p_created_by IS NOT NULL AND p_created_by = app_user_id())
$$;

CREATE POLICY team_visibility ON bookings AS RESTRICTIVE
  USING (app_can_see(owner_id, created_by))
  WITH CHECK (app_can_see(owner_id, created_by));

-- Everything inside a booking follows the booking (the sub-select is itself filtered).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_events', 'booking_items', 'payments', 'booking_payouts', 'booking_status_history'] LOOP
    EXECUTE format(
      'CREATE POLICY team_visibility ON %I AS RESTRICTIVE
         USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id))
         WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id))', t);
  END LOOP;
END $$;

CREATE POLICY team_visibility ON activities AS RESTRICTIVE
  USING (CASE WHEN booking_id IS NOT NULL THEN EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)
              ELSE app_can_see(owner_id, NULL) END)
  WITH CHECK (CASE WHEN booking_id IS NOT NULL THEN EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)
                   ELSE app_can_see(owner_id, NULL) END);

-- Space clashes must be checked against the whole workspace, including bookings the
-- user cannot see. SECURITY DEFINER bypasses RLS, so the tenant is filtered explicitly
-- and the caller learns only whether each clash is visible to them.
CREATE FUNCTION booking_conflicts(p_booking uuid, p_space uuid, p_start timestamptz, p_end timestamptz, p_statuses text[])
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
  ORDER BY e.start_at
$$;

-- The function diary shows every occupied space; the API hides details of the ones
-- the user cannot see.
CREATE FUNCTION diary_events(p_from date, p_to date, p_include_lost boolean, p_venue uuid)
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
  ORDER BY e.start_at
$$;
