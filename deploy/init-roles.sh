#!/bin/sh
# Roles for the containerised stack (see apps/api/scripts/setup-db.sh for the local equivalent).
# Runs once, when the database volume is first created. Passwords come from .env;
# the defaults are only for a laptop.
#   saaserp_owner     owns the schema, runs migrations; not subject to row-level security
#   saaserp_app       the API; always subject to row-level security
#   saaserp_readonly  reporting / BI tools; reads every table of every workspace, cannot change anything
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v owner_pw="${DB_OWNER_PASSWORD:-saaserp_owner}" \
  -v app_pw="${DB_APP_PASSWORD:-saaserp_app}" \
  -v ro_pw="${DB_READONLY_PASSWORD:-saaserp_readonly}" <<'SQL'
CREATE ROLE saaserp_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE saaserp_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE saaserp_readonly LOGIN PASSWORD :'ro_pw' NOSUPERUSER BYPASSRLS;
ALTER DATABASE saaserp OWNER TO saaserp_owner;
\connect saaserp
ALTER SCHEMA public OWNER TO saaserp_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
