import Foundation

// Models for Control Room → Audit. Foundation-only on purpose, so a probe can decode real server
// replies against exactly these declarations without dragging SwiftUI along.

/// GET /api/audit?limit=&offset=&action=&search= — one page, newest first.
///
/// `total`, `limit` and `offset` have always been in this reply; the old screen read none of them and
/// so could only ever show the first 50 rows. They are what the infinite scroll pages on.
struct AuditLogsResponse: Decodable, Sendable {
    let logs: [AuditLog]?
    let total: Int?
    let limit: Int?
    let offset: Int?
}

struct AuditLog: Decodable, Identifiable, Sendable, Hashable {
    let id: String
    let action: String?
    let entityType: String?
    let entityId: String?
    let entityName: String?
    let createdAt: String?
    let user: UserRef?
    /// One English sentence the server writes for the row ("Rina moved 'Fix login' to Done").
    /// Optional because a server that predates it sends nothing, and the row then falls back to
    /// the entity name the old list showed.
    let summary: String?
    /// On an entry whose delete kept a copy: projects and tasks since 8 Oct 2026, every kind of delete
    /// since later that day — whatever the action says (an extra day off is taken back with "revoke").
    /// Absent = can't be restored.
    let restore: AuditRestoreInfo?

    struct UserRef: Decodable, Sendable, Hashable {
        let id: String?
        let name: String?
        let email: String?
        let avatar: String?
    }

    /// Hashed by id. Equal only when it is the same entry saying the same thing: SwiftUI can compare
    /// a row's inputs with `==` to decide whether to draw it again, and with an id-only `==` a row that
    /// came back from the server as "Restored" could go on reading "Restorable" (owner, 8 Oct 2026).
    /// Equal values still hash alike, since equal implies the same id.
    static func == (a: AuditLog, b: AuditLog) -> Bool {
        a.id == b.id && a.restore == b.restore && a.summary == b.summary && a.entityName == b.entityName
    }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// This row once its delete has been restored, for the list to show before the server's next
    /// page says the same. Unchanged when the row offers no restore, or no longer does.
    func markedRestored(at date: Date = Date()) -> AuditLog {
        guard let r = restore, r.available else { return self }
        return AuditLog(id: id, action: action, entityType: entityType, entityId: entityId, entityName: entityName,
                        createdAt: createdAt, user: user, summary: summary,
                        restore: AuditRestoreInfo(available: false, restoredAt: ISO8601DateFormatter().string(from: date),
                                                  dataAsOf: r.dataAsOf, fromBackup: r.fromBackup, soft: r.soft,
                                                  entityLabel: r.entityLabel, counts: r.counts, open: r.open))
    }
}

/// How a quiet refresh of Control Room → Audit folds a fresh read of the head of the log into the rows
/// on screen (owner, 8 Oct 2026). Here rather than in the view so it can be run and checked on its own.
enum AuditMerge {
    struct Outcome: Equatable {
        let logs: [AuditLog]
        /// Newer entries were left out because the reader is scrolled down.
        let newerWaiting: Bool
        /// The fresh read replaced the list instead of merging into it (the pages below it are gone).
        let replaced: Bool
    }

