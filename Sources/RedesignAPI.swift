import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints the dev redesign added or reshaped (owner, 12 Oct 2026). In their own file like PipelineAPI:
// status options (= sections), batch move, My Submissions replies/delete. Every one is additive on the
// server, and the released apps never call them.
// ─────────────────────────────────────────────────────────────────────────────

/// A section / status option as the sections endpoint answers it.
struct SectionInfo: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let position: Int?
    let taskStatus: String?
    let color: String?
}

/// POST /api/tasks/batch-move — which tasks moved, and why the others did not (HTTP 200 either way).
struct BatchMoveResult: Decodable, Sendable {
    let moved: [String]?
    let failed: [Failure]?
    struct Failure: Decodable, Sendable { let id: String; let error: String? }
}

extension APIClient {

    private static func redesignEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    private func redesignRun<Payload: Decodable>(_ req: URLRequest, as type: Payload.Type) async throws -> Payload {
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

    private func redesignJSON(_ path: String, method: String, body: [String: Any]) throws -> URLRequest {
        var req = makeRequest(path, method: method)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return req
    }

    private struct Whatever: Decodable {}

    // MARK: status options (sections)

    /// A new status option = a new board column. `taskStatus` is the enum it stands for (its group).
    func createStatusOption(projectId: String, name: String, taskStatus: String, color: String? = nil) async throws -> SectionInfo {
        var body: [String: Any] = ["name": name, "taskStatus": taskStatus]
        if let color { body["color"] = StatusColor.serverKey(color) }
        let req = try redesignJSON("/api/projects/\(Self.redesignEnc(projectId))/sections", method: "POST", body: body)
        return try await redesignRun(req, as: SectionInfo.self)
    }

    /// Rename, recolour, move (position) or regroup (taskStatus) one option. Only the keys passed change.
    func updateStatusOption(projectId: String, id: String, name: String? = nil, position: Int? = nil,
                            taskStatus: String? = nil, color: String? = nil) async throws {
        var body: [String: Any] = ["id": id]
        if let name { body["name"] = name }
        if let position { body["position"] = position }
        if let taskStatus { body["taskStatus"] = taskStatus }
        if let color { body["color"] = StatusColor.serverKey(color) }
        let req = try redesignJSON("/api/projects/\(Self.redesignEnc(projectId))/sections", method: "PATCH", body: body)
        _ = try await redesignRun(req, as: Whatever.self)
    }

    /// Deletes an option; its tasks move to `moveTo` first (restorable from Audit, like every delete).
    func deleteStatusOption(projectId: String, id: String, moveTo: String?) async throws {
        var body: [String: Any] = ["id": id]
        if let moveTo { body["moveTo"] = moveTo }
        let req = try redesignJSON("/api/projects/\(Self.redesignEnc(projectId))/sections", method: "DELETE", body: body)
        _ = try await redesignRun(req, as: Whatever.self)
    }

    // MARK: batch move

    /// Moves several tasks at once (multi-select drag, undo). The server runs the same rules as a single
    /// PATCH for each task — status of the column, Done wins, automations — and announces each one live.
    func batchMoveTasks(_ taskIds: [String], taskListId: String? = nil, status: String? = nil, priority: String? = nil) async throws -> BatchMoveResult {
        var body: [String: Any] = ["taskIds": Array(taskIds.prefix(200))]
        if let taskListId { body["taskListId"] = taskListId }
        if let status { body["status"] = status }
        if let priority { body["priority"] = priority }
        let req = try redesignJSON("/api/tasks/batch-move", method: "POST", body: body)
        return try await redesignRun(req, as: BatchMoveResult.self)
    }

    // MARK: My Submissions

    /// A reply to the team that handles a submission (a comment on the task it created).
    func replyToSubmission(_ submissionId: String, content: String) async throws {
        let req = try redesignJSON("/api/forms/my-submissions/\(Self.redesignEnc(submissionId))/comments", method: "POST", body: ["content": content])
        _ = try await redesignRun(req, as: Whatever.self)
    }

    /// Deletes a submission and the task it created in the project.
    func deleteSubmission(_ submissionId: String) async throws {
        _ = try await redesignRun(makeRequest("/api/forms/my-submissions/\(Self.redesignEnc(submissionId))", method: "DELETE"), as: Whatever.self)
    }
}

extension APIClient {
    /// The project's status options (sections), light: no tasks. MEMBER and up; a viewer gets 403 and the
    /// caller falls back to the project payload.
    func statusOptions(projectId: String) async throws -> [SectionInfo] {
        let path = "/api/projects/\(projectId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? projectId)/sections"
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(makeRequest(path)) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        do { return try JSONDecoder().decode([SectionInfo].self, from: data) } catch { throw APIError.decoding }
    }
}
