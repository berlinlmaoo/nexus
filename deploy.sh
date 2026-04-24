#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Copy .env.example to .env.production and fill the secrets first."
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

export COMPOSE_BAKE=true

echo "==> Building Nexus production image"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app migrate

echo "==> Starting PostgreSQL"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

echo "==> Waiting for PostgreSQL readiness"
i=0
until docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc "pg_isready -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\""; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

echo "==> Running Prisma production deploy flow"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate

echo "==> Starting Nexus app"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d app

echo "==> Running post-deploy healthcheck"
ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/healthcheck.sh"

echo "Deployment completed successfully."
