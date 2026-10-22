#!/bin/bash
# Pipeline v8 DEV acceptance screenshots, one simulator at a time under the owner's Mac lock.
# Usage: pipeline-v8-tour.sh [iphone|ipad|all] [en|id|all]
# Set NEXUS_QA_PIPELINE_BOARD to a DEV QA board accessible by qa5 and qa2.
# Set PIPELINE_V8_SKIP_BUILD=1 to reuse an already built NEXUSUITour product.
# Optional run plan: PIPELINE_V8_RUNS='iphone:id:testManager ipad:en ipad:id'.
set -euo pipefail
cd "$(dirname "$0")/.."
PIPELINE_V8_DEVICE="${1:-all}"
PIPELINE_V8_LANG="${2:-all}"
PIPELINE_V8_OUT="${PIPELINE_V8_OUT:-/Volumes/BerlinExtreme/nexus-pipeline-v8}"
PIPELINE_V8_DERIVED="${PIPELINE_V8_DERIVED:-/Volumes/BerlinExtreme/dd-pipeline-v8}"
pipeline_runs=()
if [ -n "${PIPELINE_V8_RUNS:-}" ]; then
  read -r -a pipeline_runs <<< "${PIPELINE_V8_RUNS//$'\n'/ }"
else
  for platform in iphone ipad; do
    [ "$PIPELINE_V8_DEVICE" = all ] || [ "$PIPELINE_V8_DEVICE" = "$platform" ] || continue
    for language in en id; do
      [ "$PIPELINE_V8_LANG" = all ] || [ "$PIPELINE_V8_LANG" = "$language" ] || continue
      pipeline_runs+=("$platform:$language")
    done
  done
fi
[ "${#pipeline_runs[@]}" -gt 0 ] || { echo 'No valid device/language sessions selected.'; exit 2; }
mkdir -p "$PIPELINE_V8_OUT"
PIPELINE_V8_BOOTED=""
PIPELINE_V8_OWNS_FIXTURE=0
pipeline_xb=""
cleanup() {
  trap '' INT TERM HUP
  if [ -n "$pipeline_xb" ]; then
    kill -TERM "$pipeline_xb" 2>/dev/null || true
    wait "$pipeline_xb" 2>/dev/null || true
    pipeline_xb=""
  fi
  if [ -n "$PIPELINE_V8_BOOTED" ]; then xcrun simctl shutdown "$PIPELINE_V8_BOOTED" >/dev/null 2>&1 || true; fi
  if [ "$PIPELINE_V8_OWNS_FIXTURE" = 1 ]; then python3 scripts/pipeline-v8-fixture.py cleanup "$PIPELINE_V8_FIXTURE" || true; fi
  python3 -c 'from pathlib import Path; import sys; p=Path("/tmp/mac-sim.lock"); p.unlink() if p.exists() and p.read_text().strip() == sys.argv[1] else None' "$$"
}
trap cleanup EXIT
trap 'echo "Received SIGINT; stopping Pipeline v8 tour." >&2; exit 130' INT
trap 'echo "Received SIGTERM; stopping Pipeline v8 tour." >&2; exit 143' TERM
trap 'echo "Received SIGHUP; stopping Pipeline v8 tour." >&2; exit 129' HUP
while ! shlock -f /tmp/mac-sim.lock -p $$; do
  echo 'Mac build/simulator lock is held; retrying in 60 seconds.'
  sleep 60
done
echo 'Acquired /tmp/mac-sim.lock'
check_internal_space() {
  local free_kb minimum_gib="${1:-6}"
  free_kb=$(df -k / | awk 'NR==2 { print $4 }')
  [ "$free_kb" -ge $(( minimum_gib * 1024 * 1024 )) ] || { echo "Internal disk has less than $minimum_gib GiB available."; exit 2; }
}
check_internal_space
if [ -z "${TOUR_PASSWORD:-}" ]; then
  TOUR_PASSWORD="$(security find-generic-password -s nexus-ui-tour -a qa5@dev.invalid -w 2>/dev/null || true)"
fi
if [ -z "${TOUR_PASSWORD:-}" ] && [ -f "$HOME/.config/nexus/qa5-dev-password" ]; then
  TOUR_PASSWORD="$(cat "$HOME/.config/nexus/qa5-dev-password")"
fi
[ -n "${TOUR_PASSWORD:-}" ] || { echo 'QA credential is unavailable.'; exit 2; }
export TOUR_PASSWORD
export TEST_RUNNER_TOUR_PASSWORD="$TOUR_PASSWORD"
if [ -z "${PIPELINE_V8_FIXTURE:-}" ]; then
  PIPELINE_V8_FIXTURE="$PIPELINE_V8_OUT/qa/tour-fixture-$$.json"
  PIPELINE_V8_OWNS_FIXTURE=1
  python3 scripts/pipeline-v8-fixture.py prepare "$PIPELINE_V8_FIXTURE"