    /// - shown: the rows on screen, newest first.
    /// - fresh: the head of the log as the server has it now, newest first.
    /// - window: how many rows were asked for (`fresh` is shorter only at the end of the log).
    /// - atTop: the top of the list is in view, so rows may go in above what is shown.
    ///
    /// Rows on screen are updated in place by id. Newer rows go in on top only while `atTop`;
    /// otherwise they wait and `newerWaiting` says so. Rows below the window are kept. A fresh read
    /// with nothing in common with what is shown on a full window means more arrived than one read
    /// holds: on top it replaces the list (merging would leave a hole), scrolled down it waits.
    static func merge(shown: [AuditLog], fresh: [AuditLog], window: Int, atTop: Bool) -> Outcome {
        if shown.isEmpty { return Outcome(logs: fresh, newerWaiting: false, replaced: true) }
        let shownIds = Set(shown.map(\.id))
        let newer = fresh.filter { !shownIds.contains($0.id) }
        let gap = !newer.isEmpty && newer.count == fresh.count && fresh.count >= window
        if atTop {
            if gap { return Outcome(logs: fresh, newerWaiting: false, replaced: true) }
            let freshIds = Set(fresh.map(\.id))
            return Outcome(logs: fresh + shown.filter { !freshIds.contains($0.id) }, newerWaiting: false, replaced: false)
        }
        let byId = Dictionary(fresh.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return Outcome(logs: shown.map { byId[$0.id] ?? $0 }, newerWaiting: !newer.isEmpty, replaced: false)
    }
}

/// GET /api/audit/{id} — one entry, with the server's reading of it: a title, the field-by-field
/// diff, and labelled facts, some of which point at another record.
struct AuditEntryDetail: Decodable, Sendable {
    let entry: Entry
    let title: String?
    let changes: [Change]
    let details: [Detail]
    /// A delete that kept a copy: what comes back and whether it already did. Absent on older servers.
    let restore: AuditRestoreDetail?
    /// Whether the viewer may restore this entry: BoD and One Above All only (owner, 16 Oct 2026). nil on an
    /// older server, where the button shows and the server answers.
    let canRestore: Bool?

    enum CodingKeys: String, CodingKey { case entry, title, changes, details, restore, canRestore }

    /// Lenient about the two lists: an entry with nothing to diff may arrive with them missing or
    /// null, and that must still open the sheet rather than fail it.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entry = try c.decode(Entry.self, forKey: .entry)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        changes = (try? c.decodeIfPresent([Change].self, forKey: .changes)) ?? []
        details = (try? c.decodeIfPresent([Detail].self, forKey: .details)) ?? []
        restore = try? c.decodeIfPresent(AuditRestoreDetail.self, forKey: .restore)
        canRestore = try? c.decodeIfPresent(Bool.self, forKey: .canRestore)
    }

    struct Entry: Decodable, Sendable {
        let id: String
        let action: String?
        let entityType: String?
        let entityId: String?
        let entityName: String?
        let createdAt: String?
        let ipAddress: String?
        let userAgent: String?
        let user: AuditLog.UserRef?
        /// `unknown` on the server: whatever the writer of the entry chose to store. Kept as a tree
        /// so the Technical section can print it back as JSON, untouched.
        let metadata: AuditJSON?
    }

    struct Change: Decodable, Sendable, Identifiable {
        let field: String
        let label: String
        let from: String?
        let to: String?
        var id: String { field }

        enum CodingKeys: String, CodingKey { case field, label, from, to }

        /// The contract says string-or-null, but these values come out of free-form metadata; a
        /// number or a boolean that slipped through is shown as text instead of failing the sheet.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            field = try c.decode(String.self, forKey: .field)
            label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? field
            from = Self.text(c, .from)
            to = Self.text(c, .to)
        }

        private static func text(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String? {
            guard let v = try? c.decodeIfPresent(AuditJSON.self, forKey: key) else { return nil }
            switch v {
            case .null: return nil
            case .string(let s): return s
            default: return v.pretty
            }
        }
    }

    struct Detail: Decodable, Sendable {
        let label: String
        let value: String
        let link: Link?

        struct Link: Decodable, Sendable {
            /// "task" | "project" | "user" | "attendance" | "form"
            let type: String
            let id: String
        }
    }
}

/// The `restore` of a row in GET /api/audit (owner, 8 Oct 2026: Restore in Control Room → Audit).
///
/// The first four are what the project-and-task restore sent. The rest came when every kind of delete
/// became restorable (same day) and are all optional: an older server sends none of them, and its rows
/// must then look exactly as they did.
struct AuditRestoreInfo: Decodable, Sendable, Hashable {
    let available: Bool
    let restoredAt: String?
    /// When the copy is from: the delete itself, or the nightly backup it was taken from.
    let dataAsOf: String?
    let fromBackup: Bool?
    /// The delete only flipped a flag (a post, a quest, a trashed Vault item): restoring flips it back.
    let soft: Bool?
    /// English noun for what was deleted ("comment", "sheet rows"), for a kind this app does not know.
    let entityLabel: String?
    /// What comes back. In the list only on newer servers; the entry's own read always has it.
    let counts: AuditRestoreCounts?
    /// Where "Open …" goes once it is back.
    let open: AuditRestoreOpenField

