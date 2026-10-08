import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The form builder's data — a port of the web's FormBuilder state
// (apps/nexus-lovable-ui/src/components/forms/form-kit.tsx).
//
// `Form.fields` and `Form.accessSchedule` are untyped JSON columns, and the web
// edits a field as `{ ...f, ...patch }`: every key it does not know about rides
// along untouched. The builder here does the same. Each field keeps the object it
// was loaded from (`raw`), and saving writes back only the keys the builder owns,
// and only the ones that actually changed — so a key a newer web build adds is not
// silently dropped by an edit made from an older app.
// ─────────────────────────────────────────────────────────────────────────────

/// Any JSON value, kept exactly as it arrived.
enum FormJSON: Decodable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: FormJSON])
    case array([FormJSON])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([FormJSON].self) { self = .array(a) }
        else if let o = try? c.decode([String: FormJSON].self) { self = .object(o) }
        else { self = .null }
    }

    /// For JSONSerialization, which is how every request body in this app is written. A whole
    /// number goes back as an Int so `daysOfWeek: [1, 2]` does not come back as `[1.0, 2.0]`.
    var any: Any {
        switch self {
        case .string(let s): return s
        case .number(let n):
            if n.rounded() == n, abs(n) < 9_007_199_254_740_992 { return Int(n) }
            return n
        case .bool(let b): return b
        case .object(let o): return o.mapValues { $0.any }
        case .array(let a): return a.map { $0.any }
        case .null: return NSNull()
        }
    }

    var string: String? { if case .string(let s) = self { return s }; return nil }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var object: [String: FormJSON]? { if case .object(let o) = self { return o }; return nil }
    var array: [FormJSON]? { if case .array(let a) = self { return a }; return nil }
    var isNull: Bool { if case .null = self { return true }; return false }

    /// A scalar read as text. Options are written as strings, but the column is untyped and a
    /// number in there should become "3", not vanish.
    var text: String? {
        switch self {
        case .string(let s): return s
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return (n.rounded() == n && abs(n) < 9_007_199_254_740_992) ? String(Int(n)) : String(n)
        default: return nil
        }
    }
}

/// One row of `GET /api/forms?projectId=` — the whole form. The web's builder edits exactly this
/// row; it never asks `/api/forms/{id}`, whose answer carries every submission ever made.
struct BuilderForm: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String?
    let slug: String?
    let isPublic: Bool?
    let requireAuth: Bool?
    let projectId: String?
    let fields: FormJSON?
    let accessSchedule: FormJSON?
    let count: Count?
    struct Count: Decodable, Sendable { let submissions: Int? }

    enum CodingKeys: String, CodingKey {
        case id, name, description, slug, isPublic, requireAuth, projectId, fields, accessSchedule
        case count = "_count"
    }

    var submissionCount: Int { count?.submissions ?? 0 }
    var fieldCount: Int { fields?.array?.count ?? 0 }
    var publicURL: URL { FormLink.url(slug: slug, id: id) }
}

/// The link a form is shared by. Always the PUBLIC host — never the office LAN address a request
/// may have gone out on — because the link is for somebody else's phone. The slug first, like the
/// web's card (`/f/${form.slug || form.id}`); the public route and the app's universal link both
/// resolve either.
enum FormLink {
    static func url(slug: String?, id: String) -> URL {
        let key = (slug?.isEmpty == false) ? slug! : id
        return Config.baseURL.appendingPathComponent("f").appendingPathComponent(key)
    }
}

// MARK: - Field

/// `showIf`: show this field only when another field's answer matches.
struct BuilderCondition: Equatable, Sendable {
    var fieldId: String
    var op: String
    var value: String
}

/// One routing rule: when this field's answer matches, move the task or assign somebody.
struct BuilderRule: Identifiable, Equatable, Sendable {
    var id: String
    var op: String
    var value: String
    var action: String
    var targetTaskListId: String
    var targetUserId: String
    /// The rule as stored — `targetUserIds` (several assignees, written by older builds) lives
    /// here and is never touched.
    var raw: [String: FormJSON]

    init(raw: [String: FormJSON]) {
        self.raw = raw
        id = raw["id"]?.text ?? BuilderRule.newId()
        op = raw["operator"]?.string ?? "equals"
        value = raw["value"]?.text ?? ""
        action = raw["action"]?.string ?? "assign_user"
        targetTaskListId = raw["targetTaskListId"]?.string ?? ""
        targetUserId = raw["targetUserId"]?.string ?? ""
    }

    /// The web's new rule: `{ id, operator: "equals", value: "", action: "assign_user" }`.
    static func fresh() -> BuilderRule {
        BuilderRule(raw: ["id": .string(newId()), "operator": .string("equals"), "value": .string(""), "action": .string("assign_user")])
    }

    static func newId() -> String {
        "r_\(Int(Date().timeIntervalSince1970 * 1000))_\(Int.random(in: 0..<1_000_000))"
    }

