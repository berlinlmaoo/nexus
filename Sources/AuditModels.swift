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
    /// On a deleted project or task that kept a copy (since 8 Oct 2026). Absent = can't be restored.
    let restore: AuditRestoreInfo?

    struct UserRef: Decodable, Sendable, Hashable {
        let id: String?
        let name: String?
        let email: String?
        let avatar: String?
    }

    /// Hashable by id only: `.sheet(item:)` needs Identifiable, and two decodes of the same row
    /// are the same entry whatever the rest of the payload says.
    static func == (a: AuditLog, b: AuditLog) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
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

    enum CodingKeys: String, CodingKey { case entry, title, changes, details, restore }

    /// Lenient about the two lists: an entry with nothing to diff may arrive with them missing or
    /// null, and that must still open the sheet rather than fail it.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entry = try c.decode(Entry.self, forKey: .entry)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        changes = (try? c.decodeIfPresent([Change].self, forKey: .changes)) ?? []
        details = (try? c.decodeIfPresent([Detail].self, forKey: .details)) ?? []
        restore = try? c.decodeIfPresent(AuditRestoreDetail.self, forKey: .restore)
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
struct AuditRestoreInfo: Decodable, Sendable, Hashable {
    let available: Bool
    let restoredAt: String?
    /// When the copy is from: the delete itself, or the nightly backup it was taken from.
    let dataAsOf: String?
    let fromBackup: Bool?
}

/// The `restore` of GET /api/audit/{id}: the row's facts plus who restored it and what comes back.
struct AuditRestoreDetail: Decodable, Sendable {
    let available: Bool
    let restoredAt: String?
    let dataAsOf: String?
    let fromBackup: Bool?
    let restoredBy: AuditLog.UserRef?
    let counts: Counts

    struct Counts: Decodable, Sendable {
        let lists: Int, tasks: Int, files: Int, comments: Int, sheets: Int, members: Int

        enum CodingKeys: String, CodingKey { case lists, tasks, files, comments, sheets, members }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func n(_ k: CodingKeys) -> Int { (try? c.decodeIfPresent(Int.self, forKey: k)) ?? 0 }
            lists = n(.lists); tasks = n(.tasks); files = n(.files)
            comments = n(.comments); sheets = n(.sheets); members = n(.members)
        }
    }
}

/// POST /api/audit/{id}/restore.
struct AuditRestoreResult: Decodable, Sendable {
    let entityType: String
    let entityId: String
    let projectId: String?
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
