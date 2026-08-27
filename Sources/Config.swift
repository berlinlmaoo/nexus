import Foundation

/// Where the native app talks to. Must be the CANONICAL domain — never one that redirects.
///
/// `nexus.patsgroup.id` now answers 302 → `nexus.znetworks.id`, and URLSession downgrades POST to
/// GET when it follows a 301/302 (standard HTTP behaviour). The login route only accepts POST, so
/// every write request came back "Server error (405)". Pointing straight at the canonical host both
/// fixes that and drops a redirect hop from every single API call.
///
/// For local dev against a LAN Vite/back-end, change `baseURL` to your Mac's IP + add an ATS
/// exception — but prod https needs none.
enum Config {
    static let baseURL = URL(string: "https://nexus.znetworks.id")!
    static let appName = "NEXUS"
}