    enum CodingKeys: String, CodingKey {
        case available, restoredAt, dataAsOf, fromBackup, soft, entityLabel, counts, open
    }

    init(available: Bool, restoredAt: String?, dataAsOf: String?, fromBackup: Bool?, soft: Bool? = nil,
         entityLabel: String? = nil, counts: AuditRestoreCounts? = nil, open: AuditRestoreOpenField = .absent) {
        self.available = available; self.restoredAt = restoredAt; self.dataAsOf = dataAsOf
        self.fromBackup = fromBackup; self.soft = soft; self.entityLabel = entityLabel
        self.counts = counts; self.open = open
    }

    /// Lenient field by field: one odd value must not cost the whole page of the log.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = (try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? false
        restoredAt = try? c.decodeIfPresent(String.self, forKey: .restoredAt)
        dataAsOf = try? c.decodeIfPresent(String.self, forKey: .dataAsOf)
        fromBackup = try? c.decodeIfPresent(Bool.self, forKey: .fromBackup)
        soft = try? c.decodeIfPresent(Bool.self, forKey: .soft)
        entityLabel = try? c.decodeIfPresent(String.self, forKey: .entityLabel)
        counts = try? c.decodeIfPresent(AuditRestoreCounts.self, forKey: .counts)
        open = AuditRestoreOpenField.read(c, .open)
    }
}

/// The `restore` of GET /api/audit/{id}: the row's facts plus who restored it and what comes back.
struct AuditRestoreDetail: Decodable, Sendable {
    let available: Bool
    let restoredAt: String?
    let dataAsOf: String?
    let fromBackup: Bool?
    let soft: Bool?
    let entityLabel: String?
    let restoredBy: AuditLog.UserRef?
    let counts: AuditRestoreCounts
    let open: AuditRestoreOpenField

    enum CodingKeys: String, CodingKey {
        case available, restoredAt, dataAsOf, fromBackup, soft, entityLabel, restoredBy, counts, open
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = (try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? false
        restoredAt = try? c.decodeIfPresent(String.self, forKey: .restoredAt)
        dataAsOf = try? c.decodeIfPresent(String.self, forKey: .dataAsOf)
        fromBackup = try? c.decodeIfPresent(Bool.self, forKey: .fromBackup)
        soft = try? c.decodeIfPresent(Bool.self, forKey: .soft)
        entityLabel = try? c.decodeIfPresent(String.self, forKey: .entityLabel)
        restoredBy = try? c.decodeIfPresent(AuditLog.UserRef.self, forKey: .restoredBy)
        counts = (try? c.decodeIfPresent(AuditRestoreCounts.self, forKey: .counts)) ?? AuditRestoreCounts()
        open = AuditRestoreOpenField.read(c, .open)
    }
}

/// What a restore brings back (server: src/lib/deletion-entities.ts RestoreCounts). The first six are
/// what the project-and-task restore always sent and still mean exactly that; `items` is every row the
/// copy holds, the fallback "N items" for a kind this app does not know; the rest come only when not
/// zero. A count never includes the deleted thing itself (a task's `tasks` are its subtasks, a
/// comment's `comments` its replies), except `rows` and `cells`, which are the deleted rows and values.
struct AuditRestoreCounts: Decodable, Sendable, Hashable {
    var lists = 0, tasks = 0, files = 0, comments = 0, sheets = 0, members = 0, items = 0
    var rows = 0, cells = 0, submissions = 0, values = 0, receipts = 0, payments = 0, milestones = 0
    var pages = 0, people = 0, projects = 0, folders = 0, units = 0, points = 0
    /// A group chat's messages (9 Oct 2026); its `members` are the people in it.
    var messages = 0

