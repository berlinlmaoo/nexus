import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Saved views (owner, 12 Oct 2026, Notion's logic) — the part of the web's lib/project-views.ts the app
// applies: a view's filter (simple rules, AND; an advanced group is evaluated too when it is there), its
// sort and its grouping (section/status, priority, assignee, a select field — e.g. the "Per kategori"
// board the category conversion made). GET/POST/PATCH/DELETE /api/projects/:id/views.
//
// Rules the app cannot read (an operator or property it does not know) never hide a task: an unknown
// rule passes, as on the web.
// ─────────────────────────────────────────────────────────────────────────────

/// A rule's value: a string, a list, a number, or nothing.
enum ViewValue: Codable, Hashable, Sendable {
    case text(String), list([String]), number(Double), empty

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .empty }
        else if let s = try? c.decode(String.self) { self = .text(s) }
        else if let a = try? c.decode([String].self) { self = .list(a) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let b = try? c.decode(Bool.self) { self = .text(b ? "true" : "false") }
        else { self = .empty }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .list(let a): try c.encode(a)
        case .number(let n): try c.encode(n)
        case .empty: try c.encodeNil()
        }
    }

    var strings: [String] {
        switch self {
        case .text(let s): return s.isEmpty ? [] : [s]
        case .list(let a): return a
        case .number(let n): return [String(n)]
        case .empty: return []
        }
    }
    var json: Any {
        switch self {
        case .text(let s): return s
        case .list(let a): return a
        case .number(let n): return n
        case .empty: return NSNull()
        }
    }
}

struct ViewFilterRule: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var prop: String
    var op: String
    var value: ViewValue

    init(id: String = UUID().uuidString.lowercased(), prop: String, op: String, value: ViewValue) {
        self.id = id; self.prop = prop; self.op = op; self.value = value
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString.lowercased()
        prop = (try? c.decode(String.self, forKey: .prop)) ?? ""
        op = (try? c.decode(String.self, forKey: .op)) ?? ""
        value = (try? c.decode(ViewValue.self, forKey: .value)) ?? .empty
    }
    var json: [String: Any] { ["id": id, "prop": prop, "op": op, "value": value.json] }
}

/// An advanced filter group (read-only here): and/or over rules and nested groups.
final class ViewFilterGroup: Decodable, @unchecked Sendable {
    let mode: String
    let rules: [ViewFilterRule]
    let groups: [ViewFilterGroup]
    enum CodingKeys: String, CodingKey { case mode, rules }
    required init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = (try? c.decode(String.self, forKey: .mode)) ?? "and"
        // The list may mix rules and groups; each element is read once, as whichever it is.
        let nodes = (try? c.decode([FilterNode].self, forKey: .rules)) ?? []
        var rs: [ViewFilterRule] = [], gs: [ViewFilterGroup] = []
        for n in nodes {
            switch n {
            case .rule(let r): rs.append(r)
            case .group(let g): gs.append(g)
            case .skip: break
            }
        }
        rules = rs; groups = gs
    }
}

private enum FilterNode: Decodable {
    case rule(ViewFilterRule), group(ViewFilterGroup), skip
    enum Keys: String, CodingKey { case mode, prop }
    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: Keys.self)
        if let c, c.contains(.mode), !c.contains(.prop) { self = .group(try ViewFilterGroup(from: decoder)) }
        else if let r = try? ViewFilterRule(from: decoder) { self = .rule(r) }
        else { self = .skip }
    }
}

struct ViewSort: Codable, Hashable, Sendable {
    var prop: String
    var dir: String
    var json: [String: Any] { ["prop": prop, "dir": dir] }
}

struct ProjectViewConfig: Decodable, Sendable {
    var simple: [ViewFilterRule] = []
    var advanced: ViewFilterGroup? = nil
    var sort: [ViewSort] = []
    var groupBy: String? = nil
    var hideEmptyGroups: Bool? = nil
    var dateProp: String? = nil

