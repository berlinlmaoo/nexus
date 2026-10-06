import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Calendar (master calendar) — the data the server sends and the rules every client applies to it.
//
// A line-by-line port of the web reference apps/nexus-lovable-ui/src/lib/calendar/core.ts. Pure
// Foundation, no UIKit/SwiftUI, so it builds for the app, the widgets and the watch, and its golden
// test runs on Linux (Tests/CalendarGolden, swift:5.10 in Docker) against the same golden files as the
// web and Android. Change the rules in all three together.
//
// Owner's rules (plan "Rencana Kalender NEXUS", section 10): a task sits under the Bagan cards of its
// PICs; without a PIC in the Bagan, under its project's division (placedBy "project"); counts are
// unique tasks; overdue ≤ window days is overdue, older stays on its date in grey until done (10.17);
// tasks of status-less projects are never overdue; order everywhere = Bagan rank.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Shapes (as the server sends them)

struct CalUnit: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    /// "IP", "DIVISION" or "GROUP".
    let kind: String
    let parentId: String?
    let rank: Int
    let depth: Int
    let sectionId: String
    let color: String
    let colorDark: String
    let logoUrl: String?
    let leadUserId: String?

    var isGroup: Bool { kind == "GROUP" }
}

struct CalPerson: Codable, Hashable, Identifiable, Sendable {
    let userId: String
    let name: String?
    let avatar: String?
    let role: String
    let unitIds: [String]
    let homeUnitIds: [String]
    let reportsTo: [String: String]

    var id: String { userId }
}

struct CalMe: Codable, Hashable, Sendable {
    let userId: String
    let role: String?
    let homeUnitIds: [String]
}

/// "none" (not in the company workspace), "off" (outside the rollout), "all", or the staff visibility mode.
struct CalStructure: Codable, Sendable {
    let v: Int
    let version: String?
    let access: String
    let me: CalMe?
    let units: [CalUnit]
    let people: [CalPerson]
}

struct CalPlacement: Codable, Hashable, Sendable {
    let unitId: String
    let userIds: [String]
}

struct CalProjectRef: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let color: String
}

struct CalParentRef: Codable, Hashable, Sendable {
    let id: String
    let title: String
}

struct CalItem: Codable, Hashable, Identifiable, Sendable {
    /// Stable for a masked row too (an HMAC, not the task id).
    let key: String
    /// The task id; nil when masked (a private project the viewer is not in).
    let taskId: String?
    let masked: Bool
    let title: String?
    /// WIB day "YYYY-MM-DD" — never derive it from `due`.
    let day: String
    /// "HH:MM" WIB, nil for a date without a time.
    let time: String?
    let due: String
    let status: String
    let done: Bool
    /// A calendar-only project: no done/not done, never overdue.
    let noStatus: Bool
    let priority: String?
    let project: CalProjectRef?
    let linkedProjectIds: [String]
    let parent: CalParentRef?
    let assigneeIds: [String]
    let placements: [CalPlacement]
    /// "pic" or "project".
    let placedBy: String
    let unplacedIds: [String]
    let canEdit: Bool
    let editProjectId: String?

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, taskId = "id", masked, title, day, time, due, status, done, noStatus, priority, project
        case linkedProjectIds, parent, assigneeIds, placements, placedBy, unplacedIds, canEdit, editProjectId
    }
}

struct CalRules: Codable, Hashable, Sendable {
    let overdueWindowDays: Int
    let urgentDays: Int
}

struct CalHoliday: Codable, Hashable, Sendable {
    let day: String
    let name: String
}

struct CalPersonRef: Codable, Hashable, Sendable {
    let name: String?
    let avatar: String?
}

struct CalItemsResponse: Codable, Sendable {
    let v: Int
    let tz: String
    let today: String
    let now: String
    let from: String
    let to: String
    let access: String
    let structureVersion: String?
    let rules: CalRules?
    let items: [CalItem]
    let people: [String: CalPersonRef]
    let holidays: [CalHoliday]
    let truncated: Bool
}

struct CalOverdueResponse: Codable, Sendable {
    let v: Int
    let today: String
    let access: String
    let structureVersion: String?
    let rules: CalRules?
    let items: [CalItem]
    let people: [String: CalPersonRef]
    let truncated: Bool
}

