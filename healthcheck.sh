#!/bin/sh
set -eu

MODE="${1:-host}"

if [ "$MODE" = "container" ]; then
  wget -q -O /dev/null "http://127.0.0.1:3000/api/health"
  exit 0
fi

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

APP_URL="${APP_HEALTHCHECK_URL:-http://127.0.0.1:${APP_PORT:-3000}/api/health}"

echo "Checking Docker services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "Checking application health endpoint: $APP_URL"
curl --fail --silent --show-error "$APP_URL"
echo
echo "Healthcheck passed."
