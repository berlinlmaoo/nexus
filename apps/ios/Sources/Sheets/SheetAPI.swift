import Foundation

// The project spreadsheet's server calls (dev server; src/app/api/sheets/[sheetId]/…, projects/[id]/sheets).
// Cells are heterogeneous JSON (text, number, bool, { f }, { v, nf }, { t, u }, arrays), so everything here
// travels as Foundation JSON rather than Decodable models.

/// One sheet tab of a project (GET /api/projects/:id/sheets).
struct SheetTabInfo: Identifiable, Equatable {
    let id: String
    var name: String
    var position: Int
    var rowCount: Int
    var tabColor: String?
    var hidden: Bool
    var pivot: Bool

    init?(_ o: SheetJSON) {
        guard let id = o["id"] as? String else { return nil }
        self.id = id
        name = o["name"] as? String ?? ""
        position = (o["position"] as? NSNumber)?.intValue ?? 0
        rowCount = (o["rowCount"] as? NSNumber)?.intValue ?? 0
        tabColor = o["tabColor"] as? String
        hidden = o["hidden"] as? Bool ?? false
        pivot = o["pivot"] as? Bool ?? false
    }
}

enum SheetAPIError: LocalizedError {
    case refused(Int, String?)
    case structureChanged(SheetJSON)
    var errorDescription: String? {
        switch self {
        case .refused(_, let message): return message
        case .structureChanged: return T("The sheet columns changed. The latest version is shown; try your change again.")
        }
    }
}

extension APIClient {
    /// This app run's id for X-Nexus-Tab: the server stamps it on sheet events, so only THIS app skips the
    /// echo of its own write; the same person's other devices apply it live.
    static let sheetTabId: String = "ios-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)

    private static func sheetEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    private func sheetRequest(_ path: String, method: String = "GET", body: Any? = nil) throws -> URLRequest {
        var req = makeRequest(path, method: method)
        req.setValue(Self.sheetTabId, forHTTPHeaderField: "X-Nexus-Tab")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    /// Runs a sheet call. Offline / no answer → APIError.nothingAnswered (the caller queues the write).
    private func sheetRun(_ req: URLRequest) async throws -> SheetJSON {
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(req) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode == 409,
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? SheetJSON,
           obj["code"] as? String == "SHEET_STRUCTURE_CHANGED" {
            throw SheetAPIError.structureChanged(obj["current"] as? SheetJSON ?? [:])
        }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        if data.isEmpty { return [:] }
        return ((try? JSONSerialization.jsonObject(with: data)) as? SheetJSON) ?? [:]
    }

    // MARK: tabs

    func projectSheets(_ projectId: String) async throws -> [SheetTabInfo] {
        let o = try await sheetRun(try sheetRequest("/api/projects/\(Self.sheetEnc(projectId))/sheets"))
        return ((o["sheets"] as? [SheetJSON]) ?? []).compactMap(SheetTabInfo.init)
    }

    /// A new blank sheet, or a copy of `duplicateOf`. Returns the new sheet's id.
    func createSheet(_ projectId: String, name: String?, duplicateOf: String? = nil) async throws -> String? {
        var body: SheetJSON = [:]
        if let name { body["name"] = name }
        if let duplicateOf { body["duplicateOf"] = duplicateOf }
        let o = try await sheetRun(try sheetRequest("/api/projects/\(Self.sheetEnc(projectId))/sheets", method: "POST", body: body))
        return o["id"] as? String
    }

    func deleteSheet(_ sheetId: String) async throws {
        _ = try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))", method: "DELETE"))
    }

    // MARK: one sheet

    /// The whole sheet: { id, name, columns, settings, rows: [{ id, position, cells, styles?, height, updatedAt }], canEdit, canManage }.
    func loadSheet(_ sheetId: String) async throws -> SheetJSON {
        try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))"))
    }

    /// Name, columns (the full list; a column without id is new) or settings (merged; null removes a key).
    @discardableResult
    func patchSheet(_ sheetId: String, body: SheetJSON, structureVersion: Int? = nil) async throws -> SheetJSON {
        var patch = body
        if body["columns"] != nil {
            guard let structureVersion else { throw APIError.transport(T("Reload the sheet before changing its columns.")) }
            patch["structureVersion"] = structureVersion
        }
        return try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))", method: "PATCH", body: patch))
    }

    /// Values and/or formats; answers the rows as the server now has them.
    @discardableResult
    func patchSheetCells(_ sheetId: String, edits: [SheetCellEdit], styles: [SheetCellEdit] = []) async throws -> SheetJSON {
        var body: SheetJSON = [:]
        if !edits.isEmpty { body["edits"] = edits.map(\.json) }
        if !styles.isEmpty { body["styles"] = styles.map(\.json) }
        return try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))/cells", method: "PATCH", body: body))
    }

    /// New rows after `afterRowId` (nil = at the end), optionally filled. Answers the created rows.
    func addSheetRows(_ sheetId: String, count: Int, afterRowId: String?, beforeRowId: String? = nil,
                      rows: [[String: Any]]? = nil) async throws -> [SheetJSON] {
        var body: SheetJSON = ["count": count]
        if let afterRowId { body["afterRowId"] = afterRowId }
        if let beforeRowId, afterRowId == nil { body["beforeRowId"] = beforeRowId }
        if let rows { body["rows"] = rows }
        let o = try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))/rows", method: "POST", body: body))
        return (o["rows"] as? [SheetJSON]) ?? []
    }

    func deleteSheetRows(_ sheetId: String, rowIds: [String]) async throws {
        _ = try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))/rows", method: "DELETE", body: ["rowIds": rowIds]))
    }

    /// Row heights (layout only, no revision): [(rowId, height or nil = back to the default)].
    func resizeSheetRows(_ sheetId: String, heights: [(String, Int?)]) async throws {
        let list: [[String: Any]] = heights.map { ["rowId": $0.0, "height": $0.1.map { $0 as Any } ?? NSNull()] }
        _ = try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))/rows", method: "PATCH", body: ["heights": list]))
    }

    func deleteSheetColumn(_ sheetId: String, columnId: String) async throws {
        _ = try await sheetRun(try sheetRequest("/api/sheets/\(Self.sheetEnc(sheetId))/columns/\(Self.sheetEnc(columnId))", method: "DELETE"))
    }
}
