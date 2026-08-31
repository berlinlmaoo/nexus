#!/usr/bin/env bash
# Safe recreate of the live nexus-app-beta (:3002) onto the freshly-built nexus-app:prod image.
# Rename-rollback + health gate: if the new container isn't healthy in ~40s, we auto-restore the old one.
# Env is captured from the live container (has DATABASE_URL/secrets) into a temp file, never printed.
set -uo pipefail
C=nexus-app-beta
IMG=nexus-app:prod
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/var/uploads"
PROD_ENV="$ROOT/.env.production"
APNS_KEY_FILE="/etc/nexus/secrets/AuthKey_9PTCKVB26P.p8"
ENVF="$(mktemp /tmp/beta-env.XXXXXX)"
HEALTH="http://127.0.0.1:3002/api/health"

cleanup(){ rm -f "$ENVF"; }
trap cleanup EXIT

# 0) pre-check: the health endpoint must be 200 NOW, or our gate is meaningless.
pre=$(curl -s -o /dev/null -w '%{http_code}' -m 6 "$HEALTH" || echo 000)
echo "pre-check $HEALTH -> $pre"
[ "$pre" = "200" ] || { echo "ABORT: health endpoint not 200 before deploy; not touching anything."; exit 1; }

OLD_IMG=$(docker inspect "$C" --format '{{.Image}}')
NEW_IMG=$(docker inspect "$IMG" --format '{{.Id}}')
echo "running img=${OLD_IMG:0:19}  built $IMG=${NEW_IMG:0:19}"
[ "$OLD_IMG" != "$NEW_IMG" ] || echo "note: same image id (re-running to fix env — not a new build)."

# 0b) NETWORKS — read them off the live container instead of hardcoding.
#     The name used to be baked in as `nexus_nexus_internal`, but the live stack actually sits on
#     `nexus_internal`, and `docker compose` happily CREATES an empty `<project>_nexus_internal` the
#     first time you run anything from the compose file. Deploying onto that empty network gives a
#     container that can't resolve `postgres`: /api/health returns 503, the gate rolls back, and the
#     failure looks like a bad build instead of a bad network. Capture BEFORE the rename below.
NETS=$(docker inspect "$C" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
PRIMARY_NET=$(printf '%s\n' $NETS | head -1)
[ -n "$PRIMARY_NET" ] || { echo "ABORT: can't read networks off $C"; exit 1; }
echo "networks: $NETS(primary: $PRIMARY_NET)"

# 1) capture env (secrets — not printed). The snapshot is whatever the RUNNING container was created
#    with, so anything added to .env.production SINCE then is missing — that's how NEXUS_SSO_SECRET
#    once shipped as a 503. So carry over every key .env.production has that the runtime doesn't.
#    Runtime values always win (we only add what's absent), so a var that intentionally differs at
#    runtime — NEXTAUTH_URL, NEXT_PUBLIC_APP_URL — is never clobbered by the file's version.
#
#    EXCEPTION: the keys listed below may also be OVERRIDDEN by the file, not just filled in.
#    Runtime-wins is right for secrets (a rotated one must not be clobbered by a stale file) and for
#    NEXTAUTH_URL / NEXT_PUBLIC_APP_URL (this container really is reached at 127.0.0.1:3002). But it
#    also meant editing a plain config value in .env.production silently did nothing, forever — which
#    is how emailed links kept pointing at a retired domain long after it was changed. Keep this list
#    tiny and non-secret; anything not named here follows the old rule.
OVERRIDABLE="NEXUS_PUBLIC_URL"

docker inspect "$C" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENVF"
carried=0
overridden=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
    [A-Za-z_]*=*) key="${line%%=*}" ;;
    *) continue ;;
  esac
  if grep -q -- "^${key}=" "$ENVF"; then
    case " $OVERRIDABLE " in
      *" $key "*)
        grep -v -- "^${key}=" "$ENVF" > "${ENVF}.tmp" && mv "${ENVF}.tmp" "$ENVF"
        printf '%s\n' "$line" >> "$ENVF"
        overridden=$((overridden+1))
        ;;
    esac
  else
    printf '%s\n' "$line" >> "$ENVF"; carried=$((carried+1))
  fi
