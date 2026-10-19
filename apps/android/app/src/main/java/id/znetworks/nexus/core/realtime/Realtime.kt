package id.znetworks.nexus.core.realtime

import java.util.concurrent.TimeUnit
import okhttp3.Request
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.net.URI

/**
 * One server ping. They carry ids only (ANDROID-REALTIME): the screen on display refetches what it shows.
 * [name] is the Socket.IO event, or [RealtimeEvents.RECONNECTED] after every (re)connect.
 */
data class RealtimeEvent(
    val name: String,
    val kind: String? = null,
    val projectId: String? = null,
    val folderId: String? = null,
    val conversationId: String? = null,
    val taskId: String? = null,
    /** conversation-updated: "message" | "read" | "mute" | "membership" | "deleted" (9 Oct). */
    val reason: String? = null,
    /** typing (9 Oct, TYPING.md) and message-created: who; typing also says name, avatar and on/off. */
    val userId: String? = null,
    val personName: String? = null,
    val avatar: String? = null,
    /**
     * workspace-changed { kind: "projects", projectId, icon }: the project's new mark when a PATCH changed it (a photo
     * URL with ?v=…, or "folder"/null after removal; owner 14 Oct 2026). [iconChanged] says the key was there at all.
     */
    val icon: String? = null,
    val iconChanged: Boolean = false,
    val typing: Boolean? = null,
    /** The payload as JSON text, for screens that read more than the ids (the Spreadsheet's `sheet-cells`). */
    val raw: String? = null,
    val updatedAt: String? = null,
    val userIds: List<String> = emptyList(),
)

/** The wire: event names and how their payloads read (pages/api/socket.ts, lib/socket-emitter.ts). */
object RealtimeEvents {
    /** Synthetic: the socket is (back) up and its rooms re-joined; whatever is on screen may be stale. */
    const val RECONNECTED = "reconnected"
    const val WORKSPACE_CHANGED = "workspace-changed"
    const val AUDIT_CHANGED = "audit-changed"
    const val CONVERSATION_UPDATED = "conversation-updated"
    const val MESSAGE_CREATED = "message-created"
    const val NEW_NOTIFICATION = "new-notification"
    val TASK = setOf("task-created", "task-updated", "task-deleted", "comment-added")
    /** "… is typing" (TYPING.md): realtime only, nothing stored or pushed. */
    const val TYPING = "typing"
    /** A Pipeline Dashboard deal changed (project room; PIPELINE-DASHBOARD §6): refetch the pipeline. */
    const val PIPELINE_CHANGED = "pipeline-changed"
    /** An outlet's event or month target changed (project room; OUTLET-SALES §9): a ping, refetch the month shown. */
    const val OUTLET_SALES_CHANGED = "outlet-sales-changed"
    const val SOCIAL_MEDIA_CHANGED = "social-media-changed"
    /** A project's automation was made, changed, toggled, deleted or ran (project room; DEV-REDESIGN §2): refetch the list / run log. */
    const val AUTOMATIONS_CHANGED = "automations-changed"
    /** Taken out of a room (server 13 Oct): `{ room, reason }`; reason "revoked" = access to that project ended. */
    const val JOIN_DENIED = "join-denied"
    /** A form got (or lost) a response (project room, 13 Oct): `{ projectId, formId }`. */
    const val FORM_RESPONSES_CHANGED = "form-responses-changed"
    const val FORM_OPS = "form-ops"
    const val FORM_PRESENCE = "form-presence"
    const val ATTENDANCE_CHANGED = "attendance-changed"
    const val ATTENDANCE_BOARD_CHANGED = "attendance-board-changed"
    const val XP_CHANGED = "xp-changed"
    const val CALENDAR_CHANGED = "calendar-changed"

