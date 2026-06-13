import Foundation

/// Where the native app talks to. Points at the live Phaëthon backend (same one nexusbeta uses).
/// For local dev against a LAN Vite/back-end, change `baseURL` to your Mac's IP and add an ATS
/// exception — but prod https needs none.
enum Config {
    static let baseURL = URL(string: "https://nexusbeta.patsgroup.id")!
    static let appName = "NEXUS"
}
