#!/usr/bin/env bash
# Tracked copy. The installed one is ~/nexus-dev-refresh-db.sh on nexus-prod — keep both in sync.
# Copy the PRODUCTION database into the DEV database (nexus_dev in nexus-dev-postgres).
#
#   ~/nexus-dev-refresh-db.sh          -> asks for confirmation
#   ~/nexus-dev-refresh-db.sh --yes    -> no prompt (scripts only)
#
# Production is only READ (one pg_dump from nexus-postgres). Everything that is dropped or written
# lives in the nexus-dev-postgres container: the nexus_dev database there is wiped and replaced.
# The latest dump is kept as ~/nexus-dev-data/prod-latest.dump (mode 600); older ones are not kept.
set -euo pipefail

PROD_PG=nexus-postgres
PROD_DB=nexus_db
PROD_USER=nexus_user
DEV_PG=nexus-dev-postgres
DEV_DB=nexus_dev
DEV_USER=nexus_dev
DEV_APP=nexus-dev-app
DATA="$HOME/nexus-dev-data"
DUMP="$DATA/prod-latest.dump"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# Hard guards: the target must be the dev container and the dev database, never production.
[ "$DEV_PG" != "$PROD_PG" ] && [ "$DEV_DB" = "nexus_dev" ] || { red "guard: target is not the dev database"; exit 1; }
docker inspect "$DEV_PG" >/dev/null 2>&1 || { red "$DEV_PG is not running/created"; exit 1; }
[ "$(docker inspect -f '{{.Config.Image}}' "$DEV_PG")" = "postgres:16-alpine" ] || { red "guard: $DEV_PG has an unexpected image"; exit 1; }

if [ -e /var/lib/nexus-fence/tripped ]; then
  red "NOTE: failover fence is tripped — NEXUS is being served by the VPS, so the office DB may be stale."
fi

if [ "${1:-}" != "--yes" ]; then
  echo "This WIPES database '$DEV_DB' in container '$DEV_PG' and replaces it with a fresh copy of"
  echo "production ($PROD_PG/$PROD_DB, read-only dump). Everything done on dev since the last refresh is lost."
  read -r -p "Type 'nexus_dev' to continue: " ans
  [ "$ans" = "nexus_dev" ] || { echo "cancelled"; exit 1; }
fi

mkdir -p "$DATA"; chmod 700 "$DATA"; umask 077

echo "== 1/4 dump production (read-only) =="
TMP="$DUMP.partial"
nice -n 10 docker exec "$PROD_PG" pg_dump -U "$PROD_USER" -d "$PROD_DB" -Fc > "$TMP"
chmod 600 "$TMP"
docker exec -i "$DEV_PG" pg_restore --list < "$TMP" >/dev/null || { red "dump is unreadable — nothing changed"; rm -f "$TMP"; exit 1; }
mv -f "$TMP" "$DUMP"
echo "   $(du -h "$DUMP" | cut -f1) -> $DUMP"

echo "== 2/4 stop dev app (frees DB connections) =="
was_running=0
if [ "$(docker inspect -f '{{.State.Running}}' "$DEV_APP" 2>/dev/null)" = "true" ]; then
  was_running=1; docker stop "$DEV_APP" >/dev/null; echo "   $DEV_APP stopped"
fi

echo "== 3/4 recreate $DEV_DB and restore =="
docker exec "$DEV_PG" psql -U "$DEV_USER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $DEV_DB WITH (FORCE);" \
  -c "CREATE DATABASE $DEV_DB OWNER $DEV_USER;"
docker exec -i "$DEV_PG" pg_restore -U "$DEV_USER" -d "$DEV_DB" --no-owner --no-privileges --exit-on-error < "$DUMP"
docker exec "$DEV_PG" psql -U "$DEV_USER" -d "$DEV_DB" -q -c "ANALYZE;"

echo "== 4/4 compare row counts (prod vs dev) =="
for t in User Project Task Message AttendanceRequest Notification AuditLog; do
  p=$(docker exec "$PROD_PG" psql -U "$PROD_USER" -d "$PROD_DB" -tAc "select count(*) from \"$t\"" 2>/dev/null || echo "?")
  d=$(docker exec "$DEV_PG"  psql -U "$DEV_USER"  -d "$DEV_DB"  -tAc "select count(*) from \"$t\"" 2>/dev/null || echo "?")
  printf '   %-20s prod=%-8s dev=%-8s %s\n' "$t" "$p" "$d" "$([ "$p" = "$d" ] && echo ok || echo 'DIFF (prod moves on; small diffs are normal)')"
done

if [ "$was_running" = 1 ]; then
  docker start "$DEV_APP" >/dev/null && echo "   $DEV_APP started again"
fi
green "dev database refreshed from production"
