#!/bin/bash
# NEXUS UI screenshot tour: one command, results side by side. Owner guide: docs/UI-TOUR.md.
#
#   scripts/ui-tour.sh                  iPhone 17 Pro Max simulator + dev web (desktop 1440x900, mobile 440x956 @3x)
#   scripts/ui-tour.sh --ipad           … plus the iPad simulator
#   scripts/ui-tour.sh --mac            … plus "My Mac (Mac Catalyst)"
#   scripts/ui-tour.sh --all            iPhone + iPad + Mac + web
#   --only calendar,settings            just these screen ids (scripts/ui-tour-screens.json)
#   --no-web | --web-only | --no-upload | --no-pull | --no-open | --keep-xcresult
#   --set-password                      store the QA password in the macOS Keychain, check it, stop
#
# Order of work: iPhone, web, iPad, Mac. Results: ~/nexus-ui-tour/<timestamp>/index.html, then copied to
# the agents VM (~/ui-tour/<timestamp>/) over Tailscale so Claude can look at them.
#
# The QA password is read from the Keychain (service "nexus-ui-tour"), or TOUR_PASSWORD. Never in git,
# never on the command line of xcodebuild (it travels in the test runner's environment).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
REPO=$(pwd)
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

DO_IPHONE=1 DO_IPAD=0 DO_MAC=0 DO_WEB=1 DO_UPLOAD=1 DO_PULL=1 DO_OPEN=1 KEEP_XCRESULT=0 SET_PASSWORD=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ipad) DO_IPAD=1 ;;
    --mac) DO_MAC=1 ;;
    --all) DO_IPAD=1; DO_MAC=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    --no-web) DO_WEB=0 ;;
    --web-only) DO_IPHONE=0; DO_IPAD=0; DO_MAC=0 ;;
    --no-upload) DO_UPLOAD=0 ;;
    --no-pull) DO_PULL=0 ;;
    --no-open) DO_OPEN=0 ;;
    --watch) export TOUR_WATCH=1 ;;   # (default) visible Chrome for the web half
    --headless) TOUR_HEADLESS=1 ;;   # no Chrome window
    --keep-xcresult) KEEP_XCRESULT=1 ;;
    --set-password) SET_PASSWORD=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)"; exit 2 ;;
  esac
  shift
done

TOUR_EMAIL="${TOUR_EMAIL:-qa5@dev.invalid}"
# Owner: watch the web half in a real Chrome window by default (--headless hides it).
if [ "${TOUR_HEADLESS:-0}" = 1 ]; then unset TOUR_WATCH; else export TOUR_WATCH=1; fi
KC_SERVICE="nexus-ui-tour"
UPLOAD_HOST="${UI_TOUR_HOST:-debian@100.66.244.85}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="${UI_TOUR_OUT:-$HOME/nexus-ui-tour}/$STAMP"
WORK="$OUT/.work"
TOOLS="$REPO/scripts/ui-tour-web/tools.mjs"
SUMMARY=()

say() { printf '[ui-tour] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "MISSING: $1 — $2"; exit 2; }; }

need node "install Node.js (it is expected in ~/.local/bin)"
need security "this script runs on macOS"

# ------------------------------------------------------------------------------------------- credentials
keychain_password() { security find-generic-password -s "$KC_SERVICE" -a "$TOUR_EMAIL" -w 2>/dev/null; }
ask_password() {
  [ -t 0 ] || return 1
  local pw
  printf 'QA password for %s (the one Claude gave you; typing is hidden): ' "$TOUR_EMAIL" >&2
  IFS= read -rs pw; echo >&2
  [ -n "$pw" ] || return 1
  security add-generic-password -U -s "$KC_SERVICE" -a "$TOUR_EMAIL" -l "NEXUS UI tour ($TOUR_EMAIL)" -w "$pw" >/dev/null || return 1
  TOUR_PASSWORD="$pw"
}

if [ "$SET_PASSWORD" = 1 ]; then
  ask_password || { say "no password stored (run this in a Terminal window, not through an agent)"; exit 1; }
  export TOUR_EMAIL TOUR_PASSWORD
  node "$TOOLS" check-login
  exit $?
fi

TOUR_PASSWORD="${TOUR_PASSWORD:-$(keychain_password)}"
if [ -z "$TOUR_PASSWORD" ]; then
  ask_password || {
    say "No QA password yet. Once, in a Terminal window:  $REPO/scripts/ui-tour.sh --set-password"
    exit 1
  }
fi
export TOUR_EMAIL TOUR_PASSWORD

mkdir -p "$OUT/logs" "$WORK"
say "results → $OUT"

# ------------------------------------------------------------------------------------------- repo + check
if [ "$DO_PULL" = 1 ]; then
  if git pull --ff-only -q >"$OUT/logs/git.log" 2>&1; then say "git pull: $(git log -1 --format='%h %s' | cut -c1-70)"
  else say "git pull failed (local changes?) — continuing with what is checked out; see logs/git.log"; fi
fi
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")

LOGIN_CHECK=$(node "$TOOLS" check-login 2>&1)
say "dev server from this Mac: $LOGIN_CHECK"
case "$LOGIN_CHECK" in refused:*) say "stopping: fix the password first (--set-password)"; exit 1 ;; esac

