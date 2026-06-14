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
        // Build the URL via URLComponents so a "?query" in `path` stays a real query string.
        // (URL.appendingPathComponent percent-encodes "?" into "%3F", breaking the route → 404.)
        let url: URL
        if let q = path.firstIndex(of: "?") {
            var comps = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false)!
            comps.path = String(path[..<q])
            comps.percentEncodedQuery = String(path[path.index(after: q)...])
            url = comps.url ?? Config.baseURL.appendingPathComponent(path)
        } else {
            url = Config.baseURL.appendingPathComponent(path)
        }
        var req = URLRequest(url: url)
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

    func project(_ id: String) async throws -> ProjectDetail {
        try await run(makeRequest("/api/projects/\(id)"), decode: ProjectDetail.self)
    }

    func workspaceInfo() async throws -> WorkspaceInfo {
        try await run(makeRequest("/api/workspaces/members"), decode: WorkspaceInfo.self)
    }

    @discardableResult
    func createProject(workspaceId: String, name: String, color: String, icon: String) async throws -> Bool {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "workspaceId": workspaceId, "color": color, "icon": icon])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func deleteTask(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/tasks/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    func taskDetail(_ id: String) async throws -> TaskDetail {
        try await run(makeRequest("/api/tasks/\(id)"), decode: TaskDetail.self)
    }

    // MARK: - Dashboard

    func profile() async throws -> ProfileResponse {
        try await run(makeRequest("/api/user/profile"), decode: ProfileResponse.self)
    }

    func gamification() async throws -> Gamification {
        try await run(makeRequest("/api/gamification/me"), decode: Gamification.self)
    }

    func myTasks(assigneeId: String) async throws -> [MyTask] {
        try await run(makeRequest("/api/tasks?assigneeId=\(assigneeId)"), decode: [MyTask].self)
    }

    func unreadCount() async throws -> Int {
        (try await run(makeRequest("/api/notifications"), decode: UnreadResponse.self)).unreadCount ?? 0
    }

    func leaderboard() async throws -> [LeaderboardRow] {
        (try await run(makeRequest("/api/gamification/leaderboard"), decode: LeaderboardResponse.self)).rows ?? []
    }

    func docs() async throws -> [Doc] {
        (try await run(makeRequest("/api/docs"), decode: DocsResponse.self)).docs ?? []
    }
    func doc(_ id: String) async throws -> Doc {
        (try await run(makeRequest("/api/docs/\(id)"), decode: DocResponse.self)).doc
    }
    func forms(projectId: String) async throws -> [NexusForm] {
        try await run(makeRequest("/api/forms?projectId=\(projectId)"), decode: [NexusForm].self)
    }
    func projectDocs(_ projectId: String) async throws -> [Doc] {
        (try await run(makeRequest("/api/docs?projectId=\(enc(projectId))"), decode: DocsResponse.self)).docs ?? []
    }
    func projectFiles(_ projectId: String, path: String = "") async throws -> ProjectFilesResponse {
        try await run(makeRequest("/api/projects/\(projectId)/files?path=\(enc(path))"), decode: ProjectFilesResponse.self)
    }
    @discardableResult
    func uploadProjectFile(_ projectId: String, path: String, fileName: String, data: Data) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/projects/\(projectId)/files", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        if !path.isEmpty { add("--\(boundary)\r\nContent-Disposition: form-data; name=\"path\"\r\n\r\n\(path)\r\n") }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func createProjectFolder(_ projectId: String, name: String, path: String) async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/files", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "path": path])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteProjectFile(_ projectId: String, path: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/projects/\(projectId)/files?path=\(enc(path))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// Downloads a project file's bytes (authed) to a temp URL for sharing/preview.
    func downloadProjectFile(_ projectId: String, path: String, fileName: String) async throws -> URL {
        let req = makeRequest("/api/projects/\(projectId)/files/download?path=\(enc(path))")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nexus-dl", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: url)
        try data.write(to: url)
        return url
    }

    func reports(days: Int) async throws -> Reports {
        try await run(makeRequest("/api/reports?days=\(days)"), decode: Reports.self)
    }
    func teams() async throws -> [Team] {
        try await run(makeRequest("/api/teams"), decode: [Team].self)
    }
    func roomBookings(start: String, end: String) async throws -> [RoomBooking] {
        let path = "/api/room-bookings?rangeStart=\(enc(start))&rangeEnd=\(enc(end))"
        return (try await run(makeRequest(path), decode: RoomBookingsResponse.self)).bookings ?? []
    }
    func masterCalendar(teamId: String, start: String, end: String) async throws -> [CalendarEvent] {
        let path = "/api/master-calendar?teamId=\(enc(teamId))&rangeStart=\(enc(start))&rangeEnd=\(enc(end))"
        return (try await run(makeRequest(path), decode: CalendarResponse.self)).events ?? []
    }
    func bufferDrafts() async throws -> BufferResponse {
        try await run(makeRequest("/api/buffer/drafts"), decode: BufferResponse.self)
    }
    func roster() async throws -> WorkspaceRoster {
        try await run(makeRequest("/api/workspaces/members"), decode: WorkspaceRoster.self)
    }
    private func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }
    @discardableResult
    func updateProfile(name: String) async throws -> Bool {
        var req = makeRequest("/api/user/profile", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    func conversations() async throws -> [Conversation] {
        (try await run(makeRequest("/api/conversations"), decode: ConversationsResponse.self)).conversations ?? []
    }

    func conversationMessages(_ id: String) async throws -> [ChatMessage] {
        (try await run(makeRequest("/api/conversations/\(id)/messages"), decode: MessagesResponse.self)).messages ?? []
    }

    @discardableResult
    func sendMessage(_ conversationId: String, content: String) async throws -> Bool {
        var req = makeRequest("/api/conversations/\(conversationId)/messages", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["content": content])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    func notifications() async throws -> NotificationsResponse {
        try await run(makeRequest("/api/notifications"), decode: NotificationsResponse.self)
    }

    @discardableResult
    func markNotificationRead(id: String) async throws -> Bool {
        var req = makeRequest("/api/notifications", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func markAllNotificationsRead() async throws -> Bool {
        var req = makeRequest("/api/notifications", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["markAllRead": true])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// PATCH /api/tasks/{id} with arbitrary fields (title/status/priority/dueDate/description).
    @discardableResult
    func updateTask(_ id: String, _ fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)  // returns the task; SuccessResponse ignores it
        return true
    }

    @discardableResult
    func setTaskStatus(taskId: String, status: String) async throws -> Bool {
        try await updateTask(taskId, ["status": status])
    }

    /// POST /api/tasks — create a task (or a subtask when parentId is set).
    @discardableResult
    func createTask(projectId: String, taskListId: String, title: String, parentId: String? = nil, status: String = "TODO", priority: String? = nil, dueDate: String? = nil) async throws -> String {
        var body: [String: Any] = ["projectId": projectId, "taskListId": taskListId, "title": title, "status": status]
        if let parentId { body["parentId"] = parentId }
        if let priority, priority.uppercased() != "NONE" { body["priority"] = priority }
        if let dueDate { body["dueDate"] = dueDate }
        var req = makeRequest("/api/tasks", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }

    func projectCustomFields(_ projectId: String) async throws -> [CustomField] {
        (try await run(makeRequest("/api/custom-fields?projectId=\(enc(projectId))"), decode: CustomFieldsResponse.self)).fields ?? []
    }
    /// PATCH a custom-field value. `value` must match the field's stored shape: String for
    /// text/select/status/number/date, [String] for MULTI_SELECT, ["label":,"mapUrl":] for PLACE.
    @discardableResult
    func setCustomFieldValue(fieldId: String, taskId: String, value: Any) async throws -> Bool {
        var req = makeRequest("/api/custom-fields", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": fieldId, "taskId": taskId, "value": value])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func taskCustomFields(projectId: String, taskId: String) async throws -> [CustomField] {
        (try await run(makeRequest("/api/custom-fields?projectId=\(enc(projectId))&taskId=\(enc(taskId))"), decode: CustomFieldsResponse.self)).fields ?? []
    }

    // MARK: - Attachments

    func taskAttachments(_ taskId: String) async throws -> [TaskAttachment] {
        try await run(makeRequest("/api/attachments?taskId=\(enc(taskId))"), decode: [TaskAttachment].self)
    }
    @discardableResult
    func uploadAttachment(taskId: String, fileName: String, data: Data) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/attachments", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"taskId\"\r\n\r\n\(taskId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteAttachment(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attachments/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// Downloads an attachment's bytes (authed) to a temp URL for sharing. `url` may be a path or absolute.
    func downloadAttachment(url: String, fileName: String) async throws -> URL {
        let req: URLRequest
        if url.hasPrefix("http"), let u = URL(string: url) {
            var r = URLRequest(url: u)
            if let s = Keychain.load() { r.setValue(s.cookieHeader, forHTTPHeaderField: "Cookie") }
            req = r
        } else {
            req = makeRequest(url)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nexus-att", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: out)
        try data.write(to: out)
        return out
    }

    // MARK: - Dependencies

    func taskDependencies(_ taskId: String) async throws -> TaskDependenciesResponse {
        try await run(makeRequest("/api/tasks/\(taskId)/dependencies"), decode: TaskDependenciesResponse.self)
    }

    func timeEntries(_ taskId: String) async throws -> [TimeEntry] {
        (try await run(makeRequest("/api/time-entries?taskId=\(enc(taskId))"), decode: TimeEntriesResponse.self)).entries ?? []
    }
    @discardableResult
    func logTime(taskId: String, duration: Int, description: String? = nil) async throws -> Bool {
        var req = makeRequest("/api/time-entries", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["taskId": taskId, "duration": duration]
        if let d = description, !d.isEmpty { body["description"] = d }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func addDependency(taskId: String, dependsOnTaskId: String) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(taskId)/dependencies", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["dependsOnTaskId": dependsOnTaskId, "type": "BLOCKING"])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func removeDependency(taskId: String, id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/tasks/\(taskId)/dependencies?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func addComment(taskId: String, content: String) async throws -> Bool {
        var req = makeRequest("/api/tasks/\(taskId)/comments", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["content": content])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Attendance

    func attendanceToday() async throws -> AttendanceToday {
        try await run(makeRequest("/api/attendance/today"), decode: AttendanceToday.self)
    }

    func attendanceHistory(scope: String, month: String) async throws -> [AttendanceRow] {
        let path = "/api/attendance/history?scope=\(enc(scope))&month=\(enc(month))"
        return (try await run(makeRequest(path), decode: AttendanceHistoryResponse.self)).all
    }
    func attendanceRequests(scope: String) async throws -> [AttendanceRequest] {
        (try await run(makeRequest("/api/attendance/requests?scope=\(enc(scope))"), decode: AttendanceRequestsResponse.self)).requests
    }
    @discardableResult
    func createAttendanceRequest(type: String, startDate: String, endDate: String, reason: String, attachment: (name: String, data: Data)? = nil) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/attendance/requests", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("type", type); field("startDate", startDate); field("endDate", endDate); field("reason", reason)
        if let a = attachment {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"supportingDocument\"; filename=\"\(a.name)\"\r\nContent-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            body.append(a.data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func reviewAttendanceRequest(id: String, action: String) async throws -> Bool {
        var req = makeRequest("/api/attendance/requests/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": action])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
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
