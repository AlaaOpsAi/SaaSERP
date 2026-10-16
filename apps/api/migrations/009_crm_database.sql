-- CRM database (customer workbook DB_CRM_Segm, approved recommendations):
--  * customer ID C + 10 digits (C0000000001), one series for people and companies
--  * the workbook's customer fields on people and companies
--  * one customer, many business relationships (Client, Applicant, Supplier, …)
--  * an applicant profile (education, experience) on a person, in the CRM module
--  * employee ID on users: E + year of hiring + 4 digits (E20250001)
-- The pick-lists (relation, relation_old, segment, industry, title, contact_mode,
-- education) are added per company by the migration runner (lib/crm-lists.ts).

-- ---- customer ID: C + 10 digits ---------------------------------------------
CREATE OR REPLACE FUNCTION assign_customer_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF NEW.customer_no IS NULL THEN
    INSERT INTO customer_counters (tenant_id, last_value) VALUES (NEW.tenant_id, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_value = customer_counters.last_value + 1
    RETURNING last_value INTO n;
    NEW.customer_no := 'C' || lpad(n::text, 10, '0');
  END IF;
  RETURN NEW;
END $$;
UPDATE contacts SET customer_no = 'C' || lpad(substring(customer_no FROM 3), 10, '0') WHERE customer_no ~ '^C-\d+$';
UPDATE accounts SET customer_no = 'C' || lpad(substring(customer_no FROM 3), 10, '0') WHERE customer_no ~ '^C-\d+$';

-- ---- customer fields (people) -------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN title text,
  ADD COLUMN gender text CHECK (gender IN ('M', 'F')),
  ADD COLUMN position text,
  ADD COLUMN mobile2 text,
  ADD COLUMN landline text,
  ADD COLUMN country text,
  ADD COLUMN city text,
  ADD COLUMN zip text,
  ADD COLUMN web text,
  ADD COLUMN civil_id text,
  ADD COLUMN birth_date date,
  ADD COLUMN segment text,
  ADD COLUMN industry text,
  ADD COLUMN newsletter boolean NOT NULL DEFAULT false,
  ADD COLUMN newsletter_at timestamptz,
  ADD COLUMN contact_mode text,
  ADD COLUMN legacy_no text,
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN contacts.civil_id IS 'Civil ID number (رقم البطاقة المدنية); printed in contracts.';
COMMENT ON COLUMN contacts.newsletter IS 'Agreed to newsletters and campaigns (consent); newsletter_at = when.';
COMMENT ON COLUMN contacts.contact_mode IS 'Preferred way to reach them: lookup contact_mode (TEL, WA, EMAIL, MSG, ANY).';
COMMENT ON COLUMN contacts.legacy_no IS 'Customer ID in the earlier CRM workbook (e.g. C000001), kept on import.';

-- ---- customer fields (companies) ----------------------------------------------
ALTER TABLE accounts
  ADD COLUMN mobile2 text,
  ADD COLUMN landline text,
  ADD COLUMN city text,
  ADD COLUMN zip text,
  ADD COLUMN web text,
  ADD COLUMN registration_no text,
  ADD COLUMN license_no text,
  ADD COLUMN tax_id text,
  ADD COLUMN legal_rep text,
  ADD COLUMN parent_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN established_on date,
  ADD COLUMN segment text,
  ADD COLUMN industry text,
  ADD COLUMN newsletter boolean NOT NULL DEFAULT false,
  ADD COLUMN newsletter_at timestamptz,
  ADD COLUMN contact_mode text,
  ADD COLUMN legacy_no text,
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN accounts.parent_account_id IS 'The group / parent company.';

-- Duplicate checks search these.
CREATE INDEX contacts_email_idx ON contacts (tenant_id, lower(email));
CREATE INDEX accounts_email_idx ON accounts (tenant_id, lower(email));
CREATE INDEX contacts_phone_digits_idx ON contacts (tenant_id, regexp_replace(phone, '\D', '', 'g'));
CREATE INDEX accounts_phone_digits_idx ON accounts (tenant_id, regexp_replace(phone, '\D', '', 'g'));

-- ---- business relationships -----------------------------------------------------
CREATE TABLE customer_relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE CASCADE,
  account_id    uuid REFERENCES accounts(id) ON DELETE CASCADE,
  relation      text NOT NULL,
  relation_old  text,
  segment       text,
  booking_id    uuid REFERENCES bookings(id) ON DELETE SET NULL,
  registered_on date NOT NULL DEFAULT current_date,
  registered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  comments      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((contact_id IS NULL) <> (account_id IS NULL))
);
CREATE INDEX customer_relationships_contact_idx ON customer_relationships (contact_id);
CREATE INDEX customer_relationships_account_idx ON customer_relationships (account_id);
COMMENT ON TABLE customer_relationships IS 'The business relationships of one customer (REL of the CRM workbook): Client, Applicant, Supplier, Partner… with segment, contract and who registered it.';
COMMENT ON COLUMN customer_relationships.relation IS 'Lookup relation (CLIENT, APPL, SUPPL, PARTNER, ENQ, BLITZ…).';
COMMENT ON COLUMN customer_relationships.relation_old IS 'Lookup relation_old: the earlier relation list, kept as it was.';
COMMENT ON COLUMN customer_relationships.booking_id IS 'The contract this relationship belongs to (CONTR ID), if any.';

-- ---- applicant profile ---------------------------------------------------------------
CREATE TABLE applicant_profiles (
  contact_id        uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  education         text,
  degree_industry   text,
  degree_industry2  text,
  degree_name       text,
  degree_year       int,
  degree_country    text,
  years_experience  numeric(4,1),
  manager_experience boolean,
  companies         text,
  experience_fields text,
  languages         text,
  driving_license   text,
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE applicant_profiles IS 'Education and experience of a person who applied for a job (relationship Applicant), kept in the CRM.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_relationships', 'applicant_profiles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

-- ---- employee ID: E + year of hiring + 4 digits ------------------------------------
ALTER TABLE users ADD COLUMN employee_no text, ADD COLUMN hired_on date;
CREATE UNIQUE INDEX users_employee_no_idx ON users (tenant_id, employee_no);
COMMENT ON COLUMN users.employee_no IS 'Employee ID: E + year of hiring + serial of that year (E20250001). Automatic.';

CREATE TABLE employee_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year       int NOT NULL,
  last_value int NOT NULL,
  PRIMARY KEY (tenant_id, year)
);
ALTER TABLE employee_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_counters USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE FUNCTION assign_employee_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int; n int;
BEGIN
  IF NEW.employee_no IS NULL THEN
    y := extract(year FROM coalesce(NEW.hired_on, NEW.created_at::date, current_date))::int;
    INSERT INTO employee_counters (tenant_id, year, last_value) VALUES (NEW.tenant_id, y, 1)
    ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = employee_counters.last_value + 1
    RETURNING last_value INTO n;
    NEW.employee_no := 'E' || y || lpad(n::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_employee_no BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION assign_employee_no();

-- Existing users, in the order they joined.
DO $$
DECLARE u record; y int; n int;
BEGIN
  FOR u IN SELECT id, tenant_id, created_at FROM users ORDER BY tenant_id, created_at, name LOOP
    y := extract(year FROM u.created_at)::int;
    INSERT INTO employee_counters (tenant_id, year, last_value) VALUES (u.tenant_id, y, 1)
    ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = employee_counters.last_value + 1
    RETURNING last_value INTO n;
    UPDATE users SET employee_no = 'E' || y || lpad(n::text, 4, '0'), hired_on = coalesce(hired_on, u.created_at::date) WHERE id = u.id;
  END LOOP;
END $$;
