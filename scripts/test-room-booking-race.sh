#!/bin/bash
# The Room Booking race test (src/__tests__/room-booking-race.test.ts) against a THROWAWAY Postgres:
# an internal docker network, postgres:16-alpine on tmpfs, `prisma db push`, the no-overlap SQL file
# (applied twice: it must be idempotent), then the test. Everything it starts is removed at the end;
# no other container or database is touched.
#   scripts/test-room-booking-race.sh            (from the repo root, node_modules installed)
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN="rbrace$$"; NET="$RUN-net"; PG="$RUN-pg"
NODE_IMAGE="${NODE_IMAGE:-node:22}"
SQL="$REPO/prisma/sql/2026-10-16-room-booking-no-overlap.sql"
cleanup() { docker rm -f "$PG" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT

docker network create --internal "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=x --tmpfs /var/lib/postgresql/data postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
URL="postgresql://postgres:x@$PG:5432/postgres"
in_node() { docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$REPO:/app" -w /app "$@"; }

in_node -e DATABASE_URL="$URL" "$NODE_IMAGE" npx prisma db push >/dev/null || { echo "db push failed"; exit 1; }
for pass in 1 2; do
  docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q < "$SQL" || { echo "SQL failed (pass $pass)"; exit 1; }
done
in_node -e ROOM_BOOKING_TEST_DATABASE_URL="$URL" "$NODE_IMAGE" npx vitest run src/__tests__/room-booking-race.test.ts
