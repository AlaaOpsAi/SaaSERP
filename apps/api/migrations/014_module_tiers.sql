-- Module tiers (feedback on migration 013):
--  * Contracts is a subscription like any other module (was "sales", always on).
--  * HR, Finance … have a basic tier without a subscription; the subscription is the full module.
--    HR basic is the employee directory: job fields and work contact details.

UPDATE tenants SET modules = array_replace(modules, 'sales', 'contracts');
ALTER TABLE tenants ALTER COLUMN modules SET DEFAULT '{contracts}';
UPDATE module_requests SET module = 'contracts' WHERE module = 'sales';
COMMENT ON COLUMN tenants.modules IS 'Module subscriptions: contracts, hr (full HR), … Modules not listed still have their basic tier. Changed only by the platform operator.';

CREATE OR REPLACE FUNCTION platform_set_modules(p_id uuid, p_modules text[], p_operator citext)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE result text[];
BEGIN
  UPDATE tenants SET modules = coalesce((SELECT array_agg(DISTINCT m ORDER BY m) FROM unnest(p_modules) m), '{}')
  WHERE id = p_id RETURNING modules INTO result;
  UPDATE module_requests SET status = CASE WHEN module = ANY (result) THEN 'granted' ELSE 'declined' END,
         decided_at = now(), decided_by = p_operator
  WHERE tenant_id = p_id AND status = 'pending';
  RETURN result;
END $$;

ALTER TABLE employees ADD COLUMN work_phone text, ADD COLUMN work_email text;
