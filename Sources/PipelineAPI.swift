import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Dashboard endpoints (owner, 9 Oct 2026): /api/projects/:id/pipeline/**.
//
// In their own file like CalendarAPI.swift. Access is the board's (checkProjectAccess): whoever may read
// a deal may also write it, so there is no separate edit gate here. Writes go straight through (no
// offline queue): an edit to a shared board replayed minutes later could overwrite a colleague's.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    private func pipelineBase(_ projectId: String) -> String {
        "/api/projects/\(Self.pipelineEnc(projectId))/pipeline"
    }

    private static func pipelineEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    /// Deals with their server-computed health and phases, the KPI summary, and every option list.
    func pipeline(projectId: String) async throws -> PipelineResponse {
        try await pipelineRun(makeRequest(pipelineBase(projectId)), as: PipelineResponse.self)
    }

    /// One deal and its edit history (newest first, at most 200).
    func pipelineDeal(projectId: String, dealId: String) async throws -> PipelineDealDetail {
        try await pipelineRun(makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))"), as: PipelineDealDetail.self)
    }

    /// POST: any editable field; the server fills the GM's defaults for the rest. Answers the new deal.
    func pipelineCreate(projectId: String, fields: [String: Any]) async throws -> PipelineDeal {
        var req = makeRequest(pipelineBase(projectId), method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await pipelineRun(req, as: PipelineDeal.self)
    }

    /// PATCH: only the fields sent change, and each one is written to the deal's history.
    func pipelineUpdate(projectId: String, dealId: String, fields: [String: Any]) async throws -> PipelineDeal {
        var req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await pipelineRun(req, as: PipelineDeal.self)
    }

    /// DELETE: restorable from Control Room → Audit ("pipeline_deal"), with its history.
    func pipelineDelete(projectId: String, dealId: String) async throws {
        let req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))", method: "DELETE")
        _ = try await pipelineRun(req, as: SuccessResponse.self)
    }

    /// The .xlsx "Master Project" sheet (the GM's columns), saved to a temporary file named as the server
    /// names it. The caller hands the file to the share sheet.
    func pipelineExport(projectId: String, lang: String) async throws -> URL {
        let req = makeRequest("\(pipelineBase(projectId))/export?lang=\(lang)")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pipeline-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let raw = dir.appendingPathComponent("download")
        let response: URLResponse
        do {
            response = try await download(req, to: raw)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            // What landed in the file is the refusal, not the workbook.
            let data = (try? Data(contentsOf: raw)) ?? Data()
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        var name = response.suggestedFilename ?? "pipeline.xlsx"
        if !name.lowercased().hasSuffix(".xlsx") { name += ".xlsx" }
        let dest = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: raw, to: dest)
        return dest
    }

    /// The members of the project's workspace — the people the BD and PM pickers offer (the server
    /// refuses anyone else). Asked for by workspace, as the web does, because the project's workspace
    /// need not be the one this person has open.
    func pipelinePeople(workspaceId: String) async throws -> [WorkspaceRoster.Member] {
        let path = "/api/workspaces/members?workspaceId=\(Self.pipelineEnc(workspaceId))"
        return try await pipelineRun(makeRequest(path), as: WorkspaceRoster.self).members ?? []
    }

    /// `calRun` without the cache: nothing answered → `nothingAnswered`, 401 → `unauthorized`, any other
    /// refusal → the server's own sentence (an INVALID_FIELD answer names what was wrong).
    private func pipelineRun<Payload: Decodable>(_ req: URLRequest, as type: Payload.Type) async throws -> Payload {
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
