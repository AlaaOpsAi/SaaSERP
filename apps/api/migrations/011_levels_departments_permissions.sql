-- Levels, departments and data permissions (customer comment 7):
--  * departments for the org chart (Management, Sales, Marketing, Finance, Operations, Partners …)
--  * a level 1–6 on every user (persona category):
--      1 Owner & Admin (IT) · 2 Partners · 3 Directors / top management · 4 Mid-managers
--      5 Sales & sales coordinators · 6 Data entry (probation, secretaries, interns)
--  * per level, which data actions are allowed: export Excel, download documents and
--    attachments, print documents (tenants.level_permissions; empty = the defaults in code)
--  * personal exceptions on a user, e.g. a junior on probation who may not download
--    (users.permission_overrides: {"download": false})

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON departments USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
COMMENT ON TABLE departments IS 'Departments for the org chart (Sales, Marketing, Finance, Partners …).';

ALTER TABLE users
  ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN level smallint CHECK (level BETWEEN 1 AND 6),
  ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN users.level IS '1 Owner & Admin (IT), 2 Partners, 3 Directors / top management, 4 Mid-managers, 5 Sales & coordinators, 6 Data entry.';
COMMENT ON COLUMN users.permission_overrides IS 'Personal exceptions to the level''s data permissions, e.g. {"download": false, "print": false}.';

ALTER TABLE tenants ADD COLUMN level_permissions jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN tenants.level_permissions IS 'Data permissions per level, e.g. {"5": {"export": false, "download": false, "print": false}}; missing = defaults.';

-- Default departments for every workspace, and existing people placed in them.
INSERT INTO departments (tenant_id, name, sort_order)
SELECT t.id, d.name, d.ord FROM tenants t
CROSS JOIN (VALUES ('Management', 1), ('Sales', 2), ('Marketing', 3), ('Finance', 4), ('Operations', 5), ('Partners', 6)) AS d(name, ord)
ON CONFLICT DO NOTHING;

UPDATE users u SET department_id = d.id
FROM departments d
WHERE d.tenant_id = u.tenant_id AND d.name = CASE u.role
  WHEN 'owner' THEN 'Management' WHEN 'admin' THEN 'Management'
  WHEN 'manager' THEN 'Sales' WHEN 'sales' THEN 'Sales'
  WHEN 'marketing' THEN 'Marketing' WHEN 'finance' THEN 'Finance' ELSE NULL END;

-- Levels from today's roles; admins can adjust each person afterwards.
UPDATE users SET level = CASE
  WHEN role IN ('owner', 'admin') THEN 1
  WHEN role = 'manager' AND data_scope = 'all' THEN 3
  WHEN role IN ('manager', 'finance') THEN 4
  WHEN role IN ('sales', 'marketing') THEN 5
  ELSE 6 END;
