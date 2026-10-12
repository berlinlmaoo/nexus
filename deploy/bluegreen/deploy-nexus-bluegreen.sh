#!/usr/bin/env bash
# Pagar failover: kalau NEXUS sedang dilayani VPS, kantor tidak boleh deploy/sync (lihat ~/office-fence.sh status).
[ -e /var/lib/nexus-fence/tripped ] && [ "${1:-}" != status ] && { echo "PAGAR AKTIF: NEXUS dilayani VPS. Selesaikan failback lalu office-fence.sh reset."; exit 1; }
# Tracked copy: deploy/bluegreen/deploy-nexus-bluegreen.sh. Installed as ~/deploy-nexus-bluegreen.sh on nexus-prod
# ONLY after the migration in deploy/bluegreen/RUNBOOK.md (owner approval). Until then ~/deploy-nexus.sh stays.
#
# PRODUCTION blue-green deploy of NEXUS (VM nexus-prod). Same guarantees as ~/deploy-nexus.sh, plus:
# zero downtime, the previous version kept warm for an instant rollback, and SQL gates.
#
#   ~/deploy-nexus-bluegreen.sh [semua]   -> backend + frontend into the idle slot, gates, switch
#   ~/deploy-nexus-bluegreen.sh backend   -> new image; SPA carried over from the live slot
#   ~/deploy-nexus-bluegreen.sh frontend  -> new SPA; image carried over from the live slot
#   ~/deploy-nexus-bluegreen.sh env       -> same image + SPA, env rebuilt (OVERRIDABLE / new .env.production keys)
#   ~/deploy-nexus-bluegreen.sh rollback  -> nginx back to the previous slot (instant while it runs; KEEP_MINUTES)
#   ~/deploy-nexus-bluegreen.sh status    -> slots, versions, leader, last switches
#   ~/deploy-nexus-bluegreen.sh sql …     -> deploy/bluegreen/nexus-sql.sh prod … (status | apply FILE | record FILE --yes)
#
# Kept from deploy-nexus.sh (do not drop any of these): fence check, pre-check health 200, git pull --ff-only,
# candidate image + compat harness (no switch to skip it), env = running container's env + NEW keys from
# .env.production + OVERRIDABLE keys, APNs key readable by uid 1001 from INSIDE the image + mounted at
# /run/secrets/apns.p8, all upload dirs incl. chat, Android dir read-only, realtime-init after the health
# gate, chown uploads to 1001, .well-known never published by a build, build-cache/image cleanup that keeps
# prod/beta/blue/green/candidate and every image a container uses, final check from the internet.
# New: nexus-app:prod is re-tagged to the LIVE image after every switch, so ~/vps-image-sync.sh keeps
# shipping exactly what the office runs to the VPS standby.
set -uo pipefail

SELF="$(readlink -f "$0")"
REPO="$HOME/nexus"
BASE="$HOME/nexus/var/uploads"
ANDROID_DIR="$HOME/nexus-data/android"
APNS_KEY_FILE="/etc/nexus/secrets/AuthKey_9PTCKVB26P.p8"
DATA="$HOME/nexus-data"
WEBROOT="$DATA/web/html"                  # blue/ green/ _archive/  -> nexus-web:/usr/share/nginx/html
NGINX_DIR="$DATA/web/conf.d"              # default.conf + 00-bluegreen.conf -> nexus-web:/etc/nginx/conf.d
BG_STATE="$DATA/bluegreen"
BGBIN="$BG_STATE/bin"
CHUNKS="$DATA/chunk-uploads"
PROFILE=prod
SLOT_PREFIX=nexus-app-                    # nexus-app-blue / nexus-app-green
LEGACY_C=nexus-app-beta                   # the single pre-blue-green container (migration only)
IMG_REPO=nexus-app
WEB=nexus-web
NET=nexus_internal
RAW_PORT=3002                             # nexus-web raw listener -> live slot (crons, realtime-boot, scripts)
PREVIEW_PORT=3012                         # nexus-web preview listener -> idle slot (127.0.0.1 only)
KEEP_MINUTES="${KEEP_MINUTES:-15}"
PUBLIC="https://nexus.znetworks.id"
SMOKE_EMAIL="${NEXUS_SMOKE_EMAIL:-}"      # optional prod smoke account (owner decision); none = anonymous smoke
SMOKE_PW_FILE="$HOME/.secrets/nexus-smoke-password"
DEPLOY_LOCK=/tmp/nexus-prod-deploy.lock
OVERRIDABLE="NEXUS_ANDROID_CERT_SHA256 NEXUS_ANDROID_MIN_VERSION NEXUS_ANDROID_LATEST_VERSION NEXUS_ANDROID_LATEST_RELEASED_AT NEXUS_ANDROID_STORE_URL NEXUS_FCM_SERVICE_ACCOUNT_JSON"
BAGIAN="${1:-semua}"

