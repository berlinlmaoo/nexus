#!/bin/bash
# NEXUS UI screenshot tour: one command, results side by side. Owner guide: docs/UI-TOUR.md.
#
#   scripts/ui-tour.sh                  iPhone 17 Pro Max simulator: the app, then the dev web in real Safari
#                                       (mobile reference) + dev web desktop 1440x900 in Chrome (master reference)
#   scripts/ui-tour.sh --ipad           … plus the iPad simulator
#   scripts/ui-tour.sh --mac            … plus "My Mac (Mac Catalyst)"
#   scripts/ui-tour.sh --android        … plus the Android tour (apps/android/scripts/ui-tour-android.sh)
#   scripts/ui-tour.sh --all            iPhone + iPad + Mac + web + Android
#   --only calendar,settings            just these screen ids (scripts/ui-tour-screens.json)
#   --no-web | --web-only | --no-upload | --no-pull | --no-open | --keep-xcresult
#   --chrome-mobile                     web mobile from Chrome emulation (440x956@3x) instead of Safari
#   --set-password                      store the QA password in the macOS Keychain, check it, stop
#                                       (TOUR_EMAIL=qa6@dev.invalid … --set-password: the account NOT invited to
#                                       Legal, for the web's legal-hidden check; optional, skipped without it)
#
# Order of work: iPhone (app, then Safari), web desktop, iPad, Mac. Results: ~/nexus-ui-tour/<timestamp>/index.html, then copied to
# the agents VM (~/ui-tour/<timestamp>/) over Tailscale so Claude can look at them.
#
# The QA password is read from the Keychain (service "nexus-ui-tour"), or TOUR_PASSWORD. Never in git,
# never on the command line of xcodebuild (it travels in the test runner's environment).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
REPO=$(pwd)
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ORIG_ARGS=("$@")
SAFARI_MOBILE=1 DO_IPHONE=1 DO_IPAD=0 DO_MAC=0 DO_ANDROID=0 DO_WEB=1 DO_UPLOAD=1 DO_PULL=1 DO_OPEN=1 KEEP_XCRESULT=0 SET_PASSWORD=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ipad) DO_IPAD=1 ;;
    --mac) DO_MAC=1 ;;
    --android) DO_ANDROID=1 ;;
    --all) DO_IPAD=1; DO_MAC=1; DO_ANDROID=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    --no-web) DO_WEB=0 ;;
    --chrome-mobile) SAFARI_MOBILE=0 ;;
    --web-only) DO_IPHONE=0; DO_IPAD=0; DO_MAC=0; DO_ANDROID=0 ;;
    --no-upload) DO_UPLOAD=0 ;;
    --no-pull) DO_PULL=0 ;;
    --no-open) DO_OPEN=0 ;;
    --watch) export TOUR_WATCH=1 ;;   # (default) visible Chrome for the web half
    --headless) TOUR_HEADLESS=1 ;;   # no Chrome window
    --keep-xcresult) KEEP_XCRESULT=1 ;;
    --set-password) SET_PASSWORD=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)"; exit 2 ;;
  esac
  shift
done

TOUR_EMAIL="${TOUR_EMAIL:-qa5@dev.invalid}"
# The second account, not invited to Legal (legal-hidden, web only). Its password is optional: Keychain entry
# of the same service under its own email, or TOUR_NONMEMBER_PASSWORD. Never asked for interactively.
TOUR_NONMEMBER_EMAIL="${TOUR_NONMEMBER_EMAIL:-qa6@dev.invalid}"
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
TOUR_NONMEMBER_PASSWORD="${TOUR_NONMEMBER_PASSWORD:-$(security find-generic-password -s "$KC_SERVICE" -a "$TOUR_NONMEMBER_EMAIL" -w 2>/dev/null)}"

mkdir -p "$OUT/logs" "$WORK"
say "results → $OUT"

# ------------------------------------------------------------------------------------------- repo + check
if [ "$DO_PULL" = 1 ]; then
  before=$(git rev-parse HEAD 2>/dev/null)
  if git pull --ff-only -q >"$OUT/logs/git.log" 2>&1; then say "git pull: $(git log -1 --format='%h %s' | cut -c1-70)"
    # bash already parsed THIS file's old functions: when the pull changed the tour, start over on the new
    # version (owner's Mac, 13 Oct 2026: a run kept the old xcodebuild handling after pulling the fix).
    if [ "$(git rev-parse HEAD)" != "$before" ] && [ -z "${UI_TOUR_REEXEC:-}" ]; then
      say "tour updated — restarting on the new version"
      rm -rf "$OUT"
      UI_TOUR_REEXEC=1 exec "$0" "${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}" --no-pull
    fi
  else say "git pull failed (local changes?) — continuing with what is checked out; see logs/git.log"; fi
