package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.realtime.RealtimeEvent
import id.znetworks.nexus.core.realtime.RealtimeEvents
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// "… is typing", like WhatsApp (owner, 9 Oct; TYPING.md, iOS d4244ab). Realtime only: nothing stored, pushed or polled.

data class Typer(val userId: String, val name: String?, val avatar: String?, val until: Long)

/** conversationId → who is typing there, in the order they started (each expires 6 s after their last "true"). */
class TypingStore(private val now: () -> Long = System::currentTimeMillis) {
    private val _rooms = MutableStateFlow<Map<String, List<Typer>>>(emptyMap())
    val rooms: StateFlow<Map<String, List<Typer>>> = _rooms.asStateFlow()

    fun apply(e: RealtimeEvent, meId: String?) {
        val cid = e.conversationId ?: return
        val uid = e.userId ?: return
        if (uid == meId) return // never sent to our own sockets; ignored anyway
        when {
            e.name == RealtimeEvents.TYPING && e.typing == true -> update(cid) { list ->
                val t = Typer(uid, e.personName?.trim()?.takeIf { it.isNotEmpty() }, e.avatar, now() + EXPIRY_MS)
                if (list.any { it.userId == uid }) list.map { if (it.userId == uid) t else it } else list + t
            }
            // Stopped, or sent the message.
            e.name == RealtimeEvents.TYPING || e.name == RealtimeEvents.MESSAGE_CREATED -> update(cid) { list -> list.filterNot { it.userId == uid } }
        }
    }

    /** Drop the ones whose 6 s ran out. */
    fun expire() { val t = now(); _rooms.value = _rooms.value.mapValues { (_, l) -> l.filter { it.until > t } }.filterValues { it.isNotEmpty() } }
    /** The socket went away: nobody is known to be typing. */
    fun clear() { _rooms.value = emptyMap() }
    fun isEmpty() = _rooms.value.isEmpty()

    private fun update(cid: String, f: (List<Typer>) -> List<Typer>) {
        val next = f(_rooms.value[cid].orEmpty())
        _rooms.value = if (next.isEmpty()) _rooms.value - cid else _rooms.value + (cid to next)
    }

    companion object { const val EXPIRY_MS = 6_000L }
}

/**
 * What this phone says while someone types in [conversationId]: `true` at most every 3 s while the text isn't
 * blank; `false` when it empties, on send, on losing focus, after 5 s idle, and on leaving — only after a `true`
 * went out. A dropped socket forgets the state (the server already told the others).
 */
class TypingSender(private val conversationId: String, private val send: (String, Boolean) -> Boolean, private val now: () -> Long = System::currentTimeMillis) {
    private var sentTrueAt: Long? = null

    fun onText(text: String) {
        if (text.isBlank()) { stop(); return }
        val last = sentTrueAt
        if (last == null || now() - last >= RESEND_MS) { if (send(conversationId, true)) sentTrueAt = now() }
    }

    /** Sent, blurred, idle for 5 s, or leaving the thread. */
    fun stop() { if (sentTrueAt != null) { send(conversationId, false); sentTrueAt = null } }

    /** The socket dropped: nothing to take back. */
    fun forget() { sentTrueAt = null }

    companion object { const val RESEND_MS = 3_000L; const val IDLE_MS = 5_000L }
}

object TypingText {
    /** The thread's sentence: GROUP/PROJECT name it, a DM shows only the dots (null). */
    fun sentence(typers: List<Typer>, isDm: Boolean, oneNamed: (String) -> String, someone: String, many: (Int) -> String): String? = when {
        typers.isEmpty() || isDm -> null
        typers.size == 1 -> oneNamed(typers[0].name ?: someone)
        else -> many(typers.size)
    }
}
