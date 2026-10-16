#!/bin/sh
# Xcode Cloud: runs after the clone, before the build. The project is generated (NEXUS.xcodeproj is not
# committed), so install XcodeGen and generate it here. On branch dev the build carries NEXUS_DEV_SERVER:
# its Dev server address comes from the secret environment variable NEXUS_DEV_SERVER_URL (set in the
# Xcode Cloud workflow, never in the repo), written where the "Dev server address" build phase reads it.
set -eu
brew install xcodegen
cd "$CI_PRIMARY_REPOSITORY_PATH/apps/ios"
xcodegen generate
if [ -n "${NEXUS_DEV_SERVER_URL:-}" ]; then
  mkdir -p "$HOME/.config/nexus"
  printf '%s\n' "$NEXUS_DEV_SERVER_URL" > "$HOME/.config/nexus/ios-dev-server-url"
fi
