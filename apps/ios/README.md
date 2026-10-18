# NEXUS iOS (native SwiftUI)

**Standalone repo** — terpisah dari monorepo web/backend NEXUS. Cuma ngomong ke backend yang udah
ke-deploy (`https://nexus.znetworks.id`) via token di Keychain. **No WebView, fully native UI.**

> Endpoint `POST /api/auth/app-login` yang dipakai app ini hidup di **repo backend NEXUS** (bukan di
> sini) — udah ke-deploy ke prod.

## Arsitektur

- **Auth**: `POST /api/auth/app-login` (email+password) → balikin NextAuth session JWT sebagai JSON.
  App simpan di **Keychain**, kirim balik sebagai `Cookie: <name>=<jwt>` tiap request → semua route
  `/api` yang udah ada nge-validate-nya sebagai session normal (zero perubahan route).
- **Networking**: `URLSession` async/await (`Sources/APIClient.swift`), stateless — sesi dibaca dari
  Keychain per-request. Multipart di-hand-roll buat selfie absen, attachment, & upload file.
- **State**: `@Observable AuthStore` (Observation framework, iOS 17+). Selebihnya `@State` per-layar
  + `.task { await load() }` — nggak ada view-model layer.
- **Project**: di-generate dari `project.yml` pakai [XcodeGen] — `.xcodeproj` TIDAK di-commit.

### Base URL

`Sources/Config.swift` → `https://nexus.znetworks.id`.

**Wajib domain kanonik, jangan host lama yang redirect.** URLSession **nurunin POST jadi GET** waktu
ngikutin 301/302. Route app-login cuma nerima POST, jadi hasilnya `Server error (405)` di layar
login, dan semua write request lain (absen, bikin task, komentar, upload) bakal kena hal yang sama.
Cek cepat kalau curiga:

```sh
curl -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  https://nexus.znetworks.id/api/auth/app-login
# 401 (tanpa redirect) = sehat. 3xx = domainnya redirect, jangan dipakai di Config.
```

### Dev server

Branch `dev` builds (the `NEXUS_DEV_SERVER` flag) can switch to the DEV server (Tuning Room → Server). Its
address is not in this repo: `project.yml` commits the placeholder `https://nexus-dev.invalid`
(`NEXUS_DEV_SERVER_URL`, Info.plist key `NEXUSDevServerURL`), and the build phase "Dev server address" writes
the real one into the built Info.plist from a file outside every checkout:

```sh
mkdir -p ~/.config/nexus
echo 'https://<dev-host>:<port>' > ~/.config/nexus/ios-dev-server-url   # once per Mac
```

Every checkout and worktree on that Mac then builds with it, with no per-checkout step. Without the file the
build still succeeds (it prints a note) and the Dev server is simply unreachable from that build.

## Sekali setup di Mac ini

1. **Install platform iOS** (Xcode 26 pisahin SDK dari platform runtime):
   ```sh
   xcodebuild -downloadPlatform iOS      # beberapa GB, sekali aja
   ```
   (atau Xcode → Settings → Components → install iOS.)
2. XcodeGen udah keinstall (`brew install xcodegen`).

## Jalanin di iPhone (tanpa emulator)

```sh
cd apps/ios
xcodegen generate          # bikin NEXUS.xcodeproj dari project.yml
open NEXUS.xcodeproj
```

Di Xcode:
1. Pilih target **NEXUS** → tab **Signing & Capabilities** → set **Team** ke Apple ID lo
   (free account cukup; rebuild tiap 7 hari).
2. Colok **iPhone** via USB. iPhone: Settings → Privacy & Security → **Developer Mode** ON (iOS 16+).
3. Pilih iPhone lo sebagai run destination → tekan **⌘R** (Run).
4. Pertama kali: iPhone → Settings → General → **VPN & Device Management** → trust developer cert lo.

## Build tanpa GUI Xcode

**IPA cuma bisa dibikin di macOS** — compiler iOS, SDK, dan code signing nggak ada di
Linux. Yang bisa dihilangkan cuma GUI-nya.

```sh
./build.sh check    # cek compile doang — cepat, TANPA signing  ← dipakai sehari-hari
./build.sh run      # build + pasang + JALANIN di iPhone, log ke terminal
./build.sh log      # nempel ke log app yang lagi jalan
./build.sh devices  # daftar iPhone yang kebaca
./build.sh team     # cari Team ID Apple kamu
./build.sh ipa      # archive + export .ipa ke build/ipa/
```

### Sekali setup buat test di HP

```sh
./build.sh team              # lihat Team ID (10 huruf di dalam kurung)
echo XXXXXXXXXX > .team      # simpen; .team nggak ikut git
```

**Kenapa perlu `.team`:** `project.yml` sengaja ngosongin `DEVELOPMENT_TEAM`. Kalau
di-set lewat GUI Xcode, nilainya nyangkut di `.xcodeproj` — yang **ketimpa tiap
`xcodegen generate`**, jadi hilang lagi tiap ganti branch. File `.team` bikin awet.

Di iPhone, sekali aja: **Settings → Privacy & Security → Developer Mode → ON** (restart),
lalu sesudah install pertama: **Settings → General → VPN & Device Management** → percayai
sertifikatnya.

