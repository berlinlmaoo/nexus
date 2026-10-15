import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The form builder's data — a port of the web's FormBuilder state
// (apps/web/src/components/forms/form-kit.tsx).
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
    /// `{ icon, cover }` — the emoji and the cover band the web's studio adds (12 Oct 2026).
    var branding: FormJSON? = nil
    /// `{ submitLabel, confirmationTitle, confirmationMessage, responseLimit, notifyUserIds }`.
    var settings: FormJSON? = nil
    let count: Count?
    struct Count: Decodable, Sendable { let submissions: Int? }

    enum CodingKeys: String, CodingKey {
        case id, name, description, slug, isPublic, requireAuth, projectId, fields, accessSchedule, branding, settings
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
    /// "set_field": the project field and the value it gets.
    var targetCustomFieldId: String
    var targetValue: String
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
        targetCustomFieldId = raw["targetCustomFieldId"]?.string ?? ""
        targetValue = raw["targetValue"]?.text ?? ""
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
        if targetCustomFieldId.isEmpty { out.removeValue(forKey: "targetCustomFieldId") } else { out["targetCustomFieldId"] = targetCustomFieldId }
        if targetValue.isEmpty { out.removeValue(forKey: "targetValue") } else { out["targetValue"] = targetValue }
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
    /// Helper text under the question; nil = no description row (the web deletes the key).
    var description: String?
    /// "" | "list" — a dropdown shown as a list of options on the web form.
    var display: String
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
        description = raw["description"]?.text
        display = raw["display"]?.string ?? ""
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
        if description != before.description {
            if let description { out["description"] = description } else { out.removeValue(forKey: "description") }
        }
        if display != before.display {
            if display.isEmpty { out.removeValue(forKey: "display") } else { out["display"] = display }
        }
        if mappingTarget != before.mappingTarget || mappingCustomFieldId != before.mappingCustomFieldId {
            var m = (raw["mapping"]?.object ?? [:]).mapValues { $0.any }
            m["target"] = mappingTarget
            if !mappingCustomFieldId.isEmpty { m["customFieldId"] = mappingCustomFieldId }
            out["mapping"] = m
        }
        return out
    }

    /// The web's `cleanFields`: a "Show only when" with no value picked yet isn't live and isn't saved.
    func cleanJSON() -> [String: Any] {
        var out = json()
        if let c = showIf, FormBuilderVocab.needsValue(c.op), c.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            out["showIf"] = NSNull()
        }
        return out
    }

    /// For "Duplicate to another project": the web's copy keeps the structure and drops what is
    /// tied to THIS project — routing rules (section, member and field ids) and a mapping to one of
    /// its project fields. Any other mapping target survives.
    func duplicateJSON() -> [String: Any] {
        var out = cleanJSON()
        if mappingTarget != "none" && mappingTarget != "custom_field" { out["mapping"] = ["target": mappingTarget] } else { out["mapping"] = NSNull() }
        out.removeValue(forKey: "routingRules")
        return out
    }

    /// The web's question kind: a view over `type` + `numberFormat`.
    var questionKind: FormQuestionKind {
        if type == "number" && numberFormat == "currency-idr" { return .rupiah }
        if type == "select" { return .dropdown }
        return FormQuestionKind(rawValue: type) ?? .text
    }

    /// How a number question's answer reads: Rupiah when the question is the Rupiah kind, else the
    /// format of the project number field its answer goes to ("Harga" sends to a Rupiah field, so its
    /// box says "Rp 0", UI tour run 14 N-01), else a plain number.
    func numberStyle(_ fields: [CustomField]) -> CustomFieldNumber.Style {
        if numberFormat == "currency-idr" { return CustomFieldNumber.Style(format: numberFormat) }
        if mappingTarget == "custom_field",
           let target = fields.first(where: { $0.id == mappingCustomFieldId }), target.type.uppercased() == "NUMBER" {
            return target.options?.numberStyle ?? .plain
        }
        return .plain
    }

    /// The empty number box: "0", "Rp 0", "US$0,00", "0%" — zero in the answer's format.
    func numberPlaceholder(_ style: CustomFieldNumber.Style) -> String {
        // A Rupiah answer is the web's "Rp" prefix with an empty box, no grey "0" (R14-WB-1; UI tour run 15,
        // Q-IA31 / Q-M18: the app drew "Rp 0").
        if style.numberFormat == "IDR" { return "Rp" }
        return CustomFieldNumber.format(0, style: style)
    }

    /// The web's `withKind`: turns the question into another kind, keeping what still applies.
    mutating func applyKind(_ k: FormQuestionKind) {
        type = k.storedType
        numberFormat = k == .rupiah ? "currency-idr" : ""
        if hasOptions && options.isEmpty { options = [""] }
        if type != "dropdown" { display = "" }
        if type != "text" && type != "email" { autofill = "" }
        if type == "file" { attachmentEnabled = false }
    }

    /// The web's `newQuestion(kind)`.
    static func fresh(kind: FormQuestionKind) -> BuilderField {
        var f = BuilderField(raw: ["id": .string(newId()), "name": .string(""), "label": .string(""), "type": .string("text"), "required": .bool(false)])
        f.applyKind(kind)
        return f
    }

    /// A copy of this question with a new id. A copy never inherits "this names the task": two titles would fight.
    func duplicated() -> BuilderField {
        var raw = self.raw
        let newId = BuilderField.newId()
        raw["id"] = .string(newId)
        var copy = self
        copy.raw = raw
        copy.id = newId
        if copy.mappingTarget == "task_title" { copy.mappingTarget = "none"; copy.mappingCustomFieldId = "" }
        return copy
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
    /// A one-off window on top of the weekly one: ISO instants, "" = none.
    var opensAt: String
    var closesAt: String

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
        opensAt = o["opensAt"]?.string ?? ""
        closesAt = o["closesAt"]?.string ?? ""
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
        if !opensAt.isEmpty { o["opensAt"] = opensAt }
        if !closesAt.isEmpty { o["closesAt"] = closesAt }
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
        ("equals", "is"), ("not_equals", "is not"), ("contains", "contains"),
        ("is_empty", "is empty"), ("is_not_empty", "is not empty"),
    ]
    static func needsValue(_ op: String) -> Bool { op != "is_empty" && op != "is_not_empty" }

    /// MAPPING_TARGETS
    static let mappingTargets: [(value: String, label: String)] = [
        ("none", "Nothing (answer stays in the description)"), ("task_title", "Task title"), ("task_description", "Task description"),
        ("task_due_date", "Due date"), ("task_status", "Status"), ("task_priority", "Priority"),
        ("task_list", "Section"), ("custom_field", "A project field"),
    ]

    /// ROUTING_ACTIONS
    static let routingActions: [(value: String, label: String)] = [
        ("assign_user", "Assign to"), ("set_field", "Set field"), ("set_task_list", "Move to section"),
    ]

    /// Project fields a routing rule may set (web SETTABLE_FIELD_TYPES).
    static let settableFieldTypes: Set<String> = ["SELECT", "MULTI_SELECT", "STATUS", "TEXT"]

    /// FORM_ACCESS_DAY_LABELS, index = JS getDay().
    static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
}

