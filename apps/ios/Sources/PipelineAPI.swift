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
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }

    /// Deals with their server-computed health and phases, the KPI summary, and every option list.
    func pipeline(projectId: String, year: Int? = nil) async throws -> PipelineResponse {
        let suffix = year.map { "?year=\($0)" } ?? ""
        return try await pipelineRun(makeRequest(pipelineBase(projectId) + suffix), as: PipelineResponse.self)
    }

    /// Call only for a BOD/ONE_ABOVE_ALL workspace role; a 403 hides both entry points.
    func pipelineBoards(workspaceId: String? = nil) async throws -> PipelineBoardsResponse {
        let path = Self.pipelineQuery("/api/pipelines/boards", workspaceId: workspaceId)
        return try await pipelineRun(makeRequest(path), as: PipelineBoardsResponse.self)
    }

    /// Source and year are view filters. The server summary follows them, before the usual UI filters.
    func pipelineAll(workspaceId: String? = nil, source: String? = nil, year: Int? = nil) async throws -> PipelineAllResponse {
        let path = Self.pipelineQuery("/api/pipelines/all", workspaceId: workspaceId, source: source, year: year)
        return try await pipelineRun(makeRequest(path), as: PipelineAllResponse.self)
    }

    private static func pipelineQuery(_ path: String, lang: String? = nil, workspaceId: String? = nil,
                                      source: String? = nil, year: Int? = nil) -> String {
        var parts: [String] = []
        if let lang { parts.append("lang=\(pipelineEnc(lang))") }
        if let workspaceId { parts.append("workspaceId=\(pipelineEnc(workspaceId))") }
        if let source { parts.append("source=\(pipelineEnc(source))") }
        if let year { parts.append("year=\(year)") }
        return path + (parts.isEmpty ? "" : "?" + parts.joined(separator: "&"))
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

    // MARK: Cashback, project contacts and budget categories

    /// Generate clientRequestId once when the user taps Add, then reuse it if that request is retried.
    /// All successful item operations return the entire deal; replace the cached deal with it.
    func pipelineAddItem(projectId: String, dealId: String, kind: String, fields: [String: Any] = [:],
                         clientRequestId: String) async throws -> PipelineItemResponse {
        var req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/items", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body = fields
        body["kind"] = kind
        body["clientRequestId"] = clientRequestId
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await pipelineRun(req, as: PipelineItemResponse.self)
    }

    /// Send only the changed fields, keeping concurrent changes to other fields/items intact.
    func pipelineUpdateItem(projectId: String, dealId: String, itemId: String,
                            fields: [String: Any]) async throws -> PipelineItemResponse {
        var req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/items/\(Self.pipelineEnc(itemId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await pipelineRun(req, as: PipelineItemResponse.self)
    }

    /// Restorable from Control Room → Audit. A missing item stays a server 404.
    func pipelineDeleteItem(projectId: String, dealId: String, itemId: String) async throws -> PipelineItemResponse {
        let req = makeRequest("\(pipelineBase(projectId))/\(Self.pipelineEnc(dealId))/items/\(Self.pipelineEnc(itemId))", method: "DELETE")
        return try await pipelineRun(req, as: PipelineItemResponse.self)
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
    func pipelineExport(projectId: String, lang: String, year: Int? = nil) async throws -> URL {
        let path = Self.pipelineQuery("\(pipelineBase(projectId))/export", lang: lang, year: year)
        return try await pipelineDownload(makeRequest(path))
    }

    func pipelineAllExport(lang: String, workspaceId: String? = nil, source: String? = nil, year: Int? = nil) async throws -> URL {
        let path = Self.pipelineQuery("/api/pipelines/all/export", lang: lang, workspaceId: workspaceId, source: source, year: year)
        return try await pipelineDownload(makeRequest(path))
    }

    private func pipelineDownload(_ req: URLRequest) async throws -> URL {
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

    /// New project → Pipeline Dashboard: a new, empty board each time (owner, 11 Oct 2026 — there is no
    /// longer one board for the whole company). A refusal (e.g. outside the company workspace) comes back
    /// as the server's own sentence.
    func pipelineBoardCreate(workspaceId: String, name: String, memberIds: [String] = [], memberLevel: ProjectAccessLevel = .edit) async throws -> ProjectRef {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["name": name, "workspaceId": workspaceId, "type": "PIPELINE"]
        if !memberIds.isEmpty { body["memberIds"] = memberIds; body["memberAccessLevel"] = memberLevel.rawValue }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let made = try await pipelineRun(req, as: OutletCreatedProject.self)
        return ProjectRef(id: made.id, name: made.name ?? name, icon: nil)
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
