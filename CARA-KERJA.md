# NEXUS iOS — alur kerja OpenChamber → Xcode

## Batas yang tidak bisa ditawar

**VM agents itu Linux. Linux tidak bisa membangun aplikasi iOS — Xcode hanya ada di macOS.**

Jadi pembagiannya begini, dan tidak ada jalan pintas:

| Di mana | Bisa apa |
|---|---|
| OpenChamber (VM agents, Linux) | **menulis dan mengubah kode Swift**, commit, push |
| Mac ini | **build, jalankan di simulator/iPhone, lihat hasilnya** |

OpenChamber tidak bisa memberi tahu apakah kodenya bisa dikompilasi. Itu baru ketahuan di Mac.
Karena itu jangan menumpuk banyak perubahan sebelum sekali pun dibuka di Xcode — makin banyak yang
menumpuk, makin sulit menemukan mana yang bikin gagal.

## Alur

### 1. Di OpenChamber (https://agents.tail765d02.ts.net)
```bash
cd ~/nexus-ios
git switch main && git pull
git switch -c ios/nama-perubahan
```
Minta perubahan yang diinginkan, lalu:
```bash
git diff                       # BACA dulu
git add -p && git commit -m "iOS: ..."
git push -u origin ios/nama-perubahan
```

### 2. Di Mac — tarik dan buka
```bash
cd ~/Documents/nexus-ios
git fetch origin
git switch ios/nama-perubahan

xcodegen generate              # WAJIB: .xcodeproj tidak ikut di-commit,
                               # project.yml yang jadi sumbernya
open NEXUS.xcodeproj
```

### 3. Jalankan
- Simulator: pilih target iPhone di toolbar Xcode → tekan ▶ (Cmd+R)
- iPhone sungguhan: colok kabel, pilih perangkatnya, tekan ▶
  Pertama kali perlu: Xcode → Settings → Accounts → tambahkan Apple ID (untuk menandatangani),
  lalu di iPhone: Settings → General → VPN & Device Management → percayai sertifikatnya.

### 4. Kalau gagal build
Salin pesan galat dari Xcode, tempelkan ke OpenChamber, minta diperbaiki, push lagi, lalu ulangi
langkah 2. Jangan memperbaiki langsung di Xcode tanpa mendorongnya kembali — nanti Mac dan repo
berbeda isi, dan perubahan lu hilang saat pull berikutnya.

### 5. Kalau sudah benar
Buka pull request di GitHub, merge ke `main`.

## Hal yang gampang bikin bingung

- **`.xcodeproj` tidak ada di git.** Sesudah setiap `git switch` atau `git pull`, jalankan
  `xcodegen generate` lagi. Kalau Xcode terlihat aneh atau ada berkas yang "hilang", itu penyebab
  pertama yang harus dicurigai.
- **Jangan menambah berkas lewat Xcode.** Xcode akan menulisnya ke `.xcodeproj` yang tidak
  ter-commit, jadi hilang. Tambahkan berkasnya lewat `Sources/`, lalu `xcodegen generate`.
- **`build/` tidak ikut di-commit** (1 GB di Mac, 1,8 MB yang benar-benar di-track).

---

# Rilis ke TestFlight

Butuh **Apple Developer Program berbayar** ($99/tahun). Akun gratis tidak bisa — dia cuma bisa
memasang ke iPhone sendiri lewat kabel, sertifikatnya mati tiap 7 hari.

## Sekali saja: siapkan

### 1. Team ID masuk ke `project.yml`
`DEVELOPMENT_TEAM` di `project.yml` berisi Team ID (10 karakter) akun berbayar yang dipakai signing.

Cara melihatnya lewat GUI: Xcode → target **NEXUS** → **Signing & Capabilities** → pilih Team →
pindah ke tab **Build Settings** → cari `DEVELOPMENT_TEAM` → salin nilainya.

Ditaruh di `project.yml`, **bukan** di GUI, karena `.xcodeproj` ditimpa tiap `xcodegen generate` —
kalau di GUI, hilang lagi tiap ganti branch.

### 2. Daftarkan Bundle ID
`id.znetworks.nexus`. Kalau signing otomatis sudah pernah jalan, biasanya sudah otomatis terdaftar.
Kalau belum: developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → **+**.