### Loop harian

```sh
git pull
./build.sh check    # gagal? tempel error-nya, beres dulu
./build.sh run      # masuk ke HP + log jalan di terminal
```

`run` nggak cuma install — dia **jalanin** app-nya dan nyalurin stdout/stderr ke terminal,
jadi crash dan pesan error kelihatan langsung. Ctrl-C cuma ngelepas terminal; app-nya
tetap jalan di HP.

`check` yang paling sering kepakai: dia nangkap **semua** error compile tanpa perlu
signing, provisioning, device, atau packaging — persis yang dibutuhin buat verifikasi
perubahan yang ditulis di mesin lain. IPA cuma perlu kalau mau bagiin app-nya ke orang lain.

**Apple ID gratis:** `run` jalan (rebuild tiap 7 hari), tapi `ipa` sering gagal export —
personal team nggak dapet provisioning profile yang bisa didistribusi. Butuh Apple
Developer Program berbayar ($99/th) buat IPA yang beneran kepakai.

### CI (opsional, tapi disarankan)

`.github/workflows/ios-build.yml` nge-compile tiap push, jadi kode yang gagal build
ketahuan dalam menit — bukan setelah numpuk belasan commit. Nggak butuh sertifikat
(signing dimatiin).

⚠️ Runner macOS di repo **private** dihitung **10x** menit. Kalau jatah Actions tipis,
daftarin Mac sendiri sebagai self-hosted runner (gratis) lalu ganti `runs-on: macos-15`
jadi `runs-on: self-hosted`.

### Scheme

`⌘R` biasa jalanin **Release** (`-O`) — Debug SwiftUI di device jauh lebih lambat dan itu penyebab
paling umum "kok nge-lag di HP". Pakai scheme **NEXUS-Debug** cuma kalau butuh breakpoint.

## Debug di Mac

- **Native**: breakpoint + LLDB + View Hierarchy Inspector langsung di Xcode (scheme NEXUS-Debug).
- **SwiftUI Preview**: canvas live-render di Mac (butuh platform iOS keinstall).

## Struktur

```
Sources/
  NexusApp.swift          # @main entry + appearance global
  Config.swift            # base URL
  Keychain.swift          # Session blob (Security framework)
  APIClient.swift         # URLSession + Cookie auth, ~110 endpoint
  AuthStore.swift         # @Observable auth state
  Theme.swift             # design token web → SwiftUI (NX.*, NXFont, .nexusCard)
  Motion.swift            # haptics, shimmer, skeleton, reveal-on-appear
  MorphFlip.swift         # FLIP morph card→modal (port framer-motion layoutId)
  CachedImage.swift       # pengganti AsyncImage yang beneran nge-cache + downsample
  CameraPicker.swift      # selfie kamera depan → JPEG
    LocationManager.swift   # one-shot GPS fix (async/await)
    NotificationManager.swift # APNs registration + local attendance/task reminders
  FontLoader.swift        # daftarin Plus Jakarta Sans + Inter
  *Models.swift           # Codable per-domain (Board, Dashboard, Attendance,
                          #   Messages, DocsForms, ReportsTeams, GroupFour)
  Views/                  # 40 file — satu file = satu layar/kelompok layar
    RootView.swift        #   login ↔ TabView 5 tab + grid "More"
    LoginView.swift
    DashboardView.swift   #   Home: level, stat card (morph), quest
    TasksView.swift       #   My Quest Log
    InboxView.swift       #   Signal Inbox
    ProjectsView.swift    #   Mission Control: folder nested + project card
    ProjectBoardView.swift, ProjectTabsView.swift, ProjectTabExtras.swift
                          #   13 tab project (Board/List/Calendar/Timeline/…)
    TaskDetail*.swift     #   detail task + attachment/dependency/time/custom field
    Attendance*.swift     #   absensi: map + selfie + geofence + admin
    …                     #   Docs, Forms, Reports, Teams, Messages, Leaderboard,
                          #   Search, Settings, Admin (Control Room), Agenda
```

## Status

Fitur yang udah jalan native: login, dashboard + gamification, Mission Control (folder + aggregate
calendar), board/list/calendar/timeline project, task detail lengkap, absensi (kamera + GPS +
geofence + offsite approval + admin shift/day-off/hari libur), leaderboard, messages, docs, forms,
reports, teams, room booking, Control Room.

Push notification tersedia untuk mention chat dan task assignment setelah backend APNs dikonfigurasi.
Reminder lokal tersedia untuk check-in 15 menit sebelum shift serta deadline task H-2/H-1/jatuh
tempo. Belum ada: offline cache/queue.

## Native contract checks

Run `scripts/check-localization.sh` and `scripts/check-native-contracts.sh` from `apps/ios` before building.
The latter compiles the Foundation-only Legal, GIDEON credit, chat/document and task edit models plus the
block editor conversion tests. It needs Swift and Python 3, uses a temporary directory, and does not log in
or write to a server. Simulator and Mac Catalyst builds still verify the SwiftUI screens.

For DEV screenshot QA, follow `docs/UI-TOUR.md`. The Keychain entry must belong to the QA email used by the
tour; an entry for a different account is not a QA credential. Use one simulator at a time and keep the
build's derived data outside the checkout.
