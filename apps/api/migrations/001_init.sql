-- SaaSERP: multi-tenant Events & Catering Sales (Sales & Event Management)
--
-- Tenancy model: shared schema, every business row carries tenant_id.
-- Isolation is enforced by Postgres Row-Level Security: the runtime role
-- (saaserp_app) only sees rows whose tenant_id matches the per-transaction
-- setting app.tenant_id. Tables are owned by the migration role, which is
-- not subject to RLS; cross-tenant lookups (login) go through SECURITY
-- DEFINER functions owned by that role.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Tenants & users
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  citext NOT NULL UNIQUE,
  name                  text NOT NULL,
  plan                  text NOT NULL DEFAULT 'trial'
                          CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
  max_users             int NOT NULL DEFAULT 5,
  currency              char(3) NOT NULL DEFAULT 'KWD',
  timezone              text NOT NULL DEFAULT 'Asia/Kuwait',
  -- Profit model (from the daily report): fixed overhead and credit-facility
  -- cost are charged as a percentage of gross margin.
  fixed_cost_pct        numeric(6,4) NOT NULL DEFAULT 0.20,
  credit_facility_pct   numeric(6,4) NOT NULL DEFAULT 0.20,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          citext,
  name           text NOT NULL,
  -- Short initials used across reports (AM column: JOU, LOJ, MEL ...)
  code           text,
  role           text NOT NULL DEFAULT 'sales'
                   CHECK (role IN ('owner', 'admin', 'manager', 'sales', 'finance', 'viewer')),
  password_hash  text,
  -- Inactive users are account managers without a login (e.g. imported).
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Configuration (the PAR sheet)
-- ---------------------------------------------------------------------------

-- Brands / companies inside a tenant (CO column: W = WEDX, X = CONFX ...).
-- The code prefixes booking numbers: W2026001.
CREATE TABLE business_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Generic pick-lists: event_type, source, lost_reason, business_type,
-- payment_method, bank_account, setup_style, item_category.
CREATE TABLE lookups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        text NOT NULL,
  code        text NOT NULL,
  label       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, type, code)
);

-- Properties / locations (LOC column: RADISSON, FOUR SEASONS, HOME ...)
CREATE TABLE venues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'hotel'
                CHECK (kind IN ('hotel', 'hall', 'client_location', 'own', 'other')),
  address     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Function spaces / rooms (HALL column: MIRQAB Ballroom, DASMAN ...)
CREATE TABLE function_spaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name            text NOT NULL,
  capacity        int,
  area_sqm        numeric(10,2),
  -- Shareable spaces (e.g. client homes) never raise double-booking conflicts.
  allow_overlap   boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, venue_id, name)
);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'agency', 'government', 'individual')),
  business_type  text,
  phone          text,
  email          citext,
  address        text,
  country        text,
  notes          text,
  owner_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  name           text NOT NULL,
  phone          text,
  email          citext,
  nationality    text,
  address        text,
  social_handle  text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_phone_idx ON contacts (tenant_id, phone);

-- ---------------------------------------------------------------------------
-- Bookings (one row of the CONTRACTS sheet)
-- ---------------------------------------------------------------------------

-- INQ Inquiry -> TEN Tentative -> DEF Definite -> ACT Actualised
--                      \-> LOS Lost          \-> CXL Cancelled
CREATE TABLE bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_no            text NOT NULL,
  business_unit_id      uuid NOT NULL REFERENCES business_units(id),
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'INQ'
                          CHECK (status IN ('INQ', 'TEN', 'DEF', 'ACT', 'LOS', 'CXL')),
  event_type            text,
  source                text,
  owner_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id            uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id            uuid REFERENCES contacts(id) ON DELETE SET NULL,
  venue_id              uuid REFERENCES venues(id) ON DELETE SET NULL,
  function_space_id     uuid REFERENCES function_spaces(id) ON DELETE SET NULL,
  hall_text             text,
  event_date            date,
  end_date              date,
  pax                   int,
  rate                  numeric(14,3),
  term_days             int,
  inquiry_date          date NOT NULL DEFAULT current_date,
  decision_due_date     date,
  last_followup_date    date,
  next_followup_date    date,
  followup_notes        text,
  description           text,
  lost_reason           text,
  cancel_reason         text,
  -- Financials. Revenue / cost come from booking_items when present,
  -- otherwise from these manual figures.
  manual_revenue        numeric(14,3),
  manual_cost           numeric(14,3),
  contract_value        numeric(14,3),
  credit_facility       boolean NOT NULL DEFAULT false,
  fully_paid_date       date,
  currency              char(3) NOT NULL DEFAULT 'KWD',
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, booking_no),
  CHECK (status <> 'LOS' OR lost_reason IS NOT NULL),
  CHECK (status <> 'CXL' OR cancel_reason IS NOT NULL)
);
CREATE INDEX bookings_status_idx ON bookings (tenant_id, status);
CREATE INDEX bookings_event_date_idx ON bookings (tenant_id, event_date);
CREATE INDEX bookings_owner_idx ON bookings (tenant_id, owner_id);