> **Bundle ID tidak bisa diganti** setelah app-nya dibuat di App Store Connect. Pastikan dulu.

### 3. Buat App record di App Store Connect
appstoreconnect.apple.com → **Apps** → **+** → New App:
- Platform **iOS**, Bundle ID `id.znetworks.nexus`
- **Name**: `NEXUS by Z Networks`. Nama ini yang muncul di TestFlight; nama di home screen berasal
  dari `CFBundleDisplayName` dan sudah disetel sama di `project.yml`.
- **SKU**: bebas, internal saja (mis. `nexus-ios`)

Tanpa langkah ini, upload gagal dengan *"No suitable application records were found."*

## Tiap kali mau kirim build

### 1. Naikkan build number
Di `project.yml`, naikkan `CURRENT_PROJECT_VERSION` (1 → 2 → 3 …). **Wajib**, dan errornya baru
muncul setelah upload selesai kalau lupa. `MARKETING_VERSION` cuma dinaikkan kalau isinya berubah
berarti.

```sh
xcodegen generate      # supaya nilainya masuk ke .xcodeproj
```

### 2. Archive
Di Xcode, pilih run destination **Any iOS Device (arm64)** — bukan simulator, bukan iPhone tertentu.
Menu **Product → Archive**. (Menu Archive mati kalau destination-nya simulator.)

### 3. Upload
Organizer terbuka sendiri setelah archive selesai → pilih archive teratas → **Distribute App** →
**App Store Connect** → **Upload** → biarkan opsi default (Upload Symbols aktif) → **Automatically
manage signing** → **Upload**.

### 4. Tunggu diproses
App Store Connect → tab **TestFlight**. Build muncul dengan status *Processing* (5–30 menit).
Pertanyaan export compliance tidak akan muncul — sudah dijawab lewat
`INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO` di `project.yml`.

### 5. Bagikan ke tester
- **Internal** (sampai 100 orang): tester harus punya akun di **Users and Access**. Begitu build
  selesai diproses, langsung bisa dipasang — **tanpa review Apple**.
- **External** (sampai 10.000): perlu **review Apple** untuk build pertama (±1–2 hari), dan wajib
  mengisi "What to Test", deskripsi, email kontak, serta **URL privacy policy**.

Tester memasang aplikasi **TestFlight** dari App Store, lalu menerima undangan lewat email.

## Kalau gagal

| Pesan | Artinya |
|---|---|
| No suitable application records were found | App record di App Store Connect belum dibuat |
| The bundle version must be higher than… | `CURRENT_PROJECT_VERSION` belum dinaikkan |
| Missing Compliance (di TestFlight) | `ITSAppUsesNonExemptEncryption` tidak terbaca — cek `xcodegen generate` sudah dijalankan |
| Invalid Signature / no provisioning profile | `DEVELOPMENT_TEAM` masih kosong di `project.yml` |
| Asset validation failed (icon) | Ikon 1024×1024 tidak boleh punya alpha channel (punya kita sudah aman: RGB) |

Tanpa GUI juga bisa: `./build.sh ipa app-store-connect` menghasilkan `.ipa` yang siap diupload.

---

# Notifikasi

Ada **dua hal berbeda** yang sering dikira satu, dan status keduanya tidak sama:

| | Cara kerja | Status |
|---|---|---|
| **Notifikasi lokal** — pengingat task jatuh tempo & absen | Dijadwalkan di dalam HP oleh app sendiri | **Sudah jalan.** Tidak butuh server, tidak butuh internet |
| **Push dari server** — misalnya "ada yang mention kamu" | Server → Apple (APNs) → HP | **Belum bisa.** Lihat di bawah |

## Kenapa push dari server belum bisa

App sudah mendaftarkan diri ke APNs dan mengirim token perangkat ke
`POST /api/push/devices` — **tapi rute itu tidak ada di backend**:

```sh
curl -o /dev/null -w '%{http_code}\n' -X POST https://nexus.znetworks.id/api/push/devices
# 404   ← rute tidak ada

curl -o /dev/null -w '%{http_code}\n' -X POST https://nexus.znetworks.id/api/attendance/check-in
# 401   ← rute ADA, cuma butuh login
```