merah() { printf '\033[31m%s\033[0m\n' "$*"; }
hijau() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { merah "$@"; }
say() { printf '\033[1m== %s\033[0m\n' "$*"; }

bg_lock() { exec 8>"$BG_LOCK"; flock -w 60 8 || { merah "switch lock busy ($BG_LOCK)"; exit 1; }; }
bg_unlock() { flock -u 8 2>/dev/null; exec 8>&-; }
load_lib() {
  [ -f "$BGBIN/bg-lib.sh" ] || { merah "blue-green tooling missing ($BGBIN) — see RUNBOOK.md"; exit 1; }
  # shellcheck disable=SC1091
  . "$BGBIN/bg-lib.sh"
}

case "$BAGIAN" in
  status)   load_lib; bg_status; exit 0 ;;
  rollback) load_lib; say "rollback"; bg_lock; bg_rollback; rc=$?; bg_unlock
            [ $rc = 0 ] && docker tag "$(docker inspect -f '{{.Image}}' "$(bg_c "$(bg_live)")")" "$IMG_REPO:prod"
            exit $rc ;;
  finish)   load_lib; bg_lock; bg_finish "${2:?epoch}" "${3:?slot}"; rc=$?; bg_unlock; exit $rc ;;
  sql)      shift; exec "$BGBIN/nexus-sql.sh" prod "$@" ;;
  semua|backend|frontend|env) ;;
  *) sed -n '8,15p' "$SELF"; exit 2 ;;
esac
exec 9>"$DEPLOY_LOCK"; flock -n 9 || { merah "another production deploy is running ($DEPLOY_LOCK)"; exit 1; }

cd "$REPO" || { merah "repo tidak ketemu: $REPO"; exit 1; }
load_lib
LIVE="$(bg_live)"
[ -n "$LIVE" ] || { merah "no blue-green state: run the migration in RUNBOOK.md first (until then: ~/deploy-nexus.sh)"; exit 1; }
IDLE="$(bg_other "$LIVE")"

# --- 0. Pre-check: the live slot must be healthy now, or the gates mean nothing ---
pre=$(curl -s -o /dev/null -w '%{http_code}' -m 6 "http://127.0.0.1:$RAW_PORT/api/health" || echo 000)
echo "pre-check live=$LIVE ($(bg_c "$LIVE")) via 127.0.0.1:$RAW_PORT -> $pre"
[ "$pre" = "200" ] || { merah "BATAL: sistem sudah tidak sehat sebelum deploy. Perbaiki dulu, jangan ditimpa."; exit 1; }

