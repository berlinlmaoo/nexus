#!/usr/bin/env bash
# (Re)create the nexus-face sidecar on nexus-prod. Independent of ~/deploy-nexus.sh, which only
# replaces nexus-app-beta: this container keeps running across app deploys.
#
#   docker build -t nexus-face:latest ~/nexus/face && bash ~/nexus/face/run.sh
#
# Same network as the app (it resolves as http://nexus-face:8080), no published port, and the
# uploads directory read-only at the same path the app sees it.
set -euo pipefail
BASE="$HOME/nexus/var/uploads"
docker rm -f nexus-face >/dev/null 2>&1 || true
docker run -d --name nexus-face --restart unless-stopped \
  --network nexus_internal \
  --memory 1536m --cpus 2 \
  -v "$BASE:/app/public/uploads:ro" \
  nexus-face:latest >/dev/null
echo "nexus-face started"
