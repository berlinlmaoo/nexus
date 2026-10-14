import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Legal endpoints (owner, 14 Oct 2026): /api/legal/**. Contract: docs/legal-api.md.
//
// Every route answers 403 {code: LEGAL_NOT_INVITED} to someone without Legal; settings writes also refuse
// unless invitePower is ANY or STAFF. A refusal comes back as `LegalAPIError`, which carries the server's
// sentence AND, for a 422, `fieldErrors` (by field name, "ROWS.0.CELL" for a table cell) and `problems`
// (one line per problem in a template file), so a form can show them where they belong. Writes go
// straight through (no offline queue), like Pipeline: a numbered document must never be made twice.
// ─────────────────────────────────────────────────────────────────────────────

/// A Legal refusal: the status, the server's sentence, and the per-field details of a 422.
struct LegalAPIError: LocalizedError {
    let status: Int
    let message: String?
    let code: String?
    let fieldErrors: [String: String]
    let problems: [String]

    /// The same wording as every other refusal in the app (the server's sentence, or a calm fallback).
    var errorDescription: String? { APIError.http(status, message).errorDescription }
    /// Someone who was never invited (or was removed) asking for Legal.
    var notInvited: Bool { status == 403 && (code == "LEGAL_NOT_INVITED" || code == nil) }
    /// Someone else saved a version first.
    var conflict: Bool { status == 409 }
}

extension Error {
    /// The field errors of a Legal 422, empty for anything else.
    var legalFieldErrors: [String: String] { (self as? LegalAPIError)?.fieldErrors ?? [:] }
    /// The template problems of a Legal 422, empty for anything else.
    var legalProblems: [String] { (self as? LegalAPIError)?.problems ?? [] }
    /// The sentence to show for a failed Legal call.
    var legalMessage: String {
        (self as? LocalizedError)?.errorDescription ?? T("Something went wrong on our side. Try again in a moment.")
    }
}

/// The formats a document version can be fetched as.
enum LegalFileFormat: String { case docx, pdf, original }

/// The archive's filters (GET /api/legal/documents).
struct LegalArchiveQuery: Equatable {
    var q = ""
    var companyId: String?
    var docType: String?
    var status: String?
    var source: String?
    var projectId: String?
    var dealId: String?
    var from: String?
    var to: String?
    /// One chain: that document and its addenda.
    var parentId: String?
    /// "1" = only documents with their signed copy.
    var signed: String?
    var page = 1
    var limit = 50

    /// Any filter other than the search text.
    var filtered: Bool {
        [companyId, docType, status, source, projectId, dealId, from, to, parentId, signed].contains { !($0 ?? "").isEmpty }
    }
}

extension APIClient {

    private static func legalEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }
    private func legalDoc(_ id: String) -> String { "/api/legal/documents/\(Self.legalEnc(id))" }

    // MARK: Access & members

    func legalMe() async throws -> LegalMe {
        try await legalRun(makeRequest("/api/legal/me"), as: LegalMe.self)
    }

    func legalMembers() async throws -> LegalMembersResponse {
        try await legalRun(makeRequest("/api/legal/members"), as: LegalMembersResponse.self)
    }

    /// Only the people the viewer may invite.
    func legalInviteCandidates(q: String) async throws -> [LegalCandidate] {
        try await legalRun(makeRequest("/api/legal/members/candidates?q=\(encValue(q))"), as: LegalCandidatesResponse.self).candidates
    }

    func legalInvite(userId: String) async throws {
        _ = try await legalSend("/api/legal/members", method: "POST", body: ["userId": userId])
    }

    func legalRevoke(userId: String) async throws {
        _ = try await legalSend("/api/legal/members/\(Self.legalEnc(userId))", method: "DELETE", body: nil)
    }

    // MARK: Companies & numbering

    func legalCompanies() async throws -> [LegalCompany] {
        try await legalRun(makeRequest("/api/legal/companies"), as: LegalCompaniesResponse.self).companies
    }

    /// `{name?, legalName?, address?, code?, active?}`; `code` gets a 409 once numbers exist.
    func legalUpdateCompany(id: String, fields: [String: Any]) async throws -> LegalCompany {
        let data = try await legalSend("/api/legal/companies/\(Self.legalEnc(id))", method: "PATCH", body: fields)
        return try legalDecode(data, as: LegalCompanyResponse.self).company
    }

    /// The company's kop (.docx), saved to a temporary file.
    func legalDownloadKop(companyId: String) async throws -> URL {
        try await legalDownload("/api/legal/companies/\(Self.legalEnc(companyId))/kop", fallbackName: "kop.docx")
    }

    func legalUploadKop(companyId: String, file: URL) async throws -> LegalCompany {
        var form = LegalMultipart()
        try form.addFile(file)
        let data = try await legalSend(multipart: form, to: "/api/legal/companies/\(Self.legalEnc(companyId))/kop")
        return try legalDecode(data, as: LegalCompanyResponse.self).company
    }

    func legalAddSeries(companyId: String, docType: String, label: String, format: String, resetPeriod: String) async throws -> LegalSeries {
        let body: [String: Any] = ["docType": docType, "label": label, "format": format, "resetPeriod": resetPeriod]
        let data = try await legalSend("/api/legal/companies/\(Self.legalEnc(companyId))/series", method: "POST", body: body)
        return try legalDecode(data, as: LegalSeriesResponse.self).series
    }

    /// The series, how many numbers it issued, and today's next number.
    func legalSeries(id: String) async throws -> LegalSeriesInfo {
        try await legalRun(makeRequest("/api/legal/series/\(Self.legalEnc(id))"), as: LegalSeriesInfo.self)
    }

    /// `{label?, format?, resetPeriod?, active?}`.
    func legalUpdateSeries(id: String, fields: [String: Any]) async throws -> LegalSeries {
        let data = try await legalSend("/api/legal/series/\(Self.legalEnc(id))", method: "PATCH", body: fields)
        return try legalDecode(data, as: LegalSeriesResponse.self).series
    }

    // MARK: Templates

    func legalTemplates(archived: Bool = false, docType: String? = nil, companyId: String? = nil) async throws -> [LegalTemplate] {
        var qs: [String] = []
        if archived { qs.append("archived=1") }
        if let docType, !docType.isEmpty { qs.append("docType=\(encValue(docType))") }
        if let companyId, !companyId.isEmpty { qs.append("companyId=\(encValue(companyId))") }
        let path = "/api/legal/templates" + (qs.isEmpty ? "" : "?" + qs.joined(separator: "&"))
        return try await legalRun(makeRequest(path), as: LegalTemplatesResponse.self).templates
    }

    func legalTemplate(id: String) async throws -> LegalTemplate {
        try await legalRun(makeRequest("/api/legal/templates/\(Self.legalEnc(id))"), as: LegalTemplateResponse.self).template
    }

    /// A new template from a .docx. A file the server can't read answers 422 with `problems`.
    func legalCreateTemplate(file: URL, name: String, docType: String, companyId: String?, seriesId: String?,
                             description: String) async throws -> LegalTemplate {
        var form = LegalMultipart()
        try form.addFile(file)
        form.add("name", name)
        form.add("docType", docType)
        if let companyId, !companyId.isEmpty { form.add("companyId", companyId) }
        if let seriesId, !seriesId.isEmpty { form.add("seriesId", seriesId) }
        if !description.isEmpty { form.add("description", description) }
        let data = try await legalSend(multipart: form, to: "/api/legal/templates")
        return try legalDecode(data, as: LegalTemplateResponse.self).template
    }

    /// `{name?, description?, docType?, companyId?, seriesId?, archived?, fields?}`. Pass `NSNull()` to
    /// clear the company or series; `fields` as `LegalField.jsonArray(_:)`.
    func legalUpdateTemplate(id: String, fields: [String: Any]) async throws -> LegalTemplate {
        let data = try await legalSend("/api/legal/templates/\(Self.legalEnc(id))", method: "PATCH", body: fields)
        return try legalDecode(data, as: LegalTemplateResponse.self).template
    }

    func legalAddTemplateVersion(id: String, file: URL, note: String) async throws -> LegalTemplate {
        var form = LegalMultipart()
        try form.addFile(file)
        if !note.isEmpty { form.add("note", note) }
        let data = try await legalSend(multipart: form, to: "/api/legal/templates/\(Self.legalEnc(id))/versions")
        return try legalDecode(data, as: LegalTemplateResponse.self).template
    }

    func legalDownloadTemplate(id: String, version: Int, fallbackName: String) async throws -> URL {
        try await legalDownload("/api/legal/templates/\(Self.legalEnc(id))/versions/\(version)/file", fallbackName: fallbackName)
    }

    // MARK: Documents

    func legalDocuments(_ q: LegalArchiveQuery) async throws -> LegalDocumentsPage {
        var qs: [String] = []
        func add(_ k: String, _ v: String?) { if let v, !v.isEmpty { qs.append("\(k)=\(encValue(v))") } }
        add("q", q.q.trimmingCharacters(in: .whitespacesAndNewlines))
        add("companyId", q.companyId); add("docType", q.docType); add("status", q.status); add("source", q.source)
        add("projectId", q.projectId); add("dealId", q.dealId); add("from", q.from); add("to", q.to)
        add("parentId", q.parentId); add("signed", q.signed)
        qs.append("page=\(q.page)"); qs.append("limit=\(q.limit)")
        return try await legalRun(makeRequest("/api/legal/documents?" + qs.joined(separator: "&")), as: LegalDocumentsPage.self)
    }

    /// The form for a template (and the number it would take). Re-called with the values the number
    /// format reads, plus TANGGAL_DOKUMEN, to refresh `numberPreview`.
    func legalPrepare(templateId: String, companyId: String?, values: [String: LegalValue]? = nil, parentDocumentId: String? = nil) async throws -> LegalPrepared {
        var body: [String: Any] = ["templateId": templateId]
        if let companyId { body["companyId"] = companyId }
        if let parentDocumentId { body["parentDocumentId"] = parentDocumentId }
        if let values { body["values"] = LegalValue.json(values) }
        let data = try await legalSend("/api/legal/documents/prepare", method: "POST", body: body)
        return try legalDecode(data, as: LegalPrepared.self)
    }

    /// Generate: takes the number. A 422 carries `fieldErrors` / `problems`.
    func legalGenerate(templateId: String, companyId: String?, values: [String: LegalValue], title: String,
                       counterparty: String, projectId: String?, dealId: String?, parentDocumentId: String? = nil) async throws -> LegalGenerated {
        var body: [String: Any] = ["templateId": templateId, "values": LegalValue.json(values)]
        if let companyId { body["companyId"] = companyId }
        if let parentDocumentId { body["parentDocumentId"] = parentDocumentId }
        if !title.isEmpty { body["title"] = title }
        if !counterparty.isEmpty { body["counterparty"] = counterparty }
        body["projectId"] = projectId ?? NSNull()
        body["dealId"] = dealId ?? NSNull()
        let data = try await legalSend("/api/legal/documents", method: "POST", body: body, timeout: 120)
        return try legalDecode(data, as: LegalGenerated.self)
    }

    /// A document made elsewhere (PDF / DOCX / JPG / PNG) into the archive. `fields`: companyId, docType,
    /// title, number, counterparty, docDate, status, projectId, dealId, notes (empty ones are left out).
    func legalUploadDocument(file: URL, fields: [String: String]) async throws -> LegalUploaded {
        var form = LegalMultipart()
        try form.addFile(file)
        for (k, v) in fields.sorted(by: { $0.key < $1.key }) where !v.isEmpty { form.add(k, v) }
        let data = try await legalSend(multipart: form, to: "/api/legal/documents/upload")
        return try legalDecode(data, as: LegalUploaded.self)
    }

    func legalDocument(id: String) async throws -> LegalDocument {
        try await legalRun(makeRequest(legalDoc(id)), as: LegalDocumentResponse.self).document
    }

    /// `{title?, counterparty?, status?, notes?, projectId?, dealId?, finalVersion?}` (+ `number?, docType?,
    /// docDate?` for an uploaded document). `NSNull()` clears a link.
    func legalUpdateDocument(id: String, fields: [String: Any]) async throws -> LegalDocument {
        let data = try await legalSend(legalDoc(id), method: "PATCH", body: fields)
        return try legalDecode(data, as: LegalDocumentResponse.self).document
    }

    /// Uploaded documents only: a numbered one answers 409 (set it to VOID instead).
    func legalDeleteDocument(id: String) async throws {
        _ = try await legalSend(legalDoc(id), method: "DELETE", body: nil)
    }

    /// One version's file, saved to a temporary file for the share sheet, Quick Look or PDFKit.
    /// `name`: what the file is called ("<number> - <title> REV 2.pdf" / "FINAL" / "SIGNED"), which the share
    /// sheet shows; without it the server's Content-Disposition name.
    func legalDownloadDocument(id: String, version: Int, format: LegalFileFormat, inline: Bool = false, name: String? = nil) async throws -> URL {
        let path = "\(legalDoc(id))/versions/\(version)/file?format=\(format.rawValue)" + (inline ? "&inline=1" : "")
        let fallback: String
        switch format {
        case .docx: fallback = "document-v\(version).docx"
        case .pdf: fallback = "document-v\(version).pdf"
        case .original: fallback = "document-v\(version)"
        }
        return try await legalDownload(path, fallbackName: fallback, preferredName: name)
    }

    /// Make (or retry) a version's PDF. 502 with the reason when the PDF service fails.
    func legalMakePdf(id: String, version: Int) async throws {
        _ = try await legalSend("\(legalDoc(id))/versions/\(version)/pdf", method: "POST", body: nil, timeout: 150)
    }

    /// The projects and Pipeline deals the viewer can open — what a document can belong to.
    func legalLinks(q: String) async throws -> LegalLinks {
        try await legalRun(makeRequest("/api/legal/links?q=\(encValue(q))"), as: LegalLinks.self)
    }

    // MARK: Review, versions, GIDEON

    /// A Word version's paragraphs (default the current version). 409 for a version that isn't Word.
    func legalParagraphs(id: String, version: Int? = nil) async throws -> LegalParagraphsResponse {
        let path = "\(legalDoc(id))/paragraphs" + (version.map { "?version=\($0)" } ?? "")
        return try await legalRun(makeRequest(path), as: LegalParagraphsResponse.self)
    }

    /// Paragraph edits as a new version. 409 when someone else saved first.
    func legalSaveEdits(id: String, baseVersion: Int, edits: [(index: Int, text: String)], note: String) async throws -> LegalVersionCreated {
        var body: [String: Any] = ["baseVersion": baseVersion, "edits": edits.map { ["index": $0.index, "text": $0.text] as [String: Any] }]
        if !note.isEmpty { body["note"] = note }
        let data = try await legalSend("\(legalDoc(id))/versions", method: "POST", body: body, timeout: 120)
        return try legalDecode(data, as: LegalVersionCreated.self)
    }

    /// A file as a new version (the signed scan, or the file edited in Word).
    func legalUploadVersion(id: String, baseVersion: Int, file: URL, note: String, status: String?) async throws -> LegalVersionCreated {
        var form = LegalMultipart()
        try form.addFile(file)
        form.add("baseVersion", String(baseVersion))
        if !note.isEmpty { form.add("note", note) }
        if let status { form.add("status", status) }
        let data = try await legalSend(multipart: form, to: "\(legalDoc(id))/versions")
        return try legalDecode(data, as: LegalVersionCreated.self)
    }

    func legalRestore(id: String, version: Int, baseVersion: Int) async throws -> LegalVersionCreated {
        let data = try await legalSend("\(legalDoc(id))/versions/\(version)/restore", method: "POST", body: ["baseVersion": baseVersion])
        return try legalDecode(data, as: LegalVersionCreated.self)
    }

    func legalCompare(id: String, a: Int, b: Int) async throws -> LegalCompareResponse {
        try await legalRun(makeRequest("\(legalDoc(id))/compare?a=\(a)&b=\(b)"), as: LegalCompareResponse.self)
    }

    /// GIDEON's proposals for the document, newest first.
    func legalProposals(id: String) async throws -> [LegalProposal] {
        try await legalRun(makeRequest("\(legalDoc(id))/gideon"), as: LegalProposalsResponse.self).proposals
    }

    /// Ask GIDEON for a precise edit, or answer its question (`replyTo` + `answer`, empty instruction).
    func legalAskGideon(id: String, baseVersion: Int, instruction: String, targets: [Int],
                        replyTo: String? = nil, answer: String? = nil) async throws -> LegalProposal {
        var body: [String: Any] = ["baseVersion": baseVersion, "instruction": instruction, "targets": targets]
        if let replyTo { body["replyTo"] = replyTo }
        if let answer { body["answer"] = answer }
        let data = try await legalSend("\(legalDoc(id))/gideon", method: "POST", body: body, timeout: 180)
        return try legalDecode(data, as: LegalProposalResponse.self).proposal
    }

    /// Approve (all, or the `indexes` ticked — nil or empty sends none, meaning all) or discard a proposal.
    func legalDecide(id: String, proposalId: String, approve: Bool, indexes: [Int]?) async throws -> LegalDecision {
        var body: [String: Any] = ["decision": approve ? "approve" : "discard"]
        // Omitted means all; an empty list is refused, so it is never sent.
        if approve, let indexes, !indexes.isEmpty { body["indexes"] = indexes }
        let data = try await legalSend("\(legalDoc(id))/proposals/\(Self.legalEnc(proposalId))", method: "POST", body: body, timeout: 120)
        return try legalDecode(data, as: LegalDecision.self)
    }

    // MARK: Plumbing

    /// JSON (or no body) out, the raw answer back. Refusals → `LegalAPIError`.
    private func legalSend(_ path: String, method: String, body: [String: Any]?, timeout: TimeInterval? = nil) async throws -> Data {
        var req = makeRequest(path, method: method)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if let timeout { req.timeoutInterval = timeout }
        return try await legalExchange(req)
    }

    private func legalSend(multipart form: LegalMultipart, to path: String) async throws -> Data {
        var req = makeRequest(path, method: "POST")
        let (body, contentType) = form.encoded()
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        req.timeoutInterval = 180
        return try await legalExchange(req)
    }

    private func legalRun<Payload: Decodable>(_ req: URLRequest, as type: Payload.Type) async throws -> Payload {
        try legalDecode(try await legalExchange(req), as: type)
    }

    private func legalDecode<Payload: Decodable>(_ data: Data, as type: Payload.Type) throws -> Payload {
        do { return try JSONDecoder().decode(Payload.self, from: data) } catch { throw APIError.decoding }
    }

    /// Nothing answered → `nothingAnswered`, 401 → `unauthorized`, any other refusal → `LegalAPIError`
    /// with the server's sentence, code, fieldErrors and problems.
    private func legalExchange(_ req: URLRequest) async throws -> Data {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw Self.legalRefusal(http.statusCode, data) }
        return data
    }

    private static func legalRefusal(_ status: Int, _ data: Data) -> LegalAPIError {
        let body = try? JSONDecoder().decode(LegalErrorBody.self, from: data)
        return LegalAPIError(status: status, message: serverMessage(data), code: body?.code,
                             fieldErrors: body?.fieldErrors ?? [:], problems: body?.problems ?? [])
    }

    /// GET a file to a temporary folder, named as the server names it.
    private func legalDownload(_ path: String, fallbackName: String, preferredName: String? = nil) async throws -> URL {
        var req = makeRequest(path)
        req.setValue("*/*", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 120
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("legal", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
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
            // What landed in the file is the refusal, not the document.
            let data = (try? Data(contentsOf: raw)) ?? Data()
            try? FileManager.default.removeItem(at: dir)
            throw Self.legalRefusal(http.statusCode, data)
        }
        var name = (preferredName ?? response.suggestedFilename ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == "download" { name = fallbackName }
        name = name.replacingOccurrences(of: "/", with: "-")
        let dest = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: raw, to: dest)
        return dest
    }
}

