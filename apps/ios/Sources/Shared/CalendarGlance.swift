import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Calendar widgets (0.1.7): what the Home Screen and Lock Screen widgets and the watch-face
// complications draw, from ONE /api/calendar/glance snapshot, at any moment.
//
// The app saves a snapshot per scope (Mine / My division / Everyone) into the App Group; the widget
// works the picture out of it against "now" — bars, "+N", "Coming up", the four lists, the rings,
// overdue — so it moves at WIB midnight and when a task's time passes without the app running.
//
// A port of the web's apps/web/src/lib/calendar/glance.ts, held to the same golden
// files (Tests/CalendarGolden/glance, from fixtures/golden-glance). Change the rules there first.
//
// Foundation only: compiled into the app, the widget extension, the watch app and its complication.
// Days come from CalDays (Shared/CalendarCore.swift).
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Wire format (GET /api/calendar/glance?scope=)

enum GlanceScope: String, Codable, CaseIterable, Sendable {
    case me, division, all
}

/// One task, compact keys as the server sends them.
struct GlanceEntry: Codable, Hashable, Sendable {
    /// Nil when masked.
    let id: String?
    /// Only on a masked row: its stable key.
    let k: String?
    /// Title (≤ 60 characters); nil when masked — drawn as "Internal task".
    let t: String?
    /// WIB day "YYYY-MM-DD"; nil for a task without a due date ("Someday").
    let day: String?
    /// WIB "HH:MM", or nil for a date-only task.
    let time: String?
    /// "#rrggbb": project colour (Mine), my division's card (My division), the division (Everyone).
    let c: String
    /// Project name.
    let p: String?
    let prio: String?
    let done: Bool
    let m: Bool
    /// A calendar-only project: drawn, never open, never overdue.
    let ns: Bool?

    var key: String { id ?? k ?? "" }
    /// Still work to do: not done, and in a project that has a status.
    var isOpen: Bool { !done && ns != true }
}

struct GlanceHoliday: Codable, Hashable, Sendable {
    let day: String
    let name: String
}

struct GlanceRules: Codable, Hashable, Sendable {
    let overdueWindowDays: Int
    let urgentDays: Int
    static let standard = GlanceRules(overdueWindowDays: 14, urgentDays: 2)
}

struct GlanceSnapshot: Codable, Hashable, Sendable {
    let v: Int
    let userId: String
    /// "none" (not a company member) and "off" (outside the rollout) carry no tasks.
    let access: String
    /// What the server answered for: "division" without a card in the Bagan comes back as "me".
    let scope: String
    let today: String
    let from: String?
    let to: String?
    let rules: GlanceRules?
    let items: [GlanceEntry]
    let undated: [GlanceEntry]
    let holidays: [GlanceHoliday]
    let truncated: Bool

    var effectiveRules: GlanceRules { rules ?? .standard }
}

// MARK: - What a widget draws

enum GlanceOverdue: String, Sendable {
    case none, recent, stale
}

/// One task as a widget draws it. Not Identifiable on purpose: `id` is the task id and is nil on a
/// masked row — use `key` in a ForEach.
struct GlanceBar: Hashable, Sendable {
    let key: String
    /// Nil when masked: the row opens the day, never the task.
    let id: String?
    /// Nil when masked ("Internal task").
    let title: String?
    let day: String?
    let time: String?
    let color: String
    let project: String?
    let priority: String?
    /// Done, or a status-less project: drawn dimmed.
    let dim: Bool
    /// Ticked done (a status-less project never is): the ✓.
    let done: Bool
    let masked: Bool
    let overdue: GlanceOverdue
}

struct GlanceDay: Hashable, Sendable {
    let day: String
    /// Every task due that day (unique).
    let count: Int
    /// Of those, still to do.
    let open: Int
    /// The first `max` in the calendar's in-day order.
    let bars: [GlanceBar]
    /// "+N": the rest.
    let more: Int
    /// Something due that day is overdue within the window (a red mark).
    let overdue: Bool
    let today: Bool
    /// Public holiday name, or nil.
    let holiday: String?
    /// Sunday — drawn red like a holiday.
    let sunday: Bool
    /// Inside the snapshot's window. Outside it the widget knows nothing, which is not "no tasks".
    let covered: Bool
    /// Month cells only: false for the days of the weeks around the month.
    var inMonth: Bool = true
}

