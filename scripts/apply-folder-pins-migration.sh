#!/usr/bin/env bash
# Apply the (verified 100% additive) FolderPin + ProjectFolder.aggregateProjectIds migration to the
# PROD database. Diff confirmed beforehand — ADD COLUMN + CREATE TABLE + indexes/FKs only, NO DROP /
# ALTER that loses data. Uses the already-built nexus-app:beta image (carries the updated schema) on
# the prod network with the prod DATABASE_URL (read from the running app-beta container, never printed).
#
# No --accept-data-loss: prisma refuses any destructive change, so this is a safety net too.
set -euo pipefail

DBURL=$(docker inspect nexus-app-beta --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2-)
if [ -z "$DBURL" ]; then echo "Could not read DATABASE_URL from nexus-app-beta" >&2; exit 1; fi

echo "==> Applying additive migration (FolderPin + aggregateProjectIds) to PROD…"
# Plain `prisma db push` (no --accept-data-loss): prisma refuses any destructive change, so this is a
# safety net. The datasource URL is read from prisma.config.ts, which uses the DATABASE_URL env we set.
docker run --rm --network nexus_nexus_internal -e DATABASE_URL="$DBURL" nexus-app:beta \
  sh -c 'npx prisma db push'
echo "==> ✅ Migration applied."
