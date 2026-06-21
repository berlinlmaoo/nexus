#!/bin/sh
# Promote the CURRENTLY-STAGED build to PRODUCTION (nexus.patsgroup.id).
# Assumes you already ran deploy-staging.sh and verified it on nexusdev.patsgroup.id.
#   1. retag nexus-app:staging  ->  nexus-app:prod   (no rebuild)
#   2. recreate the prod backend (nexus-app-beta, :3002) with that image  [brief :3002 blip]
#   3. publish the staging frontend: dist-staging/ -> dist/  (nginx :3000 serves dist/ live)
#
# Rollback: prod backend keeps the previous image layers; to revert frontend, restore dist/
# from git or a backup. Run from anywhere:  sh scripts/promote-to-prod.sh
set -eu

REPO="/Users/jagainmacmini1/Documents/nexus"
APP="$REPO/apps/nexus-lovable-ui"
cd "$REPO"

if ! docker image inspect nexus-app:staging >/dev/null 2>&1; then
  echo "!! nexus-app:staging not found — run scripts/deploy-staging.sh first." >&2
  exit 1
fi
if [ ! -f "$APP/dist-staging/index.html" ]; then
  echo "!! dist-staging/ missing — run scripts/deploy-staging.sh first." >&2
  exit 1
fi

printf "About to promote staging -> PROD (nexus.patsgroup.id). Continue? [y/N] "
read ans
case "$ans" in y|Y|yes|YES) ;; *) echo "aborted."; exit 0;; esac

echo "==> [1/3] Retagging nexus-app:staging -> nexus-app:prod…"
docker tag nexus-app:staging nexus-app:prod

echo "==> [2/3] Recreating prod backend (nexus-app-beta, :3002)…"
docker compose -p nexus-beta -f docker-compose.beta.yml --env-file .env.production up -d --no-build --force-recreate app-beta

echo "    waiting for :3002 backend…"
i=0
while [ "$i" -lt 40 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3002/api/auth/session" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "    ✅ prod backend :3002 healthy"; break; }
  i=$((i + 1)); sleep 2
done

echo "==> [3/3] Publishing frontend dist-staging/ -> dist/…"
rsync -a --delete "$APP/dist-staging/" "$APP/dist/"

echo "==> ✅ PROMOTED. nexus.patsgroup.id now on the staged build (backend :3002 + dist/)."
echo "    verify: curl -s -o /dev/null -w '%{http_code}' https://nexus.patsgroup.id/"
