#!/usr/bin/env bash
# NEXUS blue-green on the warm standby. Tracked: deploy/bluegreen/vps-bluegreen.sh.
# Installed as /srv/nexus-app/bluegreen/bin/vps-bluegreen.sh ONLY after VPS migration (RUNBOOK.md, part C).
#
# Same slot layout as the office so a failover never meets a different version or a different shape:
#   nexus-app-blue / nexus-app-green  (image nexus-app:<slot>, env /srv/nexus-app/.env + slot keys)
#   nexus-web  conf.d=/srv/nexus-app/web/conf.d  html=/srv/nexus-app/web/html/{blue,green,_archive}
#   state /srv/nexus-app/bluegreen (live, epoch, shared/live mounted into the slots)
#
#   vps-bluegreen.sh follow IMAGE COMMIT  standby follows the office: start the VPS idle slot from IMAGE (loaded by
#                                         the office before its switch) + html/incoming (rsynced by the office), health
#                                         (replica, read-only) + anonymous smoke, switch the VPS nginx. Called by the
#                                         office deploy over ssh right after its own switch.
#   vps-bluegreen.sh status | rollback
#   vps-bluegreen.sh stop-all            stop both slots (failback-auto.sh, before the database swap)
#   vps-bluegreen.sh start-live          start the live slot + nexus-web (failback-auto.sh, office-fence reopen paths)
#   vps-bluegreen.sh release [semua|backend|frontend]
#                                         EMERGENCY release ON THE VPS while it is primary (office fenced): build from
#                                         /srv/nexus-src (git, branch master), compat harness, SQL gates, switch.
#                                         Refused while the VPS database is a standby.
#   vps-bluegreen.sh live-container       prints the live container name (for other scripts)
#   vps-bluegreen.sh migrate [IMAGE] [COMMIT]   one-time switch of the standby to this shape (RUNBOOK C1)
#   vps-bluegreen.sh networks             read-only: the docker networks the slots / nexus-web will use
set -uo pipefail
SELF="$(readlink -f "$0")"
APPDIR=/srv/nexus-app
PROFILE=vps
SLOT_PREFIX=nexus-app-
WEB=nexus-web
NGINX_DIR="$APPDIR/web/conf.d"
WEBROOT="$APPDIR/web/html"
BG_STATE="$APPDIR/bluegreen"
BGBIN="$BG_STATE/bin"
ENV_BASE="$APPDIR/.env"                  # written by the office's ~/vps-sync.sh (DATABASE_URL -> nexus-standby)
UPLOADS="$APPDIR/uploads"
CHUNKS="$APPDIR/chunk-uploads"
APNS="$APPDIR/secrets/apns.p8"
SRC=/srv/nexus-src
RAW_PORT=3002
PREVIEW_PORT=3012
KEEP_MINUTES="${KEEP_MINUTES:-15}"
LEGACY_C=nexus-app-beta
MODE="${1:-status}"
red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
say() { printf '\033[1m== %s\033[0m\n' "$*"; }
# shellcheck disable=SC1091
. "$BGBIN/bg-lib.sh"
bg_lock() { exec 8>"$BG_LOCK"; flock -w 60 8 || { red "switch lock busy"; exit 1; }; }
bg_unlock() { flock -u 8 2>/dev/null; exec 8>&-; }
is_primary() { [ "$(docker exec nexus-standby psql -U nexus_user -d nexus_db -tAc 'select pg_is_in_recovery()' 2>/dev/null | tr -d '[:space:]')" = f ]; }

