import Foundation
import Observation

// The spreadsheet panels' plumbing: what a panel gets from the screen (SheetPanelContext), the server calls
// the panels make (comments, revisions — dev web src/app/api/sheets/[sheetId]/comments|revisions — and sheet
// settings through PATCH /api/sheets/:id), the comments model the grid reads for its corner marker, and the
// few SheetStore helpers the panels need, written on the store's existing API only.

/// Everything a panel needs from the sheet screen.
@MainActor
struct SheetPanelContext {
    let store: SheetStore
    /// The sheet's comments (corner markers + threads). One per screen, loaded with the sheet.
    let comments: SheetCommentsModel
    /// Records one undo step on the store's stack (settings edits: validation, conditional formatting,
    /// charts, named versions…). The lead wires it to the store's push; nil = no undo for those edits.
    var pushUndo: ((SheetUndoEntry) -> Void)? = nil
}

// MARK: - comments

/// One SheetComment (GET /api/sheets/:id/comments).
struct SPComment: Identifiable, Equatable {
    let id: String
    let rowId: String
    let columnId: String
    var body: String
    var resolvedAt: String?
    let createdAt: String
    let authorId: String
    let authorName: String?
    let authorAvatar: String?

    init?(_ o: SheetJSON) {
        guard let id = o["id"] as? String, let rowId = o["rowId"] as? String, let columnId = o["columnId"] as? String else { return nil }
        self.id = id
        self.rowId = rowId
        self.columnId = columnId
        body = o["body"] as? String ?? ""
        resolvedAt = o["resolvedAt"] as? String
        createdAt = o["createdAt"] as? String ?? ""
        let author = o["author"] as? SheetJSON
        authorId = o["authorId"] as? String ?? author?["id"] as? String ?? ""
        authorName = author?["name"] as? String
        authorAvatar = author?["avatar"] as? String
    }
}

/// The open sheet's comments, fetched in one call (the web's sheet-comments query): the grid draws a corner
/// marker on every cell with an UNRESOLVED comment (a closed thread shouldn't nag forever).
@MainActor
@Observable
final class SheetCommentsModel {
    private(set) var sheetId: String?
    private(set) var comments: [SPComment] = []
    private(set) var meId: String?
    private(set) var loading = false
    var busy = false
    var error: String?
    /// "rowId:columnId" → unresolved comment count.
    private(set) var counts: [String: Int] = [:]
    /// Bumped whenever `counts` changes, so the grid knows to redraw its markers.
    private(set) var version = 0

    init() {}

    /// Unresolved comments on a cell (0 = no marker).
    func count(rowId: String, columnId: String) -> Int { counts["\(rowId):\(columnId)"] ?? 0 }
    func hasComment(rowId: String, columnId: String) -> Bool { count(rowId: rowId, columnId: columnId) > 0 }

    func thread(rowId: String, columnId: String) -> [SPComment] {
        comments.filter { $0.rowId == rowId && $0.columnId == columnId }
    }

    /// Loads (or reloads) the comments of a sheet. Pass nil to clear.
    func load(_ id: String?) async {
        if id != sheetId { comments = []; recount() }
        sheetId = id
        guard let id else { return }
        loading = true
        defer { loading = false }
        do {
            let o = try await APIClient.shared.panelRun("/api/sheets/\(SheetPanelAPI.enc(id))/comments")
            guard id == sheetId else { return }
            comments = ((o["comments"] as? [SheetJSON]) ?? []).compactMap(SPComment.init)
            meId = o["currentUserId"] as? String
            error = nil
            recount()
        } catch {
            if comments.isEmpty { self.error = SheetPanelAPI.message(error, T("Couldn't load the comments.")) }
        }
    }

    func reload() async { await load(sheetId) }

    func add(rowId: String, columnId: String, body: String) async -> Bool {
        guard let id = sheetId else { return false }
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        busy = true
        defer { busy = false }
        do {
            _ = try await APIClient.shared.panelRun("/api/sheets/\(SheetPanelAPI.enc(id))/comments", method: "POST",
                                                    body: ["rowId": rowId, "columnId": columnId, "body": String(text.prefix(2000))])
            await reload()
            return true
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't send the comment."))
            return false
        }
    }

    func setResolved(_ c: SPComment, _ resolved: Bool) async {
        guard let id = sheetId else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await APIClient.shared.panelRun("/api/sheets/\(SheetPanelAPI.enc(id))/comments", method: "PATCH",
                                                    body: ["commentId": c.id, "resolved": resolved])
            await reload()
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't save."))
        }
    }

    func delete(_ c: SPComment) async {
        guard let id = sheetId else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await APIClient.shared.panelRun("/api/sheets/\(SheetPanelAPI.enc(id))/comments?commentId=\(SheetPanelAPI.enc(c.id))", method: "DELETE")
            await reload()
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't delete the comment."))
        }
    }

    private func recount() {
        var out: [String: Int] = [:]
        for c in comments where c.resolvedAt == nil { out["\(c.rowId):\(c.columnId)", default: 0] += 1 }
        counts = out
        version += 1
    }
}

// MARK: - server calls

