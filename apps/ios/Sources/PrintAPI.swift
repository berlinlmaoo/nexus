import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Print endpoints (owner, 18 Nov 2026): POST /api/print, GET /api/print/jobs/{id}, GET /api/print/jobs.
// A print goes straight through (no offline queue): replaying one later would print a paper nobody is
// standing at the printer for. Refusals come back as `PrintAPIError`, whose text maps the server's codes
// to the app's own wording (the server's sentences are English, except PRINT_NOT_CONFIGURED).
// ─────────────────────────────────────────────────────────────────────────────

/// A print refusal: the status, the server's code and its sentence.
struct PrintAPIError: LocalizedError {
    let status: Int
    let code: String?
    let message: String?

    var errorDescription: String? {
        // The server's fixed limits (PRINT_LIMITS); RemoteConfig is main-actor bound, an error is not.
        let maxPages = 50
        switch code {
        case "PRINT_NOT_CONFIGURED": return T("Printer isn't set up on this server")
        case "PDF_NOT_CONFIGURED": return T("This server can't turn files into PDF yet, so it can't print them.")
        case "TOO_MANY_PAGES":
            // "This file has 72 pages. One print can have at most 50 pages." / for chosen pages of an upload:
            // "These pages add up to 60. One print can have at most 50 pages."
            if let n = Self.number(in: message, after: "add up to ") {
                return String(format: T("These pages add up to %d. One print can have at most %d pages."), n, maxPages)
            }
            if let n = Self.number(in: message, after: "has ") {
                return String(format: T("This file has %d pages. One print can have at most %d pages."), n, maxPages)
            }
            return String(format: T("Too many pages: at most %d per print."), maxPages)
        // Uploaded files (Print screen).
        case "NO_FILE", "EMPTY": return T("Couldn't read that file.")
        case "NOT_A_MEMBER": return T("Printing is for members of the company workspace.")
        case "TOO_LARGE": return T("The file is larger than 25 MB")
        case "UNSUPPORTED_TYPE":
            if message?.localizedCaseInsensitiveContains("HEIC") == true { return T("HEIC photos can't be printed. Save the photo as JPG or PNG first.") }
            if message?.contains("doesn't match its name") == true { return T("The file doesn't match its name (it may be damaged or renamed).") }
            return T("This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG.")
        case "CONVERSION_FAILED": return T("This file couldn't be converted for printing. Try saving it as PDF first.")
        case "BAD_RANGE": return T("Write pages like 1-3,5")
        case "OUT_OF_RANGE":
            if let n = Self.number(in: message, after: "has ") { return String(format: T("This file has %d pages."), n) }
            return T("Write pages like 1-3,5")
        case "UPLOAD_GONE": return T("This upload has expired. Upload the file again.")
        case "PRINT_RATE_LIMIT": return T("You've printed 20 times this hour. Try again later.")
        case "NOT_PRINTABLE": return T("This version has no file that can be printed.")
        case "PAGES_UNKNOWN": return T("Couldn't count the pages of this file, so it wasn't printed.")
        case "BAD_COPIES": return String(format: T("Copies must be between 1 and %d."), 5)
        case "LEGAL_NOT_INVITED": return T("Legal is by invitation only")
        default: return APIError.http(status, message).errorDescription
        }
    }

    /// The whole number right after `marker` in the server's sentence ("has 72 pages" → 72).
    private static func number(in message: String?, after marker: String) -> Int? {
        guard let message, let r = message.range(of: marker) else { return nil }
        let digits = message[r.upperBound...].prefix { $0.isNumber }
        return Int(digits)
    }
}

extension APIClient {

