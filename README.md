# NEXUS iOS (native SwiftUI)

**Standalone repo** (`~/Documents/nexus-ios`) — terpisah dari monorepo web/backend NEXUS. Cuma
ngomong ke backend yang udah ke-deploy (`https://nexusbeta.patsgroup.id`) via token di Keychain.
**No WebView, fully native UI.**

> Endpoint `POST /api/auth/app-login` yang dipakai app ini hidup di **repo backend NEXUS** (bukan di
> sini) — udah ke-deploy ke prod.

## Arsitektur

- **Auth**: `POST /api/auth/app-login` (email+password) → balikin NextAuth session JWT sebagai JSON.
  App simpan di **Keychain**, kirim balik sebagai `Cookie: <name>=<jwt>` tiap request → semua 197
  route `/api` yang udah ada nge-validate-nya sebagai session normal (zero perubahan route).
- **Networking**: `URLSession` async/await (`Sources/APIClient.swift`).
- **State**: `@Observable AuthStore` (Observation framework, iOS 17+).
- **Project**: di-generate dari `project.yml` pakai [XcodeGen] — `.xcodeproj` TIDAK di-commit.

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

## Debug di Mac

- **Native**: breakpoint + LLDB + View Hierarchy Inspector langsung di Xcode.
- **SwiftUI Preview**: canvas live-render di Mac (butuh platform iOS keinstall).

## Struktur

```
Sources/
  NexusApp.swift        # @main entry
  Config.swift          # base URL
  Keychain.swift        # session storage (Security framework)
  APIClient.swift       # URLSession + Cookie auth header
  Models.swift          # Codable: LoginResponse, Project, AppUser
  AuthStore.swift       # @Observable auth state
  Theme.swift           # brand colors + hex parser
  Views/
    RootView.swift      # login ↔ app switch
    LoginView.swift     # email/password
    ProjectsView.swift  # live projects list (GET /api/projects)
```

## Status (milestone 1)

✅ Login akun asli → liat daftar projects asli (native). Selanjutnya: task board, attendance
(kamera+GPS native), P&L, push notif.