struct GlanceYear: Hashable, Sendable {
    /// 1 on 1 January.
    let day: Int
    let days: Int
    /// Floored, so 100 only on 31 December.
    let percent: Int
}

struct GlanceMonth: Hashable, Sendable {
    /// "YYYY-MM" of today.
    let month: String
    let today: String
    let year: GlanceYear
    /// 42 days, Monday first.
    let cells: [GlanceDay]
}

struct GlanceList: Hashable, Sendable {
    let rows: [GlanceBar]
    let more: Int
}

/// The four lists (decision 7: only in widgets).
enum GlanceQuadrant: String, CaseIterable, Sendable {
    /// Important and urgent.
    case doFirst = "do"
    /// Important.
    case plan
    /// Urgent.
    case act
    /// Neither — "Someday", undated tasks included.
    case later
}

struct GlanceQuadrantList: Hashable, Sendable {
    let quadrant: GlanceQuadrant
    let count: Int
    /// All of them, in order; a widget shows the first 2 / 4 / 8.
    let rows: [GlanceBar]
}

struct GlanceRing: Hashable, Sendable {
    let done: Int
    let total: Int
}

struct GlanceInline: Hashable, Sendable {
    /// Still to do today, overdue ones included.
    let openToday: Int
    /// The first of "Coming up", on any day.
    let nextDay: String?
    let nextTime: String?
}

enum GlanceFreshness: String, Sendable {
    /// Nothing saved: signed out, or never loaded.
    case empty
    /// The server said this account has no calendar.
    case none, off
    /// Saved more than 2 days ago, or today is outside the snapshot's window.
    case stale
    case fresh
}

// MARK: - The rules

enum CalendarGlance {
    /// A snapshot older than this is not shown as current ("Open NEXUS to refresh").
    static let staleAfterMs: Int64 = 2 * 86_400_000

