# NEXUS iOS (native SwiftUI)

**Standalone repo** — terpisah dari monorepo web/backend NEXUS. Cuma ngomong ke backend yang udah
ke-deploy (`https://nexus.patsgroup.id`) via token di Keychain. **No WebView, fully native UI.**

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

`Sources/Config.swift` → `https://nexus.patsgroup.id`. Itu domain **publik** yang nge-front backend
app-beta (Cloudflare → nginx :3000 → /api → app-beta :3002, DB prod) dan satu-satunya yang punya
endpoint app-login. `nexusbeta.patsgroup.id` **tidak ada di DNS publik** — jangan dipakai.

## Sekali setup di Mac ini

1. **Install platform iOS** (Xcode 26 pisahin SDK dari platform runtime):
   ```sh
   xcodebuild -downloadPlatform iOS      # beberapa GB, sekali aja
   ```
   (atau Xcode → Settings → Components → install iOS.)
2. XcodeGen udah keinstall (`brew install xcodegen`).

## Jalanin di iPhone (tanpa emulator)

```sh
cd ~/Documents/nexus-ios
xcodegen generate          # bikin NEXUS.xcodeproj dari project.yml
open NEXUS.xcodeproj
```

Di Xcode:
1. Pilih target **NEXUS** → tab **Signing & Capabilities** → set **Team** ke Apple ID lo
   (free account cukup; rebuild tiap 7 hari).
2. Colok **iPhone** via USB. iPhone: Settings → Privacy & Security → **Developer Mode** ON (iOS 16+).
3. Pilih iPhone lo sebagai run destination → tekan **⌘R** (Run).
4. Pertama kali: iPhone → Settings → General → **VPN & Device Management** → trust developer cert lo.

Alur harian OpenChamber (nulis kode) → Mac (build): lihat **[CARA-KERJA.md](CARA-KERJA.md)**.

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

Belum ada: push notification, offline cache/queue.