fi
# Build from a frozen copy of this commit, not from the live checkout: the Orca agents work in ~/nexus too,
# and a pull halfway through the hour-long run made the iPad and Mac builds compile different (broken) code
# than the iPhone build (owner's Mac, 14 Oct 2026). The copy is a git worktree that stays put between runs,
# so Xcode's incremental build keeps working; uncommitted edits in ~/nexus are not part of the tour.
if [ -z "${UI_TOUR_SNAPSHOT:-}" ] && [ -z "${UI_TOUR_NO_SNAPSHOT:-}" ]; then
  ROOT=$(git rev-parse --show-toplevel)
  SNAP="${UI_TOUR_SNAPSHOT_DIR:-$HOME/nexus-tour-src}"
  HEAD_SHA=$(git rev-parse HEAD)
  if [ -d "$SNAP/.git" ] || [ -f "$SNAP/.git" ]; then
    git -C "$SNAP" checkout -q --force --detach "$HEAD_SHA" && git -C "$SNAP" clean -qfd -e build -e DerivedData
  else
    git -C "$ROOT" worktree prune
    git -C "$ROOT" worktree add -q --detach "$SNAP" "$HEAD_SHA"
  fi || { say "could not prepare the frozen copy at $SNAP"; exit 1; }
  WEBNM="$ROOT/apps/ios/scripts/ui-tour-web/node_modules"
  [ -d "$WEBNM" ] && [ ! -e "$SNAP/apps/ios/scripts/ui-tour-web/node_modules" ] && ln -s "$WEBNM" "$SNAP/apps/ios/scripts/ui-tour-web/node_modules"
  say "building from a frozen copy of $(git log -1 --format='%h %s' | cut -c1-60)"
  rm -rf "$OUT"
  UI_TOUR_SNAPSHOT=1 UI_TOUR_OUT="${UI_TOUR_OUT:-$HOME/nexus-ui-tour}" exec "$SNAP/apps/ios/scripts/ui-tour.sh" "${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}" --no-pull
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
  [ "$SAFARI_MOBILE" = 1 ] || echo "web-mobile=440x956 @3x, Chrome emulation (iPhone UA)"
} >"$OUT/meta.txt"

# Safari on the iPhone simulator is the web's mobile reference (owner, 13 Oct 2026).
SAFARI_RUN=0
[ "$DO_WEB" = 1 ] && [ "$SAFARI_MOBILE" = 1 ] && SAFARI_RUN=1
if [ $((DO_IPHONE + DO_IPAD + DO_MAC + SAFARI_RUN)) -gt 0 ]; then
  need xcodebuild "install Xcode"
  need xcodegen "brew install xcodegen"
  if ! xcodegen generate --quiet >"$OUT/logs/xcodegen.log" 2>&1; then
    say "xcodegen generate failed — see $OUT/logs/xcodegen.log"; exit 1
  fi
fi

