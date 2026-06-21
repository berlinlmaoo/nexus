#!/bin/sh
# Deploy the LATEST code to STAGING (nexusdev.patsgroup.id). Prod is NOT touched.
#   1. build the staging backend image (nexus-app:staging) from current src/
#   2. (re)create the nexus-app-staging container on :3004 (shared prod DB)
#   3. build the staging frontend -> apps/nexus-lovable-ui/dist-staging
#   4. restart the vite-preview launchd service (:4178 -> dist-staging -> :3004)
#
# After testing on nexusdev, run scripts/promote-to-prod.sh to ship the same build to prod.
# Run from anywhere:  sh scripts/deploy-staging.sh
set -eu

REPO="/Users/jagainmacmini1/Documents/nexus"
APP="$REPO/apps/nexus-lovable-ui"
SERVICE="com.nexus.phaethon-preview"

echo "==> [1/4] Building staging backend image (nexus-app:staging)…"
cd "$REPO"
docker compose -p nexus-staging -f docker-compose.staging.yml --env-file .env.production build app-staging

echo "==> [2/4] (Re)creating nexus-app-staging (:3004)…"
docker compose -p nexus-staging -f docker-compose.staging.yml --env-file .env.production up -d --force-recreate app-staging

echo "    waiting for :3004 backend…"
i=0
while [ "$i" -lt 40 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/auth/session" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "    ✅ backend :3004 healthy"; break; }
  i=$((i + 1)); sleep 2
done

echo "==> [3/4] Building staging frontend -> dist-staging…"
cd "$APP"
npx vite build --outDir dist-staging

echo "==> [4/4] Restarting vite-preview ($SERVICE)…"
launchctl kickstart -k "gui/$(id -u)/$SERVICE"

echo "    waiting for :4178…"
i=0
while [ "$i" -lt 30 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4178/" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "==> ✅ STAGING live: nexusdev.patsgroup.id (build + backend :3004)"; exit 0; }
  i=$((i + 1)); sleep 1
done
echo "==> ⚠️ :4178 not 200 yet — check launchd log: ~/Library/Logs/nexus-phaethon-preview.log"
exit 1
