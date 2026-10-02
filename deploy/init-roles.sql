-- Roles for the containerised stack (see apps/api/scripts/setup-db.sh for the local equivalent).
--   saaserp_owner     owns the schema, runs migrations; not subject to row-level security
--   saaserp_app       the API; always subject to row-level security
--   saaserp_readonly  reporting / BI tools; reads every table of every workspace, cannot change anything
CREATE ROLE saaserp_owner LOGIN PASSWORD 'saaserp_owner';
CREATE ROLE saaserp_app LOGIN PASSWORD 'saaserp_app' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE saaserp_readonly LOGIN PASSWORD 'saaserp_readonly' NOSUPERUSER BYPASSRLS;
ALTER DATABASE saaserp OWNER TO saaserp_owner;
\connect saaserp
ALTER SCHEMA public OWNER TO saaserp_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
