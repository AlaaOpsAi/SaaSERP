#!/usr/bin/env bash
# Restore a backup, REPLACING the current data: ./scripts/restore.sh backups/saaserp-20261002-030000.dump
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: $0 backups/<file>.dump" >&2
  ls -1t backups/*.dump 2>/dev/null | head -5 | sed 's/^/  available: /' >&2
  exit 1
fi
read -r -p "This replaces ALL current data with $file. Type RESTORE to continue: " answer
[[ "$answer" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

echo "Taking a safety backup of the current data first..."
./scripts/backup.sh
docker compose stop app
# Recreate the database empty, then load the dump into it.
docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS saaserp WITH (FORCE);" -c "CREATE DATABASE saaserp OWNER saaserp_owner;"
docker compose exec -T db pg_restore -U postgres -d saaserp --no-owner --role=saaserp_owner --exit-on-error < "$file"
docker compose start app
echo "Restored $file. The app is starting again (migrations run automatically)."
