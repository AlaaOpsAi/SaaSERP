#!/bin/sh
# Runs inside the "backup" container: a full dump every BACKUP_INTERVAL_SECONDS,
# old dumps removed after BACKUP_KEEP_DAYS. Files: ./backups/saaserp-YYYYmmdd-HHMMSS.dump
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"
EVERY="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  file="/backups/saaserp-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump -h db -U postgres -d saaserp --format=custom --file="$file.part"; then
    mv "$file.part" "$file"
    echo "$(date -Iseconds) backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "$(date -Iseconds) BACKUP FAILED" >&2
  fi
  find /backups -name 'saaserp-*.dump' -mtime +"$KEEP" -delete
  sleep "$EVERY"
done
