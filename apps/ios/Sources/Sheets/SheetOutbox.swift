import Foundation

/// Cell writes on their way to the server, one serial queue PER SHEET (web: per-sheet save queue, offline
/// queue + badge). Edits land here first and are written to disk, so a write made offline — or in the
/// second before the app is closed — is sent when the server can be reached again. One request in flight
/// per sheet; a failed send goes back under anything typed since, so the newest value always wins.
@MainActor
final class SheetOutbox {
    static let shared = SheetOutbox()

    private var queues: [String: SheetPendingWrites] = [:]
    private var flushing: Set<String> = []
    private var scheduled: Set<String> = []
    private(set) var offline = false
    /// The open spreadsheet screen, told about saves of its sheet.
    weak var activeStore: SheetStore?
    var onChange: (() -> Void)?

    private let url: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("sheet-outbox.json")

    /// Server limits (src/lib/project-sheets.ts MAX_ROWS_PER_WRITE / MAX_CELLS_PER_WRITE) with room to spare.
    private let maxRowsPerSend = 200

    private init() {
        if let url, let data = try? Data(contentsOf: url),
           let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: [String: Any]] {
            for (sheet, q) in o { queues[sheet] = SheetPendingWrites(json: q) }
        }
        // Anything left from last time goes out as soon as the app is up.
        for sheet in queues.keys { flushSoon(sheet, delay: 1) }
    }

    func pending(_ sheet: String) -> SheetPendingWrites { queues[sheet] ?? SheetPendingWrites() }
    func isFlushing(_ sheet: String) -> Bool { flushing.contains(sheet) }
    var totalPending: Int { queues.values.reduce(0) { $0 + $1.count } }

    func put(sheet: String, row: String, col: String, value: Any?) {
        var q = queues[sheet] ?? SheetPendingWrites()
        q.put(row: row, col: col, value: value)
        queues[sheet] = q
        write()
        onChange?()
    }

    func putStyle(sheet: String, row: String, col: String, style: [String: Any]?) {
        var q = queues[sheet] ?? SheetPendingWrites()
        q.putStyle(row: row, col: col, style: style)
        queues[sheet] = q
        write()
        onChange?()
    }

    func drop(sheet: String, rows: Set<String>) {
        guard var q = queues[sheet] else { return }
        q.drop(rows: rows)
        queues[sheet] = q.isEmpty ? nil : q
        write()
        onChange?()
    }

    /// Sends this sheet's queue shortly (typing a run of cells becomes one request).
    func flushSoon(_ sheet: String, delay: Double = 0.35) {
        guard !scheduled.contains(sheet) else { return }
        scheduled.insert(sheet)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self else { return }
            self.scheduled.remove(sheet)
            await self.flush(sheet)
        }
    }

    /// Every sheet with something waiting (back online, app back in front).
    func flushAll() {
        for sheet in queues.keys { flushSoon(sheet, delay: 0.1) }
    }

    private func flush(_ sheet: String) async {
        guard !flushing.contains(sheet), var q = queues[sheet], !q.isEmpty else { return }
        flushing.insert(sheet)
        onChange?()
        let batch = q.take(maxRows: maxRowsPerSend)
        queues[sheet] = q
        var retryIn: Double?
        do {
            let o = try await APIClient.shared.patchSheetCells(sheet, edits: batch.values, styles: batch.styles)
            offline = false
            activeStore?.outboxSent(sheet: sheet, rows: (o["rows"] as? [SheetJSON]) ?? [])
        } catch let e as APIError where e.nobodyAnswered {
            // Offline: back in the queue, kept on disk, tried again.
            var back = queues[sheet] ?? SheetPendingWrites()
            back.restore(values: batch.values, styles: batch.styles)
            queues[sheet] = back
            offline = true
            retryIn = 8
        } catch let e as APIError where Self.isTransient(e) {
            var back = queues[sheet] ?? SheetPendingWrites()
            back.restore(values: batch.values, styles: batch.styles)
            queues[sheet] = back
            retryIn = 15
        } catch APIError.unauthorized {
            // Signed out: the writes stay on disk for the next sign-in of this account.
            var back = queues[sheet] ?? SheetPendingWrites()
            back.restore(values: batch.values, styles: batch.styles)
            queues[sheet] = back
        } catch {
            // Refused (protected range, deleted column, sheet gone): these writes can never land.
            let message = (error as? LocalizedError)?.errorDescription ?? T("Some changes couldn't be saved.")
            if activeStore?.sheetId == sheet { activeStore?.saveRefused(message) }
        }
        if queues[sheet]?.isEmpty == true { queues[sheet] = nil }
        flushing.remove(sheet)
        write()
        onChange?()
        if let retryIn {
            flushSoon(sheet, delay: retryIn)
        } else if queues[sheet] != nil {
            flushSoon(sheet, delay: 0.05)
        }
    }

    /// A server that is restarting or busy: try again rather than throw the writes away.
    private static func isTransient(_ e: APIError) -> Bool {
        if case .http(let status, _) = e { return status >= 500 || status == 429 }
        return false
    }

    private func write() {
        guard let url else { return }
        let o = queues.mapValues { $0.json }
        guard JSONSerialization.isValidJSONObject(o), let data = try? JSONSerialization.data(withJSONObject: o) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    /// Sign-out: nothing of this account's may be sent as the next person.
    func clearAll() {
        queues = [:]
        write()
        onChange?()
    }
}