    val LISTENED = listOf(WORKSPACE_CHANGED, AUDIT_CHANGED, CONVERSATION_UPDATED, MESSAGE_CREATED, NEW_NOTIFICATION, TYPING, PIPELINE_CHANGED,
        OUTLET_SALES_CHANGED, SOCIAL_MEDIA_CHANGED, AUTOMATIONS_CHANGED, JOIN_DENIED, FORM_RESPONSES_CHANGED, FORM_OPS, FORM_PRESENCE, ATTENDANCE_CHANGED, ATTENDANCE_BOARD_CHANGED, XP_CHANGED, CALENDAR_CHANGED, "sheet-cells", "sheet-structure", "gideon-tiers", "gideon-perf", "meeting-changed", "reminders-changed", "presence-changed") + TASK


    /**
     * The handshake refusals that are about the session (deleted, offboarded, revoked, no cookie): stop, and
     * try again once on the next return to the front. "Authentication failed" is NOT one: it is the
     * server's catch-all for an exception in its auth step, so it is retried like a dropped connection.
     */
    private val AUTH_REFUSALS = listOf("Authentication required", "Invalid session")
    fun isAuthError(text: String?) = text != null && AUTH_REFUSALS.any { text.contains(it) }

    /** Wait before attempt [n] (1-based after a failure): 1, 2, 4, 8, 16, 30, 30 … s, ±50 % jitter ([jitter] in 0..1). */
    fun backoffMs(n: Int, jitter: Double): Long {
        val base = (1_000L shl (n - 1).coerceIn(0, 5)).coerceAtMost(30_000L)
        return (base * (0.5 + jitter)).toLong()
    }

