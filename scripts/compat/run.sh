#!/usr/bin/env bash
# NEXUS pre-deploy compatibility harness.
#
#   scripts/compat/run.sh <candidate-image>            # e.g. prod  |  nexus-app:prod  |  sha256:…
#   scripts/compat/run.sh prod --min-version 0.1.4     # only the floor pass
#   scripts/compat/run.sh prod --min-version 0.1.4 --min-version 0.1.6   (the default)
#
# Boots the CANDIDATE image against a fresh, empty Postgres on a docker network that has NO route out
# (docker network create --internal), seeds a tiny world, and replays what every released client
# actually sends (iOS 0.1.3 legacy / 0.1.4 / 0.1.5 / 0.1.6, web). Exit non-zero with a table on any
# regression. Everything it creates is torn down on exit, success or not.
#
# Never touches: nexus-app-beta, nexus-postgres, nexus-web, their networks or volumes, production
# env secrets (only a short allowlist of NON-secret behaviour keys is read from the live container),
# the upload directories, or the APNs key. See README.md → "Isolation".
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIVE_CONTAINER="${COMPAT_LIVE_CONTAINER:-nexus-app-beta}"
PG_IMAGE="${COMPAT_PG_IMAGE:-postgres:16-alpine}"
NODE_IMAGE="${COMPAT_NODE_IMAGE:-node:20-alpine}"

usage() { sed -n '2,10p' "$0"; exit 2; }
[ $# -ge 1 ] || usage
CAND="$1"; shift
MINS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --min-version) MINS+=("$2"); shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1"; usage ;;
  esac
done
[ ${#MINS[@]} -gt 0 ] || MINS=(0.1.4 0.1.6)

# Accept "prod", "nexus-app:prod", or an image id.
case "$CAND" in
  *:*|sha256*) IMG="$CAND" ;;
  *) IMG="nexus-app:$CAND" ;;
esac
docker image inspect "$IMG" >/dev/null 2>&1 || { echo "candidate image not found: $IMG"; exit 2; }
IMG_ID=$(docker image inspect "$IMG" --format '{{.Id}}')

RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
OUT="$(mktemp -d "/tmp/nexus-compat-${RUN_ID}.XXXX")"
chmod 755 "$OUT"   # the runner container (uid 1001 image, run as the caller's uid) reads world.json
START_ALL=$(date +%s)
NETS=(); CONTAINERS=()