    enum CodingKeys: String, CodingKey {
        case lists, tasks, files, comments, sheets, members, items
        case rows, cells, submissions, values, receipts, payments, milestones
        case pages, people, projects, folders, units, points, messages
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func n(_ k: CodingKeys) -> Int { (try? c.decodeIfPresent(Int.self, forKey: k)) ?? 0 }
        lists = n(.lists); tasks = n(.tasks); files = n(.files); comments = n(.comments)
        sheets = n(.sheets); members = n(.members); items = n(.items)
        rows = n(.rows); cells = n(.cells); submissions = n(.submissions); values = n(.values)
        receipts = n(.receipts); payments = n(.payments); milestones = n(.milestones)
        pages = n(.pages); people = n(.people); projects = n(.projects); folders = n(.folders)
        units = n(.units); points = n(.points); messages = n(.messages)
    }
}

/// `open` on a restore: where the thing lives once it is back. `projectId` when it lives inside a
/// project, `date` (YYYY-MM-DD) for the calendar.
struct AuditRestoreOpen: Decodable, Sendable, Hashable {
    let type: String
    let id: String
    let projectId: String?
    let date: String?

    enum CodingKeys: String, CodingKey { case type, id, projectId, date }

    init(type: String, id: String, projectId: String? = nil, date: String? = nil) {
        self.type = type; self.id = id; self.projectId = projectId; self.date = date
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func s(_ k: CodingKeys) -> String? {
            guard let v = try? c.decodeIfPresent(String.self, forKey: k), !v.isEmpty else { return nil }
            return v
        }
        type = s(.type) ?? ""
        id = s(.id) ?? ""
        projectId = s(.projectId)
        date = s(.date)
    }
}

/// `open` as the server sent it, with "said nothing" kept apart from "there is no page for it".
/// Older servers, and copies made before `open` existed (projects and tasks deleted earlier on
/// 8 Oct 2026), send no key at all: those still link to the project or task by the entry's own id.
enum AuditRestoreOpenField: Sendable, Hashable {
    /// No `open` key.
    case absent
    /// `open: null`, or something unreadable: no link.
    case none
    case target(AuditRestoreOpen)

    static func read<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> AuditRestoreOpenField {
        guard c.contains(key) else { return .absent }
        if (try? c.decodeNil(forKey: key)) == true { return .none }
        guard let o = try? c.decode(AuditRestoreOpen.self, forKey: key), !o.type.isEmpty else { return .none }
        return .target(o)
    }
}

/// POST /api/audit/{id}/restore — 200. Lenient: once the server has restored it, an answer this app
/// reads only part of must not be reported as a failed restore.
struct AuditRestoreResult: Decodable, Sendable {
    let entityType: String?
    let entityId: String?
    let entityLabel: String?
    let projectId: String?
    let open: AuditRestoreOpenField

    enum CodingKeys: String, CodingKey { case entityType, entityId, entityLabel, projectId, open }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func s(_ k: CodingKeys) -> String? {
            guard let v = try? c.decodeIfPresent(String.self, forKey: k), !v.isEmpty else { return nil }
            return v
        }
        entityType = s(.entityType)
        entityId = s(.entityId)
        entityLabel = s(.entityLabel)
        projectId = s(.projectId)
        open = AuditRestoreOpenField.read(c, .open)
    }
}

/// POST /api/audit/{id}/restore refused: 409 { code, entityType, parent } or 404 { code }.
/// `parent` (PARENT_MISSING only) is the noun of what has to come back first ("task", "section"…).
struct AuditRestoreRefusal: Decodable, Sendable {
    let code: String?
    let entityType: String?
    let parent: String?

    enum CodingKeys: String, CodingKey { case code, entityType, parent }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try? c.decodeIfPresent(String.self, forKey: .code)
        entityType = try? c.decodeIfPresent(String.self, forKey: .entityType)
        parent = try? c.decodeIfPresent(String.self, forKey: .parent)
    }
}

