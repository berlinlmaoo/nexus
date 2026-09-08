import Foundation

/// The three calls the watch makes. Deliberately not a port of the phone's APIClient — the watch
/// reads status and answers approvals, and nothing else belongs here.
enum WatchAPI {
    enum Failure: LocalizedError {
        case offline
        case unauthorized
        case server(String)

        var errorDescription: String? {
            switch self {
            case .offline: return "No connection"
            case .unauthorized: return "Sign in on your iPhone"
            case .server(let message): return message
            }
        }
    }

    static func today(_ session: Session) async throws -> AttendanceToday {
        try await get("/api/attendance/today", session: session, as: AttendanceToday.self)
    }

    /// Only ever the workspace scope: the watch shows approvals, and a list of one's own requests
    /// is not something anybody reaches for on a wrist.
    static func pendingRequests(_ session: Session) async throws -> [AttendanceRequest] {
        let response = try await get("/api/attendance/requests?scope=workspace",
                                     session: session, as: AttendanceRequestsResponse.self)
        return response.requests.filter { ($0.status ?? "").uppercased() == "PENDING" }
    }

    /// Approve or reject. Every guard that matters lives on the server — the role check, and the
    /// four-eyes rule that refuses to let anyone review their own request. The watch sends one word
    /// to a door that is already guarded; it adds no authority of its own.
    static func review(_ session: Session, id: String, approve: Bool) async throws {
        var request = make("/api/attendance/requests/\(id)", session: session)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(
            withJSONObject: ["action": approve ? "approve" : "reject"])
        _ = try await send(request)
    }

    // MARK: - plumbing

    private static func make(_ path: String, session: Session) -> URLRequest {
        // Built by string on purpose: appendingPathComponent percent-escapes "?" into the path, so
        // the scope query would arrive as part of the route and the server would answer 404.
        let url = URL(string: Config.baseURL.absoluteString + path) ?? Config.baseURL
        var request = URLRequest(url: url)
        request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        return request
    }

    private static func get<T: Decodable>(_ path: String, session: Session, as type: T.Type) async throws -> T {
        let data = try await send(make(path, session: session))
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw Failure.server("Unexpected reply")
        }
    }

    private static func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            // Anything that never reached the server. The watch has no offline queue: attendance
            // cannot be taken here, so there is nothing to preserve for later.
            throw Failure.offline
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.offline }
        // 401 and 403 are NOT the same answer. 401 means the session is gone and signing in on the
        // phone is the fix. 403 means the server understood perfectly and said no — most often the
        // four-eyes rule on one's own request — and telling somebody to sign in again for that
        // sends them to fix something that was never broken.
        if http.statusCode == 401 { throw Failure.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure.server(message ?? "Failed (\(http.statusCode))")
        }
        return data
    }
}
