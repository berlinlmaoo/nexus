import Foundation
import Observation

/// Remote config (owner, 28 Sep 2026: "prioritize server-side so we don't submit to Apple for every
/// change"). GET /api/app/config?platform=ios — flags, numbers and sentences the server can change
/// without an App Store release (server lib/app-config.ts).
///
/// Every value has a built-in default equal to the server's, so an app that never reaches the server
/// behaves as shipped. The last answer is kept on disk and used from the next launch's first frame.
/// Unknown keys are ignored; a missing or broken body leaves the previous values in place.
@MainActor @Observable
final class RemoteConfig {
    static let shared = RemoteConfig()

    struct Flags: Codable, Equatable, Sendable {
        var requireAlwaysLocation: Bool?
        var blockSignOutDuringWorkday: Bool?
        var fakeGpsReview: Bool?
        /// The Calendar's menu entries (0.1.7). Off hides them; a link to the Calendar still opens it.
        var calendar: Bool?
        /// The Calendar widgets and Watch complication (0.1.7).
        var calendarWidgets: Bool?
        /// The server's automatic offsite check-out after 2 h 30 outside the office. Off since 8 Oct
        /// 2026 (owner, server cd89d72): off, the app never promises one or counts down to it — the
        /// Live Activity and the phone's own alerts say since when, without a check-out time.
        var outsideAutoCheckout: Bool?
    }
    struct Values: Codable, Equatable, Sendable {
        var outsideHourAlertMinutes: Int?
        /// How often the Calendar refetches while it is on screen, in seconds.
        var calendarPollSeconds: Int?
    }
    struct Banner: Codable, Equatable, Sendable {
        let id: String
        let tone: String?
        let title: String
        let message: String
        let link: String?
    }
    struct Body: Codable, Equatable, Sendable {
        var flags: Flags?
        var values: Values?
        var texts: [String: [String: String]]?
        var banner: Banner?
    }

    private(set) var body = Body()
    private var lastFetch: Date?
    private static let key = "nexus.remote-config"

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode(Body.self, from: data) {
            body = saved
        }
    }

    // MARK: reads (defaults = the server's DEFAULTS)

    var requireAlwaysLocation: Bool { body.flags?.requireAlwaysLocation ?? true }
    var blockSignOutDuringWorkday: Bool { body.flags?.blockSignOutDuringWorkday ?? true }
    var fakeGpsReview: Bool { body.flags?.fakeGpsReview ?? true }
    var calendar: Bool { body.flags?.calendar ?? true }
    var calendarWidgets: Bool { body.flags?.calendarWidgets ?? true }
    /// Default false, as on the server: an app that never heard the switch promises no check-out.
    var outsideAutoCheckout: Bool { body.flags?.outsideAutoCheckout ?? false }
    /// Floored at 15 s: a 0 (or a typo) from the server must not turn the Calendar's poll into a busy loop.
    var calendarPollSeconds: Int { max(15, body.values?.calendarPollSeconds ?? 60) }
    var banner: Banner? { body.banner }

    /// The server's sentence for `key` in the app's language, else its English one, else `fallback`
    /// (the app's own copy, already translated by the caller).
    func text(_ key: String, _ fallback: String) -> String {
        let lang = AppLanguage.shared.lang.rawValue
        if let s = body.texts?[lang]?[key], !s.isEmpty { return s }
        if lang != "en", body.texts?[lang] == nil, let s = body.texts?["en"]?[key], !s.isEmpty { return s }
        return fallback
    }

    // MARK: fetch

    /// On launch (forced) and on every return to the foreground (at most every 5 minutes).
    func refresh(force: Bool = false) async {
        if !force, let lastFetch, Date().timeIntervalSince(lastFetch) < 300 { return }
        lastFetch = Date()
        let req = APIClient.shared.makeRequest("/api/app/config?platform=ios", authed: false)
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let fresh = try? JSONDecoder().decode(Body.self, from: data) else { return }
        guard fresh != body else { return }
        body = fresh
        UserDefaults.standard.set(data, forKey: Self.key)
        // The watch reads the calendar widgets' switch from the phone's context.
        PhoneSessionBridge.shared.republish()
    }
}
