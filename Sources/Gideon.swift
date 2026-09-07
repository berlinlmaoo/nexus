import Foundation

/// Something that rode along with a question, kept so the thread can still show it.
///
/// It lives for as long as the panel is open and no longer. The server keeps no copy: /api/gideon
/// hands the file to the shim, which deletes it once it has answered, and the turn it persists is
/// the text alone. So a thread re-fetched from the server carries none of these, and a question read
/// back from history draws as the words that were typed — which is the truth about what is still on
/// the server, rather than a paperclip pointing at a file nobody can open any more.
struct GideonAttachment: Sendable, Equatable {
    enum Kind: Sendable, Equatable { case image, document }

    let kind: Kind
    /// Filename with its extension for a document. Empty for a photo, which never had one.
    let name: String
    /// The bytes that were uploaded, kept for the thumbnail. Nil for a document.
    let preview: Data?
}

/// One turn of a GIDEON conversation.
struct GideonTurn: Identifiable, Sendable, Equatable {
    enum Role: String, Codable, Sendable { case user, assistant }

    let id: String
    var role: Role
    var content: String
    /// NEXUS tools GIDEON reached for on this turn. Empty until the tools are wired back up
    /// server-side; carried now so history from the web renders the same here.
    var tools: [String]
    /// What was attached to this question. Always empty on an assistant turn, and on anything that
    /// came back from history — see `GideonAttachment`.
    var attachments: [GideonAttachment]

    init(id: String = UUID().uuidString, role: Role, content: String, tools: [String] = [],
         attachments: [GideonAttachment] = []) {
        self.id = id
        self.role = role
        self.content = content
        self.tools = tools
        self.attachments = attachments
    }
}

/// Wire shapes. The server answers history as `{messages:[{role,content,tools}]}`.
private struct GideonHistoryResponse: Decodable {
    let messages: [Row]?
    struct Row: Decodable {
        let role: String?
        let content: String?
        let tools: [String]?
    }
}

/// One SSE frame: `data: {"type":"text","content":"…"}`.
private struct GideonEvent: Decodable {
    let type: String
    let content: String?
}

/// A refusal that arrives INSTEAD of the stream — a rejected attachment comes back as plain JSON
/// with a 4xx before any SSE exists. `error` is written in Indonesian for the user to read.
private struct GideonRefusal: Decodable {
    let error: String?
}

/// A document attached to one question.
///
/// The filename is carried with its extension because the route decides how to read a file from the
/// extension first and only falls back to the MIME type — a provider that hands over a generic
/// `public.data` would otherwise get the attachment refused for no reason the owner can act on.
struct GideonDocument: Sendable, Equatable {
    /// Filename WITH extension, e.g. "invoice-agustus.pdf".
    let name: String
    /// MIME type from the picker. Only consulted when `name` has no usable extension.
    let type: String
    let data: Data

    /// Extensions the server accepts. Mirrors DOC_EXTENSIONS in /api/gideon, which refuses anything
    /// else with a 415: Hermes reaches a document through a converter, and a type that converter
    /// cannot decode reaches the model as bytes it will confidently describe without having read.
    /// The server stays the authority — this copy only ever prevents an upload, never permits one.
    static let acceptedExtensions: Set<String> = [
        "pdf",
        "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html",
        "docx", "doc", "xlsx", "xls", "pptx", "ppt",
        "odt", "ods", "odp", "rtf", "epub", "ipynb",
    ]

    static let maxBytes = 10 * 1024 * 1024
}

/// The three GIDEON tiers.
///
/// Which model each one runs is decided on the server, and deliberately not named here: retuning a
/// tier must not require shipping a new build through review.
enum GideonTier: String, CaseIterable, Identifiable, Sendable {
    case astra, luna, terra, experimental

    var id: String { rawValue }
    static let fallback: GideonTier = .luna

    var label: String {
        switch self {
        case .astra: return "Astra"
        case .luna: return "Luna"
        case .terra: return "Terra"
        case .experimental: return "Experimental"
        }
    }

    var blurb: String {
        switch self {
        case .astra: return T("Deepest. For analysis and decisions.")
        case .luna: return T("Everyday.")
        case .terra: return T("Light. Short questions.")
        // Runs on the office GPU rather than a hosted API. Measurably weaker than the others, so
        // the blurb says so instead of letting somebody discover it in a wrong answer.
        case .experimental: return T("Local model in the office. Slow, and can be wrong.")
        }
    }
}