    enum CodingKeys: String, CodingKey { case filter, sort, groupBy, hideEmptyGroups, dateProp }
    struct Filter: Decodable { let simple: [ViewFilterRule]?; let advanced: ViewFilterGroup? }

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let f = try? c.decodeIfPresent(Filter.self, forKey: .filter)
        simple = f?.simple ?? []
        advanced = f?.advanced
        sort = (try? c.decodeIfPresent([ViewSort].self, forKey: .sort)) ?? []
        groupBy = try? c.decodeIfPresent(String.self, forKey: .groupBy)
        hideEmptyGroups = try? c.decodeIfPresent(Bool.self, forKey: .hideEmptyGroups)
        dateProp = try? c.decodeIfPresent(String.self, forKey: .dateProp)
    }

    var isFiltered: Bool { !simple.isEmpty || advanced != nil }
}

struct ProjectViewFull: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let layout: String
    let builtin: String?
    let shared: Bool?
    let ownerId: String?
    let position: Int?
    let config: ProjectViewConfig

    enum CodingKeys: String, CodingKey { case id, name, layout, builtin, shared, ownerId, position, config }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        layout = (try? c.decode(String.self, forKey: .layout)) ?? "board"
        builtin = try? c.decodeIfPresent(String.self, forKey: .builtin)
        shared = try? c.decodeIfPresent(Bool.self, forKey: .shared)
        ownerId = try? c.decodeIfPresent(String.self, forKey: .ownerId)
        position = try? c.decodeIfPresent(Int.self, forKey: .position)
        config = (try? c.decodeIfPresent(ProjectViewConfig.self, forKey: .config)) ?? ProjectViewConfig()
    }

    /// The five built-in views mirror the app's own tabs; "category" (and every custom view) is extra.
    var isTabBuiltin: Bool { ["board", "list", "table", "calendar", "timeline"].contains(builtin ?? "") }
    var canDelete: Bool { builtin == nil }

    func title(fieldName: (String) -> String?) -> String {
        if let n = name, !n.trimmingCharacters(in: .whitespaces).isEmpty { return n }
        switch builtin {
        case "category": return T("By category")
        case "board": return T("Board")
        case "list": return T("List")
        default: return T("Untitled view")
        }
    }
}

struct ProjectViewsFullResponse: Decodable, Sendable {
    let views: [ProjectViewFull]?
    let canEditShared: Bool?
}

private struct ViewEnvelope: Decodable { let view: ProjectViewFull }

extension APIClient {
    private static func viewEnc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s }

    private func viewCall(_ req: URLRequest) async throws -> Data {
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(req) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        return data
    }

    func projectViewsFull(_ projectId: String) async throws -> ProjectViewsFullResponse {
        let data = try await viewCall(makeRequest("/api/projects/\(Self.viewEnc(projectId))/views"))
        do { return try JSONDecoder().decode(ProjectViewsFullResponse.self, from: data) } catch { throw APIError.decoding }
    }

    /// A new view: personal unless `shared` (MEMBER and up may share).
    func createProjectView(_ projectId: String, name: String, layout: String, shared: Bool, config: [String: Any]) async throws -> ProjectViewFull {
        var req = makeRequest("/api/projects/\(Self.viewEnc(projectId))/views", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "layout": layout, "shared": shared, "config": config])
        let data = try await viewCall(req)
        do { return try JSONDecoder().decode(ViewEnvelope.self, from: data).view } catch { throw APIError.decoding }
    }

    /// Renames a view and/or merges top-level config keys (`patch`, the web's preferred form).
    func updateProjectView(_ projectId: String, viewId: String, name: String? = nil, patch: [String: Any]? = nil) async throws {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let patch { body["patch"] = patch }
        var req = makeRequest("/api/projects/\(Self.viewEnc(projectId))/views/\(Self.viewEnc(viewId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await viewCall(req)
    }

    /// Deletes a custom view (built-ins answer 400). Restorable from Audit.
    func deleteProjectView(_ projectId: String, viewId: String) async throws {
        _ = try await viewCall(makeRequest("/api/projects/\(Self.viewEnc(projectId))/views/\(Self.viewEnc(viewId))", method: "DELETE"))
    }
}