404 (bukan 401) artinya backend memang belum punya rute itu. Jadi token perangkat tidak pernah
tersimpan di mana pun, dan tidak ada yang bisa mengirim push. Ini pekerjaan di **repo backend**,
bukan di sini.

Yang perlu dibuat di backend supaya nyambung dengan app yang sekarang:

- `POST /api/push/devices` — body `{token, deviceId, bundleId, environment}`; simpan per user
- `DELETE /api/push/devices` — body `{token}`; dipanggil saat logout
- Pengirimnya: APNs key `.p8` (Key ID + Team ID `5YR5T42G97`), topic = `id.znetworks.nexus`,
  host `api.sandbox.push.apple.com` untuk build development dan `api.push.apple.com` untuk
  TestFlight/App Store

## Cek status push di HP

**Tuning Room → PUSH NOTIFICATIONS.** Kartu itu menjawab pertanyaan "sebenarnya macet di mana":

- **Izin** — kalau *Diblokir*, semua tes akan gagal sampai diizinkan di Setelan iOS
- **Environment APNs** — `sandbox` (build dari Xcode) atau `production` (TestFlight).
  Kirim push ke host yang salah = ditolak `BadDeviceToken`. Ini penyebab bingung paling umum.
- **Apple** — `ok` berarti Apple sudah memberi token. Ini membuktikan entitlement dan
  provisioning profile sudah benar, **tanpa melibatkan server kita sama sekali**
- **Server NEXUS** — hasil menyerahkan token ke backend kita. Selama rutenya belum ada,
  di sini akan tertulis `Server error (404).`
- **Token perangkat** + tombol salin — dibutuhkan untuk mengirim tes push

## Tes 1 — notifikasi lokal (paling cepat, bisa sekarang)

1. Buka app, izinkan notifikasi saat diminta
2. Punya task dengan **due date hari ini atau kemarin** → pengingat "Task overdue" muncul
   beberapa detik kemudian
3. Pengingat absen muncul 15 menit sebelum jam shift, dan hanya kalau **belum check-in**

Kalau tidak muncul: cek Izin di Tuning Room, lalu pastikan HP tidak sedang Focus/Do Not Disturb.

## Tes 2 — push APNs sungguhan, tanpa backend

Ini membuktikan seluruh jalur Apple → HP sudah benar, jadi kalau nanti backend selesai,
tinggal nyambung.

1. Di HP: **Tuning Room → PUSH NOTIFICATIONS → Salin token**, kirim ke diri sendiri
   (chat/email) supaya bisa ditempel di Mac
2. Buka **Push Notifications Console** Apple: <https://icloud.developer.apple.com/dashboard/notifications>
   (login pakai akun Developer Program yang sama)
3. **Send Notification** → tempel device token → pilih environment yang **sama persis** dengan
   yang tertulis di kartu (`sandbox` untuk build Xcode, `production` untuk TestFlight)
4. Payload:
   ```json
   { "aps": { "alert": { "title": "Tes", "body": "Halo dari APNs" }, "sound": "default" } }
   ```
5. **Send**. Notifikasi harus muncul dalam hitungan detik.

> Kalau console-nya minta APNs key: developer.apple.com → Certificates, Identifiers & Profiles →
> **Keys** → **+** → centang **Apple Push Notifications service (APNs)** → download `.p8`.
> **File itu cuma bisa diunduh sekali** — simpan baik-baik.

Kalau gagal:

| Pesan | Artinya |
|---|---|
| `BadDeviceToken` | Environment salah (sandbox vs production), atau token dari build lain |
| `TopicDisallowed` | Bundle ID di key/topic tidak cocok dengan `id.znetworks.nexus` |
| Tidak ada error tapi tidak muncul | HP sedang Focus, atau izin notifikasi dimatikan |

## Tes 3 — di simulator

Simulator **tidak punya token APNs sungguhan**, jadi hanya berguna untuk mengetes tampilan:

```sh
echo '{"Simulator Target Bundle":"id.znetworks.nexus","aps":{"alert":{"title":"Tes","body":"Halo"}}}' > /tmp/p.json
xcrun simctl push booted id.znetworks.nexus /tmp/p.json
```