/// GET /api/calendar/task?id= — how to open a task that is not in what is loaded.
struct CalTaskAccess: Codable, Sendable {
    let found: Bool
    let masked: Bool
    let canEdit: Bool
    let editProjectId: String?
    let projectId: String?
}

// MARK: - Days

enum CalDays {
    private static let dayMs: Double = 86_400_000

    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = utc
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// UTC midnight of a day string.
    static func date(_ day: String) -> Date { fmt.date(from: day) ?? Date(timeIntervalSince1970: 0) }
    static func key(_ date: Date) -> String { fmt.string(from: date) }

    static func addDays(_ day: String, _ n: Int) -> String {
        key(date(day).addingTimeInterval(Double(n) * 86_400))
    }

    /// Days from `a` to `b` (b − a).
    static func dayDiff(_ a: String, _ b: String) -> Int {
        Int(((date(b).timeIntervalSince1970 - date(a).timeIntervalSince1970) * 1000 / dayMs).rounded())
    }

    /// 0 = Monday … 6 = Sunday.
    static func mondayIndex(_ day: String) -> Int {
        (utc.component(.weekday, from: date(day)) + 5) % 7
    }

    static func mondayOf(_ day: String) -> String { addDays(day, -mondayIndex(day)) }

    /// The 42 days (six weeks, Monday first) of the month grid that holds `day`.
    static func monthGrid(_ day: String) -> [String] {
        let start = mondayOf(String(day.prefix(8)) + "01")
        return (0..<42).map { addDays(start, $0) }
    }

    static func gridRange(_ day: String) -> (from: String, to: String) {
        let g = monthGrid(day)
        return (g[0], g[41])
    }

    /// The same day `n` months away, clamped to the last day of that month.
    static func shiftMonth(_ day: String, _ n: Int) -> String {
        let y = Int(day.prefix(4)) ?? 1970
        let m = (Int(day.dropFirst(5).prefix(2)) ?? 1) - 1 + n
        let first = utc.date(from: DateComponents(year: y, month: m + 1, day: 1))!
        let last = utc.range(of: .day, in: .month, for: first)!.count
        let d = min(Int(day.suffix(2)) ?? 1, last)
        return String(key(first).prefix(8)) + String(format: "%02d", d)
    }

    /// Today's WIB day from this device's clock.
    static func wibToday(_ now: Date = Date()) -> String { key(now.addingTimeInterval(7 * 3600)) }

    /// An ISO-8601 instant from the server ("2026-10-05T03:00:00.000Z").
    static func instant(_ iso: String) -> Date? {
        isoFractional.date(from: iso) ?? isoPlain.date(from: iso)
    }

    // Made once, like `fmt` above: this runs for every timed task in every sort comparison and row,
    // and setting a formatter up costs far more than parsing with it (impeccable audit, 6 Oct 2026).
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

// MARK: - Overdue

enum CalOverdue: String, Sendable {
    case none, recent, stale
}

enum CalendarCore {

    /// "recent" = overdue for at most `windowDays` (drawn as overdue); "stale" = older (stays on its
    /// date, grey, until done). Date-only: once its WIB day is over; with a time: from that moment.
    /// Done tasks and tasks of status-less projects are never overdue.
    static func overdueState(_ item: CalItem, today: String, now: Date, windowDays: Int) -> CalOverdue {
        if item.done || item.noStatus || item.status == "CANCELLED" { return .none }
        let over: Bool
        if item.time == nil {
            over = item.day < today
        } else {
            over = (CalDays.instant(item.due) ?? .distantFuture) < now
        }
        if !over { return .none }
        return CalDays.dayDiff(item.day, today) > windowDays ? .stale : .recent
    }

    /// Still work to do: not done and in a project that has a status.
    static func isOpen(_ i: CalItem) -> Bool { !i.done && !i.noStatus }

    // MARK: Names

    /// The order names and titles sort in, the same on every platform: case- and accent-insensitive,
    /// then the plain string.
    static func nameOrder(_ a: String, _ b: String) -> Bool {
        let r = a.compare(b, options: [.caseInsensitive, .diacriticInsensitive])
        if r != .orderedSame { return r == .orderedAscending }
        return a < b
    }
}

// MARK: - The Bagan, indexed

struct CalIndex: Sendable {
    let units: [CalUnit]
    let byId: [String: CalUnit]
    /// Children in Bagan order (groups included).
    let children: [String: [CalUnit]]
    /// The top card (rank order), or nil for an empty Bagan.
    let top: CalUnit?
    let person: [String: CalPerson]

