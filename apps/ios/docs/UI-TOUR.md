# UI tour: screenshot otomatis untuk perbandingan

Satu perintah memotret daftar layar yang sama di app iPhone, web dev (desktop dan mobile), iPad, dan Mac.
Hasilnya satu halaman `index.html` yang menaruh semua versi berdampingan per layar. Kolomnya: web desktop
(acuan utama, Chrome 1440×900), web mobile (Safari asli di simulator iPhone 17 Pro Max), app iPhone, app iPad,
app Mac. Tiap layar dipotret utuh: app dan Safari digulir ke bawah halaman per halaman (`<id>-2`, `-3`, …,
maksimal 6), web Chrome memakai screenshot satu halaman penuh. Daftar layarnya ada di `scripts/ui-tour-screens.json`.

## Sekali saja (persiapan)

1. Pastikan Mac bisa membuka server dev (server dev hanya bisa dibuka lewat jaringan privat/VPN), lalu tulis
   alamatnya di `~/.config/nexus/ui-tour.env` (tidak ada di repo):
   ```
   TOUR_WEB_BASE=https://<server dev>
   UI_TOUR_HOST=<user>@<host>     # opsional: tujuan salinan hasil
   AGENTS=<user>@<host>           # hanya untuk --android: host yang membangun APK
   ```
2. Simpan password akun QA di Keychain Mac. Buka **Terminal** biasa (bukan lewat agent) lalu jalankan:
   ```
   apps/ios/scripts/ui-tour.sh --set-password
   ```
   Tempel password QA dari pengelola server dev, lalu tekan Enter. Kalau muncul `ok: qa5@dev.invalid can sign in`,
   password sudah benar. Password tidak pernah disimpan di git.
3. (Opsional) Supaya hasil otomatis terkirim ke `UI_TOUR_HOST`: `ssh-copy-id <user>@<host>` sekali.
   Kalau langkah ini dilewati, hasil tetap tersimpan di Mac dan path-nya dicetak di akhir.
4. Safari di simulator memakai jaringan Mac, jadi server dev terbuka selama VPN di Mac menyala.
   Kalau Safari di simulator pernah menampilkan layar sambutan atau tawaran simpan password, tour
   menutupnya sendiri. Kalau tour Safari tetap gagal login, buka Safari di simulator sekali dengan tangan,
   tutup layar sambutannya, lalu ulangi.
5. Kalau mau memotret Mac (`--mac`): saat pertama kali jalan, macOS minta izin
   "Accessibility / UI Automation" untuk Xcode. Klik Allow, sekali saja.

## Perintahnya

| Perintah | Yang dipotret |
|---|---|
| `scripts/ui-tour.sh` | app iPhone 17 Pro Max (simulator), lalu web di Safari simulator yang sama, + web desktop 1440×900 di Chrome |
| `scripts/ui-tour.sh --ipad` | yang di atas + iPad |
| `scripts/ui-tour.sh --mac` | yang di atas + Mac (Mac Catalyst) |
| `scripts/ui-tour.sh --all` | iPhone, web, iPad, Mac |
| `scripts/ui-tour.sh --web-only` | web saja: Safari di simulator + Chrome desktop |
| `scripts/ui-tour.sh --chrome-mobile` | web mobile dari emulasi Chrome 440×956 @3x, bukan Safari (cadangan) |

Script ini menjalankan `git pull`, `xcodegen generate`, build, lalu tour. Satu putaran iPhone + web
makan waktu sekitar 15–20 menit (build, lalu sekitar 6–8 menit app dan 4–6 menit Safari karena tiap
layar digulir sampai habis; ubah batasnya dengan `TOUR_MAX_PAGES=3`). Kalau simulator iPhone 17 Pro Max tidak
ada, script memakai iPhone terbesar yang tersedia dan menyebut namanya di output.

## Hasilnya ke mana

