-- Workspace approval: new sign-ups wait for a platform operator.
--   pending -> active | rejected
--   active  -> suspended -> active
--   rejected -> active (reconsidered)

ALTER TABLE tenants
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
  ADD COLUMN status_reason text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by citext,
  ADD COLUMN contact_phone text,
  ADD COLUMN signup_note text;

-- Existing workspaces stay active; new ones start pending.
ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'pending';

-- Platform operators (the SaaS owner's staff). Not tenant data: no tenant_id, no RLS.
CREATE TABLE platform_admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Login now also reports the workspace status, so pending / rejected /
-- suspended workspaces get a clear message instead of a session.
DROP FUNCTION auth_find_users(citext);
CREATE FUNCTION auth_find_users(p_email citext)
RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_slug citext, tenant_name text,
               password_hash text, is_active boolean, tenant_status text, status_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, t.id, t.slug, t.name, u.password_hash, u.is_active, t.status, t.status_reason
  FROM users u JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = p_email
$$;

-- Cross-tenant views for the operator console. Only the platform routes call these.
CREATE FUNCTION platform_tenants()
RETURNS TABLE (id uuid, slug citext, name text, status text, status_reason text, plan text, max_users int,
               currency char(3), contact_phone text, signup_note text, created_at timestamptz,
               reviewed_at timestamptz, reviewed_by citext, owner_name text, owner_email citext,
               users int, bookings int, last_booking_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, t.status, t.status_reason, t.plan, t.max_users, t.currency,
         t.contact_phone, t.signup_note, t.created_at, t.reviewed_at, t.reviewed_by,
         o.name, o.email,
         (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.is_active AND u.email IS NOT NULL),
         (SELECT count(*)::int FROM bookings b WHERE b.tenant_id = t.id),
         (SELECT max(b.created_at) FROM bookings b WHERE b.tenant_id = t.id)
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT u.name, u.email FROM users u
    WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY u.created_at LIMIT 1
  ) o ON true
  ORDER BY (t.status = 'pending') DESC, t.created_at DESC
$$;

CREATE FUNCTION platform_update_tenant(p_id uuid, p_status text, p_reason text, p_plan text,
                                       p_max_users int, p_reviewer citext)
RETURNS SETOF tenants
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE tenants SET
    status        = coalesce(p_status, status),
    status_reason = CASE WHEN p_status IS NULL THEN status_reason ELSE p_reason END,
    reviewed_at   = CASE WHEN p_status IS NULL THEN reviewed_at ELSE now() END,
    reviewed_by   = CASE WHEN p_status IS NULL THEN reviewed_by ELSE p_reviewer END,
    plan          = coalesce(p_plan, plan),
    max_users     = coalesce(p_max_users, max_users)
  WHERE id = p_id
  RETURNING *
$$;