fi
export TEST_RUNNER_PIPELINE_V8_BOARD_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["boardId"])' "$PIPELINE_V8_FIXTURE")"
export TEST_RUNNER_PIPELINE_V8_BOARD_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["boardName"])' "$PIPELINE_V8_FIXTURE")"
export TEST_RUNNER_PIPELINE_V8_DEAL_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["festivalId"])' "$PIPELINE_V8_FIXTURE")"
export TEST_RUNNER_PIPELINE_V8_EMPTY_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["emptyId"])' "$PIPELINE_V8_FIXTURE")"
if [ "${PIPELINE_V8_SKIP_BUILD:-0}" != 1 ]; then
  check_internal_space
  xcodegen generate --quiet
  xcodebuild build-for-testing -project NEXUS.xcodeproj -scheme NEXUSUITour -configuration Debug \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PIPELINE_V8_DERIVED" \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- >"$PIPELINE_V8_OUT/build-tour.log" 2>&1
fi
for pipeline_run in "${pipeline_runs[@]}"; do
  IFS=: read -r platform language pipeline_method <<< "$pipeline_run"
  case "$platform:$language" in
    iphone:en|iphone:id|ipad:en|ipad:id) ;;
    *) echo "Invalid run session: $pipeline_run"; exit 2 ;;
  esac
  case "$pipeline_method" in *:*) echo "Invalid test method: $pipeline_method"; exit 2 ;; esac
  if [[ "$pipeline_run" != *:*:* ]]; then pipeline_method="${PIPELINE_V8_TEST:-}"; fi
  case "$platform" in
    iphone) sim='16BEC04F-EB14-482C-8A9C-1C37338378A8' ;;
    ipad) sim='0E54AFF6-1F7A-42C7-918F-7B3876A29DA1' ;;
  esac
  # Another session never boots while this lock is held. Do not shut down a simulator it left running.
  if xcrun simctl list devices booted | rg -q '\(Booted\)'; then
    echo 'A simulator is already booted; end its session before running this tour.'
    exit 2
  fi
  # A fresh boot per language leaves headroom above the owner's 6 GiB floor.
  check_internal_space 8
  xcrun simctl boot "$sim"
  PIPELINE_V8_BOOTED="$sim"
  xcrun simctl bootstatus "$sim" -b >"$PIPELINE_V8_OUT/$platform-$language-boot.log" 2>&1
  xcrun simctl ui "$sim" appearance light
  xcrun simctl status_bar "$sim" override --time '9:41' --dataNetwork wifi --wifiBars 3 --batteryState charged --batteryLevel 100
  run="$PIPELINE_V8_OUT/$platform-$language"
  mkdir -p "$run"
  direct="$HOME/nexus-ui-tour/pipeline-v8/$platform-$language"
  mkdir -p "$direct"
  export TEST_RUNNER_TOUR_LANG="$language" TEST_RUNNER_TOUR_OUT_DIR="$direct"
  echo "Running $platform / $language"
  test_filter="NEXUSUITour/PipelineV8Tour${pipeline_method:+/$pipeline_method}"
  xcodebuild test-without-building -project NEXUS.xcodeproj -scheme NEXUSUITour \
    -destination "id=$sim" -derivedDataPath "$PIPELINE_V8_DERIVED" \
    -parallel-testing-enabled NO "-only-testing:$test_filter" \
    >"$run/xcodebuild.log" 2>&1 &
  pipeline_xb=$!
  pipeline_done_at=0
  pipeline_heartbeat_at=$(date +%s)
  while kill -0 "$pipeline_xb" 2>/dev/null; do
    pipeline_now=$(date +%s)
    if [ $(( pipeline_now - pipeline_heartbeat_at )) -ge 60 ]; then
      echo "Pipeline v8 tour is still running: $platform / $language."
      pipeline_heartbeat_at=$pipeline_now
    fi
    if rg -q "Test Suite 'Selected tests' (passed|failed)" "$run/xcodebuild.log"; then
      if [ "$pipeline_done_at" = 0 ]; then pipeline_done_at=$pipeline_now; fi
      if [ $(( pipeline_now - pipeline_done_at )) -ge 90 ]; then
        echo 'Tests finished; stopping Xcode after its 90-second finalization wait.'
        kill -TERM "$pipeline_xb" 2>/dev/null || true
        break
      fi
    fi
    sleep 5
  done
  pipeline_rc=0
  wait "$pipeline_xb" || pipeline_rc=$?
  pipeline_xb=""
  cp "$direct/"*.png "$direct/"*.txt "$run/" 2>/dev/null || true
  if [ "$pipeline_rc" != 0 ] && ! rg -q "Test Suite 'Selected tests' passed" "$run/xcodebuild.log"; then
    echo "Failed $platform / $language; see $run/xcodebuild.log"
    exit "$pipeline_rc"
  fi
  echo "Passed $platform / $language"
  xcrun simctl shutdown "$sim"
  PIPELINE_V8_BOOTED=""
done
echo "Screenshots: $PIPELINE_V8_OUT"
