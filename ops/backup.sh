#!/bin/sh
# Nightly prod logical backup. Runs inside the ops container (Coolify
# scheduled task). Requires: PROD_DB_URL env; /backups persistent volume.
# Scope: public (app) + auth (users) + storage (object metadata) schemas.
# Storage BINARIES (playbook PDFs) are NOT in pg_dump — accepted gap,
# documented in the runbook (playbooks are re-uploadable).
set -eu
: "${PROD_DB_URL:?PROD_DB_URL is required}"
DIR=/backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$DIR/prod-$STAMP.dump"
mkdir -p "$DIR"
pg_dump "$PROD_DB_URL" \
  --schema=public --schema=auth --schema=storage \
  -Fc --no-owner --no-privileges \
  --file "$FILE"
# Retention: keep the newest 14 dumps.
ls -1t "$DIR"/prod-*.dump 2>/dev/null | tail -n +15 | while read -r old; do rm -f "$old"; done
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