/// Where "Open …" on a restored entry goes in this app. Only the places it has a screen for.
enum AuditOpenTarget: Hashable, Sendable {
    case project(String)
    case task(String)
    case doc(String)
    case folder(String)
    /// Attendance, opened on one request when there is one (a day off an admin deleted).
    case attendance(request: String?)
    case roomBooking
    /// The Calendar, on that day when there is one.
    case calendar(date: String?)
    case vault
    /// Threads (the web's feed of posts), on that post.
    case threads(post: String?)
    /// Control Room → IP & Division Chart.
    case orgChart
    /// Control Room → Announcements.
    case announcements
    /// A group chat, back from a delete: its thread.
    case chat(String)

    /// The link's words, in English (the view translates them).
    var label: String {
        switch self {
        case .project: return "Open project"
        case .task: return "Open task"
        case .doc: return "Open doc"
        case .folder: return "Open folder"
        case .attendance: return "Open attendance"
        case .roomBooking: return "Open room booking"
        case .calendar: return "Open calendar"
        case .vault: return "Open Vault"
        case .threads: return "Open Threads"
        case .orgChart: return "Open IP & Division Chart"
        case .announcements: return "Open announcements"
        case .chat: return "Open chat"
        }
    }
}

/// What Control Room → Audit says about each kind of delete it can put back (owner, 8 Oct 2026: "skrng
/// semua delete apapun itu bentuknya soft delete ya supaya bisa di restore"). The kinds are the server's
/// src/lib/deletion-entities.ts RESTORABLE; the words follow the web's AuditLogView.tsx. Every string
/// here is the English source the views put through T(). Foundation-only, like the rest of this file,
/// so it can be run and checked on its own.
enum AuditRestoreKinds {
    /// Every kind the server can restore. A delete of one of these without a copy happened before
    /// NEXUS kept copies of it.
    static let restorable: Set<String> = [
        "project", "task", "comment", "attachment", "proof_annotation", "doc", "project_page", "project_sheet",
        "sheet_comment", "custom_field", "form", "automation", "workflow_bundle", "goal", "portfolio",
        "calendar", "room_booking", "announcement", "saved_search", "pnl_expense", "pnl_income", "pnl_payment",
        "pnl_category", "pnl_stage", "pnl_recurring", "pnl_expense_attachment", "pnl_budget", "holiday",
        "attendance_request", "attendance_office", "org_unit_member", "vault_file", "vault_folder", "vault_trash",
        "vault_file_version", "task_list", "project_folder", "org_unit", "sheet_rows", "form_submission", "attendance_record",
        "project_sheet_column", "post", "quest", "calendar_event", "dayoff_bonus", "chat_group",
        // A Pipeline Dashboard deal (owner, 9 Oct 2026).
        "pipeline_deal",
        // An Outlet Sales Dashboard event with its report (owner, 10 Oct 2026).
        "outlet_sales_event",
    ]

    private static let buttons: [String: String] = [
        "project": "Restore project", "task": "Restore task", "comment": "Restore comment",
        "attachment": "Restore file", "proof_annotation": "Restore annotation", "doc": "Restore doc",
        "project_page": "Restore page", "project_sheet": "Restore sheet", "sheet_comment": "Restore comment",
        "custom_field": "Restore custom field", "form": "Restore form", "automation": "Restore automation",
        "workflow_bundle": "Restore workflow bundle", "goal": "Restore goal",
        "portfolio": "Restore portfolio", "calendar": "Restore calendar", "room_booking": "Restore booking",
        "announcement": "Restore announcement", "saved_search": "Restore saved search",
        "pnl_expense": "Restore expense", "pnl_income": "Restore income", "pnl_payment": "Restore payment",
        "pnl_category": "Restore category", "pnl_stage": "Restore stage", "pnl_recurring": "Restore recurring expense",
        "pnl_expense_attachment": "Restore receipt", "pnl_budget": "Restore budget", "holiday": "Restore holiday",
        "attendance_request": "Restore day off", "attendance_office": "Restore office",
        "org_unit_member": "Restore placement", "vault_file": "Restore file", "vault_folder": "Restore folder",
        "vault_trash": "Restore trash", "vault_file_version": "Restore previous version", "task_list": "Restore section", "project_folder": "Restore folder",
        "org_unit": "Restore unit", "sheet_rows": "Restore rows", "form_submission": "Restore submission",
        "attendance_record": "Restore attendance record", "project_sheet_column": "Restore column",
        "post": "Restore post", "quest": "Restore quest", "calendar_event": "Restore event",
        "dayoff_bonus": "Restore extra day off", "chat_group": "Restore group chat",
        "pipeline_deal": "Restore deal",
        "outlet_sales_event": "Restore event",
    ]

