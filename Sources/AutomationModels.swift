import Foundation

// Project automations (server rebuilt 12 Oct 2026, "When / If / Do"; src/lib/automation-rules.ts on the
// DEV server). GET /api/automations?projectId= → { automations, canEdit }; every type arrives normalised
// (upper case), `actions` is the full list and `action` its first entry for older apps.

/// A JSON scalar or list of scalars: what a rule's `config` holds (schedule, recipients, section…).
enum AutoJSON: Decodable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), list([AutoJSON]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([AutoJSON].self) { self = .list(a) }
        else { self = .null }
    }

    var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }
    var strings: [String] {
        switch self {
        case .list(let a): return a.compactMap(\.string)
        case .string(let s): return s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        default: return []
        }
    }
    var ints: [Int] { strings.compactMap { Int($0) } }
    /// For JSONSerialization.
    var any: Any {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() ? Int(n) as Any : n as Any
        case .bool(let b): return b
        case .list(let a): return a.map(\.any)
        case .null: return NSNull()
        }
    }
}

struct AutomationRule: Decodable, Hashable, Sendable {
    var type: String
    var value: String?
    var field: String?
    var config: [String: AutoJSON]?

    init(type: String, value: String? = nil, field: String? = nil, config: [String: AutoJSON]? = nil) {
        self.type = type; self.value = value; self.field = field; self.config = config
    }

    private enum CodingKeys: String, CodingKey { case type, value, field, config }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = ((try? c.decodeIfPresent(String.self, forKey: .type)) ?? "UNKNOWN").uppercased()
        // Stored as text, but an old row may hold a number.
        value = (try? c.decodeIfPresent(AutoJSON.self, forKey: .value))?.string
        field = try? c.decodeIfPresent(String.self, forKey: .field)
        config = try? c.decodeIfPresent([String: AutoJSON].self, forKey: .config)
    }

    func cfg(_ key: String) -> AutoJSON? { config?[key] }

    var json: [String: Any] {
        var out: [String: Any] = ["type": type]
        if let value, !value.isEmpty { out["value"] = value }
        if let field, !field.isEmpty { out["field"] = field }
        if let config, !config.isEmpty {
            var c: [String: Any] = [:]
            for (k, v) in config { if case .null = v { continue }; c[k] = v.any }
            if !c.isEmpty { out["config"] = c }
        }
        return out
    }
}

struct AutomationCondition: Decodable, Hashable, Sendable {
    var field: String
    var op: String
    var value: String?
    init(field: String, op: String, value: String? = nil) { self.field = field; self.op = op; self.value = value }
    private enum CodingKeys: String, CodingKey { case field, op, value }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        field = (try? c.decodeIfPresent(String.self, forKey: .field)) ?? "status"
        op = (try? c.decodeIfPresent(String.self, forKey: .op)) ?? "is"
        value = (try? c.decodeIfPresent(AutoJSON.self, forKey: .value))?.string
    }
    var json: [String: Any] {
        var out: [String: Any] = ["field": field, "op": op]
        if let value, !value.isEmpty { out["value"] = value }
        return out
    }
}

struct AutomationConditions: Decodable, Hashable, Sendable {
    var match: String
    var rules: [AutomationCondition]
    init(match: String = "all", rules: [AutomationCondition] = []) { self.match = match; self.rules = rules }
    private enum CodingKeys: String, CodingKey { case match, rules }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        match = (try? c.decodeIfPresent(String.self, forKey: .match)) == "any" ? "any" : "all"
        rules = (try? c.decodeIfPresent([AutomationCondition].self, forKey: .rules)) ?? []
    }
}

struct AutomationsResponse: Decodable, Sendable {
    let automations: [Automation]?
    /// Project leads (Manager, BoD, One Above All) create, edit, toggle, delete and run. nil = an older
    /// server, which never said: the toggle stays as it was (the server still refuses non-leads).
    let canEdit: Bool?
}

struct Automation: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let enabled: Bool?
    let trigger: AutomationRule?
    let action: AutomationRule?
    let actions: [AutomationRule]?
    let conditions: AutomationConditions?
    let lastRunAt: String?
    let lastRunStatus: String?
    let runCount: Int?
    let nextRunAt: String?

    /// Every action in order: `actions`, else the single `action` of a row from before 12 Oct 2026.
    var allActions: [AutomationRule] {
        if let actions, !actions.isEmpty { return actions }
        return action.map { [$0] } ?? []
    }
}