// MARK: - Studio (the web's FormStudio, 12 Oct 2026)

/// QUESTION_KINDS in form-model.ts: the type menu. `rupiah` is a number question with the Rupiah format.
enum FormQuestionKind: String, CaseIterable, Identifiable {
    case text, textarea, dropdown
    case multiSelect = "multi_select"
    case checkbox, number, rupiah, date, email, phone, url, file

    var id: String { rawValue }
    var storedType: String { self == .rupiah ? "number" : rawValue }
    var isBasic: Bool { [.text, .textarea, .dropdown, .multiSelect, .checkbox].contains(self) }

    var label: String {
        switch self {
        case .text: return T("Short answer")
        case .textarea: return T("Long answer")
        case .dropdown: return T("Single choice")
        case .multiSelect: return T("Multiple choice")
        case .checkbox: return T("Checkbox")
        case .number: return T("Number")
        case .rupiah: return T("Rupiah amount")
        case .date: return T("Date")
        case .email: return T("Email")
        case .phone: return T("Phone")
        case .url: return T("Link")
        case .file: return T("File upload")
        }
    }

    var hint: String {
        switch self {
        case .text: return T("One line of text")
        case .textarea: return T("Several lines")
        case .dropdown: return T("Pick one option")
        case .multiSelect: return T("Pick any number of options")
        case .checkbox: return T("A single yes / no tick")
        case .number: return T("Digits only")
        case .rupiah: return "Rp 1.500.000"
        case .date: return T("A day from a calendar")
        case .email: return "name@company.com"
        case .phone: return T("A phone number")
        case .url: return T("A web address")
        case .file: return T("One or more files")
        }
    }