    private static let wibMs: Int64 = 7 * 3_600_000

    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }
    static func date(ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    /// The WIB day and minute of an instant: ("2026-10-05", "12:00").
    static func clock(_ now: Date) -> (day: String, hm: String) {
        let shifted = date(ms: ms(now) + wibMs)
        return (CalDays.key(shifted), hmFormatter.string(from: shifted))
    }

    /// The instant a WIB day + "HH:MM" names, in ms.
    static func instantMs(_ day: String, _ hm: String) -> Int64 {
        let parts = hm.split(separator: ":").compactMap { Int64($0) }
        let h = parts.count > 0 ? parts[0] : 0
        let m = parts.count > 1 ? parts[1] : 0
        return ms(CalDays.date(day)) + (h * 60 + m) * 60_000 - wibMs
    }

    /// "recent" = overdue for at most the window (red), "stale" = older (stays on its date, grey). A
    /// date-only task is overdue once its WIB day is over; a timed one from the minute after its time.
    static func overdue(_ e: GlanceEntry, day: String, hm: String, windowDays: Int) -> GlanceOverdue {
        guard e.isOpen, let d = e.day else { return .none }
        let over: Bool
        if d < day {
            over = true
        } else if d == day, let t = e.time {
            over = t < hm
        } else {
            over = false
        }
        if !over { return .none }
        return CalDays.dayDiff(d, day) > windowDays ? .stale : .recent
    }

    private static let priority: [String: Int] = ["URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "NONE": 4]
    private static func prioRank(_ p: String?) -> Int { priority[p ?? "MEDIUM"] ?? 2 }

    /// −1 / 0 / 1 over UTF-16 code units — what JavaScript's `<` does on strings.
    private static func utf16Order(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        return a.utf16.lexicographicallyPrecedes(b.utf16) ? -1 : 1
    }

    /// Titles: lower-cased code units, then the raw string. Not a locale collation — the web, iOS and
    /// Android must agree to the byte.
    static func titleOrder(_ a: String, _ b: String) -> Int {
        let r = utf16Order(a.lowercased(), b.lowercased())
        return r != 0 ? r : utf16Order(a, b)
    }

    /// Inside one day — the calendar's own order: still to do first (overdue first), then done; timed by
    /// time, then date-only; priority URGENT → NONE; titled before masked; title; key.
    static func compareInDay(day: String, hm: String, windowDays: Int) -> (GlanceEntry, GlanceEntry) -> Int {
        return { a, b in
            let oa = a.isOpen ? 0 : 1
            let ob = b.isOpen ? 0 : 1
            if oa != ob { return oa - ob }
            let la = overdue(a, day: day, hm: hm, windowDays: windowDays) == .none ? 1 : 0
            let lb = overdue(b, day: day, hm: hm, windowDays: windowDays) == .none ? 1 : 0
            if la != lb { return la - lb }
            if (a.time == nil) != (b.time == nil) { return a.time == nil ? 1 : -1 }
            if a.time != b.time { return utf16Order(a.time ?? "", b.time ?? "") }
            let pa = prioRank(a.prio)
            let pb = prioRank(b.prio)
            if pa != pb { return pa - pb }
            if a.m != b.m { return a.m ? 1 : -1 }
            let t = titleOrder(a.t ?? "", b.t ?? "")
            if t != 0 { return t }
            return utf16Order(a.key, b.key)
        }
    }

    /// Across days (lists): by day, tasks without a date last, then the in-day order.
    static func compareChrono(day: String, hm: String, windowDays: Int) -> (GlanceEntry, GlanceEntry) -> Int {
        let inDay = compareInDay(day: day, hm: hm, windowDays: windowDays)
        return { a, b in
            if a.day != b.day {
                guard let da = a.day else { return 1 }
                guard let db = b.day else { return -1 }
                return utf16Order(da, db)
            }
            return inDay(a, b)
        }
    }

    private static func sorted(_ list: [GlanceEntry], by cmp: (GlanceEntry, GlanceEntry) -> Int) -> [GlanceEntry] {
        list.sorted { cmp($0, $1) < 0 }
    }

    private static func bar(_ e: GlanceEntry, day: String, hm: String, windowDays: Int) -> GlanceBar {
        GlanceBar(key: e.key, id: e.id, title: e.t, day: e.day, time: e.time, color: e.c, project: e.p,
                  priority: e.prio, dim: !e.isOpen, done: e.done && e.ns != true, masked: e.m,
                  overdue: overdue(e, day: day, hm: hm, windowDays: windowDays))
    }

    // MARK: Days

    private static func dayBars(_ s: GlanceSnapshot, _ d: String, max: Int, now: Date) -> GlanceDay {
        let (day, hm) = clock(now)
        let w = s.effectiveRules.overdueWindowDays
        let entries = sorted(s.items.filter { $0.day == d }, by: compareInDay(day: day, hm: hm, windowDays: w))
        var covered = false
        if let from = s.from, let to = s.to { covered = d >= from && d <= to }
        return GlanceDay(
            day: d,
            count: entries.count,
            open: entries.filter(\.isOpen).count,
            bars: entries.prefix(max).map { bar($0, day: day, hm: hm, windowDays: w) },
            more: Swift.max(0, entries.count - max),
            overdue: entries.contains { overdue($0, day: day, hm: hm, windowDays: w) == .recent },
            today: d == day,
            holiday: s.holidays.first { $0.day == d }?.name,
            sunday: CalDays.mondayIndex(d) == 6,
            covered: covered
        )
    }

    /// "Day 278 · 76%".
    static func yearProgress(_ day: String) -> GlanceYear {
        let y = Int(day.prefix(4)) ?? 1970
        let jan1 = String(format: "%04d-01-01", y)
        let next = String(format: "%04d-01-01", y + 1)
        let n = CalDays.dayDiff(jan1, day) + 1
        let days = CalDays.dayDiff(jan1, next)
        return GlanceYear(day: n, days: days, percent: (n * 100) / days)
    }

    /// The month that holds today, ≤ `maxBars` bars a day.
    static func monthView(_ s: GlanceSnapshot, now: Date, maxBars: Int) -> GlanceMonth {
        let day = clock(now).day
        let start = CalDays.mondayOf(String(day.prefix(8)) + "01")
        let month = String(day.prefix(7))
        let cells: [GlanceDay] = (0..<42).map { i in
            let d = CalDays.addDays(start, i)
            var cell = dayBars(s, d, max: maxBars, now: now)
            cell.inMonth = d.hasPrefix(month)
            return cell
        }
        return GlanceMonth(month: month, today: day, year: yearProgress(day), cells: cells)
    }

    /// Monday → Sunday of this week, ≤ `maxBars` bars a day.
    static func weekView(_ s: GlanceSnapshot, now: Date, maxBars: Int) -> [GlanceDay] {
        let monday = CalDays.mondayOf(clock(now).day)
        return (0..<7).map { dayBars(s, CalDays.addDays(monday, $0), max: maxBars, now: now) }
    }

    // MARK: Lists

    /// "Coming up" / "Next": open tasks not yet due — today's whose time has not passed (date-only ones
    /// count all day), then the days after — in order. `more` = the rest of the snapshot.
    static func upcoming(_ s: GlanceSnapshot, now: Date, limit: Int) -> GlanceList {
        let (day, hm) = clock(now)
        let w = s.effectiveRules.overdueWindowDays
        let list = sorted(s.items.filter { e in
            guard e.isOpen, let d = e.day else { return false }
            if d > day { return true }
            guard d == day else { return false }
            guard let t = e.time else { return true }
            return t >= hm
        }, by: compareChrono(day: day, hm: hm, windowDays: w))
        return GlanceList(rows: list.prefix(limit).map { bar($0, day: day, hm: hm, windowDays: w) },
                          more: Swift.max(0, list.count - limit))
    }

    /// Important = URGENT or HIGH. Urgent = URGENT, or due from today to `urgentDays − 1` days ahead
    /// (today and tomorrow by default), or overdue within the window.
    static func quadrantOf(_ e: GlanceEntry, day: String, rules: GlanceRules) -> GlanceQuadrant {
        let important = e.prio == "URGENT" || e.prio == "HIGH"
        var urgent = e.prio == "URGENT"
        if !urgent, let d = e.day {
            let ahead = CalDays.dayDiff(day, d)
            urgent = ahead < rules.urgentDays && ahead >= -rules.overdueWindowDays
        }
        if important && urgent { return .doFirst }
        if important { return .plan }
        if urgent { return .act }
        return .later
    }

    /// All four, every open task once (dated and undated), each in order.
    static func quadrants(_ s: GlanceSnapshot, now: Date) -> [GlanceQuadrantList] {
        let (day, hm) = clock(now)
        let rules = s.effectiveRules
        let all = (s.items + s.undated).filter(\.isOpen)
        let cmp = compareChrono(day: day, hm: hm, windowDays: rules.overdueWindowDays)
        return GlanceQuadrant.allCases.map { q in
            let list = sorted(all.filter { quadrantOf($0, day: day, rules: rules) == q }, by: cmp)
            return GlanceQuadrantList(quadrant: q, count: list.count,
                                      rows: list.map { bar($0, day: day, hm: hm, windowDays: rules.overdueWindowDays) })
        }
    }

    static func quadrant(_ q: GlanceQuadrant, _ s: GlanceSnapshot, now: Date) -> GlanceQuadrantList {
        quadrants(s, now: now).first { $0.quadrant == q } ?? GlanceQuadrantList(quadrant: q, count: 0, rows: [])
    }

    // MARK: Rings and one-liners

    /// Today's tasks done / all (status-less projects left out: they can never be done).
    static func todayRing(_ s: GlanceSnapshot, now: Date) -> GlanceRing {
        let day = clock(now).day
        let today = s.items.filter { $0.day == day && $0.ns != true }
        return GlanceRing(done: today.filter(\.done).count, total: today.count)
    }

    /// "3 due today · next 19:00".
    static func inline(_ s: GlanceSnapshot, now: Date) -> GlanceInline {
        let day = clock(now).day
        let first = upcoming(s, now: now, limit: 1).rows.first
        return GlanceInline(openToday: s.items.filter { $0.day == day && $0.isOpen }.count,
                            nextDay: first?.day, nextTime: first?.time)
    }

    // MARK: Freshness and redraws

    static func freshness(_ s: GlanceSnapshot?, savedAt: Date, now: Date) -> GlanceFreshness {
        guard let s else { return .empty }
        if s.access == "none" { return .none }
        if s.access == "off" { return .off }
        if ms(now) - ms(savedAt) > staleAfterMs { return .stale }
        let day = clock(now).day
        guard let to = s.to, day <= to else { return .stale }
        if let from = s.from, day < from { return .stale }
        return .fresh
    }

    /// The moments after `now` (within `horizon` seconds) at which the picture changes on its own: each
    /// WIB midnight, the minute after an open timed task's time, and the moment the snapshot turns stale.
    /// Sorted, unique, at most 48.
    static func redrawTimes(_ s: GlanceSnapshot, savedAt: Date, now: Date, horizon: TimeInterval) -> [Date] {
        let nowMs = ms(now)
        let end = nowMs + Int64((horizon * 1000).rounded())
        var out = Set<Int64>()
        var midnight = instantMs(CalDays.addDays(clock(now).day, 1), "00:00")
        while midnight <= end {
            out.insert(midnight)
            midnight += 86_400_000
        }
        for e in s.items where e.isOpen {
            guard let d = e.day, let t = e.time else { continue }
            let at = instantMs(d, t) + 60_000
            if at > nowMs && at <= end { out.insert(at) }
        }
        let stale = ms(savedAt) + staleAfterMs + 1
        if stale > nowMs && stale <= end { out.insert(stale) }
        return out.sorted().prefix(48).map { date(ms: $0) }
    }
}

// MARK: - Storage (App Group)

/// One saved answer per scope, with who it belongs to and when it was fetched.
struct GlanceStored: Codable, Sendable {
    let userId: String
    let savedAt: Date
    let snapshot: GlanceSnapshot
}

/// The calendar's half of the App Group: a snapshot per scope plus the app's language, so a widget
/// can speak it. Written by the app (CalendarWidgetPresence) and by the watch app into the watch's own
/// container; read by the widgets and complications, which never see the session or the API.
enum GlanceStore {
    private static func key(_ scope: GlanceScope) -> String { "calendar.glance.\(scope.rawValue)" }
    private static let langKey = "calendar.widget.lang"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: AttendanceSnapshot.appGroup) }

    static func load(_ scope: GlanceScope) -> GlanceStored? {
        guard let data = defaults?.data(forKey: key(scope)) else { return nil }
        return try? JSONDecoder().decode(GlanceStored.self, from: data)
    }

    static func save(_ snapshot: GlanceSnapshot, scope: GlanceScope, savedAt: Date = Date()) {
        // A nil suite is normal, not an error: it is what Mac Catalyst sees.
        guard let store = defaults,
              let data = try? JSONEncoder().encode(GlanceStored(userId: snapshot.userId, savedAt: savedAt, snapshot: snapshot))
        else { return }
        store.set(data, forKey: key(scope))
    }

    /// Signing out, or the widgets switched off from the server: nothing of this person stays behind.
    static func clear() {
        for scope in GlanceScope.allCases { defaults?.removeObject(forKey: key(scope)) }
    }

    /// "en" or "id", mirrored from the app's own setting (which lives in the app's standard defaults,
    /// out of the extension's reach).
    static func saveLanguage(_ code: String) {
        defaults?.set(code, forKey: langKey)
    }

    static var indonesian: Bool { defaults?.string(forKey: langKey) == "id" }
}

