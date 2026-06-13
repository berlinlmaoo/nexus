import Foundation

/// GET /api/reports?days=
struct Reports: Decodable, Sendable {
    let metrics: Metrics?
    let tasksByStatus: [StatusCount]?
    let tasksByPriority: [PriorityCount]?
    let projectHealth: [ProjectHealth]?

    struct Metrics: Decodable, Sendable {
        let totalTasks: Int?
        let completedTasks: Int?
        let overdueTasks: Int?
        let completionRate: Int?
        let completionTrend: Int?
        let avgCompletionDays: Double?
    }
    struct StatusCount: Decodable, Identifiable, Sendable { let status: String; let count: Int; var id: String { status } }
    struct PriorityCount: Decodable, Identifiable, Sendable { let priority: String; let count: Int; var id: String { priority } }
    struct ProjectHealth: Decodable, Identifiable, Sendable {
        let id: String?
        let name: String?
        let color: String?
        let total: Int?
        let completed: Int?
        let completionRate: Int?
        let overdue: Int?
        var idv: String { id ?? name ?? "?" }
    }
}

/// GET /api/teams
struct Team: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String?
    let divisionId: String?
    let members: [Member]?
    let projects: [ProjectLink]?

    struct Member: Decodable, Sendable { let userId: String? }
    struct ProjectLink: Decodable, Sendable {
        let project: ProjRef?
        struct ProjRef: Decodable, Sendable { let name: String? }
    }
    var memberCount: Int { members?.count ?? 0 }
    var projectNames: [String] { (projects ?? []).compactMap { $0.project?.name } }
    var initial: String { String(name.first ?? "?").uppercased() }
}
