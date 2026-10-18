import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Calendar endpoints (/api/calendar/**), the master calendar that replaced Team Calendar in 0.1.7.
//
// In their own file for the same reason OrgChartAPI.swift is. Every answer is cached per user (a
// masked row differs from one viewer to the next) so the screen can show its last copy offline, the
// way Reports does. The rules that turn these answers into dots and lists are in
// Shared/CalendarCore.swift.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    func calendarStructure(userId: String) async throws -> CalStructure {
        try await calRun("/api/calendar/structure", as: CalStructure.self, cache: Self.calStructureKey(userId))
    }

    /// Every task the caller may see due on the WIB days `from`…`to` (inclusive, at most 62 days).
    func calendarItems(from: String, to: String, userId: String, folder: String? = nil) async throws -> CalItemsResponse {
        try await calRun("/api/calendar/items?from=\(from)&to=\(to)" + Self.calFolderQuery(folder, first: false), as: CalItemsResponse.self,
                         cache: Self.calItemsKey(userId, from: from, to: to, folder: folder))
    }

    /// Open tasks due before today (newest first) — the overdue rail.
    func calendarOverdue(userId: String, folder: String? = nil) async throws -> CalOverdueResponse {
        try await calRun("/api/calendar/overdue" + Self.calFolderQuery(folder, first: true), as: CalOverdueResponse.self, cache: Self.calOverdueKey(userId, folder: folder))
    }

    /// How a task that is not in what is loaded may be opened (masked / editable / read-only).
    func calendarTask(id: String) async throws -> CalTaskAccess {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        return try await calRun("/api/calendar/task?id=\(safe)", as: CalTaskAccess.self, cache: nil)
    }

    /// The task itself, read-only, for a calendar viewer outside its project (`&detail=1`, web 80a286c,
    /// 13 Oct 2026). The task routes stay members-only; this answers no file URL. Not cached.
    func calendarTaskDetail(id: String) async throws -> CalTaskDetailResponse {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        return try await calRun("/api/calendar/task?id=\(safe)&detail=1", as: CalTaskDetailResponse.self, cache: nil)
    }

    /// One scope's widget snapshot (CalendarWidgetPresence saves it into the App Group). Not cached
    /// here: the App Group copy is the offline copy.
    func calendarGlance(scope: GlanceScope) async throws -> GlanceSnapshot {
        try await calRun("/api/calendar/glance?scope=\(scope.rawValue)", as: GlanceSnapshot.self, cache: nil)
    }

    static func calStructureKey(_ userId: String) -> String { "cal-structure-\(userId)" }
    private static func calFolderQuery(_ folder: String?, first: Bool) -> String {
        guard let folder, !folder.isEmpty else { return "" }
        return (first ? "?folder=" : "&folder=") + (folder.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
    }
    static func calOverdueKey(_ userId: String, folder: String? = nil) -> String { "cal-overdue-\(userId)" + calFolderQuery(folder, first: true) }
    static func calItemsKey(_ userId: String, from: String, to: String, folder: String? = nil) -> String { "cal-items-\(userId)-\(from)-\(to)" + calFolderQuery(folder, first: true) }

    /// `runReport` without the 403 code: nothing answered → `nothingAnswered`, 401 → `unauthorized`,
    /// other statuses → the server's sentence, and only a clean decode is cached.
    private func calRun<Payload: Decodable>(_ path: String, as type: Payload.Type, cache key: String?) async throws -> Payload {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(makeRequest(path))
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        do {
            let value = try JSONDecoder().decode(Payload.self, from: data)
            if let key { ResponseCache.save(key, data) }
            return value
        } catch {
            throw APIError.decoding
        }
    }
}