# --------------------------------------------------------------------------------------------- app tours
# run_app <iphone|ipad|mac> [app|app+safari|safari]
run_app() {
  local platform=$1 what=${2:-app} dest name note="" tests=()
  case "$what" in
    app) tests=(-only-testing:NEXUSUITour/NEXUSUITour/testTour) ;;
    safari) tests=(-only-testing:NEXUSUITour/NEXUSUITour/testWebSafariTour) ;;
    *) tests=(-only-testing:NEXUSUITour/NEXUSUITour/testTour -only-testing:NEXUSUITour/NEXUSUITour/testWebSafariTour) ;;
  esac
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
  [ "$what" != safari ] && echo "$platform=$name${note:+ ($note)}" >>"$OUT/meta.txt"
  [ "$what" != app ] && echo "web-mobile=Safari on $name${note:+ ($note)}" >>"$OUT/meta.txt"

  local result="$WORK/$platform.xcresult" log="$OUT/logs/$platform-xcodebuild.log" extra=()
  [ "$platform" = mac ] && extra=(-allowProvisioningUpdates)
  rm -rf "$result"
  # The test also writes every screenshot straight to this folder (simulator and Mac runners share the
  # Mac's disk), so a hung or killed xcodebuild whose result bundle never closes loses nothing.
  local direct_dir="$WORK/$platform-direct"
  rm -rf "$direct_dir"; mkdir -p "$direct_dir"
  say "$platform: building + running the tour [$what] (several minutes; log: logs/$platform-xcodebuild.log)"
  TEST_RUNNER_TOUR_EMAIL="$TOUR_EMAIL" \
  TEST_RUNNER_TOUR_PASSWORD="$TOUR_PASSWORD" \
  TEST_RUNNER_TOUR_SCREENS_JSON="$(cat "$REPO/scripts/ui-tour-screens.json")" \
  TEST_RUNNER_TOUR_ONLY="$ONLY" \
  TEST_RUNNER_TOUR_PROJECT_ID="${TOUR_PROJECT_ID:-}" \
  TEST_RUNNER_TOUR_FORM_ID="${TOUR_FORM_ID:-}" \
  TEST_RUNNER_TOUR_MAC_WINDOW="${TOUR_MAC_WINDOW:-}" \
  TEST_RUNNER_TOUR_OUT_DIR="$direct_dir" \
    xcodebuild test -project NEXUS.xcodeproj -scheme NEXUSUITour -destination "$dest" \
      -resultBundlePath "$result" "${tests[@]}" \
      -destination-timeout 180 ${extra[@]+"${extra[@]}"} >"$log" 2>&1 &
  local xb=$!
  # Xcode 27 sometimes never exits after the tests finish (result bundle stays in Staging; owner's Mac,
  # 13 Oct 2026). Once the run's last "Test Suite 'Selected tests'" line is in the log, give it 90 s,
  # then stop it: the attachments are already written and xcresulttool still exports them.
  local done_at=0
  while kill -0 "$xb" 2>/dev/null; do
    sleep 5
    if [ "$done_at" = 0 ] && grep -q "Test Suite 'Selected tests' \(passed\|failed\)" "$log" 2>/dev/null; then
      done_at=$(date +%s)
    fi
    if [ "$done_at" != 0 ] && [ $(( $(date +%s) - done_at )) -ge 90 ]; then
      say "$platform: tests finished but xcodebuild did not exit after 90 s — stopping it"
      kill "$xb" 2>/dev/null; sleep 3; kill -9 "$xb" 2>/dev/null
      break
    fi
  done
  wait "$xb" 2>/dev/null
  local rc=$?

  if [ ! -d "$result" ] && [ -z "$(ls -A "$direct_dir" 2>/dev/null)" ]; then
    say "$platform: no test result (build failed?) — last errors:"
    grep -E "error:|\*\* .* FAILED" "$log" | tail -8
    SUMMARY+=("$platform: BUILD/RUN FAILED (exit $rc) — logs/$platform-xcodebuild.log")
    return
  fi
  local export_dir="$WORK/$platform-attachments"
  rm -rf "$export_dir"; mkdir -p "$export_dir"
  if [ -n "$(ls -A "$direct_dir" 2>/dev/null)" ]; then
    export_dir="$direct_dir"   # written by the test itself; no result bundle needed
  elif ! xcrun xcresulttool export attachments --path "$result" --output-path "$export_dir" >>"$log" 2>&1; then
    say "$platform: could not export attachments (xcresulttool) — kept $result"; KEEP_XCRESULT=1
  fi
  [ "$what" != safari ] && collect "$export_dir" tour- "$OUT/$platform" "$platform" $rc
  [ "$what" != app ] && collect "$export_dir" safari- "$OUT/web-mobile" "web mobile (Safari)" $rc
  [ "$KEEP_XCRESULT" = 1 ] || rm -rf "$result" "$WORK/$platform-attachments" "$direct_dir"
}

# suspects <dir>: different screens with byte-identical first pictures = a route or tap that did not go
# anywhere (run 3: seven project screens were the Projects list; run 10: five Mac Legal screens were one
# picture), while every status said "ok". tools.mjs same marks them `suspect: identical to <id>` in the
# results (index.html shows it) and prints the groups.
suspects() { node "$TOOLS" same "$1" 2>/dev/null; }

# collect <exportDir> <prefix> <destDir> <label> <xcodebuild exit>: PNGs out of the result, one summary line.
collect() {
  local export_dir=$1 prefix=$2 dest=$3 label=$4 rc=$5 count line bad
  count=$(node "$TOOLS" extract "$export_dir" "$dest" "$prefix" 2>&1)
  line="$label: $count"
  [ "$rc" -ne 0 ] && line="$line, test exit $rc"
  if [ -f "$dest/login-error.txt" ]; then
    line="$line — SIGN-IN FAILED: $(cut -c1-400 "$dest/login-error.txt")"
  fi
  if [ -f "$dest/results.json" ]; then
    bad=$(node -e 'const r=require(process.argv[1]);const b=r.filter(x=>x.status!=="ok").map(x=>x.id+": "+x.status);if(b.length)console.log(b.join("; "))' "$dest/results.json" 2>/dev/null)
    [ -n "$bad" ] && line="$line — not clean: $bad"
  fi
  local same
  same=$(suspects "$dest")
  [ -n "$same" ] && line="$line — IDENTICAL screens (route/tap did not land?): $same"
  say "$line"
  SUMMARY+=("$line")
}