    static func isProjectOrTask(_ entityType: String?) -> Bool { entityType == "project" || entityType == "task" }

    static func isVault(_ entityType: String?) -> Bool {
        entityType == "vault_file" || entityType == "vault_folder" || entityType == "vault_trash"
    }

    /// The button. A kind this list does not know (a newer server) gets plain "Restore".
    static func buttonTitle(_ entityType: String?) -> String { buttons[entityType ?? ""] ?? "Restore" }

    /// One line under the explanation, where the kind needs it said.
    static func note(_ entityType: String?, soft: Bool) -> String? {
        switch entityType ?? "" {
        case "project": return "Its folder comes back too if it was deleted."
        case "task_list": return "Tasks moved out of it go back in, unless someone has moved them since."
        case "project_folder":
            return "Projects and folders moved out of it go back in, unless someone has moved them since. If its name is taken, it comes back as “Name (2)”."
        case "org_unit":
            return "Its people come back on the card, and units moved up go back under it unless someone has moved them since."
        case "sheet_rows": return "They go back where they were. If new rows have taken those places, they go after the last row."
        case "project_sheet_column": return "Its values come back in the rows that still exist."
        case "project_sheet": return "If its tab position is taken, it comes back as the last tab."
        case "form": return "If its link has been taken since, it comes back with “-2” at the end."
        case "form_submission": return "Its task comes back with it."
        case "attendance_record": return "XP penalties refunded and the waiver given when it was deleted stay as they are."
        case "pnl_recurring": return "It posts again from this month on. The months it was deleted are not billed."
        case "pnl_category": return "Expenses that were in it go back into it."
        case "pnl_stage": return "Deals that were in it go back into it."
        case "room_booking": return "It can't come back if the room has been booked for that time since."
        case "vault_file", "vault_folder", "vault_trash":
            return soft ? "It comes out of the Vault trash."
                : "It comes back to the Vault trash, as it was. Restore it from there to use it again."
        // "Replace file…" (9 Oct 2026): the copy is the file's previous bytes.
        case "vault_file_version":
            return "The file goes back to the version from before it was replaced. Its links keep working and show that version."
        // The web says The Wire; this app calls the feed Threads.
        case "post": return "It shows in Threads again."
        case "quest": return "The quest becomes active again."
        case "calendar_event": return "The event is no longer cancelled."
        case "dayoff_bonus": return "The extra day off is granted again."
        case "chat_group": return "It shows in its members' chat lists again. Nothing is posted in the chat about it."
        // Its code is never handed to another deal, so it always fits back in (owner, 9 Oct 2026).
        case "pipeline_deal": return "It goes back to its pipeline with its code and its edit history."
        case "outlet_sales_event": return "It goes back to its outlet with its whole report, and counts in its month's totals again."
        case "attendance_office": return soft ? "The office is back in the list and open for check-ins." : nil
        default: return nil
        }
    }

    private static let conflicts: [String: String] = [
        "holiday": "There's already a holiday on that date. Remove it first if this one should come back.",
        "attendance_record": "That person already has an attendance record for that day.",
        "pnl_budget": "A budget has been set for that month since. Change that one instead.",
        "room_booking": "The room has been booked for that time since.",
        "org_unit_member": "They're on that card again already.",
        "project_sheet_column": "The sheet has no room for another column.",
    ]

