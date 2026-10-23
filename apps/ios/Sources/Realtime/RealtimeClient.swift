import SwiftUI
import Observation

/// The app's realtime connection to NEXUS (owner, 8 Oct 2026: "Kenapa app ini gak punya koneksi
/// realtime dan malah pake refresh otomatis? harusnya kan app kaya gini punya koneksi realtime" — a
/// colleague's Mac did not show project changes live).
///
/// The same Socket.IO server the web uses (pages/api/socket.ts on the server), reached at
/// `wss://nexus.znetworks.id/api/socket/?EIO=4&transport=websocket` with the session cookie. This
/// type decides WHEN to be connected and what each event MEANS for the app; the connection itself
/// is RealtimeEngine. Events become the same notifications the screens already listen to
/// (RealtimeNames.swift), so a screen neither knows nor cares whether news came from the socket, a
/// push or its own timer.
///
/// - Connected while signed in and the app is in front (on the Mac: any visible window, focused or
///   not — the rule LiveRefresh uses). Closed in the background and on sign-out; reopened on return.
/// - While connected, the screens' fallback timers are stretched (LiveRefreshPolicy) and the open
///   chat polls every 30 s instead of 5 s. When the link drops, both go back at once.
/// - Push notifications stay what they were: the way news reaches a phone that is not looking.
@MainActor
@Observable
final class RealtimeClient {
    static let shared = RealtimeClient()

    /// What Tuning Room shows, and what the chat thread paces its polling by.
    private(set) var state: RealtimeEngine.State = .off

    var isConnected: Bool { state == .connected }

    /// The fallback timers run this many times slower while connected: 15 s → 2 min, 30 s → 4 min.
    static let connectedStretch: Double = 8

    @ObservationIgnored private let engine: RealtimeEngine
    /// The session the engine is running for; another token means another sign-in.
    @ObservationIgnored private var taskVersions = TaskVersionTracker()
    @ObservationIgnored private var token: String?
    /// Conversations with news, folded so the two events of one message (`message-created` to the
    /// room, `conversation-updated` to each member) cost one refresh, not two.
    @ObservationIgnored private var chatNews: Set<String> = []
    /// Who is signed in, so their own typing on another device is not shown back to them.
    @ObservationIgnored private var meId: String?
    @ObservationIgnored private var chatFlush: Task<Void, Never>?
    @ObservationIgnored private var calendarFlush: Task<Void, Never>?
    /// Attendance events folded into one refetch (R-15); `attendanceOwn` = one of them was this person's own.
    @ObservationIgnored private var attendanceFlush: Task<Void, Never>?
    @ObservationIgnored private var attendanceOwn = false

    private init() {
        engine = RealtimeEngine()
        engine.makeRequest = { Self.upgradeRequest() }
        engine.identity = {
            guard let s = Keychain.load() else { return nil }
            return (s.userId, s.userName)
        }
        engine.bootstrap = {
            // The server attaches its Socket.IO engine lazily, on the first request to this route
            // after a restart — until then the upgrade below is never answered. The web makes the
            // same call before it connects. Outside the /api/socket prefix on purpose (see
            // pages/api/realtime-init.ts). Best effort: the attempt goes ahead whatever it answers.
            var req = APIClient.shared.makeRequest("/api/realtime-init")
            req.timeoutInterval = 10
            _ = try? await APIClient.shared.perform(req)
        }
        engine.onState = { [weak self] state in self?.stateChanged(state) }
        engine.onConnected = { [weak self] in self?.catchUp() }
        engine.onEvent = { [weak self] name, payload in self?.route(name, payload) }
        // Access to a project ended while its screen was open (web lib/realtime.tsx onJoinDenied): that
        // project / sheet refetches and shows the no-access state, and the project lists refresh.
        engine.onDenied = { room, reason in
            if room == "gideon:perf" {
                NotificationCenter.default.post(name: .nexusGideonPerfDenied, object: nil)
                return
            }
            guard reason == "revoked", !room.isEmpty else { return }
            let center = NotificationCenter.default
            center.post(name: .nexusRoomRevoked, object: nil, userInfo: [RealtimeKey.room: room])
            center.post(name: .nexusWorkspaceChanged, object: nil, userInfo: [RealtimeKey.kind: RealtimeKind.projects])
        }
    }

    // MARK: lifecycle

    /// Set while the app is in the background, so the next return to the front may retry a refusal.
    private var wasBackground = false

