#!/usr/bin/env bash
# Tracked copy (deploy/dev/deploy-nexus-dev.sh). Installed as ~/deploy-nexus-dev.sh on nexus-prod — keep both in sync.
# Deploy NEXUS **DEV** (branch `dev`, worktree ~/nexus-dev) BLUE-GREEN. Never touches production.
#
#   ~/deploy-nexus-dev.sh [all]      -> new image + new SPA into the idle slot, gates, switch
#   ~/deploy-nexus-dev.sh backend    -> new image; SPA carried over from the live slot
#   ~/deploy-nexus-dev.sh frontend   -> new SPA; image carried over from the live slot
#   ~/deploy-nexus-dev.sh env        -> same image + SPA, rebuilt env (also: `gideon`) — env change without downtime
#   ~/deploy-nexus-dev.sh web        -> regenerate nginx conf / container + tailscale serve only
#   ~/deploy-nexus-dev.sh rollback   -> flip nginx back to the previous slot (instant while it still runs)
#   ~/deploy-nexus-dev.sh status     -> slots, versions, leader, last switches
#   ~/deploy-nexus-dev.sh sql …      -> deploy/bluegreen/nexus-sql.sh dev … (status | apply FILE | record FILE --yes)
#
# Release modes take the dev deploy lock themselves (/tmp/nexus-dev-deploy.lock; the documented
# `flock /tmp/nexus-dev-deploy.lock ~/deploy-nexus-dev.sh all` still works). rollback/status never wait for it.
#
# How a release goes (deploy/bluegreen/README.md):
#   build image (+ compat harness) and SPA -> SQL gates (ledger + schema of the new AND the live version)
#   -> start the IDLE slot (nexus-dev-app-blue|green) next to the live one, same DB -> health from inside
#   -> smoke test through nginx's PREVIEW listener (127.0.0.1:3103: SPA, /login, health, QA login, reads,
#      realtime) -> switch nginx upstream + html root in one graceful reload -> SIGUSR2 to the old slot
#   (drops its realtime sockets, releases the singleton lock) -> old slot kept KEEP_MINUTES (default 10)
#   for `rollback`, then stopped. A failed gate leaves the live slot untouched.
#
# Dev URL (tailnet only):  https://nexus-prod.tail765d02.ts.net:8443
# Dev DB copy refresh:     ~/nexus-dev-refresh-db.sh
#
# Everything here is named nexus-dev-* / nexus_dev_* and the image repo is `nexus-dev-app`, which
# deploy-nexus.sh's image cleanup (^nexus-app:) never matches. Production containers, images, the
# prod checkout ~/nexus, its uploads and its env are only ever READ (env names + safe values).
#
# Outbound isolation, two layers:
#  1. The app sits ONLY on docker network nexus_dev_internal (--internal: no route out of the VM).
#     It cannot reach Apple/Google/SMTP/WhatsApp/Telegram/GIDEON/NAS/Cloudflare even if a key leaked in.
#  2. The env is an ALLOWLIST of non-secret behaviour keys copied from prod + dev overrides.
#     Push/email/WA/Google/NAS/GIDEON/SSO/cron secrets are never copied (see ALLOW_KEYS below).
set -uo pipefail

SELF="$(readlink -f "$0")"
REPO="$HOME/nexus-dev"
BRANCH=dev
DATA="$HOME/nexus-dev-data"
UPLOADS="$DATA/uploads"
DIST="$DATA/dist"                          # pre-blue-green SPA dir (bootstrap source only)
NGINX_DIR="$DATA/nginx"
ENVF="$DATA/app.env"
SECRETS="$DATA/dev-secrets.env"
ANDROID_DIR="$HOME/nexus-data/android"     # prod's sideload dir, mounted READ-ONLY (only for /api/app/android parity)

PROFILE=dev
SLOT_PREFIX=nexus-dev-app-                 # nexus-dev-app-blue / nexus-dev-app-green
LEGACY_C=nexus-dev-app                     # the single pre-blue-green container (bootstrap only)
C="$LEGACY_C"                              # name used by the env helpers' messages
IMG_REPO=nexus-dev-app
WEB=nexus-dev-web
PG=nexus-dev-postgres
NET_INT=nexus_dev_internal
NET_EDGE=nexus_dev_edge
DEV_HOST=nexus-prod.tail765d02.ts.net
DEV_PORT=8443
DEV_URL="https://$DEV_HOST:$DEV_PORT"
# read-only: env keys are copied from the running prod app. Prod moved to blue-green on 12 Oct
# (nexus-app-blue/green, no more nexus-app-beta): take whichever of them is running.
PROD_C=nexus-app-beta
for c in nexus-app-beta nexus-app-blue nexus-app-green; do
  if [ "$(docker inspect -f "{{.State.Running}}" "$c" 2>/dev/null)" = true ]; then PROD_C=$c; break; fi
