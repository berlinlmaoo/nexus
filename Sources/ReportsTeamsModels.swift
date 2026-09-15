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
    let workspaceId: String?
    /// Sent by the server per team: true for a workspace admin or a system admin. The edit controls
    /// key off this rather than off the caller's global role, because the answer differs per team —
    /// and every action is re-checked server-side regardless, so this only decides what is drawn.
    let canManage: Bool?
    /// Supervisor absensi ikut boleh mengatur jam shift tim walau bukan Manager/BoD, jadi izinnya
    /// TERPISAH dari `canManage` dan server yang memutuskan. Jangan disamakan.
    let canManageAttendanceSettings: Bool?
    /// Jam masuk/keluar khusus tim ini. 8 dari 21 tim memakainya, jadi ini bukan kolom hiasan:
    /// tanpa ini di HP, satu-satunya cara mengubah jam shift tim adalah lewat web.
    let attendanceShiftOverrideEnabled: Bool?
    let attendanceShiftStartTime: String?
    let attendanceShiftEndTime: String?
    let division: DivisionRef?
    let members: [Member]?

    struct DivisionRef: Decodable, Sendable { let id: String; let name: String; let color: String? }
    let projects: [ProjectLink]?

    struct Member: Decodable, Sendable {
        let id: String?
        let userId: String?
        let role: String?               // LEAD | MEMBER
        let isAttendancePrimary: Bool?
        let user: UserRef?

        struct UserRef: Decodable, Sendable {
            let id: String?
            let name: String?
            let email: String?
            let avatar: String?
        }

        /// The membership row id is what the list is keyed by; userId is the fallback for a payload
        /// that omits it.
        var idv: String { id ?? userId ?? user?.id ?? "?" }
        var uid: String? { userId ?? user?.id }
        var displayName: String { user?.name ?? user?.email ?? "Unknown" }
        var initial: String { String(displayName.first ?? "?").uppercased() }
        var isLead: Bool { (role ?? "MEMBER").uppercased() == "LEAD" }
    }

    struct ProjectLink: Decodable, Sendable {
        let id: String?
        let projectId: String?
        let project: ProjRef?

        struct ProjRef: Decodable, Sendable {
            let id: String?
            let name: String?
            let color: String?
            let status: String?
        }

        var idv: String { id ?? projectId ?? project?.id ?? "?" }
        var pid: String? { projectId ?? project?.id }
        var displayName: String { project?.name ?? "Untitled" }
    }

    var memberCount: Int { members?.count ?? 0 }
    var projectNames: [String] { (projects ?? []).compactMap { $0.project?.name } }
    var initial: String { String(name.first ?? "?").uppercased() }
}


/// GET /api/teams?resource=divisions — lapisan pengelompokan di atas tim.
struct Division: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String?
    let position: Int?
}
