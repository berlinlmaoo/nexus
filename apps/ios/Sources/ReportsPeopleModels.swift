import Foundation

// Models for "Reports per crew": GET /api/reports/people and GET /api/reports/people/[userId].
//
// Every field is decoded softly on purpose. This screen is a stack of independent cards, and a
// report that fails to decode as a whole shows nothing at all — so a field the server renames, a
// null where a number was expected, or one malformed overdue row must cost at most that one
// number or that one row, never the screen. Counts are Double throughout because the server
// splits multi-assignee tasks between assignees, so "2.5 completed" is a real value.
//
// Foundation only (no SwiftUI, no T()) so the decoding can be proven on Linux with a plain
// `swiftc` probe; formatting for the screen lives in the views.

/// "num of den", e.g. on-time completions over completions that had a due date.
struct ReportRatio: Decodable, Sendable {
    let num: Double
    let den: Double

    private enum CodingKeys: String, CodingKey { case num, den }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        num = c.reportSoft(.num) ?? 0
        den = c.reportSoft(.den) ?? 0
    }

    /// Nil when there was nothing to measure, so the screen can say "—" instead of a fake 0%.
    var percent: Double? { den > 0 ? num / den * 100 : nil }
}

/// An attendance period (28th → 27th) or a custom range.
struct ReportPeriod: Decodable, Sendable {
    /// "YYYY-MM" for a whole attendance period; nil for a custom from/to range.
    let key: String?
    let from: String?
    let to: String?
    let timezone: String?
    let isCurrent: Bool?
    let days: Double?
    let daysElapsed: Double?

    private enum CodingKeys: String, CodingKey { case key, from, to, timezone, isCurrent, days, daysElapsed }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = c.reportSoft(.key)
        from = c.reportSoft(.from)
        to = c.reportSoft(.to)
        timezone = c.reportSoft(.timezone)
        isCurrent = c.reportSoft(.isCurrent)
        days = c.reportSoft(.days)
        daysElapsed = c.reportSoft(.daysElapsed)
    }
}

/// The handful of numbers shown on a KPI tile or a roster row, for one period.
struct ReportHeadline: Decodable, Sendable {
    let assigned: Double?
    let completed: Double?
    let onTime: ReportRatio?
    let overdue: Double?
    let medianCycleDays: Double?
    let present: Double?
    let late: Double?
    let lateMinutes: Double?
    let earlyLeave: Double?
    let absent: Double?
    let leave: Double?
    let sick: Double?
    let permit: Double?
    let dayOff: Double?
    let avgWorkedMinutes: Double?
    let attendanceRate: ReportRatio?
    let lateRate: ReportRatio?
    let reflectionRate: ReportRatio?
    let xpScore: Double?
    let xpPenalty: Double?

    private enum CodingKeys: String, CodingKey {
        case assigned, completed, onTime, overdue, medianCycleDays, present, late, lateMinutes, earlyLeave,
             absent, leave, sick, permit, dayOff, avgWorkedMinutes, attendanceRate, lateRate, reflectionRate,
             xpScore, xpPenalty
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assigned = c.reportSoft(.assigned)
        completed = c.reportSoft(.completed)
        onTime = c.reportSoft(.onTime)
        overdue = c.reportSoft(.overdue)
        medianCycleDays = c.reportSoft(.medianCycleDays)
        present = c.reportSoft(.present)
        late = c.reportSoft(.late)
        lateMinutes = c.reportSoft(.lateMinutes)
        earlyLeave = c.reportSoft(.earlyLeave)
        absent = c.reportSoft(.absent)
        leave = c.reportSoft(.leave)
        sick = c.reportSoft(.sick)
        permit = c.reportSoft(.permit)
        dayOff = c.reportSoft(.dayOff)
        avgWorkedMinutes = c.reportSoft(.avgWorkedMinutes)
        attendanceRate = c.reportSoft(.attendanceRate)
        lateRate = c.reportSoft(.lateRate)
        reflectionRate = c.reportSoft(.reflectionRate)
        xpScore = c.reportSoft(.xpScore)
        xpPenalty = c.reportSoft(.xpPenalty)
    }
}

