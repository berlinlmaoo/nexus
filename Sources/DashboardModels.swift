import Foundation

struct ProfileResponse: Decodable, Sendable {
    let user: AppUser
}

struct Gamification: Decodable, Sendable {
    let xp: Xp
    let streak: Streak?
    let quests: [Quest]?

    struct Xp: Decodable, Sendable {
        let totalXp: Int
        let level: Int
        let levelName: String?
        let nextFloor: Int?
    }
    struct Streak: Decodable, Sendable { let current: Int? }
    struct Quest: Decodable, Sendable, Identifiable {
        let key: String
        let title: String
        let progress: Int
        let target: Int
        let xpReward: Int
        let claimed: Bool?
        var id: String { key }
    }

    var streakCurrent: Int { streak?.current ?? 0 }
    var questList: [Quest] { quests ?? [] }
    var questsDone: Int { questList.filter { $0.claimed == true }.count }
    /// Progress toward the next level floor (0…1).
    var levelPct: Double {
        guard let next = xp.nextFloor, next > 0 else { return 1 }
        return min(1, max(0, Double(xp.totalXp) / Double(next)))
    }
}

/// A task assigned to me (GET /api/tasks?assigneeId=) — feeds the Mission stat + the My-Tasks screen.
struct MyTask: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let status: String?
    let priority: String?
    let dueDate: String?
    let taskList: TaskListRef?
    let count: CountRef?

    struct TaskListRef: Decodable, Sendable { let name: String? }
    struct CountRef: Decodable, Sendable { let comments: Int? }

    enum CodingKeys: String, CodingKey {
        case id, title, status, priority, dueDate, taskList
        case count = "_count"
    }

    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    var laneName: String { taskList?.name ?? "NEXUS board" }
    var commentCount: Int { count?.comments ?? 0 }
}

struct UnreadResponse: Decodable, Sendable {
    let unreadCount: Int?
}

struct SuccessResponse: Decodable, Sendable {
    let success: Bool?
}

/// GET /api/workspaces/members — caller's workspace id (for creating projects) + caller's org role.
struct WorkspaceInfo: Decodable, Sendable {
    let workspaceId: String
    let role: String?
}

/// GET /api/gamification/leaderboard.
struct LeaderboardRow: Decodable, Identifiable, Sendable {
    let userId: String
    let name: String?
    let avatar: String?
    let totalXp: Int
    let level: Int
    let levelName: String?
    let atBottom: Bool?
    var id: String { userId }
    var initial: String { String((name ?? "?").first ?? "?").uppercased() }
}
struct LeaderboardResponse: Decodable, Sendable { let rows: [LeaderboardRow]? }

/// Inbox notification (GET /api/notifications).
struct NexusNotification: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let message: String?
    let type: String?
    /// `var` so a row just opened can be struck off where it stands. Refetching the whole dashboard
    /// to grey out one dot is a lot of network for a value we already know.
    var read: Bool?
    let createdAt: String?
    let taskId: String?
    let projectId: String?
    /// The path the server itself chose for this signal ("/attendance", "/tasks/<id>").
    let link: String?

    var isRead: Bool { read == true }
    var typeLabel: String {
        let t = (type ?? "signal").replacingOccurrences(of: "_", with: " ")
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    /// Where tapping this notification should land, or nil for the rows that lead nowhere.
    ///
    /// Ported from the web inbox's `notificationTarget` (routes/_app/inbox.tsx), in ITS order: the
    /// id fields, then the type keywords, then the raw link. The web's own doc comment says "link
    /// field first" and its code checks the link last — the code is what people have been using, so
    /// the code is what is mirrored.
    var tapTarget: NotificationTarget? {
        if let taskId, !taskId.isEmpty { return .task(taskId) }
        if let projectId, !projectId.isEmpty { return .project(projectId) }
        let t = (type ?? "").lowercased()
        let attendanceWords = ["checkout", "offsite", "attendance", "late", "absen"]
        if attendanceWords.contains(where: { t.contains($0) }) { return .screen(.attendance) }
        if t.contains("message") { return .screen(.messages) }
        if let link, link.hasPrefix("/") { return NotificationTarget(path: link) }
        return nil
    }
}

/// One place a notification can send somebody. `.screen` covers the destinations that are whole
/// screens in both shapes of the app; the other two carry the id of a single record, which no
/// eighteen-case screen enum has room for.
enum NotificationTarget: Hashable {
    case task(String)
    case project(String)
    case screen(NXScreen)

    /// Reads a web path ("/tasks/abc123") as an app destination.
    ///
    /// The web has routes this app has no screen for — one doc, one folder, the social feed — so
    /// those land on the nearest screen that does exist. A path nothing here can answer returns
    /// nil, and the row stays untappable rather than opening something unrelated.
    init?(path: String) {
        let parts = path.prefix { $0 != "?" && $0 != "#" }.split(separator: "/").map { String($0) }
        guard let head = parts.first?.lowercased() else { self = .screen(.dashboard); return }
        let rest: String? = parts.count > 1 ? parts[1] : nil
        switch head {
        case "tasks":
            if let rest { self = .task(rest) } else { self = .screen(.tasks) }
        case "projects":
            // "/projects/<id>/tasks/<id>" is a real link the server sends. The web opens the TASK
            // there, so the deeper id wins over the board that holds it.
            if parts.count > 3, parts[2].lowercased() == "tasks" { self = .task(parts[3]) }
            else if let rest { self = .project(rest) }
            else { self = .screen(.projects) }
        case "my-tasks":                self = .screen(.tasks)
        case "attendance":              self = .screen(.attendance)
        case "messages":                self = .screen(.messages)
        case "inbox":                   self = .screen(.inbox)
        case "threads", "social":       self = .screen(.threads)
        // There is no single-document screen on mobile; the library is as close as it gets.
        case "docs", "folders":         self = .screen(.docs)
        case "forms":                   self = .screen(.forms)
        case "teams":                   self = .screen(.teams)
        case "reports", "peer-reports": self = .screen(.reports)
        case "leaderboard":             self = .screen(.leaderboard)
        case "submissions":             self = .screen(.submissions)
        case "room-booking":            self = .screen(.roomBooking)
        case "master-calendar":         self = .screen(.teamCalendar)
        case "complaints":              self = .screen(.tickets)
        case "settings":                self = .screen(.settings)
        case "admin":                   self = .screen(.admin)
        case "dashboard":               self = .screen(.dashboard)
        default:                        return nil
        }
    }
}

struct NotificationsResponse: Decodable, Sendable {
    let notifications: [NexusNotification]?
    let unreadCount: Int?
}