done < "$PROD_ENV"
echo "captured $(wc -l < "$ENVF" | tr -d ' ') env vars (+${carried} carried over, ${overridden} overridden from .env.production)"

# The key is 600 root:root inside a 700 root:root directory, so a non-root user can't even stat it —
# `-s` then fails for a file that is perfectly fine, and the old message blamed the file.
[ -s "$APNS_KEY_FILE" ] || {
  echo "ABORT: APNs key not readable at $APNS_KEY_FILE"
  echo "       If the file IS there, this is permissions (700 root:root dir, 600 root:root file)."
  echo "       Re-run as root:  sudo $0"
  exit 1
}

# ...and readable BY THE CONTAINER, which is the part that actually matters. The app runs as
# `nextjs` (uid 1001, Dockerfile.prod), so a key left at the documented 600 root:root is mounted
# fine and still unreadable inside. apns.ts swallows that: providerJWT() returns null, every
# sendPushToUser() returns immediately, and push dies SILENTLY — one log line, zero user-visible
# symptoms. Deploying that state looks like a total success. Cheap check, catches it every time.
docker run --rm -v "$APNS_KEY_FILE:/k.p8:ro" --entrypoint sh "$IMG" \
  -c 'head -c 1 /k.p8 >/dev/null 2>&1' || {
  echo "ABORT: APNs key exists but uid 1001 (the app user) cannot read it."
  echo "       Push would fail silently. Fix:"
  echo "         sudo chown root:1001 $APNS_KEY_FILE"
  echo "         sudo chmod 640 $APNS_KEY_FILE"
  exit 1
}

# 2) rename old -> prev + stop (this is the start of the blip)
docker rename "$C" "${C}-prev" && docker stop "${C}-prev" >/dev/null
echo "old renamed -> ${C}-prev + stopped"

# 3) run new with the SAME networks/ports/mounts
docker run -d --name "$C" --restart unless-stopped \
  --network "$PRIMARY_NET" \
  -p 127.0.0.1:3002:3000 \
  --env-file "$ENVF" \
  -e APNS_PRIVATE_KEY_PATH=/run/secrets/apns.p8 \
  -w /app --entrypoint node \
  -v "$APNS_KEY_FILE:/run/secrets/apns.p8:ro" \
  -v "$BASE/avatars:/app/public/uploads/avatars" \
  -v "$BASE/project-icons:/app/public/uploads/project-icons" \
  -v "$BASE/feed:/app/public/uploads/feed" \
  -v "$BASE/peer-reports:/app/public/uploads/peer-reports" \
  -v "$BASE/attachments:/app/public/uploads/attachments" \
  -v "$BASE/attendance:/app/public/uploads/attendance" \
  -v "$BASE/complaints:/app/public/uploads/complaints" \
  "$IMG" server.js >/dev/null && echo "new container started"

# Re-attach every OTHER network the old container had (docker run only takes one).
for n in $NETS; do
  [ "$n" = "$PRIMARY_NET" ] && continue
  docker network connect "$n" "$C" 2>/dev/null && echo "attached $n"
done

# 4) health gate (~40s)
ok=0
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH" || echo 000)
  [ "$code" = "200" ] && { ok=1; echo "health 200 after ${i} tries"; break; }
  sleep 2
done

if [ "$ok" = "1" ]; then
  docker rm "${C}-prev" >/dev/null 2>&1
  echo "✅ DEPLOYED (new image live, prev removed)"
else
  echo "⚠️ health FAILED — rolling back to previous container"
  docker stop "$C" >/dev/null 2>&1; docker rm "$C" >/dev/null 2>&1
  docker rename "${C}-prev" "$C" && docker start "$C" >/dev/null
  docker network connect nexus-beta_nexus_beta "$C" 2>/dev/null || true
  echo "↩︎ ROLLED BACK (previous container restored)"
  exit 1
fi