    init(units: [CalUnit], people: [CalPerson]) {
        let sorted = units.sorted { $0.rank < $1.rank }
        self.units = sorted
        var by: [String: CalUnit] = [:]
        for u in sorted { by[u.id] = u }
        byId = by
        var kids: [String: [CalUnit]] = [:]
        for u in sorted { if let p = u.parentId, by[p] != nil { kids[p, default: []].append(u) } }
        children = kids
        top = sorted.first { $0.parentId == nil && !$0.isGroup } ?? sorted.first
        var ppl: [String: CalPerson] = [:]
        for p in people { ppl[p.userId] = p }
        person = ppl
    }

    /// Parents of a unit, nearest first.
    func ancestors(_ id: String) -> [String] {
        var out: [String] = []
        var seen: Set<String> = [id]
        var p = byId[id]?.parentId
        while let cur = p, byId[cur] != nil, !seen.contains(cur) {
            out.append(cur)
            seen.insert(cur)
            p = byId[cur]?.parentId
        }
        return out
    }

    /// The units and everything below them.
    func subtree(_ ids: [String]) -> Set<String> {
        var out: Set<String> = []
        var stack = ids
        while let id = stack.popLast() {
            if out.contains(id) || byId[id] == nil { continue }
            out.insert(id)
            stack.append(contentsOf: (children[id] ?? []).map { $0.id })
        }
        return out
    }

    /// Where a unit shows at a focus level: the child of `focusId` on the way down (a group counts as
    /// one), `focusId` itself when the unit IS the focus, nil when it is not under the focus.
    func bucketOf(_ unitId: String, focus focusId: String) -> String? {
        if unitId == focusId { return focusId }
        let up = ancestors(unitId)
        guard let at = up.firstIndex(of: focusId) else { return nil }
        return at == 0 ? unitId : up[at - 1]
    }
}

// MARK: - Filters

enum CalScope: String, Codable, Sendable {
    case all, me, division
}

struct CalFilters: Codable, Hashable, Sendable {
    /// Whose tasks: Everyone, Mine or My division. A VIEW of the calendar, not a filter, on every
    /// platform (owner, 7 Oct 2026): `activeCount` leaves it out and `cleared()` keeps it. Counted, a
    /// "1" on the funnel pointed at a filter nobody could find, and "Reset filters" quietly turned
    /// Mine back into everybody's tasks.
    var scope: CalScope = .all
    var units: [String] = []
    var people: [String] = []
    var projects: [String] = []
    var priorities: [String] = []
    var hideDone = false
    var overdueOnly = false

    /// The filters at work — divisions, people, projects, priorities and the two switches. Never the scope.
    var activeCount: Int {
        (units.isEmpty ? 0 : 1) + (people.isEmpty ? 0 : 1) + (projects.isEmpty ? 0 : 1)
            + (priorities.isEmpty ? 0 : 1) + (hideDone ? 1 : 0) + (overdueOnly ? 1 : 0)
    }

    /// "Reset filters": every filter off, the scope as it was.
    func cleared() -> CalFilters {
        var f = CalFilters()
        f.scope = scope
        return f
    }
}

struct CalFilterContext {
    let ix: CalIndex
    let meId: String?
    let myHomes: [String]
    let today: String
    let now: Date
    let windowDays: Int
}

extension CalendarCore {

    static func filterItems(_ items: [CalItem], _ f: CalFilters, _ c: CalFilterContext) -> [CalItem] {
        let mine: Set<String>? = f.scope == .division ? c.ix.subtree(c.myHomes) : nil
        let picked: Set<String>? = f.units.isEmpty ? nil : c.ix.subtree(f.units)
        let people: Set<String>? = f.people.isEmpty ? nil : Set(f.people)
        let projects: Set<String>? = f.projects.isEmpty ? nil : Set(f.projects)
        let prios: Set<String>? = f.priorities.isEmpty ? nil : Set(f.priorities)
        return items.filter { i in
            if f.scope == .me, !(c.meId.map { i.assigneeIds.contains($0) } ?? false) { return false }
            if let mine, !i.placements.contains(where: { mine.contains($0.unitId) }) { return false }
            if let picked, !i.placements.contains(where: { picked.contains($0.unitId) }) { return false }
            if let people, !i.assigneeIds.contains(where: { people.contains($0) }) { return false }
            if let projects {
                guard let p = i.project, projects.contains(p.id) || i.linkedProjectIds.contains(where: { projects.contains($0) }) else { return false }
            }
            if let prios { guard let p = i.priority, prios.contains(p) else { return false } }
            if f.hideDone && i.done { return false }
            if f.overdueOnly && overdueState(i, today: c.today, now: c.now, windowDays: c.windowDays) == .none { return false }
            return true
        }
    }

