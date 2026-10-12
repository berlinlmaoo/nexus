#!/usr/bin/env bash
# Sample which process holds the NEXUS singleton lock, once a second, for $1 seconds (deploy/bluegreen/README.md → Testing).
#   leader-sampler.sh SECONDS dev|prod
# Prints: time, /api/health "leader" of every running slot, and the holder of the advisory lock in pg_locks
# (application_name nexus-leader-<slot>). "Exactly once" = never two leaders, and pg_locks never shows two holders.
DUR="${1:-60}"; PROFILE="${2:-dev}"
case "$PROFILE" in
  dev)  PG=nexus-dev-postgres; PGU=nexus_dev; PGD=nexus_dev; PFX=nexus-dev-app- ;;
  prod) PG=nexus-postgres; PGU=nexus_user; PGD=nexus_db; PFX=nexus-app- ;;
esac
end=$(( $(date +%s) + DUR ))
while [ "$(date +%s)" -lt "$end" ]; do
  line="$(date +%T)"
  for s in blue green; do
    c="$PFX$s"
    if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ]; then
      l=$(docker exec "$c" node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>r.json()).then(j=>console.log(j.leader?"LEADER":"-")).catch(()=>console.log("down"))' 2>/dev/null)
      line="$line $s=$l"
    else
      line="$line $s=stopped"
    fi
  done
  h=$(docker exec "$PG" psql -U "$PGU" -d "$PGD" -tAc "select string_agg(a.application_name, ',') from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.locktype = 'advisory' and l.granted and l.objid = (4632018812 % 4294967296)" 2>/dev/null)
  echo "$line lock=${h:-none}"
  sleep 1
done
