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
    /// also what the passkey relying party must match, and the host every image URL in the app is
    /// built from. A value that moved with the network would quietly change both. The office
    /// shortcut below is therefore chosen per REQUEST by `LANRoute`, and never by editing this — so
    /// a URL held anywhere in the app names a picture, never the route it happened to take.
    ///
    /// Branch `dev` only (NEXUS_DEV_SERVER build flag): the server this build talks to can be switched
    /// to the DEV server for testing the web redesign's features before they reach production
    /// (ServerEnvironment below). On `main` the flag is absent and this is always production.
    static var baseURL: URL { ServerEnvironment.current.baseURL }
    static let productionBaseURL = URL(string: "https://nexus.znetworks.id")!

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

    /// The two names for the same server — and the test for whether a URL may carry the session.
    ///
    /// Both are checked rather than only `baseURL` because a picture fetched over the office
    /// shortcut arrives on `lanBaseURL`, and a cookie test that knew one host would strip the
    /// session from exactly the requests this shortcut added: a silent 401 and a grey square where
    /// a face was. The other half matters more. A URL on any OTHER host must never be handed this
    /// session, which is why this is an allow-list of exactly two names and not a suffix match: a
    /// host that merely ENDS with the right letters belongs to whoever registered it.
    static func isNexusHost(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == baseURL.host || host == lanBaseURL.host
    }

    static let appName = "NEXUS by Z Networks"
}

/// Which NEXUS server this build talks to (owner, 12 Oct 2026: test the redesign's features on DEV from
/// the app). Production unless the build carries the NEXUS_DEV_SERVER flag (set in project.yml on branch
/// `dev` only, never on `main`), so an App Store build cannot even offer the switch.
///
/// DEV is the same app container reached through Tailscale, so it answers only on a device that has
/// Tailscale on. Sessions differ between the two servers, which is why switching signs out
/// (ServerSwitch.apply). The choice is kept across launches.
enum ServerEnvironment: String, CaseIterable, Identifiable {
    case production, dev

    var id: String { rawValue }

    var baseURL: URL {
        switch self {
        case .production: return Config.productionBaseURL
        case .dev: return Self.devURL
        }
    }

    /// The DEV server's address: Info.plist key NEXUSDevServerURL, which the build fills in from
    /// ~/.config/nexus/ios-dev-server-url (project.yml, README "Dev server"). The committed default is a
    /// placeholder that resolves nowhere, so this public repo names no internal host.
    static let devURL: URL = {
        if let s = Bundle.main.object(forInfoDictionaryKey: "NEXUSDevServerURL") as? String,
           !s.isEmpty, !s.hasPrefix("$("), let url = URL(string: s) { return url }
        return URL(string: "https://nexus-dev.invalid")!
    }()

    /// Whether this build can switch at all.
    static var isAvailable: Bool {
        #if NEXUS_DEV_SERVER
        return true
        #else
        return false
        #endif
    }

    private static let key = "nexus.serverEnvironment"

    /// Read once at launch and changed only by `set`, so every request of a session agrees on the host.
    private static var stored: ServerEnvironment = {
        guard isAvailable else { return .production }
        // `-nexusServer dev` (the UI screenshot tour, scripts/ui-tour.sh): this launch only. Never
        // written to UserDefaults, so the next ordinary launch is back on whatever was chosen by hand.
        if let forced = TourMode.argument("nexusServer").flatMap(ServerEnvironment.init(rawValue:)) { return forced }
        return ServerEnvironment(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .production
    }()

    static var current: ServerEnvironment { isAvailable ? stored : .production }
    static var isDev: Bool { current == .dev }

    /// Persists the choice. Callers sign out first: a session of one server means nothing on the other.
    static func set(_ env: ServerEnvironment) {
        guard isAvailable else { return }
        stored = env
        UserDefaults.standard.set(env.rawValue, forKey: key)
    }
}

/// The UI screenshot tour (docs/UI-TOUR.md): UITests/NEXUSUITour launches the app with launch arguments
/// such as `-nexusTour 1 -nexusServer dev -nexusTourStep screen -nexusTourRoute nexus://teamCalendar`,
/// and TourDriver (Sources/TourDriver.swift) acts on them.
///
/// Debug and branch-`dev` builds only: in an App Store build every argument reads as absent, so no
/// launch argument can steer a shipped app. Foundation-only on purpose, because Keychain.swift reads
/// `isActive` and this file is compiled into the watch app as well.
enum TourMode {
    /// The app was launched by the tour. Its session then lives under its own Keychain account
    /// (Keychain.swift), so a tour run on somebody's Mac never signs them out or in as somebody else.
    static let isActive: Bool = argument("nexusTour") != nil

    /// The value after `-<name>` on the command line, or nil.
    static func argument(_ name: String) -> String? {
        #if DEBUG || NEXUS_DEV_SERVER
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-" + name), i + 1 < args.count else { return nil }
        return args[i + 1]
        #else
        return nil
        #endif
    }
}