    var icon: String {
        switch self {
        case .text: return "textformat"
        case .textarea: return "text.alignleft"
        case .dropdown: return "smallcircle.filled.circle"
        case .multiSelect: return "checklist"
        case .checkbox: return "checkmark.square"
        case .number: return "number"
        case .rupiah: return "wallet.pass"
        case .date: return "calendar"
        case .email: return "at"
        case .phone: return "phone"
        case .url: return "link"
        case .file: return "paperclip"
        }
    }
}

/// `branding`: an emoji icon and a cover ("preset:<key>" or an image URL). Other keys ride along.
struct FormBranding: Equatable, Sendable {
    var icon: String
    var cover: String
    var raw: [String: FormJSON]

    init(raw: FormJSON?) {
        self.raw = raw?.object ?? [:]
        icon = self.raw["icon"]?.string ?? ""
        cover = self.raw["cover"]?.string ?? ""
    }

    /// The web's setBranding: undefined keys go, an empty object becomes null.
    var json: Any {
        var o = raw.mapValues { $0.any }
        if icon.isEmpty { o.removeValue(forKey: "icon") } else { o["icon"] = icon }
        if cover.isEmpty { o.removeValue(forKey: "cover") } else { o["cover"] = cover }
        return o.isEmpty ? NSNull() : o
    }

    /// COVER_PRESETS in form-model.ts, as two-stop (or three-stop) gradients.
    static let covers: [(key: String, label: String, colors: [UInt])] = [
        ("paper", "Paper", [0xf4f1ea, 0xe7e1d5]),
        ("mist", "Mist", [0xe8edf3, 0xd5dee8]),
        ("lilac", "Lilac", [0xece8fd, 0xd9d1fb]),
        ("mint", "Mint", [0xe3f4ec, 0xc9eadb]),
        ("peach", "Peach", [0xfdebe1, 0xf9d3c0]),
        ("sky", "Sky", [0x8ec5fc, 0xe0c3fc]),
        ("dusk", "Dusk", [0x5b4bc4, 0x9d6bd6, 0xe7a3b4]),
        ("forest", "Forest", [0x1f4e3d, 0x3f7d5c]),
        ("ink", "Ink", [0x1d1f24, 0x3a3e48]),
    ]

    /// ICON_CHOICES in form-model.ts.
    static let icons = ["📝", "📋", "🧾", "💸", "💰", "🧮", "📦", "🛒", "🎟️", "📅", "🗓️", "⏰", "✈️", "🚗", "🏢", "🏠", "🎤", "🎬", "🎨", "📸", "🎧", "💡", "🛠️", "🧰", "📣", "📨", "📞", "🤝", "✅", "❓", "🔒", "⭐", "🔥", "🌱", "🍽️", "☕", "🎓", "🩺", "⚖️", "🧑‍💻"]
}

