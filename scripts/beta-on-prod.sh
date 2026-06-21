#!/usr/bin/env bash
# Repoint the Phaethon backend (nexus-app-beta, :3002) from the CLONE DB to the
# REAL PROD DB + shared prod uploads. Result: staff use NEXUS (:3000) and BoD use
# Phaethon — BOTH on one prod database. Old :3000 app is NOT touched (fallback).
set -euo pipefail

ROOT="/Users/jagainmacmini1/Documents/nexus"
NET="nexus_nexus_internal"        # prod network (where host 'postgres' = prod DB resolves)
BETA_DOMAIN="https://nexusdev.patsgroup.id"
UP="$ROOT/var/uploads"            # PROD uploads (shared with :3000)

echo "=== stopping old beta backend (clone-DB) ==="
docker rm -f nexus-app-beta 2>/dev/null || true

echo "=== starting Phaethon backend on PROD DB + shared uploads ==="
docker run -d --name nexus-app-beta --restart unless-stopped \
  --network "$NET" \
  --env-file "$ROOT/.env.production" \
  -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  -e NEXTAUTH_URL="$BETA_DOMAIN" -e AUTH_URL="$BETA_DOMAIN" \
  -e NEXT_PUBLIC_APP_URL="$BETA_DOMAIN" -e AUTH_TRUST_HOST=true \
  -p 127.0.0.1:3002:3000 \
  -w /app/.next/standalone \
  -v "$UP/attachments:/app/.next/standalone/public/uploads/attachments" \
  -v "$UP/attendance:/app/.next/standalone/public/uploads/attendance" \
  -v "$UP/avatars:/app/.next/standalone/public/uploads/avatars" \
  -v "$UP/project-icons:/app/.next/standalone/public/uploads/project-icons" \
  --entrypoint node \
  nexus-app:beta server.js

echo "=== waiting for health ==="
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/api/health || echo 000)
  echo "  try $i: :3002/api/health -> $code"
  [ "$code" = "200" ] && break
  sleep 2
done

echo "=== state ==="
docker ps --filter name=nexus-app-beta --format '{{.Names}}  {{.Status}}'
echo "prod :3000  -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo 000)  (staff, untouched)"
echo "beta :3002  -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/api/health || echo 000)  (BoD / Phaethon, now on PROD DB)"
echo "--- if beta != 200, last logs: ---"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/api/health || echo 000)" != "200" ] && docker logs --tail 20 nexus-app-beta 2>&1 || true