say "ambil kode terbaru"
git pull --ff-only || { merah "git pull gagal (ada perubahan lokal?)"; exit 1; }
git log --oneline -1
COMMIT=$(git rev-parse --short HEAD)
mkdir -p "$BGBIN" "$CHUNKS" && rsync -a --delete "$REPO/deploy/bluegreen/" "$BGBIN/" && chmod +x "$BGBIN"/*.sh "$BGBIN"/*.py
load_lib
bg_init_state
LIVE_C="$(bg_c "$LIVE")"; IDLE_C="$(bg_c "$IDLE")"
LIVE_IMG="$(docker inspect -f '{{.Image}}' "$LIVE_C")"
echo "   live: $LIVE ($LIVE_C)   idle -> $IDLE ($IDLE_C)"
bg_lock; bg_new_epoch "claim-$IDLE" >/dev/null; rm -f "$BG_STATE/finish-at"; bg_unlock

# ============================ IMAGE ============================
if [ "$BAGIAN" = semua ] || [ "$BAGIAN" = backend ]; then
  say "build image backend (candidate)"
  docker build -f Dockerfile.prod -t "$IMG_REPO:candidate" . || { merah "build gagal — tidak ada yang diubah"; exit 1; }
  say "tes kecocokan app yang beredar (scripts/compat)"
  if ! COMPAT_LIVE_CONTAINER="$LIVE_C" bash scripts/compat/run.sh "$IMG_REPO:candidate"; then
    merah "BATAL: versi baru merusak app yang sudah beredar (tabel di atas). Produksi TIDAK disentuh."; exit 1
  fi
  NEW_IMG="$IMG_REPO:candidate"
else
  NEW_IMG="$LIVE_IMG"; echo "   image dibawa dari $LIVE (${LIVE_IMG:7:12})"
fi
docker tag "$NEW_IMG" "$IMG_REPO:$IDLE"

# APNs key readable by the image's own user (not -u 1001:1001: that lied once, see nexus-ios-push-apns-gid).
docker run --rm -v "$APNS_KEY_FILE:/k.p8:ro" --entrypoint sh "$IMG_REPO:$IDLE" -c 'head -c 1 /k.p8 >/dev/null 2>&1' || {
  merah "BATAL: kunci APNs tidak terbaca dari dalam container ($APNS_KEY_FILE). Push akan mati DIAM-DIAM."
  echo "         sudo chown root:1001 $APNS_KEY_FILE && sudo chmod 640 $APNS_KEY_FILE"; exit 1; }

# ============================ SPA ============================
if [ "$BAGIAN" = semua ] || [ "$BAGIAN" = frontend ]; then
  say "SPA build"
  APP="$REPO/apps/nexus-lovable-ui"
  [ -d "$APP/dist-bg" ] && rm -r "${APP:?}/dist-bg"
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$APP":/app -w /app node:22-alpine \
    ./node_modules/.bin/vite build --outDir dist-bg --emptyOutDir 2>&1 | tail -3
  [ -f "$APP/dist-bg/index.html" ] || { merah "BATAL: SPA build gagal"; exit 1; }
  n=$(find "$APP/dist-bg" -type f | wc -l)
  [ "$n" -ge 20 ] || { merah "BATAL: SPA cuma $n berkas"; exit 1; }
  # .well-known (AASA: universal links) is never published by a build: it comes from the live slot, as is.
  [ -d "$APP/dist-bg/.well-known" ] && rm -r "${APP:?}/dist-bg/.well-known"
  [ -d "$WEBROOT/$LIVE/.well-known" ] && cp -a "$WEBROOT/$LIVE/.well-known" "$APP/dist-bg/"
  bg_spa_install "$IDLE" "$APP/dist-bg" || { merah "BATAL: SPA install gagal"; exit 1; }
  rm -r "${APP:?}/dist-bg"
  echo "   SPA -> html/$IDLE ($n berkas)"
else
  bg_spa_install "$IDLE" "$WEBROOT/$LIVE" || { merah "BATAL: SPA copy gagal"; exit 1; }
  echo "   SPA dibawa dari html/$LIVE"
fi
[ -f "$WEBROOT/$LIVE/.well-known/apple-app-site-association" ] && { [ -f "$WEBROOT/$IDLE/.well-known/apple-app-site-association" ] || { merah "BATAL: AASA hilang di html/$IDLE"; exit 1; }; }

# ============================ SQL gates ============================
say "database gates (expand/contract)"
"$BGBIN/nexus-sql.sh" prod pending || { merah "BATAL: SQL expand belum diterapkan (lihat di atas)"; exit 1; }
"$BGBIN/nexus-sql.sh" prod check "$NEW_IMG" "versi baru $COMMIT" || { merah "BATAL: database belum punya yang dibutuhkan versi baru"; exit 1; }
"$BGBIN/nexus-sql.sh" prod check "$LIVE_IMG" "versi live ($LIVE)" || merah "   PERINGATAN: versi LIVE sudah tidak cocok dengan database (contract SQL terlalu cepat?) — rollback ke sana akan rusak juga"

# ============================ ENV ============================
# Same rules as deploy-nexus.sh: the RUNNING container's env is the truth; .env.production only ADDS new
# keys, except the OVERRIDABLE ones. Slot keys are set fresh.
ENVF=$(umask 077; mktemp); trap 'rm -f "$ENVF"' EXIT
docker inspect "$LIVE_C" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -vE '^(PATH|HOSTNAME|NODE_VERSION|YARN_VERSION|NEXUS_SLOT|NEXUS_CHUNK_DIR|NEXUS_BLUEGREEN_LIVE_FILE)=' > "$ENVF"
echo "   env terbawa: $(wc -l < "$ENVF") baris"
if [ -f "$REPO/.env.production" ]; then
  baru=0
  while IFS= read -r baris || [ -n "$baris" ]; do
    case "$baris" in ''|'#'*) continue ;; [A-Za-z_]*=*) kunci="${baris%%=*}" ;; *) continue ;; esac
    grep -q -- "^${kunci}=" "$ENVF" && continue
    printf '%s\n' "$baris" >> "$ENVF"; baru=$((baru+1))
  done < "$REPO/.env.production"
  echo "   env baru dari .env.production: $baru kunci"
  timpa=0
  for kunci in $OVERRIDABLE; do
    baris=$(grep -- "^${kunci}=" "$REPO/.env.production" | tail -1)
    [ -n "$baris" ] || continue
    grep -qxF -- "$baris" "$ENVF" && continue
    grep -v -- "^${kunci}=" "$ENVF" > "${ENVF}.tmp" && mv "${ENVF}.tmp" "$ENVF"
    printf '%s\n' "$baris" >> "$ENVF"; timpa=$((timpa+1))
  done
  echo "   env ditimpa dari .env.production (OVERRIDABLE): $timpa kunci"
fi
{ echo "NEXUS_SLOT=$IDLE"; echo "NEXUS_CHUNK_DIR=/app/data/chunks"; echo "NEXUS_BLUEGREEN_LIVE_FILE=/app/data/bluegreen/live"; } >> "$ENVF"
mkdir -p "$ANDROID_DIR" || { merah "BATAL: tidak bisa membuat $ANDROID_DIR"; exit 1; }

# ============================ IDLE SLOT ============================
say "start $IDLE_C di samping $LIVE_C"
docker rm -f "$IDLE_C" >/dev/null 2>&1
docker run -d --name "$IDLE_C" --restart unless-stopped \
  --label "nexus.bluegreen.slot=$IDLE" --label "nexus.bluegreen.commit=$COMMIT" --label "nexus.bluegreen.released=$(date '+%F %T')" \
  --network "$NET" --env-file "$ENVF" --add-host=host.docker.internal:host-gateway \
  -w /app --entrypoint node \
  -v "$BASE/avatars:/app/public/uploads/avatars" \
  -v "$BASE/project-icons:/app/public/uploads/project-icons" \
  -v "$BASE/feed:/app/public/uploads/feed" \
  -v "$BASE/peer-reports:/app/public/uploads/peer-reports" \
  -v "$BASE/attachments:/app/public/uploads/attachments" \
  -v "$BASE/attendance:/app/public/uploads/attendance" \
  -v "$BASE/complaints:/app/public/uploads/complaints" \
  -v "$BASE/chat:/app/public/uploads/chat" \
  -v "$ANDROID_DIR:/app/data/android:ro" \
  -v "$APNS_KEY_FILE:/run/secrets/apns.p8:ro" \
  -v "$BG_STATE/shared:/app/data/bluegreen:ro" \
  -v "$CHUNKS:/app/data/chunks" \
  "$IMG_REPO:$IDLE" server.js >/dev/null || { merah "BATAL: $IDLE_C tidak bisa dibuat"; exit 1; }

abort_idle() {
  merah "$1"; docker logs --tail 25 "$IDLE_C" 2>&1 | sed 's/^/   | /'
  docker stop -t 5 "$IDLE_C" >/dev/null 2>&1
  bg_write_upstreams "$LIVE" "$LIVE" >/dev/null 2>&1 && bg_reload
  merah "TIDAK di-switch — live tetap $LIVE ($LIVE_C). Produksi tidak tersentuh."; exit 1
}
bg_wait_healthy "$IDLE" 45 || abort_idle "$IDLE_C TIDAK sehat"
sudo chown -R 1001:65533 "$BASE" "$CHUNKS" 2>/dev/null || true
rt=$(docker exec "$IDLE_C" node -e 'fetch("http://127.0.0.1:3000/api/realtime-init").then(r=>console.log(r.status)).catch(()=>console.log("000"))')
echo "   realtime-init -> $rt"
bg_write_upstreams "$LIVE" "$IDLE" && bg_reload || abort_idle "preview tidak bisa diarahkan ke $IDLE"
sleep 1

say "smoke test lewat nginx preview (127.0.0.1:$PREVIEW_PORT -> $IDLE)"
smoke_args=(-e BASE="http://127.0.0.1:$PREVIEW_PORT" -e EXPECT_SLOT="$IDLE")
if [ -n "$SMOKE_EMAIL" ] && [ -f "$SMOKE_PW_FILE" ]; then
  smoke_args+=(-v "$SMOKE_PW_FILE:/run/pw:ro" -e QA_EMAIL="$SMOKE_EMAIL" -e QA_PW_FILE=/run/pw)
else
  smoke_args+=(-e SMOKE_ANON=1)
fi
docker run --rm --network host -v "$BGBIN/smoke.mjs:/smoke.mjs:ro" "${smoke_args[@]}" node:22-alpine node /smoke.mjs \
  || abort_idle "smoke test GAGAL"

# ============================ SWITCH ============================
say "switch $LIVE -> $IDLE"
bg_lock
if ! bg_switch "$IDLE" "deploy $BAGIAN $COMMIT" "$LIVE"; then
  bg_unlock; merah "switch gagal — nginx dikembalikan ke $LIVE"
  echo "$LIVE" > "$BG_STATE/live"; echo "$LIVE" > "$BG_STATE/shared/live"; bg_write_upstreams "$LIVE" "$LIVE" && bg_reload; exit 1
fi
SWITCH_EPOCH="$BG_EPOCH"; bg_unlock
docker tag "$IMG_REPO:$IDLE" "$IMG_REPO:prod"     # what the VPS standby gets at 03:30 (vps-image-sync.sh)
sleep 2
pub=$(curl -s -m 15 "$PUBLIC/api/health" | sed -n 's/.*"slot":"\([a-z]*\)".*/\1/p')
if [ "$pub" != "$IDLE" ]; then
  merah "cek publik: $PUBLIC/api/health menjawab slot '$pub', harusnya $IDLE — rollback"
  bg_lock; bg_rollback; bg_unlock; docker tag "$LIVE_IMG" "$IMG_REPO:prod"; exit 1
