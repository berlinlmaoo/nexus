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
