#!/usr/bin/env bash
# Creates the database and the two roles for local development.
#   saaserp_owner : owns the schema, runs migrations (bypasses RLS as owner)
#   saaserp_app   : runtime role used by the API (subject to RLS)
# Usage: sudo -u postgres ./scripts/setup-db.sh [dbname]
set -euo pipefail
DB="${1:-saaserp}"
psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saaserp_owner') THEN
    CREATE ROLE saaserp_owner LOGIN PASSWORD 'saaserp_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saaserp_app') THEN
    CREATE ROLE saaserp_app LOGIN PASSWORD 'saaserp_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
SQL
if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB}'" | grep -q 1; then
  createdb -O saaserp_owner "${DB}"
fi
psql -d "${DB}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;"
echo "Database ${DB} ready."
