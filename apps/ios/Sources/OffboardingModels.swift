import Foundation

// Offboarding (owner, 8 Oct 2026): someone who resigned, whose contract ended or who was let go is
// offboarded instead of deleted. Their attendance, requests, projects, tasks and messages stay; the
// account can no longer sign in. Server: src/lib/offboarding.ts and /api/admin/users/:id/offboard|reinstate.
// Every field decodes leniently, so a server from before offboarding still decodes.

/// One account from GET /api/admin/users. Only what Control Room → Users reads from it: who left.
struct AdminUser: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let email: String?
    let avatar: String?
    /// Set when the person was offboarded: the account can't sign in. nil = active.
    let deactivatedAt: String?
    /// The workspaces they left, newest first. Empty for active people.
    let formerMemberships: [FormerMembership]?

    struct FormerMembership: Decodable, Sendable {
        let workspaceId: String?
        let workspaceName: String?
        /// Last working day: 00:00 UTC of that Jakarta date (format it in UTC).
        let leftAt: String?
        /// RESIGNED | CONTRACT_ENDED | DISMISSED | OTHER
        let reason: String?
    }

    var displayName: String { (name?.isEmpty == false ? name : nil) ?? email ?? "—" }
    var initial: String { String(displayName.first ?? "?").uppercased() }
    /// The last working day of the most recent exit, for the "Left · 10 Oct" badge.
    var leftAt: String? { formerMemberships?.first?.leftAt }
    /// The workspaces a reinstatement brings them back into, each once.
    var formerWorkspaceNames: [String] {
        var seen = Set<String>()
        return (formerMemberships ?? []).compactMap(\.workspaceName).filter { seen.insert($0).inserted }
    }
}

/// GET /api/admin/users — one page (the route caps pageSize at 50).
struct AdminUsersPage: Decodable, Sendable {
    let users: [AdminUser]?
    let pagination: Pagination?
    struct Pagination: Decodable, Sendable {
        let total: Int?
        let totalPages: Int?
    }
}

/// POST /api/admin/users/:id/offboard
struct OffboardResult: Decodable, Sendable {
    struct Person: Decodable, Identifiable, Sendable {
        let id: String
        let name: String?
    }
    let ok: Bool?
    let user: Person?
    let leftAt: String?
    /// "YYYY-MM-DD", the Jakarta date.
    let lastWorkingDay: String?
    let workspaces: [String]?
    /// People whose approver was the leaver; their requests go to the BoD until a new one is set.
    let approverEdgesCleared: [Person]?
    let pendingRequests: Int?
    let autoDeductionsCanceled: Int?
    let openTasks: Int?
}

/// POST /api/admin/users/:id/reinstate
struct ReinstateResult: Decodable, Sendable {
    let ok: Bool?
    let user: OffboardResult.Person?
    let workspaces: [String]?
    let alreadyMember: [String]?
    let approverDropped: Int?
}

/// A refusal from offboard, reinstate or the admin account delete: the server's `code` and its
/// Indonesian sentence. Shown in the app's own words per code, and the server's sentence for a code
/// this build does not know.
struct AdminRefusal: LocalizedError, Sendable {
    let status: Int
    let code: String
    let message: String?

    var errorDescription: String? {
        switch code {
        case "SELF": return T("You can't do this to your own account.")
        case "RANK": return T("You can't do this to someone at or above your level.")
        case "FORBIDDEN": return T("Only the board and above can do this.")
        case "NOT_FOUND": return T("This account doesn't exist anymore.")
        case "BAD_DATE": return T("Check the last working day: not after today, and not before they joined.")
        case "BAD_REASON": return T("Pick a reason.")
        case "BAD_REQUEST": return T("Something went wrong. Nothing was changed.")
        case "NOT_MEMBER": return T("They aren't a member of the company workspace.")
        case "ALREADY_OFFBOARDED": return T("This account is offboarded already.")
        case "NOT_OFFBOARDED": return T("This account isn't offboarded.")
        case "HAS_ATTENDANCE_DATA": return T("This account has attendance records or requests. Use Offboard instead, so they stay.")
        default:
            if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return message }
            return T("Something went wrong. Nothing was changed.")
        }
    }
}
