import Foundation

/// The signed-in person's workspace role, fetched once and shared.
///
/// Exists because the app was drawing Control Room for everybody. The server refuses the calls
/// behind it, so nothing could actually be done — but a STAFF member was still shown a door with
/// their name on it that opened onto a wall of failures.
///
/// This decides what is DRAWN and nothing else. Every route re-checks the role itself, which is
/// what makes hiding a menu a courtesy rather than a security measure.
@MainActor
@Observable
final class Viewer {
    static let shared = Viewer()

    private(set) var role: String?
    /// See WorkspaceRoster.isCompany. Unknown until loaded: company-only screens stay hidden till then.
    private(set) var isCompany: Bool?
    /// See WorkspaceRoster.canAccessLegal. Unknown (nil) until loaded, and false unless the server says true.
    private(set) var legalAccess: Bool?
    private var loading = false

    /// Z Vault and Threads are drawn only for the company's own people. The server refuses the rest.
    var isCompanyMember: Bool { isCompany == true }

    /// Legal is drawn only for the people invited to it (owner, 14 Oct 2026). The server refuses every
    /// /api/legal call for everyone else, so this decides what is drawn, nothing more.
    var canAccessLegal: Bool { legalAccess == true }

    /// The last roster answer, kept across launches so the iPad / Mac sidebar draws the same rows from the
    /// first frame. Before it, a screen opened straight from a link (the form builder, UI tour run 11 MC-7)
    /// drew the sidebar before the roster landed: no Threads, Z Vault or Legal, and Settings moved up into
    /// their place. Still only a courtesy — every route checks the role itself. Cleared on sign-out.
    private static let cacheKey = "nexus.viewer.roster"

    private init() {
        if let saved = UserDefaults.standard.dictionary(forKey: Self.cacheKey) {
            role = saved["role"] as? String
            isCompany = saved["isCompany"] as? Bool
            legalAccess = saved["legal"] as? Bool
        }
    }

    /// True once the server has answered in this launch; the cached values alone do not count, so the
    /// first `loadIfNeeded` still asks.
    private var fetched = false

    /// Control Room. Matches the web, where /admin sits behind the same three roles.
    var canAdminister: Bool {
        ["ONE_ABOVE_ALL", "BOD", "MANAGER"].contains(role ?? "")
    }

    /// The server's own isBoD(), mirrored. Written out once here rather than compared against a
    /// role string at each call site, so the two lists can never drift apart.
    var isBoD: Bool {
        ["ONE_ABOVE_ALL", "BOD"].contains(role ?? "")
    }

    /// Posting an announcement. Stricter than Control Room itself, and deliberately the same rule
    /// the server enforces in isBoD() — a MANAGER shown the compose form would only ever get a 403
    /// back, which reads as a broken app rather than a permission they do not have.
    var canAnnounce: Bool { isBoD }

    func loadIfNeeded() async {
        guard !fetched, !loading else { return }
        loading = true
        defer { loading = false }
        // A failed fetch keeps what is known (the cache) instead of wiping it; the next caller asks again.
        if let roster = try? await APIClient.shared.roster() { apply(roster) }
    }

    /// Asks the server again, without waiting for a relaunch.
    func reload() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if let roster = try? await APIClient.shared.roster() { apply(roster) }
    }

    private func apply(_ roster: WorkspaceRoster) {
        role = roster.role
        isCompany = roster.isCompany
        legalAccess = roster.canAccessLegal
        fetched = true
        var saved: [String: Any] = [:]
        if let role { saved["role"] = role }
        if let isCompany { saved["isCompany"] = isCompany }
        if let legalAccess { saved["legal"] = legalAccess }
        UserDefaults.standard.set(saved, forKey: Self.cacheKey)
    }

    /// A new session must not inherit the last person's role.
    func reset() {
        role = nil; isCompany = nil; legalAccess = nil; fetched = false
        UserDefaults.standard.removeObject(forKey: Self.cacheKey)
    }
}