cleanup() {
  local rc=$?
  for c in "${CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1; done
  for n in "${NETS[@]}"; do docker network rm "$n" >/dev/null 2>&1; done
  if [ "$rc" = "0" ] && [ -z "${COMPAT_KEEP_OUT:-}" ]; then rm -rf "$OUT"; else echo "artifacts kept in $OUT"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say() { printf '\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31mABORT: %s\033[0m\n' "$*"; exit "${2:-4}"; }
t() { echo $(( $(date +%s) - $1 ))s; }

# Leftovers from a run that was SIGKILLed (the trap never ran): labelled, and older than 2 hours.
now=$(date +%s)
for c in $(docker ps -aq --filter label=nexus-compat=1 2>/dev/null); do
  created=$(date -d "$(docker inspect -f '{{.Created}}' "$c")" +%s 2>/dev/null || echo "$now")
  [ $((now - created)) -gt 7200 ] && docker rm -f "$c" >/dev/null 2>&1
done
docker network ls -q --filter label=nexus-compat=1 | while read -r n; do
  [ -z "$(docker network inspect -f '{{range .Containers}}x{{end}}' "$n" 2>/dev/null)" ] && docker network rm "$n" >/dev/null 2>&1
done

echo "candidate: $IMG (${IMG_ID:7:12})   minimum-version passes: ${MINS[*]}"

# ---------- 1. schema + prisma CLI (once per run) ----------
say "schema from the candidate image"
T=$(date +%s)
mkdir -p "$OUT/prisma"
tmpc=$(docker create --label nexus-compat=1 "$IMG") || die "cannot create from $IMG"
docker cp "$tmpc:/app/src/generated/prisma/schema.prisma" "$OUT/prisma/schema.prisma" >/dev/null || { docker rm -f "$tmpc" >/dev/null; die "no schema.prisma inside $IMG"; }
PRISMA_VER=$(docker cp "$tmpc:/app/src/generated/prisma/index.js" - 2>/dev/null | tar -xO 2>/dev/null | grep -o '"clientVersion": "[^"]*"' | head -1 | cut -d'"' -f4)
docker rm -f "$tmpc" >/dev/null
[ -n "$PRISMA_VER" ] || die "cannot read the candidate's Prisma client version"
# Plain object, no import: the config is evaluated by the CLI in /work, where "prisma/config" is not resolvable.
printf 'export default { schema: "schema.prisma", datasource: { url: process.env.DATABASE_URL } }\n' > "$OUT/prisma/prisma.config.mjs"

# The runtime image carries no Prisma CLI, so a version-matched one lives in a cached volume.
# Installing it is the ONLY step with network access, and it runs with no database and no secrets.
VOL="nexus-compat-prisma-$PRISMA_VER"
if ! docker run --rm -v "$VOL:/p" "$NODE_IMAGE" test -x /p/node_modules/.bin/prisma >/dev/null 2>&1; then
  echo "   installing prisma@$PRISMA_VER into volume $VOL (one-time)"
  docker run --rm -v "$VOL:/p" -w /p -e CHECKPOINT_DISABLE=1 "$NODE_IMAGE" \
    sh -c "npm init -y >/dev/null && npm i --no-audit --no-fund prisma@$PRISMA_VER >/dev/null 2>&1" \
    || die "could not install prisma@$PRISMA_VER"
fi
echo "   schema + prisma@$PRISMA_VER ready ($(t $T))"

# Non-secret behaviour keys copied from the live container so the candidate is judged under the same
# rules production runs with. Everything else is left out on purpose (see README → Isolation).
ALLOW_KEYS="ABSENCE_DEDUCTION_START_DATE ATTENDANCE_OUTAGE_DATES APP_TIMEZONE LOG_LEVEL DB_POOL_MAX DB_IDLE_TIMEOUT DB_CONNECT_TIMEOUT"
# Anything that can reach another system. Must never appear in the candidate's env; checked below.
DENY_RE='^(SMTP_|APNS_|SLACK_|WA_WEBHOOK|WHATSAPP|HERMES_|GOOGLE_|SENTRY_|BUFFER_|ORACLE_|GIDEON_|NAS_|CF_TUNNEL|REDIS_|FINANCE_|NEXUS_WA_|NEXUS_SSO|NEXUS_GIDEON|CRON_SECRET|POSTGRES_)'
LIVE_ENV="$OUT/live-allow.env"; : > "$LIVE_ENV"
if docker inspect "$LIVE_CONTAINER" >/dev/null 2>&1; then
  # Held in memory only — the live env contains secrets and is never written to disk.
  LIVE_ALL="$(docker inspect "$LIVE_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}')"
  for k in $ALLOW_KEYS; do printf '%s\n' "$LIVE_ALL" | grep -m1 "^$k=" >> "$LIVE_ENV"; done
  # Report keys that are neither allowed nor known-outward, so a NEW behaviour flag gets classified
  # instead of silently differing between production and this test. Names only, never values.
  UNCLASSIFIED=$(printf '%s\n' "$LIVE_ALL" | cut -d= -f1 | grep -vE "$DENY_RE" \
    | grep -vxE "$(echo $ALLOW_KEYS | tr ' ' '|')|PATH|HOSTNAME|NODE_VERSION|YARN_VERSION|NODE_ENV|PORT|DATABASE_URL|AUTH_SECRET|AUTH_TRUST_HOST|NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|NEXT_TELEMETRY_DISABLED|NEXUS_PUBLIC_URL|WA_DELIVERY_DISABLED|APP_NAME|APP_PORT|NEXUS_DATA_DIR|BACKUP_DIR|ATTENDANCE_SILENT_CORRECTION_ADMINS|NEXUS_IOS_MIN_VERSION" | tr '\n' ' ')
  unset LIVE_ALL
  UNCLASSIFIED="$(echo $UNCLASSIFIED)"
  [ -n "$UNCLASSIFIED" ] && echo "   NOTE live env keys not classified by the harness (not passed): $UNCLASSIFIED"