struct ReportTeamRef: Decodable, Sendable, Identifiable {
    let id: String
    let name: String
}

struct ReportOverdueTask: Decodable, Sendable, Identifiable {
    let id: String
    let title: String?
    let projectId: String?
    let projectName: String?
    let dueDate: String?
    let dueKey: String?
    let daysOverdue: Double?
    let priority: String?
    let assigneeCount: Double?
    /// This person's share of the task (1 / assigneeCount).
    let share: Double?

    /// A task in a project the viewer isn't a member of (servers from 13 Oct 2026): counted, but sent with
    /// no id or title, under projectId "other". Drawn without a link.
    var isHiddenProject: Bool { projectId == "other" || id.isEmpty }

    private enum CodingKeys: String, CodingKey {
        case id, title, projectId, projectName, dueDate, dueKey, daysOverdue, priority, assigneeCount, share
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The id is what a tap opens, so a row without one is dropped (by the lossy list around
        // it) rather than drawn as a row that goes nowhere.
        id = try c.decode(String.self, forKey: .id)
        title = c.reportSoft(.title)
        projectId = c.reportSoft(.projectId)
        projectName = c.reportSoft(.projectName)
        dueDate = c.reportSoft(.dueDate)
        dueKey = c.reportSoft(.dueKey)
        daysOverdue = c.reportSoft(.daysOverdue)
        priority = c.reportSoft(.priority)
        assigneeCount = c.reportSoft(.assigneeCount)
        share = c.reportSoft(.share)
    }
}

struct ReportWeek: Decodable, Sendable {
    let from: String?
    let to: String?
    let completed: Double
    let onTime: Double

    private enum CodingKeys: String, CodingKey { case from, to, completed, onTime }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = c.reportSoft(.from)
        to = c.reportSoft(.to)
        completed = c.reportSoft(.completed) ?? 0
        onTime = c.reportSoft(.onTime) ?? 0
    }
}

struct ReportProjectLine: Decodable, Sendable, Identifiable {
    let projectId: String?
    let projectName: String?
    let completed: Double
    let open: Double
    let overdue: Double
    var id: String { projectId ?? projectName ?? "?" }
    /// The projects the viewer can't open, counted together (servers from 13 Oct 2026).
    var isOtherProjects: Bool { projectId == "other" }

    private enum CodingKeys: String, CodingKey { case projectId, projectName, completed, open, overdue }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectId = c.reportSoft(.projectId)
        projectName = c.reportSoft(.projectName)
        completed = c.reportSoft(.completed) ?? 0
        open = c.reportSoft(.open) ?? 0
        overdue = c.reportSoft(.overdue) ?? 0
    }
}

struct ReportOpenByPriority: Decodable, Sendable {
    let urgent: Double
    let high: Double
    let medium: Double
    let low: Double
    let none: Double

    private enum CodingKeys: String, CodingKey {
        case urgent = "URGENT", high = "HIGH", medium = "MEDIUM", low = "LOW", none = "NONE"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        urgent = c.reportSoft(.urgent) ?? 0
        high = c.reportSoft(.high) ?? 0
        medium = c.reportSoft(.medium) ?? 0
        low = c.reportSoft(.low) ?? 0
        none = c.reportSoft(.none) ?? 0
    }
}

struct PersonWork: Decodable, Sendable {
    let assigned: Double?
    let completed: Double?
    let onTime: ReportRatio?
    let dueWithDate: Double?
    let overdueNow: Double?
    let overdueList: [ReportOverdueTask]
    let openTotal: Double?
    let openByPriority: ReportOpenByPriority?
    let dueNext7: Double?
    let medianCycleDays: Double?
    let cycleSample: Double?
    let weekly: [ReportWeek]
    let perProject: [ReportProjectLine]
    /// The WIB day ("yyyy-MM-dd") the open / overdue figures describe: today for the running period, the
    /// period's last day for a past one (servers from 13 Oct 2026; QA B02). nil from an older server.
    let asOf: String?