    /// Called by NexusApp whenever the session or the app's phase changes.
    func reconcile(session: Session?, phase: ScenePhase) {
        guard let session else {
            reset()
            return
        }
        if session.token != token {
            // Another sign-in: the previous one's connection, and anything the server said about it,
            // go with it.
            engine.stop()
            engine.clearRefusal()
            token = session.token
        }
        meId = session.userId
        if phase == .background {
            engine.stop()
            wasBackground = true
        } else if LiveRefresh.inFront(phase) {
            // Back from the background: a refusal gets one fresh try. It is not always the session's
            // fault — on 8 Oct 2026 the server read the wrong cookie name and refused everyone, and
            // the apps stayed "off" after the fix until they were killed. One attempt per return.
            if wasBackground { engine.clearRefusal() }
            wasBackground = false
            engine.start()
        }
        // `.inactive` on a phone (Control Centre, the app switcher, a call): neither. A link that is
        // up stays up for the few seconds that usually lasts; none is opened for it.
    }

    /// Signed out: close now, and forget the session.
    func reset() {
        taskVersions.reset()
        token = nil
        meId = nil
        engine.stop()
        engine.clearRefusal()
        calendarFlush?.cancel(); calendarFlush = nil
        attendanceFlush?.cancel(); attendanceFlush = nil; attendanceOwn = false
        chatFlush?.cancel()
        chatFlush = nil
        chatNews.removeAll()
    }

    func rememberTask(_ id: String, updatedAt: String?) { taskVersions.remember(id, updatedAt) }
    func rememberTasks(_ tasks: [BoardTask]) {
        for task in tasks { rememberTask(task.id, updatedAt: task.updatedAt) }
    }

    // MARK: rooms

    /// See `View.realtimeRoom(_:)`, which is how screens call these.
    func join(_ room: String) { engine.join(room) }
    func leave(_ room: String) { engine.leave(room) }

    /// "… is typing" for a chat (ChatTyping). Only while connected; false when nothing went out.
    @discardableResult
    func sendTyping(conversationId: String, typing: Bool) -> Bool {
        engine.emit("typing", .fields(["conversationId": .string(conversationId), "typing": .bool(typing)]))
    }

    func formFocus(formId: String, questionId: String?) {
        engine.emit("form-focus", .fields(["formId": .string(formId), "questionId": questionId.map(SIOJSON.string) ?? .null]))
    }

    // MARK: the connection

