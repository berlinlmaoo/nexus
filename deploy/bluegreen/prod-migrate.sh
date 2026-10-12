#!/usr/bin/env bash
# ONE-TIME migration of the office (nexus-prod) from the single nexus-app-beta to blue/green, without downtime on
# the public path. Tracked: deploy/bluegreen/prod-migrate.sh. Read deploy/bluegreen/RUNBOOK.md part B first.
# NOT RUN YET — every step needs the owner's go. Steps are idempotent-ish and stop at the first problem.
#
#   prod-migrate.sh preflight     checks only (changes nothing)
#   prod-migrate.sh start-blue    nexus-app-blue next to nexus-app-beta (same image, env, mounts) + web dirs + conf
#   prod-migrate.sh web-next      nexus-web-next (alias nexus-web, no ports) serving blue — cloudflared starts using it too
#   prod-migrate.sh cutover       old nexus-web drained (QUIT) -> beta stopped -> final nexus-web with ports 3000/443/3002/3012
#   prod-migrate.sh verify        public + local + LAN + slot checks
#   prod-migrate.sh undo          back to nexus-app-beta + the old nexus-web (a few seconds of blip), blue-green state removed
set -uo pipefail
[ -e /var/lib/nexus-fence/tripped ] && { echo "PAGAR AKTIF — tidak ada migrasi saat VPS melayani."; exit 1; }
REPO="$HOME/nexus"; DATA="$HOME/nexus-data"; BG="$DATA/bluegreen"; MIG="$BG/migration"
WEBROOT="$DATA/web/html"; CONFD="$DATA/web/conf.d"; CHUNKS="$DATA/chunk-uploads"
BASE="$REPO/var/uploads"; ANDROID_DIR="$DATA/android"; APNS="/etc/nexus/secrets/AuthKey_9PTCKVB26P.p8"
NET=nexus_internal; OLDWEB=nexus-web; BETA=nexus-app-beta; BLUE=nexus-app-blue
LAN_IP=192.168.223.111
red() { printf '\033[31m%s\033[0m\n' "$*"; }; green() { printf '\033[32m%s\033[0m\n' "$*"; }; say() { printf '\033[1m== %s\033[0m\n' "$*"; }
die() { red "STOP: $*"; exit 1; }
hjson() { docker exec "$1" node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>r.text()).then(console.log).catch(()=>console.log("down"))' 2>/dev/null; }

