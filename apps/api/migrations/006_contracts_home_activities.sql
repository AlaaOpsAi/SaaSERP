-- Phase 1 of the customer's module plan: contract fields of the new daily-report
-- layout, per-role field visibility, the icon home screen and meeting outcomes.

-- ---------------------------------------------------------------------------
-- Contracts (bookings): BRANCH and DESIGN columns of the CONTRACTS sheet
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN branch text;
ALTER TABLE bookings ADD COLUMN design text;
COMMENT ON COLUMN bookings.branch IS 'Own outlet the sales team works from (pick-list "branch", e.g. RB = Radisson). The event venue is venue_id.';
COMMENT ON COLUMN bookings.design IS 'Design / decor package (pick-list "design", e.g. WX12).';

-- Client details are split into first and family name, as in the new sheet.
-- contacts.name stays the display name (first + family) used everywhere else.
ALTER TABLE contacts ADD COLUMN first_name text;
ALTER TABLE contacts ADD COLUMN family_name text;
COMMENT ON COLUMN contacts.first_name IS 'Client first name / contact person (CLIENT FIRST NAME).';
COMMENT ON COLUMN contacts.family_name IS 'Client family name (CLIENT FAMILY NAME).';
COMMENT ON COLUMN contacts.social_handle IS 'Instagram ID or other social alias (ALIAS # | INSTA ID).';

-- Down payments recorded by sales are told apart from receipts entered by finance.
ALTER TABLE payments ADD COLUMN kind text NOT NULL DEFAULT 'payment' CHECK (kind IN ('deposit', 'payment'));
COMMENT ON COLUMN payments.kind IS 'deposit = down payment recorded by sales on the contract; payment = receipt entered by finance.';

-- ---------------------------------------------------------------------------
-- Company settings: who sees which contract fields, and the home-screen icon order
-- ---------------------------------------------------------------------------
-- {"sales": ["finance", "source"], "viewer": ["finance"]}: field groups hidden per role.
-- Owners and admins always see everything.
ALTER TABLE tenants ADD COLUMN field_visibility jsonb NOT NULL DEFAULT '{"sales": ["finance"], "viewer": ["finance"]}';
ALTER TABLE tenants ADD COLUMN home_order text[];
COMMENT ON COLUMN tenants.field_visibility IS 'Contract fields hidden per role, e.g. {"sales": ["finance"]}. Hidden finance figures are removed by the API, not only on screen.';
COMMENT ON COLUMN tenants.home_order IS 'Order of the module icons on the home screen, set by an admin; empty = default order.';

-- ---------------------------------------------------------------------------
-- Activities: meeting outcomes feed the daily activity report
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN activities.outcome IS 'Result of the meeting or call, required when a meeting is marked done; shown on the daily activity report.';
CREATE INDEX activities_completed_idx ON activities (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX activities_meetings_idx ON activities (tenant_id, due_at) WHERE type IN ('meeting', 'site_visit');