    private static func printEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: legalSegment) ?? s
    }

    /// Sends a print. `version` (Legal only) omitted = the document's primary version (signed ?? final ?? current).
    /// `pageRanges` (uploads only): "1-3,5"; empty or nil = all pages.
    func submitPrint(kind: PrintKind, id: String, copies: Int, colorMode: PrintColorMode, version: Int? = nil,
                     pageRanges: String? = nil) async throws -> PrintJob {
        var body: [String: Any] = ["kind": kind.rawValue, "id": id, "copies": copies, "colorMode": colorMode.rawValue]
        if let version, kind == .legal { body["version"] = version }
        if kind == .upload, let ranges = pageRanges?.trimmingCharacters(in: .whitespaces), !ranges.isEmpty { body["pageRanges"] = ranges }
        var req = makeRequest("/api/print", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        // Making the PDF of a Word file or a page can take a while before the printer gets it.
        req.timeoutInterval = 120
        return try printDecode(try await printExchange(req), as: PrintJobResponse.self).job
    }

    /// One job; the server asks the printer for its state while it is still printing.
    func printJob(id: String) async throws -> PrintJob {
        try printDecode(try await printExchange(makeRequest("/api/print/jobs/\(Self.printEnc(id))")), as: PrintJobResponse.self).job
    }

    /// The print log: own prints; BoD / One Above All everyone's (`userId` narrows to one person).
    /// `from` / `to`: "YYYY-MM-DD" (WIB days, both inclusive).
    func printJobs(userId: String?, from: String?, to: String?, cursor: String?, limit: Int = 50) async throws -> PrintJobsPage {
        var qs = ["limit=\(limit)"]
        if let userId, !userId.isEmpty { qs.append("userId=\(encValue(userId))") }
        if let from, !from.isEmpty { qs.append("from=\(from)") }
        if let to, !to.isEmpty { qs.append("to=\(to)") }
        if let cursor, !cursor.isEmpty { qs.append("cursor=\(encValue(cursor))") }
        return try printDecode(try await printExchange(makeRequest("/api/print/jobs?" + qs.joined(separator: "&"))), as: PrintJobsPage.self)
    }

    // MARK: Uploaded files (Print screen)

    /// Uploads a file to print (multipart `file`). The server turns it into a PDF and counts its pages, which
    /// can take 5–30 s. The file is read here, inside its security scope when it came from the Files app.
    func uploadPrintFile(_ url: URL) async throws -> PrintUpload {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do { data = try Data(contentsOf: url) } catch { throw APIError.transport(T("Couldn't read that file.")) }
        guard !data.isEmpty else { throw APIError.transport(T("Couldn't read that file.")) }

        let boundary = "Boundary-\(UUID().uuidString)"
        let name = url.lastPathComponent.replacingOccurrences(of: "\"", with: "%22")
            .replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n".utf8))
        body.append(Data("Content-Type: \(Self.printMime(for: name))\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var req = makeRequest("/api/print/uploads", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        req.timeoutInterval = 180
        return try printDecode(try await printExchange(req), as: PrintUploadResponse.self).upload
    }

    /// Drops an upload that will not be printed (chosen another file, left the screen). Best effort: the server
    /// also removes it after an hour, and right after its print job ends.
    func deletePrintUpload(id: String) async {
        _ = try? await printExchange(makeRequest("/api/print/uploads/\(Self.printEnc(id))", method: "DELETE"))
    }

    private static func printMime(for fileName: String) -> String {
        switch (fileName as NSString).pathExtension.lowercased() {
        case "pdf": return "application/pdf"
        case "doc": return "application/msword"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xls": return "application/vnd.ms-excel"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "ppt": return "application/vnd.ms-powerpoint"
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        default: return "application/octet-stream"
        }
    }

    // MARK: Plumbing

    private func printDecode<Payload: Decodable>(_ data: Data, as type: Payload.Type) throws -> Payload {
        do { return try JSONDecoder().decode(Payload.self, from: data) } catch { throw APIError.decoding }
    }

    /// Nothing answered → `nothingAnswered`, 401 → `unauthorized`, any other refusal → `PrintAPIError`.
    private func printExchange(_ req: URLRequest) async throws -> Data {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw PrintAPIError(status: http.statusCode, code: obj?["code"] as? String, message: Self.serverMessage(data))
        }
        return data
    }
}
