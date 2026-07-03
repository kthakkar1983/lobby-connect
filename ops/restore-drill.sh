#!/bin/sh
# Restore drill — run ON THE BOX HOST (needs docker). Proves a dump restores.
# Usage: restore-drill.sh /path/to/prod-YYYYMMDD-HHMMSS.dump
# Pass = restore completes and the printed row counts match prod
# (compare via Supabase MCP / dashboard: select count(*) from public.calls / auth.users).
# ACL/extension warnings during pg_restore are expected and tolerated;
# the row counts are the gate.
set -eu
DUMP="${1:?usage: restore-drill.sh <dump-file>}"
docker rm -f lc-restore-drill 2>/dev/null || true
docker run -d --name lc-restore-drill -e POSTGRES_PASSWORD=drill postgres:17-alpine
echo "waiting for scratch postgres..." && sleep 8
docker cp "$DUMP" lc-restore-drill:/tmp/d.dump
docker exec lc-restore-drill sh -c '
  createdb -U postgres drill &&
  psql -U postgres -d drill -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" &&
  (pg_restore -U postgres -d drill --no-owner --no-privileges /tmp/d.dump || true)'
echo "--- drill row counts (compare to prod) ---"
docker exec lc-restore-drill psql -U postgres -d drill -tAc \
  "select 'public.calls='||count(*) from public.calls"
docker exec lc-restore-drill psql -U postgres -d drill -tAc \
  "select 'auth.users='||count(*) from auth.users"
echo "cleanup: docker rm -f lc-restore-drill"
