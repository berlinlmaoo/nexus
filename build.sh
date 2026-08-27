#!/usr/bin/env bash
# NEXUS iOS — build & test dari terminal, tanpa buka GUI Xcode.
#
# HARUS dijalanin di Mac. Compiler iOS, SDK, dan code signing cuma ada di macOS —
# Linux/Proxmox nggak bisa, titik. Yang dihilangkan di sini cuma GUI-nya.
#
#   ./build.sh check     cek compile doang (paling cepat, TANPA signing)  <-- sehari-hari
#   ./build.sh run       build + pasang + JALANIN di iPhone, log-nya ke terminal
#   ./build.sh log       nempel ke log app yang lagi jalan di iPhone
#   ./build.sh devices   daftar iPhone yang kebaca
#   ./build.sh team      cari Team ID Apple kamu
#   ./build.sh ipa       arsip + export .ipa ke build/ipa/
set -euo pipefail

cd "$(dirname "$0")"
MODE="${1:-check}"
BUNDLE_ID="id.patsgroup.nexus"

command -v xcodebuild >/dev/null || { echo "❌ xcodebuild nggak ada. Ini harus dijalanin di Mac."; exit 1; }

# ── Team ID ──────────────────────────────────────────────────────────────────
# project.yml sengaja ngosongin DEVELOPMENT_TEAM. Kalau di-set lewat GUI Xcode,
# nilainya masuk ke .xcodeproj — yang KETIMPA tiap `xcodegen generate`, jadi hilang
# lagi tiap ganti branch. Simpen di file .team (nggak ikut git) biar awet.
TEAM="${DEVELOPMENT_TEAM:-$(cat .team 2>/dev/null || true)}"

need_team() {
  [ -n "$TEAM" ] && return 0
  echo "❌ Team ID belum di-set — signing bakal gagal."
  echo "   Cari punya kamu:  ./build.sh team"
  echo "   Simpen sekali:    echo XXXXXXXXXX > .team"
  exit 1
}

# Pilih iPhone yang kecolok/kesambung. Pakai --json-output karena format tabel
# devicectl beda-beda antar versi Xcode.
pick_device() {
  mkdir -p build
  xcrun devicectl list devices --json-output build/devices.json >/dev/null 2>&1 || {
    echo "❌ devicectl gagal. Butuh Xcode 15+." >&2; return 1; }
  python3 - "$1" <<'PY'
import json, sys
verbose = sys.argv[1] == "list"
devs = json.load(open("build/devices.json"))["result"]["devices"]
ok = []
for d in devs:
    hw, conn = d.get("hardwareProperties", {}), d.get("connectionProperties", {})
    if hw.get("platform") != "iOS":
        continue
    name = d.get("deviceProperties", {}).get("name", "?")
    state = conn.get("tunnelState", "?")
    if verbose:
        print(f'  {name:28} {state:14} {d["identifier"]}')
    elif state != "unavailable":
        ok.append(d["identifier"])
if not verbose:
    print(ok[0] if ok else "", end="")
PY
}

if command -v xcpretty >/dev/null; then FILTER=(xcpretty); else FILTER=(cat); fi

regen() {
  command -v xcodegen >/dev/null || { echo "❌ xcodegen nggak ada → brew install xcodegen"; exit 1; }
  echo "▸ xcodegen generate"
  xcodegen generate >/dev/null
}

case "$MODE" in

team)
  echo "Sertifikat signing yang kebaca (Team ID = kode 10 huruf di dalam kurung):"
  security find-identity -v -p codesigning | sed 's/^/  /'
  echo
  echo "Simpen sekali:  echo XXXXXXXXXX > .team"
  ;;

devices)
  echo "iPhone yang kebaca:"
  pick_device list
  echo
  echo "Kalau kosong: colok kabel, unlock HP, Trust This Computer,"
  echo "dan nyalain Settings → Privacy & Security → Developer Mode."
  ;;

check)
  regen
  mkdir -p build
  echo "▸ compile check (Debug, simulator, tanpa signing)"
  set +e
  xcodebuild \
    -project NEXUS.xcodeproj \
    -scheme NEXUS-Debug \
    -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath build/dd \
    CODE_SIGNING_ALLOWED=NO \
    build 2>&1 | tee build/last-check.log | "${FILTER[@]}"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "✅ compile bersih"
  else
    echo "❌ gagal compile. Baris error doang:"
    grep -E "error:" build/last-check.log | sort -u | head -40
    echo; echo "Log penuh: build/last-check.log"
  fi
  exit "$rc"
  ;;

run)
  need_team
  regen
  echo "▸ build Release (team $TEAM)"
  xcodebuild \
    -project NEXUS.xcodeproj \
    -scheme NEXUS \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -derivedDataPath build/dd \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" \
    build 2>&1 | "${FILTER[@]}"

  APP=$(find build/dd/Build/Products -maxdepth 3 -name "NEXUS.app" | head -1)
  [ -n "$APP" ] || { echo "❌ NEXUS.app nggak ketemu"; exit 1; }

  DEVICE=$(pick_device pick)
  [ -n "$DEVICE" ] || { echo "❌ Nggak ada iPhone kesambung → ./build.sh devices"; exit 1; }

  echo "▸ install"
  xcrun devicectl device install app --device "$DEVICE" "$APP"

  echo "▸ jalanin (Ctrl-C buat lepas; app tetap jalan di HP)"
  # --console nyalurin stdout/stderr app ke terminal — di sinilah crash & log kelihatan.
  xcrun devicectl device process launch \
    --device "$DEVICE" --console --terminate-existing "$BUNDLE_ID"
  ;;

log)
  DEVICE=$(pick_device pick)
  [ -n "$DEVICE" ] || { echo "❌ Nggak ada iPhone kesambung → ./build.sh devices"; exit 1; }
  echo "▸ nempel ke log NEXUS (Ctrl-C buat berhenti)"
  xcrun devicectl device process launch \
    --device "$DEVICE" --console --terminate-existing "$BUNDLE_ID"
  ;;

ipa)
  need_team
  regen
  echo "▸ archive + export .ipa"
  xcodebuild \
    -project NEXUS.xcodeproj \
    -scheme NEXUS \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath build/NEXUS.xcarchive \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" \
    archive 2>&1 | "${FILTER[@]}"
  cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>development</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
  <key>stripSwiftSymbols</key><true/>
</dict></plist>
PLIST
  xcodebuild -exportArchive \
    -archivePath build/NEXUS.xcarchive \
    -exportOptionsPlist build/ExportOptions.plist \
    -allowProvisioningUpdates \
    -exportPath build/ipa 2>&1 | "${FILTER[@]}"
  ls build/ipa/*.ipa 2>/dev/null && echo "✅ IPA di build/ipa/" \
    || echo "⚠️  IPA nggak kebentuk — Apple ID gratis nggak bisa export. Pakai ./build.sh run."
  ;;

*)
  echo "pakai: ./build.sh [check|run|log|devices|team|ipa]"; exit 2 ;;
esac
