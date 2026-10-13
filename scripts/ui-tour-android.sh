#!/usr/bin/env bash
# Android UI tour (docs/UI-TOUR-ANDROID.md): screenshots of the same 23 screens as the iOS/web tour
# (nexus-ios scripts/ui-tour-screens.json), from the Android emulator inside Orca on Berlin's Mac, against the DEV server.
#
#   scripts/ui-tour-android.sh                 build on agents, install, tour every screen
#   scripts/ui-tour-android.sh --only a,b      only these screen ids
#   scripts/ui-tour-android.sh --no-build      reuse the APK already on agents
#   scripts/ui-tour-android.sh --no-upload     keep the results on this Mac only
#
# The app's half is core/tour/TourMode.kt (DEBUG builds only): it is driven by intent extras and answers with
# NEXUS_TOUR logcat lines. The QA password comes from the Mac's Keychain (the same item as the iOS tour:
# service nexus-ui-tour, account $TOUR_EMAIL; set it once with ~/nexus-ios/scripts/ui-tour.sh --set-password).
set -uo pipefail

AGENTS="${AGENTS:-debian@100.66.244.85}"
PKG="id.znetworks.nexus"
ACT="$PKG/.MainActivity"
TOUR_EMAIL="${TOUR_EMAIL:-qa5@dev.invalid}"
PROJECT="${TOUR_PROJECT_ID:-2c11faead7e64f908f1f5c574105ec9c}"
FORM="${TOUR_FORM_ID:-f9f7c0d7271a474eb2c0eaf87635e64f}"
MAX_PAGES="${TOUR_MAX_PAGES:-6}"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
[ -x "$ADB" ] || ADB="$(command -v adb || true)"

ONLY=""; BUILD=1; UPLOAD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --no-upload) UPLOAD=0; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

# id|title — same ids and order as nexus-ios scripts/ui-tour-screens.json.
SCREENS=(
  "login|Login" "dashboard|Dashboard" "my-tasks|My Tasks" "calendar|Calendar" "messages|Messages" "gideon|GIDEON"
  "notifications|Notifications" "threads|Threads" "vault|Z Vault" "submissions|My Submissions" "room-booking|Room Booking"
  "projects|Projects" "project-overview|Project · Overview" "project-board|Project · Board" "project-list|Project · List"
  "project-table|Project · Table" "project-calendar|Project · Calendar" "project-timeline|Project · Timeline"
  "form-builder|Form builder" "leaderboard|Leaderboard" "attendance|Attendance" "tickets|Tickets" "settings|Settings"
)
SIDEWAYS=" project-board project-table project-timeline "

die() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$ADB" ] || die "adb not found (expected ~/Library/Android/sdk/platform-tools/adb)"
"$ADB" get-state >/dev/null 2>&1 || die "no emulator/device on adb (start the Android emulator in Orca)"

TOUR_PASSWORD="${TOUR_PASSWORD:-$(security find-generic-password -s nexus-ui-tour -a "$TOUR_EMAIL" -w 2>/dev/null || true)}"
[ -n "$TOUR_PASSWORD" ] || die "no QA password in the Keychain for $TOUR_EMAIL — run ~/nexus-ios/scripts/ui-tour.sh --set-password once in Terminal"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$HOME/nexus-ui-tour/android-$STAMP"
mkdir -p "$OUT/android" "$OUT/logs"
APK="$OUT/logs/app-debug.apk"
REPORT="$OUT/logs/report.txt"
: > "$REPORT"
say() { echo "$*"; echo "$*" >> "$REPORT"; }

# 1. Build on agents (the Mac has no Android SDK on PATH), copy the APK, install.
if [ "$BUILD" = 1 ]; then
  say "build: agents ~/nexus-android (git pull + assembleDebug)"
  ssh "$AGENTS" 'cd ~/nexus-android && git pull -q --ff-only && ./gradlew -q assembleDebug' >"$OUT/logs/build.log" 2>&1 || die "build failed (see $OUT/logs/build.log)"
fi
scp -q "$AGENTS:nexus-android/app/build/outputs/apk/debug/app-debug.apk" "$APK" || die "could not copy the APK"
"$ADB" install -r "$APK" >"$OUT/logs/install.log" 2>&1 || die "install failed (see $OUT/logs/install.log)"
# No system permission prompt may cover a screen mid-tour (location, notifications, camera).
for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS CAMERA; do
  "$ADB" shell pm grant "$PKG" "android.permission.$perm" >/dev/null 2>&1 || true
done
"$ADB" shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true

W=$("$ADB" shell wm size | awk -F'[ x]' '/Physical/{print $3}'); H=$("$ADB" shell wm size | awk -F'[ x]' '/Physical/{print $4}')
W=${W:-1080}; H=${H:-2400}

# Launch fresh with the tour extras and wait for a NEXUS_TOUR status line matching $1 (regex), up to $2 s.
launch() { "$ADB" logcat -c; "$ADB" shell am start -S -W -n "$ACT" --es nexusTour 1 --es nexusServer dev "$@" >/dev/null 2>&1; }
wait_for() {
  local pat="$1" secs="$2" i line
  for ((i = 0; i < secs * 2; i++)); do
    line=$("$ADB" logcat -d -s NEXUS_TOUR:I 2>/dev/null | grep -o 'status=.*' | tr -d '\r' | tail -1)
    if [ -n "$line" ] && echo "$line" | grep -Eq "$pat"; then echo "${line#status=}"; return 0; fi
    sleep 0.5
  done
  echo "${line#status=}"; return 1
}
shot() { "$ADB" exec-out screencap -p > "$1"; }
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }

