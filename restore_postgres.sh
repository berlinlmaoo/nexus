#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"

if [ $# -lt 1 ]; then
  echo "Usage: ./restore_postgres.sh /absolute/or/relative/path/to/backup.sql.gz [--yes]"
  exit 1
fi

BACKUP_FILE="$1"
CONFIRM="${2:-}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo "This will stop the Nexus app and replace the current PostgreSQL database with:"
  echo "  $BACKUP_FILE"
  printf "Type 'yes' to continue: "
  read -r answer
  [ "$answer" = "yes" ] || exit 1
fi

set -a
. "$ENV_FILE"
set +a

echo "Stopping app before restore"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop app

echo "Ensuring PostgreSQL is running"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

echo "Terminating current database sessions"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "PGPASSWORD=\"$POSTGRES_PASSWORD\" psql -U \"$POSTGRES_USER\" -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();\""

echo "Recreating database"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "PGPASSWORD=\"$POSTGRES_PASSWORD\" psql -U \"$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS \\\"$POSTGRES_DB\\\";\""
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "PGPASSWORD=\"$POSTGRES_PASSWORD\" psql -U \"$POSTGRES_USER\" -d postgres -c \"CREATE DATABASE \\\"$POSTGRES_DB\\\" OWNER \\\"$POSTGRES_USER\\\";\""

echo "Restoring backup"
gunzip -c "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "PGPASSWORD=\"$POSTGRES_PASSWORD\" psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\""

echo "Running Prisma deploy flow after restore"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate

echo "Starting app again"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d app

echo "Restore completed."