struct AutomationRun: Decodable, Identifiable, Sendable {
    let id: String
    let createdAt: String?
    let event: String?
    let status: String?
    let steps: [Step]?
    let error: String?
    let durationMs: Int?
    let taskId: String?
    let task: TaskRef?
    let actor: ActorRef?
    struct Step: Decodable, Hashable, Sendable { let type: String?; let ok: Bool?; let skipped: Bool?; let message: String? }
    struct TaskRef: Decodable, Sendable { let id: String?; let title: String? }
    struct ActorRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
}

struct AutomationRunsResponse: Decodable, Sendable { let runs: [AutomationRun]?; let hasMore: Bool? }
struct AutomationRunNowResponse: Decodable, Sendable { let run: AutomationRun?; let skipped: Bool?; let reason: String? }
struct AutomationSaveResponse: Decodable, Sendable { let automation: Automation? }

// MARK: - Vocabulary (the web's automation-meta.ts, through T())

struct AutomationTypeDef: Identifiable, Hashable {
    let type: String
    let label: String
    let hint: String
    let symbol: String
    let group: String
    var needsTask: Bool = true
    var id: String { type }
}

enum AutomationVocab {
    static let triggers: [AutomationTypeDef] = [
        .init(type: "TASK_CREATED", label: "Task created", hint: "A task is added to this project", symbol: "plus", group: "Task events"),
        .init(type: "TASK_UPDATED", label: "Any property edited", hint: "Anything on a task changes", symbol: "pencil", group: "Task events"),
        .init(type: "STATUS_CHANGED", label: "Status changed", hint: "Optionally only to (or from) one status", symbol: "circle.dotted", group: "Task events"),
        .init(type: "ASSIGNEE_CHANGED", label: "Assignee changed", hint: "Someone is assigned or unassigned", symbol: "person.2", group: "Task events"),
        .init(type: "FIELD_CHANGED", label: "Field changed", hint: "One property changes (priority, due date, tags, a custom field…)", symbol: "pencil.line", group: "Task events"),
        .init(type: "COMMENT_ADDED", label: "Comment added", hint: "Someone comments on a task", symbol: "text.bubble", group: "Task events"),
        .init(type: "FORM_SUBMITTED", label: "Form submitted", hint: "A form of this project creates a task", symbol: "doc.text", group: "Task events"),
        .init(type: "DUE_DATE_APPROACHING", label: "Due date approaching", hint: "Some hours before a task is due", symbol: "alarm", group: "Time"),
        .init(type: "DUE_DATE_REACHED", label: "Due date reached", hint: "A task's due date passes and it isn't done", symbol: "calendar.badge.exclamationmark", group: "Time"),
        .init(type: "SCHEDULED", label: "Every…", hint: "On a schedule: daily, weekdays, weekly or monthly", symbol: "repeat", group: "Time"),
    ]

    static let actions: [AutomationTypeDef] = [
        .init(type: "SET_STATUS", label: "Set status", hint: "", symbol: "circle.dotted", group: "Edit the task"),
        .init(type: "MARK_COMPLETE", label: "Mark complete", hint: "", symbol: "checkmark.circle", group: "Edit the task"),
        .init(type: "SET_PRIORITY", label: "Set priority", hint: "", symbol: "flag", group: "Edit the task"),
        .init(type: "ASSIGN_TO", label: "Assign to", hint: "", symbol: "person.badge.plus", group: "Edit the task"),
        .init(type: "UNASSIGN", label: "Unassign", hint: "", symbol: "person.badge.minus", group: "Edit the task"),
        .init(type: "SET_FIELD", label: "Set a field", hint: "", symbol: "pencil.line", group: "Edit the task"),
        .init(type: "MOVE_TO_SECTION", label: "Move to section", hint: "", symbol: "folder", group: "Edit the task"),
        .init(type: "ADD_TAG", label: "Add tag", hint: "", symbol: "tag", group: "Edit the task"),
        .init(type: "REMOVE_TAG", label: "Remove tag", hint: "", symbol: "tag.slash", group: "Edit the task"),
        .init(type: "ARCHIVE_TASK", label: "Archive task", hint: "", symbol: "archivebox", group: "Edit the task"),
        .init(type: "CREATE_TASK", label: "Create task", hint: "", symbol: "doc.badge.plus", group: "Create", needsTask: false),
        .init(type: "CREATE_SUBTASK", label: "Create subtask", hint: "", symbol: "arrow.turn.down.right", group: "Create"),
        .init(type: "DUPLICATE_TASK", label: "Duplicate task", hint: "", symbol: "plus.square.on.square", group: "Create"),
        .init(type: "ADD_COMMENT", label: "Add comment", hint: "", symbol: "text.bubble", group: "Tell someone"),
        .init(type: "SEND_NOTIFICATION", label: "Send notification", hint: "", symbol: "bell", group: "Tell someone", needsTask: false),
    ]

