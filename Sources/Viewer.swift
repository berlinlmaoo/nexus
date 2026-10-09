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
    /// See WorkspaceRoster.canAccessPipeline / pipelineProjectId (owner/GM, 9 Oct 2026).
    private(set) var pipelineAccess: Bool?
    private(set) var pipelineProjectId: String?
    private var loading = false

    /// Z Vault and Threads are drawn only for the company's own people. The server refuses the rest.
    var isCompanyMember: Bool { isCompany == true }

    /// Members of the Pipeline board only (owner, 9 Oct 2026: added by its lead like a task project).
    /// Unknown until loaded, so the entry stays hidden till then; the server refuses everyone else anyway.
    var canAccessPipeline: Bool { pipelineAccess == true }

    /// The board's id when the viewer is a member. No nav entry reads it any more (owner, 9 Oct 2026: the
    /// pipeline opens from Projects); kept for a caller that needs to open the board directly.
    var pipelineBoard: ProjectRef? {
        guard canAccessPipeline, let id = pipelineProjectId, !id.isEmpty else { return nil }
        return ProjectRef(id: id, name: T("Pipeline"), icon: nil)
    }

    private init() {}

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
        guard role == nil, !loading else { return }
        loading = true
        defer { loading = false }
        let roster = try? await APIClient.shared.roster()
        apply(roster)
    }

    /// Asked again after the company's board is created, so its "Pipeline" entry appears without a relaunch.
    func reload() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if let roster = try? await APIClient.shared.roster() { apply(roster) }
    }

    private func apply(_ roster: WorkspaceRoster?) {
        role = roster?.role
        isCompany = roster?.isCompany
        pipelineAccess = roster?.canAccessPipeline
        pipelineProjectId = roster?.pipelineProjectId
    }

    /// A new session must not inherit the last person's role.
    func reset() { role = nil; isCompany = nil; pipelineAccess = nil; pipelineProjectId = nil }
}
