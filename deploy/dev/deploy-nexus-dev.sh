#!/usr/bin/env bash
# Tracked copy. The installed one is ~/deploy-nexus-dev.sh on nexus-prod — keep both in sync.
# Deploy NEXUS **DEV** (branch `dev`, worktree ~/nexus-dev). Never touches production.
#
#   ~/deploy-nexus-dev.sh            -> backend + frontend + web (nginx)
#   ~/deploy-nexus-dev.sh backend    -> backend only
#   ~/deploy-nexus-dev.sh frontend   -> SPA only
#   ~/deploy-nexus-dev.sh web        -> nginx conf/container + tailscale serve only
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

REPO="$HOME/nexus-dev"
BRANCH=dev
DATA="$HOME/nexus-dev-data"
UPLOADS="$DATA/uploads"
DIST="$DATA/dist"
NGINX_DIR="$DATA/nginx"
ENVF="$DATA/app.env"
SECRETS="$DATA/dev-secrets.env"
ANDROID_DIR="$HOME/nexus-data/android"     # prod's sideload dir, mounted READ-ONLY (only for /api/app/android parity)

C=nexus-dev-app
IMG=nexus-dev-app:dev
WEB=nexus-dev-web
PG=nexus-dev-postgres
NET_INT=nexus_dev_internal
NET_EDGE=nexus_dev_edge
DEV_HOST=nexus-prod.tail765d02.ts.net
DEV_PORT=8443
DEV_URL="https://$DEV_HOST:$DEV_PORT"
PROD_C=nexus-app-beta                      # read-only: env keys are copied from it
BAGIAN="${1:-all}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
say()   { printf '\033[1m== %s\033[0m\n' "$*"; }

# ---- guards: never operate on a production name ----
for n in "$C" "$WEB" "$PG" "$IMG"; do
  case "$n" in nexus-app-beta|nexus-web|nexus-postgres|nexus-face|nexus-znet-cloudflared|nexus-app:*) red "guard: $n is a production name"; exit 1;; esac
done
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

mkdir -p "$DATA" "$UPLOADS" "$DIST" "$NGINX_DIR"; chmod 700 "$DATA"

# ---------------------------------------------------------------- env
# Non-secret behaviour keys copied from the live prod container so dev runs under prod's rules.
# Anything not listed here is NOT copied. New prod keys are reported (names only) so they can be
# classified; add a key here only if it cannot reach another system or person.
ALLOW_KEYS="ABSENCE_DEDUCTION_START_DATE APP_NAME APP_TIMEZONE ATTENDANCE_OUTAGE_DATES ATTENDANCE_SILENT_CORRECTION_ADMINS
 ATTENDANCE_PENALTY_LOOKBACK_DAYS ATTENDANCE_ESCALATION_BUSINESS_DAYS DB_CONNECT_TIMEOUT DB_IDLE_TIMEOUT DB_POOL_MAX LOG_LEVEL
 NEXT_TELEMETRY_DISABLED NODE_ENV PORT NEXUS_ORG_WORKSPACE_ID NEXUS_ATTENDANCE_SHEET_WORKSPACE
 NEXUS_IOS_MIN_VERSION NEXUS_IOS_LATEST_VERSION NEXUS_ANDROID_MIN_VERSION NEXUS_ANDROID_LATEST_VERSION
 NEXUS_ANDROID_LATEST_RELEASED_AT NEXUS_ANDROID_STORE_URL NEXUS_ANDROID_CERT_SHA256"
# Deliberately dropped (documented, so "unclassified" stays meaningful):
DROPPED_RE='^(APNS_|NEXUS_FCM_|SMTP_|WA_|HERMES_|NEXUS_WA_|GOOGLE_|FINANCE_|NAS_|GIDEON_|ORACLE_|NEXUS_GIDEON_|NEXUS_SSO_|STATUS_SSO_|CF_TUNNEL_|CRON_SECRET|SLACK_|SENTRY_|BUFFER_|REDIS_URL|POSTGRES_|DATABASE_URL|AUTH_SECRET|AUTH_TRUST_HOST|NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|NEXUS_PUBLIC_URL|BACKUP_DIR|NEXUS_DATA_DIR|APP_PORT|PATH|HOSTNAME|NODE_VERSION|YARN_VERSION)'

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
  chmod 600 "$tmp"; mv -f "$tmp" "$ENVF"
  echo "   env: $(wc -l < "$ENVF") keys -> $ENVF"
}

app_health() {  # from inside the app container: independent of nginx
  docker exec "$C" node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' 2>/dev/null
}

