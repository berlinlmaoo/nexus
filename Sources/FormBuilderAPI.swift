import Foundation

/// A delete the server refused because the form still has submissions (HTTP 409). Deleting it
/// anyway takes every submission and its "My Submissions" history with it, so the person is asked
/// again — with the count — before `deleteForm(_:force: true)`.
enum FormBuilderError: LocalizedError {
    case hasSubmissions(count: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .hasSubmissions(_, let message): return message
        }
    }
}

/// The form builder's endpoints, called exactly as the web's nexus-api.ts calls them:
///
///     forms:      GET    /api/forms?projectId=
///     createForm: POST   /api/forms           { name, description, fields, isPublic, requireAuth, projectId, accessSchedule }
///     updateForm: PATCH  /api/forms/{id}      { name, description, fields, isPublic, requireAuth, accessSchedule }
///     deleteForm: DELETE /api/forms/{id}[?force=1]
///
/// In their own file, like FormFillAPI.swift, so the builder can be added or reverted without
/// touching the client everything else goes through. Same route selection and replay rules:
/// everything leaves through `perform`.
extension APIClient {

    /// Every form of one project, whole — fields, slug, schedule — which is what the builder edits.
    func builderForms(projectId: String) async throws -> [BuilderForm] {
        let data = try await formBuilderCall(makeRequest("/api/forms?projectId=\(encValue(projectId))"))
        return try Self.decodeBuilder([BuilderForm].self, from: data)
    }

    /// POST /api/forms → the new form (201), slug included.
    func createForm(_ body: [String: Any]) async throws -> BuilderForm {
        var req = makeRequest("/api/forms", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await formBuilderCall(req)
        return try Self.decodeBuilder(BuilderForm.self, from: data)
    }

    /// PATCH /api/forms/{id}. Any subset of the keys: the route only writes the ones present, so
    /// `["isPublic": false]` unpublishes and leaves everything else as it is.
    @discardableResult
    func updateForm(_ formId: String, _ body: [String: Any]) async throws -> BuilderForm {
        var req = makeRequest("/api/forms/\(formId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await formBuilderCall(req)
        return try Self.decodeBuilder(BuilderForm.self, from: data)
    }

    /// DELETE /api/forms/{id}. Without `force` the server refuses a form that has submissions
    /// (409, `{ error, submissionCount }`) — that refusal comes back as `FormBuilderError`.
    /// `expect` = the response count the person confirmed: if more arrived since, the server answers 409
    /// with the new count instead of deleting responses nobody saw (bughunt F-BUG-3).
    func deleteForm(_ formId: String, force: Bool, expect: Int? = nil) async throws {
        var path = "/api/forms/\(formId)" + (force ? "?force=1" : "")
        if force, let expect { path += "&expect=\(expect)" }
        let req = makeRequest(path, method: "DELETE")
        _ = try await formBuilderCall(req, deleting: true)
    }

    // MARK: - plumbing

    /// `run`'s rules, which are private to APIClient.swift: nothing answered → the calm sentence,
    /// 401 → signed out, any other refusal → the server's own words.
    private func formBuilderCall(_ req: URLRequest, deleting: Bool = false) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if deleting, http.statusCode == 409 {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let count = (obj?["submissionCount"] as? NSNumber)?.intValue ?? 0
            throw FormBuilderError.hasSubmissions(count: count, message: obj?["error"] as? String)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        return data
    }

    // `Value`, not `T`: inside a generic whose parameter is called T, `T("…")` stops meaning the
    // localisation function.
    private static func decodeBuilder<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
        do { return try JSONDecoder().decode(Value.self, from: data) }
        catch { throw APIError.decoding }
    }
}