/// `settings`: what people see after sending, a response limit, who is notified. Other keys ride along.
struct FormStudioSettings: Equatable, Sendable {
    var submitLabel: String
    var confirmationTitle: String
    var confirmationMessage: String
    /// 0 = no limit.
    var responseLimit: Int
    var notifyUserIds: [String]
    var raw: [String: FormJSON]

    init(raw: FormJSON?) {
        self.raw = raw?.object ?? [:]
        submitLabel = self.raw["submitLabel"]?.string ?? ""
        confirmationTitle = self.raw["confirmationTitle"]?.string ?? ""
        confirmationMessage = self.raw["confirmationMessage"]?.string ?? ""
        if case .number(let n)? = self.raw["responseLimit"], n >= 1 { responseLimit = Int(n) } else { responseLimit = 0 }
        notifyUserIds = (self.raw["notifyUserIds"]?.array ?? []).compactMap(\.string)
    }

    /// The web's setSettings: empty strings, empty lists and "no limit" drop their key; nothing left = null.
    var json: Any {
        var o = raw.mapValues { $0.any }
        func put(_ key: String, _ v: String) { if v.isEmpty { o.removeValue(forKey: key) } else { o[key] = v } }
        put("submitLabel", submitLabel)
        put("confirmationTitle", confirmationTitle)
        put("confirmationMessage", confirmationMessage)
        if responseLimit > 0 { o["responseLimit"] = responseLimit } else { o.removeValue(forKey: "responseLimit") }
        if notifyUserIds.isEmpty { o.removeValue(forKey: "notifyUserIds") } else { o["notifyUserIds"] = notifyUserIds }
        return o.isEmpty ? NSNull() : o
    }

    /// Duplicating to another project: the people to notify belong to this one.
    var duplicateJSON: Any {
        var copy = self
        copy.notifyUserIds = []
        copy.raw.removeValue(forKey: "notifyUserIds")
        return copy.json
    }
}

/// Everything the studio edits and autosaves (the web's FormDraft).
struct FormStudioDraft: Equatable {
    var name: String
    var description: String
    var isPublic: Bool
    var requireAuth: Bool
    var schedule: BuilderSchedule
    var fields: [BuilderField]
    var branding: FormBranding
    var settings: FormStudioSettings

    /// The web's new form: one question, and that one names the task. Public, sign-in to send.
    static func blank() -> FormStudioDraft {
        let first = BuilderField(raw: [
            "id": .string(BuilderField.newId()), "name": .string(T("What do you need?")), "label": .string(T("What do you need?")),
            "type": .string("text"), "required": .bool(true), "mapping": .object(["target": .string("task_title")]),
        ])
        return FormStudioDraft(name: "", description: "", isPublic: true, requireAuth: true, schedule: BuilderSchedule(raw: nil),
                               fields: [first], branding: FormBranding(raw: nil), settings: FormStudioSettings(raw: nil))
    }

    init(name: String, description: String, isPublic: Bool, requireAuth: Bool, schedule: BuilderSchedule,
         fields: [BuilderField], branding: FormBranding, settings: FormStudioSettings) {
        self.name = name; self.description = description; self.isPublic = isPublic; self.requireAuth = requireAuth
        self.schedule = schedule; self.fields = fields; self.branding = branding; self.settings = settings
    }

    /// The web's load: the stored fields intact (advanced keys included).
    init(form f: BuilderForm) {
        let rows = (f.fields?.array ?? []).compactMap { $0.object }
        self.init(name: f.name, description: f.description ?? "", isPublic: f.isPublic ?? false, requireAuth: f.requireAuth ?? false,
                  schedule: BuilderSchedule(raw: f.accessSchedule), fields: rows.map { BuilderField(raw: $0) },
                  branding: FormBranding(raw: f.branding), settings: FormStudioSettings(raw: f.settings))
    }
}