    /// A past period's day, when the open / overdue cards describe its end rather than today.
    var pastAsOf: String? {
        guard let asOf, !asOf.isEmpty else { return nil }
        let today = AgendaRange.dayKey(ISO8601DateFormatter().string(from: Date()))
        return asOf < today ? asOf : nil
    }

    private enum CodingKeys: String, CodingKey {
        case assigned, completed, onTime, dueWithDate, overdueNow, overdueList, openTotal, openByPriority,
             dueNext7, medianCycleDays, cycleSample, weekly, perProject, asOf
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assigned = c.reportSoft(.assigned)
        completed = c.reportSoft(.completed)
        onTime = c.reportSoft(.onTime)
        dueWithDate = c.reportSoft(.dueWithDate)
        overdueNow = c.reportSoft(.overdueNow)
        overdueList = c.reportList(.overdueList)
        openTotal = c.reportSoft(.openTotal)
        openByPriority = c.reportSoft(.openByPriority)
        dueNext7 = c.reportSoft(.dueNext7)
        medianCycleDays = c.reportSoft(.medianCycleDays)
        cycleSample = c.reportSoft(.cycleSample)
        weekly = c.reportList(.weekly)
        perProject = c.reportList(.perProject)
        asOf = c.reportSoft(.asOf)
    }
}

struct PersonAttendance: Decodable, Sendable {
    let present: Double?
    let late: Double?
    let lateMinutes: Double?
    let earlyLeave: Double?
    let absent: Double?
    let leave: Double?
    let sick: Double?
    let permit: Double?
    let dayOff: Double?
    let avgWorkedMinutes: Double?
    let workedDays: Double?
    let reflections: Double?
    let checkouts: Double?
    let attendanceRate: ReportRatio?
    let lateRate: ReportRatio?
    let reflectionRate: ReportRatio?

    private enum CodingKeys: String, CodingKey {
        case present, late, lateMinutes, earlyLeave, absent, leave, sick, permit, dayOff, avgWorkedMinutes,
             workedDays, reflections, checkouts, attendanceRate, lateRate, reflectionRate
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        present = c.reportSoft(.present)
        late = c.reportSoft(.late)
        lateMinutes = c.reportSoft(.lateMinutes)
        earlyLeave = c.reportSoft(.earlyLeave)
        absent = c.reportSoft(.absent)
        leave = c.reportSoft(.leave)
        sick = c.reportSoft(.sick)
        permit = c.reportSoft(.permit)
        dayOff = c.reportSoft(.dayOff)
        avgWorkedMinutes = c.reportSoft(.avgWorkedMinutes)
        workedDays = c.reportSoft(.workedDays)
        reflections = c.reportSoft(.reflections)
        checkouts = c.reportSoft(.checkouts)
        attendanceRate = c.reportSoft(.attendanceRate)
        lateRate = c.reportSoft(.lateRate)
        reflectionRate = c.reportSoft(.reflectionRate)
    }
}

struct PersonXp: Decodable, Sendable {
    struct Level: Decodable, Sendable {
        let level: Int?
        let name: String?
        let floor: Double?
        let nextFloor: Double?
        /// 0–100 (src/lib/gamification.ts rounds it to a whole percent).
        let pct: Double?
        let isMax: Bool?

        private enum CodingKeys: String, CodingKey { case level, name, floor, nextFloor, pct, isMax }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // A float level ("3.0") must not cost the whole card, so fall back through Double.
            level = c.reportSoft(.level) ?? (c.reportSoft(.level) as Double?).map { Int($0) }
            name = c.reportSoft(.name)
            floor = c.reportSoft(.floor)
            nextFloor = c.reportSoft(.nextFloor)
            pct = c.reportSoft(.pct)
            isMax = c.reportSoft(.isMax)
        }
    }
    struct Streak: Decodable, Sendable {
        let current: Double?
        let longest: Double?
    }
    struct Penalty: Decodable, Sendable, Identifiable {
        /// late | nocheckout | alpha | peer | penalty | admin | other — kept a String so a kind the
        /// server adds later still shows (under its raw name) instead of failing the row.
        let kind: String
        let count: Double
        let xp: Double
        var id: String { kind }

        private enum CodingKeys: String, CodingKey { case kind, count, xp }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = c.reportSoft(.kind) ?? "other"
            count = c.reportSoft(.count) ?? 0
            xp = c.reportSoft(.xp) ?? 0
        }
    }

    let periodScore: Double?
    let baseline: Double?
    let level: Level?
    let streak: Streak?
    let penalties: [Penalty]
    let penaltyTotal: Double?

    private enum CodingKeys: String, CodingKey { case periodScore, baseline, level, streak, penalties, penaltyTotal }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        periodScore = c.reportSoft(.periodScore)
        baseline = c.reportSoft(.baseline)
        level = c.reportSoft(.level)
        streak = c.reportSoft(.streak)
        penalties = c.reportList(.penalties)
        penaltyTotal = c.reportSoft(.penaltyTotal)
    }
}

