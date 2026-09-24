import Foundation

struct ProfileResponse: Decodable, Sendable {
    let user: AppUser
}

struct Gamification: Decodable, Sendable {
    let xp: Xp
    let streak: Streak?
    let quests: [Quest]?

    struct Xp: Decodable, Sendable {
        let totalXp: Int
        let level: Int
        let levelName: String?
        let nextFloor: Int?
    }
    struct Streak: Decodable, Sendable { let current: Int? }
    struct Quest: Decodable, Sendable, Identifiable {
        let key: String
        let title: String
        let progress: Int
        let target: Int
        let xpReward: Int
        let claimed: Bool?
        /// Computed by /api/gamification/me, and the web shows Claim on exactly this flag. Taken
        /// as-is rather than rebuilt from progress >= target here: for a task-bundle quest the
        /// server also requires the viewer to be one of the assignees, which this client cannot see.
        let claimable: Bool?
        var id: String { key }
    }

    var streakCurrent: Int { streak?.current ?? 0 }
    var questList: [Quest] { quests ?? [] }
    var questsDone: Int { questList.filter { $0.claimed == true }.count }
    /// Progress toward the next level floor (0…1).
    var levelPct: Double {
        guard let next = xp.nextFloor, next > 0 else { return 1 }
        return min(1, max(0, Double(xp.totalXp) / Double(next)))
    }
}

/// A task assigned to me (GET /api/tasks?assigneeId=) — feeds the Mission stat + the My-Tasks screen.
struct MyTask: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let status: String?
    let priority: String?
    let dueDate: String?
    let taskList: TaskListRef?
    let count: CountRef?

    struct TaskListRef: Decodable, Sendable { let name: String? }
    struct CountRef: Decodable, Sendable { let comments: Int? }

    enum CodingKeys: String, CodingKey {
        case id, title, status, priority, dueDate, taskList
        case count = "_count"
    }

    var isDone: Bool { (status ?? "").uppercased() == "DONE" }
    var laneName: String { taskList?.name ?? "NEXUS board" }
    var commentCount: Int { count?.comments ?? 0 }
}

struct UnreadResponse: Decodable, Sendable {
    let unreadCount: Int?
}

struct SuccessResponse: Decodable, Sendable {
    let success: Bool?
}

/// POST /api/gamification/quests/claim answers with the claimer's XP right after the award.
struct QuestClaimResponse: Decodable, Sendable {
    let xp: Gamification.Xp?
}

/// GET /api/workspaces/members — caller's workspace id (for creating projects) + caller's org role.
struct WorkspaceInfo: Decodable, Sendable {
    let workspaceId: String
    let role: String?
}

/// GET /api/gamification/leaderboard.
struct LeaderboardRow: Decodable, Identifiable, Sendable {
    let userId: String
    let name: String?
    let avatar: String?
    let totalXp: Int
    let level: Int
    let levelName: String?
    let atBottom: Bool?
    var id: String { userId }
    var initial: String { String((name ?? "?").first ?? "?").uppercased() }
}
struct LeaderboardResponse: Decodable, Sendable { let rows: [LeaderboardRow]? }

/// One movement in somebody's XP ledger (GET /api/gamification/xp-log?userId=).
///
/// `reason` is a machine key the server writes for idempotency ("attendance:late:2026-09-01"),
/// never a sentence, so the label is built here. An unrecognised key is shown raw rather than
/// dropped: a score that moved for a reason this app has not been taught is still a fact, and
/// hiding it would make the total stop adding up.
struct XpLogEntry: Decodable, Identifiable, Sendable {
    let id: String
    let amount: Int
    let reason: String
    let createdAt: String?
    /// A late penalty's real minutes. The ledger amount is capped at 120 of them, so for anyone
    /// who arrived later than that the two numbers deliberately disagree.
    let lateMinutes: Int?

    private var parts: [String] {
        reason.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    }