    static func trigger(_ type: String?) -> AutomationTypeDef? { triggers.first { $0.type == type } }
    static func action(_ type: String?) -> AutomationTypeDef? { actions.first { $0.type == type } }

    static let statuses = TaskStatusName.all
    static let priorities = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]

    static func priorityLabel(_ p: String) -> String {
        switch p {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "MEDIUM": return T("Medium")
        case "LOW": return T("Low")
        case "NONE": return T("No priority")
        default: return humanizeEnum(p)
        }
    }

    /// A stored status/priority value as words; anything else as typed.
    static func valueLabel(_ v: String?) -> String {
        guard let v, !v.isEmpty else { return "" }
        if statuses.contains(v) { return TaskStatusName.label(v) }
        if priorities.contains(v) { return priorityLabel(v) }
        return v
    }

    static let builtinFields: [(key: String, label: String, kind: String)] = [
        ("status", "Status", "status"), ("priority", "Priority", "priority"), ("assignee", "Assignee", "person"),
        ("section", "Section", "section"), ("tags", "Tags", "text"), ("title", "Title", "text"),
        ("description", "Description", "text"), ("dueDate", "Due date", "date"), ("startDate", "Start date", "date"),
        ("creator", "Created by", "person"),
    ]
    /// Fields "Set a field" may write besides the ones that have their own action.
    static let settableBuiltin = ["title", "description", "dueDate", "startDate"]

    /// Operators per field kind, as the web offers them.
    static func ops(_ kind: String) -> [(op: String, label: String, noValue: Bool)] {
        switch kind {
        case "status", "priority", "section": return [("is", "is", false), ("is_not", "is not", false)]
        case "person": return [("is", "includes", false), ("is_not", "does not include", false), ("is_empty", "is empty", true), ("is_not_empty", "is not empty", true)]
        case "select": return [("is", "is", false), ("is_not", "is not", false), ("contains", "contains", false), ("is_empty", "is empty", true), ("is_not_empty", "is not empty", true)]
        case "number": return [("is", "=", false), ("gt", ">", false), ("lt", "<", false), ("is_empty", "is empty", true), ("is_not_empty", "is not empty", true)]
        case "date": return [("overdue", "is overdue", true), ("within_days", "is within the next … days", false), ("is_empty", "is empty", true), ("is_not_empty", "is not empty", true), ("lt", "is before", false), ("gt", "is after", false)]
        default: return [("contains", "contains", false), ("not_contains", "does not contain", false), ("is", "is", false), ("is_empty", "is empty", true), ("is_not_empty", "is not empty", true)]
        }
    }

    /// A custom field type → its condition kind (automation-meta.ts cfKind).
    static func cfKind(_ type: String?) -> String {
        switch (type ?? "").uppercased() {
        case "NUMBER", "RATING": return "number"
        case "DATE", "CREATED": return "date"
        case "SELECT", "DROPDOWN", "MULTI_SELECT", "STATUS", "CHECKBOX": return "select"
        case "PEOPLE": return "person"
        default: return "text"
        }
    }

    static func runStatusLabel(_ s: String?) -> String {
        switch s {
        case "SUCCESS": return T("Succeeded")
        case "PARTIAL": return T("Partly failed")
        case "FAILED": return T("Failed")
        case "SKIPPED": return T("Nothing to do")
        case "RUNNING": return T("Running")
        default: return s.map(humanizeEnum) ?? ""
        }
    }

    static func eventLabel(_ e: String?) -> String {
        switch e {
        case "task_created": return T("Task created")
        case "task_updated": return T("Task edited")
        case "comment_added": return T("Comment added")
        case "form_submitted": return T("Form submitted")
        case "due_approaching": return T("Due date approaching")
        case "due_reached": return T("Due date reached")
        case "scheduled": return T("Schedule")
        case "webhook": return T("Webhook received")
        case "manual": return T("Run by hand")
        default: return e.map(humanizeEnum) ?? ""
        }
    }

    static let weekdays: [(d: Int, label: String)] = [(1, "Mo"), (2, "Tu"), (3, "We"), (4, "Th"), (5, "Fr"), (6, "Sa"), (7, "Su")]

    static let templateHint = "{task} {project} {actor} {status} {due}"
}

