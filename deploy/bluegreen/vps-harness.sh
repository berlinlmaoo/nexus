#!/usr/bin/env bash
# Usage (nexus-prod, throwaway): stage ~/bg-vps-test/{harness.sh,bin/=deploy/bluegreen,scripts/{failover,failback}.{orig,new}.sh,
#   scripts/compose.{orig,new}.yml,scripts/phaethon.conf (VPS copy),office-phaethon.conf}; docker run -d --privileged --name bgvps-dind
#   -v ~/bg-vps-test:/harness docker:27-dind --bip 10.200.0.1/24 --default-address-pool base=10.201.0.0/16,size=24; apk add bash curl
#   rsync python3 sudo coreutils util-linux; docker save postgres:16-alpine nginx:alpine nexus-app:<image> | docker exec -i bgvps-dind
#   docker load; tag it nexus-app:prod; docker exec bgvps-dind bash /harness/harness.sh all; then docker rm -f -v bgvps-dind.
# Runs INSIDE a throwaway docker:dind container. Rebuilds the VPS standby layout (same container, network, volume
# and path names as /srv on the VPS) and runs the real failover.sh / failback.sh (orig and patched) before and
# after `vps-bluegreen.sh migrate`. Only two substitutions in the script copies: the office Postgres address
# (100.118.101.24 -> this dind's office-pg) and the public URL (https://nexus.znetworks.id -> a local stand-in for
# the tunnel connector that proxies to nexus-web:3000 exactly like cloudflared's ingress).
set -uo pipefail
T=/harness
IP=$(ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)
PUB="http://$IP:8443"
say() { printf '\n\033[1m######## %s  (%s)\033[0m\n' "$*" "$(date +%T)"; }
ok() { printf '\033[32mRESULT OK: %s\033[0m\n' "$*"; }
bad() { printf '\033[31mRESULT FAIL: %s\033[0m\n' "$*"; }