// MARK: - Words and formats the widgets share

/// Every word a calendar widget or complication shows, in the app's language. English first, as in
/// Localization.swift; the widget extension does not compile that file.
enum GlanceText {
    static func t(_ en: String, _ id: String) -> String { GlanceStore.indonesian ? id : en }

    /// One formatter per language and format, made once: a month widget asks for eight labels per
    /// entry and a timeline renders dozens of entries, and a DateFormatter is expensive to set up.
    private static let formatters = GlanceFormatterCache()

    private static func formatter(_ format: String) -> DateFormatter {
        let indonesian = GlanceStore.indonesian
        return formatters.formatter(format, indonesian: indonesian)
    }

    /// "19.00" in Indonesian, "19:00" in English (the server sends "HH:MM", WIB).
    static func time(_ hm: String) -> String {
        GlanceStore.indonesian ? hm.replacingOccurrences(of: ":", with: ".") : hm
    }
    /// "Oktober 2026" / "October 2026".
    static func monthYear(_ day: String) -> String { formatter("LLLL yyyy").string(from: CalDays.date(day)) }
    /// "Okt" / "Oct".
    static func monthShort(_ day: String) -> String { formatter("LLL").string(from: CalDays.date(day)) }
    /// "Kam 8" / "Thu 8".
    static func weekdayDay(_ day: String) -> String { formatter("EEE d").string(from: CalDays.date(day)) }
    /// "Kam" / "Thu".
    static func weekdayShort(_ day: String) -> String { formatter("EEE").string(from: CalDays.date(day)) }
    /// "Kamis" / "Thursday".
    static func weekdayLong(_ day: String) -> String { formatter("EEEE").string(from: CalDays.date(day)) }
    /// One letter: "S" / "M".
    static func weekdayLetter(_ day: String) -> String { formatter("EEEEE").string(from: CalDays.date(day)) }
    /// "Kamis 8 Oktober" / "Thursday 8 October": a day spelled out for VoiceOver.
    static func dayLong(_ day: String) -> String { formatter("EEEE d MMMM").string(from: CalDays.date(day)) }
    /// "8".
    static func dayNumber(_ day: String) -> String { String(Int(day.suffix(2)) ?? 0) }