    var label: String {
        let p = parts
        switch (p.first ?? "", p.count > 1 ? p[1] : "") {
        case ("attendance", "late"):
            guard let mins = lateMinutes, mins > 0 else { return T("Late") }
            return "\(T("Late")) · \(mins) \(T("min"))"
        case ("attendance", "alpha"):      return T("Absent")
        case ("attendance", "nocheckout"): return T("No check-out")
        case ("peer", "report"):
            return reason.hasSuffix(":bounty") ? T("Peer report · reward") : T("Peer report · penalty")
        case ("admin", "adjust"):
            let note = p.count > 2 ? p[2] : ""
            return note.isEmpty ? T("Adjusted by a BoD") : "\(T("Adjusted by a BoD")) · \(note)"
        case ("quest", _):                 return T("Quest claimed")
        default:                           return reason
        }
    }

    var signedAmount: String { amount > 0 ? "+\(amount)" : "\(amount)" }
    var dayLabel: String { createdAt.map { AgendaRange.dayLabel(AgendaRange.dayKey($0)) } ?? "" }
}

struct XpLogResponse: Decodable, Sendable {
    let rows: [XpLogEntry]?
    /// The person the log belongs to, as the SERVER resolved them — the one identity on the
    /// profile screen that does not come from the row that opened it.
    let user: AppUser?
}

/// Inbox notification (GET /api/notifications).
struct NexusNotification: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let message: String?
    let type: String?
    /// `var` so a row just opened can be struck off where it stands. Refetching the whole dashboard
    /// to grey out one dot is a lot of network for a value we already know.
    var read: Bool?
    let createdAt: String?
    let taskId: String?
    let projectId: String?
    /// The path the server itself chose for this signal ("/attendance", "/tasks/<id>").
    let link: String?

    var isRead: Bool { read == true }
    var typeLabel: String {
        let t = (type ?? "signal").replacingOccurrences(of: "_", with: " ")
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    /// Which filter bucket this signal belongs to.
    ///
    /// Ported verbatim from the web's `notificationGroup` (lib/nexus-api.ts), tests in the same
    /// order: the buckets overlap (`attendance_task_reminder` matches both "attendance" and "task"),
    /// so the order IS the rule, and the two clients drifting on it would put the same notification
    /// under different tabs.
    var group: NotificationGroup {
        let t = (type ?? "").lowercased()
        if t.hasPrefix("attendance") || t.hasPrefix("offsite") || t == "dayoff_quota_low" || t == "red_date_quota_low" { return .attendance }
        if t == "submission_status" { return .submissions }
        if t.hasPrefix("complaint") { return .tickets }
        if t.contains("announcement") { return .announcements }
        if t.hasPrefix("message") || t == "feed_comment" { return .messages }
        if t.hasPrefix("task") || t.hasPrefix("comment") || t.hasPrefix("quest")
            || t == "project_invite" || t == "status_update" || t == "streak_at_risk" { return .tasks }
        return .other
    }

    /// Where tapping this notification should land, or nil for the rows that lead nowhere.
    ///
    /// Ported from the web inbox's `notificationTarget` (routes/_app/inbox.tsx), in ITS order: the
    /// id fields, then the type keywords, then the raw link. The web's own doc comment says "link
    /// field first" and its code checks the link last — the code is what people have been using, so
    /// the code is what is mirrored.
    var tapTarget: NotificationTarget? {
        if let taskId, !taskId.isEmpty { return .task(taskId) }
        if let projectId, !projectId.isEmpty { return .project(projectId) }
        // The link before the type keywords, since 0.1.5 on both clients: the server now puts the
        // record's id in it (`/attendance?request=…`, `/complaints?id=…`, `/messages?c=…`), and
        // matching the type first threw that id away — every attendance signal landed on the top of
        // the Attendance screen instead of on the request it was about.
        if let link, link.hasPrefix("/"), let target = NotificationTarget(path: link) { return target }
        let t = (type ?? "").lowercased()
        let attendanceWords = ["checkout", "offsite", "attendance", "late", "absen"]
        if attendanceWords.contains(where: { t.contains($0) }) { return .screen(.attendance) }
        if t.contains("message") { return .screen(.messages) }
        return nil
    }
}