{
  echo "stamp=$STAMP"
  echo "commit=$COMMIT"
  echo "account=$TOUR_EMAIL"
  echo "server=https://nexus-prod.tail765d02.ts.net:8443 (dev)"
  echo "web-desktop=1440x900 @1x, Chromium"
  echo "web-mobile=440x956 @3x, Chromium (iPhone UA)"
} >"$OUT/meta.txt"

if [ $((DO_IPHONE + DO_IPAD + DO_MAC)) -gt 0 ]; then
  need xcodebuild "install Xcode"
  need xcodegen "brew install xcodegen"
  if ! xcodegen generate --quiet >"$OUT/logs/xcodegen.log" 2>&1; then
    say "xcodegen generate failed — see $OUT/logs/xcodegen.log"; exit 1
  fi
fi

# --------------------------------------------------------------------------------------------- app tours
# run_app <iphone|ipad|mac>
run_app() {
  local platform=$1 dest name note=""
  if [ "$platform" = mac ]; then
    dest="platform=macOS,variant=Mac Catalyst"
    name="My Mac (Mac Catalyst), macOS $(sw_vers -productVersion 2>/dev/null)"
  else
    local picked udid
    if ! picked=$(node "$TOOLS" pick-sim "$platform" 2>&1); then say "$platform: $picked"; SUMMARY+=("$platform: no simulator ($picked)"); return; fi
    udid=$(printf '%s' "$picked" | cut -f1); name=$(printf '%s' "$picked" | cut -f2); note=$(printf '%s' "$picked" | cut -f3)
    say "$platform: $name${note:+ — $note}"
    xcrun simctl boot "$udid" >/dev/null 2>&1
    xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1
    # Let the owner watch the tour: Xcode 27 shows simulators in "Device Hub" (older Xcode: Simulator.app).
    open -a "Device Hub" >/dev/null 2>&1 || open -a Simulator --args -CurrentDeviceUDID "$udid" >/dev/null 2>&1 || true
    xcrun simctl ui "$udid" appearance light >/dev/null 2>&1
    xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiBars 3 \
      --batteryState charged --batteryLevel 100 >/dev/null 2>&1
    dest="id=$udid"
  fi
  echo "$platform=$name${note:+ ($note)}" >>"$OUT/meta.txt"

  local result="$WORK/$platform.xcresult" log="$OUT/logs/$platform-xcodebuild.log" extra=()
  [ "$platform" = mac ] && extra=(-allowProvisioningUpdates)
  rm -rf "$result"
  say "$platform: building + running the tour (several minutes; log: logs/$platform-xcodebuild.log)"
  TEST_RUNNER_TOUR_EMAIL="$TOUR_EMAIL" \
  TEST_RUNNER_TOUR_PASSWORD="$TOUR_PASSWORD" \
  TEST_RUNNER_TOUR_SCREENS_JSON="$(cat "$REPO/scripts/ui-tour-screens.json")" \
  TEST_RUNNER_TOUR_ONLY="$ONLY" \
  TEST_RUNNER_TOUR_PROJECT_ID="${TOUR_PROJECT_ID:-}" \
  TEST_RUNNER_TOUR_FORM_ID="${TOUR_FORM_ID:-}" \
  TEST_RUNNER_TOUR_MAC_WINDOW="${TOUR_MAC_WINDOW:-}" \
    xcodebuild test -project NEXUS.xcodeproj -scheme NEXUSUITour -destination "$dest" \
      -resultBundlePath "$result" -only-testing:NEXUSUITour/NEXUSUITour/testTour \
      -destination-timeout 180 ${extra[@]+"${extra[@]}"} >"$log" 2>&1
  local rc=$?

  if [ ! -d "$result" ]; then
    say "$platform: no test result (build failed?) — last errors:"
    grep -E "error:|\*\* .* FAILED" "$log" | tail -8
    SUMMARY+=("$platform: BUILD/RUN FAILED (exit $rc) — logs/$platform-xcodebuild.log")
    return
  fi
  local export_dir="$WORK/$platform-attachments"
  rm -rf "$export_dir"; mkdir -p "$export_dir"
  if ! xcrun xcresulttool export attachments --path "$result" --output-path "$export_dir" >>"$log" 2>&1; then
    say "$platform: could not export attachments (xcresulttool) — kept $result"; KEEP_XCRESULT=1
  fi
  local count
  count=$(node "$TOOLS" extract "$export_dir" "$OUT/$platform" 2>&1)
  local line="$platform: $count"
  [ $rc -ne 0 ] && line="$line, test exit $rc"
  if [ -f "$OUT/$platform/login-error.txt" ]; then
    line="$line — SIGN-IN FAILED: $(cut -c1-400 "$OUT/$platform/login-error.txt")"
  fi
  if [ -f "$OUT/$platform/results.json" ]; then
    local bad
    bad=$(node -e 'const r=require(process.argv[1]);const b=r.filter(x=>x.status!=="ok").map(x=>x.id+": "+x.status);if(b.length)console.log(b.join("; "))' "$OUT/$platform/results.json" 2>/dev/null)
    [ -n "$bad" ] && line="$line — not clean: $bad"
  fi
  say "$line"
  SUMMARY+=("$line")
  [ "$KEEP_XCRESULT" = 1 ] || rm -rf "$result" "$export_dir"
}