-- Per-tenant, per-business-unit, per-year counter for booking numbers.
CREATE TABLE booking_sequences (
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_unit_id  uuid NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  year              int NOT NULL,
  last_value        int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, business_unit_id, year)
);

CREATE TABLE booking_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  reason       text,
  changed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- Events: individual functions inside a booking, placed on the function diary.
CREATE TABLE booking_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  function_space_id  uuid REFERENCES function_spaces(id) ON DELETE SET NULL,
  name               text NOT NULL,
  setup_style        text,
  start_at           timestamptz NOT NULL,
  end_at             timestamptz NOT NULL,
  expected_pax       int,
  guaranteed_pax     int,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX booking_events_space_idx ON booking_events (tenant_id, function_space_id, start_at);

-- Revenue / cost lines (catering, decor, rentals, manpower ...)
CREATE TABLE booking_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_id     uuid REFERENCES booking_events(id) ON DELETE SET NULL,
  category     text NOT NULL DEFAULT 'F&B',
  description  text NOT NULL,
  quantity     numeric(12,3) NOT NULL DEFAULT 1,
  unit_price   numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost    numeric(14,3) NOT NULL DEFAULT 0,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_items_booking_idx ON booking_items (booking_id);

-- Meetings, calls, follow-ups, site visits (MEETING #1..#5 in the sheet).
CREATE TABLE activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES bookings(id) ON DELETE CASCADE,
  account_id    uuid REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('meeting', 'call', 'followup', 'site_visit', 'email', 'task')),
  subject       text NOT NULL,
  due_at        timestamptz NOT NULL,
  location      text,
  notes         text,
  outcome       text,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_due_idx ON activities (tenant_id, owner_id, due_at) WHERE completed_at IS NULL;

-- Client receipts.
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  paid_on       date NOT NULL,
  amount        numeric(14,3) NOT NULL CHECK (amount <> 0),
  method        text NOT NULL DEFAULT 'BANK',
  bank_account  text,
  reference     text,
  notes         text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

-- Commission (AM) and partner shares, computed from net profit.
CREATE TABLE booking_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('commission', 'share')),
  payee_name   text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  pct          numeric(6,4) NOT NULL CHECK (pct >= 0 AND pct <= 1),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_on      date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_payouts_booking_idx ON booking_payouts (booking_id);

-- ---------------------------------------------------------------------------
-- Finance view: the formulas of the daily report, per booking.
--   gross_margin   = revenue - cost
--   fixed_cost     = gross_margin * tenant.fixed_cost_pct
--   cf_cost        = gross_margin * tenant.credit_facility_pct  (if credit facility)
--   net_profit     = gross_margin - fixed_cost - cf_cost
--   commission     = net_profit * commission pct
--   share          = (net_profit - commission) * share pct
--   outstanding    = contract value - payments          (DEF / ACT only)
--   aging_days     = days since event until fully paid (or today)
-- ---------------------------------------------------------------------------