# Docker networks — never guessed. Read from the containers that run today and recorded in $BG_STATE at the
# migration, so later calls (start-live after a failback, follow, release) keep using them after the legacy
# containers are gone. 12 Oct 2026 the VPS had: app on nexus-app_nexus_internal (nginx, cloudflared, Kuma) AND
# nexus-standby_default (DATABASE_URL host nexus-standby); nexus-web on nexus-app_nexus_internal only.
#   $BG_STATE/app-networks  one network per line, first = the one shared with nexus-web
#   $BG_STATE/web-network   the network nexus-web (and cloudflared, Kuma) sit on
nets_of() { docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$1" 2>/dev/null | sed '/^$/d'; }
detect_networks() {  # writes the two state files from the running containers; refuses when unsure
  local app="" web="" c webnet appnets
  for c in "$LEGACY_C" nexus-app-legacy "${SLOT_PREFIX}blue" "${SLOT_PREFIX}green"; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && { app="$c"; break; }; done
  for c in "$WEB" nexus-web-legacy; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && { web="$c"; break; }; done
  [ -n "$app" ] && [ -n "$web" ] || { red "detect networks: need a running app ($LEGACY_C) and nexus-web"; return 1; }
  webnet="$(nets_of "$web" | head -1)"; [ "$(nets_of "$web" | wc -l)" = 1 ] || { red "detect networks: $web is on several networks: $(nets_of "$web" | tr '\n' ' ')"; return 1; }
  appnets="$(nets_of "$app")"
  printf '%s\n' "$appnets" | grep -qx "$webnet" || { red "detect networks: $app is not on $web's network $webnet"; return 1; }
  # the database host of the app env must resolve on one of the app networks (nexus-standby)
  docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' nexus-standby 2>/dev/null \
    | grep -qxF -f <(printf '%s\n' "$appnets") || { red "detect networks: $app shares no network with nexus-standby"; return 1; }
  mkdir -p "$BG_STATE"
  { echo "$webnet"; printf '%s\n' "$appnets" | grep -vx "$webnet"; } > "$BG_STATE/app-networks"
  echo "$webnet" > "$BG_STATE/web-network"
  echo "   networks: app=$(tr '\n' ' ' < "$BG_STATE/app-networks")(from $app)  web=$webnet (from $web)"
}
app_networks() { [ -s "$BG_STATE/app-networks" ] || detect_networks >/dev/null || return 1; cat "$BG_STATE/app-networks"; }
web_network() { [ -s "$BG_STATE/web-network" ] || detect_networks >/dev/null || return 1; cat "$BG_STATE/web-network"; }

start_slot() {  # slot commit
  local slot="$1" name; name="$(bg_c "$1")"
  local envf; envf=$(umask 077; mktemp)
  grep -vE '^(NEXUS_SLOT|NEXUS_CHUNK_DIR|NEXUS_BLUEGREEN_LIVE_FILE)=' "$ENV_BASE" > "$envf"
  { echo "NEXUS_SLOT=$slot"; echo "NEXUS_CHUNK_DIR=/app/data/chunks"; echo "NEXUS_BLUEGREEN_LIVE_FILE=/app/data/bluegreen/live"; } >> "$envf"
  mkdir -p "$CHUNKS"; docker rm -f "$name" >/dev/null 2>&1
  local m=() nets n rc
  nets="$(app_networks)" || { rm -f "$envf"; return 1; }
  for d in avatars project-icons feed peer-reports attachments attendance complaints chat; do m+=(-v "$UPLOADS/$d:/app/public/uploads/$d"); done
  # create on the network shared with nexus-web, attach the others (database), then start
  docker create --name "$name" --restart unless-stopped --label "nexus.bluegreen.slot=$slot" --label "nexus.bluegreen.commit=$2" \
    --label "nexus.bluegreen.released=$(date '+%F %T')" --network "$(echo "$nets" | head -1)" --env-file "$envf" -w /app --entrypoint node \
    "${m[@]}" -v "$APNS:/run/secrets/apns.p8:ro" -v "$BG_STATE/shared:/app/data/bluegreen:ro" -v "$CHUNKS:/app/data/chunks" \
    "nexus-app:$slot" server.js >/dev/null; rc=$?
  rm -f "$envf"; [ $rc = 0 ] || return $rc
  for n in $(echo "$nets" | tail -n +2); do docker network connect "$n" "$name" || return 1; done
  docker start "$name" >/dev/null
}

# nexus-web on the VPS, blue-green shape (RUNBOOK part C). Ports: 3000 for cloudflared (by name) and the
# status checks (/srv/nexus-cron.sh posts to 127.0.0.1:3000 — checked 12 Oct 2026; Kuma reaches nexus-web:3000 by
# name), 3002 raw -> live slot, 3012 preview -> idle slot. The compose nexus-web published only 127.0.0.1:3000.
create_web() {
  local net; net="$(web_network)" || return 1
  docker rm -f "$WEB" >/dev/null 2>&1
  docker create --name "$WEB" --restart unless-stopped --network "$net" \
    -p 127.0.0.1:3000:3000 -p "127.0.0.1:$RAW_PORT:$RAW_PORT" -p "127.0.0.1:$PREVIEW_PORT:$PREVIEW_PORT" \
    -v "$NGINX_DIR:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" \
    nginx:alpine nginx -g 'daemon off; worker_shutdown_timeout 300s;' >/dev/null && docker start "$WEB" >/dev/null
}

smoke_anon() {  # slot
  docker run --rm --network host -v "$BGBIN/smoke.mjs:/smoke.mjs:ro" -e BASE="http://127.0.0.1:$PREVIEW_PORT" \
    -e EXPECT_SLOT="$1" -e SMOKE_ANON=1 node:22-alpine node /smoke.mjs
}

case "$MODE" in
  status) bg_status ;;
  live-container) l="$(bg_live)"; [ -n "$l" ] && bg_c "$l" || echo "$LEGACY_C" ;;
  rollback) bg_lock; bg_rollback; rc=$?; bg_unlock; exit $rc ;;
  finish) bg_lock; bg_finish "${2:?}" "${3:?}"; rc=$?; bg_unlock; exit $rc ;;
  stop-all) for s in blue green; do bg_running "$s" && docker stop -t 30 "$(bg_c "$s")" >/dev/null; done; echo "slots stopped" ;;
  start-live) # after failback the standby DB was re-seeded and its network may be new: recreate when a plain start fails
              l="$(bg_live)"; [ -n "$l" ] || { red "no live slot recorded"; exit 1; }
              if ! { docker start "$(bg_c "$l")" >/dev/null 2>&1 && bg_wait_healthy "$l" 20; }; then
                start_slot "$l" "$(docker inspect -f '{{index .Config.Labels "nexus.bluegreen.commit"}}' "$(bg_c "$l")" 2>/dev/null || echo '?')" && bg_wait_healthy "$l" 45 || exit 1
              fi
              bg_write_upstreams_file_only "$l" "$l"
              { docker start "$WEB" >/dev/null 2>&1 && docker exec "$WEB" nginx -s reload >/dev/null 2>&1; } || create_web ;;
  create-web) bg_init_state; create_web ;;
  networks) # read-only: show what detect_networks finds (does not write state when it already exists)
            if [ -s "$BG_STATE/app-networks" ]; then echo "recorded: app=$(tr '\n' ' ' < "$BG_STATE/app-networks") web=$(cat "$BG_STATE/web-network")"
            else BG_STATE="$(mktemp -d)"; detect_networks; rc=$?; rm -rf "$BG_STATE"; exit $rc; fi ;;
  migrate) # ONE-TIME (RUNBOOK C1): legacy nexus-app-beta + compose nexus-web -> nexus-app-blue + blue-green nexus-web.
           # Standby only (refused while primary); the standby health checks blip for a few seconds.
           is_primary && { red "refused: VPS is primary"; exit 1; }
           [ -e "$BG_STATE/live" ] && { red "already migrated"; exit 1; }
           bg_init_state
           detect_networks || exit 1     # from the running nexus-app-beta / nexus-web, BEFORE they are renamed
           [ -f "$WEBROOT/incoming/index.html" ] || { red "seed $WEBROOT/incoming first"; exit 1; }
           docker tag "${2:-nexus-app:prod}" nexus-app:blue && bg_spa_install blue "$WEBROOT/incoming" || exit 1
           echo blue > "$BG_STATE/shared/live"
           start_slot blue "${3:-migration}" && bg_wait_healthy blue 45 || { red "blue unhealthy — nothing else changed"; docker rm -f nexus-app-blue; exit 1; }
           bg_write_upstreams_file_only blue blue; echo blue > "$BG_STATE/live"
           docker stop -t 30 nexus-web nexus-app-beta >/dev/null 2>&1
           docker rename nexus-web nexus-web-legacy 2>/dev/null; docker rename nexus-app-beta nexus-app-legacy 2>/dev/null
           create_web || { red "create_web failed — undo: docker rm -f nexus-web; rename the -legacy containers back; compose up -d"; exit 1; }
           sleep 2; curl -s -m 5 http://127.0.0.1:3000/api/health; echo
           bg_log "migration: live -> blue"; green "VPS on blue-green (live blue)" ;;
  follow)
    # IMAGE = office image id/tag already loaded here (staged by the office before its switch);
    # the office SPA is staged in $WEBROOT/incoming/. The VPS uses its OWN idle slot (names may differ
    # from the office; the version is what must match).
    img="${2:?image}"; commit="${3:-?}"
    exec 9>/tmp/nexus-vps-follow.lock; flock -w 600 9 || { red "another follow is running"; exit 1; }
    bg_init_state
    docker image inspect "$img" >/dev/null 2>&1 || { red "$img not loaded — the office stages it first"; exit 1; }
    [ -f "$WEBROOT/incoming/index.html" ] || { red "html/incoming missing — the office stages it first"; exit 1; }
    if is_primary; then red "VPS database is PRIMARY (failover): the office must not drive the VPS — release on the VPS instead"; exit 1; fi
    live="$(bg_live)"
    if [ -n "$live" ] && [ "$(docker inspect -f '{{.Image}}' "$(bg_c "$live")" 2>/dev/null)" = "$(docker image inspect -f '{{.Id}}' "$img")" ]; then
      echo "standby already runs $commit on $live"; exit 0; fi
    slot="$(bg_other "${live:-green}")"
    bg_lock; bg_new_epoch "claim-$slot" >/dev/null; bg_unlock
    docker tag "$img" "nexus-app:$slot"
    bg_spa_install "$slot" "$WEBROOT/incoming" || { red "html install failed"; exit 1; }
    say "standby: start $(bg_c "$slot") ($commit) next to ${live:-<none>}"
    start_slot "$slot" "$commit" || { red "cannot start"; exit 1; }
    bg_wait_healthy "$slot" 45 || { docker logs --tail 20 "$(bg_c "$slot")"; docker stop "$(bg_c "$slot")" >/dev/null; red "standby slot unhealthy — VPS stays on ${live:-?}"; exit 1; }
    bg_write_upstreams "${live:-$slot}" "$slot" && bg_reload
    smoke_anon "$slot" || { docker stop "$(bg_c "$slot")" >/dev/null; red "standby smoke failed"; exit 1; }
    bg_lock; bg_switch "$slot" "follow office $commit" "${live:-legacy}"; e="$BG_EPOCH"; bg_unlock
    docker tag "nexus-app:$slot" nexus-app:prod
    echo "$commit $(docker image inspect -f '{{.Id}}' "$img") $(date '+%F %T')" > "$BG_STATE/release"
    [ -n "$live" ] && bg_schedule_finish "$e" "$live"
    bg_archive_prune
    green "standby follows the office: $slot $commit" ;;
  release)
    is_primary || { red "refused: the VPS database is a standby — releases happen at the office"; exit 1; }
    part="${2:-semua}"
    [ -d "$SRC/.git" ] || { red "$SRC missing (RUNBOOK part D: git bundle shipped nightly by vps-sync)"; exit 1; }
    exec 9>/tmp/nexus-vps-release.lock; flock -n 9 || { red "release already running"; exit 1; }
    cd "$SRC" && git pull --ff-only 2>/dev/null; git log --oneline -1; commit=$(git rev-parse --short HEAD)
    live="$(bg_live)"; idle="$(bg_other "${live:-green}")"
    bg_init_state; mkdir -p "$BGBIN"; rsync -a "$SRC/deploy/bluegreen/" "$BGBIN/"
    bg_lock; bg_new_epoch "claim-$idle" >/dev/null; bg_unlock
    if [ "$part" != frontend ]; then
      nice docker build -f Dockerfile.prod -t nexus-app:candidate . || { red "build failed"; exit 1; }
      COMPAT_LIVE_CONTAINER="$(bg_c "$live")" bash scripts/compat/run.sh nexus-app:candidate || { red "compat FAILED"; exit 1; }
      docker tag nexus-app:candidate "nexus-app:$idle"
    else
      docker tag "$(docker inspect -f '{{.Image}}' "$(bg_c "$live")")" "nexus-app:$idle"
    fi
    if [ "$part" != backend ]; then
      APP="$SRC/apps/web"   # renamed 14 Oct 2026; an older checkout: the apps/* folder that holds vite.config.ts
      [ -f "$APP/vite.config.ts" ] || APP="$(dirname "$(ls -d "$SRC"/apps/*/vite.config.ts 2>/dev/null | head -1)")"
      [ -f "$APP/vite.config.ts" ] || { red "SPA folder not found under $SRC/apps"; exit 1; }
      docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$APP":/app -w /app node:22-alpine sh -c 'npm ci --no-audit --no-fund --loglevel=error && ./node_modules/.bin/vite build --outDir dist-bg --emptyOutDir' | tail -2
      [ -f "$APP/dist-bg/index.html" ] || { red "SPA build failed"; exit 1; }
      [ -d "$APP/dist-bg/.well-known" ] && rm -r "${APP:?}/dist-bg/.well-known"
      [ -d "$WEBROOT/$live/.well-known" ] && cp -a "$WEBROOT/$live/.well-known" "$APP/dist-bg/"
      bg_spa_install "$idle" "$APP/dist-bg" && rm -r "${APP:?}/dist-bg"
    else
      bg_spa_install "$idle" "$WEBROOT/$live"
    fi
    NEXUS_SQL_DIR="$SRC/prisma/sql" "$BGBIN/nexus-sql.sh" vps pending || { red "pending SQL"; exit 1; }
    "$BGBIN/nexus-sql.sh" vps check "nexus-app:$idle" new || { red "schema not satisfied"; exit 1; }
    start_slot "$idle" "$commit" && bg_wait_healthy "$idle" 45 || { red "unhealthy — not switched"; docker stop "$(bg_c "$idle")"; exit 1; }
    bg_write_upstreams "$live" "$idle" && bg_reload
    smoke_anon "$idle" || { red "smoke failed — not switched"; docker stop "$(bg_c "$idle")"; exit 1; }
    bg_lock; bg_switch "$idle" "VPS release $commit" "$live"; e="$BG_EPOCH"; bg_unlock
    docker tag "nexus-app:$idle" nexus-app:prod
    echo "$commit $(date '+%F %T') (released on VPS during failover)" > "$BG_STATE/release"
    bg_schedule_finish "$e" "$live"
    green "VPS release $commit live on $idle — after failback the office must deploy this same commit first (RUNBOOK part D)" ;;
  *) sed -n '2,25p' "$SELF"; exit 2 ;;
esac