/// The buckets the notification filter offers.
///
/// There are ~30 distinct `type` strings in the wild and nobody reading their inbox thinks in them:
/// `attendance_request_reviewed`, `offsite_checkout_pending` and `attendance_override` are all just
/// "Attendance" to a human. `other` is what keeps a type nobody has heard of yet visible instead of
/// filtered into nothing.
enum NotificationGroup: String, CaseIterable, Identifiable, Hashable, Sendable {
    case all, tasks, attendance, messages, submissions, tickets, announcements, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all:           return T("All")
        case .tasks:         return T("Tasks")
        case .attendance:    return T("Attendance")
        case .messages:      return T("Messages")
        case .submissions:   return T("Submissions")
        case .tickets:       return T("Tickets")
        case .announcements: return T("Announcements")
        case .other:         return T("Other")
        }
    }
}

/// One drawn chip: a bucket and how many of the list are in it.
struct NotificationFilterTab: Identifiable, Hashable, Sendable {
    let group: NotificationGroup
    let count: Int
    var id: NotificationGroup { group }
}

/// The chips worth drawing for THIS list: "All", plus only the buckets that actually have something
/// in them. No dead tabs — same rule as the web's `notificationFilterTabs`.
///
/// Computed once per list change by the callers rather than inside a body: with 50 notifications
/// this walks the whole list, and a filter bar is on the scroll path of both surfaces.
func notificationFilterTabs(_ list: [NexusNotification]) -> [NotificationFilterTab] {
    var counts: [NotificationGroup: Int] = [:]
    for n in list { counts[n.group, default: 0] += 1 }
    return NotificationGroup.allCases.compactMap { g in
        if g == .all { return NotificationFilterTab(group: .all, count: list.count) }
        guard let c = counts[g], c > 0 else { return nil }
        return NotificationFilterTab(group: g, count: c)
    }
}

/// One place a notification can send somebody. `.screen` covers the destinations that are whole
/// screens in both shapes of the app; the others carry the id of a single record, which no
/// eighteen-case screen enum has room for.
enum NotificationTarget: Hashable {
    case task(String)
    case project(String)
    case submission(String)
    case screen(NXScreen)
    /// One leave / permit / sick / day-off request — `/attendance?request=<id>`. Lands on the
    /// request itself, Approve and Reject in front of the reviewer.
    case attendanceRequest(String)
    /// One offsite check-out awaiting review — `/attendance?offsite=<record id>`.
    case offsiteCheckout(String)
    /// One ticket thread — `/complaints?id=<id>`.
    case complaint(String)
    /// One chat — `/messages?c=<id>`, or `/messages/<id>` as rows written before 0.1.5 carry it.
    case conversation(String)
    /// One announcement — `/dashboard?announcement=<id>`. Shown even if it was dismissed before.
    case announcement(String)
    /// One Threads post — `/threads?post=<id>`: a mention, or a comment on something you posted.
    case post(String)

    /// The screen that owns the record, for the router to walk to before the screen claims it.
    var hostScreen: NXScreen? {
        switch self {
        case .screen(let s):                     return s
        case .attendanceRequest, .offsiteCheckout: return .attendance
        case .complaint:                         return .tickets
        case .conversation:                      return .messages
        case .announcement:                      return .dashboard
        case .post:                              return .threads
        case .submission:                        return .submissions
        case .task, .project:                    return nil
        }
    }

