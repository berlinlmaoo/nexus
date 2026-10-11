import Foundation

/// GET /api/projects/{id} — project with lanes (taskLists) + their cards (top-level tasks only;
/// subtasks are hidden Asana-style and surface inside the task detail).
struct ProjectDetail: Decodable, Sendable {
    let id: String
    let name: String
    let color: String?
    let icon: String?
    let description: String?
    let workspaceId: String?
    let taskLists: [Lane]?
    let members: [ProjectMember]?
    // project settings flags. The server still sends enableTaskBatchDuplicate, enablePnlDashboard,
    // financeEnabled, requireAttachmentForDone and disableTaskStatus, but they are fixed since 11 Oct
    // 2026 (duplicate always on, the rest off), so they are deliberately not read.
    let autoAssignEnabled: Bool?
    let autoAssignAssigneeIds: [String]?
    // Project type and tabs (owner, 9 Oct 2026) — see ProjectKinds.swift. Additive: a server from
    // before sends none of them, and they are read leniently so an odd shape in one of them can never
    // cost the whole board.
    /// "TASK" | "FINANCE" | "CONTENT" | "PIPELINE". nil = an older server = TASK.
    let type: String?
    /// Tab keys this project hides (ProjectTab.key). A key this build does not know is ignored.
    let hiddenTabs: [String]?

    private enum CodingKeys: String, CodingKey {
        case id, name, color, icon, description, workspaceId, taskLists, members
        case autoAssignEnabled, autoAssignAssigneeIds
        case type, hiddenTabs
    }

    /// Written out only so type and hiddenTabs can be read leniently. Every other field decodes
    /// exactly as the synthesized version did.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
        taskLists = try c.decodeIfPresent([Lane].self, forKey: .taskLists)
        members = try c.decodeIfPresent([ProjectMember].self, forKey: .members)
        autoAssignEnabled = try c.decodeIfPresent(Bool.self, forKey: .autoAssignEnabled)
        autoAssignAssigneeIds = try c.decodeIfPresent([String].self, forKey: .autoAssignAssigneeIds)
        type = try? c.decodeIfPresent(String.self, forKey: .type)
        hiddenTabs = try? c.decodeIfPresent([String].self, forKey: .hiddenTabs)
    }

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

/// A task-bundle quest this card is part of — drives the "+N XP" chip (board/list) and the
/// task-detail banner. total/done only populated by the task-detail endpoint.
struct TaskQuestRef: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let xpReward: Int?
    let total: Int?
    let done: Int?
}

/// A subtask's parent, resolved CLIENT-SIDE during the board/list merge (the /api/tasks list
/// endpoint returns parentId but not the parent object) → the "↳ Subtask · <parent>" mark.
struct BoardParent: Sendable { let id: String; let title: String? }

struct BoardTask: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String?
    let priority: String?
    let startDate: String?
    let dueDate: String?
    let assignees: [Assignee]?
    let subtasks: [Sub]?
    let count: CountRef?
    let customFieldValues: [CFValue]?
    let parentId: String?
    let taskListId: String?
    let quests: [TaskQuestRef]?
    /// Set during the board/list subtask-merge (not decoded — /api/tasks omits the parent object).
    var parent: BoardParent? = nil

    struct Assignee: Decodable, Sendable {
        let user: UserRef?
        /// `deactivatedAt`: set once the person was offboarded (left the company); their tasks stay
        /// theirs and the task detail marks them "Left". Sent by GET /api/tasks/:id (8 Oct 2026+).
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String?; let deactivatedAt: String? }
    }
    struct Sub: Decodable, Sendable { let status: String? }
    struct CountRef: Decodable, Sendable { let comments: Int? }
    struct CFValue: Decodable, Sendable {
        let customFieldId: String
        let value: String?
        let customField: FieldRef?
        struct FieldRef: Decodable, Sendable { let name: String?; let type: String?; let options: CFOptions? }
    }

    enum CodingKeys: String, CodingKey {
        case id, title, status, priority, startDate, dueDate, assignees, subtasks, customFieldValues
        case parentId, taskListId, quests
        case count = "_count"
    }

    var isSubtask: Bool { !(parentId ?? "").isEmpty }
    var questXP: Int { (quests ?? []).reduce(0) { $0 + ($1.xpReward ?? 0) } }
    var hasQuest: Bool { !(quests ?? []).isEmpty }
    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    var doneSubs: Int { (subtasks ?? []).filter { ($0.status ?? "").uppercased() == "DONE" }.count }
    var totalSubs: Int { (subtasks ?? []).count }
    var commentCount: Int { count?.comments ?? 0 }
    var assigneeInitial: String? {
        guard let n = assignees?.first?.user?.name, let c = n.first else { return nil }
        return String(c).uppercased()
    }
    /// Up to 3 assignees (avatar URL + initial) for a small overlapping stack on the card.
    var assigneeAvatars: [(id: String, initial: String, url: String?)] {
        (assignees ?? []).prefix(3).enumerated().map { idx, a in
            let n = a.user?.name ?? "?"
            return (id: a.user?.id ?? "a\(idx)", initial: String(n.first ?? "?").uppercased(), url: a.user?.avatar)
        }
    }
}