    /// What a masked row says instead of its title.
    static var internalTask: String { t("Internal task", "Task internal") }

    static func title(_ bar: GlanceBar) -> String { bar.title ?? internalTask }

    /// "Today" / "Tomorrow" / "Thu 8".
    static func relativeDay(_ day: String, today: String) -> String {
        switch CalDays.dayDiff(today, day) {
        case 0: return t("Today", "Hari ini")
        case 1: return t("Tomorrow", "Besok")
        default: return weekdayDay(day)
        }
    }

    static func quadrantName(_ q: GlanceQuadrant) -> String {
        switch q {
        case .doFirst: return t("Important & urgent", "Penting dan mendesak")
        case .plan: return t("Important", "Penting")
        case .act: return t("Urgent", "Mendesak")
        case .later: return t("Someday", "Suatu hari")
        }
    }

    /// The line under a list's name where the name alone misleads. "Urgent" is also a priority in the
    /// app, and this list holds the other kind of urgent: due now, at normal priority — URGENT-priority
    /// tasks sit in "Important & urgent". The owner kept the names; this line says what they mean.
    static func quadrantNote(_ q: GlanceQuadrant) -> String? {
        switch q {
        case .act: return t("urgent, not high priority", "mendesak, bukan prioritas tinggi")
        case .later: return t("not urgent, not high priority", "tidak mendesak, bukan prioritas tinggi")
        case .doFirst, .plan: return nil
        }
    }

