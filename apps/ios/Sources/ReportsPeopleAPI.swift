import Foundation

// The two "Reports per crew" endpoints, as an extension in their own file (the FormFillAPI.swift
// arrangement) so APIClient.swift itself is not touched for them.

extension APIClient {
    /// One person's report. `userId` is an id or "me"; `period` is an attendance period key
    /// ("YYYY-MM"), or nil for the current period — sent as NO parameter, so the server alone
    /// decides which period is current (its clock and its 28→27 cut-off, not the phone's).
    func personReport(userId: String, period: String?) async throws -> PersonReport {
        var path = "/api/reports/people/\(Self.reportPathSafe(userId))"
        if let period { path += "?period=\(Self.reportQuerySafe(period))" }
        return try await runReport(path, as: PersonReport.self,
                                   cache: PersonReport.cacheKey(userId: userId, period: period))
    }

    /// The people the caller may see (direct reports for a manager, everyone for BoD/admin).
    /// A staff member gets `ReportAccessError.selfOnly` — that is the answer, not a fault.
    func reportRoster(period: String?, teamId: String? = nil) async throws -> ReportRoster {
        var query: [String] = []
        if let period { query.append("period=\(Self.reportQuerySafe(period))") }
        if let teamId { query.append("teamId=\(Self.reportQuerySafe(teamId))") }
        let path = "/api/reports/people" + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))
        return try await runReport(path, as: ReportRoster.self,
                                   cache: ReportRoster.cacheKey(period: period, teamId: teamId))
    }

    /// `run`'s journey plus one thing it cannot do: read the `code` of a 403. `run` keeps only the
    /// sentence, and here the code decides what the screen does (SELF_ONLY hides the team tab).
    /// Everything else — nothing answered, 401, other statuses, cache only what decoded — is
    /// deliberately the same as `run`, so this screen fails and falls back like every other one.
    private func runReport<Payload: Decodable>(_ path: String, as type: Payload.Type,
                                               cache key: String) async throws -> Payload {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(makeRequest(path))
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode == 403, let refusal = ReportAccessError(body: data) { throw refusal }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        do {
            let value = try JSONDecoder().decode(Payload.self, from: data)
            ResponseCache.save(key, data)
            return value
        } catch {
            throw APIError.decoding
        }
    }

    /// A user id goes into the PATH, where "/" and "?" would change the route.
    private static func reportPathSafe(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? s
    }

    private static func reportQuerySafe(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+#"))) ?? s
    }
}
