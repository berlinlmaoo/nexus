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

    // MARK: Payment terms (owner, 9 Oct 2026: "perlu per termin")

    /// POST …/terms: label, amount, dueDate, invoiceNo, invoiceDate, paidAmount, paidAt, note — any of
    /// them; a blank label becomes "Termin n". Answers the whole deal, whose receivable and health changed.
    func pipelineAddTerm(projectId: String, dealId: String, fields: [String: Any]) async throws -> PipelineTermResponse {
        var req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/terms", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await pipelineRun(req, as: PipelineTermResponse.self)
    }

    /// PATCH one term: only the fields sent change, each one a line in the deal's History. "Mark paid"
    /// is paidAmount + paidAt.
    func pipelineUpdateTerm(projectId: String, dealId: String, termId: String, fields: [String: Any]) async throws -> PipelineTermResponse {
        var req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/terms/\(Self.pipelineEnc(termId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await pipelineRun(req, as: PipelineTermResponse.self)
    }

    /// DELETE one term — restorable from Control Room → Audit ("pipeline_term").
    func pipelineDeleteTerm(projectId: String, dealId: String, termId: String) async throws -> PipelineTermResponse {
        let req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/terms/\(Self.pipelineEnc(termId))", method: "DELETE")
        return try await pipelineRun(req, as: PipelineTermResponse.self)
    }

    // MARK: Documents (owner, 9 Oct 2026: "kenapa ga attach documentnya jg?")

    /// Attach a file to a deal's "Documents & links": the shared chunk route with target=pipeline, for
    /// any size up to its 1 GB ceiling (one chunk for a small file). The server adds the entry itself
    /// (type + optional name), so a file is never half attached; the caller reloads the board.
    func pipelineUploadDocument(projectId: String, dealId: String, file: URL, fileName: String,
                                type: String, label: String, progress: UploadProgress?) async throws {
        let size = Self.fileSize(of: file)
        guard size > 0 else { throw APIError.transport(T("Couldn't read that file.")) }
        var query = "&target=pipeline&projectId=\(encValue(projectId))&dealId=\(encValue(dealId))&docType=\(encValue(type))"
        if !label.isEmpty { query += "&label=\(encValue(label))" }
        try await uploadInChunks(file: file, fileName: fileName, size: size, extraQuery: query, progress: progress)
    }

    /// Take a document (a link or a file) off the deal. The file stays on the server until the 90-day
    /// purge; the deal's History keeps a line. Answers the deal.
    func pipelineRemoveDocument(projectId: String, dealId: String, docId: String) async throws -> PipelineDocumentResponse {
        let req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/documents/\(Self.pipelineEnc(docId))", method: "DELETE")
        return try await pipelineRun(req, as: PipelineDocumentResponse.self)
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

    /// "Create execution project" on a won deal (owner/GM, 9 Oct 2026). A stage move into Won makes it on
    /// the server by itself; this is for a deal that has none (the GM's imported deals came in already
    /// won). Idempotent: a deal that has one gets that one back.
    func pipelineCreateExecution(projectId: String, dealId: String) async throws -> PipelineExecutionResponse {
        let req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/execution", method: "POST")
        return try await pipelineRun(req, as: PipelineExecutionResponse.self)
    }

    /// What New project → Pipeline Dashboard ended in. The company has ONE board (owner/GM, 9 Oct 2026:
    /// "cuma satu papan/pipeline utama buat semua deal, lintas BD dan brand"), so a second create answers
    /// 409 PIPELINE_EXISTS with the board's id, and the sheet opens that board instead of showing an error.
    /// Since the board became an ordinary members-only project (owner, 9 Oct 2026, evening) the id comes
    /// only to someone who may open it; anyone else gets the server's sentence ("ask its lead to add
    /// you"), thrown below as the error the sheet shows.
    enum PipelineBoardCreate { case created, exists(ProjectRef) }

    func pipelineBoardCreate(workspaceId: String, name: String) async throws -> PipelineBoardCreate {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "workspaceId": workspaceId, "type": "PIPELINE"])
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode == 409,
           let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           body["code"] as? String == "PIPELINE_EXISTS",
           let id = body["projectId"] as? String, !id.isEmpty {
            return .exists(ProjectRef(id: id, name: (body["projectName"] as? String) ?? T("Pipeline"), icon: nil))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        return .created
    }

    /// The project's members — the people the BD and PM pickers offer (owner, 9 Oct 2026: BD/PM are
    /// picked per deal from the people added to the board; someone else goes in by name). Read fresh,
    /// not from the board cache, so a person the lead just added is offered at once.
    func pipelinePeople(projectId: String) async throws -> [ProjectDetail.ProjectMember] {
        try await pipelineRun(makeRequest("/api/projects/\(Self.pipelineEnc(projectId))"), as: ProjectDetail.self).members ?? []
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