/// A small multipart/form-data body: text fields and files, each file with its own Content-Type.
private struct LegalMultipart {
    private enum Part {
        case field(String, String)
        case file(name: String, fileName: String, mime: String, data: Data)
    }
    private var parts: [Part] = []
    private let boundary = "Boundary-\(UUID().uuidString)"

    mutating func add(_ name: String, _ value: String) { parts.append(.field(name, value)) }

    mutating func addFile(_ url: URL, field: String = "file") throws {
        let data: Data
        do { data = try Data(contentsOf: url) } catch { throw APIError.transport(T("Couldn't read that file.")) }
        guard !data.isEmpty else { throw APIError.transport(T("Couldn't read that file.")) }
        let fileName = url.lastPathComponent
        parts.append(.file(name: field, fileName: fileName, mime: Self.mime(for: fileName), data: data))
    }

    /// The four kinds Legal takes, by extension; anything else goes as bytes.
    static func mime(for fileName: String) -> String {
        switch (fileName as NSString).pathExtension.lowercased() {
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "pdf": return "application/pdf"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        default: return "application/octet-stream"
        }
    }

    private static func quoted(_ s: String) -> String {
        s.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
    }

    func encoded() -> (Data, String) {
        var body = Data()
        func add(_ s: String) { body.append(Data(s.utf8)) }
        for part in parts {
            switch part {
            case .field(let name, let value):
                add("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(Self.quoted(name))\"\r\n\r\n")
                add(value)
                add("\r\n")
            case .file(let name, let fileName, let mime, let data):
                add("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(Self.quoted(name))\"; filename=\"\(Self.quoted(fileName))\"\r\nContent-Type: \(mime)\r\n\r\n")
                body.append(data)
                add("\r\n")
            }
        }
        add("--\(boundary)--\r\n")
        return (body, "multipart/form-data; boundary=\(boundary)")
    }
}