/// Names the summary needs: sections, people, custom fields and forms of the project, by id.
struct AutomationContext: Sendable {
    var sections: [(id: String, name: String)] = []
    var members: [(id: String, name: String)] = []
    var fields: [(id: String, name: String, type: String, choices: [String])] = []
    var forms: [(id: String, name: String)] = []
    var tasks: [(id: String, title: String)] = []

    func sectionName(_ id: String?) -> String? { sections.first { $0.id == id }?.name }
    func personName(_ id: String) -> String {
        switch id {
        case "@actor": return T("Person who triggered it")
        case "@creator": return T("Task creator")
        case "@assignees": return T("Assignees")
        case "@leads": return T("Project Owners")
        case "@all": return T("Everyone")
        default: return members.first { $0.id == id }?.name ?? T("Someone")
        }
    }
    func fieldName(_ key: String?) -> String {
        guard let key else { return "" }
        if let b = AutomationVocab.builtinFields.first(where: { $0.key == key }) { return T(b.label) }
        if key.hasPrefix("cf:") { return fields.first { "cf:\($0.id)" == key }?.name ?? T("Custom field") }
        return humanizeEnum(key)
    }
    func fieldKind(_ key: String) -> String {
        if let b = AutomationVocab.builtinFields.first(where: { $0.key == key }) { return b.kind }
        return AutomationVocab.cfKind(fields.first { "cf:\($0.id)" == key }?.type)
    }
    /// A condition / field value as words: a status, a section, a person, else as typed.
    func valueText(field: String?, _ v: String?) -> String {
        guard let v, !v.isEmpty else { return "" }
        switch field.map(fieldKind) {
        case "section": return sectionName(v) ?? v
        case "person": return personName(v)
        default: return AutomationVocab.valueLabel(v)
        }
    }

    // MARK: readable sentences

    func triggerText(_ r: AutomationRule?) -> String {
        guard let r else { return "—" }
        switch r.type {
        case "STATUS_CHANGED":
            let from = r.cfg("from")?.string ?? ""
            let to = r.value ?? ""
            if !from.isEmpty && !to.isEmpty {
                return String(format: T("Status changes from %@ to %@"), TaskStatusName.label(from), TaskStatusName.label(to))
            }
            if !to.isEmpty { return String(format: T("Status changed to %@"), TaskStatusName.label(to)) }
            if !from.isEmpty { return String(format: T("Status changes from %@"), TaskStatusName.label(from)) }
            return T("Status changed")
        case "TASK_COMPLETED": return T("Task completed")
        // Removed with NEXUS webhooks (12 Oct 2026): such a rule never fires; it stays so its owner can change it.
        case "WEBHOOK_RECEIVED": return T("Webhook received (removed)")
        case "ASSIGNEE_CHANGED":
            if let v = r.value, !v.isEmpty { return String(format: T("%@ is assigned"), personName(v)) }
            return T("Assignee changed")
        case "FIELD_CHANGED":
            let f = fieldName(r.field)
            if r.field == "tags", let v = r.value, !v.isEmpty { return String(format: T("A task gets the tag “%@”"), v) }
            if let v = r.value, !v.isEmpty { return String(format: T("%@ becomes %@"), f, valueText(field: r.field, v)) }
            return String(format: T("%@ changes"), f)
        case "FORM_SUBMITTED":
            if let v = r.value, let form = forms.first(where: { $0.id == v }) { return String(format: T("Form “%@” is submitted"), form.name) }
            return T("Form submitted")
        case "DUE_DATE_APPROACHING":
            return String(format: T("%@h before due"), r.value?.isEmpty == false ? r.value! : "24")
        case "SCHEDULED":
            let freq = r.cfg("frequency")?.string ?? "daily"
            let time = r.cfg("time")?.string ?? "09:00"
            switch freq {
            case "weekdays": return String(format: T("Every weekday at %@ WIB"), time)
            case "monthly":
                return String(format: T("Every month on day %@ at %@ WIB"), r.cfg("dayOfMonth")?.string ?? "1", time)
            case "weekly":
                let days = (r.cfg("days")?.ints ?? []).compactMap { d in AutomationVocab.weekdays.first { $0.d == d }.map { T($0.label) } }
                return String(format: T("Every %@ at %@ WIB"), days.joined(separator: ", "), time)
            default: return String(format: T("Every day at %@ WIB"), time)
            }
        default:
            return AutomationVocab.trigger(r.type).map { T($0.label) } ?? humanizeEnum(r.type)
        }
    }

