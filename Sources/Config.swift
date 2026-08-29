import Foundation

/// Where the native app talks to. Must be the CANONICAL domain — never one that redirects.
///
/// A redirecting legacy host downgrades POST to GET in URLSession when it follows a 301/302
/// (standard HTTP behaviour). The login route only accepts POST, so every write request came back
/// "Server error (405)". Pointing straight at the canonical host also drops a redirect hop.
///
/// For local dev against a LAN Vite/back-end, change `baseURL` to your Mac's IP + add an ATS
/// exception — but prod https needs none.
enum Config {
    static let baseURL = URL(string: "https://nexus.znetworks.id")!
    static let appName = "NEXUS by Z Networks"
}