subst() {  # src dst
  sed -e "s#100\.118\.101\.24#$IP#g" -e "s#https://nexus\.znetworks\.id#$PUB#g" "$1" > "$2"; chmod +x "$2"
}
compose_test() {  # src dst : cloudflared service -> nginx stand-in (same container name / network / profile)
  python3 - "$1" "$2" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
i=s.index("  cloudflared:")
j=s.index("\nnetworks:", i)
block=s[i:j]
block=block.replace("image: cloudflare/cloudflared:latest","image: nginx:alpine")
block=re.sub(r"\n    env_file: \.tunnel\.env","",block)
block=re.sub(r"\n    command: .*","",block)
block=block.replace("./cloudflared/config.yml:/etc/cloudflared/config.yml:ro","./cloudflared/standin.conf:/etc/nginx/conf.d/default.conf:ro")
block=block.replace("    profiles: [failover]","    profiles: [failover]\n    ports: [\"8443:80\"]")
open(sys.argv[2],"w").write(s[:i]+block+s[j:])
PY
}
pgq() { docker exec nexus-standby psql -U nexus_user -d nexus_db -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
pub() { curl -s -m 5 "$PUB/api/health"; }
web() { docker exec nexus-web wget -qO- -T 3 http://127.0.0.1:3000/api/health 2>/dev/null; }

setup_office() {
  say "office primary (office-pg, published :5432 like the tailnet address) + repl user + slot"
  docker rm -f office-pg >/dev/null 2>&1
  docker run -d --name office-pg -p 5432:5432 -e POSTGRES_USER=nexus_user -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=nexus_db \
    postgres:16-alpine -c wal_level=replica -c max_wal_senders=5 -c max_replication_slots=5 >/dev/null
  for i in $(seq 1 30); do docker exec office-pg pg_isready -U nexus_user >/dev/null 2>&1 && break; sleep 1; done; sleep 2
  docker exec office-pg psql -U nexus_user -d nexus_db -qc "create role repl replication login password 'replpw'; create table \"User\"(id int); insert into \"User\" values (1),(2),(3);"
  docker exec office-pg sh -c "echo 'host replication repl 0.0.0.0/0 md5' >> /var/lib/postgresql/data/pg_hba.conf"
  docker exec -u postgres office-pg pg_ctl reload -D /var/lib/postgresql/data >/dev/null
  mkdir -p /root/.secrets; echo replpw > /root/.secrets/nexus-repl.pw
}
seed_standby() {  # what failback.sh does, done by hand for the first seed
  (cd /srv/nexus-standby && docker compose down >/dev/null 2>&1)
  docker volume rm nexus-standby-pgdata >/dev/null 2>&1; docker volume create nexus-standby-pgdata >/dev/null
  docker exec office-pg psql -U nexus_user -d nexus_db -qtc "select pg_drop_replication_slot('vps_standby') from pg_replication_slots where slot_name='vps_standby'" >/dev/null
  docker run --rm -e PGPASSWORD=replpw -v nexus-standby-pgdata:/var/lib/postgresql/data postgres:16-alpine \
    sh -c "pg_basebackup -h $IP -p 5432 -U repl -D /var/lib/postgresql/data -R -C -S vps_standby -X stream && chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data" >/dev/null 2>&1
  (cd /srv/nexus-standby && docker compose up -d >/dev/null 2>&1)
  for i in $(seq 1 30); do [ "$(pgq 'select pg_is_in_recovery()')" = t ] && break; sleep 1; done
  echo "   standby in recovery: $(pgq 'select pg_is_in_recovery()')"
}
lay_out_srv() {
  say "/srv layout (as on the VPS, 12 Oct 2026)"
  rm -rf /srv/*; mkdir -p /srv/nexus-standby /srv/nexus-app/{cloudflared,dist,certs,secrets}
  cat > /srv/nexus-standby/docker-compose.yml <<'EOF'
services:
  db:
    image: postgres:16-alpine
    container_name: nexus-standby
    restart: unless-stopped
    environment:
      - POSTGRES_PASSWORD=unused-standby
    volumes:
      - nexus-standby-pgdata:/var/lib/postgresql/data
volumes:
  nexus-standby-pgdata:
    external: true
EOF
  for d in attendance attachments avatars complaints chat feed project-icons peer-reports; do mkdir -p /srv/nexus-app/uploads/$d; done
  chown -R 1000:1000 /srv/nexus-app/uploads
  echo dummy > /srv/nexus-app/secrets/apns.p8; : > /srv/nexus-app/.tunnel.env; echo "# dummy" > /srv/nexus-app/cloudflared/config.yml
  printf 'server { listen 80; location / { proxy_pass http://nexus-web:3000; } }\n' > /srv/nexus-app/cloudflared/standin.conf
  echo '<!doctype html><div id="root"></div><script type="module" src="/assets/index-test.js"></script>' > /srv/nexus-app/dist/index.html
  cp $T/scripts/phaethon.conf /srv/nexus-app/phaethon.conf
  cat > /srv/nexus-app/.env <<'EOF'
DATABASE_URL=postgresql://nexus_user:pw@nexus-standby:5432/nexus_db?schema=public
NEXTAUTH_SECRET=testtesttesttesttesttesttesttest
NEXTAUTH_URL=http://localhost
EOF
  compose_test $T/scripts/compose.orig.yml /srv/nexus-app/docker-compose.yml
  for v in orig new; do subst $T/scripts/failover.$v.sh /srv/failover.$v.sh; subst $T/scripts/failback.$v.sh /srv/failback.$v.sh; done
}
legacy_up() {
  (cd /srv/nexus-app && docker compose up -d >/dev/null 2>&1) || { bad "compose up (legacy)"; return 1; }
  for i in $(seq 1 40); do web | grep -q '"database":"up"' && break; sleep 2; done
  echo "   legacy via nexus-web: $(web | head -c 140)"
}
run_failover() {  # orig|new label
  say "failover.sh ($1) — $2"
  docker stop office-pg >/dev/null   # the office is down
  bash /srv/failover.$1.sh; rc=$?
  echo "   rc=$rc  standby primary? $(pgq 'select not pg_is_in_recovery()')  public: $(pub | head -c 160)"
  return $rc
}
run_failback() {  # orig|new label
  say "failback.sh ($1) — $2"
  docker start office-pg >/dev/null; for i in $(seq 1 30); do docker exec office-pg pg_isready -U nexus_user >/dev/null 2>&1 && break; sleep 1; done; sleep 1
  docker exec office-pg psql -U nexus_user -d nexus_db -qtc "select pg_drop_replication_slot('vps_standby') from pg_replication_slots where slot_name='vps_standby'" >/dev/null
  bash /srv/failback.$1.sh; rc=$?
  for i in $(seq 1 30); do web | grep -q '"database":"up"' && break; sleep 2; done
  echo "   rc=$rc  standby in recovery: $(pgq 'select pg_is_in_recovery()')  via nexus-web: $(web | head -c 160)"
  return $rc
}

case "${1:-all}" in
all)
  setup_office; lay_out_srv; seed_standby; legacy_up || exit 1
  # ---------------- before the migration ----------------
  run_failover orig "BEFORE migration, current script (baseline)" | tail -6; grep -q . /dev/null
  run_failback new "BEFORE migration, patched script (pre-migration path)" && ok "patched failback before migration" || bad "patched failback before migration"
  r=$(run_failover new "BEFORE migration, patched script (run early)"); echo "$r" | tail -8
  echo "$r" | grep -q "4/4 BERHASIL" && ok "patched failover BEFORE migration reaches 4/4" || bad "patched failover BEFORE migration"
  run_failback new "reset" >/dev/null 2>&1; echo "   reset: recovery=$(pgq 'select pg_is_in_recovery()')"
  # ---------------- the migration (RUNBOOK C1) ----------------
  say "C1: vps-bluegreen.sh migrate + compose swap"
  mkdir -p /srv/nexus-app/bluegreen/bin /srv/nexus-app/web/conf.d /srv/nexus-app/web/html/_archive/assets /srv/nexus-app/web/html/incoming /srv/nexus-app/bluegreen/shared /srv/nexus-app/chunk-uploads
  cp -a $T/bin/. /srv/nexus-app/bluegreen/bin/
  python3 /srv/nexus-app/bluegreen/bin/nginx-gen.py --profile vps $T/office-phaethon.conf /srv/nexus-app/web/conf.d/default.conf --raw-port 3002 --preview-port 3012
  cp -a /srv/nexus-app/dist/. /srv/nexus-app/web/html/incoming/
  /srv/nexus-app/bluegreen/bin/vps-bluegreen.sh networks
  /srv/nexus-app/bluegreen/bin/vps-bluegreen.sh migrate nexus-app:prod harness || { bad "migrate"; exit 1; }
  echo "   app-networks: $(tr '\n' ' ' < /srv/nexus-app/bluegreen/app-networks) web-network: $(cat /srv/nexus-app/bluegreen/web-network)"
  echo "   blue networks: $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' nexus-app-blue)"
  compose_test $T/scripts/compose.new.yml /srv/nexus-app/docker-compose.yml
  (cd /srv/nexus-app && docker compose --profile failover config -q) && ok "trimmed compose valid" || bad "trimmed compose invalid"
  (cd /srv/nexus-app && docker compose up -d >/dev/null 2>&1); docker inspect nexus-app-beta >/dev/null 2>&1 && bad "compose up resurrected nexus-app-beta" || ok "compose up (no profile) does not resurrect the legacy app"
  echo "   via nexus-web: $(web | head -c 160)"
  web | grep -q '"slot":"blue"' && ok "standby serves slot blue through nexus-web" || bad "standby not on blue"
  # ---------------- after the migration ----------------
  r=$(run_failover orig "AFTER migration, CURRENT script (expected to break)"); echo "$r" | tail -6
  echo "$r" | grep -q "4/4 BERHASIL" && bad "current failover unexpectedly passed after migration" || ok "current failover.sh FAILS after migration (proves the patch is required)"
  run_failback new "AFTER migration, patched (also cleans up the broken run)"; rc=$?
  [ $rc = 0 ] && web | grep -q '"slot":"blue"' && [ "$(pgq 'select pg_is_in_recovery()')" = t ] && ok "patched failback AFTER migration" || bad "patched failback AFTER migration (rc=$rc)"
  r=$(run_failover new "AFTER migration, patched script"); echo "$r" | tail -8
  echo "$r" | grep -q "4/4 BERHASIL" && ok "patched failover AFTER migration reaches 4/4" || bad "patched failover AFTER migration"
  sleep 7; echo "   leader after promotion: $(web | grep -o '"leader":[a-z]*')"
  web | grep -q '"leader":true' && ok "live slot leads after promotion" || bad "no leader after promotion"
  (cd /srv/nexus-app && docker compose --profile failover up -d >/dev/null 2>&1); docker inspect nexus-app-beta >/dev/null 2>&1 && bad "watchdog-style compose up resurrected nexus-app-beta" || ok "watchdog-style 'compose --profile failover up -d' only touches the connector"
  run_failback new "AFTER migration, patched script (second time)"; rc=$?
  [ $rc = 0 ] && web | grep -q '"leader":false' && ok "after failback the standby slot stands down (leader false)" || bad "leader state after failback (rc=$rc)"
  say "final"; docker ps --format '{{.Names}}\t{{.Status}}'
  ;;
esac