else
  echo "   NOTE: $LIVE_CONTAINER not found — running with harness defaults only"
fi

HOST_IPS="$( { hostname -I 2>/dev/null | tr ' ' '\n'; ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; } | grep -vE '^(127\.|$)' | sort -u | tr '\n' ' ')"
# On an --internal network every outward DNS lookup can only time out. musl's default is 5 s per
# lookup, and the app does one per check-in/izin (reverse geocode), which made a run 70 s longer for
# nothing. Fail fast instead; names on the compat network itself (db, app) still resolve instantly.
DNS_OPTS="--dns-opt timeout:1 --dns-opt attempts:1"

OVERALL=0
declare -A PASS_RC
for MIN in "${MINS[@]}"; do
  echo
  say "PASS min-version $MIN"
  P0=$(date +%s)
  TAG="${RUN_ID}-${MIN//./}"
  NET="nexus-compat-$TAG"; DB="nexus-compat-db-$TAG"; APP="nexus-compat-app-$TAG"
  DBPW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
  DBURL="postgresql://compat:${DBPW}@db:5432/compat"

  # ---------- 2. isolated network + empty database ----------
  docker network create --internal --label nexus-compat=1 "$NET" >/dev/null || die "network create failed"
  NETS+=("$NET")
  docker run -d --name "$DB" --label nexus-compat=1 --network "$NET" --network-alias db \
    -e POSTGRES_USER=compat -e POSTGRES_PASSWORD="$DBPW" -e POSTGRES_DB=compat \
    --tmpfs /var/lib/postgresql/data:rw,size=512m "$PG_IMAGE" >/dev/null || die "postgres start failed"
  CONTAINERS+=("$DB")
  for i in $(seq 1 40); do docker exec "$DB" pg_isready -q -U compat -d compat -h 127.0.0.1 && break; sleep 0.5; done
  docker exec "$DB" pg_isready -q -U compat -d compat -h 127.0.0.1 || die "postgres not ready"

  # ---------- 3. egress check: nothing on this network can leave it ----------
  X=$(date +%s)
  docker run --rm --label nexus-compat=1 --network "$NET" $DNS_OPTS -e PROBE_HOST_IPS="$HOST_IPS" \
    -v "$HERE:/compat:ro" --entrypoint node "$IMG" /compat/egress-check.mjs > "$OUT/egress-$MIN.txt" 2>&1
  erc=$?
  echo "   $(tail -1 "$OUT/egress-$MIN.txt") ($(t $X))"
  [ "$erc" = "0" ] || { cat "$OUT/egress-$MIN.txt"; die "network is not isolated — refusing to start the candidate" 3; }

  # ---------- 4. schema ----------
  X=$(date +%s)
  docker run --rm --label nexus-compat=1 --network "$NET" -v "$VOL:/p:ro" -v "$OUT/prisma:/work" -w /work \
    -e CHECKPOINT_DISABLE=1 -e PRISMA_HIDE_UPDATE_MESSAGE=1 -e DATABASE_URL="$DBURL" \
    "$NODE_IMAGE" /p/node_modules/.bin/prisma db push --config /work/prisma.config.mjs > "$OUT/dbpush-$MIN.txt" 2>&1 \
    || { cat "$OUT/dbpush-$MIN.txt"; die "prisma db push failed against the throwaway DB"; }
  echo "   schema applied: prisma db push ($(t $X))"

  # ---------- 5. seed ----------
  X=$(date +%s)
  docker run --rm --label nexus-compat=1 --network "$NET" -e DATABASE_URL="$DBURL" -w /app \
    -v "$HERE:/compat:ro" --entrypoint node "$IMG" /compat/seed.cjs > "$OUT/seed-$MIN.txt" 2>&1 \
    || { cat "$OUT/seed-$MIN.txt"; die "seed failed"; }
  tail -1 "$OUT/seed-$MIN.txt" > "$OUT/world.json"
  echo "   seeded: 1 workspace, 1 office, BoD + manager + $(grep -o '"staff-' "$OUT/world.json" | wc -l) staff ($(t $X))"

  # ---------- 6. candidate app ----------
  ENVF="$OUT/app-$MIN.env"
  {
    echo "NODE_ENV=production"
    echo "PORT=3000"
    echo "HOSTNAME=0.0.0.0"
    echo "NEXT_TELEMETRY_DISABLED=1"
    echo "DATABASE_URL=$DBURL"
    echo "AUTH_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
    echo "AUTH_TRUST_HOST=true"
    # Same shape as production (the app is reached through a proxy; NEXTAUTH_URL is its own loopback).
    echo "NEXTAUTH_URL=http://127.0.0.1:3002"
    echo "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3002"
    echo "NEXUS_PUBLIC_URL=https://nexus.compat.invalid"
    echo "WA_DELIVERY_DISABLED=1"
    echo "NEXUS_IOS_MIN_VERSION=$MIN"
    cat "$LIVE_ENV"
  } > "$ENVF"
  grep -E "$DENY_RE" "$ENVF" && die "an outward/secret key reached the candidate env file"
  X=$(date +%s)
  docker run -d --name "$APP" --label nexus-compat=1 --network "$NET" --network-alias app $DNS_OPTS \
    --env-file "$ENVF" -w /app --entrypoint node "$IMG" server.js >/dev/null || die "candidate app failed to start"
  CONTAINERS+=("$APP")
  ok=0
  for i in $(seq 1 60); do
    if docker exec "$APP" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = "1" ] || { docker logs --tail 60 "$APP"; die "candidate never became healthy against the throwaway DB"; }
  echo "   candidate healthy ($(t $X); pass setup $(t $P0))"

  # ---------- 7. replay fixtures ----------
  docker run --rm --label nexus-compat=1 --network "$NET" --user "$(id -u):$(id -g)" -v "$HERE:/compat:ro" -v "$OUT:/out" \
    -e COMPAT_BASE=http://app:3000 -e COMPAT_MIN_VERSION="$MIN" -e COMPAT_OUT=/out \
    -e COMPAT_PROFILES_RUN="${COMPAT_PROFILES_RUN:-}" \
    --entrypoint node "$IMG" /compat/runner.mjs
  rc=$?
  PASS_RC[$MIN]=$rc
  docker logs "$APP" > "$OUT/app-$MIN.log" 2>&1
  if [ "$rc" != "0" ]; then
    OVERALL=1
    echo "   --- candidate log (errors) ---"
    grep -iE "error|unhandled|exception" "$OUT/app-$MIN.log" | tail -25 | sed 's/^/   /'
  fi

  # Tear this pass down now; the trap is the backstop.
  docker rm -f "$APP" "$DB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  echo "   pass min-version $MIN: $([ "$rc" = 0 ] && echo OK || echo REGRESSION) ($(t $P0))"
done

echo
for MIN in "${MINS[@]}"; do echo "min-version $MIN -> $([ "${PASS_RC[$MIN]}" = 0 ] && echo OK || echo REGRESSION)"; done
echo "total $(t $START_ALL)"
[ "$OVERALL" = "0" ] && printf '\033[32mCOMPAT OK — released clients keep working with %s\033[0m\n' "$IMG" \
  || printf '\033[31mCOMPAT FAILED — do not deploy %s\033[0m\n' "$IMG"
exit "$OVERALL"
