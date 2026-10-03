#!/usr/bin/env bash
# PUT a local file to a presigned Higgsfield upload URL (from media_upload).
# Usage: scripts/put_upload.sh <file> <content-type> <presigned-url>
set -euo pipefail
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "Content-Type: $2" --data-binary @"$1" "$3")
echo "$1 -> HTTP $code"
[ "$code" = 200 ]
