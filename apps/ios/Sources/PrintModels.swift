import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Print to the office printer (owner, 18 Nov 2026). Server: src/app/api/print/**, src/lib/print/**.
// Who may print = who may view (a Legal document needs Legal; a page needs its project). Every print is
// logged; BoD / One Above All see everyone's log. Android handoff: docs/print-android.md.
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/app/config → `printing` (also echoed by GET /api/print/jobs). Absent = printing is off.
struct PrintingConfig: Codable, Equatable, Sendable {
    var enabled: Bool?
    var printerName: String?
    var maxCopies: Int?
    var maxPages: Int?
}

/// What a print is of: a Legal document (its primary version) or a page.
enum PrintKind: String, Sendable {
    case legal, doc
}

/// "color" | "mono". Black & white is the default (cheaper ink).
enum PrintColorMode: String, CaseIterable, Identifiable, Sendable {
    case mono, color
    var id: String { rawValue }
    var label: String { self == .color ? T("Color") : T("Black & white") }
}

struct PrintPerson: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let avatar: String?
    private enum K: String, CodingKey { case id, name, avatar }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        avatar = (try? c.decodeIfPresent(String.self, forKey: .avatar)) ?? nil
    }
}

/// One print job. `status`: queued → printing → done | failed.
struct PrintJob: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let refId: String
    let title: String
    let pages: Int?
    let copies: Int
    let colorMode: String
    let status: String
    let error: String?
    let createdAt: String?
    let finishedAt: String?
    let userId: String
    let user: PrintPerson?

    private enum K: String, CodingKey { case id, kind, refId, title, pages, copies, colorMode, status, error, createdAt, finishedAt, userId, user }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "doc"
        refId = (try? c.decodeIfPresent(String.self, forKey: .refId)) ?? ""
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        pages = (try? c.decodeIfPresent(Int.self, forKey: .pages)) ?? nil
        copies = (try? c.decodeIfPresent(Int.self, forKey: .copies)) ?? 1
        colorMode = (try? c.decodeIfPresent(String.self, forKey: .colorMode)) ?? "mono"
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "queued"
        error = (try? c.decodeIfPresent(String.self, forKey: .error)) ?? nil
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
        finishedAt = (try? c.decodeIfPresent(String.self, forKey: .finishedAt)) ?? nil
        userId = (try? c.decodeIfPresent(String.self, forKey: .userId)) ?? ""
        user = (try? c.decodeIfPresent(PrintPerson.self, forKey: .user)) ?? nil
    }

    /// Done or failed: nothing more will change, so the sheet stops asking.
    var isFinished: Bool { status == "done" || status == "failed" }
    var isColor: Bool { colorMode == "color" }

    var statusLabel: String {
        switch status {
        case "queued": return T("Queued")
        case "printing": return T("Printing…")
        case "done": return T("Printed")
        case "failed": return T("Print failed")
        default: return status
        }
    }
    var statusTone: ChipTone {
        switch status {
        case "done": return .success
        case "failed": return .danger
        case "printing": return .info
        default: return .neutral
        }
    }
    /// "3 pages × 2"; without a page count (not counted yet), just "× 2".
    var pagesLabel: String {
        if let pages { return String(format: T("%d pages × %d"), pages, copies) }
        return "× \(copies)"
    }
    var kindIcon: String { kind == "legal" ? "doc.text.fill" : "doc.richtext" }
    var created: Date? { createdAt.flatMap(LegalDocument.parseTimestamp) }
}

struct PrintJobResponse: Decodable { let job: PrintJob }

/// GET /api/print/jobs.
struct PrintJobsPage: Decodable {
    let jobs: [PrintJob]
    let nextCursor: String?
    let canSeeAll: Bool
    let people: [PrintPerson]
    let printing: PrintingConfig?
    private enum K: String, CodingKey { case jobs, nextCursor, canSeeAll, people, printing }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        jobs = (try? c.decodeIfPresent([PrintJob].self, forKey: .jobs)) ?? []
        nextCursor = (try? c.decodeIfPresent(String.self, forKey: .nextCursor)) ?? nil
        canSeeAll = (try? c.decodeIfPresent(Bool.self, forKey: .canSeeAll)) ?? false
        people = (try? c.decodeIfPresent([PrintPerson].self, forKey: .people)) ?? []
        printing = (try? c.decodeIfPresent(PrintingConfig.self, forKey: .printing)) ?? nil
    }
}
