import Foundation

enum APIError: LocalizedError {
    case http(Int)
    case unauthorized
    case decoding
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .http(let code): return "Server error (\(code))."
        case .unauthorized: return "Sesi habis — login lagi ya."
        case .decoding: return "Gagal baca data dari server."
        case .transport(let msg): return msg
        }
    }
}

/// Stateless networking layer. Reads the session straight from the Keychain for each request and
/// attaches it as a `Cookie` header (native clients may set `__Secure-…` cookies directly), so
/// every existing NEXUS API route authenticates it as a normal session.
struct APIClient {
    static let shared = APIClient()

    private func makeRequest(_ path: String, method: String = "GET", authed: Bool = true) -> URLRequest {
        var req = URLRequest(url: Config.baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if authed, let session = Keychain.load() {
            req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        }
        return req
    }

    private func run<T: Decodable>(_ req: URLRequest, decode: T.Type) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    // MARK: - Endpoints

    func login(email: String, password: String) async throws -> LoginResponse {
        var req = makeRequest("/api/auth/app-login", method: "POST", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        return try await run(req, decode: LoginResponse.self)
    }

    func projects() async throws -> [Project] {
        try await run(makeRequest("/api/projects"), decode: [Project].self)
    }

    // MARK: - Dashboard

    func profile() async throws -> ProfileResponse {
        try await run(makeRequest("/api/user/profile"), decode: ProfileResponse.self)
    }

    func gamification() async throws -> Gamification {
        try await run(makeRequest("/api/gamification/me"), decode: Gamification.self)
    }

    func myTasks(assigneeId: String) async throws -> [MissionTask] {
        try await run(makeRequest("/api/tasks?assigneeId=\(assigneeId)"), decode: [MissionTask].self)
    }

    func unreadCount() async throws -> Int {
        (try await run(makeRequest("/api/notifications"), decode: UnreadResponse.self)).unreadCount ?? 0
    }

    // MARK: - Attendance

    func attendanceToday() async throws -> AttendanceToday {
        try await run(makeRequest("/api/attendance/today"), decode: AttendanceToday.self)
    }

    func checkIn(lat: Double, lng: Double, selfie: Data, notes: String? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        if let notes, !notes.isEmpty { fields["notes"] = notes }
        return try await attendanceUpload("/api/attendance/check-in", fields: fields, selfie: selfie)
    }

    func checkOut(lat: Double, lng: Double, selfie: Data, offsite: Bool = false, reason: String? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        if offsite {
            fields["offsite"] = "1"
            if let reason, !reason.isEmpty { fields["reason"] = reason }
        }
        return try await attendanceUpload("/api/attendance/check-out", fields: fields, selfie: selfie)
    }

    /// Shared multipart upload for check-in/out. Maps the server's OUTSIDE_RADIUS 422 into a typed
    /// outcome so the UI can ask for an offsite reason; surfaces any other error message verbatim.
    private func attendanceUpload(_ path: String, fields: [String: String], selfie: Data) async throws -> AttendanceOutcome {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest(path, method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func appendStr(_ s: String) { body.append(s.data(using: .utf8)!) }
        for (key, value) in fields {
            appendStr("--\(boundary)\r\n")
            appendStr("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
            appendStr("\(value)\r\n")
        }
        appendStr("--\(boundary)\r\n")
        appendStr("Content-Disposition: form-data; name=\"selfie\"; filename=\"selfie.jpg\"\r\n")
        appendStr("Content-Type: image/jpeg\r\n\r\n")
        body.append(selfie)
        appendStr("\r\n--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if (200..<300).contains(http.statusCode) { return .success }
        if http.statusCode == 401 { throw APIError.unauthorized }

        // Decode the server's { error, code } body for a useful message.
        let payload = try? JSONDecoder().decode(ServerError.self, from: data)
        if http.statusCode == 422, payload?.code == "OUTSIDE_RADIUS" { return .outsideRadius }
        throw APIError.transport(payload?.error ?? "Gagal (\(http.statusCode)).")
    }
}

private struct ServerError: Decodable {
    let error: String?
    let code: String?
}
