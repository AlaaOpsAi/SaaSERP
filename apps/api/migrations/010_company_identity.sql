-- Company identity and the user's name card (customer comment 6):
--  * each user belongs to one company (business unit) and has a job title
--  * each company has its logo (a version for the light theme and one for the dark theme)
--    and an accent colour; the group (the workspace itself, e.g. CONF-X GROUP) has its
--    own logo, shown to users without a company (owners, admins)
--  * employee ID: E + year of hiring + 3 digits (E2021001); existing IDs are shortened
--  * sign in with the employee ID as well as the email

-- ---- user: company and job title -------------------------------------------------
ALTER TABLE users
  ADD COLUMN job_title text,
  ADD COLUMN business_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL;
COMMENT ON COLUMN users.job_title IS 'Shown under the name in the menu: "OWNER - E2021001".';
COMMENT ON COLUMN users.business_unit_id IS 'The company the employee works for; sets their logo and accent colour. Empty = the group.';

-- ---- logos and colours ----------------------------------------------------------
-- Logos are small images kept as data URLs (PNG, JPEG, WebP or SVG, at most 300 kB).
ALTER TABLE business_units
  ADD COLUMN logo_light text,
  ADD COLUMN logo_dark text,
  ADD COLUMN accent text CHECK (accent ~ '^#[0-9a-fA-F]{6}$');
COMMENT ON COLUMN business_units.logo_light IS 'Logo shown on the light theme (the black version), as a data URL.';
COMMENT ON COLUMN business_units.logo_dark IS 'Logo shown on the dark theme (the white version), as a data URL.';
COMMENT ON COLUMN business_units.accent IS 'Company colour for highlights (selected menu item, buttons, links), e.g. magenta for WED-X.';

ALTER TABLE tenants
  ADD COLUMN logo_light text,
  ADD COLUMN logo_dark text;
COMMENT ON COLUMN tenants.logo_light IS 'Group logo for the light theme (users without a company), as a data URL.';
COMMENT ON COLUMN tenants.logo_dark IS 'Group logo for the dark theme, as a data URL.';

-- ---- employee ID: 3 digits --------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_employee_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int; n int;
BEGIN
  IF NEW.employee_no IS NULL THEN
    y := extract(year FROM coalesce(NEW.hired_on, NEW.created_at::date, current_date))::int;
    INSERT INTO employee_counters (tenant_id, year, last_value) VALUES (NEW.tenant_id, y, 1)
    ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = employee_counters.last_value + 1
    RETURNING last_value INTO n;
    NEW.employee_no := 'E' || y || lpad(n::text, 3, '0');
  END IF;
  RETURN NEW;
END $$;

-- E20250001 -> E2025001 (serials stay the same; none reaches 1000).
UPDATE users SET employee_no = 'E' || substr(employee_no, 2, 4) || lpad(ltrim(substr(employee_no, 6), '0'), 3, '0')
WHERE employee_no ~ '^E\d{4}\d{4}$' AND substr(employee_no, 6)::int < 1000;
COMMENT ON COLUMN users.employee_no IS 'Employee ID: E + year of hiring + 3-digit serial of that year (E2025001). Automatic. Also a sign-in name.';

-- ---- sign in with the employee ID -------------------------------------------------
CREATE FUNCTION auth_find_users_by_employee_no(p_employee_no text)
RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_slug citext, tenant_name text,
               password_hash text, is_active boolean, tenant_status text, status_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, t.id, t.slug, t.name, u.password_hash, u.is_active, t.status, t.status_reason
  FROM users u JOIN tenants t ON t.id = u.tenant_id
  WHERE upper(u.employee_no) = upper(p_employee_no) AND u.email IS NOT NULL
$$;
