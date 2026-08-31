import Foundation

enum APIError: LocalizedError {
    case http(Int)
    case unauthorized
    case decoding
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .http(let code): return "Server error (\(code))."
        case .unauthorized: return T("Session expired — please log in again.")
        case .decoding: return T("Couldn't read data from the server.")
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

    /// All of a project's tasks INCLUDING subtasks (the project payload is parentId-only). Carries
    /// `parentId`/`taskListId`/`quests` → board & list merge subtasks into their lane + show "+N XP".
    func projectTasks(_ projectId: String) async throws -> [BoardTask] {
        try await run(makeRequest("/api/tasks?projectId=\(enc(projectId))"), decode: [BoardTask].self)
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

    // MARK: - Project folders

    func projectFolders(workspaceId: String?) async throws -> [ProjectFolder] {
        let path = "/api/project-folders" + (workspaceId.map { "?workspaceId=\(enc($0))" } ?? "")
        return try await run(makeRequest(path), decode: [ProjectFolder].self)
    }
    /// Creates a folder and returns its id (needed to upload a photo icon afterward).
    func projectFolderCreate(workspaceId: String, name: String, icon: String, color: String, parentFolderId: String? = nil) async throws -> String {
        var req = makeRequest("/api/project-folders", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["workspaceId": workspaceId, "name": name, "icon": icon, "color": color]
        if let parentFolderId { body["parentFolderId"] = parentFolderId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }
    @discardableResult
    func projectFolderUpdate(folderId: String, name: String, icon: String, color: String) async throws -> Bool {
        var req = makeRequest("/api/project-folders/\(folderId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "icon": icon, "color": color])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func projectFolderDelete(_ folderId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/project-folders/\(folderId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    /// Curated project subset for a folder's aggregate view (empty = all projects in the folder).
    @discardableResult
    func setFolderAggregate(folderId: String, projectIds: [String]) async throws -> Bool {
        var req = makeRequest("/api/project-folders/\(folderId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["aggregateProjectIds": projectIds])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Tasks across a set of projects (the folder aggregate calendar). projectIds joined by comma.
    func folderTasks(projectIds: [String]) async throws -> [FolderTask] {
        guard !projectIds.isEmpty else { return [] }
        return try await run(makeRequest("/api/tasks?projectIds=\(enc(projectIds.joined(separator: ",")))"), decode: [FolderTask].self)
    }
    @discardableResult
    func uploadFolderIcon(folderId: String, fileName: String, data: Data) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/folder-icon", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"folderId\"\r\n\r\n\(folderId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Profile photo. The server takes a multipart field named "file" (PNG/JPG/WEBP, 5 MB cap)
    /// and answers `{ user, url }`; `user.avatar` already carries a `?t=` cache-buster, so the
    /// new picture shows up immediately instead of being served from a stale cache.
    func uploadAvatar(fileName: String, mime: String, data: Data) async throws -> String? {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        return try await run(req, decode: ProfileResponse.self).user.avatar
    }

    /// Drop the profile photo and fall back to the initial.
    @discardableResult
    func deleteAvatar() async throws -> Bool {
        _ = try await run(makeRequest("/api/upload/avatar", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    /// Start a DM or a group. The server de-dupes DMs: asking for a 1:1 that already exists
    /// returns the existing conversation instead of a second one, so callers can treat this as
    /// "open a chat with these people" rather than strictly "create".
    func createConversation(type: String, userIds: [String], name: String?) async throws -> Conversation {
        var req = makeRequest("/api/conversations", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["type": type, "userIds": userIds]
        if let name, !name.isEmpty { payload["name"] = name }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        return try await run(req, decode: ConversationResponse.self).conversation
    }

    /// Rename a group chat. The server refuses DMs (titled after the other person) and PROJECT
    /// rooms (named after the project), so only pass a GROUP here.
    func renameConversation(_ conversationId: String, name: String) async throws -> Conversation {
        var req = makeRequest("/api/conversations/\(conversationId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        return try await run(req, decode: ConversationResponse.self).conversation
    }

    /// Move a project into a folder (or to root with nil).
    @discardableResult
    func setProjectFolder(projectId: String, folderId: String?) async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["folderId": folderId as Any])
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

    // MARK: - Sprints

    func sprints(_ projectId: String) async throws -> SprintsResponse {
        try await run(makeRequest("/api/sprints?projectId=\(enc(projectId))"), decode: SprintsResponse.self)
    }
    @discardableResult
    func createSprint(projectId: String, name: String, startDate: String, endDate: String) async throws -> Bool {
        var req = makeRequest("/api/sprints", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["projectId": projectId, "name": name, "startDate": startDate, "endDate": endDate])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateSprint(id: String, status: String) async throws -> Bool {
        var req = makeRequest("/api/sprints", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "status": status])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Automations / Finance / P&L

    func automations(_ projectId: String) async throws -> AutomationsResponse {
        try await run(makeRequest("/api/automations?projectId=\(enc(projectId))"), decode: AutomationsResponse.self)
    }
    @discardableResult
    func updateAutomation(id: String, enabled: Bool) async throws -> Bool {
        var req = makeRequest("/api/automations", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "enabled": enabled])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func financeDashboard(projectId: String, year: Int) async throws -> FinanceDashboard {
        try await run(makeRequest("/api/finance/dashboard?projectId=\(enc(projectId))&year=\(year)"), decode: FinanceDashboard.self)
    }
    func pnlDashboard(projectId: String, year: Int) async throws -> PnlDashboard {
        try await run(makeRequest("/api/pnl/dashboard?projectId=\(enc(projectId))&year=\(year)"), decode: PnlDashboard.self)
    }

    func search(_ q: String) async throws -> SearchResults {
        try await run(makeRequest("/api/search?q=\(enc(q))"), decode: SearchResults.self)
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
    func mySubmissions() async throws -> MySubmissionsResponse {
        try await run(makeRequest("/api/forms/my-submissions"), decode: MySubmissionsResponse.self)
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
    /// `teamId` is REQUIRED — the route answers 400 without it. A previous version made it optional
    /// on the assumption the endpoint would fall back to the whole workspace; it does not, so
    /// "All teams" returned `Server error (400)` on every load. The web has always sent it:
    /// `masterCalendar:(e,t,n)=>/api/master-calendar?teamId=${e}&rangeStart=${t}&rangeEnd=${n}`.
    /// Callers that want every team ask for each team and merge — see TeamCalendarView.loadEvents.
    func masterCalendar(teamId: String, start: String, end: String) async throws -> [CalendarEvent] {
        let path = "/api/master-calendar?teamId=\(enc(teamId))&rangeStart=\(enc(start))&rangeEnd=\(enc(end))"
        return (try await run(makeRequest(path), decode: CalendarResponse.self)).events ?? []
    }
    func roster() async throws -> WorkspaceRoster {
        try await run(makeRequest("/api/workspaces/members"), decode: WorkspaceRoster.self)
    }
    @discardableResult
    func inviteWorkspaceMember(email: String, role: String, workspaceId: String) async throws -> Bool {
        var req = makeRequest("/api/workspaces/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "role": role, "workspaceId": workspaceId])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateWorkspaceMemberRole(memberId: String, role: String, workspaceId: String) async throws -> Bool {
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["memberId": memberId, "role": role, "workspaceId": workspaceId])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func removeWorkspaceMember(memberId: String, workspaceId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/workspaces/members?memberId=\(enc(memberId))&workspaceId=\(enc(workspaceId))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func changePassword(current: String, new: String) async throws -> Bool {
        var req = makeRequest("/api/user/password", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["currentPassword": current, "newPassword": new])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Admin (Control Room) editing

    // MARK: - Threads (the web's company feed — /api/feed/posts)

    func feedPosts(limit: Int = 30) async throws -> [FeedPost] {
        (try await run(makeRequest("/api/feed/posts?limit=\(limit)"), decode: FeedPostsResponse.self)).all
    }
    func postComments(_ postId: String) async throws -> [FeedComment] {
        (try await run(makeRequest("/api/feed/posts/\(postId)/comments"), decode: FeedCommentsResponse.self)).all
    }
    /// POST /api/feed/posts is **multipart**, not JSON — the route reads `text`, `mentions`
    /// (a JSON-encoded string, not a repeated field), `imageMeta` and any number of `images` parts:
    ///
    ///     createPost: e => { const t = new FormData
    ///       t.set("text", e.text); t.set("mentions", JSON.stringify(e.mentions))
    ///       e.imageMeta && t.set("imageMeta", …); e.images.forEach(n => t.append("images", n)) … }
    ///
    /// Two earlier attempts sent JSON — first `{content}`, then `{text, mentions}`. The second one
    /// had the right field names, which is why it looked correct, but the body was still the wrong
    /// format. (Comments ARE JSON: `addPostComment(e, t) => body: JSON.stringify(t)`. Same screen,
    /// two different content types — that's what made this easy to get wrong.)
    /// The composer is text-only for now, so no image parts are attached.
    @discardableResult
    func createPost(text: String) async throws -> Bool {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/feed/posts", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("text", text)
        field("mentions", "[]")   // JSON-encoded, exactly like the web's JSON.stringify([])
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func addPostComment(postId: String, text: String) async throws -> Bool {
        var req = makeRequest("/api/feed/posts/\(postId)/comments", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "mentions": []])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Toggle-like. Body-less POST, so nothing to guess about the payload.
    @discardableResult
    func likePost(_ postId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/feed/posts/\(postId)/like", method: "POST"), decode: SuccessResponse.self)
        return true
    }

    // MARK: - Ticket (web calls this "complaints" — a private line to the BoD)

    /// No status query param: the web builds it inside a helper we can't see, so we take the default
    /// set and filter client-side rather than guess a parameter name.
    func complaints() async throws -> [Complaint] {
        (try await run(makeRequest("/api/complaints"), decode: ComplaintsResponse.self)).complaints ?? []
    }

    func auditLogs() async throws -> [AuditLog] {
        (try await run(makeRequest("/api/audit"), decode: AuditLogsResponse.self)).logs ?? []
    }
    func adminQuests(workspaceId: String) async throws -> [AdminQuest] {
        (try await run(makeRequest("/api/gamification/quests/admin?workspaceId=\(enc(workspaceId))"), decode: AdminQuestsResponse.self)).quests ?? []
    }
    @discardableResult
    func createAdminQuest(workspaceId: String, title: String, requirementType: String, requiredCount: Int, xpReward: Int, deadline: String?) async throws -> Bool {
        var req = makeRequest("/api/gamification/quests/admin", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["workspaceId": workspaceId, "title": title, "requirementType": requirementType, "requiredCount": requiredCount, "xpReward": xpReward]
        if let deadline { body["deadline"] = deadline }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// Bundle EXACT tasks into a `specific_tasks` quest (the per-task "Jadiin quest" button). The
    /// backend derives workspaceId + requiredCount from the tasks, so we send only title/xp/taskIds.
    @discardableResult
    func createTaskQuest(title: String, xpReward: Int, taskIds: [String]) async throws -> Bool {
        var req = makeRequest("/api/gamification/quests/admin", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "title": title, "xpReward": xpReward, "requirementType": "specific_tasks", "taskIds": taskIds,
        ])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteAdminQuest(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/gamification/quests/admin?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    func announcements() async throws -> [AdminAnnouncement] {
        (try await run(makeRequest("/api/announcements"), decode: AnnouncementsResponse.self)).announcements ?? []
    }
    @discardableResult
    func createAnnouncement(title: String, body: String, tone: String) async throws -> Bool {
        var req = makeRequest("/api/announcements", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["title": title, "body": body, "tone": tone])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateAnnouncementActive(id: String, active: Bool) async throws -> Bool {
        var req = makeRequest("/api/announcements/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["active": active])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteAnnouncement(_ id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/announcements/\(id)", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteUser(_ userId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/admin/users/\(userId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
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
    func sendMessage(_ conversationId: String, content: String, mentionedUserIds: [String] = [],
                     attachmentUrl: String? = nil, attachmentType: String? = nil) async throws -> Bool {
        var req = makeRequest("/api/conversations/\(conversationId)/messages", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["content": content, "mentionedUserIds": mentionedUserIds]
        if let attachmentUrl { payload["attachmentUrl"] = attachmentUrl }
        if let attachmentType { payload["attachmentType"] = attachmentType }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    /// Upload one chat picture and get back the path to attach to a message. The server checks that
    /// you belong to the conversation before writing anything.
    func uploadChatImage(conversationId: String, fileName: String, mime: String, data: Data) async throws -> ChatUpload {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/upload/chat", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"conversationId\"\r\n\r\n\(conversationId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        return try await run(req, decode: ChatUpload.self)
    }

    @discardableResult
    func registerPushDevice(token: String, deviceId: String, environment: String) async throws -> Bool {
        var req = makeRequest("/api/push/devices", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": token,
            "deviceId": deviceId,
            "bundleId": "id.znetworks.nexus",
            "environment": environment,
        ])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    @discardableResult
    func unregisterPushDevice(token: String, session: Session) async throws -> Bool {
        var req = makeRequest("/api/push/devices", method: "DELETE", authed: false)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["token": token])
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

    // MARK: - Project settings (identity / flags / fields / members / danger zone)
    /// PATCH /api/projects/{id} with any of name/description/color/icon/flags.
    @discardableResult
    func updateProject(_ id: String, fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/projects/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func createCustomFieldDef(projectId: String, name: String, type: String, options: [String: Any]?) async throws -> Bool {
        var body: [String: Any] = ["projectId": projectId, "name": name, "type": type]
        if let options { body["options"] = options }
        var req = makeRequest("/api/custom-fields", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateCustomFieldDef(id: String, name: String?, type: String?, options: [String: Any]?) async throws -> Bool {
        var body: [String: Any] = ["id": id]
        if let name { body["name"] = name }
        if let type { body["type"] = type }
        if let options { body["options"] = options }
        var req = makeRequest("/api/custom-fields", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteCustomFieldDef(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/custom-fields?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func addProjectMember(projectId: String, userId: String, role: String = "MEMBER") async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId, "role": role])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func removeProjectMember(projectId: String, userId: String) async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/members", method: "DELETE")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func inviteProjectMember(projectId: String, email: String, role: String = "GUEST") async throws -> Bool {
        var req = makeRequest("/api/projects/\(projectId)/invite", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "role": role])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    /// POST /api/projects/{id}/duplicate → returns the new project id.
    func duplicateProject(projectId: String) async throws -> String {
        let req = makeRequest("/api/projects/\(projectId)/duplicate", method: "POST")
        return (try await run(req, decode: CreatedTaskRef.self)).id
    }
    @discardableResult
    func deleteProject(projectId: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/projects/\(projectId)", method: "DELETE"), decode: SuccessResponse.self)
        return true
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
    /// BoD cleanup: omit `part` to delete the whole record (e.g. an accidental check-in), or part="checkout" to clear only the check-out (reopen).
    @discardableResult
    func deleteAttendanceRecord(_ recordId: String, part: String? = nil) async throws -> Bool {
        var path = "/api/attendance/records/\(recordId)"
        if let part { path += "?part=\(enc(part))" }
        _ = try await run(makeRequest(path, method: "DELETE"), decode: SuccessResponse.self)
        return true
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

    // MARK: - Offsite check-out approvals
    //
    // The SECOND approval queue, and the app never had it: when someone checks out beyond the
    // office geofence the shift is held at `checkOutApproval = PENDING` until a BoD approves it.
    // The web reviews these next to the leave/permit requests (`offsiteCheckouts("ALL")`); on the
    // app they were invisible, so a reviewer could never see — let alone clear — the queue.

    func offsiteCheckouts(status: String = "ALL") async throws -> [OffsiteCheckout] {
        let path = "/api/attendance/offsite-checkouts?status=\(enc(status))"
        return (try await run(makeRequest(path), decode: OffsiteCheckoutsResponse.self)).items ?? []
    }

    @discardableResult
    func reviewOffsiteCheckout(id: String, action: String) async throws -> Bool {
        var req = makeRequest("/api/attendance/offsite-checkouts/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": action])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: - Attendance offices

    func attendanceOffices() async throws -> [Office] {
        (try await run(makeRequest("/api/attendance/offices"), decode: OfficesResponse.self)).offices ?? []
    }
    @discardableResult
    func createOffice(fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/attendance/offices", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func updateOffice(id: String, fields: [String: Any]) async throws -> Bool {
        var req = makeRequest("/api/attendance/offices/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }

    // MARK: attendance admin — per-user shift, day-off quota/grant, red-date quota, holidays (BoD+)
    /// PATCH /api/workspaces/members — set/clear a member's personal shift (HH:mm) + per-weekday overrides.
    @discardableResult
    func setAttendanceShift(memberId: String, workspaceId: String, start: String?, end: String?, byDay: [String: [String: String]]?) async throws -> Bool {
        var body: [String: Any] = ["memberId": memberId, "workspaceId": workspaceId]
        body["attendanceShiftStartTime"] = start ?? NSNull()
        body["attendanceShiftEndTime"] = end ?? NSNull()
        body["attendanceShiftByDay"] = (byDay?.isEmpty == false ? byDay! : NSNull())
        var req = makeRequest("/api/workspaces/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func dayoffs(userId: String, month: String) async throws -> DayoffsResponse {
        try await run(makeRequest("/api/attendance/dayoffs?userId=\(enc(userId))&month=\(enc(month))"), decode: DayoffsResponse.self)
    }
    @discardableResult
    func grantDayoff(userId: String, date: String, reason: String?) async throws -> Bool {
        var body: [String: Any] = ["userId": userId, "date": date]
        if let reason, !reason.isEmpty { body["reason"] = reason }
        var req = makeRequest("/api/attendance/dayoffs", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func setDayoffQuota(userId: String, quota: Int?, workspaceId: String) async throws -> Bool {
        var body: [String: Any] = ["userId": userId, "workspaceId": workspaceId]
        body["quota"] = quota ?? NSNull()
        var req = makeRequest("/api/attendance/dayoffs", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteDayoff(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attendance/dayoffs?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }
    func redDateQuota(month: String) async throws -> RedDateQuotaInfo {
        try await run(makeRequest("/api/attendance/red-date-quota?month=\(enc(month))"), decode: RedDateQuotaInfo.self)
    }
    @discardableResult
    func setRedDateQuota(month: String, quota: Int) async throws -> Bool {
        var req = makeRequest("/api/attendance/red-date-quota", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["month": month, "quota": quota])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    func holidays(month: String) async throws -> HolidaysResponse {
        try await run(makeRequest("/api/attendance/holidays?month=\(enc(month))"), decode: HolidaysResponse.self)
    }
    @discardableResult
    func addHoliday(date: String, name: String) async throws -> Bool {
        var req = makeRequest("/api/attendance/holidays", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["date": date, "name": name])
        _ = try await run(req, decode: SuccessResponse.self)
        return true
    }
    @discardableResult
    func deleteHoliday(id: String) async throws -> Bool {
        _ = try await run(makeRequest("/api/attendance/holidays?id=\(enc(id))", method: "DELETE"), decode: SuccessResponse.self)
        return true
    }

    func checkIn(lat: Double, lng: Double, selfie: Data, notes: String? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        if let notes, !notes.isEmpty { fields["notes"] = notes }
        return try await attendanceUpload("/api/attendance/check-in", fields: fields, selfie: selfie)
    }

    /// `reflection` is REQUIRED by the server on check-out (min 200 chars) — same field the web
    /// sends. Without it the API rejects with "Refleksi harian wajib diisi minimal 200 karakter".
    func checkOut(lat: Double, lng: Double, selfie: Data, reflection: String,
                  offsite: Bool = false, reason: String? = nil) async throws -> AttendanceOutcome {
        var fields = ["lat": String(lat), "lng": String(lng)]
        let trimmedReflection = reflection.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedReflection.isEmpty { fields["reflection"] = trimmedReflection }
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
        throw APIError.transport(payload?.error ?? "\(T("Failed")) (\(http.statusCode)).")
    }
}

private struct ServerError: Decodable {
    let error: String?
    let code: String?
}
