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
    /// Company Google account a BoD linked in Control Room. nil is the normal state — most people
    /// have none — and older endpoints that never send the key decode to nil as well.
    var googleWorkspaceEmail: String? = nil
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
    /// `var` so the Projects screen can move a card at once, before the server answers.
    var folderId: String?
    let workspaceId: String?
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
        case id, name, description, color, icon, status, folderId, workspaceId, taskLists, members
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
    var memberAvatars: [(id: Int, initial: String, url: String?)] {
        (members ?? []).prefix(4).enumerated().map { i, m in
            let n = m.user?.name ?? "?"
            return (i, String(n.first ?? "?").uppercased(), m.user?.avatar)
        }
    }

    // No `emoji` any more (owner, 11 Oct 2026): a project is drawn with ProjectMark — its photo or a
    // default task tile. A stored emoji or named icon is ignored.
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

/// GET /api/project-folders — a folder grouping projects (can nest via parentFolderId).
struct ProjectFolder: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let icon: String?
    let color: String?
    let position: Int?
    /// `var` so a folder dragged into another one moves at once, before the server answers.
    var parentFolderId: String?
    /// Curated subset for the aggregate view (empty/nil = every project in the folder + descendants).
    let aggregateProjectIds: [String]?

    var isUploadedIcon: Bool { (icon ?? "").hasPrefix("/") }
    var emoji: String {
        guard let icon, !icon.isEmpty, !isUploadedIcon, isEmojiIcon(icon) else { return "📁" }
        return icon
    }
}

/// A task in the folder aggregate calendar (GET /api/tasks?projectIds=a,b,c). Carries taskList.projectId
/// so each task resolves to its project (name/icon/colour) client-side.
struct FolderTask: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String?
    let priority: String?
    let dueDate: String?
    let assignees: [BoardTask.Assignee]?
    let taskList: TL?
    struct TL: Decodable, Sendable { let projectId: String? }
    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    var projectId: String? { taskList?.projectId }
    var assignee: BoardTask.Assignee.UserRef? { assignees?.first?.user }
}

/// True when the string actually starts with an emoji (rejects stray text / numbers stored as an
/// icon — those were rendering as raw "fol…" / "3" text in the icon tile).
func isEmojiIcon(_ s: String) -> Bool {
    guard let first = s.unicodeScalars.first else { return false }
    if first.properties.isEmojiPresentation { return true }
    // text-default emoji (❤️ ⚙️ …) carry a VS16 selector
    return first.properties.isEmoji && s.unicodeScalars.contains("\u{FE0F}")
}
