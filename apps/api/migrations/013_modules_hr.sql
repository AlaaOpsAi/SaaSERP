-- Modules and the HR module, phase 1 (customer comment 8, employee files).
--  * SaaSERP is sold as modules: Sales & Contracts (always on), HR, later Finance …
--    A workspace requests a module; the platform operator turns it on (tenants.modules).
--  * HR: employee records from the joining form and the employee register, documents with
--    expiry dates, change requests from employees, and expiry alerts to HR and the manager.

ALTER TABLE tenants ADD COLUMN modules text[] NOT NULL DEFAULT '{sales}';
COMMENT ON COLUMN tenants.modules IS 'Modules the workspace subscribes to: sales (always), hr, … Changed only by the platform operator.';

CREATE TABLE module_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  module       text NOT NULL,
  note         text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'declined')),
  decided_at   timestamptz,
  decided_by   citext
);
CREATE UNIQUE INDEX module_requests_open_idx ON module_requests (tenant_id, module) WHERE status = 'pending';
ALTER TABLE module_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON module_requests USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
COMMENT ON TABLE module_requests IS 'A workspace asking for a module subscription; the platform operator grants or declines it.';

-- Operator console: modules and open requests of every workspace, and switching modules.
CREATE FUNCTION platform_tenant_modules()
RETURNS TABLE (id uuid, modules text[], requested text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.modules,
         coalesce((SELECT array_agg(r.module ORDER BY r.requested_at) FROM module_requests r
                   WHERE r.tenant_id = t.id AND r.status = 'pending'), '{}')
  FROM tenants t
$$;

CREATE FUNCTION platform_set_modules(p_id uuid, p_modules text[], p_operator citext)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE result text[];
BEGIN
  UPDATE tenants SET modules = (SELECT array_agg(DISTINCT m ORDER BY m) FROM unnest(p_modules || '{sales}'::text[]) m)
  WHERE id = p_id RETURNING modules INTO result;
  UPDATE module_requests SET status = CASE WHEN module = ANY (result) THEN 'granted' ELSE 'declined' END,
         decided_at = now(), decided_by = p_operator
  WHERE tenant_id = p_id AND status = 'pending';
  RETURN result;
END $$;

-- Workspaces using HR, for the daily expiry check (it then works inside each workspace).
CREATE FUNCTION hr_tenants() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants WHERE status = 'active' AND 'hr' = ANY (modules)
$$;

-- Every workspace gets an HR department.
INSERT INTO departments (tenant_id, name, sort_order)
SELECT t.id, 'HR', 7 FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

CREATE TABLE employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  employee_no         text NOT NULL,
  -- Job
  first_name          text NOT NULL,
  last_name           text,
  initials            text,
  company             text,
  branch              text,
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  position            text,
  manager_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  reports_to_text     text,
  employment_type     text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joining_date        date,
  end_date            date,
  end_reason          text,
  -- Identity & residency
  nationality         text,
  civil_id            text,
  civil_id_expiry     date,
  sponsor             text,
  passport_no         text,
  passport_expiry     date,
  work_permit_expiry  date,
  iqama_transfer_date date,
  iqama_cancel_date   date,
  -- Personal
  gender              text CHECK (gender IN ('F', 'M')),
  birth_date          date,
  birth_place         text,
  marital_status      text,
  religion            text,
  children            int,
  education           text,
  major               text,
  driving_license     text,
  -- Sensitive: HR and owners only
  chronic_illness     text,
  allergies           text,
  criminal_record     text,
  -- Contact
  address_kw          text,
  phone_kw            text,
  email_personal      text,
  address_home        text,
  phone_home          text,
  email_home          text,
  emergency_contacts  jsonb NOT NULL DEFAULT '[]',
  -- Pay: levels 1–3, HR and the employee
  salary              numeric(14,3),
  allowance_extra     numeric(14,3),
  allowance_housing   numeric(14,3),
  allowance_ticket    numeric(14,3),
  allowance_transport numeric(14,3),
  notes               text,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_no)
);
CREATE UNIQUE INDEX employees_user_idx ON employees (tenant_id, user_id) WHERE user_id IS NOT NULL;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER employees_touch BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
COMMENT ON TABLE employees IS 'HR module: one employee record (joining form + employee register). Optional link to a sign-in (users).';

CREATE TABLE employee_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('civil_id', 'passport', 'cv', 'work_permit', 'medical', 'criminal_record', 'iban', 'contract', 'other')),
  number       text,
  expiry_date  date,
  file_name    text NOT NULL,
  mime         text NOT NULL,
  size_bytes   int NOT NULL,
  storage_key  text NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_documents_idx ON employee_documents (tenant_id, employee_id);
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_documents USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
COMMENT ON TABLE employee_documents IS 'HR module: the required documents of an employee (civil ID, passport, CV …), with expiry dates.';

CREATE TABLE employee_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  text         text NOT NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz
);
ALTER TABLE employee_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_requests USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
COMMENT ON TABLE employee_requests IS 'HR module: an employee asking HR to update their record (employees cannot edit it themselves).';

-- Alerts already sent, so each expiry warns once per stage (60 days, 30 days, expired).
CREATE TABLE employee_alerts (
  tenant_id    uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  what         text NOT NULL,
  expiry       date NOT NULL,
  stage        int NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, employee_id, what, expiry, stage)
);
ALTER TABLE employee_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_alerts USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
COMMENT ON TABLE employee_alerts IS 'HR module: expiry alerts already sent (60 / 30 days before, and on expiry).';
