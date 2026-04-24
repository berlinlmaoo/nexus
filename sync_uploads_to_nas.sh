#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "${NAS_SSH_HOST:-}" ] || [ -z "${NAS_SSH_USER:-}" ] || [ -z "${NAS_UPLOADS_DIR:-}" ]; then
  echo "NAS_SSH_HOST, NAS_SSH_USER, and NAS_UPLOADS_DIR must be set to sync uploads."
  exit 1
fi

SOURCE_DIR="${NEXUS_DATA_DIR:-$ROOT_DIR/var}/uploads/"

mkdir -p "$SOURCE_DIR"

ssh "${NAS_SSH_USER}@${NAS_SSH_HOST}" "mkdir -p '${NAS_UPLOADS_DIR}'"
tar -C "$SOURCE_DIR" -cf - . | ssh "${NAS_SSH_USER}@${NAS_SSH_HOST}" "tar -xf - -C '${NAS_UPLOADS_DIR}'"
echo "Upload sync completed."