    /// `{ ...x, ...patch }`: the stored rule with the builder's keys laid over it.
    func json() -> [String: Any] {
        var out = raw.mapValues { $0.any }
        out["id"] = id
        out["operator"] = op
        out["value"] = value
        out["action"] = action
        if targetTaskListId.isEmpty { out.removeValue(forKey: "targetTaskListId") } else { out["targetTaskListId"] = targetTaskListId }
        if targetUserId.isEmpty { out.removeValue(forKey: "targetUserId") } else { out["targetUserId"] = targetUserId }
        return out
    }
}

struct BuilderField: Identifiable, Equatable, Sendable {
    var id: String
    /// The web writes the same text to both `name` and `label`; the public form reads `name` first.
    var name: String
    var label: String
    var type: String
    var required: Bool
    var options: [String]
    var attachmentEnabled: Bool
    /// "" | "name" | "email"
    var autofill: String
    /// "" | "currency-idr"
    var numberFormat: String
    var showIf: BuilderCondition?
    var rules: [BuilderRule]
    /// "none" | task_title | task_description | task_due_date | task_status | task_priority | task_list | custom_field
    var mappingTarget: String
    var mappingCustomFieldId: String
    /// The field as stored; empty for a field made here.
    var raw: [String: FormJSON]

    /// Reads a stored field the way the web's builder loads one: `name ↔ label` filled from each
    /// other, and the legacy "select" shown as "dropdown".
    init(raw: [String: FormJSON]) {
        self.raw = raw
        id = raw["id"]?.text ?? BuilderField.newId()
        let n = raw["name"]?.text ?? ""
        let l = raw["label"]?.text ?? ""
        name = n.isEmpty ? l : n
        label = l.isEmpty ? n : l
        let t = raw["type"]?.string ?? "text"
        type = t == "select" ? "dropdown" : t
        required = raw["required"]?.bool ?? false
        if let flat = raw["options"]?.array {
            options = flat.compactMap(\.text)
        } else if let boxed = raw["options"]?.object?["choices"]?.array {
            options = boxed.compactMap(\.text)
        } else {
            options = []
        }
        attachmentEnabled = raw["attachmentEnabled"]?.bool ?? false
        autofill = raw["autofill"]?.string ?? ""
        numberFormat = raw["numberFormat"]?.string ?? ""
        if let c = raw["showIf"]?.object {
            showIf = BuilderCondition(fieldId: c["fieldId"]?.text ?? "", op: c["operator"]?.string ?? "equals", value: c["value"]?.text ?? "")
        } else {
            showIf = nil
        }
        rules = (raw["routingRules"]?.array ?? []).compactMap { $0.object.map(BuilderRule.init(raw:)) }
        let mapping = raw["mapping"]?.object
        mappingTarget = mapping?["target"]?.string ?? "none"
        mappingCustomFieldId = mapping?["customFieldId"]?.string ?? ""
    }

    /// The web's `newField()`: `{ id: field_<ms>_<n>, label: "", type: "text", required: false }`.
    static func fresh() -> BuilderField {
        BuilderField(raw: ["id": .string(newId()), "label": .string(""), "type": .string("text"), "required": .bool(false)])
    }

    static func newId() -> String {
        "field_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(6).lowercased())"
    }

    var kind: FormFieldKind? { FormFieldKind(rawValue: type) }
    var hasOptions: Bool { type == "dropdown" || type == "multi_select" || type == "select" }
    var displayName: String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? T("Untitled field") : n
    }

    /// What gets saved. Starts from the stored object and lays the builder's keys over it — and a
    /// key the person never changed keeps its stored value byte for byte, because "changed" is
    /// decided against a fresh read of that same stored object.
    func json() -> [String: Any] {
        var out = raw.mapValues { $0.any }
        let before = BuilderField(raw: raw)

        out["id"] = id
        out["name"] = name
        out["label"] = label
        out["type"] = type
        out["required"] = required

        // The web saves an options LIST cleaned (trimmed, blanks dropped). The old `{ choices }`
        // shape is left alone unless the options were actually edited.
        let storedAsList = raw["options"]?.array != nil
        if storedAsList || options != before.options || (hasOptions && raw["options"] == nil) {
            out["options"] = options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        }
        if attachmentEnabled != before.attachmentEnabled { out["attachmentEnabled"] = attachmentEnabled }
        // The web writes `undefined` for "none", which JSON.stringify drops: the key goes away.
        if autofill != before.autofill {
            if autofill.isEmpty { out.removeValue(forKey: "autofill") } else { out["autofill"] = autofill }
        }
        if numberFormat != before.numberFormat {
            if numberFormat.isEmpty { out.removeValue(forKey: "numberFormat") } else { out["numberFormat"] = numberFormat }
        }
        if showIf != before.showIf {
            if let c = showIf {
                var cond = (raw["showIf"]?.object ?? [:]).mapValues { $0.any }
                cond["fieldId"] = c.fieldId
                cond["operator"] = c.op
                cond["value"] = c.value
                out["showIf"] = cond
            } else {
                out["showIf"] = NSNull()
            }
        }
        if rules != before.rules { out["routingRules"] = rules.map { $0.json() } }
        if mappingTarget != before.mappingTarget || mappingCustomFieldId != before.mappingCustomFieldId {
            var m = (raw["mapping"]?.object ?? [:]).mapValues { $0.any }
            m["target"] = mappingTarget
            if !mappingCustomFieldId.isEmpty { m["customFieldId"] = mappingCustomFieldId }
            out["mapping"] = m
        }
        return out
    }

    /// For "Duplicate to another project": the web's copy keeps the structure and drops what is
    /// tied to THIS project — routing rules (section and member ids) and the custom-field id of a
    /// mapping. The mapping's target survives.
    func duplicateJSON() -> [String: Any] {
        var out = json()
        if mappingTarget != "none" { out["mapping"] = ["target": mappingTarget] } else { out["mapping"] = NSNull() }
        out.removeValue(forKey: "routingRules")
        return out
    }
}

