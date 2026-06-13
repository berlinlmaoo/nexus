import Foundation

/// Where the native app talks to. `nexus.patsgroup.id` is the PUBLIC domain that fronts the
/// app-beta backend (Cloudflare → nginx :3000 → /api → app-beta :3002, real prod DB) and the one
/// that has the app-login endpoint. (nexusbeta.patsgroup.id is NOT in public DNS — don't use it.)
/// For local dev against a LAN Vite/back-end, change `baseURL` to your Mac's IP + add an ATS
/// exception — but prod https needs none.
enum Config {
    static let baseURL = URL(string: "https://nexus.patsgroup.id")!
    static let appName = "NEXUS"
}