- Di Mac: `~/nexus-ui-tour/<tanggal-jam>/index.html` (langsung dibuka otomatis), plus folder `iphone/`,
  `web-desktop/`, `web-mobile/`, `ipad/`, `mac/` berisi PNG per layar, serta `logs/`.
- Di `UI_TOUR_HOST` (kalau diisi): `~/ui-tour/<tanggal-jam>/`, supaya reviewer bisa langsung melihatnya.

Kalau login app gagal (misalnya muncul "Can't reach NEXUS"), barisnya tertulis merah di bagian atas
`index.html` dan di ringkasan akhir, lengkap dengan kode error jaringannya (URLError domain/code).
Sertakan teks itu saat melapor. Layar project yang tidak benar-benar terbuka (misalnya yang tampil malah
daftar Projects) ditandai merah `wrong-screen` dan dihitung gagal.

## Mengulang satu layar saja

Pakai id layar dari `scripts/ui-tour-screens.json`:

```
apps/ios/scripts/ui-tour.sh --only calendar
apps/ios/scripts/ui-tour.sh --only calendar,settings --no-web
```

Opsi lain: `--no-web`, `--no-upload`, `--no-pull`, `--no-open`, `--keep-xcresult`.

## Layar Legal

Tour memotret tujuh layar Legal (14 Okt 2026). Akun QA `qa5@dev.invalid` adalah root Legal di dev, jadi ia
bisa membuka semuanya.

| id | Layar |
|---|---|
| `legal-archive` | Beranda Legal, tab Documents (arsip) |
| `legal-document` | Detail satu dokumen beserta versinya: dokumen `[TEST]` terbaru di dev |
| `legal-templates` | Tab Templates |
| `legal-requests` | Papan Requests (To Do / In Progress / Done) |
| `legal-request-form` | Form pengajuan `/f/legal-<token>` dari link umum |
| `legal-settings` | Tab Companies & numbering |
| `legal-hidden` | Cek negatif: akun yang tidak diundang ke Legal (qa6). Hanya di web |

- Dokumen `[TEST]` dan token link form dicari saat tour jalan lewat API dengan akun QA, hanya membaca
  (`GET /api/legal/documents?q=[TEST]`, `GET /api/legal/request-links`), jadi tidak ada id yang ditanam di
  repo. Untuk memaksa yang lain: `TOUR_LEGAL_DOC_ID=<id>` atau `TOUR_LEGAL_FORM_PATH=/f/legal-<token>`.
- Kalau dokumen `[TEST]` atau link-nya tidak ada, layar itu tercatat `skipped: <alasan>` di `index.html` dan
  ringkasan. Layar lain tetap jalan.
- Di app, tab Legal dan baris dokumen tidak punya route sendiri. Tour membuka `nexus://legal` lalu mengetuk
  tab atau barisnya, seperti orang memakai app.

### Mengaktifkan cek negatif (`legal-hidden`)

Cek ini masuk sebagai `qa6@dev.invalid` (tidak diundang ke Legal) lewat API sign-in, lalu memastikan tiga hal:
server menjawab `canAccessLegal: false` dan `/api/legal/me` 403, menu Legal tidak ada (sidebar desktop, dan
sheet More di mobile, dipotret sebagai `legal-hidden-2`), dan `/legal` menampilkan "Legal is by invitation
only". Sesinya ditutup lagi (`/api/auth/app-logout`) setelah selesai. Hasil mobile-nya dari emulasi Chrome,
karena Safari di simulator hanya memegang akun QA.

Tanpa password qa6, layar ini tercatat `skipped: no password for qa6@dev.invalid`. Untuk menyalakannya, simpan
password qa6 di Keychain sekali, di Terminal biasa:

```
TOUR_EMAIL=qa6@dev.invalid apps/ios/scripts/ui-tour.sh --set-password
```

Setelah itu tour biasa (akun qa5) otomatis membaca password qa6 dari Keychain dan hanya memberikannya ke
bagian web. Cara lain: `TOUR_NONMEMBER_PASSWORD=…` di environment (akun lain: `TOUR_NONMEMBER_EMAIL`).
