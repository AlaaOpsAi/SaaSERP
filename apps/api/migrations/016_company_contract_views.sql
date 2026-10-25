-- Contract list views are set by admins for the whole workspace (user request, 2026-10-25):
-- named views everyone can pick, and the standard one everyone starts with.
-- {"standard": "name or null", "views": [{"name", "order", "visible", "sorting", "filters"}]}
ALTER TABLE tenants ADD COLUMN contract_views jsonb NOT NULL DEFAULT '{"standard": null, "views": []}';
COMMENT ON COLUMN tenants.contract_views IS 'Contract list views for everyone, saved by admins: {standard, views: [{name, order, visible, sorting, filters}]}.';
