# UI tour: screenshot otomatis untuk perbandingan

Satu perintah memotret daftar layar yang sama di app iPhone, web dev (desktop dan mobile), iPad, dan Mac.
Hasilnya satu halaman `index.html` yang menaruh semua versi berdampingan per layar. Web desktop jadi acuan
utama. Daftar layarnya ada di `scripts/ui-tour-screens.json`.

## Sekali saja (persiapan)

1. Pastikan Tailscale menyala di Mac. Server dev hanya bisa dibuka lewat Tailscale.
2. Simpan password akun QA di Keychain Mac. Buka **Terminal** biasa (bukan lewat agent) lalu jalankan:
   ```
   ~/nexus-ios/scripts/ui-tour.sh --set-password
   ```
   Tempel password QA yang diberikan Claude, lalu tekan Enter. Kalau muncul `ok: qa5@dev.invalid can sign in`,
   password sudah benar. Password tidak pernah disimpan di git.
3. (Opsional) Supaya hasil otomatis terkirim ke server: `ssh-copy-id debian@100.66.244.85`.
   Kalau langkah ini dilewati, hasil tetap tersimpan di Mac dan path-nya dicetak di akhir.
4. Kalau mau memotret Mac (`--mac`): saat pertama kali jalan, macOS minta izin
   "Accessibility / UI Automation" untuk Xcode. Klik Allow, sekali saja.

## Prompt untuk agent Orca

Tempel satu baris ini ke agent Orca (workspace `dev`, Run on Local Mac):

```
Jalankan `~/nexus-ios/scripts/ui-tour.sh` di background (run_in_background, tanpa timeout pendek), tunggu sampai selesai, lalu balas HANYA dengan isi blok dari "=== UI TOUR DONE" sampai "=== end ===". Jangan baca log, jangan buka gambar, jangan ubah file apa pun.
```

Untuk iPad dan Mac sekaligus, ganti perintahnya dengan `~/nexus-ios/scripts/ui-tour.sh --all`.

## Perintahnya

| Perintah | Yang dipotret |
|---|---|
| `scripts/ui-tour.sh` | iPhone 17 Pro Max (simulator) + web desktop 1440×900 + web mobile 440×956 @3x |
| `scripts/ui-tour.sh --ipad` | yang di atas + iPad |
| `scripts/ui-tour.sh --mac` | yang di atas + Mac (Mac Catalyst) |
| `scripts/ui-tour.sh --all` | iPhone, web, iPad, Mac |
| `scripts/ui-tour.sh --web-only` | web saja (paling cepat) |

Script ini menjalankan `git pull`, `xcodegen generate`, build, lalu tour. Satu putaran iPhone + web
makan waktu sekitar 10–15 menit, sebagian besar untuk build. Kalau simulator iPhone 17 Pro Max tidak
ada, script memakai iPhone terbesar yang tersedia dan menyebut namanya di output.

## Hasilnya ke mana

- Di Mac: `~/nexus-ui-tour/<tanggal-jam>/index.html` (langsung dibuka otomatis), plus folder `iphone/`,
  `web-desktop/`, `web-mobile/`, `ipad/`, `mac/` berisi PNG per layar, serta `logs/`.
- Di server: `agents:~/ui-tour/<tanggal-jam>/`, supaya Claude bisa langsung melihatnya.

Kalau login app gagal (misalnya muncul "Can't reach NEXUS"), barisnya tertulis merah di bagian atas
`index.html` dan di ringkasan akhir, lengkap dengan kode error jaringannya (URLError domain/code).
Teruskan teks itu ke Claude.

## Mengulang satu layar saja

Pakai id layar dari `scripts/ui-tour-screens.json`:

```
~/nexus-ios/scripts/ui-tour.sh --only calendar
~/nexus-ios/scripts/ui-tour.sh --only calendar,settings --no-web
```

Opsi lain: `--no-web`, `--no-upload`, `--no-pull`, `--no-open`, `--keep-xcresult`.