    /// Items with at least one placement under the focus (all of them at the top).
    static func underFocus(_ items: [CalItem], _ ix: CalIndex, focus focusId: String) -> [CalItem] {
        if let top = ix.top, focusId == top.id { return items }
        let sub = ix.subtree([focusId])
        return items.filter { i in i.placements.contains { sub.contains($0.unitId) } }
    }
}

// MARK: - Grid

struct CalDot: Hashable, Sendable {
    /// The unit at the focus level (or "other" for a task placed nowhere).
    let unitId: String
    /// Filled = at least one task still to do; ring = only done / status-less tasks.
    var filled: Bool
    var count: Int
}

struct CalDayCell: Hashable, Sendable {
    let day: String
    /// Unique tasks that day (after filters and focus).
    let count: Int
    let dots: [CalDot]
    /// A task overdue within the window is due that day.
    let overdue: Bool
}

struct CalLegendEntry: Hashable, Sendable {
    let unitId: String
    let count: Int
}

extension CalendarCore {

    static func byDay(_ items: [CalItem]) -> [String: [CalItem]] {
        var m: [String: [CalItem]] = [:]
        for i in items { m[i.day, default: []].append(i) }
        return m
    }

    private static func buckets(_ i: CalItem, _ ix: CalIndex, _ focusId: String) -> [String] {
        var out: [String] = []
        for p in i.placements {
            if let b = ix.bucketOf(p.unitId, focus: focusId), !out.contains(b) { out.append(b) }
        }
        if out.isEmpty && i.placements.isEmpty { out.append("other") }
        return out
    }

    private static func rankOf(_ id: String, _ ix: CalIndex) -> Int {
        id == "other" ? Int.max : (ix.byId[id]?.rank ?? 0)
    }

    static func dayCell(_ day: String, _ items: [CalItem], _ ix: CalIndex, focus focusId: String, today: String, now: Date, windowDays: Int) -> CalDayCell {
        var dots: [String: CalDot] = [:]
        var order: [String] = []
        for i in items {
            for b in buckets(i, ix, focusId) {
                var d = dots[b] ?? { order.append(b); return CalDot(unitId: b, filled: false, count: 0) }()
                d.count += 1
                if isOpen(i) { d.filled = true }
                dots[b] = d
            }
        }
        let sorted = order.compactMap { dots[$0] }.sorted { rankOf($0.unitId, ix) < rankOf($1.unitId, ix) }
        return CalDayCell(
            day: day,
            count: items.count,
            dots: sorted,
            overdue: items.contains { overdueState($0, today: today, now: now, windowDays: windowDays) == .recent }
        )
    }

    /// One entry per unit at the focus level with tasks in `items` (unique count), in Bagan order.
    static func legend(_ items: [CalItem], _ ix: CalIndex, focus focusId: String) -> [CalLegendEntry] {
        var count: [String: Int] = [:]
        for i in items { for b in buckets(i, ix, focusId) { count[b, default: 0] += 1 } }
        return count.map { CalLegendEntry(unitId: $0.key, count: $0.value) }
            .sorted { (rankOf($0.unitId, ix), $0.unitId) < (rankOf($1.unitId, ix), $1.unitId) }
    }
}

// MARK: - Day panel

struct CalPersonRow: Hashable, Sendable {
    let userId: String
    let items: [CalItem]
}

final class CalTreeNode: Identifiable, @unchecked Sendable {
    let unit: CalUnit
    /// Unique tasks in this unit and everything below it.
    let count: Int
    /// Tasks placed exactly here (lens "by division").
    let items: [CalItem]
    /// People placed exactly here with their tasks (lens "by person"), in Bagan box order.
    let people: [CalPersonRow]
    /// Tasks placed here without a person (no PIC → its project's division).
    let loose: [CalItem]
    let children: [CalTreeNode]

    var id: String { unit.id }

