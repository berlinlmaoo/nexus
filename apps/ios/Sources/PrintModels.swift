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
    /// A file uploaded on the Print screen (POST /api/print/uploads); deleted once its job ends.
    case upload
}

/// POST /api/print/uploads → `upload`: the server's PDF of the file, with its page count.
struct PrintUpload: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let fileName: String
    let pages: Int
    let size: Int
    let expiresAt: String?
    private enum K: String, CodingKey { case id, fileName, pages, size, expiresAt }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        fileName = (try? c.decodeIfPresent(String.self, forKey: .fileName)) ?? ""
        pages = (try? c.decodeIfPresent(Int.self, forKey: .pages)) ?? 0
        size = (try? c.decodeIfPresent(Int.self, forKey: .size)) ?? 0
        expiresAt = (try? c.decodeIfPresent(String.self, forKey: .expiresAt)) ?? nil
    }
}

struct PrintUploadResponse: Decodable { let upload: PrintUpload }

/// The pages typed for an upload ("1-3,5"), checked as the server does (src/lib/print/page-ranges.ts):
/// nil = all pages; otherwise how many pages they cover, or the problem to show.
enum PrintPageRanges {
    enum Result: Equatable { case all, count(Int), invalid(String) }

    static func check(_ text: String, pageCount: Int) -> Result {
        let raw = text.filter { !$0.isWhitespace }
        if raw.isEmpty { return .all }
        guard raw.count <= 200, raw.range(of: #"^\d+(-\d+)?(,\d+(-\d+)?)*,?$"#, options: .regularExpression) != nil else {
            return .invalid(T("Write pages like 1-3,5"))
        }
        var parts: [(Int, Int)] = []
        for piece in raw.split(separator: ",") {
            let ends = piece.split(separator: "-").compactMap { Int($0) }
            guard let lo = ends.first else { return .invalid(T("Write pages like 1-3,5")) }
            let hi = ends.count > 1 ? ends[1] : lo
            if lo < 1 || hi < lo { return .invalid(T("Write pages like 1-3,5")) }
            if hi > pageCount { return .invalid(String(format: T("This file has %d pages."), pageCount)) }
            parts.append((lo, hi))
        }
        // Overlaps count once, as on the server.
        var merged: [(Int, Int)] = []
        for r in parts.sorted(by: { $0.0 < $1.0 }) {
            if let last = merged.last, r.0 <= last.1 + 1 { merged[merged.count - 1].1 = max(last.1, r.1) } else { merged.append(r) }
        }
        return .count(merged.reduce(0) { $0 + $1.1 - $1.0 + 1 })
    }
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
    var kindIcon: String {
        switch kind {
        case "legal": return "doc.text.fill"
        case "upload": return "arrow.up.doc"
        default: return "doc.richtext"
        }
    }
    var kindLabel: String {
        switch kind {
        case "legal": return T("Legal document")
        case "upload": return T("Uploaded file")
        default: return T("Page")
        }
    }
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
