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
    /// The app's identity, and a constant on purpose. Beyond being a place to send requests it is
    /// also what the passkey relying party must match, what `ImageLoader` compares a URL's host
    /// against before attaching the session cookie, and what every image cache key is built from.
    /// A value that moved with the network would quietly change all three. The office shortcut below
    /// is therefore chosen per REQUEST by `LANRoute`, and never by editing this.
    static let baseURL = URL(string: "https://nexus.znetworks.id")!

    /// The same server reached from inside the office instead of out through Cloudflare and back:
    /// same nginx, same app container, same `/api` and `/auth` routes, real Let's Encrypt
    /// certificate (so no ATS hole). It resolves to a private address, which is precisely why
    /// nothing may assume it is reachable — `LANRoute` proves it before any request uses it.
    static let lanBaseURL = URL(string: "https://lan.nexus.znetworks.id")!

    /// How long a request already aimed at the LAN may go silent before it is abandoned and replayed
    /// over the internet. Far below URLRequest's 60 s default on purpose: the private address behind
    /// `lanBaseURL` simply stops existing the moment the phone leaves the building, and a minute of
    /// nothing is exactly the hang this shortcut must never introduce. This is an inactivity timer,
    /// not a total one, so a large upload that keeps flowing is never cut off by it.
    static let lanRequestTimeout: TimeInterval = 10

    static let appName = "NEXUS by Z Networks"
}