    /// `wss://` on the canonical host. Deliberately not the office LAN shortcut APIClient may take
    /// for a request: this link lives for hours, and the private address behind it stops existing
    /// the moment the phone leaves the building. The events are a few hundred bytes; latency is not
    /// what the shortcut would buy here.
    private static func upgradeRequest() -> URLRequest? {
        guard let session = Keychain.load(),
              var comps = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false) else { return nil }
        comps.scheme = "wss"
        comps.path = "/api/socket/"
        comps.percentEncodedQuery = "EIO=4&transport=websocket"
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        // The same session the API calls carry; `io.use` reads it from this header with next-auth's
        // getToken. No Origin is sent and none is needed: the server's CORS list only governs browsers.
        req.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        req.setValue(APIClient.clientTag, forHTTPHeaderField: "X-Nexus-Client")
        req.setValue(APIClient.userAgent, forHTTPHeaderField: "User-Agent")
        req.httpShouldHandleCookies = false
        // Above the server's ping window (25 s + 20 s) on purpose: on Apple's stack this also bounds
        // how long the open socket may sit idle. The engine's own 15 s deadline covers connecting.
        req.timeoutInterval = 60
        return req
    }

    private func stateChanged(_ new: RealtimeEngine.State) {
        state = new
        // No connection, no "typing": what was shown goes, and the server tells the others for us.
        if new != .connected { ChatTyping.shared.connectionLost() }
        LiveRefreshPolicy.stretch = new == .connected ? Self.connectedStretch : 1
    }

    /// After every connect: whatever was sent while the link was down is gone, so every live screen
    /// on display reloads once. The screens' quiet reloads are cheap and coalesce.
    private func catchUp() {
        NotificationCenter.default.post(name: .nexusRealtimeConnected, object: nil)
        let center = NotificationCenter.default
        center.post(name: .nexusWorkspaceChanged, object: nil)
        center.post(name: .nexusAuditChanged, object: nil)
        center.post(name: .nexusAttendanceChanged, object: nil)
        center.post(name: .nexusCalendarChanged, object: nil)
        center.post(name: .nexusXPChanged, object: nil)
        center.post(name: .nexusOwnXPChanged, object: nil)
        center.post(name: .nexusProjectTasksChanged, object: nil)
        center.post(name: .nexusInboxChanged, object: nil)
        center.post(name: .nexusPipelineChanged, object: nil)
        center.post(name: .nexusOutletSalesChanged, object: nil)
        center.post(name: .nexusAutomationsChanged, object: nil)
        center.post(name: .nexusDocChanged, object: nil)
        center.post(name: .nexusSheetStructure, object: nil, userInfo: [RealtimeKey.json: "{}"])
        center.post(name: .nexusFormResponsesChanged, object: nil)
        center.post(name: .nexusProjectChanged, object: nil)
        center.post(name: .nexusComplaintChanged, object: nil)
        Task { await CalendarWidgetPresence.refresh(force: true) }
        SheetOutbox.shared.flushAll()
        chatMoved(nil)
        Task { await InboxBadge.shared.refresh(force: true) }
    }

    // MARK: events → app

    private func route(_ name: String, _ payload: SIOJSON?) {
        let center = NotificationCenter.default
        switch name {
        case "workspace-changed":
            // Ids only, by design (lib/socket-emitter.ts): the screens refetch through the API.
            var info: [String: String] = [:]
            for key in [RealtimeKey.kind, RealtimeKey.projectId, RealtimeKey.folderId] {
                if let value = payload?[key]?.string { info[key] = value }
            }
            // A changed project icon rides along (server since 14 Oct 2026): a photo URL, or null when it
            // was removed. Patch every mark and the stored shortcuts now; the screens still refetch.
            if payload?[RealtimeKey.kind]?.string == RealtimeKind.projects,
               let pid = payload?[RealtimeKey.projectId]?.string, let raw = payload?["icon"] {
                let icon: String? = raw.string
                if icon != nil || raw == .null {
                    Task { @MainActor in
                        ProjectIconStore.shared.set(pid, icon)
                        ProjectShortcuts.shared.updateIcon(pid, icon)
                    }
                }
            }
            center.post(name: .nexusWorkspaceChanged, object: nil, userInfo: info)
        case "audit-changed":
            center.post(name: .nexusAuditChanged, object: nil)
        center.post(name: .nexusAttendanceChanged, object: nil)
        center.post(name: .nexusCalendarChanged, object: nil)
        center.post(name: .nexusXPChanged, object: nil)
        case "message-created", "conversation-updated":
            // `message-created` reaches the room of a thread that is open; `conversation-updated`
            // reaches every member's own room on a message, a read, a mute or a membership change.
            // Reason "deleted" (9 Oct 2026): the group is gone — an open thread of it closes now.
            if name == "conversation-updated", payload?["reason"]?.string == "deleted",
               let id = payload?["conversationId"]?.string {
                center.post(name: .nexusChatDeleted, object: nil, userInfo: [RealtimeKey.conversationId: id])
            }
            // A group's photo changed (22 Oct 2026): patched in place, so the list, the thread's header and
            // Group info swap it at once. The old file is deleted on the server, so the old url must go now.
            if name == "conversation-updated", payload?["change"]?.string == "avatar",
               let id = payload?["conversationId"]?.string {
                ChatStore.shared.setPhoto(id, url: payload?["avatarUrl"]?.string)
            }
            // A message from someone typing in that chat ends their dots.
            if name == "message-created" {
                ChatTyping.shared.messageArrived(conversationId: payload?["conversationId"]?.string,
                                                 userId: payload?["userId"]?.string)
            }
            chatMoved(payload?["conversationId"]?.string)
        case "typing":
            // Someone in one of this person's chats is typing (pages/api/socket.ts): the thread, its
            // title and the chat list show it. Nothing to fetch.
            ChatTyping.shared.received(payload, meId: meId)
        case "new-notification":
            Task { await InboxBadge.shared.refresh(force: true) }
            center.post(name: .nexusInboxChanged, object: nil)
        case "gideon-credits":
            Task { await GideonCredits.shared.refresh() }
        case "presence-changed":
            PresenceStore.shared.event(payload?.serialized ?? "{}")
        case "gideon-tiers":
            if let json = payload?["tiers"]?.serialized.data(using: .utf8),
               let tiers = try? JSONDecoder().decode([String: GideonTierAvailability].self, from: json) {
                GideonTierStatus.shared.accept(tiers)
            }
        case "gideon-perf":
            center.post(name: .nexusGideonPerf, object: nil, userInfo: [RealtimeKey.json: payload?.serialized ?? "{}"])
        case "reminders-changed":
            center.post(name: .nexusRemindersChanged, object: nil)
        case "calendar-changed":
            calendarFlush?.cancel()
            calendarFlush = Task {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                NotificationCenter.default.post(name: .nexusCalendarChanged, object: nil)
                await CalendarWidgetPresence.refresh(force: true)
            }
        case "attendance-changed", "attendance-board-changed":
            // R-15 (server since 19 Oct 2026, both only in this person's `user:` room): `attendance-changed`
            // is their own attendance (check-in/out, a request, an override, …), `attendance-board-changed`
            // someone whose attendance they may see ({ userIds, dates }, folded to one a second on the
            // server). Ids only: every loaded attendance screen refetches through the API, ~400 ms after
            // the last event so a burst is one refetch. Their own: the widgets and Live Activity follow.
            if name == "attendance-changed" { attendanceOwn = true }
            attendanceFlush?.cancel()
            attendanceFlush = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(400))
                guard let self, !Task.isCancelled else { return }
                let own = self.attendanceOwn
                self.attendanceOwn = false
                NotificationCenter.default.post(name: .nexusAttendanceChanged, object: nil)
                if own { await Self.refreshOwnAttendance() }
            }
        case "xp-changed":
            center.post(name: .nexusXPChanged, object: nil)
            if let meId, payload?["userIds"]?.array?.contains(where: { $0.string == meId }) == true {
                center.post(name: .nexusOwnXPChanged, object: nil)
            }
        case "form-ops", "form-presence":
            center.post(name: name == "form-ops" ? .nexusFormOps : .nexusFormPresence, object: nil, userInfo: [RealtimeKey.json: payload?.serialized ?? "{}"])
        case "meeting-changed":
            center.post(name: .nexusMeetingChanged, object: nil, userInfo: [RealtimeKey.json: payload?.serialized ?? "{}"])
        case "task-created", "task-updated":
            let id = payload?["id"]?.string
            let updatedAt = payload?["updatedAt"]?.string
            guard taskVersions.accepts(id, updatedAt) else { return }
            if let id { taskVersions.remember(id, updatedAt) }
            tasksChanged(taskId: payload?["id"]?.string, parentId: payload?["parentId"]?.string)
        case "task-deleted", "comment-added":
            tasksChanged(taskId: payload?["taskId"]?.string, parentId: nil)
        case "project-changed":
            projectChanged(payload)
        case "complaint-changed":
            // R-19: a ticket this person may open (theirs, or any of the workspace's for the board). Ids only.
            var info: [String: String] = [:]
            if let id = payload?["id"]?.string { info[RealtimeKey.itemId] = id }
            if let kind = payload?["kind"]?.string { info[RealtimeKey.kind] = kind }
            center.post(name: .nexusComplaintChanged, object: nil, userInfo: info)
        case "pipeline-changed":
            // A Pipeline Dashboard deal changed (owner, 9 Oct 2026). Ids only, like every event: the
            // open pipeline refetches GET …/pipeline. Unlike a task, a deal belongs to exactly one
            // project and the payload names it.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            if let dealId = payload?["dealId"]?.string { info[RealtimeKey.dealId] = dealId }
            center.post(name: .nexusPipelineChanged, object: nil, userInfo: info)
        case "outlet-sales-changed":
            // An Outlet Sales Dashboard changed (owner, 10 Oct 2026): an event created, edited, deleted
            // or restored, or a target set. `{ projectId, eventId | null, month | null, actorId }`; the
            // open outlet refetches whatever month it shows, so only the project is passed on.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            center.post(name: .nexusOutletSalesChanged, object: nil, userInfo: info)
        case "social-media-changed":
            // A Social Media Report changed (owner, 14 Oct 2026): a day recorded, a target or the platforms.
            // `{ projectId, date | null, month | null, actorId }`; the open report refetches its month.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            center.post(name: .nexusSocialMediaChanged, object: nil, userInfo: info)
        case "automations-changed":
            // A rule edited, toggled, deleted or run anywhere (12 Oct 2026): the open Automations tab and
            // run log refetch.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            if let automationId = payload?["automationId"]?.string { info[RealtimeKey.automationId] = automationId }
            center.post(name: .nexusAutomationsChanged, object: nil, userInfo: info)
        case "doc-changed":
            // A page's body or header changed (block editor on the web, an app edit merged into the live
            // room, a REST save): ids only, to the project's room. An open page re-reads it.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            center.post(name: .nexusDocChanged, object: nil, userInfo: info)
        case "form-responses-changed":
            // A form got or lost a response (ids only, to the project's room): an open Responses list reloads.
            var info: [String: String] = [:]
            if let projectId = payload?["projectId"]?.string { info[RealtimeKey.projectId] = projectId }
            if let formId = payload?["formId"]?.string { info[RealtimeKey.formId] = formId }
            center.post(name: .nexusFormResponsesChanged, object: nil, userInfo: info)
        case "sheet-cells", "sheet-structure":
            // The open spreadsheet's room (13 Oct 2026). Rows travel with `sheet-cells` (what the server
            // saved, never what another device claims); the screen applies them, skipping its own echo.
            let info: [String: String] = [RealtimeKey.json: payload?.serialized ?? "{}"]
            center.post(name: name == "sheet-cells" ? .nexusSheetCells : .nexusSheetStructure, object: nil, userInfo: info)
        default:
            // presence-*, sheet-presence / sheet-cursor, cursor-move, content-change, the web's own task-update relay:
            // nothing on iOS draws them.
            break
        }
    }

    /// The person's own today, read again for the widgets, the Watch and the Live Activity (R-15). Only
    /// while connected, which is only while the app is in front.
    private static func refreshOwnAttendance() async {
        guard let today = try? await APIClient.shared.attendanceToday() else { return }
        AttendancePresence.refresh(today: today)
    }

    /// `project-changed` { projectId, kind, id, actorId } (R-19, folded on the server to one per 300 ms per
    /// thing). Not skipped for this person's own changes: their other devices must move too. Task kinds also
    /// reach the screens that already follow task events (an open task detail by its id, the project's views),
    /// forms the forms lists, and members the project payload's own path.
    private func projectChanged(_ payload: SIOJSON?) {
        guard let projectId = payload?["projectId"]?.string, let kind = payload?["kind"]?.string else { return }
        let id = payload?["id"]?.string
        let center = NotificationCenter.default
        var info: [String: String] = [RealtimeKey.projectId: projectId, RealtimeKey.kind: kind]
        if let id { info[RealtimeKey.itemId] = id }
        center.post(name: .nexusProjectChanged, object: nil, userInfo: info)
        switch kind {
        case "task", "tasks":
            var tasks: [String: String] = [RealtimeKey.projectId: projectId]
            if let id { tasks[RealtimeKey.taskId] = id }
            center.post(name: .nexusProjectTasksChanged, object: nil, userInfo: tasks)
        case "forms":
            center.post(name: .nexusFormsChanged, object: nil)
        case "members":
            center.post(name: .nexusWorkspaceChanged, object: nil,
                        userInfo: [RealtimeKey.kind: RealtimeKind.projects, RealtimeKey.projectId: projectId])
        default:
            break
        }
    }

    /// Something changed among a project's tasks. Which project is told by the ROOM it came through,
    /// not by the payload: a task shown in two projects is sent to both rooms with the same body,
    /// whose own project is only one of them. This socket hears only project rooms it joined, so
    /// with one joined the project is certain; with several (rare) every open project screen reloads.
    private func tasksChanged(taskId: String?, parentId: String?) {
        var info: [String: String] = [:]
        let projects = engine.rooms.filter { $0.hasPrefix("project:") }
        if projects.count == 1, let room = projects.first {
            info[RealtimeKey.projectId] = String(room.dropFirst("project:".count))
        }
        if let taskId { info[RealtimeKey.taskId] = taskId }
        if let parentId { info[RealtimeKey.parentId] = parentId }
        NotificationCenter.default.post(name: .nexusProjectTasksChanged, object: nil, userInfo: info)
    }

    /// A chat moved: the same signal a chat push gives (`.nexusChatPush`), so the list, the unread
    /// badges and an open thread of that conversation all follow through the paths they already
    /// have. nil = "some chat may have moved" (the catch-up): list and badges, and any open thread.
    private func chatMoved(_ conversationId: String?) {
        chatNews.insert(conversationId ?? "")
        guard chatFlush == nil else { return }
        chatFlush = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard let self, !Task.isCancelled else { return }
            let ids = self.chatNews
            self.chatNews.removeAll()
            self.chatFlush = nil
            for id in ids.sorted() {
                NotificationCenter.default.post(name: .nexusChatPush, object: nil,
                                                userInfo: id.isEmpty ? nil : ["conversationId": id])
            }
        }
    }
}