    func conditionText(_ c: AutomationCondition) -> String {
        let kind = fieldKind(c.field)
        let op = AutomationVocab.ops(kind).first { $0.op == c.op }
        let opText = op.map { T($0.label) } ?? humanizeEnum(c.op)
        if op?.noValue == true { return "\(fieldName(c.field)) \(opText)" }
        if c.op == "within_days" { return "\(fieldName(c.field)) " + String(format: T("is within the next %@ days"), c.value ?? "0") }
        return "\(fieldName(c.field)) \(opText) \(valueText(field: c.field, c.value))"
    }

    func actionText(_ a: AutomationRule) -> String {
        let base = AutomationVocab.action(a.type).map { T($0.label) } ?? humanizeEnum(a.type)
        let v = a.value ?? ""
        switch a.type {
        case "SET_STATUS", "SET_PRIORITY":
            return v.isEmpty ? base : "\(base): \(AutomationVocab.valueLabel(v))"
        case "ADD_TAG", "REMOVE_TAG":
            return v.isEmpty ? base : "\(base): \(v)"
        case "MOVE_TO_SECTION":
            return v.isEmpty ? base : "\(base): \(sectionName(v) ?? v)"
        case "ASSIGN_TO", "UNASSIGN":
            let people = v.split(separator: ",").map { personName($0.trimmingCharacters(in: .whitespaces)) }
            return people.isEmpty ? base : "\(base): \(people.joined(separator: ", "))"
        case "SET_FIELD":
            guard let f = a.field else { return base }
            return v.isEmpty ? String(format: T("Clear %@"), fieldName(f)) : String(format: T("Set %@ to %@"), fieldName(f), valueText(field: f, v))
        case "SEND_NOTIFICATION":
            let to = (a.cfg("to")?.strings ?? []).map(personName)
            return to.isEmpty ? base : "\(base) → \(to.joined(separator: ", "))"
        case "CREATE_TASK", "CREATE_SUBTASK", "ADD_COMMENT":
            return v.isEmpty ? base : "\(base): “\(v)”"
        case "DUPLICATE_TASK":
            if let s = a.cfg("sectionId")?.string, let name = sectionName(s) { return "\(base) → \(name)" }
            return base
        default:
            return base
        }
    }

    /// "When … → if … → do …", the whole rule in one line.
    func summary(_ a: Automation) -> String {
        var parts = ["\(T("When")) \(triggerText(a.trigger))"]
        if let c = a.conditions, !c.rules.isEmpty {
            let joiner = c.match == "any" ? " \(T("or")) " : " \(T("and")) "
            parts.append("\(T("if")) " + c.rules.map(conditionText).joined(separator: joiner))
        }
        let acts = a.allActions.map(actionText)
        parts.append("\(T("do")) " + (acts.isEmpty ? "—" : acts.joined(separator: ", ")))
        return parts.joined(separator: " → ")
    }
}

/// The system identity "Automation" (DEV server since 12 Oct 2026, lib/automation-identity.ts): every
/// comment, task, activity row and archive an automation writes is signed by it. Recognised by its fixed
/// avatar path (every author payload carries it) or its email; shown as "Automation" / "Otomasi" with a
/// ⚡ avatar, and never opens a profile.
enum SystemUsers {
    static let automationAvatar = "/api/system-avatars/automation.png"
    static let automationEmail = "automation@nexus.invalid"

    static func isAutomation(avatar: String?, email: String? = nil) -> Bool {
        if let email, email.lowercased() == automationEmail { return true }
        guard let avatar else { return false }
        return avatar == automationAvatar || avatar.hasSuffix(automationAvatar)
    }

    /// The name to show for an author.
    static func name(_ name: String?, avatar: String?, email: String? = nil, fallback: String = "") -> String {
        if isAutomation(avatar: avatar, email: email) { return T("Automation") }
        return name ?? fallback
    }
}