/// What the caller may see. Learned from the server, never inferred from the role on this device:
/// the server is the one that enforces it.
enum ReportScope: String, Sendable {
    case all = "ALL"
    case directReports = "DIRECT_REPORTS"
    case selfOnly = "SELF"
}

/// GET /api/reports/people/[userId|me]
struct PersonReport: Decodable, Sendable {
    struct Person: Decodable, Sendable {
        let id: String?
        let name: String?
        let email: String?
        let avatar: String?
        let role: String?
        let approverId: String?
        let teams: [ReportTeamRef]
        let isSelf: Bool?
        /// "YYYY-MM-DD": the last working day of someone who left the company (offboarding, 8 Oct
        /// 2026). Their report still opens for the periods they were part of. nil for everyone else.
        let leftAt: String?

        private enum CodingKeys: String, CodingKey { case id, name, email, avatar, role, approverId, teams, isSelf, leftAt }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = c.reportSoft(.id)
            name = c.reportSoft(.name)
            email = c.reportSoft(.email)
            avatar = c.reportSoft(.avatar)
            role = c.reportSoft(.role)
            approverId = c.reportSoft(.approverId)
            teams = c.reportList(.teams)
            isSelf = c.reportSoft(.isSelf)
            leftAt = c.reportSoft(.leftAt)
        }
        var displayName: String { name ?? email ?? "—" }
    }

    let person: Person?
    /// Raw so an unknown value still decodes; read through `scope`.
    let viewerScope: String?
    let period: ReportPeriod?
    let previousPeriod: ReportPeriod?
    let headline: ReportHeadline?
    let previous: ReportHeadline?
    let work: PersonWork?
    let attendance: PersonAttendance?
    let xp: PersonXp?
    let generatedAt: String?

    private enum CodingKeys: String, CodingKey {
        case person, viewerScope, period, previousPeriod, headline, previous, work, attendance, xp, generatedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        person = c.reportSoft(.person)
        viewerScope = c.reportSoft(.viewerScope)
        period = c.reportSoft(.period)
        previousPeriod = c.reportSoft(.previousPeriod)
        headline = c.reportSoft(.headline)
        previous = c.reportSoft(.previous)
        work = c.reportSoft(.work)
        attendance = c.reportSoft(.attendance)
        xp = c.reportSoft(.xp)
        generatedAt = c.reportSoft(.generatedAt)
    }

    /// An unrecognised or missing scope is read as SELF: showing less than allowed is recoverable,
    /// offering a team tab the server will refuse is just a broken button.
    var scope: ReportScope { viewerScope.flatMap(ReportScope.init(rawValue:)) ?? .selfOnly }

    /// `period` is the "YYYY-MM" key, or nil for "the current period" (no query parameter at all).
    static func cacheKey(userId: String, period: String?) -> String {
        "report-person-\(userId)-\(period ?? "current")"
    }
}

/// GET /api/reports/people
struct ReportRoster: Decodable, Sendable {
    struct Flags: Decodable, Sendable {
        let overdue3: Bool
        let late3: Bool
        let lowReflections: Bool

