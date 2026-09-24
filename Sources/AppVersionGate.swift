import Foundation
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// Forced update.
//
// Until 0.1.6 the server had no way to say "this build is too old to talk to".
// Rules an old build could not satisfy were refused one request at a time, each
// with its own confusing sentence, and nothing ever told the person the one thing
// that fixes all of them: update. The server now answers any call from a build
// below its floor with HTTP 426 + code UPGRADE_REQUIRED, and publishes the floor
// (plus the NEXT floor and when it takes effect) at GET /api/app/version-policy.
//
// Generic on purpose: nothing here knows about 0.1.6. When 0.1.7 ships and the
// server's grace period runs out, a phone still on 0.1.6 locks through exactly the
// same path.
//
// Foundation + Observation only (no SwiftUI/UIKit) so the comparison, the verdict
// and the persistence can be compiled and exercised on Linux.
// ─────────────────────────────────────────────────────────────────────────────

/// Orders two dotted numeric version strings: "0.1.10" is AFTER "0.1.9".
///
/// Numeric per component, never string order — as text "0.1.10" sorts below "0.1.9", which is
/// exactly the comparison that would lock the newest build out. A missing component counts as 0,
/// so "0.2" equals "0.2.0". A component is read by its leading ASCII digits ("6-beta" is 6) and one
/// with none is 0, so no string the server or Info.plist could hold makes this throw or trap.
func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    func parts(_ s: String) -> [Int] {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: ".", omittingEmptySubsequences: false)
            .map { Int(String($0.prefix { $0.isASCII && $0.isNumber })) ?? 0 }
    }
    let a = parts(lhs), b = parts(rhs)
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0
        let y = i < b.count ? b[i] : 0
        if x < y { return .orderedAscending }
        if x > y { return .orderedDescending }
    }
    return .orderedSame
}

/// The body of GET /api/app/version-policy. Every field optional on purpose: a policy the app
/// cannot fully read must degrade to "no opinion", never to "blocked".
struct VersionPolicy: Decodable, Equatable {
    let minSupported: String?
    let latest: String?
    let storeUrl: String?
    /// The floor that is coming, and the moment it arrives. Both or neither mean anything.
    var nextMinimum: String? = nil
    var graceUntil: String? = nil
}

@MainActor
@Observable
final class AppVersionGate {
    static let shared = AppVersionGate()

    /// What the server demands before it will answer again.
    struct Requirement: Equatable {
        let minSupported: String
        let storeUrl: URL?
    }

    /// The warning before the lock: this build still works, but not after `deadline`.
    struct Grace: Equatable {
        let nextMinimum: String
        let deadline: Date
    }

    /// Everything one policy answer means for one running version.
    struct Verdict: Equatable {
        var required: Requirement?
        var available: String?
        var grace: Grace?
    }

    /// Set → the app is replaced by the blocking update screen. PERSISTED: see `init`.
    private(set) var required: Requirement?
    /// A newer App Store version exists but this one is still allowed. Soft: Tuning Room only.
    private(set) var available: String?
    /// This build stops being allowed at a known moment. Warned about, never blocking.
    private(set) var grace: Grace?
    /// The App Store listing, as last reported by either the policy or a 426.
    private(set) var storeUrl: URL?
    /// True while a policy fetch is in flight, so "Check again" can show it is doing something.
    private(set) var checking = false
    /// The once-a-day grace alert is owed. Cleared by `graceNoticeSeen()`.
    var graceNoticeDue = false

    /// Only a check that actually got an answer counts. A failed one leaves this alone, so the
    /// next activation tries again instead of waiting out the whole interval.
    private var lastChecked: Date?
    static let recheckInterval: TimeInterval = 30 * 60

    /// This build's marketing version. nil (never expected in a real bundle) disables gating —
    /// an app that cannot say what it is must not lock itself out over it.
    let running: String?
    private let defaults: UserDefaults

    private enum Key {
        static let floor = "nexus.versionGate.minSupported"
        static let store = "nexus.versionGate.storeUrl"
        /// Which build was running when the lock was raised; decides a lock that has no floor.
        static let lockedOn = "nexus.versionGate.lockedOn"
        static let graceShownDay = "nexus.versionGate.graceShownDay"
    }

    /// Restores a lock raised on an earlier launch.
    ///
    /// Without this the lock was only as durable as the process: kill the app in airplane mode and
    /// it opened unlocked, because the launch check could not get through and a failed check must
    /// never decide anything. So the lock is written down when it is raised, and the only things
    /// that lift it are an update (checked right here, against what the build now IS) or the
    /// server itself answering with a lower floor.
    init(running: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
         defaults: UserDefaults = .standard) {
        self.running = running
        self.defaults = defaults
        storeUrl = defaults.string(forKey: Key.store).flatMap { URL(string: $0) }
        guard defaults.object(forKey: Key.floor) != nil else { return }
        let floor = defaults.string(forKey: Key.floor) ?? ""
        let lockedOn = defaults.string(forKey: Key.lockedOn) ?? ""
        if let running, !Self.lockLifted(running: running, floor: floor, lockedOn: lockedOn) {
            required = Requirement(minSupported: floor, storeUrl: storeUrl)
        } else {
            forgetLock()
        }
    }

    /// Whether the build now running has moved past a persisted lock.
    ///
    /// With a floor: at or above it. Without one (a 426 that did not name it): any build newer
    /// than the one that was refused — the refused build can never lift its own lock by relaunching.
    nonisolated static func lockLifted(running: String, floor: String, lockedOn: String) -> Bool {
        if !floor.isEmpty { return compareVersions(running, floor) != .orderedAscending }
        return !lockedOn.isEmpty && compareVersions(running, lockedOn) == .orderedDescending
    }

