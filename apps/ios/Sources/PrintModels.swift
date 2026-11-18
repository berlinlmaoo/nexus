import Foundation
import SwiftUI

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

extension PrintPageRanges {
    /// The 1-based pages the typed ranges print, for dimming the others in the preview. nil = every page
    /// (empty, or not valid yet: nothing is dimmed while the person is still typing).
    static func pages(_ text: String, pageCount: Int) -> Set<Int>? {
        guard case .count = check(text, pageCount: pageCount) else { return nil }
        var out = Set<Int>()
        for piece in text.filter({ !$0.isWhitespace }).split(separator: ",") {
            let ends = piece.split(separator: "-").compactMap { Int($0) }
            guard let lo = ends.first else { continue }
            let hi = ends.count > 1 ? ends[1] : lo
            if lo <= hi { out.formUnion(lo...hi) }
        }
        return out
    }
}

// MARK: - Live printer status (GET /api/print/status)

/// One CUPS reason ("media-empty", severity "error").
struct PrinterReason: Decodable, Hashable, Sendable {
    let keyword: String
    let severity: String
    private enum K: String, CodingKey { case keyword, severity }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        keyword = (try? c.decodeIfPresent(String.self, forKey: .keyword)) ?? ""
        severity = (try? c.decodeIfPresent(String.self, forKey: .severity)) ?? "error"
    }

    /// A sentence for the keywords people meet at the office printer; anything else is shown as the keyword.
    var label: String {
        switch keyword {
        case "media-empty", "media-needed": return T("Out of paper")
        case "media-jam": return T("Paper jam")
        case "marker-supply-empty": return T("Out of ink")
        case "marker-supply-low": return T("Ink is low")
        case "door-open", "cover-open": return T("The printer cover is open")
        case "paused": return T("The printer is paused")
        // What CUPS says while it can't reach the printer over the office WiFi (off, or out of range).
        case "offline", "connecting-to-device", "timed-out": return T("The printer can't be reached")
        default: return keyword
        }
    }
}

/// One job in the printer's queue. Other people's jobs carry only the name; `who` nil = not sent from NEXUS.
struct PrinterQueueJob: Decodable, Hashable, Sendable {
    struct Who: Decodable, Hashable, Sendable { let id: String; let name: String }
    let position: Int
    /// printing | waiting | held | stopped | stalled (stalled = the printer is not connected)
    let state: String
    let who: Who?
    let mine: Bool
    let title: String?
    let nexusJobId: String?
    private enum K: String, CodingKey { case position, state, who, mine, title, nexusJobId }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        position = (try? c.decodeIfPresent(Int.self, forKey: .position)) ?? 0
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) ?? "waiting"
        who = (try? c.decodeIfPresent(Who.self, forKey: .who)) ?? nil
        mine = (try? c.decodeIfPresent(Bool.self, forKey: .mine)) ?? false
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil
        nexusJobId = (try? c.decodeIfPresent(String.self, forKey: .nexusJobId)) ?? nil
    }

    /// Who sent it: "You · <title>" for your own, their name, or "Outside NEXUS" (not sent from NEXUS).
    var whoLabel: String {
        if mine {
            if let title, !title.isEmpty { return T("You") + " · " + title }
            return T("You")
        }
        if let who, !who.name.isEmpty { return who.name }
        return T("Outside NEXUS")
    }
    var isOutsideNexus: Bool { !mine && who == nil }
}

/// The office printer right now (cached 3 s on the server).
struct PrinterStatus: Decodable, Equatable, Sendable {
    let reachable: Bool
    /// idle | printing | stopped | error | disconnected | unreachable
    let state: String
    let reasons: [PrinterReason]
    let message: String?
    let acceptingJobs: Bool
    let waiting: Int
    let jobs: [PrinterQueueJob]
    private enum K: String, CodingKey { case reachable, state, reasons, message, acceptingJobs, waiting, jobs }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        reachable = (try? c.decodeIfPresent(Bool.self, forKey: .reachable)) ?? false
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) ?? "unreachable"
        reasons = (try? c.decodeIfPresent([PrinterReason].self, forKey: .reasons)) ?? []
        message = (try? c.decodeIfPresent(String.self, forKey: .message)) ?? nil
        acceptingJobs = (try? c.decodeIfPresent(Bool.self, forKey: .acceptingJobs)) ?? true
        waiting = (try? c.decodeIfPresent(Int.self, forKey: .waiting)) ?? 0
        jobs = (try? c.decodeIfPresent([PrinterQueueJob].self, forKey: .jobs)) ?? []
    }

    /// Since 18 Nov 2026 CUPS reaches the printer over WiFi: "disconnected" = the printer is off or out of the
    /// office WiFi. Prints wait on the server and come out once it is back.
    var isDisconnected: Bool { state == "disconnected" }

    /// The printer's own message worth showing: not while disconnected (the panel says that plainly) and not
    /// the routine "Connected to printer".
    var printerMessage: String? {
        guard !isDisconnected, let m = message?.trimmingCharacters(in: .whitespacesAndNewlines), !m.isEmpty,
              !m.lowercased().hasPrefix("connected to printer") else { return nil }
        return m
    }

    /// Everyone not printing yet, in queue order.
    var waitingJobs: [PrinterQueueJob] { jobs.filter { $0.state != "printing" }.sorted { $0.position < $1.position } }

    var headline: String {
        switch state {
        case "idle": return T("Ready")
        case "printing": return T("Printing")
        case "stopped": return T("The printer stopped")
        case "error": return T("There's a problem")
        case "disconnected": return T("The printer can't be reached")
        default: return T("The server can't reach the printer")
        }
    }
    var tone: Color {
        switch state {
        case "idle": return NX.success
        case "printing": return NX.blue
        case "stopped", "disconnected": return NX.warning
        default: return NX.danger
        }
    }
    /// The job printing now, if any.
    var current: PrinterQueueJob? { jobs.first { $0.state == "printing" } }
    /// This person's NEXUS job in the queue.
    func queueJob(for jobId: String) -> PrinterQueueJob? { jobs.first { $0.nexusJobId == jobId } }
}

extension Notification.Name {
    /// A print_done / print_failed push arrived while the app was open (NotificationManager.willPresent).
    static let nexusPrintJobEnded = Notification.Name("nexus.print.jobEnded")
}
