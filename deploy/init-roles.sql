-- Roles for the containerised stack (see apps/api/scripts/setup-db.sh for the local equivalent).
CREATE ROLE saaserp_owner LOGIN PASSWORD 'saaserp_owner';
CREATE ROLE saaserp_app LOGIN PASSWORD 'saaserp_app' NOSUPERUSER NOBYPASSRLS;
ALTER DATABASE saaserp OWNER TO saaserp_owner;
\connect saaserp
ALTER SCHEMA public OWNER TO saaserp_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