    init(unit: CalUnit, count: Int, items: [CalItem], people: [CalPersonRow], loose: [CalItem], children: [CalTreeNode]) {
        self.unit = unit
        self.count = count
        self.items = items
        self.people = people
        self.loose = loose
        self.children = children
    }
}

struct CalDayTree: Sendable {
    let root: CalTreeNode?
    let total: Int
    let people: Int
    /// PICs not in the Bagan, beside PICs who are.
    let unplaced: [CalPersonRow]
}

extension CalendarCore {

    private static let priorityOrder: [String: Int] = ["URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "NONE": 4]

    /// Inside one unit: to do first (overdue first), then done; timed by time, then date-only;
    /// priority URGENT → NONE; titled before masked; title; key.
    static func compareInDay(today: String, now: Date, windowDays: Int) -> (CalItem, CalItem) -> Bool {
        return { a, b in
            let oa = isOpen(a) ? 0 : 1, ob = isOpen(b) ? 0 : 1
            if oa != ob { return oa < ob }
            let la = overdueState(a, today: today, now: now, windowDays: windowDays) == .none ? 1 : 0
            let lb = overdueState(b, today: today, now: now, windowDays: windowDays) == .none ? 1 : 0
            if la != lb { return la < lb }
            if (a.time == nil) != (b.time == nil) { return a.time != nil }
            if a.time != b.time { return (a.time ?? "") < (b.time ?? "") }
            let pa = priorityOrder[a.priority ?? "MEDIUM"] ?? 2, pb = priorityOrder[b.priority ?? "MEDIUM"] ?? 2
            if pa != pb { return pa < pb }
            if a.masked != b.masked { return !a.masked }
            let ta = a.title ?? "", tb = b.title ?? ""
            if ta != tb { return nameOrder(ta, tb) }
            return a.key < b.key
        }
    }

    /// BoD / One Above All, Manager, Staff, then people "di bawah" a leader of that card; A–Z within.
    static func personOrder(_ ix: CalIndex, unitId: String) -> (String, String) -> Bool {
        func tier(_ id: String) -> Int {
            guard let p = ix.person[id] else { return 4 }
            if p.reportsTo[unitId] != nil { return 3 }
            return p.role == "ONE_ABOVE_ALL" || p.role == "BOD" ? 0 : p.role == "MANAGER" ? 1 : 2
        }
        func name(_ id: String) -> String { ix.person[id]?.name ?? "" }
        return { a, b in
            let ta = tier(a), tb = tier(b)
            if ta != tb { return ta < tb }
            if name(a) != name(b) { return nameOrder(name(a), name(b)) }
            return a < b
        }
    }

    static func dayTree(_ items: [CalItem], _ ix: CalIndex, focus focusId: String, today: String, now: Date, windowDays: Int) -> CalDayTree {
        guard let focus = ix.byId[focusId] else { return CalDayTree(root: nil, total: 0, people: 0, unplaced: []) }
        let sub = ix.subtree([focusId])
        // Per unit: items (keyed, in first-seen order), people → items, loose.
        struct Slot { var items: [String: CalItem] = [:]; var itemOrder: [String] = []; var people: [String: [String: CalItem]] = [:]; var personOrder: [String] = []; var loose: [String: CalItem] = [:]; var looseOrder: [String] = [] }
        var at: [String: Slot] = [:]
        var shown: Set<String> = []
        var who: Set<String> = []
        var unplaced: [String: [String: CalItem]] = [:]
        var unplacedOrder: [String] = []
        for i in items {
            var inside = false
            for p in i.placements where sub.contains(p.unitId) {
                inside = true
                var s = at[p.unitId] ?? Slot()
                if s.items[i.key] == nil { s.itemOrder.append(i.key) }
                s.items[i.key] = i
                if p.userIds.isEmpty {
                    if s.loose[i.key] == nil { s.looseOrder.append(i.key) }
                    s.loose[i.key] = i
                }
                for u in p.userIds {
                    if s.people[u] == nil { s.personOrder.append(u) }
                    s.people[u, default: [:]][i.key] = i
                    who.insert(u)
                }
                at[p.unitId] = s
            }
            if !inside { continue }
            shown.insert(i.key)
            if i.placedBy == "pic" {
                for u in i.unplacedIds {
                    if unplaced[u] == nil { unplacedOrder.append(u) }
                    unplaced[u, default: [:]][i.key] = i
                    who.insert(u)
                }
            }
        }
        let cmp = compareInDay(today: today, now: now, windowDays: windowDays)
        func collect(_ n: CalTreeNode, into keys: inout Set<String>) {
            for i in n.items { keys.insert(i.key) }
            for k in n.children { collect(k, into: &keys) }
        }
        func build(_ u: CalUnit) -> CalTreeNode? {
            let s = at[u.id]
            let kids = (ix.children[u.id] ?? []).compactMap(build)
            var keys = Set(s?.itemOrder ?? [])
            for k in kids { collect(k, into: &keys) }
            if keys.isEmpty { return nil }
            let order = personOrder(ix, unitId: u.id)
            return CalTreeNode(
                unit: u,
                count: keys.count,
                items: s.map { s in s.itemOrder.compactMap { s.items[$0] }.sorted(by: cmp) } ?? [],
                people: s.map { s in s.personOrder.sorted(by: order).map { CalPersonRow(userId: $0, items: Array(s.people[$0]!.values).sorted(by: cmp)) } } ?? [],
                loose: s.map { s in s.looseOrder.compactMap { s.loose[$0] }.sorted(by: cmp) } ?? [],
                children: kids
            )
        }
        func name(_ id: String) -> String { ix.person[id]?.name ?? "" }
        let unplacedRows = unplacedOrder
            .sorted { name($0) != name($1) ? nameOrder(name($0), name($1)) : $0 < $1 }
            .map { CalPersonRow(userId: $0, items: Array(unplaced[$0]!.values).sorted(by: cmp)) }
        return CalDayTree(root: build(focus), total: shown.count, people: who.count, unplaced: unplacedRows)
    }
}

// MARK: - Week "People" table

enum CalWeekRow: Hashable, Sendable {
    case unit(unit: CalUnit, depth: Int, count: Int)
    /// "Not in the chart yet": PICs outside the Bagan beside PICs who are in it.
    case unplaced(depth: Int, count: Int)
    case person(unitId: String?, userId: String, depth: Int, days: [[CalItem]])
    case loose(unitId: String, depth: Int, days: [[CalItem]])
}

extension CalendarCore {

