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
            // "This file has 72 pages. One print can have at most 50 pages."
            if let message, let r = message.range(of: #"has (\d+) pages"#, options: .regularExpression),
               let n = Int(message[r].filter(\.isNumber)) {
                return String(format: T("This file has %d pages. One print can have at most %d pages."), n, maxPages)
            }
            return String(format: T("Too many pages: at most %d per print."), maxPages)
        case "PRINT_RATE_LIMIT": return T("You've printed 20 times this hour. Try again later.")
        case "NOT_PRINTABLE": return T("This version has no file that can be printed.")
        case "PAGES_UNKNOWN": return T("Couldn't count the pages of this file, so it wasn't printed.")
        case "BAD_COPIES": return String(format: T("Copies must be between 1 and %d."), 5)
        case "LEGAL_NOT_INVITED": return T("Legal is by invitation only")
        default: return APIError.http(status, message).errorDescription
        }
    }
}

extension APIClient {

    private static func printEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: legalSegment) ?? s
    }

    /// Sends a print. `version` (Legal only) omitted = the document's primary version (signed ?? final ?? current).
    func submitPrint(kind: PrintKind, id: String, copies: Int, colorMode: PrintColorMode, version: Int? = nil) async throws -> PrintJob {
        var body: [String: Any] = ["kind": kind.rawValue, "id": id, "copies": copies, "colorMode": colorMode.rawValue]
        if let version, kind == .legal { body["version"] = version }
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