    // MARK: - the verdict (pure)

    /// What a policy means for a given running version at a given moment. Pure so it can be tested
    /// without a network. A missing or empty `minSupported` never produces a requirement, and a
    /// grace window is only reported while this build is still allowed — the lock supersedes it.
    nonisolated static func evaluate(running: String, policy: VersionPolicy, now: Date = Date()) -> Verdict {
        let store = policy.storeUrl.flatMap { URL(string: $0) }
        var verdict = Verdict()
        if let floor = nonEmpty(policy.minSupported), compareVersions(running, floor) == .orderedAscending {
            verdict.required = Requirement(minSupported: floor, storeUrl: store)
        }
        if let latest = nonEmpty(policy.latest), compareVersions(latest, running) == .orderedDescending {
            verdict.available = latest
        }
        if verdict.required == nil,
           let next = nonEmpty(policy.nextMinimum), compareVersions(running, next) == .orderedAscending,
           let deadline = nonEmpty(policy.graceUntil).flatMap(parseInstant), now < deadline {
            verdict.grace = Grace(nextMinimum: next, deadline: deadline)
        }
        return verdict
    }

    /// ISO 8601 as JavaScript writes it ("2026-09-27T02:00:00.000Z"), with or without the
    /// fractional seconds — `toISOString()` always adds them, a hand-written value often does not.
    nonisolated static func parseInstant(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    nonisolated private static func nonEmpty(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    // MARK: - checking

    /// Asks the server for the policy. `force` skips the 30-minute throttle ("Check again", launch).
    ///
    /// A failure is silent and changes NOTHING, in either direction: it can never raise the lock
    /// (no network is not "too old") and it can never lift one (a persisted lock must survive
    /// airplane mode). Only an answer the server actually gave moves `required`.
    func checkPolicy(force: Bool = false) async {
        guard !checking else { return }
        if !force, let lastChecked, Date().timeIntervalSince(lastChecked) < Self.recheckInterval { return }
        checking = true
        defer { checking = false }
        guard let policy = await Self.fetchPolicy() else { return }
        lastChecked = Date()
        apply(policy)
    }

    /// Applies a policy the server actually answered with.
    ///
    /// This can LOWER the gate: a floor raised by mistake and then rolled back is lifted by the
    /// next successful check, with no reinstall. The rollback case is the only way a running build
    /// below a persisted floor gets back in without updating.
    func apply(_ policy: VersionPolicy, now: Date = Date()) {
        if let url = policy.storeUrl.flatMap({ URL(string: $0) }) {
            storeUrl = url
            defaults.set(url.absoluteString, forKey: Key.store)
        }
        guard let running else { return }
        let verdict = Self.evaluate(running: running, policy: policy, now: now)
        available = verdict.available
        grace = verdict.grace
        if let need = verdict.required {
            lock(minSupported: need.minSupported, storeUrl: need.storeUrl ?? storeUrl)
        } else {
            required = nil
            forgetLock()
        }
        // Once per office day, not once per check: this runs on every activation.
        if grace != nil, defaults.string(forKey: Key.graceShownDay) != Self.officeDay(now) {
            graceNoticeDue = true
        }
    }

    /// The grace alert was shown and dismissed; not again until tomorrow (WIB).
    func graceNoticeSeen(now: Date = Date()) {
        graceNoticeDue = false
        defaults.set(Self.officeDay(now), forKey: Key.graceShownDay)
    }

    /// Called from APIClient when a real request came back 426 UPGRADE_REQUIRED. The server is the
    /// one refusing, so it is believed as-is — no local comparison can overrule a refusal that has
    /// already happened.
    func require(minSupported: String?, storeUrl: URL?) {
        if let storeUrl {
            self.storeUrl = storeUrl
            defaults.set(storeUrl.absoluteString, forKey: Key.store)
        }
        lock(minSupported: minSupported ?? required?.minSupported ?? "", storeUrl: storeUrl ?? self.storeUrl)
        // A 426 without a store link would leave "Open App Store" with nowhere to go; the policy
        // endpoint always carries one.
        if self.storeUrl == nil { Task { await checkPolicy(force: true) } }
    }

    private func lock(minSupported: String, storeUrl: URL?) {
        required = Requirement(minSupported: minSupported, storeUrl: storeUrl)
        grace = nil
        defaults.set(minSupported, forKey: Key.floor)
        defaults.set(running ?? "", forKey: Key.lockedOn)
    }

    private func forgetLock() {
        defaults.removeObject(forKey: Key.floor)
        defaults.removeObject(forKey: Key.lockedOn)
    }

    /// "2026-09-24" in Asia/Jakarta, so "once a day" turns over at midnight in the office.
    nonisolated static func officeDay(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Through `perform`, so the check takes the office LAN when everything else does and carries
    /// the X-Nexus-Client tag. Unauthenticated: a signed-out phone must be able to learn it is too
    /// old before it tries to sign in. Short timeout: nobody should wait on this.
    nonisolated private static func fetchPolicy() async -> VersionPolicy? {
        var req = APIClient.shared.makeRequest("/api/app/version-policy", authed: false)
        req.timeoutInterval = 8
        guard let result = try? await APIClient.shared.perform(req),
              (result.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(VersionPolicy.self, from: result.0)
    }
}
