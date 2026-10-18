import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Social Media Report endpoints (owner, 14 Oct 2026): /api/projects/:id/social-media/**.
//
// Access is the project's: View and Comment read, Edit records days (403 NEEDS_EDIT_ACCESS otherwise),
// Full sets targets and platforms (403 SETTINGS_FORBIDDEN). The month answer says `canRecord` and
// `canManage`. Writes go straight through, no offline queue, and carry only the keys that changed, so two
// people filling different platforms of the same day never undo each other.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    private func socialBase(_ projectId: String) -> String {
        "/api/projects/\(Self.socialEnc(projectId))/social-media"
    }

    private static func socialEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }

    /// One month: platforms, every day with its targets in force, the targets, and the Overview to date.
    func socialMonth(projectId: String, month: String?) async throws -> SocialMonthResponse {
        var path = socialBase(projectId)
        if let month, !month.isEmpty { path += "?month=\(Self.socialEnc(month))" }
        return try await socialRun(makeRequest(path), as: SocialMonthResponse.self)
    }

    /// PUT one day: `platforms` { id: { metric: number | NSNull } } and/or `worked` / `didntWork`. Only
    /// what changed. 400 FUTURE_DATE for a day that hasn't come, CONFIG_CHANGED for a platform gone meanwhile.
    func socialSaveDay(projectId: String, date: String, body: [String: Any]) async throws {
        try await socialPut("\(socialBase(projectId))/days/\(Self.socialEnc(date))", body: body)
    }

    /// PUT a month's targets per platform: { id: { engagementTarget, postsTarget } }, NSNull clears.
    func socialSaveTargets(projectId: String, month: String, platforms: [String: Any]) async throws {
        try await socialPut("\(socialBase(projectId))/targets", body: ["month": month, "platforms": platforms])
    }

    /// PUT a date's own targets per platform; a cleared part falls back to the month's share.
    func socialSaveDayTargets(projectId: String, date: String, platforms: [String: Any]) async throws {
        try await socialPut("\(socialBase(projectId))/day-targets", body: ["date": date, "platforms": platforms])
    }

    /// The platforms with, per id, how many days and targets hold something (asked before archiving).
    func socialConfig(projectId: String) async throws -> SocialConfigResponse {
        try await socialRun(makeRequest("\(socialBase(projectId))/config"), as: SocialConfigResponse.self)
    }

    /// PUT the whole list in order. A platform left out that holds anything comes back archived.
    func socialSaveConfig(projectId: String, config: SocialReportConfig) async throws -> SocialConfigResponse {
        var req = makeRequest("\(socialBase(projectId))/config", method: "PUT")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        struct Body: Encodable { let config: SocialReportConfig }
        req.httpBody = try JSONEncoder().encode(Body(config: config))
        return try await socialRun(req, as: SocialConfigResponse.self)
    }

    /// New project → Social Media Report: an ordinary project of type SOCIAL_MEDIA_REPORT (the creator is
    /// its owner). Answers the new project, so the sheet can open it.
    func socialProjectCreate(workspaceId: String, name: String, folderId: String?, memberIds: [String] = [], memberLevel: ProjectAccessLevel = .edit) async throws -> ProjectRef {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["name": name, "workspaceId": workspaceId, "type": "SOCIAL_MEDIA_REPORT"]
        if let folderId { body["folderId"] = folderId }
        if !memberIds.isEmpty { body["memberIds"] = memberIds; body["memberAccessLevel"] = memberLevel.rawValue }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let made = try await socialRun(req, as: OutletCreatedProject.self)
        return ProjectRef(id: made.id, name: made.name ?? name, icon: nil)
    }

    private struct SocialAck: Decodable {}

    private func socialPut(_ path: String, body: [String: Any]) async throws {
        var req = makeRequest(path, method: "PUT")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await socialRun(req, as: SocialAck.self)
    }

    /// `outletRun`'s twin: nothing answered → `nothingAnswered`, 401 → `unauthorized`, any other refusal →
    /// the server's own sentence.
    private func socialRun<Payload: Decodable>(_ req: URLRequest, as type: Payload.Type) async throws -> Payload {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        do {
            return try JSONDecoder().decode(Payload.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