run_web() {
  local dir="$REPO/scripts/ui-tour-web" log="$OUT/logs/web.log"
  say "web: dev web desktop 1440x900 + mobile 440x956@3x"
  if [ ! -d "$dir/node_modules/playwright" ]; then
    (cd "$dir" && npm install --no-audit --no-fund --silent) >>"$log" 2>&1 || { SUMMARY+=("web: npm install failed — logs/web.log"); return; }
  fi
  # A Mac with Google Chrome uses it (tour.mjs channel "chrome"); Playwright's Chromium unpack can hang there.
  if [ "$(uname)" != "Darwin" ] || [ ! -d "/Applications/Google Chrome.app" ]; then
    (cd "$dir" && npx --no-install playwright install chromium) >>"$log" 2>&1 || { SUMMARY+=("web: playwright install chromium failed — logs/web.log"); return; }
  fi
  if node "$dir/tour.mjs" --out "$OUT" --only "$ONLY" >>"$log" 2>&1; then
    local bad
    bad=$(grep -vE ": ok$" "$log" | grep -E "^web-(desktop|mobile) " | head -10 | tr '\n' ';')
    SUMMARY+=("web: $(find "$OUT/web-desktop" -name '*.png' 2>/dev/null | wc -l | tr -d ' ') desktop + $(find "$OUT/web-mobile" -name '*.png' 2>/dev/null | wc -l | tr -d ' ') mobile screenshots${bad:+ — not clean: $bad}")
  else
    SUMMARY+=("web: FAILED — $(tail -1 "$log")")
  fi
  say "${SUMMARY[${#SUMMARY[@]}-1]}"
}

[ "$DO_IPHONE" = 1 ] && run_app iphone
[ "$DO_WEB" = 1 ] && run_web
[ "$DO_IPAD" = 1 ] && run_app ipad
[ "$DO_MAC" = 1 ] && run_app mac
[ "$KEEP_XCRESULT" = 1 ] || rm -rf "$WORK"

node "$TOOLS" index "$OUT" >/dev/null 2>&1 || say "index.html could not be built"

# ---------------------------------------------------------------------------------------------- upload
REMOTE=""
if [ "$DO_UPLOAD" = 1 ]; then
  SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
  # shellcheck disable=SC2086,SC2029  # word-split options on purpose; $STAMP is meant to expand here
  if ssh $SSH_OPTS "$UPLOAD_HOST" "mkdir -p ~/ui-tour/$STAMP" >"$OUT/logs/upload.log" 2>&1 \
     && rsync -a --exclude .work -e "ssh $SSH_OPTS" "$OUT/" "$UPLOAD_HOST:ui-tour/$STAMP/" >>"$OUT/logs/upload.log" 2>&1; then
    REMOTE="agents:~/ui-tour/$STAMP/"
  else
    say "upload to $UPLOAD_HOST failed (SSH key not set up?). One-time fix: ssh-copy-id $UPLOAD_HOST  — or tell Claude the folder below."
  fi
fi

[ "$DO_OPEN" = 1 ] && [ -f "$OUT/index.html" ] && open "$OUT/index.html" 2>/dev/null

echo
echo "=== UI TOUR DONE ($STAMP, commit $COMMIT) ==="
for line in ${SUMMARY[@]+"${SUMMARY[@]}"}; do echo "- $line"; done
echo "- local:  $OUT/index.html"
[ -n "$REMOTE" ] && echo "- server: $REMOTE"
echo "=== end ==="