fi
echo "   publik $PUBLIC/api/health -> slot $pub"
bg_schedule_finish "$SWITCH_EPOCH" "$LIVE"
hijau "rilis $COMMIT live di $IDLE"

# ============================ CLEANUP ============================
say "bersihkan sampah build"
bg_archive_prune
docker builder prune -f --filter until=24h 2>/dev/null | tail -1 || true
cache_gb=$(docker buildx du 2>/dev/null | awk '/^Total/ {v=$2; if (v ~ /GB$/) {sub(/GB$/,"",v); print int(v)} else print 0}')
if [ "${cache_gb:-0}" -gt 40 ]; then echo "build cache ${cache_gb} GB > 40 → dibersihkan"; docker buildx prune -af 2>/dev/null | tail -1 || true; fi
docker image prune -f 2>/dev/null | tail -1 || true
# Old nexus-app tags: keep prod, beta, blue, green, candidate, every image a container uses, and the two
# newest others. Slot images are never pruned (named here AND in use by their containers).
DIPAKAI=$(docker ps -a --format '{{.Image}}' | sort -u)
docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}' \
  | awk -F'\t' '$1 ~ /^nexus-app:/ && $1 !~ /^nexus-app:(prod|beta|blue|green|candidate)$/' \
  | sort -t$'\t' -k2 -r | tail -n +3 | cut -f1 \
  | grep -vxF "$DIPAKAI" \
  | xargs -r docker rmi >/dev/null 2>&1 || true
df -h / | tail -1

say "checklist"
echo "   [x] compat harness  [x] APNs key  [x] SQL ledger: tidak ada expand yang tertunda  [x] schema versi baru"
echo "   [x] smoke via preview  [x] switch + cek publik  [x] nexus-app:prod -> $IDLE (VPS image sync 03:30)"
"$BGBIN/nexus-sql.sh" prod status | grep -E 'contract|CHANGED' | sed 's/^/   [ ] /' || true
echo "   rollback instan sampai $(cut -d' ' -f1-2 "$BG_STATE/finish-at" 2>/dev/null || echo '?'):  $SELF rollback"

say "cek akhir dari internet"
curl -s -o /dev/null -w "   nexus.znetworks.id      -> HTTP %{http_code}\n" -m 15 "$PUBLIC/"
curl -s -m 15 "$PUBLIC/api/health"; echo
