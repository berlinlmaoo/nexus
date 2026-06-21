#!/bin/sh
# Deploy the Phaëthon (BoD) frontend in one shot:
#   1. build the production bundle (apps/nexus-lovable-ui → dist/)
#   2. restart the launchd `vite preview` service that serves :4178
#   3. wait until :4178 is healthy again
#
# nexusdev.patsgroup.id → cloudflared → :4178 (vite preview, prod-backed /api on :3002).
# Run from anywhere:  sh scripts/deploy-phaethon.sh
set -eu

REPO="/Users/jagainmacmini1/Documents/nexus"
APP="$REPO/apps/nexus-lovable-ui"
SERVICE="com.nexus.phaethon-preview"
PORT=4178

echo "==> [1/3] Building Phaëthon (production bundle)…"
cd "$APP"
npm run build

echo "==> [2/3] Restarting preview service ($SERVICE)…"
# kickstart -k = kill the running instance and start a fresh one (picks up new dist)
launchctl kickstart -k "gui/$(id -u)/$SERVICE"

echo "==> [3/3] Waiting for :$PORT to come back…"
i=0
while [ "$i" -lt 30 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    api=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/auth/providers" 2>/dev/null || echo 000)
    echo "==> ✅ Phaëthon live: GET / = $code, /api proxy = $api"
    echo "    nexusdev.patsgroup.id now serving the new build."
    exit 0
  fi
  i=$((i + 1)); sleep 1
done

echo "==> ⚠️  :$PORT did not return 200 after 30s. Check: launchctl print gui/$(id -u)/$SERVICE"
echo "    Logs: ~/Library/Logs/nexus-phaethon-preview.log"
exit 1