// MARK: - Access schedule

/// `accessSchedule`, read the way the server normalises it (src/lib/form-access-schedule.ts).
struct BuilderSchedule: Equatable, Sendable {
    var enabled: Bool
    /// 0 = Sunday … 6 = Saturday.
    var days: [Int]
    /// "HH:mm"
    var start: String
    var end: String
    var timezone: String
    /// "" = follow the schedule, "open" = forced open, "closed" = forced closed.
    var override: String

    init(raw: FormJSON?) {
        let o = raw?.object ?? [:]
        enabled = o["enabled"]?.bool ?? false
        let ds = (o["daysOfWeek"]?.array ?? []).compactMap { v -> Int? in
            if case .number(let n) = v, n.rounded() == n, abs(n) < 1000 { return Int(n) }
            if case .string(let s) = v { return Int(s) }
            return nil
        }
        days = Array(Set(ds.filter { (0...6).contains($0) })).sorted()
        start = BuilderSchedule.validTime(o["startTime"]?.string) ?? "00:00"
        end = BuilderSchedule.validTime(o["endTime"]?.string) ?? "23:59"
        let tz = (o["timezone"]?.string ?? "").trimmingCharacters(in: .whitespaces)
        timezone = tz.isEmpty ? "Asia/Jakarta" : tz
        let ov = o["override"]?.string ?? ""
        override = (ov == "open" || ov == "closed") ? ov : ""
    }

    /// The server's TIME_PATTERN: ^([01]\d|2[0-3]):([0-5]\d)$
    private static func validTime(_ s: String?) -> String? {
        guard let s, s.count == 5 else { return nil }
        let parts = s.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]),
              parts[0].count == 2, parts[1].count == 2, (0...23).contains(h), (0...59).contains(m) else { return nil }
        return s
    }

    /// The full state, every time — the web's editor never sends half a schedule, so a partial
    /// edit cannot drop a sibling key.
    var json: [String: Any] {
        var o: [String: Any] = ["enabled": enabled, "daysOfWeek": days.sorted(), "startTime": start, "endTime": end, "timezone": timezone]
        if !override.isEmpty { o["override"] = override }
        return o
    }
}

// MARK: - Vocabulary (the web builder's lists, same values, same order)

/// FIELD_TYPES in form-kit.tsx.
enum FormFieldKind: String, CaseIterable, Identifiable {
    case text, textarea, email, number, date, dropdown
    case multiSelect = "multi_select"
    case checkbox, file

    var id: String { rawValue }

    var label: String {
        switch self {
        case .text: return T("Text")
        case .textarea: return T("Long text")
        case .email: return T("Email")
        case .number: return T("Number")
        case .date: return T("Date")
        case .dropdown: return T("Dropdown")
        case .multiSelect: return T("Multi-select")
        case .checkbox: return T("Checkbox")
        case .file: return T("File")
        }
    }

    var icon: String {
        switch self {
        case .text: return "textformat"
        case .textarea: return "text.alignleft"
        case .email: return "envelope"
        case .number: return "number"
        case .date: return "calendar"
        case .dropdown: return "chevron.down.square"
        case .multiSelect: return "checklist"
        case .checkbox: return "checkmark.square"
        case .file: return "paperclip"
        }
    }
}

enum FormBuilderVocab {
    /// OPERATORS
    static let operators: [(value: String, label: String)] = [
        ("equals", "equals"), ("not_equals", "does not equal"), ("contains", "contains"),
        ("is_empty", "is empty"), ("is_not_empty", "is not empty"),
    ]
    static func needsValue(_ op: String) -> Bool { op != "is_empty" && op != "is_not_empty" }

    /// MAPPING_TARGETS
    static let mappingTargets: [(value: String, label: String)] = [
        ("none", "Not mapped"), ("task_title", "Task title"), ("task_description", "Task description"),
        ("task_due_date", "Due date"), ("task_status", "Status"), ("task_priority", "Priority"),
        ("task_list", "Section / list"), ("custom_field", "Custom field"),
    ]

    /// ROUTING_ACTIONS
    static let routingActions: [(value: String, label: String)] = [
        ("set_task_list", "Move to section"), ("assign_user", "Assign to member"),
    ]

    /// FORM_ACCESS_DAY_LABELS, index = JS getDay().
    static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
}