    /// The app says "Semua orang" for Everyone; the widgets and the watch say the same.
    static func scopeName(_ s: GlanceScope) -> String {
        switch s {
        case .me: return t("Mine", "Saya")
        case .division: return t("My division", "Divisi saya")
        case .all: return t("Everyone", "Semua orang")
        }
    }

    /// "Updated 14:05" / "Diperbarui 14.05", or the reason there is nothing current to show.
    static func footer(_ f: GlanceFreshness, savedAt: Date?) -> String {
        switch f {
        case .fresh:
            guard let savedAt else { return "" }
            let hm = CalendarGlance.clock(savedAt).hm
            return t("Updated \(time(hm))", "Diperbarui \(time(hm))")
        case .stale: return t("Open NEXUS to refresh", "Buka NEXUS untuk memperbarui")
        case .empty: return t("Open NEXUS to sign in", "Buka NEXUS untuk masuk")
        case .none, .off: return t("Calendar is not on for your account", "Kalender belum aktif untuk akunmu")
        }
    }

    /// "+3" / "+3 more" / "+3 lagi".
    static func more(_ n: Int, long: Bool = false) -> String {
        long ? t("+\(n) more", "+\(n) lagi") : "+\(n)"
    }

    /// "+3" as VoiceOver should say it: "3 more" / "3 lagi".
    static func moreSpoken(_ n: Int) -> String { t("\(n) more", "\(n) lagi") }

    /// "1 task" / "3 tasks" / "no tasks".
    static func taskCount(_ n: Int) -> String {
        switch n {
        case 0: return t("no tasks", "tidak ada task")
        case 1: return t("1 task", "1 task")
        default: return t("\(n) tasks", "\(n) task")
        }
    }