done
WEBROOT="$DATA/web"                        # blue/ green/ _archive/ (mounted at /usr/share/nginx/html)
BG_STATE="$DATA/bluegreen"
BGBIN="$BG_STATE/bin"                      # tooling copied from the deployed commit (rollback never needs the repo)
CHUNKS="$DATA/chunks"                      # chunked-upload parts shared by both slots
KEEP_MINUTES="${KEEP_MINUTES:-10}"
RAW_PORT=3102
PREVIEW_PORT=3103
QA_EMAIL="qa@dev.invalid"
QA_PW_FILE="$DATA/qa-password"             # 0600, copied from the host's /root/.secrets (never printed)
DEPLOY_LOCK=/tmp/nexus-dev-deploy.lock
BAGIAN="${1:-all}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
say()   { printf '\033[1m== %s\033[0m\n' "$*"; }

# ---- guards: never operate on a production name ----
for n in "$LEGACY_C" "${SLOT_PREFIX}blue" "${SLOT_PREFIX}green" "$WEB" "$PG" "$IMG_REPO:blue"; do
  case "$n" in nexus-app-beta|nexus-app-blue|nexus-app-green|nexus-web|nexus-postgres|nexus-face|nexus-znet-cloudflared|nexus-app:*) red "guard: $n is a production name"; exit 1;; esac
done

# The documented call is `flock /tmp/nexus-dev-deploy.lock ~/deploy-nexus-dev.sh all`. If no ancestor holds
# that lock, take it here (blocking) instead of racing another stream's deploy.
ensure_deploy_lock() {
  [ -n "${NEXUS_DEV_DEPLOY_LOCKED:-}" ] && return 0
  local p=$PPID
  while [ "${p:-1}" -gt 1 ]; do
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "flock.*$DEPLOY_LOCK" && return 0
    p=$(sed -E 's/^[0-9]+ \(.*\) [A-Z] ([0-9]+) .*/\1/' "/proc/$p/stat" 2>/dev/null || echo 1)
  done
  echo "   waiting for the dev deploy lock ($DEPLOY_LOCK)…"
  exec env NEXUS_DEV_DEPLOY_LOCKED=1 flock "$DEPLOY_LOCK" "$SELF" "$@"
}

bg_lock() { exec 8>"$BG_LOCK"; flock -w 60 8 || { red "switch lock busy ($BG_LOCK)"; exit 1; }; }
bg_unlock() { flock -u 8 2>/dev/null; exec 8>&-; }

load_lib() {
  [ -f "$BGBIN/bg-lib.sh" ] || { red "blue-green tooling missing ($BGBIN) — run a release first"; exit 1; }
  # shellcheck disable=SC1091
  . "$BGBIN/bg-lib.sh"
}

# ---------------------------------------------------------------- quick commands (no deploy lock)
case "$BAGIAN" in
  status)   load_lib; bg_status; exit 0 ;;
  rollback) load_lib; say "rollback"; bg_lock; bg_rollback; rc=$?; bg_unlock; exit $rc ;;
  finish)   load_lib; bg_lock; bg_finish "${2:?epoch}" "${3:?slot}"; rc=$?; bg_unlock; exit $rc ;;
  sql)      shift; exec "$BGBIN/nexus-sql.sh" dev "$@" ;;
  all|backend|frontend|env|gideon|web) ensure_deploy_lock "$@" ;;
  *) sed -n '3,14p' "$SELF"; exit 2 ;;
esac
[ "$BAGIAN" = gideon ] && BAGIAN=env

[ -e /var/lib/nexus-fence/tripped ] && echo "NOTE: failover fence is tripped (prod served by VPS). Dev deploy continues; it does not touch prod."

cd "$REPO" || { red "worktree not found: $REPO"; exit 1; }
[ "$(git branch --show-current)" = "$BRANCH" ] || { red "worktree $REPO is not on branch $BRANCH"; exit 1; }

say "code (branch $BRANCH)"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git pull --ff-only || { red "git pull failed (local changes?)"; exit 1; }
else
  echo "   no upstream for $BRANCH — using the local branch as is"
fi
git log --oneline -1
COMMIT=$(git rev-parse --short HEAD)

