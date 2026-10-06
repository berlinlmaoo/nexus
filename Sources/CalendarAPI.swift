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
    func calendarItems(from: String, to: String, userId: String) async throws -> CalItemsResponse {
        try await calRun("/api/calendar/items?from=\(from)&to=\(to)", as: CalItemsResponse.self,
                         cache: Self.calItemsKey(userId, from: from, to: to))
    }

    /// Open tasks due before today (newest first) — the overdue rail.
    func calendarOverdue(userId: String) async throws -> CalOverdueResponse {
        try await calRun("/api/calendar/overdue", as: CalOverdueResponse.self, cache: Self.calOverdueKey(userId))
    }

    /// How a task that is not in what is loaded may be opened (masked / editable / read-only).
    func calendarTask(id: String) async throws -> CalTaskAccess {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        return try await calRun("/api/calendar/task?id=\(safe)", as: CalTaskAccess.self, cache: nil)
    }

    static func calStructureKey(_ userId: String) -> String { "cal-structure-\(userId)" }
    static func calOverdueKey(_ userId: String) -> String { "cal-overdue-\(userId)" }
    static func calItemsKey(_ userId: String, from: String, to: String) -> String { "cal-items-\(userId)-\(from)-\(to)" }

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
