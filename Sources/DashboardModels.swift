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

/// GET /api/workspaces/members — caller's workspace id (for creating projects) + member pool.
struct WorkspaceInfo: Decodable, Sendable {
    let workspaceId: String
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
    let read: Bool?
    let createdAt: String?
    let taskId: String?

    var isRead: Bool { read == true }
    var typeLabel: String {
        let t = (type ?? "signal").replacingOccurrences(of: "_", with: " ")
        return t.prefix(1).uppercased() + t.dropFirst()
    }
}

struct NotificationsResponse: Decodable, Sendable {
    let notifications: [NexusNotification]?
    let unreadCount: Int?
}