    /// What VoiceOver says for one day of a widget's month or week, which draws its tasks as bars and
    /// dots without words: "Today, Thursday 8 October, 3 tasks, some overdue". Outside the snapshot's
    /// window the widget knows nothing about a day, so it names the day and claims nothing more.
    static func dayLabel(_ d: GlanceDay) -> String {
        var parts: [String] = []
        if d.today { parts.append(t("Today", "Hari ini")) }
        parts.append(dayLong(d.day))
        if let holiday = d.holiday { parts.append(holiday) }
        if d.covered {
            parts.append(taskCount(d.count))
            if d.overdue {
                parts.append(d.count == 1 ? t("overdue", "lewat tenggat") : t("some overdue", "sebagian lewat tenggat"))
            }
        }
        return parts.joined(separator: ", ")
    }

    /// A row's mark, spoken: within the window, or overdue for longer (drawn grey).
    static func overdueLabel(_ o: GlanceOverdue) -> String? {
        switch o {
        case .recent: return t("Overdue", "Lewat tenggat")
        case .stale: return t("Long overdue", "Lama lewat tenggat")
        case .none: return nil
        }
    }

    /// A ticked task's check mark, spoken.
    static var doneLabel: String { t("Done", "Selesai") }

    /// One day of the attendance strip, spoken: "Monday, present" / "Senin, hadir". The tones and their
    /// words are the app's (AttendanceSnapshot.DayDot, Localization.swift).
    static func attendanceDay(_ dateKey: String, tone: String) -> String {
        let word: String
        switch tone {
        case "P": word = t("present", "hadir")
        case "L": word = t("late", "telat")
        case "I": word = t("permit", "izin")
        case "C": word = t("leave", "cuti")
        case "S": word = t("sick", "sakit")
        case "D": word = t("day off", "day off")
        case "A": word = t("absent", "alpha")
        default: word = t("nothing recorded", "belum ada catatan")
        }
        return weekdayLong(dateKey) + ", " + word
    }

    /// The whole strip in one sentence, so VoiceOver reads the week in one swipe rather than seven.
    static func attendanceWeek(_ days: [(dateKey: String, tone: String)]) -> String {
        t("Last \(days.count) days: ", "\(days.count) hari terakhir: ")
            + days.map { attendanceDay($0.dateKey, tone: $0.tone) }.joined(separator: "; ")
    }
}

/// The formatters GlanceText hands out, one per language and format. Widgets and complications render
/// off the main thread, so the map is behind a lock; formatting itself is thread-safe.
final class GlanceFormatterCache: @unchecked Sendable {
    private let lock = NSLock()
    private var map: [String: DateFormatter] = [:]

    func formatter(_ format: String, indonesian: Bool) -> DateFormatter {
        let key = (indonesian ? "id|" : "en|") + format
        lock.lock()
        defer { lock.unlock() }
        if let f = map[key] { return f }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: indonesian ? "id_ID" : "en_US")
        // A day key is that day's UTC midnight (CalDays.date), so formatting in UTC can never shift it.
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = format
        map[key] = f
        return f
    }
}

/// "#rrggbb" (also "#rgb" and "#rrggbbaa", alpha ignored) → 0…1 components, for a SwiftUI Color — and
/// the few colour rules a widget needs to stay readable in light and dark. Foundation only, like the
/// rest of this file: the app, the widgets, the watch and its complications all compile it, so the
/// palette below is the one place their colours can agree.
enum GlanceColor {
    typealias RGB = (r: Double, g: Double, b: Double)