# Full page: the first screen, then swipes up until the picture stops changing (max $MAX_PAGES).
pages() {
  local id="$1" n=1 prev cur
  shot "$OUT/android/$id.png"; prev=$(md5of "$OUT/android/$id.png")
  while [ $n -lt "$MAX_PAGES" ]; do
    "$ADB" shell input swipe $((W / 2)) $((H * 75 / 100)) $((W / 2)) $((H * 30 / 100)) 400; sleep 1.2
    n=$((n + 1)); shot "$OUT/android/$id-$n.png"; cur=$(md5of "$OUT/android/$id-$n.png")
    if [ "$cur" = "$prev" ]; then rm -f "$OUT/android/$id-$n.png"; break; fi
    prev="$cur"
  done
  # Board / table / timeline: one sideways shot from the top.
  case "$SIDEWAYS" in *" $id "*)
    launch --es nexusTourStep screen --es nexusTourScreen "$id" --es nexusTourProject "$PROJECT" --es nexusTourForm "$FORM"
    wait_for "^settled $id" 40 >/dev/null
    "$ADB" shell input swipe $((W * 80 / 100)) $((H * 55 / 100)) $((W * 15 / 100)) $((H * 55 / 100)) 400; sleep 1.2
    shot "$OUT/android/$id-side.png" ;;
  esac
}

want() { [ -z "$ONLY" ] || echo ",$ONLY," | grep -q ",$1,"; }

# 2. Login screen: signed out (the switch to the DEV server happens once and asks for one more launch).
FAILS=0
if want login; then
  launch --es nexusTourStep signout
  st=$(wait_for "^(signed-out|server-switched)" 30)
  if [ "$st" = "server-switched" ]; then launch --es nexusTourStep signout; st=$(wait_for "^signed-out" 30); fi
  shot "$OUT/android/login.png"; say "login: $st"
fi

# 3. Sign in once with the QA account.
launch --es nexusTourStep login --es nexusTourEmail "$TOUR_EMAIL" --es nexusTourPassword "$TOUR_PASSWORD"
st=$(wait_for "^(signed-in|login-failed|server-switched)" 60)
if [ "$st" = "server-switched" ]; then
  launch --es nexusTourStep login --es nexusTourEmail "$TOUR_EMAIL" --es nexusTourPassword "$TOUR_PASSWORD"
  st=$(wait_for "^(signed-in|login-failed)" 60)
fi
say "sign-in ($TOUR_EMAIL): $st"
case "$st" in signed-in*) ;; *) say "FAILED: sign-in — $st"; FAILS=$((FAILS + 1)) ;; esac

# 4. Every screen.
for entry in "${SCREENS[@]}"; do
  id="${entry%%|*}"; [ "$id" = login ] && continue
  want "$id" || continue
  launch --es nexusTourStep screen --es nexusTourScreen "$id" --es nexusTourProject "$PROJECT" --es nexusTourForm "$FORM"
  if st=$(wait_for "^(settled $id|unknown-screen|not-signed-in)" 40) && [ "$st" = "settled $id" ]; then
    pages "$id"; say "ok: $id"
  else
    shot "$OUT/android/$id.png"; say "FAILED: $id — ${st:-no answer}"; FAILS=$((FAILS + 1))
  fi
done
"$ADB" logcat -d > "$OUT/logs/logcat.txt" 2>/dev/null

# 5. index.html: the screens in order, every page side by side.
{
  echo '<!doctype html><meta charset="utf-8"><title>Android UI tour '"$STAMP"'</title>'
  echo '<style>body{font:14px system-ui;margin:24px;background:#f8f9fb}h2{margin:28px 0 8px}img{height:640px;margin:0 8px 8px 0;border:1px solid #ddd;border-radius:8px}.bad{color:#b91c1c}</style>'
  echo "<h1>Android UI tour · $STAMP</h1><pre>$(cat "$REPORT")</pre>"
  for entry in "${SCREENS[@]}"; do
    id="${entry%%|*}"; title="${entry#*|}"
    ls "$OUT/android/$id.png" >/dev/null 2>&1 || continue
    echo "<h2>$title <small>($id)</small></h2>"
    for f in "$OUT/android/$id.png" $(ls "$OUT/android/$id"-[0-9]*.png 2>/dev/null | sort -V) "$OUT/android/$id-side.png"; do
      [ -f "$f" ] && echo "<img src=\"android/$(basename "$f")\">"
    done
  done
} > "$OUT/index.html"

# 6. A copy on agents for Claude.
if [ "$UPLOAD" = 1 ]; then
  rsync -az "$OUT/" "$AGENTS:ui-tour/android-$STAMP/" 2>/dev/null && say "uploaded: $AGENTS:ui-tour/android-$STAMP/" || say "upload failed (results stay on this Mac)"
fi

echo "=== UI TOUR DONE (android) ==="
echo "results: $OUT/index.html"
echo "screens failed: $FAILS"
cat "$REPORT"
echo "=== end ==="