    /// Reads a web path ("/tasks/abc123") as an app destination.
    ///
    /// The web has routes this app has no screen for — one doc, one folder, the social feed — so
    /// those land on the nearest screen that does exist. A path nothing here can answer returns
    /// nil, and the row stays untappable rather than opening something unrelated.
    init?(path: String) {
        let parts = path.prefix { $0 != "?" && $0 != "#" }.split(separator: "/").map { String($0) }
        guard let head = parts.first?.lowercased() else { self = .screen(.dashboard); return }
        let rest: String? = parts.count > 1 ? parts[1] : nil
        switch head {
        case "tasks":
            if let rest { self = .task(rest) } else { self = .screen(.tasks) }
        case "projects":
            // "/projects/<id>/tasks/<id>" is a real link the server sends. The web opens the TASK
            // there, so the deeper id wins over the board that holds it.
            if parts.count > 3, parts[2].lowercased() == "tasks" { self = .task(parts[3]) }
            else if let rest { self = .project(rest) }
            else { self = .screen(.projects) }
        case "my-tasks":                self = .screen(.tasks)
        case "attendance":
            if let id = Self.queryValue("request", in: path) { self = .attendanceRequest(id) }
            else if let id = Self.queryValue("offsite", in: path) { self = .offsiteCheckout(id) }
            else { self = .screen(.attendance) }
        case "messages":
            if let rest, !rest.isEmpty { self = .conversation(rest) }
            else if let id = Self.queryValue("c", in: path) { self = .conversation(id) }
            else { self = .screen(.messages) }
        case "inbox":                   self = .screen(.inbox)
        case "threads", "social":
            if let id = Self.queryValue("post", in: path) { self = .post(id) } else { self = .screen(.threads) }
        // There is no single-document screen on mobile; the library is as close as it gets.
        case "docs", "folders":         self = .screen(.docs)
        case "forms":                   self = .screen(.forms)
        // A /vault link opens the shelf. A /v/<slug> link does NOT come through here — that is
        // a universal link with a capability in it, and AppRouter resolves it against the server.
        case "vault":                   self = .screen(.vault)
        case "teams":                   self = .screen(.teams)
        case "reports", "peer-reports": self = .screen(.reports)
        case "leaderboard":             self = .screen(.leaderboard)
        // `/submissions?id=<id>` is the link a submission_status signal now carries, and the id in
        // it is the entire point of the notification: "your reimbursement moved" has to open THAT
        // reimbursement. Without the id it is still just the board.
        case "submissions":
            if let id = Self.queryValue("id", in: path) { self = .submission(id) } else { self = .screen(.submissions) }
        case "room-booking":            self = .screen(.roomBooking)
        case "master-calendar":         self = .screen(.teamCalendar)
        case "complaints":
            if let id = Self.queryValue("id", in: path) { self = .complaint(id) } else { self = .screen(.tickets) }
        case "settings":                self = .screen(.settings)
        case "admin":                   self = .screen(.admin)
        case "dashboard":
            if let id = Self.queryValue("announcement", in: path) { self = .announcement(id) } else { self = .screen(.dashboard) }
        default:                        return nil
        }
    }

    /// One value out of a link's query string.
    ///
    /// The path parsing above deliberately stops at "?", which was right while no link the server
    /// sent had a query on it. One does now, so the part that used to be thrown away is read here
    /// rather than by loosening the path split.
    private static func queryValue(_ key: String, in path: String) -> String? {
        guard let mark = path.firstIndex(of: "?") else { return nil }
        let query = path[path.index(after: mark)...].prefix { $0 != "#" }
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2, String(kv[0]) == key else { continue }
            // "+" for a space is form encoding, which percent-decoding alone leaves behind.
            let raw = String(kv[1]).replacingOccurrences(of: "+", with: " ")
            let value = raw.removingPercentEncoding ?? raw
            return value.isEmpty ? nil : value
        }
        return nil
    }
}

struct NotificationsResponse: Decodable, Sendable {
    let notifications: [NexusNotification]?
    let unreadCount: Int?
}