    /// Unit headers in Bagan order (indented under the focus), each with its people and a row for tasks
    /// without a person; columns = Monday…Sunday; "not in the chart yet" people last.
    static func weekRows(_ items: [CalItem], _ ix: CalIndex, focus focusId: String, monday: String, today: String, now: Date, windowDays: Int) -> [CalWeekRow] {
        let days = (0..<7).map { CalDays.addDays(monday, $0) }
        let week = items.filter { days.contains($0.day) }
        let tree = dayTree(week, ix, focus: focusId, today: today, now: now, windowDays: windowDays)
        func split(_ list: [CalItem]) -> [[CalItem]] { days.map { d in list.filter { $0.day == d } } }
        var out: [CalWeekRow] = []
        func walk(_ n: CalTreeNode, _ depth: Int) {
            out.append(.unit(unit: n.unit, depth: depth, count: n.count))
            for p in n.people { out.append(.person(unitId: n.unit.id, userId: p.userId, depth: depth + 1, days: split(p.items))) }
            if !n.loose.isEmpty { out.append(.loose(unitId: n.unit.id, depth: depth + 1, days: split(n.loose))) }
            for k in n.children { walk(k, depth + 1) }
        }
        if let root = tree.root { walk(root, 0) }
        if tree.root != nil, !tree.unplaced.isEmpty {
            out.append(.unplaced(depth: 0, count: tree.unplaced.count))
            for p in tree.unplaced { out.append(.person(unitId: nil, userId: p.userId, depth: 1, days: split(p.items))) }
        }
        return out
    }

    /// Overdue within the window, newest day first — from /overdue plus today's timed tasks whose time has passed.
    static func overdueRail(_ overdue: [CalItem], todays: [CalItem], today: String, now: Date, windowDays: Int) -> [CalItem] {
        var seen: Set<String> = []
        var out: [CalItem] = []
        for i in todays + overdue {
            if seen.contains(i.key) || overdueState(i, today: today, now: now, windowDays: windowDays) != .recent { continue }
            seen.insert(i.key)
            out.append(i)
        }
        let cmp = compareInDay(today: today, now: now, windowDays: windowDays)
        return out.sorted { a, b in a.day != b.day ? a.day > b.day : cmp(a, b) }
    }
}