run_web() {
  local dir="$REPO/scripts/ui-tour-web" log="$OUT/logs/web.log"
  local variants=desktop,mobile
  [ "$SAFARI_MOBILE" = 1 ] && variants=desktop
  say "web: dev web in Chrome ($variants)"
  if [ ! -d "$dir/node_modules/playwright" ]; then
    (cd "$dir" && npm install --no-audit --no-fund --silent) >>"$log" 2>&1 || { SUMMARY+=("web: npm install failed — logs/web.log"); return; }
  fi
  # A Mac with Google Chrome uses it (tour.mjs channel "chrome"); Playwright's Chromium unpack can hang there.
  if [ "$(uname)" != "Darwin" ] || [ ! -d "/Applications/Google Chrome.app" ]; then
    (cd "$dir" && npx --no-install playwright install chromium) >>"$log" 2>&1 || { SUMMARY+=("web: playwright install chromium failed — logs/web.log"); return; }
  fi
  # The second account's password goes to the web half only (environment, never the command line).
  if TOUR_NONMEMBER_EMAIL="$TOUR_NONMEMBER_EMAIL" TOUR_NONMEMBER_PASSWORD="$TOUR_NONMEMBER_PASSWORD" \
     node "$dir/tour.mjs" --out "$OUT" --only "$ONLY" --variants "$variants" >>"$log" 2>&1; then
    local bad
    bad=$(grep -vE ": ok$" "$log" | grep -E "^web-(desktop|mobile) " | head -10 | tr '\n' ';')
    local mobile=""
    [ "$SAFARI_MOBILE" = 1 ] || mobile=" + $(find "$OUT/web-mobile" -name '*.png' 2>/dev/null | wc -l | tr -d ' ') mobile"
    local same="" d s
    # web-mobile also holds Safari's shots (collected earlier); checked again with the Chrome ones added.
    for d in web-desktop web-mobile; do
      [ -d "$OUT/$d" ] || continue
      s=$(suspects "$OUT/$d"); [ -n "$s" ] && same="$same${same:+; }$d: $s"
    done
    SUMMARY+=("web (Chrome): $(find "$OUT/web-desktop" -name '*.png' 2>/dev/null | wc -l | tr -d ' ') desktop$mobile screenshots${bad:+ — not clean: $bad}${same:+ — IDENTICAL screens (route did not land?): $same}")
  else
    SUMMARY+=("web: FAILED — $(tail -1 "$log")")
  fi
  say "${SUMMARY[${#SUMMARY[@]}-1]}"
}

if [ "$DO_IPHONE" = 1 ] && [ "$SAFARI_RUN" = 1 ]; then run_app iphone app+safari
elif [ "$DO_IPHONE" = 1 ]; then run_app iphone app
elif [ "$SAFARI_RUN" = 1 ]; then run_app iphone safari
fi
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

# ---------------------------------------------------------------------------------------------- android
# Runs after the Apple/web half so a failure here never costs those screenshots. Uploads to its own folder.
if [ "$DO_ANDROID" = 1 ]; then
  ADB="$HOME/Library/Android/sdk/platform-tools/adb"
  EMU="$HOME/Library/Android/sdk/emulator/emulator"
  if ! "$ADB" get-state >/dev/null 2>&1 && [ -x "$EMU" ]; then
    # Nightly run: no Orca emulator open, so boot the first AVD without a window and wait for it.
    AVD=$("$EMU" -list-avds 2>/dev/null | head -1)
    if [ -n "$AVD" ]; then
      echo "== android: booting $AVD (headless)"
      nohup "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim >"$OUT/logs/android-emulator.log" 2>&1 &
      STARTED_EMU=$!
      "$ADB" wait-for-device
      for _ in $(seq 1 120); do [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 2; done
    fi
  fi
  ONLY_ARGS=(); [ -n "$ONLY" ] && ONLY_ARGS=(--only "$ONLY")
  UP_ARGS=(); [ "$DO_UPLOAD" = 1 ] || UP_ARGS=(--no-upload)
  if "$REPO/../android/scripts/ui-tour-android.sh" ${ONLY_ARGS[@]+"${ONLY_ARGS[@]}"} ${UP_ARGS[@]+"${UP_ARGS[@]}"}; then
    echo "- android: done"
  else
    echo "- android: FAILED (see output above)"
  fi
  [ -n "${STARTED_EMU:-}" ] && { "$ADB" emu kill >/dev/null 2>&1 || kill "$STARTED_EMU" 2>/dev/null; }
fi