    static func rgb(_ raw: String) -> (r: Double, g: Double, b: Double) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        if s.count == 8 { s = String(s.prefix(6)) }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return (0.39, 0.45, 0.55) }
        return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }

    // MARK: Palette

    /// A colour as a light and a dark hex, picked by the appearance a widget is drawn in.
    struct Pair: Sendable {
        let light: String
        let dark: String

        func pick(dark isDark: Bool) -> String { isDark ? dark : light }
    }

    /// The app's violet as a fill under a white number (CalTone.accentFill, NX.violetFill): today's
    /// disc everywhere a calendar draws one, so the app, the widgets and the watch agree on today.
    static let violet = Pair(light: "#6247D6", dark: "#6F5AE6")
    /// NX.violetText: violet words.
    static let violetText = Pair(light: "#6247D6", dark: "#B3A6FF")
    /// Sundays, public holidays and overdue dates as words.
    static let red = Pair(light: "#BE123C", dark: "#FB7185")
    /// The Calendar's overdue (CalTone.overdue): outlines and marks. Rose-700 in light, as the app has
    /// it since the contrast fix; the same as `red`, kept apart because it is a mark, not a word.
    static let overdue = Pair(light: "#BE123C", dark: "#FB7185")
    /// "Important".
    static let indigo = Pair(light: "#4338CA", dark: "#A5B4FC")
    /// "Urgent", and attendance still being sent.
    static let amber = Pair(light: "#92400E", dark: "#FBBF24")
    /// NX.success: a finished day.
    static let green = Pair(light: "#15803D", dark: "#34D399")
    /// A task overdue for longer than the window: still on its date, but grey.
    static let slate = Pair(light: "#64748B", dark: "#94A3B8")

    /// What a widget is drawn on, roughly: the darker of the light greys and the lighter of the dark
    /// greys iOS puts behind a `.fill.tertiary` widget. A colour that reads on these reads on the real one.
    static let lightSurface: RGB = (0xE5 / 255.0, 0xE5 / 255.0, 0xEA / 255.0)
    static let darkSurface: RGB = (0x2C / 255.0, 0x2C / 255.0, 0x2E / 255.0)
    static let white: RGB = (1, 1, 1)

    static func surface(dark: Bool) -> RGB { dark ? darkSurface : lightSurface }

    // MARK: Contrast

    /// WCAG relative luminance.
    static func luminance(_ c: RGB) -> Double {
        func channel(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    /// WCAG contrast ratio, 1…21.
    static func contrast(_ a: RGB, _ b: RGB) -> Double {
        let la = luminance(a)
        let lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// `c` moved just far enough in lightness — lighter on a dark surface, darker on a light one — to
    /// reach `ratio` against `surface`. Hue and saturation stay, so a project keeps its colour; one that
    /// already reads comes back unchanged. A navy project (#0c1427) on a dark widget becomes a blue you
    /// can see instead of a hole.
    static func readable(_ c: RGB, on surface: RGB, ratio: Double) -> RGB {
        if contrast(c, surface) >= ratio { return c }
        let hsl = toHSL(c)
        let target: Double = luminance(surface) < 0.18 ? 1 : 0
        let far = fromHSL(h: hsl.h, s: hsl.s, l: target)
        if contrast(far, surface) < ratio { return far }
        var near = hsl.l
        var reach = target
        for _ in 0..<24 {
            let mid = (near + reach) / 2
            if contrast(fromHSL(h: hsl.h, s: hsl.s, l: mid), surface) >= ratio { reach = mid } else { near = mid }
        }
        return fromHSL(h: hsl.h, s: hsl.s, l: reach)
    }

    /// A "#rrggbb" made readable on a widget of that appearance: 3:1 for a bar or a dot (WCAG 1.4.11),
    /// 4.5:1 for words.
    static func readable(_ hex: String, dark: Bool, ratio: Double) -> RGB {
        readable(rgb(hex), on: surface(dark: dark), ratio: ratio)
    }

    private static func toHSL(_ c: RGB) -> (h: Double, s: Double, l: Double) {
        let hi = max(c.r, c.g, c.b)
        let lo = min(c.r, c.g, c.b)
        let l = (hi + lo) / 2
        let d = hi - lo
        if d == 0 { return (0, 0, l) }
        let s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo)
        var h: Double
        if hi == c.r {
            h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0)
        } else if hi == c.g {
            h = (c.b - c.r) / d + 2
        } else {
            h = (c.r - c.g) / d + 4
        }
        h /= 6
        return (h, s, l)
    }

    private static func fromHSL(h: Double, s: Double, l: Double) -> RGB {
        if s == 0 { return (l, l, l) }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        func hue(_ tIn: Double) -> Double {
            var t = tIn
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1.0 / 6 { return p + (q - p) * 6 * t }
            if t < 1.0 / 2 { return q }
            if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
            return p
        }
        return (hue(h + 1.0 / 3), hue(h), hue(h - 1.0 / 3))
    }
}