    /// PARENT_MISSING, by the server's `parent`: what has to come back first.
    private static let parents: [String: String] = [
        "project": "Its project was deleted too. Restore the project first, then this.",
        "task": "Its task was deleted too. Restore the task first, then this.",
        "section": "Its section was deleted too. Restore the section first, then this.",
        "comment": "The comment it replied to was deleted too. Restore that comment first, then this.",
        "file": "Its file was deleted too. Restore the file first, then this.",
        "sheet": "Its sheet was deleted too. Restore the sheet first, then this.",
        "row": "Its row was deleted too. Restore the rows first, then this.",
        "page": "Its parent page was deleted too. Restore that page first, then this.",
        "doc": "Its doc was deleted too. Restore the doc first, then this.",
        "form": "Its form was deleted too. Restore the form first, then this.",
        "custom field": "Its custom field was deleted too. Restore the field first, then this.",
        "goal": "Its goal was deleted too. Restore the goal first, then this.",
        "portfolio": "Its portfolio was deleted too. Restore the portfolio first, then this.",
        "income": "Its income was deleted too. Restore the income first, then this.",
        "expense": "Its expense was deleted too. Restore the expense first, then this.",
        "folder": "Its folder was deleted too. Restore the folder first, then this.",
        "org chart unit": "Its unit was deleted too. Restore the unit first, then this.",
        "office": "Its office was deleted too. Restore the office first, then this.",
        "person": "The person it belonged to no longer exists, so it can't come back.",
        "workspace": "The workspace it belonged to no longer exists, so it can't come back.",
        "team": "The team it belonged to no longer exists, so it can't come back.",
    ]

    /// The app's own words for a refused restore; nil for a code it does not know (the caller shows
    /// the generic failure). Never the server's English `error`.
    static func failureText(code: String?, entityType: String?, parent: String?, soft: Bool) -> String? {
        switch code ?? "" {
        case "ALREADY_RESTORED": return "Someone has restored this already."
        case "ALREADY_EXISTS": return "It's already back."
        case "NOT_RESTORABLE": return "No copy of this delete was kept, so it can't be restored."
        case "PARENT_MISSING":
            if entityType == "task" {
                return parent == "task"
                    ? "Its parent task was deleted too. Restore that task first, then this subtask."
                    : "Its project was deleted too. Restore the project first, then this task."
            }
            return parents[parent ?? ""] ?? "What it belonged to was deleted too. Restore that first, then this."
        case "CONFLICT":
            if let text = conflicts[entityType ?? ""] { return text }
            return soft ? "It was changed after it was deleted, so it can't be put back as it was."
                : "Something has taken its place since, so it can't come back as it was."
        default: return nil
        }
    }

    /// One "N things" of what comes back: `one` is the whole text for 1, `many` a format for the rest.
    struct CountPart: Equatable, Sendable {
        let n: Int
        let one: String
        let many: String
    }

    /// What comes back, in the web's order. Projects and tasks say exactly what they always said; the
    /// Vault kinds and any kind this app does not know only "N items", and only when there is more
    /// than the one thing itself.
    static func countParts(_ c: AuditRestoreCounts, entityType: String?) -> [CountPart] {
        var out: [CountPart] = []
        func add(_ n: Int, _ one: String, _ many: String) { if n > 0 { out.append(CountPart(n: n, one: one, many: many)) } }
        let kind = entityType ?? ""
        if isProjectOrTask(kind) {
            if kind == "task" { add(c.tasks, "1 subtask", "%d subtasks") } else { add(c.tasks, "1 task", "%d tasks") }
            add(c.lists, "1 list", "%d lists")
            add(c.files, "1 file", "%d files")
            add(c.comments, "1 comment", "%d comments")
            add(c.sheets, "1 sheet", "%d sheets")
            add(c.members, "1 member", "%d members")
        } else if isVault(kind) || !restorable.contains(kind) {
            if c.items > 1 { add(c.items, "1 item", "%d items") }
        } else {
            add(c.rows, "1 row", "%d rows")
            add(c.cells, "1 value", "%d values")
            add(c.tasks, "1 task", "%d tasks")
            add(c.lists, "1 list", "%d lists")
            add(c.projects, "1 project", "%d projects")
            add(c.folders, "1 subfolder", "%d subfolders")
            add(c.people, "1 person", "%d people")
            add(c.units, "1 unit under it", "%d units under it")
            add(c.pages, "1 subpage", "%d subpages")
            add(c.submissions, "1 submission", "%d submissions")
            add(c.values, "1 field value", "%d field values")
            add(c.receipts, "1 receipt", "%d receipts")
            add(c.payments, "1 payment", "%d payments")
            add(c.milestones, "1 milestone", "%d milestones")
            add(c.points, "1 location point", "%d location points")
            add(c.files, "1 file", "%d files")
            if kind == "comment" { add(c.comments, "1 reply", "%d replies") } else { add(c.comments, "1 comment", "%d comments") }
            add(c.sheets, "1 sheet", "%d sheets")
            add(c.messages, "1 message", "%d messages")
            add(c.members, "1 member", "%d members")
        }
        return out
    }