/// Talks to GIDEON.
///
/// Kept out of APIClient on purpose: every other call there decodes one JSON body and returns, while
/// this one holds a response open and emits as it arrives. Threading that through `run` would mean
/// bending the shared path around a single caller.
enum GideonClient {

    /// A conversation is stored server-side per user, so the same thread continues on the web and on
    /// the phone rather than each device keeping its own half.
    static func history() async throws -> [GideonTurn] {
        var request = authed("/api/gideon/history")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response)
        let decoded = try JSONDecoder().decode(GideonHistoryResponse.self, from: data)
        return (decoded.messages ?? []).compactMap { row in
            guard let role = GideonTurn.Role(rawValue: row.role ?? ""), let content = row.content else { return nil }
            return GideonTurn(role: role, content: content, tools: row.tools ?? [])
        }
    }

    static func clearHistory() async throws {
        var request = authed("/api/gideon/history")
        request.httpMethod = "DELETE"
        let (_, response) = try await URLSession.shared.data(for: request)
        try check(response)
    }

    /// Streams one answer.
    ///
    /// An AsyncThrowingStream rather than a callback: chunks arrive off the main actor, and hopping
    /// each one across with its own Task gives no ordering guarantee — the answer would assemble
    /// itself out of order the first time the backend emits token by token. Iterating a stream keeps
    /// the sequence the server sent.
    ///
    /// Today the backend answers in a single frame. Appending rather than replacing means nothing
    /// here changes when that stops being true.
    static func stream(messages: [GideonTurn], model: String, image: Data? = nil,
                       document: GideonDocument? = nil) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = authed("/api/gideon")
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    // A tool call on the far side can take well over half a minute; the default 60s
                    // would cut the answer off mid-thought and report it as a network failure.
                    request.timeoutInterval = 180
                    var payload: [String: Any] = [
                        "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
                        "model": model,
                    ]
                    // Base64 rather than multipart: the route already speaks JSON, and the server
                    // downscales again on arrival, so a slightly large upload costs seconds, not
                    // correctness.
                    if let image { payload["image"] = image.base64EncodedString() }
                    // A document rides the same JSON body and may travel WITH an image. `name` is
                    // what the route reads the extension off; `type` is only its fallback.
                    if let document {
                        payload["file"] = [
                            "name": document.name,
                            "type": document.type,
                            "data": document.data.base64EncodedString(),
                        ]
                    }
                    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    try await check(response, refusalIn: bytes)

                    // SSE frames are separated by a blank line, and `lines` already splits on
                    // newlines — a blank line simply carries no payload and is skipped.
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { continue }
                        // A malformed frame is skipped rather than ending the stream: losing one
                        // chunk is recoverable, losing the rest of the answer is not.
                        guard let event = try? JSONDecoder().decode(GideonEvent.self, from: data) else { continue }

                        switch event.type {
                        case "text":
                            if let content = event.content, !content.isEmpty { continuation.yield(content) }
                        case "error":
                            throw APIError.transport(event.content ?? "GIDEON failed.")
                        case "done":
                            continuation.finish()
                            return
                        default:
                            // tool_result, and anything added later: nothing to draw yet.
                            continue
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - plumbing

    private static func authed(_ path: String) -> URLRequest {
        var request = URLRequest(url: Config.baseURL.appendingPathComponent(path))
        if let session = Keychain.load() {
            request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        }
        return request
    }

    private static func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
    }

    /// The streaming variant: on a refusal the body is JSON, not SSE, so it is read here before the
    /// caller starts parsing frames.
    ///
    /// The server's own sentence names the file and says what to do about it; "Server error (415)"
    /// would throw away the only useful part. The read is capped because a proxy can refuse an
    /// oversized body itself, with an HTML page there is no reason to read to the end.
    private static func check(_ response: URLResponse, refusalIn bytes: URLSession.AsyncBytes) async throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if (200..<300).contains(http.statusCode) { return }

        var body = ""
        for try await line in bytes.lines {
            body += line
            if body.count > 8192 { break }
        }
        if let message = try? JSONDecoder().decode(GideonRefusal.self, from: Data(body.utf8)).error,
           !message.isEmpty {
            throw APIError.transport(message)
        }
        // No JSON to read: the refusal came from something in front of the route, so say what the
        // status means rather than repeating the number back.
        switch http.statusCode {
        case 413: throw APIError.transport(T("File is over the 10MB limit."))
        case 415: throw APIError.transport(T("GIDEON can't read that kind of file yet."))
        default: throw APIError.http(http.statusCode)
        }
    }
}