    /** [json] is the event's first argument as JSON text (an object, or nothing). Unknown shapes give a bare event. */
    fun parse(name: String, json: String?): RealtimeEvent {
        val o = json?.let { runCatching { NexusJson.parseToJsonElement(it) as? JsonObject }.getOrNull() } ?: return RealtimeEvent(name)
        fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return when (name) {
            // { kind: projects|folders|audit, projectId?, folderId? }
            WORKSPACE_CHANGED, AUDIT_CHANGED -> RealtimeEvent(name, kind = o.str("kind"), projectId = o.str("projectId"), folderId = o.str("folderId"),
                icon = o.str("icon"), iconChanged = o.containsKey("icon"))
            // { conversationId, lastMessageAt, reason? } / the message itself
            CONVERSATION_UPDATED -> RealtimeEvent(name, conversationId = o.str("conversationId"), reason = o.str("reason"))
            // The message itself: its sender ends their "typing".
            MESSAGE_CREATED -> RealtimeEvent(name, conversationId = o.str("conversationId"), userId = o.str("userId") ?: (o["user"] as? JsonObject)?.str("id"))
            TYPING -> RealtimeEvent(name, conversationId = o.str("conversationId"), userId = o.str("userId"), personName = o.str("name"), avatar = o.str("avatar"),
                typing = (o["typing"] as? JsonPrimitive)?.booleanOrNull)
            // the task itself / { taskId } / { taskId, comment }
            "task-created", "task-updated" -> RealtimeEvent(name, taskId = o.str("id"), projectId = o.str("projectId"), updatedAt = o.str("updatedAt"))
            "task-deleted", "comment-added" -> RealtimeEvent(name, taskId = o.str("taskId"))
            PIPELINE_CHANGED -> RealtimeEvent(name, projectId = o.str("projectId"), taskId = o.str("dealId"), userId = o.str("actorId"))
            OUTLET_SALES_CHANGED -> RealtimeEvent(name, projectId = o.str("projectId"), taskId = o.str("eventId"), userId = o.str("actorId"))
            // { projectId, automationId, actorId }
            AUTOMATIONS_CHANGED -> RealtimeEvent(name, projectId = o.str("projectId"), taskId = o.str("automationId"), userId = o.str("actorId"))
            // { sheetId, rows?, actorId, originTab? } (sheet room): the sheet's id rides in taskId, the whole payload in raw.
            "sheet-cells", "sheet-structure" -> RealtimeEvent(name, taskId = o.str("sheetId"), userId = o.str("actorId"), raw = json)
            // { projectId, formId } (the form's id rides in taskId)
            FORM_RESPONSES_CHANGED -> RealtimeEvent(name, projectId = o.str("projectId"), taskId = o.str("formId"))
            FORM_OPS, FORM_PRESENCE -> RealtimeEvent(name, projectId = o.str("projectId"), taskId = o.str("formId"), raw = json)
            ATTENDANCE_CHANGED -> RealtimeEvent(name, kind = o.str("kind"), taskId = o.str("id"), raw = json)
            ATTENDANCE_BOARD_CHANGED -> RealtimeEvent(name, raw = json)
            XP_CHANGED -> RealtimeEvent(name, userIds = (o["userIds"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }, raw = json)
            CALENDAR_CHANGED -> RealtimeEvent(name, userId = o.str("actorId"), raw = json)
            // { room: "project:<id>" | "sheet:<id>", reason }
            JOIN_DENIED -> o.str("room").let { room -> RealtimeEvent(name, reason = o.str("reason"),
                projectId = room?.takeIf { it.startsWith("project:") }?.removePrefix("project:"), taskId = room?.takeIf { it.startsWith("sheet:") }?.removePrefix("sheet:"), raw = json) }
            else -> RealtimeEvent(name, kind = o.str("kind"), projectId = o.str("projectId"), raw = json)
        }
    }

    /** Fallback polling (ANDROID-REALTIME): rare while the socket is up, today's pace while it is not. */
    fun interval(connected: Boolean, liveMs: Long, fallbackMs: Long) = if (connected) liveMs else fallbackMs

    /** A group deleted (DELETE-GROUP): its room leaves the list, an open thread of it closes. */
    fun groupDeleted(e: RealtimeEvent, conversationId: String? = null) =
        e.name == CONVERSATION_UPDATED && e.reason == "deleted" && (conversationId == null || e.conversationId == conversationId)

    fun isAudit(e: RealtimeEvent) = e.name == AUDIT_CHANGED || (e.name == WORKSPACE_CHANGED && e.kind == "audit")
    /** Both are server-scoped pings. Unknown kinds and old payloads still require an API refetch. */
    fun isAttendance(e: RealtimeEvent) = e.name == ATTENDANCE_CHANGED || e.name == ATTENDANCE_BOARD_CHANGED
    fun isProjectsOrFolders(e: RealtimeEvent) = e.name == WORKSPACE_CHANGED && (e.kind == "projects" || e.kind == "folders")
    /** The server sends this only to the task's assignees, including assignment changes. */
    fun isMyTasks(e: RealtimeEvent) = e.name == WORKSPACE_CHANGED && e.kind == "tasks"
    /** Something about this project: its tasks (project room) or the project itself (workspace room). */
    fun touchesProject(e: RealtimeEvent, projectId: String) =
        e.name in TASK || (e.name == WORKSPACE_CHANGED && e.kind == "projects" && (e.projectId == null || e.projectId == projectId)) || revoked(e, projectId)
    /** Access to [projectId] ended while its room was held: refetch (→ the no-access state) and say so. */
    fun revoked(e: RealtimeEvent, projectId: String) = e.name == JOIN_DENIED && e.reason == "revoked" && e.projectId == projectId

    /** [formId]'s responses changed (or any form's, when the server names none). */
    fun formResponses(e: RealtimeEvent, formId: String) = e.name == FORM_RESPONSES_CHANGED && (e.taskId == null || e.taskId == formId)

    /** Something about this task (task-created never is: it is a new one). */
    fun touchesTask(e: RealtimeEvent, taskId: String) = e.name != "task-created" && e.name in TASK && e.taskId == taskId
}

/**
 * Socket.IO v4 at `/api/socket` (owner, 8 Oct): the same session cookie as the API, on the app's own
 * OkHttp (identity headers, LAN route and the cookie-on-redirect guard all apply). Connected while signed
 * in and the app is in front; the server puts us in our workspace rooms (+ `audit`); we join `user:<me>`
 * and whatever the screens ask for ([join]/[leave], counted). Push stays for the background.
 *
 * The retry loop is ours, not the library's: before EVERY attempt it calls GET /api/realtime-init, which
 * attaches the server's Socket.IO engine (lazily, per server process) — without it a websocket after a
 * server restart is never answered. A refusal about the session stops the loop; the next return to the
 * front clears it once (iOS af0000f: on 8 Oct the server refused every socket for a bug of its own).
 */
class Realtime(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val session: () -> Session?,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    /** GET /api/realtime-init; best effort, the attempt goes ahead whatever it answers. Tests replace it. */
    bootstrap: (suspend () -> Unit)? = null,
    /** One connection, suspended until it ends. Tests replace it. */
    connect: (suspend (Session) -> Outcome)? = null,
    private val jitter: () -> Double = { Math.random() },
) {
    enum class State { OFF, CONNECTING, CONNECTED, RECONNECTING }
    /** How one connection ended: refused for the session, or dropped/failed after having [connected] or not. */
    sealed interface Outcome { object Refused : Outcome; data class Dropped(val connected: Boolean) : Outcome }

    private val _state = MutableStateFlow(State.OFF)
    val state: StateFlow<State> = _state.asStateFlow()
    val connected: Boolean get() = _state.value == State.CONNECTED

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    private val bootstrapFn: suspend () -> Unit = bootstrap ?: ::bootstrapServer
    private val connectFn: suspend (Session) -> Outcome = connect ?: ::connectSocket
    private val initClient by lazy { http.newBuilder().callTimeout(10, TimeUnit.SECONDS).build() }

    private var loop: Job? = null
    private var socket: Socket? = null
    private var me: String? = null
    private val rooms = mutableMapOf<String, Int>()
    /** The server refused this session: no retry until the next sign-in or return to the front. */
    private var refused = false
    /** Set by [stop] (the app went to the background): the next [start] may retry a refusal once. */
    private var wasBackground = false

    /** Signed in and in front (app start, every return to the front, sign-in). Idempotent. */
    @Synchronized
    fun start() {
        if (wasBackground) { refused = false; wasBackground = false }
        val s = session() ?: return
        if (refused || loop?.isActive == true) return
        me = s.userId
        loop = scope.launch { run(s) }
    }

    private suspend fun run(s: Session) {
        var failures = 0
        while (currentCoroutineContext().isActive) {
            _state.value = if (failures == 0) State.CONNECTING else State.RECONNECTING
            bootstrapFn()
            when (val o = connectFn(s)) {
                Outcome.Refused -> { synchronized(this) { refused = true }; _state.value = State.OFF; return }
                is Outcome.Dropped -> {
                    failures = if (o.connected) 1 else failures + 1
                    _state.value = State.RECONNECTING
                    delay(RealtimeEvents.backoffMs(failures, jitter()))
                }
            }
        }
    }

    private suspend fun bootstrapServer() {
        withContext(Dispatchers.IO) {
            runCatching { initClient.newCall(Request.Builder().url("$baseUrl/api/realtime-init").get().build()).execute().close() }
        }
    }

    /** One Socket.IO connection (the library's own reconnection off), suspended until it ends. */
    private suspend fun connectSocket(s: Session): Outcome {
        val opts = IO.Options.builder()
            .setPath("/api/socket")
            .setTransports(arrayOf(WebSocket.NAME))
            .setReconnection(false)
            .setForceNew(true)
            .setExtraHeaders(mapOf("Cookie" to listOf("${s.cookieName}=${s.token}")))
            .build()
        opts.callFactory = http
        opts.webSocketFactory = http
        val sock = IO.socket(URI.create(baseUrl), opts)
        val end = CompletableDeferred<Outcome>()
        var wasUp = false
        sock.on(Socket.EVENT_CONNECT) { wasUp = true; onConnected(sock) }
        sock.on(Socket.EVENT_DISCONNECT) { end.complete(Outcome.Dropped(wasUp)) }
        sock.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val text = args.firstOrNull()?.let { (it as? Throwable)?.message ?: (it as? JSONObject)?.optString("message") ?: it.toString() }
            end.complete(if (RealtimeEvents.isAuthError(text)) Outcome.Refused else Outcome.Dropped(wasUp))
        }
        RealtimeEvents.LISTENED.forEach { ev ->
            sock.on(ev) { args ->
                val e = RealtimeEvents.parse(ev, args.firstOrNull()?.toString())
                // A project's photo changed: every mark of it updates at once, before any screen refetches.
                if (e.name == RealtimeEvents.WORKSPACE_CHANGED && e.kind == "projects" && e.iconChanged && e.projectId != null)
                    id.znetworks.nexus.feature.projects.ProjectIcons.put(e.projectId, e.icon)
                _events.tryEmit(e)
            }
        }
        synchronized(this) { socket = sock }
        return try {
            sock.connect()
            end.await()
        } finally {
            synchronized(this) { if (socket === sock) socket = null }
            sock.off(); sock.disconnect(); sock.close()
        }
    }

