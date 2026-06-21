#!/usr/bin/env bash
# Bring up the BETA stack (port 3002) with a CLONE of the prod database.
# Prod `nexus-app` (:3000) is NOT touched. Run from the repo root:
#   ./scripts/beta-up.sh
set -euo pipefail

COMPOSE="docker compose -p nexus-beta -f docker-compose.beta.yml"
PROD_DB_CONTAINER="nexus-postgres"
BETA_DB_CONTAINER="nexus-postgres-beta"

echo "==> 1/5 Building beta image (nexus-app:beta) + starting beta Postgres…"
$COMPOSE up -d --build postgres-beta

echo "==> waiting for beta Postgres to be healthy…"
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$BETA_DB_CONTAINER" 2>/dev/null)" = "healthy" ]; do sleep 2; done

echo "==> 2/5 Cloning PROD database -> BETA (read-only dump from prod; isolated restore)…"
docker exec "$PROD_DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  | docker exec -i "$BETA_DB_CONTAINER" psql -v ON_ERROR_STOP=0 -U nexus -d nexus >/dev/null
echo "    clone done."

echo "==> 3/5 Applying new schema (gamification + messages + folderId) via prisma db push…"
$COMPOSE run --rm migrate-beta

echo "==> 4/5 Starting beta app on http://127.0.0.1:3002 …"
$COMPOSE up -d app-beta

echo "==> 5/5 Health check…"
sleep 4
curl -s -o /dev/null -w "beta /api/health -> %{http_code}\n" -m 15 "http://127.0.0.1:3002/api/health" || true

cat <<'NEXT'

BETA backend is up at http://127.0.0.1:3002 (isolated DB clone).
Next:
  1) Point Phaëthon at beta + restart:
       cd apps/nexus-lovable-ui && VITE_API_TARGET=http://127.0.0.1:3002 npm run dev
  2) Public link for testers (Cloudflare quick tunnel to the frontend):
       cloudflared tunnel --url http://127.0.0.1:4178
     -> share the printed *.trycloudflare.com URL.

Tear down beta later (prod untouched):
  docker compose -p nexus-beta -f docker-compose.beta.yml down
  # add -v to also delete the beta DB volume (./var-beta)
NEXT