/// GET /api/tasks/{id} — focused task-detail fields.
struct TaskDetail: Decodable, Sendable {
    let id: String
    let title: String
    let description: String?
    let status: String?
    let priority: String?
    let startDate: String?
    let dueDate: String?
    let assignees: [BoardTask.Assignee]?
    let subtasks: [SubDetail]?
    let comments: [Comment]?
    let parent: ParentRef?
    let taskList: TaskListInfo?
    let activityLogs: [ActivityLog]?
    let quests: [TaskQuestRef]?   // task-bundle quests this task is in (with total/done) → detail banner
    /// Who made the task: the task detail's "Created by" line (with their picture), and whether they
    /// were offboarded (`deactivatedAt`), which that line and the CREATED custom field mark "Left".
    /// GET /api/tasks/:id sends the whole user row; every field is optional.
    let creator: CreatorRef?
    struct CreatorRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String?; let deactivatedAt: String? }

    struct ActivityLog: Decodable, Identifiable, Sendable {
        let id: String
        let action: String?
        let details: String?
        let createdAt: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let name: String? }
    }

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

/// POST /api/tasks returns the created task (top-level id).
struct CreatedTaskRef: Decodable, Sendable { let id: String }

/// GET /api/custom-fields?projectId=[&taskId=] — project custom fields (with current value when taskId set).
struct CustomFieldsResponse: Decodable, Sendable { let fields: [CustomField]? }
struct CustomField: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let type: String          // SELECT | MULTI_SELECT | STATUS | NUMBER | DATE | PLACE | CREATED
    let options: CFOptions?
    let value: CFFieldValue?   // present only when fetched with taskId
    /// CREATED only, fetched with taskId: who made the task and when (the web shows the name).
    let createdMeta: CreatedMeta?
    struct CreatedMeta: Decodable, Sendable { let userName: String?; let timestamp: String? }
    var choices: [String] { options?.list ?? [] }
}
/// A stored custom-field value: plain string, a multi-select array, or a PLACE {label, mapUrl}.
enum CFFieldValue: Decodable, Sendable {
    case text(String), list([String]), place(label: String, mapUrl: String?)
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .text(s) }
        else if let a = try? c.decode([String].self) { self = .list(a) }
        else if let o = try? c.decode(PlaceObj.self) { self = .place(label: o.label ?? "", mapUrl: o.mapUrl) }
        else { self = .text("") }
    }
    struct PlaceObj: Decodable, Sendable { let label: String?; let mapUrl: String? }
}

/// GET /api/attachments?taskId= — task file attachments.
struct TaskAttachment: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let url: String?
    let size: Int?
    let mimeType: String?
    let createdAt: String?
    let uploader: Uploader?
    struct Uploader: Decodable, Sendable { let name: String? }
}

/// GET /api/tasks/{id}/dependencies — blocking + blocked-by relations.
struct TaskDependenciesResponse: Decodable, Sendable {
    let dependencies: [TaskDependency]?   // this task depends on (is blocked by) these
    let dependedOnBy: [TaskDependency]?   // these depend on this task
}
struct TaskDependency: Decodable, Identifiable, Sendable {
    let id: String
    let type: String?
    let dependsOnTask: TaskRef?
    let task: TaskRef?
    struct TaskRef: Decodable, Sendable { let id: String; let title: String; let status: String? }
}
/// options is polymorphic: ["a","b"] | {options:[…], format?} | {choices:[…]} | null.
struct CFOptions: Decodable, Sendable {
    let list: [String]
    let format: String?   // e.g. "currency-idr"
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([String].self) {
            list = arr; format = nil
        } else if let c = try? decoder.container(keyedBy: CodingKeys.self) {
            if let o = try c.decodeIfPresent([String].self, forKey: .options) { list = o }
            else if let ch = try c.decodeIfPresent([String].self, forKey: .choices) { list = ch }
            else { list = [] }
            format = try? c.decodeIfPresent(String.self, forKey: .format)
        } else { list = []; format = nil }
    }
    enum CodingKeys: String, CodingKey { case options, choices, format }
}

/// GET /api/time-entries?taskId= — logged time on a task.
struct TimeEntriesResponse: Decodable, Sendable { let entries: [TimeEntry]? }
struct TimeEntry: Decodable, Identifiable, Sendable {
    let id: String
    let duration: Int?       // minutes
    let description: String?
    let startTime: String?
    let user: UserRef?
    struct UserRef: Decodable, Sendable { let name: String? }
}

/// Tasks' description column can hold rich-block JSON; show plain text only (for read-only display).
func plainBlockText(_ raw: String?) -> String {
    guard let raw, !raw.isEmpty else { return "" }
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.hasPrefix("[") || t.hasPrefix("{") { return "" }  // rich-block JSON → skip (rendered elsewhere later)
    return raw
}

/// Extracts plain text from a description that may be block-editor JSON (else returns it as-is).
/// Port of the web `blockText` — used to seed the editable description field.
func blockText(_ raw: String?) -> String {
    guard let raw else { return "" }
    let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if !(s.hasPrefix("[") || s.hasPrefix("{")) { return raw }
    guard let data = s.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) else { return raw }
    func inlineText(_ content: Any?) -> String {
        if let str = content as? String { return str }
        if let arr = content as? [Any] {
            return arr.map { c -> String in
                if let str = c as? String { return str }
                if let o = c as? [String: Any] {
                    if let t = o["text"] as? String { return t }
                    if let inner = o["content"] { return inlineText(inner) }
                }
                return ""
            }.joined()
        }
        return ""
    }
    var lines: [String] = []
    func walk(_ b: Any?) {
        guard let o = b as? [String: Any] else { return }
        let t = inlineText(o["content"]); if !t.isEmpty { lines.append(t) }
        if let children = o["children"] as? [Any] { children.forEach(walk) }
    }
    if let arr = json as? [Any] { arr.forEach(walk) } else { walk(json) }
    return lines.joined(separator: "\n")
}
