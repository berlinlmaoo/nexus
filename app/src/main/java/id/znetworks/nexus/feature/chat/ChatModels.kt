package id.znetworks.nexus.feature.chat

import kotlinx.serialization.Serializable

// API.md §2.5 Messages. Tolerant like every model.

@Serializable
data class ChatUser(val id: String? = null, val name: String? = null, val avatar: String? = null, val email: String? = null)

@Serializable
data class ChatMember(val id: String? = null, val userId: String? = null, val lastReadAt: String? = null, val user: ChatUser? = null) {
    val uid: String get() = userId ?: user?.id.orEmpty()
    val displayName: String get() = user?.name ?: "?"
}

@Serializable
data class ReplyRef(val id: String, val content: String = "", val attachmentType: String? = null, val user: ChatUser? = null)

@Serializable
data class Message(
    val id: String,
    val conversationId: String? = null,
    val userId: String? = null,
    val content: String = "",
    val attachmentUrl: String? = null,
    val attachmentType: String? = null,
    val replyToId: String? = null,
    val createdAt: String? = null,
    val user: ChatUser? = null,
    val replyTo: ReplyRef? = null,
) {
    val isImage: Boolean get() = attachmentUrl != null && attachmentType.orEmpty().startsWith("image/")
}

@Serializable
data class Conversation(
    val id: String,
    val type: String = "DM",
    val name: String? = null,
    val projectId: String? = null,
    val members: List<ChatMember> = emptyList(),
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    /** Muted until then (ISO; far future = always); null = not muted. Servers before 8 Oct send none. */
    val mutedUntil: String? = null,
    /** Whether you may add or remove members of this GROUP (owner, 8 Oct: Manager and above). Null = a server from before the rule. */
    val canManageMembers: Boolean? = null,
) {
    fun muted(nowMs: Long = System.currentTimeMillis()): Boolean =
        mutedUntil?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() > nowMs }.getOrDefault(true) } ?: false
    /** A DM is titled by the other person; a group or project room by its name. */
    fun title(meId: String?): String = when (type) {
        "DM" -> members.firstOrNull { it.uid != meId }?.displayName ?: name ?: "—"
        else -> name ?: members.filter { it.uid != meId }.joinToString(", ") { it.displayName }.ifBlank { "—" }
    }
    fun other(meId: String?): ChatUser? = if (type == "DM") members.firstOrNull { it.uid != meId }?.user else null
}

@Serializable
data class ConversationsResponse(val conversations: List<Conversation> = emptyList(), val totalUnread: Int? = null) {
    /** The server's total (unmuted), else the sum over conversations that are not muted (older servers). */
    fun unread(nowMs: Long = System.currentTimeMillis()): Int = totalUnread ?: conversations.filter { !it.muted(nowMs) }.sumOf { it.unreadCount }
}

@Serializable
data class UnreadResponse(val totalUnread: Int = 0, val mentions: Int = 0)

@Serializable
data class MuteResponse(val mutedUntil: String? = null)

@Serializable
data class ConversationResponse(val conversation: Conversation)

@Serializable
data class MessagesResponse(val messages: List<Message> = emptyList(), val hasMore: Boolean = false, val nextCursor: String? = null)

@Serializable
data class ChatUpload(val url: String, val type: String? = null)

/**
 * Richer messages survive as plain strings (the web still reads them); the app upgrades the known
 * patterns to cards (iOS ChatPayload).
 */
sealed interface ChatPayload {
    data class Location(val lat: Double, val lng: Double) : ChatPayload {
        val url get() = "https://www.google.com/maps?q=$lat,$lng"
    }
    data class Task(val id: String, val title: String) : ChatPayload
    data object Plain : ChatPayload

    companion object {
        fun parse(content: String): ChatPayload {
            // "📍 Lokasi saya: https://www.google.com/maps?q=<lat>,<lng>"
            val at = content.indexOf("google.com/maps?q=")
            if (at >= 0) {
                val coords = content.substring(at + "google.com/maps?q=".length).takeWhile { !it.isWhitespace() }.split(',')
                val lat = coords.getOrNull(0)?.toDoubleOrNull()
                val lng = coords.getOrNull(1)?.toDoubleOrNull()
                if (coords.size == 2 && lat != null && lng != null) return Location(lat, lng)
            }
            // "📋 Task: <title> [task:<id>]"
            val open = content.indexOf("[task:")
            if (open >= 0) {
                val close = content.indexOf(']', open)
                if (close > open + 6) {
                    val id = content.substring(open + 6, close)
                    val title = content.substring(0, open).replace("📋 Task:", "").trim()
                    return Task(id, title)
                }
            }
            return Plain
        }

        fun location(lat: Double, lng: Double, label: String) = "📍 $label: https://www.google.com/maps?q=$lat,$lng"
        fun task(id: String, title: String) = "📋 Task: $title [task:$id]"
    }
}

object Mentions {
    /** "@Nama" with spaces stripped, so it stays one token the server can resolve. */
    fun tag(name: String) = "@" + name.replace(" ", "")

    /** The mention being typed at the end of [input] ("hi @ali" → "ali"), or null outside one. */
    fun query(input: String): String? {
        val at = input.lastIndexOf('@')
        if (at < 0) return null
        if (at > 0 && !input[at - 1].isWhitespace()) return null
        val q = input.substring(at + 1)
        return if (q.any { it.isWhitespace() }) null else q
    }

    /** Replaces the half-typed "@ali" with the full tag (or appends it). */
    fun insert(input: String, name: String): String {
        val t = tag(name) + " "
        return if (query(input) != null) input.substring(0, input.lastIndexOf('@')) + t
        else (if (input.isEmpty() || input.endsWith(" ")) input else "$input ") + t
    }

    /** The members whose tag is still in the final text. */
    fun ids(text: String, picked: Map<String, String>) = picked.filterValues { it in text }.keys.toList()
}

/** Who may grow a room (ANDROID-GROUP-ADMINS, owner 8 Oct; iOS showsAddPeople). */
object ChatRules {
    /** A project room adds through the project; a GROUP only when the server has not said no; a DM never. */
    fun showsAddPeople(conv: Conversation?): Boolean =
        conv != null && (conv.projectId != null || (conv.type == "GROUP" && conv.canManageMembers != false))

    /** The server's 403 for someone below Manager, told apart from other 403s by its code, never its sentence. */
    fun managerRequired(e: Throwable): Boolean = (e as? id.znetworks.nexus.core.net.ApiError.Http)?.let { it.status == 403 && it.code == "MANAGER_REQUIRED" } == true
}
