#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/jagainmacmini1/Documents/nexus"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${CF_TUNNEL_TOKEN:-}" ]]; then
  echo "CF_TUNNEL_TOKEN is required in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$REPO_DIR/var/logs"

args=(tunnel --no-autoupdate)

if [[ -n "${CF_TUNNEL_METRICS:-}" ]]; then
  args+=(--metrics "$CF_TUNNEL_METRICS")
fi

if [[ -n "${CF_TUNNEL_URL:-}" ]]; then
  args+=(--url "$CF_TUNNEL_URL")
fi

if [[ -n "${CF_TUNNEL_HTTP_HOST_HEADER:-}" ]]; then
  args+=(--http-host-header "$CF_TUNNEL_HTTP_HOST_HEADER")
fi

args+=(run --token "$CF_TUNNEL_TOKEN")

exec /opt/homebrew/bin/cloudflared "${args[@]}"
