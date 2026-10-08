package id.znetworks.nexus.core.realtime

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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
    const val SPRINT_UPDATED = "sprint-updated"

    val LISTENED = listOf(WORKSPACE_CHANGED, AUDIT_CHANGED, CONVERSATION_UPDATED, MESSAGE_CREATED, NEW_NOTIFICATION, SPRINT_UPDATED) + TASK

    /** The handshake refusals (a deleted, offboarded or revoked session): stop until the next sign-in. */
    private val AUTH_REFUSALS = listOf("Authentication required", "Invalid session", "Authentication failed")
    fun isAuthError(text: String?) = text != null && AUTH_REFUSALS.any { text.contains(it) }

    /** [json] is the event's first argument as JSON text (an object, or nothing). Unknown shapes give a bare event. */
    fun parse(name: String, json: String?): RealtimeEvent {
        val o = json?.let { runCatching { NexusJson.parseToJsonElement(it) as? JsonObject }.getOrNull() } ?: return RealtimeEvent(name)
        fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return when (name) {
            // { kind: projects|folders|audit, projectId?, folderId? }
            WORKSPACE_CHANGED, AUDIT_CHANGED -> RealtimeEvent(name, kind = o.str("kind"), projectId = o.str("projectId"), folderId = o.str("folderId"))
            // { conversationId, lastMessageAt, reason? } / the message itself
            CONVERSATION_UPDATED, MESSAGE_CREATED -> RealtimeEvent(name, conversationId = o.str("conversationId"))
            // the task itself / { taskId } / { taskId, comment }
            "task-created", "task-updated" -> RealtimeEvent(name, taskId = o.str("id"), projectId = o.str("projectId"))
            "task-deleted", "comment-added" -> RealtimeEvent(name, taskId = o.str("taskId"))
            SPRINT_UPDATED -> RealtimeEvent(name, projectId = o.str("projectId"))
            else -> RealtimeEvent(name)
        }
    }

    /** Fallback polling (ANDROID-REALTIME): rare while the socket is up, today's pace while it is not. */
    fun interval(connected: Boolean, liveMs: Long, fallbackMs: Long) = if (connected) liveMs else fallbackMs

    fun isAudit(e: RealtimeEvent) = e.name == AUDIT_CHANGED || (e.name == WORKSPACE_CHANGED && e.kind == "audit")
    fun isProjectsOrFolders(e: RealtimeEvent) = e.name == WORKSPACE_CHANGED && (e.kind == "projects" || e.kind == "folders")
    /** Something about this project: its tasks (project room) or the project itself (workspace room). */
    fun touchesProject(e: RealtimeEvent, projectId: String) =
        e.name in TASK || e.name == SPRINT_UPDATED || (e.name == WORKSPACE_CHANGED && e.kind == "projects" && (e.projectId == null || e.projectId == projectId))
    /** Something about this task (task-created never is: it is a new one). */
    fun touchesTask(e: RealtimeEvent, taskId: String) = e.name != "task-created" && e.name in TASK && e.taskId == taskId
}

/**
 * Socket.IO v4 at `/api/socket` (Berlin, 8 Oct): the same session cookie as the API, on the app's own
 * OkHttp (identity headers, LAN route and the cookie-on-redirect guard all apply). Connected while signed
 * in and the app is in front; the server puts us in our workspace rooms (+ `audit`); we join `user:<me>`
 * and whatever the screens ask for ([join]/[leave], counted). Push stays for the background.
 */
class Realtime(private val http: OkHttpClient, private val baseUrl: String, private val session: () -> Session?) {
    enum class State { OFF, CONNECTING, CONNECTED, RECONNECTING }

    private val _state = MutableStateFlow(State.OFF)
    val state: StateFlow<State> = _state.asStateFlow()
    val connected: Boolean get() = _state.value == State.CONNECTED

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    private var socket: Socket? = null
    private var me: String? = null
    private val rooms = mutableMapOf<String, Int>()
    /** The server refused this session: no retry loop until the next sign-in. */
    private var refused = false

    @Synchronized
    fun start() {
        val s = session() ?: return
        if (refused || socket != null) return
        val opts = IO.Options.builder()
            .setPath("/api/socket")
            .setTransports(arrayOf(WebSocket.NAME))
            .setReconnection(true)
            .setReconnectionDelay(1_000).setReconnectionDelayMax(30_000).setRandomizationFactor(0.5)
            .setExtraHeaders(mapOf("Cookie" to listOf("${s.cookieName}=${s.token}")))
            .build()
        opts.callFactory = http
        opts.webSocketFactory = http
        val sock = IO.socket(URI.create(baseUrl), opts)
        me = s.userId
        sock.on(Socket.EVENT_CONNECT) { onConnected(sock) }
        sock.on(Socket.EVENT_DISCONNECT) { synchronized(this) { if (socket === sock) _state.value = State.RECONNECTING } }
        sock.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val text = args.firstOrNull()?.let { (it as? Throwable)?.message ?: (it as? JSONObject)?.optString("message") ?: it.toString() }
            if (RealtimeEvents.isAuthError(text)) { synchronized(this) { refused = true }; stop() }
            else synchronized(this) { if (socket === sock) _state.value = State.RECONNECTING }
        }
        RealtimeEvents.LISTENED.forEach { ev -> sock.on(ev) { args -> _events.tryEmit(RealtimeEvents.parse(ev, args.firstOrNull()?.toString())) } }
        socket = sock
        _state.value = State.CONNECTING
        sock.connect()
    }

    @Synchronized
    fun stop() {
        socket?.let { it.off(); it.disconnect(); it.close() }
        socket = null
        _state.value = State.OFF
    }

    /** Signed out: off, rooms forgotten, a refused session may try again with the next one. */
    @Synchronized
    fun reset() { stop(); rooms.clear(); refused = false }

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
}
