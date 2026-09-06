import Foundation

/// One turn of a GIDEON conversation.
struct GideonTurn: Identifiable, Sendable, Equatable {
    enum Role: String, Codable, Sendable { case user, assistant }

    let id: String
    var role: Role
    var content: String
    /// NEXUS tools GIDEON reached for on this turn. Empty until the tools are wired back up
    /// server-side; carried now so history from the web renders the same here.
    var tools: [String]

    init(id: String = UUID().uuidString, role: Role, content: String, tools: [String] = []) {
        self.id = id
        self.role = role
        self.content = content
        self.tools = tools
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

/// The three GIDEON tiers.
///
/// Which model each one runs is decided on the server, and deliberately not named here: retuning a
/// tier must not require shipping a new build through review.
enum GideonTier: String, CaseIterable, Identifiable, Sendable {
    case astra, luna, terra

    var id: String { rawValue }
    static let fallback: GideonTier = .luna

    var label: String {
        switch self {
        case .astra: return "Astra"
        case .luna: return "Luna"
        case .terra: return "Terra"
        }
    }

    var blurb: String {
        switch self {
        case .astra: return T("Deepest. For analysis and decisions.")
        case .luna: return T("Everyday.")
        case .terra: return T("Light. Short questions.")
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
    static func stream(messages: [GideonTurn], model: String) -> AsyncThrowingStream<String, Error> {
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
                    request.httpBody = try JSONSerialization.data(withJSONObject: [
                        "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
                        "model": model,
                    ])

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    try check(response)

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
}