mkdir -p "$DATA" "$UPLOADS" "$NGINX_DIR" "$BG_STATE" "$CHUNKS"; chmod 700 "$DATA"
# Tooling from the commit being deployed; rollback/finish later use this copy, not the (moving) repo.
[ -f "$REPO/deploy/bluegreen/bg-lib.sh" ] || { red "deploy/bluegreen/ missing in $REPO"; exit 1; }
mkdir -p "$BGBIN" && rsync -a --delete "$REPO/deploy/bluegreen/" "$BGBIN/" && chmod +x "$BGBIN"/*.sh "$BGBIN"/*.py
load_lib
bg_init_state

# ---------------------------------------------------------------- env
# Non-secret behaviour keys copied from the live prod container so dev runs under prod's rules.
# Anything not listed here is NOT copied. New prod keys are reported (names only) so they can be
# classified; add a key here only if it cannot reach another system or person.
ALLOW_KEYS="ABSENCE_DEDUCTION_START_DATE APP_NAME APP_TIMEZONE ATTENDANCE_OUTAGE_DATES ATTENDANCE_SILENT_CORRECTION_ADMINS
 ATTENDANCE_PENALTY_LOOKBACK_DAYS ATTENDANCE_ESCALATION_BUSINESS_DAYS DB_CONNECT_TIMEOUT DB_IDLE_TIMEOUT DB_POOL_MAX LOG_LEVEL
 NEXT_TELEMETRY_DISABLED NODE_ENV PORT PEER_REPORT_XP_DISABLED NEXUS_ORG_WORKSPACE_ID NEXUS_ATTENDANCE_SHEET_WORKSPACE
 NEXUS_IOS_MIN_VERSION NEXUS_IOS_LATEST_VERSION NEXUS_ANDROID_MIN_VERSION NEXUS_ANDROID_LATEST_VERSION
 NEXUS_ANDROID_LATEST_RELEASED_AT NEXUS_ANDROID_STORE_URL NEXUS_ANDROID_CERT_SHA256"
# Deliberately dropped (documented, so "unclassified" stays meaningful):
DROPPED_RE='^(APNS_|NEXUS_FCM_|SMTP_|WA_|HERMES_|NEXUS_WA_|GOOGLE_|FINANCE_|NAS_|GIDEON_|ORACLE_|NEXUS_GIDEON_|NEXUS_SSO_|STATUS_SSO_|CF_TUNNEL_|CRON_SECRET|SLACK_|SENTRY_|BUFFER_|REDIS_URL|POSTGRES_|DATABASE_URL|AUTH_SECRET|AUTH_TRUST_HOST|NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|NEXUS_PUBLIC_URL|BACKUP_DIR|NEXUS_DATA_DIR|APP_PORT|PATH|HOSTNAME|NODE_VERSION|YARN_VERSION)'

# ---------------------------------------------------------------- DEV GIDEON (12 Oct 2026)
# The ONE outbound path the dev app has: GIDEON. The app stays on the internal-only network; a tiny nginx
# relay ($GRELAY) sits on both nexus_dev_internal and nexus_dev_edge and forwards exactly three paths
# (GET /health, POST /chat, POST /chat-stream) to the DEV shim on the agents VM (192.168.223.116:8766,
# gideon-dev-shim.service, Hermes profile gideon-dev). That shim's firewall admits only this VM, its
# plugin calls back into THIS dev server (Tailscale :8443) with a dev-only token, and it has no
# attendance tools. Prod GIDEON (agents :8765, prod token) is never named here.
# Keys come from $GIDEON_ENVF (GIDEON_CHAT_URL, GIDEON_STREAM_URL, ORACLE_LLM_SECRET, NEXUS_GIDEON_SERVICE_TOKEN).
# OFF switch: touch "$DATA/gideon-dev.off" && ~/deploy-nexus-dev.sh gideon   (or just: docker stop nexus-dev-gideon-relay)
GRELAY=nexus-dev-gideon-relay
GIDEON_ENVF="$DATA/gideon-dev.env"
GIDEON_UPSTREAM="192.168.223.116:8766"
gideon_on() { [ -f "$GIDEON_ENVF" ] && [ ! -e "$DATA/gideon-dev.off" ]; }

gideon_env() {  # $1 = env file being built
  gideon_on || { echo "   dev GIDEON: off"; return 0; }
  local k v prodv
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue;; esac
    k="${line%%=*}"; v="${line#*=}"
    case "$k" in
      GIDEON_CHAT_URL|GIDEON_STREAM_URL)
        case "$v" in "http://$GRELAY:8766/"*) ;; *) red "guard: $k must point at the dev relay"; return 1;; esac ;;
      ORACLE_LLM_SECRET|NEXUS_GIDEON_SERVICE_TOKEN)
        prodv="$(docker inspect "$PROD_C" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -m1 "^$k=" | cut -d= -f2-)"
        [ -n "$v" ] && [ "$v" != "$prodv" ] || { red "guard: $k is empty or equals PROD's value"; return 1; } ;;
      NEXUS_GIDEON_NO_ATTENDANCE) [ "$v" = 1 ] || { red "guard: NEXUS_GIDEON_NO_ATTENDANCE must be 1"; return 1; } ;;
      *) red "guard: unexpected key in $GIDEON_ENVF: $k"; return 1 ;;
    esac
    printf '%s\n' "$line" >> "$1"
  done < "$GIDEON_ENVF"
  echo "   dev GIDEON: on (relay $GRELAY -> $GIDEON_UPSTREAM)"
}

ensure_gideon_relay() {
  if ! gideon_on; then docker rm -f "$GRELAY" >/dev/null 2>&1 && echo "   removed $GRELAY (dev GIDEON off)"; return 0; fi
  local dir="$DATA/gideon-relay"; mkdir -p "$dir"
  cat > "$dir/default.conf.new" <<NGX
# GENERATED by ~/deploy-nexus-dev.sh — the dev app's only way out: three paths, one fixed upstream.
server {
    listen 8766;
    client_max_body_size 16m;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    location = /health { limit_except GET { deny all; } proxy_pass http://$GIDEON_UPSTREAM; }
    location = /chat { limit_except POST { deny all; } proxy_pass http://$GIDEON_UPSTREAM; proxy_read_timeout 450s; }
    location = /chat-stream { limit_except POST { deny all; } proxy_pass http://$GIDEON_UPSTREAM; proxy_buffering off; proxy_read_timeout 450s; }
    location / { return 404; }
}
NGX
  local changed=0
  cmp -s "$dir/default.conf.new" "$dir/default.conf" || { mv -f "$dir/default.conf.new" "$dir/default.conf"; changed=1; }
  rm -f "$dir/default.conf.new"
  if ! docker inspect "$GRELAY" >/dev/null 2>&1; then
    docker create --name "$GRELAY" --restart unless-stopped --label nexus-dev=1 \
      --network "$NET_EDGE" --memory 64m --cpus 0.5 --read-only --tmpfs /var/cache/nginx --tmpfs /var/run --tmpfs /tmp \
      -v "$dir:/etc/nginx/conf.d:ro" nginx:alpine >/dev/null || { red "cannot create $GRELAY"; return 1; }
    docker network connect "$NET_INT" "$GRELAY"
    docker start "$GRELAY" >/dev/null && echo "   created $GRELAY"
  else
    docker start "$GRELAY" >/dev/null 2>&1
    [ "$changed" = 1 ] && docker exec "$GRELAY" nginx -s reload
  fi
  printf '   relay /health -> %s\n' "$(docker exec "$GRELAY" wget -qO- -T 4 http://127.0.0.1:8766/health 2>/dev/null || echo FAIL)"
}

build_env() {
  if [ ! -f "$SECRETS" ]; then
    ( umask 077; {
      echo "AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
      echo "DEV_DB_PASSWORD=$(cat "$DATA/db-password.txt")"
    } > "$SECRETS" )
  fi
  # shellcheck disable=SC1090
  . "$SECRETS"
  local live; live="$(docker inspect "$PROD_C" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)"
  [ -n "$live" ] || { red "cannot read env of $PROD_C"; return 1; }
  local tmp; tmp=$(umask 077; mktemp "$DATA/.env.XXXX")
  for k in $ALLOW_KEYS; do printf '%s\n' "$live" | grep -m1 "^$k=" >> "$tmp"; done
  local unknown
  unknown=$(printf '%s\n' "$live" | cut -d= -f1 | grep -vE "$DROPPED_RE" | grep -vxE "$(echo $ALLOW_KEYS | tr ' ' '|')" | tr '\n' ' ')
  unset live
  [ -n "${unknown// /}" ] && echo "   NOTE prod env keys not classified (NOT copied to dev): $unknown"
  cat >> "$tmp" <<ENV
NEXUS_ENV=dev
DATABASE_URL=postgresql://nexus_dev:${DEV_DB_PASSWORD}@${PG}:5432/nexus_dev?schema=public
AUTH_SECRET=${AUTH_SECRET}
NEXTAUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
NEXTAUTH_URL=${DEV_URL}
NEXT_PUBLIC_APP_URL=${DEV_URL}
NEXUS_PUBLIC_URL=${DEV_URL}
MCP_OAUTH_ISSUER=${DEV_URL}
PASSKEY_RP_ID=${DEV_HOST}
PASSKEY_ORIGIN=${DEV_URL}
NEXUS_ANDROID_APK_DIR=/app/data/android
WA_DELIVERY_DISABLED=1
WA_WEBHOOK_URL=http://wa-disabled.invalid/send
HERMES_WA_BRIDGE_URL=http://wa-disabled.invalid/send
NAS_HOST=nas-disabled.invalid
NEXUS_FACE_URL=http://face-disabled.invalid
ENV
  # Belt and braces: nothing outward may be set to a real value.
  if grep -E '^(APNS_|NEXUS_FCM_|SMTP_|GOOGLE_|GIDEON_|ORACLE_|NEXUS_GIDEON_|NEXUS_SSO_|STATUS_SSO_|CF_TUNNEL_|CRON_SECRET|SLACK_|SENTRY_|BUFFER_|NAS_(USERNAME|PASSWORD)|FINANCE_)' "$tmp" >/dev/null; then
    red "guard: an outward key ended up in the dev env — aborting"; rm -f "$tmp"; return 1
  fi
  gideon_env "$tmp" || { rm -f "$tmp"; return 1; }
  chmod 600 "$tmp"; mv -f "$tmp" "$ENVF"
  echo "   env: $(wc -l < "$ENVF") keys -> $ENVF"
}

ensure_base() {
  docker network inspect "$NET_INT" >/dev/null 2>&1 || docker network create --internal --label nexus-dev=1 "$NET_INT" >/dev/null
  docker network inspect "$NET_EDGE" >/dev/null 2>&1 || docker network create --label nexus-dev=1 "$NET_EDGE" >/dev/null
  if ! docker inspect "$PG" >/dev/null 2>&1; then
    echo "   creating $PG (empty) — afterwards run ~/nexus-dev-refresh-db.sh to copy prod in"
    [ -f "$DATA/db-password.txt" ] || ( umask 077; openssl rand -hex 24 | tr -d '\n' > "$DATA/db-password.txt" )
    docker run -d --name "$PG" --restart unless-stopped --label nexus-dev=1 \
      --network "$NET_INT" --memory 1g --memory-swap 1g --cpus 2 \
      -e POSTGRES_USER=nexus_dev -e POSTGRES_PASSWORD="$(cat "$DATA/db-password.txt")" -e POSTGRES_DB=nexus_dev \
      -v nexus_dev_pgdata:/var/lib/postgresql/data postgres:16-alpine \
      -c shared_buffers=128MB -c max_connections=60 >/dev/null || { red "cannot create $PG"; exit 1; }
    sleep 5
  fi
  [ "$(docker inspect -f '{{.State.Running}}' "$PG" 2>/dev/null)" = "true" ] || docker start "$PG" >/dev/null || { red "cannot start $PG"; exit 1; }
}

# ---------------------------------------------------------------- nginx (generated conf + container)
gen_nginx_conf() {
  python3 "$BGBIN/nginx-gen.py" --profile dev "$REPO/maintenance/phaethon.conf" "$NGINX_DIR/default.conf.new" \
    --dev-host "$DEV_HOST" --dev-port "$DEV_PORT" --raw-port "$RAW_PORT" --preview-port "$PREVIEW_PORT" \
    || { red "nginx conf generation failed"; return 1; }
  rm -f "$NGINX_DIR/default.conf.bak"
  [ -f "$NGINX_DIR/default.conf" ] && cp -f "$NGINX_DIR/default.conf" "$NGINX_DIR/default.conf.bak"
  CONF_CHANGED=0
  cmp -s "$NGINX_DIR/default.conf.new" "$NGINX_DIR/default.conf" || { mv -f "$NGINX_DIR/default.conf.new" "$NGINX_DIR/default.conf"; CONF_CHANGED=1; }
  rm -f "$NGINX_DIR/default.conf.new"
}

# The web container must mount conf.d + the versioned html root and publish the preview port; a container
# from before blue-green (dist mount, no 3103) is recreated once (dev only; a ~1 s blip).
web_ok() {
  docker inspect "$WEB" >/dev/null 2>&1 || return 1
  docker inspect -f '{{json .HostConfig.Binds}}' "$WEB" | grep -q "$WEBROOT:/usr/share/nginx/html" || return 1
  docker inspect -f '{{json .HostConfig.PortBindings}}' "$WEB" | grep -q "\"$PREVIEW_PORT/tcp\"" || return 1
}

ensure_web() {  # $1 = live slot name for the upstream file when it does not exist yet
  gen_nginx_conf || return 1
  [ -f "$NGINX_DIR/00-bluegreen.conf" ] || bg_write_upstreams_file_only "$1" "$1"
  if ! web_ok; then
    say "(re)create $WEB with the blue-green mounts"
    # Validate the conf on a throwaway nginx on the same networks first: a broken conf must not cost the site.
    docker run --rm --network "$NET_INT" -v "$NGINX_DIR:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" \
      nginx:alpine nginx -t >/dev/null 2>&1 || { red "generated conf does not pass nginx -t:"; docker run --rm --network "$NET_INT" -v "$NGINX_DIR:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" nginx:alpine nginx -t 2>&1 | tail -3; return 1; }
    docker rm -f "$WEB" >/dev/null 2>&1
    docker create --name "$WEB" --restart unless-stopped --label nexus-dev=1 \
      --network "$NET_EDGE" -p 127.0.0.1:8080:3000 -p "127.0.0.1:$RAW_PORT:$RAW_PORT" -p "127.0.0.1:$PREVIEW_PORT:$PREVIEW_PORT" \
      --memory 256m --cpus 1 \
      -v "$NGINX_DIR:/etc/nginx/conf.d:ro" -v "$WEBROOT:/usr/share/nginx/html:ro" \
      nginx:alpine nginx -g 'daemon off; worker_shutdown_timeout 300s;' >/dev/null || return 1
    docker network connect "$NET_INT" "$WEB"
    docker start "$WEB" >/dev/null || return 1
    echo "   $WEB created"
  elif [ "${CONF_CHANGED:-0}" = 1 ] || [ "$(docker inspect -f '{{.State.Running}}' "$WEB")" != "true" ]; then
    docker start "$WEB" >/dev/null 2>&1
    if ! docker exec "$WEB" nginx -t >/dev/null 2>&1; then
      red "nginx -t failed:"; docker exec "$WEB" nginx -t 2>&1 | tail -3
      [ -f "$NGINX_DIR/default.conf.bak" ] && mv -f "$NGINX_DIR/default.conf.bak" "$NGINX_DIR/default.conf"
      return 1
    fi
    bg_reload
  fi
  echo "   nginx conf changed: ${CONF_CHANGED:-0}"
}

# ---------------------------------------------------------------- slots
start_slot() {  # slot image
  local slot="$1" img="$2" name; name="$(bg_c "$1")"
  docker rm -f "$name" >/dev/null 2>&1
  local senv="$DATA/app-$slot.env"
  ( umask 077; cp -f "$ENVF" "$senv"; {
      echo "NEXUS_SLOT=$slot"
      echo "NEXUS_CHUNK_DIR=/app/data/chunks"
      echo "NEXUS_BLUEGREEN_LIVE_FILE=/app/data/bluegreen/live"
      # Test hook for the "a failing health gate must not switch" check: a slot that cannot reach its DB.
      [ "${NEXUS_BG_TEST_BREAK:-}" = health ] && echo "DATABASE_URL=postgresql://nobody:x@nexus-dev-postgres:5432/does_not_exist"
    } >> "$senv" )
  local mounts=()
  for d in avatars project-icons feed peer-reports attachments attendance complaints chat; do
    mkdir -p "$UPLOADS/$d" 2>/dev/null || sudo -n mkdir -p "$UPLOADS/$d"
    mounts+=(-v "$UPLOADS/$d:/app/public/uploads/$d")
  done
  [ -d "$ANDROID_DIR" ] && mounts+=(-v "$ANDROID_DIR:/app/data/android:ro")
  mounts+=(-v "$BG_STATE/shared:/app/data/bluegreen:ro" -v "$CHUNKS:/app/data/chunks")
  docker run -d --name "$name" --restart unless-stopped --label nexus-dev=1 \
    --label "nexus.bluegreen.slot=$slot" --label "nexus.bluegreen.commit=$COMMIT" --label "nexus.bluegreen.released=$(date '+%F %T')" \
    --network "$NET_INT" --memory 2g --memory-swap 2g --cpus 2 \
    --dns-opt timeout:1 --dns-opt attempts:1 \
    --env-file "$senv" -w /app --entrypoint node \
    "${mounts[@]}" "$img" server.js >/dev/null
}

smoke() {  # slot
  [ -f "$QA_PW_FILE" ] || { red "QA password file missing ($QA_PW_FILE)"; return 1; }
  docker run --rm --network host -v "$BGBIN/smoke.mjs:/smoke.mjs:ro" -v "$QA_PW_FILE:/run/qa-pw:ro" \
    -e BASE="http://127.0.0.1:$PREVIEW_PORT" -e EXPECT_SLOT="$1" -e QA_EMAIL="$QA_EMAIL" -e QA_PW_FILE=/run/qa-pw \
    node:22-alpine node /smoke.mjs
}

abort_idle() {  # slot message — the live slot was never touched
  red "$2"
  docker logs --tail 25 "$(bg_c "$1")" 2>&1 | sed 's/^/   | /'
  docker stop -t 5 "$(bg_c "$1")" >/dev/null 2>&1
  bg_write_upstreams "$LIVE" "$LIVE" >/dev/null 2>&1 && bg_reload
  red "NOT switched — live stays $LIVE ($(bg_c "$LIVE")). $(bg_c "$1") stopped (kept for its logs)."
  exit 1
}

# ============================ WEB only ============================
if [ "$BAGIAN" = "web" ]; then
  say "nginx conf / container"
  L="$(bg_live)"; [ -n "$L" ] || L=legacy
  ensure_web "$L" || exit 1
fi

# ============================ RELEASE (all | backend | frontend | env) ============================
if [ "$BAGIAN" != "web" ]; then
  ensure_base
  LIVE="$(bg_live)"
  if [ -z "$LIVE" ]; then
    # First blue-green release: the old single container is "live" until the switch.
    LIVE=legacy
    say "bootstrap: $LEGACY_C is live; first release goes to blue"
    docker inspect "$LEGACY_C" >/dev/null 2>&1 || { red "neither blue-green state nor $LEGACY_C — nothing to take over"; exit 1; }
    mkdir -p "$WEBROOT/legacy" && rsync -a --delete "$DIST/" "$WEBROOT/legacy/" && chmod -R a+rX "$WEBROOT"
    IDLE=blue
  else
    IDLE="$(bg_other "$LIVE")"
  fi
  LIVE_IMG="$(docker inspect -f '{{.Image}}' "$(bg_c "$LIVE")" 2>/dev/null)"
  bg_running "$LIVE" || { red "live slot $(bg_c "$LIVE") is not running — fix that first (or: $SELF rollback)"; exit 1; }
  echo "   live: $LIVE ($(bg_c "$LIVE"))   idle -> $IDLE ($(bg_c "$IDLE"))"
  # Claim the idle slot: a pending `finish` of the previous release must not stop the new one.
  bg_lock; bg_new_epoch "claim-$IDLE" >/dev/null; rm -f "$BG_STATE/finish-at"; bg_unlock

  # ---- image
  if [ "$BAGIAN" = all ] || [ "$BAGIAN" = backend ]; then
    say "build image (Dockerfile.prod)"
    # One retry: next/font fetches Google Fonts at build time and that fetch flakes now and then.
    nice -n 10 docker build -f Dockerfile.prod -t "$IMG_REPO:candidate" . \
      || { echo "   build failed once — retrying"; nice -n 10 docker build -f Dockerfile.prod -t "$IMG_REPO:candidate" .; } \
      || { red "build failed — dev unchanged"; exit 1; }
    if [ "${NEXUS_DEV_SKIP_COMPAT:-0}" = 1 ]; then
      echo "   compat harness SKIPPED (NEXUS_DEV_SKIP_COMPAT=1)"
    else
      say "compat harness (released iOS/Android/web clients vs the candidate)"
      COMPAT_LIVE_CONTAINER="$(bg_c "$LIVE")" bash scripts/compat/run.sh "$IMG_REPO:candidate" 2>&1 | tail -6
      [ "${PIPESTATUS[0]}" = 0 ] || { red "compat harness FAILED — not switching (live stays $LIVE)"; exit 1; }
    fi
    NEW_IMG="$IMG_REPO:candidate"
  else
    NEW_IMG="$LIVE_IMG"
    echo "   image carried over from $LIVE (${LIVE_IMG:7:12})"
  fi
  docker tag "$NEW_IMG" "$IMG_REPO:$IDLE"

  # ---- SPA into html/<idle>
  if [ "$BAGIAN" = all ] || [ "$BAGIAN" = frontend ]; then
    say "SPA build (VITE_NEXUS_ENV=dev)"
    APP="$REPO/apps/web"   # renamed 14 Oct 2026; an older checkout: the apps/* folder that holds vite.config.ts
    [ -f "$APP/vite.config.ts" ] || APP="$(dirname "$(ls -d "$REPO"/apps/*/vite.config.ts 2>/dev/null | head -1)")"
    [ -f "$APP/vite.config.ts" ] || { red "SPA folder not found under $REPO/apps"; exit 1; }
    stamp="$APP/node_modules/.lock-sha"
    want=$(sha256sum "$APP/package-lock.json" | cut -c1-64)
    if [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
      echo "   npm ci (package-lock changed or first run)"
      docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -v "$APP":/app -w /app node:22-alpine \
        npm ci --no-audit --no-fund --loglevel=error || { red "npm ci failed"; exit 1; }
      echo "$want" > "$stamp"
    fi
    [ -d "$APP/dist-dev" ] && rm -r "${APP:?}/dist-dev"
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e VITE_NEXUS_ENV=dev -v "$APP":/app -w /app node:22-alpine \
      ./node_modules/.bin/vite build --outDir dist-dev --emptyOutDir 2>&1 | tail -3
    [ -f "$APP/dist-dev/index.html" ] || { red "SPA build failed — dev unchanged"; exit 1; }
    n=$(find "$APP/dist-dev" -type f | wc -l)
    [ "$n" -ge 20 ] || { red "SPA build has only $n files — refusing"; exit 1; }
    grep -rqs "not production" "$APP/dist-dev/assets" || { red "DEV marker missing from the build — refusing"; exit 1; }
    [ -d "$APP/dist-dev/.well-known" ] && rm -r "${APP:?}/dist-dev/.well-known"     # no universal-link claims from dev
    bg_spa_install "$IDLE" "$APP/dist-dev" || { red "SPA install failed"; exit 1; }
    rm -r "${APP:?}/dist-dev"
    echo "   SPA -> html/$IDLE ($n files)"
  else
    bg_spa_install "$IDLE" "$WEBROOT/$LIVE" || { red "SPA copy failed"; exit 1; }
    echo "   SPA carried over from html/$LIVE"
  fi

  # ---- SQL gates (expand/contract)
  say "database gates"
  "$BGBIN/nexus-sql.sh" dev pending || { red "refusing to switch: apply (or record) the pending SQL first"; exit 1; }
  "$BGBIN/nexus-sql.sh" dev check "$NEW_IMG" "new version $COMMIT" || { red "refusing to switch: the database lacks what the new version's schema expects"; exit 1; }
  "$BGBIN/nexus-sql.sh" dev check "$LIVE_IMG" "live version ($LIVE)" \
    || red "   WARNING: the LIVE version's schema is no longer satisfied — a contract SQL ran too early; rollback to it would break the same way"

  # ---- env + idle slot
  say "start $(bg_c "$IDLE") next to $(bg_c "$LIVE")"
  build_env || exit 1
  ensure_gideon_relay
  start_slot "$IDLE" "$IMG_REPO:$IDLE" || { red "cannot start $(bg_c "$IDLE")"; exit 1; }
  ensure_web "$LIVE" || abort_idle "$IDLE" "nginx not ready"
  bg_wait_healthy "$IDLE" 45 || abort_idle "$IDLE" "$(bg_c "$IDLE") NOT healthy"
  sudo -n chown -R 1001:1001 "$UPLOADS" "$CHUNKS" 2>/dev/null || true
  docker exec "$(bg_c "$IDLE")" node -e 'fetch("http://127.0.0.1:3000/api/realtime-init").then(r=>console.log("   realtime-init -> "+r.status)).catch(e=>console.log("   realtime-init failed "+e))'
  bg_write_upstreams "$LIVE" "$IDLE" && bg_reload || abort_idle "$IDLE" "cannot point the preview at $IDLE"
  sleep 1

  say "smoke test through nginx preview (127.0.0.1:$PREVIEW_PORT -> $IDLE)"
  smoke "$IDLE" || abort_idle "$IDLE" "smoke test FAILED"

  # ---- switch
  say "switch $LIVE -> $IDLE"
  bg_lock
  bg_switch "$IDLE" "deploy $BAGIAN $COMMIT" "$LIVE" || { bg_unlock; red "switch failed — rolling nginx back to $LIVE"; bg_write_upstreams "$LIVE" "$LIVE" && bg_reload; echo "$LIVE" > "$BG_STATE/live"; echo "$LIVE" > "$BG_STATE/shared/live"; exit 1; }
  SWITCH_EPOCH="$BG_EPOCH"
  bg_unlock
  sleep 1
  pub=$(curl -s -m 10 "$DEV_URL/api/health" | sed -n 's/.*"slot":"\([a-z]*\)".*/\1/p')
  if [ "$pub" != "$IDLE" ]; then
    red "public check: $DEV_URL/api/health answered slot '$pub', expected $IDLE — rolling back"
    bg_lock; bg_rollback; bg_unlock; exit 1
  fi
  echo "   public $DEV_URL/api/health -> slot $pub"
  bg_schedule_finish "$SWITCH_EPOCH" "$LIVE"
  green "dev release $COMMIT live on $IDLE"

  # ---- cleanup (never a slot image: they are tagged :blue/:green and used by containers)
  say "cleanup"
  bg_archive_prune
  docker image prune -f 2>/dev/null | tail -1 || true
  docker builder prune -f --filter until=24h 2>/dev/null | tail -1 || true

  say "checklist"
  echo "   [x] image + compat harness      [x] SPA html/$IDLE (+ asset archive)   [x] SQL ledger: nothing pending"
  echo "   [x] schema: new version satisfied   [x] smoke test via preview        [x] switch + public check"
  "$BGBIN/nexus-sql.sh" dev status | grep -E 'contract|CHANGED' | sed 's/^/   [ ] /' || true
  echo "   rollback (instant until $(cut -d' ' -f1-2 "$BG_STATE/finish-at" 2>/dev/null || echo '?')):  $SELF rollback"
fi

# ============================ tailscale serve ============================
# TLS for the dev URL: tailscale serve (tailnet only, never Funnel). Needed because the app sets
# __Secure- session cookies (NODE_ENV=production), which browsers refuse over plain http.
if ! sudo -n tailscale serve status 2>/dev/null | grep -q ":$DEV_PORT"; then
  sudo -n tailscale serve --bg --https="$DEV_PORT" http://127.0.0.1:8080 >/dev/null && echo "   tailscale serve :$DEV_PORT -> 127.0.0.1:8080"
fi


# ============================ checks ============================
say "checks"
printf '   dev  /api/health (127.0.0.1:%s, live slot) -> %s\n' "$RAW_PORT" "$(curl -s -m 8 "http://127.0.0.1:$RAW_PORT/api/health" | head -c 160)"
printf '   dev  %s/ -> %s\n' "$DEV_URL" "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$DEV_URL/")"
printf '   prod /api/health (127.0.0.1:3002) -> %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:3002/api/health)"
docker stats --no-stream --format '   {{.Name}}: {{.MemUsage}} cpu {{.CPUPerc}}' "${SLOT_PREFIX}blue" "${SLOT_PREFIX}green" "$WEB" "$PG" 2>/dev/null