// MARK: - the engine

/// What a view needs to know besides its config: the project's fields and who is looking.
struct ViewContext {
    let fields: [CustomField]
    let meId: String?
    let today: Date
}

enum ViewEngine {
    static let me = "__me__"
    static let none = "__none__"
    static let priorityOrder = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]

    // MARK: values

    static func cfValue(_ t: BoardTask, _ fieldId: String) -> String? {
        t.customFieldValues?.first { $0.customFieldId == fieldId }?.value
    }

    /// The values of one property on a task, as the filter and grouping compare them.
    static func values(_ t: BoardTask, _ prop: String, laneId: String) -> [String] {
        switch prop {
        case "section": return [laneId]
        case "status": return [(t.status ?? "TODO").uppercased()]
        case "priority": return [(t.priority ?? "NONE").uppercased()]
        case "assignee": return (t.assignees ?? []).compactMap { $0.user?.id }
        case "title": return [t.title]
        case "due": return t.dueDate.map { [$0] } ?? []
        case "start": return t.startDate.map { [$0] } ?? []
        default:
            if prop.hasPrefix("cf:") {
                let raw = (cfValue(t, String(prop.dropFirst(3))) ?? "").trimmingCharacters(in: .whitespaces)
                if raw.isEmpty { return [] }
                if raw.hasPrefix("["), let d = raw.data(using: .utf8), let a = try? JSONDecoder().decode([String].self, from: d) { return a }
                return [raw]
            }
            return []
        }
    }

    // MARK: filter

    static func matches(_ t: BoardTask, laneId: String, rule r: ViewFilterRule, ctx: ViewContext) -> Bool {
        let vals = values(t, r.prop, laneId: laneId)
        let wanted = r.value.strings.map { $0 == me ? (ctx.meId ?? "") : $0 }
        switch r.op {
        case "empty": return vals.isEmpty
        case "not_empty": return !vals.isEmpty
        case "any_of": return wanted.isEmpty || vals.contains(where: wanted.contains)
        case "none_of": return wanted.isEmpty || !vals.contains(where: wanted.contains)
        case "contains":
            guard let w = wanted.first, !w.isEmpty else { return true }
            return vals.contains { $0.localizedCaseInsensitiveContains(w) }
        case "not_contains":
            guard let w = wanted.first, !w.isEmpty else { return true }
            return !vals.contains { $0.localizedCaseInsensitiveContains(w) }
        case "is": return wanted.first.map { w in vals.contains { $0.caseInsensitiveCompare(w) == .orderedSame } } ?? true
        case "is_not": return wanted.first.map { w in !vals.contains { $0.caseInsensitiveCompare(w) == .orderedSame } } ?? true
        case "checked": return vals.contains { $0 == "true" }
        case "unchecked": return !vals.contains { $0 == "true" }
        case "eq", "neq", "gt", "gte", "lt", "lte":
            guard let w = wanted.first, let target = Double(CustomFieldNumber.normalize(w, idr: false)) else { return true }
            let nums = vals.compactMap { Double(CustomFieldNumber.normalize($0, idr: false)) }
            guard let n = nums.first else { return r.op == "neq" }
            switch r.op {
            case "eq": return n == target
            case "neq": return n != target
            case "gt": return n > target
            case "gte": return n >= target
            case "lt": return n < target
            default: return n <= target
            }
        case "on", "before", "after", "overdue", "today", "this_week", "next_days", "past_days":
            return dateMatch(vals.first, op: r.op, value: wanted.first, today: ctx.today, done: t.isDone)
        default:
            return true   // unknown operator: never hides a task
        }
    }

    private static func dateMatch(_ raw: String?, op: String, value: String?, today: Date, done: Bool) -> Bool {
        guard let raw, let d = parseDay(raw) else { return false }
        let cal = ProjDate.cal
        let day = cal.startOfDay(for: d), now = cal.startOfDay(for: today)
        switch op {
        case "overdue": return day < now && !done
        case "today": return day == now
        case "this_week":
            guard let w = cal.dateInterval(of: .weekOfYear, for: now) else { return false }
            return w.contains(day)
        case "next_days", "past_days":
            let n = Int(value ?? "") ?? 7
            let diff = cal.dateComponents([.day], from: now, to: day).day ?? 0
            return op == "next_days" ? (diff >= 0 && diff <= n) : (diff <= 0 && diff >= -n)
        default:
            guard let v = value, let other = parseDay(v) else { return true }
            let o = cal.startOfDay(for: other)
            return op == "on" ? day == o : (op == "before" ? day < o : day > o)
        }
    }

    private static let ymd: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = ProjDate.cal.timeZone
        return f
    }()
    /// An ISO timestamp or a plain "yyyy-MM-dd" (DATE fields, filter values).
    static func parseDay(_ s: String) -> Date? { ProjDate.parse(s) ?? ymd.date(from: String(s.prefix(10))) }

    static func passes(_ t: BoardTask, laneId: String, config: ProjectViewConfig, ctx: ViewContext) -> Bool {
        guard config.simple.allSatisfy({ matches(t, laneId: laneId, rule: $0, ctx: ctx) }) else { return false }
        if let g = config.advanced { return passes(t, laneId: laneId, group: g, ctx: ctx) }
        return true
    }

    private static func passes(_ t: BoardTask, laneId: String, group g: ViewFilterGroup, ctx: ViewContext) -> Bool {
        let results = g.rules.map { matches(t, laneId: laneId, rule: $0, ctx: ctx) } + g.groups.map { passes(t, laneId: laneId, group: $0, ctx: ctx) }
        if results.isEmpty { return true }
        return g.mode == "or" ? results.contains(true) : !results.contains(false)
    }

    // MARK: sort

    static func sorted(_ tasks: [BoardTask], laneId: String, by sort: [ViewSort]) -> [BoardTask] {
        guard !sort.isEmpty else {
            return tasks.enumerated().sorted { a, b in
                guard let ap = a.element.position, let bp = b.element.position else { return a.offset < b.offset }
                if ap != bp { return ap < bp }
                let ac = a.element.createdAt ?? "", bc = b.element.createdAt ?? ""
                if ac != bc { return ac < bc }
                return a.element.id < b.element.id
            }.map(\.element)
        }
        return tasks.enumerated().sorted { a, b in
            for s in sort {
                let c = compare(a.element, b.element, prop: s.prop, laneId: laneId)
                if c != 0 { return s.dir == "desc" ? c > 0 : c < 0 }
            }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// -1 / 0 / 1; an empty value sorts last whatever the direction.
    private static func compare(_ a: BoardTask, _ b: BoardTask, prop: String, laneId: String) -> Int {
        if prop == "priority" {
            let ia = priorityOrder.firstIndex(of: (a.priority ?? "NONE").uppercased()) ?? 4
            let ib = priorityOrder.firstIndex(of: (b.priority ?? "NONE").uppercased()) ?? 4
            return ia == ib ? 0 : (ia < ib ? -1 : 1)
        }
        let va = values(a, prop, laneId: laneId).first, vb = values(b, prop, laneId: laneId).first
        switch (va, vb) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (x?, y?):
            if let nx = Double(x), let ny = Double(y) { return nx == ny ? 0 : (nx < ny ? -1 : 1) }
            let r = x.localizedStandardCompare(y)
            return r == .orderedSame ? 0 : (r == .orderedAscending ? -1 : 1)
        }
    }

    // MARK: grouping

    /// What the board/list draws for a view: the sections (status options) filtered and sorted, or — for
    /// a view grouped by another property — one virtual lane per value ("grp:<prop>:<value>").
    static func lanes(_ lanes: [ProjectDetail.Lane], config: ProjectViewConfig?, ctx: ViewContext) -> [ProjectDetail.Lane] {
        guard let config else { return lanes }
        let filtered = lanes.map { lane in
            lane.with(tasks: sorted((lane.tasks ?? []).filter { passes($0, laneId: lane.id, config: config, ctx: ctx) }, laneId: lane.id, by: config.sort))
        }
        let groupBy = config.groupBy ?? "section"
        guard groupBy != "section", groupBy != "none", !groupBy.isEmpty else { return filtered }
        let all = filtered.flatMap { lane in (lane.tasks ?? []).map { ($0, lane.id) } }
        let keys = groupKeys(groupBy, all: all, ctx: ctx)
        var out: [ProjectDetail.Lane] = keys.map { key in
            let tasks = all.filter { pair in
                let v = values(pair.0, groupBy, laneId: pair.1)
                return key.value == none ? v.isEmpty : v.contains(key.value)
            }.map(\.0)
            return ProjectDetail.Lane(id: "grp:\(groupBy):\(key.value)", name: key.name, tasks: tasks, taskStatus: nil, color: key.color, position: nil)
        }
        if config.hideEmptyGroups == true { out = out.filter { !($0.tasks ?? []).isEmpty } }
        return out
    }

    struct GroupKey { let value: String; let name: String; let color: String }

    private static func groupKeys(_ prop: String, all: [(BoardTask, String)], ctx: ViewContext) -> [GroupKey] {
        let palette = StatusColor.keys.filter { $0 != "gray" && $0 != "brown" }
        switch prop {
        case "priority":
            let colors = ["URGENT": "red", "HIGH": "orange", "MEDIUM": "blue", "LOW": "green", "NONE": "gray"]
            return priorityOrder.map { GroupKey(value: $0, name: TaskPriorityName.label($0), color: colors[$0] ?? "gray") }
        case "status":
            return TaskStatusName.all.map { GroupKey(value: $0, name: TaskStatusName.label($0), color: StatusColor.forStatus[$0] ?? "gray") }
        case "assignee":
            var seen: [String: String] = [:], order: [String] = []
            for (t, _) in all { for a in t.assignees ?? [] { if let id = a.user?.id, seen[id] == nil { seen[id] = a.user?.name ?? "?"; order.append(id) } } }
            let people = order.sorted { a, b in a == ctx.meId ? true : (b == ctx.meId ? false : (seen[a] ?? "") < (seen[b] ?? "")) }
            return people.enumerated().map { i, id in GroupKey(value: id, name: seen[id] ?? "?", color: palette[i % palette.count]) }
                + [GroupKey(value: none, name: T("No assignee"), color: "gray")]
        default:
            let fieldId = prop.hasPrefix("cf:") ? String(prop.dropFirst(3)) : prop
            let field = ctx.fields.first { $0.id == fieldId }
            var choices = field?.choices ?? []
            // Values in use that the field no longer lists still get a column.
            for (t, laneId) in all { for v in values(t, prop, laneId: laneId) where !choices.contains(v) { choices.append(v) } }
            let name = field?.name ?? T("Field")
            return choices.enumerated().map { i, c in GroupKey(value: c, name: c, color: palette[i % palette.count]) }
                + [GroupKey(value: none, name: String(format: T("No %@"), name), color: "gray")]
        }
    }

    /// Splits a virtual lane id back into (property, value).
    static func groupTarget(_ laneId: String) -> (prop: String, value: String)? {
        guard laneId.hasPrefix("grp:") else { return nil }
        let rest = laneId.dropFirst(4)
        // The property itself may hold a colon ("cf:<id>"): the value is after the LAST separator that
        // follows the property.
        if rest.hasPrefix("cf:") {
            let afterCf = rest.dropFirst(3)
            guard let i = afterCf.firstIndex(of: ":") else { return nil }
            return ("cf:" + afterCf[..<i], String(afterCf[afterCf.index(after: i)...]))
        }
        guard let i = rest.firstIndex(of: ":") else { return nil }
        return (String(rest[..<i]), String(rest[rest.index(after: i)...]))
    }
}