CREATE VIEW booking_finance WITH (security_invoker = true) AS
WITH items AS (
  SELECT booking_id,
         sum(quantity * unit_price) AS revenue,
         sum(quantity * unit_cost)  AS cost,
         count(*)                   AS n
  FROM booking_items GROUP BY booking_id
), paid AS (
  SELECT booking_id, sum(amount) AS paid, max(paid_on) AS last_paid_on
  FROM payments GROUP BY booking_id
), pay AS (
  SELECT booking_id,
         coalesce(sum(pct) FILTER (WHERE kind = 'commission'), 0) AS commission_pct,
         coalesce(sum(pct) FILTER (WHERE kind = 'share'), 0)      AS share_pct
  FROM booking_payouts GROUP BY booking_id
), base AS (
  SELECT b.id AS booking_id, b.tenant_id, b.status, b.event_date, b.fully_paid_date,
         CASE WHEN coalesce(i.n, 0) > 0 THEN i.revenue ELSE coalesce(b.manual_revenue, 0) END AS revenue,
         CASE WHEN coalesce(i.n, 0) > 0 THEN i.cost    ELSE coalesce(b.manual_cost, 0)    END AS cost,
         b.contract_value,
         b.credit_facility,
         t.fixed_cost_pct, t.credit_facility_pct,
         coalesce(p.paid, 0) AS paid,
         p.last_paid_on,
         coalesce(pay.commission_pct, 0) AS commission_pct,
         coalesce(pay.share_pct, 0) AS share_pct
  FROM bookings b
  JOIN tenants t ON t.id = b.tenant_id
  LEFT JOIN items i ON i.booking_id = b.id
  LEFT JOIN paid p  ON p.booking_id = b.id
  LEFT JOIN pay     ON pay.booking_id = b.id
), calc AS (
  SELECT base.*,
         revenue - cost AS gross_margin,
         (revenue - cost) * fixed_cost_pct AS fixed_cost,
         CASE WHEN credit_facility THEN (revenue - cost) * credit_facility_pct ELSE 0 END AS cf_cost,
         coalesce(contract_value, revenue) AS billable
  FROM base
), net AS (
  SELECT calc.*,
         gross_margin - fixed_cost - cf_cost AS net_profit
  FROM calc
)
SELECT booking_id, tenant_id, status,
       round(revenue, 3)                       AS revenue,
       round(cost, 3)                          AS cost,
       round(gross_margin, 3)                  AS gross_margin,
       CASE WHEN revenue = 0 THEN NULL ELSE round(gross_margin / revenue, 4) END AS margin_pct,
       contract_value,
       CASE WHEN contract_value IS NULL THEN NULL ELSE round(revenue - contract_value, 3) END AS diff,
       round(fixed_cost, 3)                    AS fixed_cost,
       round(cf_cost, 3)                       AS cf_cost,
       round(net_profit, 3)                    AS net_profit,
       round(net_profit * commission_pct, 3)   AS commission,
       round((net_profit - net_profit * commission_pct) * share_pct, 3) AS shares,
       round(paid, 3)                          AS paid,
       CASE WHEN status IN ('DEF', 'ACT') THEN round(billable - paid, 3) ELSE 0 END AS outstanding,
       CASE WHEN status NOT IN ('DEF', 'ACT') OR event_date IS NULL THEN 0
            ELSE greatest(0, coalesce(fully_paid_date, current_date) - event_date) END AS aging_days,
       last_paid_on
FROM net;

-- Payout amounts per line (commission first, shares on the remainder).
CREATE VIEW booking_payout_amounts WITH (security_invoker = true) AS
SELECT po.*,
       round(CASE WHEN po.kind = 'commission' THEN f.net_profit * po.pct
                  ELSE (f.net_profit - f.commission) * po.pct END, 3) AS amount
FROM booking_payouts po
JOIN booking_finance f ON f.booking_id = po.booking_id;

-- ---------------------------------------------------------------------------
-- Triggers & RLS
-- ---------------------------------------------------------------------------

CREATE TRIGGER tenants_touch  BEFORE UPDATE ON tenants  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'business_units', 'lookups', 'venues', 'function_spaces',
    'accounts', 'contacts', 'bookings', 'booking_sequences', 'booking_status_history',
    'booking_events', 'booking_items', 'activities', 'payments', 'booking_payouts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

-- Login needs to find a user before a tenant is known.
CREATE OR REPLACE FUNCTION auth_find_users(p_email citext)
RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_slug citext, tenant_name text,
               password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, t.id, t.slug, t.name, u.password_hash, u.is_active
  FROM users u JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = p_email
$$;

CREATE OR REPLACE FUNCTION auth_slug_taken(p_slug citext) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug)
$$;