    /// Where "Open …" goes, from the server's `open`. No `open` key at all (an older server, or a copy
    /// from before it existed) is a project or a task: its own page, by the entry's id, as before.
    /// Goals and portfolios have no screen in this app, so no link; a kind this app does not know
    /// opens its project when it lives in one.
    static func openTarget(_ open: AuditRestoreOpenField, entityType: String?, entityId: String?) -> AuditOpenTarget? {
        switch open {
        case .absent:
            guard let id = entityId, !id.isEmpty else { return nil }
            if entityType == "project" { return .project(id) }
            if entityType == "task" { return .task(id) }
            return nil
        case .none:
            return nil
        case .target(let o):
            let id: String? = o.id.isEmpty ? nil : o.id
            switch o.type {
            case "project": return id.map { .project($0) }
            case "task": return id.map { .task($0) }
            case "doc": return id.map { .doc($0) }
            case "folder": return id.map { .folder($0) }
            case "vault": return .vault
            case "attendance_request": return .attendance(request: id)
            case "attendance_record", "attendance_office": return .attendance(request: nil)
            case "room_booking": return .roomBooking
            case "calendar", "calendar_event": return .calendar(date: o.date)
            case "post": return .threads(post: id)
            case "org_chart": return .orgChart
            case "announcement": return .announcements
            case "chat": return id.map { .chat($0) }
            case "goal", "portfolio": return nil
            // A sheet, page, form or P&L entry, or a kind this app does not know: its project.
            default: return o.projectId.map { .project($0) }
            }
        }
    }
}

/// Any JSON value. Arrays and dictionaries already live on the heap, so no `indirect` is needed.
enum AuditJSON: Decodable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([AuditJSON])
    case object([String: AuditJSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        // Bool before Double: JSONDecoder will not read `true` as a number or `1` as a bool, so the
        // order only decides which attempt is wasted, never which answer is wrong.
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([AuditJSON].self) { self = .array(a) }
        else if let o = try? c.decode([String: AuditJSON].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not a JSON value") }
    }

    /// The Foundation form JSONSerialization can write. Whole numbers go back as Int so an id of
    /// 42 prints as 42, not 42.0.
    var foundation: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n):
            if n.rounded() == n, abs(n) < 1e15 { return Int(n) }
            return n
        case .string(let s): return s
        case .array(let a): return a.map { $0.foundation }
        case .object(let o): return o.mapValues { $0.foundation }
        }
    }

    /// Indented, keys sorted so two entries of the same kind read in the same order.
    var pretty: String {
        let opts: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes]
        guard let data = try? JSONSerialization.data(withJSONObject: foundation, options: opts),
              let s = String(data: data, encoding: .utf8) else { return "" }
        return s
    }

    var isEmpty: Bool {
        switch self {
        case .null: return true
        case .array(let a): return a.isEmpty
        case .object(let o): return o.isEmpty
        default: return false
        }
    }
}
