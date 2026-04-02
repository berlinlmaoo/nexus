#!/bin/zsh
set -eu

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DOCKER_BIN="/usr/local/bin/docker"
CONTAINER_NAME="nexus-app-1"

if ! "$DOCKER_BIN" desktop status >/dev/null 2>&1; then
  open -gj -a Docker
fi

attempt=0
until "$DOCKER_BIN" info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Docker Desktop did not become ready in time" >&2
    exit 1
  fi
  sleep 5
done

if "$DOCKER_BIN" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  "$DOCKER_BIN" start "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi
