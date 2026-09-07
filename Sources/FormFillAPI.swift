import Foundation

/// Why a 403 is not just a 403.
///
/// The public form route refuses in two different ways with the same status. One carries an
/// `accessSchedule` and means "this form opens Mon–Fri 09:00–17:00, come back then"; the other
/// carries nothing and means the form is private or gone. Collapsing them into "unavailable"
/// tells somebody standing in front of a form that opens in two hours that it does not exist.
enum FormAccessError: LocalizedError {
    /// The server's own sentence — it names the schedule, and it is already in the right language.
    case notOpenYet(String)
    case unavailable
    case loginRequired(String)

    var errorDescription: String? {
        switch self {
        case .notOpenYet(let message): return message
        case .unavailable: return T("This form is private or no longer exists.")
        case .loginRequired(let message): return message
        }
    }
}

/// The public-form endpoints. They live outside APIClient.swift so the file can be added or
/// reverted without touching the client everything else in the app goes through.
///
/// They used to carry a private copy of the request builder and of the send, because both were
/// file-private in APIClient.swift while it was being edited. The cost showed up exactly where it
/// was predicted to: a submit, the one request in this app that routinely carries 20 MB, was the
/// only request that never took the office LAN. Both helpers are now internal, so a form inherits
/// the route selection AND the replay rules that have to come with it — a route without them would
/// turn a LAN that dies mid-upload into an outright failure, which is worse than the long way round.
extension APIClient {

    /// The form to fill in. `GET /api/forms/{id}/public` first — it takes an id OR a slug, applies
    /// the access schedule, and re-syncs a `task_list` dropdown against the project's live sections.
    ///
    /// That route answers only for `isPublic` forms, and this screen is reached from the Forms grid
    /// and from search, both of which list every form in the viewer's own projects — most of them
    /// internal. So a refusal that is NOT the schedule falls back to the member route, which is
    /// gated by exactly the project-membership check the submit route already applies to a
    /// non-public form: nothing becomes fillable here that was not submittable before.
    ///
    /// What the fallback gives up is worth knowing: it resolves an id only, never a slug, its
    /// `task_list` options are whatever was stored rather than the project's current sections, and
    /// it does not check the schedule — the submit route still does, and names the reason.
    func publicForm(_ formId: String) async throws -> PublicForm {
        do {
            return try await fetchForm(at: "/api/forms/\(formId)/public")
        } catch FormAccessError.unavailable {
            return try await fetchForm(at: "/api/forms/\(formId)")
        }
    }

    /// The id goes into the path raw, like every other id in the client: `makeRequest`
    /// percent-encodes it once, which is right both for the cuids the Forms grid actually passes
    /// and for a slug with a space in it. Only an id somebody had escaped by hand would come out
    /// double-encoded, and nothing in this app produces one.
    private func fetchForm(at path: String) async throws -> PublicForm {
        let (data, http) = try await send(makeRequest(path))

        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(FormServerError.self, from: data)
            // A 403 carrying the schedule is "come back later"; a 403 without one is "not yours".
            if http.statusCode == 403, payload?.accessSchedule != nil {
                throw FormAccessError.notOpenYet(payload?.error ?? T("This form is closed right now."))
            }
            throw FormAccessError.unavailable
        }

        do { return try JSONDecoder().decode(PublicForm.self, from: data) }
        catch { throw APIError.decoding }
    }

    /// POST /api/forms/{id}/submit — multipart/form-data: one `data` part holding the answers as
    /// JSON, then a part per file keyed `file:<fieldId>` or `attachment:<fieldId>`. Those keys
    /// REPEAT for a multi-file field, which is why this does not go through the client's other
    /// multipart builder: that one takes a dictionary of fields, and a dictionary cannot repeat.
    @discardableResult
    func submitForm(_ formId: String, data: [String: Any], files: [FormUpload],
                    progress: UploadProgress? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/forms/\(formId)/submit", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let json = try JSONSerialization.data(withJSONObject: data)
        req.httpBody = Self.formMultipartBody(boundary: boundary, json: json, files: files)

        let (body, http) = try await send(req, reporting: progress)
        if (200..<300).contains(http.statusCode) { return true }

        let payload = try? JSONDecoder().decode(FormServerError.self, from: body)
        if http.statusCode == 401 {
            // Deliberately NOT APIError.unauthorized: that logs the session out everywhere, and
            // doing it here would throw away a form somebody has just spent five minutes filling in.
            throw FormAccessError.loginRequired(payload?.error ?? T("Log in again to submit this form."))
        }
        // Everything else is shown as the server worded it, which is what the web does — the
        // useful refusals here ("<field> is required", "Form lagi ditutup sementara.", the rate
        // limiter) all say something more specific than any status code could.
        throw APIError.transport(payload?.error ?? T("Couldn't submit the form."))
    }

    // MARK: - plumbing

    /// `perform`, not a bare `URLSession.data`: a form leaves by whichever host the rest of the app
    /// is using AND inherits the rule about when a request that failed there may be sent again.
    ///
    /// That rule is why the builder is not simply pointed at the LAN and left there. A submit is a
    /// POST, and the route behind it creates a task, a submission row and its attachments, then
    /// fires the project's automations and its webhooks — so it may only be replayed when the error
    /// proves the body never left the phone. A submit that timed out may already be all of those
    /// things, and a second copy of somebody's request is worse than one refusal they can answer.
    ///
    /// The error mapping is what it always was, so every `catch` at the call sites still matches.
    private func send(_ req: URLRequest, reporting progress: UploadProgress? = nil) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        return (data, http)
    }

    /// The answers ride as a plain string part — no Content-Type — because that is exactly what a
    /// browser's `FormData.append("data", string)` puts on the wire, and the route reads it with
    /// `formData.get("data")`. A part that names a filename is parsed as a File instead, so the
    /// filename parameter appears on file parts and nowhere else.
    private static func formMultipartBody(boundary: String, json: Data, files: [FormUpload]) -> Data {
        var body = Data()
        func write(_ s: String) { body.append(Data(s.utf8)) }

        write("--\(boundary)\r\n")
        write("Content-Disposition: form-data; name=\"data\"\r\n\r\n")
        body.append(json)
        write("\r\n")

        for file in files {
            write("--\(boundary)\r\n")
            write("Content-Disposition: form-data; name=\"\(quoted(file.partName))\"; filename=\"\(quoted(file.filename))\"\r\n")
            write("Content-Type: \(file.mime)\r\n\r\n")
            body.append(file.data)
            write("\r\n")
        }

        write("--\(boundary)--\r\n")
        return body
    }

    /// A filename is whatever the file picker handed back, and a quote or a newline in one would
    /// close the header early and hand the parser a body it reports as an unreadable 500.
    private static func quoted(_ raw: String) -> String {
        raw.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }
}

/// `{ error }` on every refusal; `accessSchedule` only on the public route's scheduled one.
/// The schedule itself is never read — its PRESENCE is the whole signal, which is the same thing
/// the web checks. An empty type decodes from whatever the column holds, while a JSON `null`
/// still arrives as nil, which is the distinction that matters.
private struct FormServerError: Decodable {
    let error: String?
    let accessSchedule: ScheduleMarker?
    struct ScheduleMarker: Decodable {
        init(from decoder: Decoder) throws {}
    }
}
