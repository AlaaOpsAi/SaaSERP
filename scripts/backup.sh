#!/usr/bin/env bash
# Take a backup now: ./scripts/backup.sh  ->  backups/saaserp-YYYYmmdd-HHMMSS.dump
# (Runs pg_dump inside the db container, so nothing needs installing on your Mac.)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/saaserp-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U postgres -d saaserp --format=custom > "$file.part"
mv "$file.part" "$file"
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