web_run() {  # name extra-args...   (the blue-green nginx shape)
  local name="$1"; shift
  docker create --name "$name" --restart unless-stopped --network "$NET" "$@" \
    -v "$CONFD:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" -v "$HOME/certs:/etc/nginx/certs:ro" \
    nginx:alpine nginx -g 'daemon off; worker_shutdown_timeout 300s;' >/dev/null && docker start "$name" >/dev/null
}
drain_quit() {  # container: graceful nginx stop (in-flight requests finish), at most 30 s
  docker kill -s QUIT "$1" >/dev/null 2>&1
  for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ] || return 0; sleep 1; done
  docker stop -t 2 "$1" >/dev/null
}
quiet_cron_second() {  # host crons fire at :00; wait for second 10..40 with no cron curl in flight
  while :; do s=$(date +%S); s=${s#0}
    [ "$s" -ge 10 ] && [ "$s" -le 40 ] && ! pgrep -f nexus-cron.sh >/dev/null && return 0; sleep 1; done
}

case "${1:-}" in
preflight)
  say "preflight (read-only)"
  ok=1
  [ "$(docker inspect -f '{{.State.Running}}' $BETA 2>/dev/null)" = true ] || { red "  $BETA not running"; ok=0; }
  h=$(curl -s -m 5 http://127.0.0.1:3002/api/health); echo "  beta health: ${h:0:160}"
  echo "$h" | grep -q '"leader":' || { red "  the running image has no blue-green support (/api/health lacks \"leader\"): deploy the app part first (RUNBOOK B0)"; ok=0; }
  [ -f "$REPO/deploy/bluegreen/bg-lib.sh" ] || { red "  ~/nexus has no deploy/bluegreen/ (merge to master first)"; ok=0; }
  [ -e "$BG/live" ] && { red "  $BG/live exists — migration already done?"; ok=0; }
  for p in 3012; do ss -ltn | grep -q ":$p " && { red "  port $p already in use"; ok=0; }; done
  docker inspect nexus-web-next nexus-app-blue >/dev/null 2>&1 && { red "  leftovers: nexus-web-next / nexus-app-blue exist"; ok=0; }
  echo "  disk: $(df -h / | tail -1)"
  [ -f "$REPO/apps/nexus-lovable-ui/dist/index.html" ] || { red "  no SPA dist to seed html/blue"; ok=0; }
  [ "$ok" = 1 ] && green "preflight OK" || die "preflight failed" ;;

start-blue)
  "$0" preflight || exit 1
  mkdir -p "$MIG" "$BG/shared" "$BG/bin" "$WEBROOT/_archive/assets" "$CONFD" "$CHUNKS"; chmod 755 "$BG/shared"
  docker inspect $BETA > "$MIG/nexus-app-beta.inspect.json"; docker inspect $OLDWEB > "$MIG/nexus-web.inspect.json"
  cp -a "$REPO/maintenance/phaethon.conf" "$MIG/phaethon.conf.at-migration"
  rsync -a --delete "$REPO/deploy/bluegreen/" "$BG/bin/"; chmod +x "$BG/bin"/*.sh "$BG/bin"/*.py
  say "html/blue = the live dist (incl. .well-known), archive seeded with its assets"
  rsync -a --delete "$REPO/apps/nexus-lovable-ui/dist/" "$WEBROOT/blue/"
  rsync -a "$REPO/apps/nexus-lovable-ui/dist/assets/" "$WEBROOT/_archive/assets/"; chmod -R a+rX "$WEBROOT"
  say "env + image of $BETA -> $BLUE"
  IMG=$(docker inspect -f '{{.Image}}' $BETA); docker tag "$IMG" nexus-app:blue
  ENVF=$(umask 077; mktemp); trap 'rm -f "$ENVF"' EXIT
  docker inspect $BETA --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|HOSTNAME|NODE_VERSION|YARN_VERSION|NEXUS_SLOT|NEXUS_CHUNK_DIR|NEXUS_BLUEGREEN_LIVE_FILE)=' > "$ENVF"
  { echo NEXUS_SLOT=blue; echo NEXUS_CHUNK_DIR=/app/data/chunks; echo NEXUS_BLUEGREEN_LIVE_FILE=/app/data/bluegreen/live; } >> "$ENVF"
  echo blue > "$BG/shared/live"     # blue competes for the singleton lock; beta (no NEXUS_SLOT) too — the lock keeps it to one
  docker run -d --name $BLUE --restart unless-stopped --label nexus.bluegreen.slot=blue \
    --label "nexus.bluegreen.commit=$(git -C "$REPO" rev-parse --short HEAD)" --label "nexus.bluegreen.released=$(date '+%F %T') (migration)" \
    --network $NET --env-file "$ENVF" --add-host=host.docker.internal:host-gateway -w /app --entrypoint node \
    -v "$BASE/avatars:/app/public/uploads/avatars" -v "$BASE/project-icons:/app/public/uploads/project-icons" \
    -v "$BASE/feed:/app/public/uploads/feed" -v "$BASE/peer-reports:/app/public/uploads/peer-reports" \
    -v "$BASE/attachments:/app/public/uploads/attachments" -v "$BASE/attendance:/app/public/uploads/attendance" \
    -v "$BASE/complaints:/app/public/uploads/complaints" -v "$BASE/chat:/app/public/uploads/chat" \
    -v "$ANDROID_DIR:/app/data/android:ro" -v "$APNS:/run/secrets/apns.p8:ro" \
    -v "$BG/shared:/app/data/bluegreen:ro" -v "$CHUNKS:/app/data/chunks" nexus-app:blue server.js >/dev/null || die "cannot start $BLUE"
  sudo chown -R 1001:65533 "$CHUNKS"
  for i in $(seq 1 45); do hjson $BLUE | grep -q '"slot":"blue"' && break; sleep 2; done
  hjson $BLUE | grep -q '"database":"up"' || die "$BLUE not healthy: $(hjson $BLUE)"
  docker exec $BLUE node -e 'fetch("http://127.0.0.1:3000/api/realtime-init").then(r=>console.log("  realtime-init "+r.status))'
  say "nginx conf for the new web"
  python3 "$BG/bin/nginx-gen.py" --profile prod "$REPO/maintenance/phaethon.conf" "$CONFD/default.conf" --raw-port 3002 --preview-port 3012 || die "nginx-gen"
  cat > "$CONFD/00-bluegreen.conf" <<NGX
# GENERATED by prod-migrate.sh — afterwards by bg-lib.sh. live=blue preview=blue
upstream nexus_app_live    { server nexus-app-blue:3000 max_fails=0; }
upstream nexus_app_preview { server nexus-app-blue:3000 max_fails=0; }
map \$host \$nexus_live_root    { default /usr/share/nginx/html/blue; }
map \$host \$nexus_preview_root { default /usr/share/nginx/html/blue; }
NGX
  docker run --rm --network $NET -v "$CONFD:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" -v "$HOME/certs:/etc/nginx/certs:ro" \
    nginx:alpine nginx -t 2>&1 | tail -1
  green "blue running next to beta (no traffic yet). Next: web-next" ;;

web-next)
  docker inspect $BLUE >/dev/null 2>&1 || die "run start-blue first"
  web_run nexus-web-next --network-alias nexus-web || die "cannot create nexus-web-next"
  sleep 2
  r=$(docker exec nexus-web-next wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null); echo "  via nexus-web-next: ${r:0:160}"
  echo "$r" | grep -q '"slot":"blue"' || { docker rm -f nexus-web-next >/dev/null; die "nexus-web-next does not serve blue — removed it"; }
  docker exec nexus-web-next wget -qO- http://127.0.0.1:3000/ | grep -q 'id="root"' || { docker rm -f nexus-web-next >/dev/null; die "SPA not served — removed"; }
  echo "  DNS 'nexus-web' on $NET now answers with: $(docker run --rm --network $NET busybox nslookup nexus-web 2>/dev/null | awk '/^Address/ && !/#53/ {print $2}' | tr '\n' ' ')"
  green "cloudflared now spreads new connections over nexus-web (beta) and nexus-web-next (blue). Next: cutover" ;;

cutover)
  docker inspect nexus-web-next >/dev/null 2>&1 || die "run web-next first"
  quiet_cron_second
  t0=$(date +%s%3N)
  say "1. drain the old nexus-web (QUIT: in-flight requests finish; new tunnel connections go to nexus-web-next)"
  drain_quit $OLDWEB; docker rename $OLDWEB nexus-web-legacy
  say "2. stop $BETA (nothing routes to it now)"
  docker stop -t 30 $BETA >/dev/null; docker rename $BETA nexus-app-legacy
  say "3. final nexus-web with the host ports (3000, LAN 443, raw 3002, preview 3012)"
  web_run $OLDWEB -p 127.0.0.1:3000:3000 -p $LAN_IP:443:443 -p 127.0.0.1:3002:3002 -p 127.0.0.1:3012:3012 \
    || { red "final nexus-web failed — run: $0 undo"; exit 1; }
  echo "  local ports back after $(( $(date +%s%3N) - t0 )) ms"
  printf '%s\n' blue > "$BG/live"
  echo "$(date '+%F %T') migration cutover: live -> blue" >> "$BG/history.log"
  echo "$(date +%s%N)-switch-blue" > "$BG/epoch"
  docker tag nexus-app:blue nexus-app:prod
  say "4. retire nexus-web-next"
  drain_quit nexus-web-next; docker rm nexus-web-next >/dev/null
  "$0" verify ;;

verify)
  echo "  public  : $(curl -s -m 15 https://nexus.znetworks.id/api/health | head -c 160)"
  echo "  local   : $(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3000/)  raw 3002: $(curl -s -m 5 http://127.0.0.1:3002/api/health | sed -n 's/.*"slot":"\([a-z]*\)".*/slot \1/p')"
  echo "  LAN 443 : $(curl -s -o /dev/null -w '%{http_code}' -m 5 --resolve lan.nexus.znetworks.id:443:$LAN_IP https://lan.nexus.znetworks.id/api/health)"
  echo "  bundle  : $(b=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$WEBROOT/blue/index.html" | head -1); curl -s -o /dev/null -w '%{http_code}' -m 10 "https://nexus.znetworks.id/$b")"
  echo "  AASA    : $(curl -s -o /dev/null -w '%{http_code} %{content_type}' -m 10 https://nexus.znetworks.id/.well-known/apple-app-site-association)"
  echo "  realtime: $(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:3002/api/realtime-init)"
  echo "  leader  : $(hjson $BLUE | sed -n 's/.*"leader":\([a-z]*\).*/\1/p')" ;;

undo)
  say "undo: back to $BETA + the old nexus-web (a few seconds of blip)"
  docker inspect nexus-web-next >/dev/null 2>&1 && docker rm -f nexus-web-next >/dev/null
  if docker inspect nexus-web-legacy >/dev/null 2>&1; then
    quiet_cron_second
    drain_quit $OLDWEB; docker rename $OLDWEB nexus-web-bg-failed 2>/dev/null
    docker rename nexus-app-legacy $BETA 2>/dev/null; docker start $BETA >/dev/null
    docker rename nexus-web-legacy $OLDWEB; docker start $OLDWEB >/dev/null
    for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:3002/api/health)" = 200 ] && break; sleep 2; done
    docker tag "$(docker inspect -f '{{.Image}}' $BETA)" nexus-app:prod
  fi
  docker stop -t 30 $BLUE >/dev/null 2>&1
  rm -f "$BG/live" "$BG/shared/live"
  echo "$(date '+%F %T') migration UNDONE" >> "$BG/history.log"
  "$0" verify; green "back on $BETA. Leftovers to inspect then remove: nexus-web-bg-failed, $BLUE" ;;
*) sed -n '2,12p' "$0"; exit 2 ;;
esac