enum SheetPanelAPI {
    static func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s }

    /// A settings list, or NSNull (removes the key) when it is empty — the web's `next.length ? next : null`.
    static func orNull(_ list: [SheetJSON]) -> Any { list.isEmpty ? NSNull() : list }

    static func message(_ error: Error, _ fallback: String) -> String {
        if (error as? APIError)?.nobodyAnswered == true { return T("You're offline. Try again once you're back online.") }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    /// GET /api/sheets/:id/revisions — one cell's history (rowId + columnId), every change after a moment
    /// (`after`), or the recent activity (`limit`, up to 2000).
    static func revisions(_ sheetId: String, rowId: String? = nil, columnId: String? = nil, after: String? = nil,
                          limit: Int? = nil) async throws -> [SPRevision] {
        var q: [String] = []
        if let rowId, let columnId { q.append("rowId=\(enc(rowId))"); q.append("columnId=\(enc(columnId))") }
        if let after { q.append("after=\(enc(after))") }
        if let limit { q.append("limit=\(limit)") }
        let path = "/api/sheets/\(enc(sheetId))/revisions" + (q.isEmpty ? "" : "?" + q.joined(separator: "&"))
        let o = try await APIClient.shared.panelRun(path)
        return ((o["revisions"] as? [SheetJSON]) ?? []).compactMap { SPRevision(json: $0) }
    }
}

extension APIClient {
    /// A sheet call with this app's X-Nexus-Tab (so realtime skips only this app's own echo). Offline / no
    /// answer → APIError.nothingAnswered.
    func panelRun(_ path: String, method: String = "GET", body: Any? = nil) async throws -> SheetJSON {
        var req = makeRequest(path, method: method)
        req.setValue(Self.sheetTabId, forHTTPHeaderField: "X-Nexus-Tab")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(req) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        if data.isEmpty { return [:] }
        return ((try? JSONSerialization.jsonObject(with: data)) as? SheetJSON) ?? [:]
    }
}

// MARK: - store helpers for the panels

extension SheetStore {
    /// The engine's view of the sheet (model order; ranges in settings are read against it).
    var panelShape: SheetShape { snapshot?.shape ?? SheetShape(columnIds: [], rowIds: []) }
    var panelColumns: [SheetColumn] { snapshot?.columns ?? [] }

    /// The selection's current block as A1 ("B2:D9"), as the web pre-fills a new rule's range.
    var panelSelectionA1: String { nameBox }

    /// The selection's current block in model indices.
    var panelSelectionRect: SheetValidation.Rect? {
        let r = selection.current
        guard let t = modelRow(r.top), let l = modelCol(r.left), let b = modelRow(r.bottom), let rt = modelCol(r.right) else { return nil }
        return SheetValidation.Rect(top: t, bottom: b, left: l, right: rt)
    }

    /// A settings array (validations, condFormats, bandings, charts, versions…).
    func panelList(_ key: String) -> [SheetJSON] { (settings[key] as? [SheetJSON]) ?? [] }

    /// Moves the selection to a cell given by model indices (a find hit, a comment in the list).
    func panelSelect(modelRow r: Int, modelCol c: Int) {
        guard let vr = visRows.firstIndex(of: r), let vc = visCols.firstIndex(of: c) else { return }
        select(SheetPos(r: vr, c: vc))
    }

    func panelSelect(rowId: String, columnId: String) {
        guard let r = rows.firstIndex(where: { $0.id == rowId }),
              let c = columns.firstIndex(where: { ($0["id"] as? String) == columnId }) else { return }
        panelSelect(modelRow: r, modelCol: c)
    }

    /// Saves settings keys (NSNull removes one) like the web's editSettings: on screen at once, then the
    /// server, then the sheet again so the grid redraws with them. One undo step through `pushUndo`.
    @discardableResult
    func panelSaveSettings(_ patch: SheetJSON, label: String, pushUndo: ((SheetUndoEntry) -> Void)?) async -> Bool {
        guard canEdit, let sid = sheetId else { return false }
        var before: SheetJSON = [:]
        for k in patch.keys { before[k] = settings[k] ?? NSNull() }
        let ok = await panelSendSettings(patch, sheet: sid)
        if ok, let pushUndo {
            pushUndo(SheetUndoEntry(label: label,
                                    undo: { [weak self] in _ = await self?.panelSendSettings(before, sheet: sid) },
                                    redo: { [weak self] in _ = await self?.panelSendSettings(patch, sheet: sid) }))
        }
        return ok
    }

    func panelSendSettings(_ patch: SheetJSON, sheet sid: String) async -> Bool {
        if sid == sheetId {
            var next = settings
            for (k, v) in patch { if v is NSNull { next.removeValue(forKey: k) } else { next[k] = v } }
            settings = next
        }
        do {
            try await APIClient.shared.patchSheet(sid, body: ["settings": patch])
            if sid == sheetId { await reload() }
            return true
        } catch {
            fail(error, T("Couldn't save."))
            if sid == sheetId { await reload() }
            return false
        }
    }

    /// Changes one column's definition (a dropdown column's choices from Data validation). One undo step.
    @discardableResult
    func panelPatchColumn(_ columnId: String, label: String, pushUndo: ((SheetUndoEntry) -> Void)?,
                          _ edit: (SheetJSON) -> SheetJSON) async -> Bool {
        guard canEdit, let sid = sheetId, let i = columns.firstIndex(where: { ($0["id"] as? String) == columnId }) else { return false }
        let before = columns[i]
        let after = edit(before)
        let ok = await panelPutColumn(after, sheet: sid)
        if ok, let pushUndo {
            pushUndo(SheetUndoEntry(label: label,
                                    undo: { [weak self] in _ = await self?.panelPutColumn(before, sheet: sid) },
                                    redo: { [weak self] in _ = await self?.panelPutColumn(after, sheet: sid) }))
        }
        return ok
    }

    func panelPutColumn(_ column: SheetJSON, sheet sid: String) async -> Bool {
        guard sid == sheetId, let id = column["id"] as? String, let i = columns.firstIndex(where: { ($0["id"] as? String) == id }) else { return false }
        var next = columns
        next[i] = column
        do {
            try await APIClient.shared.patchSheet(sid, body: ["columns": next], structureVersion: structureVersion)
            await reload()
            return true
        } catch {
            fail(error, T("Couldn't save."))
            return false
        }
    }
}