    /** The app went to the background (or a sign-out through [reset]). */
    @Synchronized
    fun stop() {
        wasBackground = true
        loop?.cancel(); loop = null
        socket?.let { it.off(); it.disconnect(); it.close() }
        socket = null
        _state.value = State.OFF
    }

    /** Signed out: off, rooms forgotten, a refused session may try again with the next one. */
    @Synchronized
    fun reset() { stop(); rooms.clear(); refused = false; wasBackground = false }

    /** After every (re)connect: `user:<me>` and the screens' rooms again, then the screens refetch. */
    @Synchronized
    private fun onConnected(sock: Socket) {
        if (socket !== sock) return
        _state.value = State.CONNECTED
        (listOfNotNull(me?.let { "user:$it" }) + rooms.keys).forEach { emitJoin(sock, it) }
        _events.tryEmit(RealtimeEvent(RealtimeEvents.RECONNECTED))
    }

    private fun emitJoin(sock: Socket, room: String) {
        // The server takes who we are from the session, never from this payload.
        sock.emit("join-room", JSONObject().put("room", room).put("userId", me ?: "").put("name", ""))
    }

    /**
     * `typing` for a room this socket sits in (the thread's `conversation:<id>`). Nothing goes out while the
     * socket is down (TYPING.md: realtime only, never queued). Returns whether it was sent.
     */
    @Synchronized
    fun sendTyping(conversationId: String, typing: Boolean): Boolean {
        val sock = socket?.takeIf { connected } ?: return false
        sock.emit(RealtimeEvents.TYPING, JSONObject().put("conversationId", conversationId).put("typing", typing))
        return true
    }

    @Synchronized
    fun sendFormFocus(formId: String, questionId: String?): Boolean {
        val sock = socket?.takeIf { connected && rooms.containsKey("form:$formId") } ?: return false
        sock.emit("form-focus", JSONObject().put("formId", formId).put("questionId", questionId ?: JSONObject.NULL))
        return true
    }

    @Synchronized
    fun join(room: String) {
        val n = (rooms[room] ?: 0) + 1
        rooms[room] = n
        if (n == 1) socket?.takeIf { connected }?.let { emitJoin(it, room) }
    }

    @Synchronized
    fun leave(room: String) {
        val n = (rooms[room] ?: return) - 1
        if (n > 0) { rooms[room] = n; return }
        rooms.remove(room)
        socket?.takeIf { connected }?.emit("leave-room", room)
    }

    /** For tests: the rooms screens hold now. */
    @Synchronized
    internal fun heldRooms(): Set<String> = rooms.keys.toSet()

    /** For tests: whether a refusal is holding the loop off. */
    @Synchronized
    internal fun isRefused(): Boolean = refused
}