        private enum CodingKeys: String, CodingKey { case overdue3, late3, lowReflections }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            overdue3 = c.reportSoft(.overdue3) ?? false
            late3 = c.reportSoft(.late3) ?? false
            lowReflections = c.reportSoft(.lowReflections) ?? false
        }
    }

    struct Row: Decodable, Sendable, Identifiable {
        let userId: String
        let name: String?
        let email: String?
        let avatar: String?
        let role: String?
        let approverId: String?
        let teams: [ReportTeamRef]
        let headline: ReportHeadline?
        let previous: ReportHeadline?
        let flags: Flags?
        let flagCount: Double?
        /// "YYYY-MM-DD": someone who left the company, on the roster for the periods they were part of.
        let leftAt: String?
        var id: String { userId }

        private enum CodingKeys: String, CodingKey {
            case userId, name, email, avatar, role, approverId, teams, headline, previous, flags, flagCount, leftAt
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // Tapping a row opens this person's report, so a row without an id is dropped.
            userId = try c.decode(String.self, forKey: .userId)
            name = c.reportSoft(.name)
            email = c.reportSoft(.email)
            avatar = c.reportSoft(.avatar)
            role = c.reportSoft(.role)
            approverId = c.reportSoft(.approverId)
            teams = c.reportList(.teams)
            headline = c.reportSoft(.headline)
            previous = c.reportSoft(.previous)
            flags = c.reportSoft(.flags)
            flagCount = c.reportSoft(.flagCount)
            leftAt = c.reportSoft(.leftAt)
        }
        var displayName: String { name ?? email ?? "—" }
    }

    let scope: String?
    let period: ReportPeriod?
    let previousPeriod: ReportPeriod?
    let team: ReportTeamRef?
    let rows: [Row]
    let generatedAt: String?

    private enum CodingKeys: String, CodingKey { case scope, period, previousPeriod, team, rows, generatedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        scope = c.reportSoft(.scope)
        period = c.reportSoft(.period)
        previousPeriod = c.reportSoft(.previousPeriod)
        team = c.reportSoft(.team)
        rows = c.reportList(.rows)
        generatedAt = c.reportSoft(.generatedAt)
    }

    static func cacheKey(period: String?, teamId: String?) -> String {
        "report-roster-\(period ?? "current")-\(teamId ?? "all")"
    }
}

/// The two refusals the reports API names with a `code`, told apart from every other 403 because
/// the screen does something different for each: SELF_ONLY quietly hides the team tab (a staff
/// member asking for a roster), OUT_OF_SCOPE is shown as the server's sentence.
enum ReportAccessError: LocalizedError, Equatable {
    case selfOnly(String?)
    case outOfScope(String?)

    /// Nil unless `body` is one of the two coded refusals.
    init?(body: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let code = obj["code"] as? String else { return nil }
        let message = (obj["error"] as? String) ?? (obj["message"] as? String)
        switch code {
        case "REPORT_SELF_ONLY": self = .selfOnly(message)
        case "REPORT_OUT_OF_SCOPE": self = .outOfScope(message)
        default: return nil
        }
    }

    var errorDescription: String? {
        switch self {
        case .selfOnly(let m), .outOfScope(let m): return m
        }
    }
}

// MARK: - Soft decoding

/// Decodes one element and swallows its failure, so a single bad row does not fail its array.
private struct ReportLossyElement<Wrapped: Decodable>: Decodable {
    let value: Wrapped?
    init(from decoder: Decoder) throws { value = try? Wrapped(from: decoder) }
}

// fileprivate so these helpers cannot collide with anything of the same name elsewhere in the app.
fileprivate extension KeyedDecodingContainer {
    /// Missing, null, or the wrong type all come back as nil instead of throwing.
    func reportSoft<Value: Decodable>(_ key: Key) -> Value? {
        (try? decodeIfPresent(Value.self, forKey: key)) ?? nil
    }

    /// An array whose unreadable elements are dropped, and which is empty when absent.
    func reportList<Element: Decodable>(_ key: Key) -> [Element] {
        let wrapped = (try? decodeIfPresent([ReportLossyElement<Element>].self, forKey: key)) ?? nil
        return (wrapped ?? []).compactMap(\.value)
    }
}
