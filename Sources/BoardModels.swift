import Foundation

/// GET /api/projects/{id} — project with lanes (taskLists) + their cards (top-level tasks only;
/// subtasks are hidden Asana-style and surface inside the task detail).
struct ProjectDetail: Decodable, Sendable {
    let id: String
    let name: String
    let color: String?
    let icon: String?
    let taskLists: [Lane]?
    let members: [ProjectMember]?

    struct Lane: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let tasks: [BoardTask]?
    }
    struct ProjectMember: Decodable, Identifiable, Sendable {
        let userId: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
        var uid: String { userId ?? user?.id ?? "" }
        var id: String { uid }
        var displayName: String { user?.name ?? "?" }
        var initial: String { String((user?.name ?? "?").first ?? "?").uppercased() }
    }
}

struct BoardTask: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String?
    let priority: String?
    let dueDate: String?
    let assignees: [Assignee]?
    let subtasks: [Sub]?
    let count: CountRef?

    struct Assignee: Decodable, Sendable {
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    }
    struct Sub: Decodable, Sendable { let status: String? }
    struct CountRef: Decodable, Sendable { let comments: Int? }

    enum CodingKeys: String, CodingKey {
        case id, title, status, priority, dueDate, assignees, subtasks
        case count = "_count"
    }

    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    var doneSubs: Int { (subtasks ?? []).filter { ($0.status ?? "").uppercased() == "DONE" }.count }
    var totalSubs: Int { (subtasks ?? []).count }
    var commentCount: Int { count?.comments ?? 0 }
    var assigneeInitial: String? {
        guard let n = assignees?.first?.user?.name, let c = n.first else { return nil }
        return String(c).uppercased()
    }
}

/// GET /api/tasks/{id} — focused task-detail fields.
struct TaskDetail: Decodable, Sendable {
    let id: String
    let title: String
    let description: String?
    let status: String?
    let priority: String?
    let dueDate: String?
    let assignees: [BoardTask.Assignee]?
    let subtasks: [SubDetail]?
    let comments: [Comment]?
    let parent: ParentRef?
    let taskList: TaskListInfo?

    struct TaskListInfo: Decodable, Sendable {
        let id: String?
        let project: ProjectRef?
        struct ProjectRef: Decodable, Sendable { let id: String? }
    }
    var taskListId: String? { taskList?.id }
    var projectId: String? { taskList?.project?.id }

    struct SubDetail: Decodable, Identifiable, Sendable {
        let id: String
        let title: String?
        let status: String?
        var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    }
    struct Comment: Decodable, Identifiable, Sendable {
        let id: String
        let content: String?
        let createdAt: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let name: String?; let avatar: String? }
    }
    struct ParentRef: Decodable, Sendable { let id: String; let title: String? }

    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
}

/// Tasks' description column can hold rich-block JSON; show plain text only.
func plainBlockText(_ raw: String?) -> String {
    guard let raw, !raw.isEmpty else { return "" }
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.hasPrefix("[") || t.hasPrefix("{") { return "" }  // rich-block JSON → skip (rendered elsewhere later)
    return raw
}
