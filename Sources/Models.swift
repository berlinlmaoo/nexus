import Foundation

/// Response from POST /api/auth/app-login.
struct LoginResponse: Decodable, Sendable {
    let ok: Bool
    let token: String
    let cookieName: String
    let user: AppUser
}

struct AppUser: Decodable, Sendable {
    let id: String
    let name: String?
    let email: String?
    let avatar: String?
}

/// One project from GET /api/projects (NexusProject). Mirrors the list response: _count{members,
/// taskLists} + taskLists[{_count{tasks}}] + members[{user}]. All optional → forward-compatible.
struct Project: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String?
    let color: String?
    let icon: String?
    let status: String?
    let count: Counts?
    let taskLists: [TaskList]?
    let members: [Member]?

    struct Counts: Decodable, Sendable {
        let members: Int?
        let taskLists: Int?
    }
    struct TaskList: Decodable, Sendable {
        let count: TLCount?
        enum CodingKeys: String, CodingKey { case count = "_count" }
        struct TLCount: Decodable, Sendable { let tasks: Int? }
    }
    struct Member: Decodable, Sendable {
        let user: MemberUser?
        struct MemberUser: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, color, icon, status, taskLists, members
        case count = "_count"
    }

    /// total cards across all lanes
    var taskCount: Int { (taskLists ?? []).reduce(0) { $0 + ($1.count?.tasks ?? 0) } }
    var laneCount: Int { count?.taskLists ?? taskLists?.count ?? 0 }
    var memberCount: Int { count?.members ?? members?.count ?? 0 }
    var memberInitials: [String] {
        (members ?? []).prefix(4).map { m in
            let n = m.user?.name ?? "?"
            return String(n.first ?? "?").uppercased()
        }
    }

    var isUploadedIcon: Bool { (icon ?? "").hasPrefix("/") }
    var emoji: String {
        guard let icon, !icon.isEmpty, !isUploadedIcon else { return "📁" }
        return icon
    }
    /// Status chip label + tone (mirrors web statusBadge).
    var statusLabel: String {
        switch (status ?? "ACTIVE").uppercased() {
        case "ARCHIVED": return "Archived"
        case "AT_RISK": return "At risk"
        case "OFF_TRACK": return "Off track"
        case "ON_HOLD", "PAUSED": return "On hold"
        case "COMPLETED", "DONE": return "Completed"
        default: return "Active"
        }
    }
}
