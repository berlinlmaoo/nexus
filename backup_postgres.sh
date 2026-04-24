#!/bin/sh
set -eu

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

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
DAILY_DIR="$BACKUP_DIR/daily"
WEEKLY_DIR="$BACKUP_DIR/weekly"
STAMP="$(date +"%Y-%m-%d_%H%M%S")"
DAY_FILE="$DAILY_DIR/nexus_${STAMP}.sql.gz"
WEEK_FILE="$WEEKLY_DIR/nexus_week_$(date +"%Y-W%V").sql.gz"
TMP_SQL="$(mktemp "${TMPDIR:-/tmp}/nexus-backup.XXXXXX.sql")"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

cleanup() {
  rm -f "$TMP_SQL"
}

trap cleanup EXIT

prune_backups() {
  target_dir="$1"
  keep_count="$2"
  current=0

  for file in $(ls -1t "$target_dir"/*.sql.gz 2>/dev/null); do
    current=$((current + 1))
    if [ "$current" -gt "$keep_count" ]; then
      rm -f "$file"
    fi
  done
}

echo "Creating PostgreSQL backup: $DAY_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps postgres | grep -qE "Up|healthy" || {
  echo "PostgreSQL service is not running. Start the production stack first."
  exit 1
}

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "PGPASSWORD=\"$POSTGRES_PASSWORD\" pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --clean --if-exists --no-owner --no-privileges" \
  > "$TMP_SQL"

[ -s "$TMP_SQL" ] || {
  echo "pg_dump returned an empty backup file. Aborting."
  exit 1
}

gzip -c "$TMP_SQL" > "$DAY_FILE"

chmod 600 "$DAY_FILE"

if [ "$(date +%u)" = "1" ]; then
  cp "$DAY_FILE" "$WEEK_FILE"
  chmod 600 "$WEEK_FILE"
  echo "Weekly snapshot created: $WEEK_FILE"
fi

prune_backups "$DAILY_DIR" 7
prune_backups "$WEEKLY_DIR" 4

if [ -n "${NAS_SSH_HOST:-}" ] && [ -n "${NAS_SSH_USER:-}" ] && [ -n "${NAS_BACKUP_DIR:-}" ]; then
  echo "Copying backup snapshots to NAS"
  ssh "${NAS_SSH_USER}@${NAS_SSH_HOST}" "mkdir -p '${NAS_BACKUP_DIR}'"
  find "$BACKUP_DIR" -type f -name '*.sql.gz' -print | while IFS= read -r backup_file; do
    rel_path="${backup_file#$BACKUP_DIR/}"
    remote_dir="${NAS_BACKUP_DIR}/$(dirname "$rel_path")"
    remote_file="${remote_dir}/$(basename "$backup_file")"
    ssh "${NAS_SSH_USER}@${NAS_SSH_HOST}" "mkdir -p '${remote_dir}'"
    cat "$backup_file" | ssh "${NAS_SSH_USER}@${NAS_SSH_HOST}" "cat > '${remote_file}'"
  done
fi

echo "Backup completed."