start_app() {  # $1 = image
  docker rm -f "$C" >/dev/null 2>&1
  local mounts=()
  for d in avatars project-icons feed peer-reports attachments attendance complaints chat; do
    mkdir -p "$UPLOADS/$d" 2>/dev/null || sudo -n mkdir -p "$UPLOADS/$d"
    mounts+=(-v "$UPLOADS/$d:/app/public/uploads/$d")
  done
  [ -d "$ANDROID_DIR" ] && mounts+=(-v "$ANDROID_DIR:/app/data/android:ro")
  docker run -d --name "$C" --restart unless-stopped --label nexus-dev=1 \
    --network "$NET_INT" --memory 2g --memory-swap 2g --cpus 2 \
    --dns-opt timeout:1 --dns-opt attempts:1 \
    --env-file "$ENVF" -w /app --entrypoint node \
    "${mounts[@]}" "$1" server.js >/dev/null
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

# ============================ BACKEND ============================
if [ "$BAGIAN" = "all" ] || [ "$BAGIAN" = "backend" ]; then
  ensure_base
  say "build image $IMG (Dockerfile.prod)"
  # One retry: next/font fetches Google Fonts at build time and that fetch flakes now and then.
  nice -n 10 docker build -f Dockerfile.prod -t nexus-dev-app:candidate . \
    || { echo "   build failed once — retrying"; nice -n 10 docker build -f Dockerfile.prod -t nexus-dev-app:candidate .; } \
    || { red "build failed — dev unchanged"; exit 1; }
  build_env || exit 1
  docker image inspect "$IMG" >/dev/null 2>&1 && docker tag "$IMG" nexus-dev-app:prev
  docker tag nexus-dev-app:candidate "$IMG"

  say "replace $C"
  start_app "$IMG"
  ok=0
  for i in $(seq 1 30); do app_health && { ok=1; echo "   healthy after $i tries"; break; }; sleep 2; done
  if [ "$ok" != 1 ]; then
    red "dev backend NOT healthy — logs:"; docker logs --tail 30 "$C" 2>&1
    if docker image inspect nexus-dev-app:prev >/dev/null 2>&1; then
      red "rolling back to nexus-dev-app:prev"; docker tag nexus-dev-app:prev "$IMG"; start_app "$IMG"
    fi
    exit 1
  fi
  sudo -n chown -R 1001:1001 "$UPLOADS" 2>/dev/null || true
  # nginx caches the upstream IP; re-resolve after the app container was recreated.
  docker exec "$WEB" nginx -s reload >/dev/null 2>&1 || true
  docker exec "$C" node -e 'fetch("http://127.0.0.1:3000/api/realtime-init").then(r=>console.log("   realtime-init -> "+r.status)).catch(e=>console.log("   realtime-init failed "+e))'
  green "dev backend deployed"
fi

# ============================ FRONTEND ============================
if [ "$BAGIAN" = "all" ] || [ "$BAGIAN" = "frontend" ]; then
  say "SPA build (VITE_NEXUS_ENV=dev)"
  APP="$REPO/apps/nexus-lovable-ui"
  stamp="$APP/node_modules/.lock-sha"
  want=$(sha256sum "$APP/package-lock.json" | cut -c1-64)
  if [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
    echo "   npm ci (package-lock changed or first run)"
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -v "$APP":/app -w /app node:22-alpine \
      npm ci --no-audit --no-fund --loglevel=error || { red "npm ci failed"; exit 1; }
    echo "$want" > "$stamp"
  fi
  rm -rf "$APP/dist-dev"
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e VITE_NEXUS_ENV=dev -v "$APP":/app -w /app node:22-alpine \
    ./node_modules/.bin/vite build --outDir dist-dev --emptyOutDir 2>&1 | tail -3
  [ -f "$APP/dist-dev/index.html" ] || { red "SPA build failed — dev site unchanged"; exit 1; }
  n=$(find "$APP/dist-dev" -type f | wc -l)
  [ "$n" -ge 20 ] || { red "SPA build has only $n files — refusing"; exit 1; }
  grep -rqs "not production" "$APP/dist-dev/assets" || { red "DEV marker missing from the build — refusing"; exit 1; }
  rm -rf "$APP/dist-dev/.well-known"     # no universal-link claims from dev
  rsync -a --delete "$APP/dist-dev/" "$DIST/"     # in place: nginx bind-mounts this directory
  rm -rf "$APP/dist-dev"
  green "dev SPA deployed ($n files)"
fi

# ============================ WEB (nginx + tailscale serve) ============================
# Generated from the dev branch's maintenance/phaethon.conf so routing stays identical to prod:
# upstream -> nexus-dev-app, LAN 443 block and old-domain redirect removed, CSRF allows the dev
# origin, $host -> $http_host (keeps :8443 in forwarded host), and an extra raw-app listener on :3102.
say "nginx conf"
python3 - "$REPO/maintenance/phaethon.conf" "$NGINX_DIR/default.conf.new" "$DEV_HOST" "$DEV_PORT" <<'PY'
import sys, re
src, dst, host, port = sys.argv[1:5]
s = open(src).read()
out, i = [], 0
while True:
    j = s.find("server {", i)
    if j < 0: out.append(s[i:]); break
    out.append(s[i:j]); d = 0; k = j
    while k < len(s):
        if s[k] == "{": d += 1
        elif s[k] == "}":
            d -= 1
            if d == 0: k += 1; break
        k += 1
    b = s[j:k]
    if "listen 443" in b or "return 302" in b: out.append("# (prod-only server block removed for dev)\n")
    else: out.append(b)
    i = k
s = "".join(out)
s = s.replace("nexus-app-beta:3000", "nexus-dev-app:3000")
s = s.replace('X-Nexus-Origin "proxmox"', 'X-Nexus-Origin "dev"')
s = s.replace("proxy_set_header Host $host;", "proxy_set_header Host $http_host;")
s = s.replace("proxy_set_header X-Forwarded-Host $host;", "proxy_set_header X-Forwarded-Host $http_host;")
dev_origin = '    "~^[A-Z]+:https://%s:%s$" 0;\n' % (re.escape(host), port)
s = s.replace('    "~^(GET|HEAD|OPTIONS):" 0;\n', '    "~^(GET|HEAD|OPTIONS):" 0;\n' + dev_origin, 1)
s = s.replace("Strict-Transport-Security", "X-Dev-No-HSTS")
assert "nexus-app-beta" not in s and dev_origin in s
s = "# GENERATED by ~/deploy-nexus-dev.sh from maintenance/phaethon.conf — do not edit.\n" + s + """
# Raw app listener for host-side checks (published on 127.0.0.1:3102 only).
server {
    listen 3102;
    location / {
        proxy_pass http://nexus-dev-app:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
    }
}
"""
open(dst, "w").write(s)
PY
[ $? = 0 ] || { red "nginx conf generation failed"; exit 1; }
changed=0
cmp -s "$NGINX_DIR/default.conf.new" "$NGINX_DIR/default.conf" || { mv -f "$NGINX_DIR/default.conf.new" "$NGINX_DIR/default.conf"; changed=1; }
rm -f "$NGINX_DIR/default.conf.new"

if ! docker inspect "$WEB" >/dev/null 2>&1; then
  say "create $WEB"
  docker inspect "$C" >/dev/null 2>&1 || { red "$C does not exist yet — run the backend part first"; exit 1; }
  docker create --name "$WEB" --restart unless-stopped --label nexus-dev=1 \
    --network "$NET_EDGE" -p 127.0.0.1:8080:3000 -p 127.0.0.1:3102:3102 \
    --memory 256m --cpus 1 \
    -v "$NGINX_DIR:/etc/nginx/conf.d:ro" -v "$DIST:/usr/share/nginx/html:ro" nginx:alpine >/dev/null
  docker network connect "$NET_INT" "$WEB"
  docker start "$WEB" >/dev/null
elif [ "$changed" = 1 ] || [ "$(docker inspect -f '{{.State.Running}}' "$WEB")" != "true" ]; then
  docker start "$WEB" >/dev/null 2>&1
  docker exec "$WEB" nginx -t >/dev/null 2>&1 || { red "nginx -t failed:"; docker exec "$WEB" nginx -t; exit 1; }
  docker exec "$WEB" nginx -s reload
fi
echo "   conf changed: $changed"

# TLS for the dev URL: tailscale serve (tailnet only, never Funnel). Needed because the app sets
# __Secure- session cookies (NODE_ENV=production), which browsers refuse over plain http.
if ! sudo -n tailscale serve status 2>/dev/null | grep -q ":$DEV_PORT"; then
  sudo -n tailscale serve --bg --https="$DEV_PORT" http://127.0.0.1:8080 >/dev/null && echo "   tailscale serve :$DEV_PORT -> 127.0.0.1:8080"
fi

# ============================ checks ============================
say "checks"
sleep 2
printf '   dev  /api/health (127.0.0.1:3102) -> %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:3102/api/health)"
printf '   dev  %s/ -> %s\n' "$DEV_URL" "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$DEV_URL/")"
printf '   prod /api/health (127.0.0.1:3002) -> %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:3002/api/health)"
docker stats --no-stream --format '   {{.Name}}: {{.MemUsage}} cpu {{.CPUPerc}}' "$C" "$WEB" "$PG" 2>/dev/null
