#!/usr/bin/env bash
# NEXUS iOS — build dari terminal, tanpa buka GUI Xcode.
#
# HARUS dijalanin di Mac. Compiler iOS, SDK, dan code signing cuma ada di macOS —
# Linux/Proxmox nggak bisa, titik. Yang dihilangkan di sini cuma GUI-nya.
#
#   ./build.sh check     cek compile doang (paling cepat, TANPA signing)  <-- pakai ini
#   ./build.sh run       build + pasang + jalanin di iPhone yang kecolok
#   ./build.sh ipa       arsip + export .ipa ke build/ipa/
#
# Kenapa `check` yang dipakai sehari-hari: dia nangkap 100% error compile tanpa
# perlu signing, provisioning, device, atau packaging. Itu yang kamu butuhin buat
# ngecek perubahan dari OpenChamber — bukan IPA.
set -euo pipefail

cd "$(dirname "$0")"
MODE="${1:-check}"

command -v xcodebuild >/dev/null || { echo "❌ xcodebuild nggak ada. Ini harus dijalanin di Mac."; exit 1; }
command -v xcodegen  >/dev/null || { echo "❌ xcodegen nggak ada → brew install xcodegen"; exit 1; }

# .xcodeproj nggak di-commit; project.yml sumbernya. Wajib regenerate tiap ganti branch.
echo "▸ xcodegen generate"
xcodegen generate >/dev/null

# xcpretty bikin log ringkas; kalau nggak ada, pakai output mentah.
if command -v xcpretty >/dev/null; then FILTER=(xcpretty); else FILTER=(cat); fi

case "$MODE" in
check)
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
    echo
    echo "Log penuh: build/last-check.log"
  fi
  exit "$rc"
  ;;

run)
  echo "▸ build + install ke iPhone yang kecolok"
  # Signing pakai setelan Automatic dari project.yml — set DEVELOPMENT_TEAM kamu
  # sekali lewat: xcodebuild ... DEVELOPMENT_TEAM=XXXXXXXXXX
  xcodebuild \
    -project NEXUS.xcodeproj \
    -scheme NEXUS \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -derivedDataPath build/dd \
    build 2>&1 | "${FILTER[@]}"
  APP=$(find build/dd/Build/Products -name "NEXUS.app" -maxdepth 3 | head -1)
  [ -n "$APP" ] || { echo "❌ NEXUS.app nggak ketemu"; exit 1; }
  DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ {print $(NF-1); exit}')
  [ -n "$DEVICE" ] || { echo "❌ Nggak ada iPhone kecolok (cek Developer Mode di HP)."; exit 1; }
  xcrun devicectl device install app --device "$DEVICE" "$APP"
  echo "✅ terpasang"
  ;;

ipa)
  echo "▸ archive + export .ipa"
  xcodebuild \
    -project NEXUS.xcodeproj \
    -scheme NEXUS \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath build/NEXUS.xcarchive \
    archive 2>&1 | "${FILTER[@]}"
  cat > build/ExportOptions.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>development</string>
  <key>signingStyle</key><string>automatic</string>
  <key>stripSwiftSymbols</key><true/>
  <key>compileBitcode</key><false/>
</dict></plist>
PLIST
  xcodebuild -exportArchive \
    -archivePath build/NEXUS.xcarchive \
    -exportOptionsPlist build/ExportOptions.plist \
    -exportPath build/ipa 2>&1 | "${FILTER[@]}"
  echo "✅ IPA: $(ls build/ipa/*.ipa 2>/dev/null || echo '(nggak kebentuk — lihat catatan Apple ID gratis di README)')"
  ;;

*)
  echo "pakai: ./build.sh [check|run|ipa]"; exit 2 ;;
esac
