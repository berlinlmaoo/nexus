#!/usr/bin/env bash
# ============================================================================
# Deploy Phaëthon (SPA BoD) di VM nexus-prod: build → timpa → buang aset basi.
#
# Menggantikan versi lama yang menargetkan Mac (/Users/jagainmacmini1, launchctl)
# dan sudah tidak bisa jalan di mana pun.
#
# `dist/` di-bind-mount read-only ke nginx, jadi MENULIS dist ADALAH deploy.
#
# KENAPA MENIMPA LALU MEMBUANG, BUKAN MENGHAPUS LALU MENYALIN:
#   `find dist -mindepth 1 -delete` pernah mematikan situs ini. Perintah itu jalan
#   terus melewati galat izin, dan ia menghapus lima berkas milik root — termasuk
#   index.html — lalu melaporkan sukses. Di sini urutannya dibalik: berkas baru
#   ditimpakan dulu (situs tidak pernah kehilangan index.html walau semenit), baru
#   yang tidak lagi dipakai dibuang satu per satu.
#
# APA YANG DISEBUT "BASI": persis berkas yang ADA di dist tapi TIDAK ADA di hasil
#   build baru. Bukan hasil menebak dari isi index.html — bundle memuat bundle lain
#   secara malas, jadi menelusuri rujukan akan membuang chunk yang masih dipakai.
#   Hasil build adalah daftar lengkapnya; itu yang dipakai.
#
# Pakai:  bash scripts/deploy-phaethon.sh [--dry-run]
# ============================================================================
set -euo pipefail

APP="/home/debian/nexus/apps/nexus-lovable-ui"
DIST="$APP/dist"
NEW="$APP/dist-new"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Dilindungi apa pun yang terjadi. Isinya apple-app-site-association — berkas yang
# membuat tautan /f/<slug> membuka aplikasi iOS, bukan browser. Ia ditaruh di luar
# proses build, jadi ia SELALU tampak basi; menghapusnya mematikan universal links
# tanpa satu pun galat, dan Apple menyimpan hasil gagalnya di cache berhari-hari.
LINDUNGI=".well-known"

cd "$APP"

echo "### 1/4  build"
docker run --rm -v "$APP":/app -w /app node:22-alpine \
  ./node_modules/.bin/vite build --outDir dist-new --emptyOutDir 2>&1 | tail -3

# Pagar. Build yang gagal separuh jalan bisa meninggalkan dist-new yang nyaris kosong,
# dan menimpakannya lalu membuang sisanya akan mengosongkan situs.
[ -f "$NEW/index.html" ] || { echo "BATAL: dist-new/index.html tidak ada — build gagal."; exit 1; }
JUMLAH=$(find "$NEW" -type f | wc -l)
[ "$JUMLAH" -ge 20 ] || { echo "BATAL: dist-new cuma $JUMLAH berkas, terlalu sedikit untuk build utuh."; exit 1; }
echo "     $JUMLAH berkas di hasil build"

echo
echo "### 2/4  timpa dist (tidak menghapus apa pun)"
if [ "$DRY" = "1" ]; then
  echo "     [dry-run] cp -a dist-new/. dist/"
else
  sudo -n cp -a "$NEW/." "$DIST/"
  echo "     disalin"
fi

echo
echo "### 3/4  buang aset basi"
BASI=0
BYTE=0
# -print0/read -d: nama berkas bisa mengandung spasi. Hanya BERKAS, tidak pernah direktori.
while IFS= read -r -d '' f; do
  rel="${f#$DIST/}"
  case "$rel" in
    "$LINDUNGI"/*|"$LINDUNGI") continue ;;
  esac
  [ -e "$NEW/$rel" ] && continue          # masih dipakai build baru
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  BASI=$((BASI + 1)); BYTE=$((BYTE + sz))
  if [ "$DRY" = "1" ]; then
    echo "     [dry-run] buang $rel"
  else
    sudo -n rm -f "$f"
    echo "     buang $rel"
  fi
done < <(find "$DIST" -type f -print0)
echo "     $BASI berkas basi ($((BYTE / 1024)) KB)"

echo
echo "### 4/4  cek situs"
if [ "$DRY" = "1" ]; then
  echo "     [dry-run] dilewati"
else
  # index.html harus ada DAN bundle yang dirujuknya harus bisa diambil. Cek pertama
  # saja pernah lolos di situs yang halamannya kosong karena bundle-nya hilang.
  code=$(curl -s -o /dev/null -w '%{http_code}' https://nexus.znetworks.id/)
  bundle=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$DIST/index.html" | head -1)
  bcode=$(curl -s -o /dev/null -w '%{http_code}' "https://nexus.znetworks.id/$bundle")
  echo "     /            -> $code"
  echo "     /$bundle -> $bcode"
  [ "$code" = "200" ] && [ "$bcode" = "200" ] || { echo "GAGAL: situs tidak sehat setelah deploy."; exit 1; }
  echo "     ✅ Phaëthon live"
fi
