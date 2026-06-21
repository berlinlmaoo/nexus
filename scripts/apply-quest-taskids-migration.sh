#!/usr/bin/env bash
# Apply the (verified additive) Quest.taskIds migration to the PROD database. Read-only diff confirmed it
# beforehand — a single `ALTER TABLE "Quest" ADD COLUMN "taskIds" TEXT[] DEFAULT ARRAY[]` — no DROP / no
# data loss. Uses the freshly-built nexus-app:beta image (carries the updated schema + prisma CLI) on the
# prod network with the prod DATABASE_URL (read from the running app-beta container, never printed).
#
# Plain `prisma db push` (no --accept-data-loss): prisma refuses any destructive change, so this is also a
# safety net. Run AFTER the images are built (scripts already did that), BEFORE the backend is recreated.
set -euo pipefail

DBURL=$(docker inspect nexus-app-beta --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2-)
if [ -z "$DBURL" ]; then echo "Could not read DATABASE_URL from nexus-app-beta" >&2; exit 1; fi

echo "==> Applying additive migration (Quest.taskIds) to PROD…"
docker run --rm --network nexus_nexus_internal -e DATABASE_URL="$DBURL" nexus-app:beta \
  sh -c 'npx prisma db push'
echo "==> ✅ Migration applied. Now tell the assistant to recreate the backend + deploy the frontend."
