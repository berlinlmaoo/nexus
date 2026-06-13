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

/// Minimal task row for the "Your Mission" stat (GET /api/tasks?assigneeId=).
struct MissionTask: Decodable, Sendable {
    let id: String
    let status: String?
    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
}

struct UnreadResponse: Decodable, Sendable {
    let unreadCount: Int?
}
