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
data class ReplyRef(val id: String, val content: String = "", val attachmentType: String? = null, val user: ChatUser? = null,
                    val attachmentName: String? = null, val attachmentSize: Long? = null)

@Serializable
data class Message(
    val id: String,
    val conversationId: String? = null,
    val userId: String? = null,
    val content: String = "",
    val attachmentUrl: String? = null,
    val attachmentType: String? = null,
    val attachmentKind: String? = null,
    val attachmentName: String? = null,
    val attachmentSize: Long? = null,
    val replyToId: String? = null,
    val createdAt: String? = null,
    val user: ChatUser? = null,
    val replyTo: ReplyRef? = null,
    /** "USER" | "SYSTEM" (8 Oct): a SYSTEM row is a group's log line, drawn as a pill (ChatSystemText). */
    val kind: String? = null,
    @Serializable(with = LenientSystemEvent::class) val event: ChatSystemEvent? = null,
) {
    val isImage: Boolean get() = attachmentUrl != null && attachmentType.orEmpty().startsWith("image/")
    val isSystem: Boolean get() = kind == "SYSTEM"
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
    /** False in a project room the viewer may only read (Can view, 13 Oct); null = an older server. */
    val canPost: Boolean? = null,
    val peer: ChatPeer? = null,
    /** Group photo (22 Oct); omitted by older servers and null when no photo is set. */
    val avatarUrl: String? = null,
) {
    fun muted(nowMs: Long = System.currentTimeMillis()): Boolean =
        mutedUntil?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() > nowMs }.getOrDefault(true) } ?: false
    /**
     * A DM is titled by the other person, else the room's name, else [dmFallback] ("Direct message", iOS / web); a group
     * or project room by its name.
     */
    fun title(meId: String?, dmFallback: String = "—"): String = when (type) {
        "DM" -> other(meId)?.name?.takeIf { it.isNotBlank() } ?: name?.takeIf { it.isNotBlank() } ?: dmFallback
        else -> name ?: members.filter { it.uid != meId }.joinToString(", ") { it.displayName }.ifBlank { "—" }
    }

    /** The web's initials: first letters of the first two words ("Budi Z" → "BZ", "Direct message" → "DM"); never "?" for a named room. */
    fun initials(meId: String?, dmFallback: String): String = ChatInitials.of(title(meId, dmFallback))
    fun other(meId: String?): ChatUser? = if (type == "DM") members.firstOrNull { it.uid != meId }?.user ?: peer?.let { ChatUser(it.id, it.name, it.avatar) } else null
}

@Serializable data class ChatPeer(val id: String? = null, val name: String? = null, val avatar: String? = null, val left: Boolean = false)

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
data class MessagesResponse(val messages: List<Message> = emptyList(), val hasMore: Boolean = false, val nextCursor: String? = null,
                            /** `around=` pages (8 Oct): newer messages exist past this page; pass [newerCursor] as `after`. */
                            val hasMoreNewer: Boolean = false, val newerCursor: String? = null, val anchorId: String? = null)

// Group info (SYSTEM-MESSAGES part 2, GET /api/conversations/:id/info and friends). All optional: older servers 404.
@Serializable data class ChatRef(val id: String? = null, val name: String? = null)
@Serializable data class ChatInfoConversation(val id: String, val type: String = "GROUP", val name: String? = null, val description: String? = null,
                                              val projectId: String? = null, val createdAt: String? = null, val createdBy: ChatRef? = null,
                                              val memberCount: Int = 0, val mutedUntil: String? = null, val canManageMembers: Boolean = false, val canEdit: Boolean = false,
                                              /** DELETE-GROUP (9 Oct): may delete this GROUP. Absent on older servers → no Delete. */
                                              val canDelete: Boolean = false,
                                              val avatarUrl: String? = null,
                                              /** Same authority as renaming; null on servers before group photos. */
                                              val canEditAvatar: Boolean? = null)
@Serializable data class ChatInfoMember(val userId: String, val name: String? = null, val avatar: String? = null, val isMe: Boolean = false,
                                        val isAdmin: Boolean = false, val deactivatedAt: String? = null)
@Serializable data class ChatMediaCounts(val photos: Int = 0, val links: Int = 0, val docs: Int = 0) { val total get() = photos + links + docs }
@Serializable data class ChatInfo(val conversation: ChatInfoConversation, val members: List<ChatInfoMember> = emptyList(), val counts: ChatMediaCounts = ChatMediaCounts())
/** Avatar mutations return only these fields, rather than a full conversation. */
@Serializable data class ChatAvatarConversation(val id: String, val avatarUrl: String? = null)
@Serializable data class ChatAvatarResponse(val conversation: ChatAvatarConversation)
@Serializable data class ChatMediaItem(val messageId: String? = null, val createdAt: String? = null, val sender: ChatRef? = null, val url: String? = null,
                                       val attachmentType: String? = null, val title: String? = null,
                                       val name: String? = null, val size: Long? = null)
@Serializable data class ChatMediaPage(val items: List<ChatMediaItem> = emptyList(), val nextCursor: String? = null)
@Serializable data class ChatSearchHit(val messageId: String, val createdAt: String? = null, val sender: ChatRef? = null, val snippet: String? = null)
@Serializable data class ChatSearchPage(val results: List<ChatSearchHit> = emptyList(), val nextCursor: String? = null)

@Serializable
data class ChatUpload(val url: String, val type: String? = null, val kind: String? = null, val name: String? = null, val size: Long? = null)

object ChatDocuments {
    const val MAX_BYTES = 25L * 1024 * 1024
    const val MAX_IMAGE_BYTES = 8L * 1024 * 1024
    val extensions = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip")
    private val images = setOf("png", "jpg", "jpeg", "webp", "gif")
    fun preview(type: String?, name: String?, fallback: String): String? =
        if ((!type.isNullOrBlank() || !name.isNullOrBlank()) && !type.orEmpty().startsWith("image/"))
            "📎 " + (name?.takeIf { it.isNotBlank() } ?: fallback) else null
    fun accepts(name: String, bytes: Long): Boolean {
        val ext = name.substringAfterLast('.', "").lowercase()
        return when (ext) {
            in images -> bytes in 1..MAX_IMAGE_BYTES
            in extensions -> bytes in 1..MAX_BYTES
            else -> false
        }
    }
}

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
        return q.takeIf { '\n' !in it && '\r' !in it && '\t' !in it && it.trim().split(Regex("\\s+")).size <= 4 }
    }

    fun matches(name: String, query: String): Boolean {
        val words = query.trim().split(Regex("\\s+"))
        val normal = words.joinToString(" ")
        return normal.isEmpty() || name.contains(normal, ignoreCase = true) ||
            (words.size == 1 && name.replace(Regex("\\s+"), "").contains(normal, ignoreCase = true))
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

object ChatComposerLimit {
    const val MAX_LENGTH = 4000
    const val COUNTER_FROM = 3600
    fun length(value: String) = value.codePointCount(0, value.length)
    fun tooLong(value: String) = length(value) > MAX_LENGTH
}

/** Who may grow a room (ANDROID-GROUP-ADMINS, owner 8 Oct; iOS showsAddPeople). */
object ChatRules {
    /** A project room adds through the project; a GROUP only when the server has not said no; a DM never. */
    fun showsAddPeople(conv: Conversation?): Boolean =
        conv != null && (conv.projectId != null || (conv.type == "GROUP" && conv.canManageMembers != false))

    /** A group when asked for, or with two or more people (NAV-HOME-GROUP: a group of two is allowed); else a DM. */
    fun newChatType(picked: Int, makeGroup: Boolean) = if (makeGroup || picked >= 2) "GROUP" else "DM"

    /** The server's 403 for someone below Manager, told apart from other 403s by its code, never its sentence. */
    fun managerRequired(e: Throwable): Boolean = (e as? id.znetworks.nexus.core.net.ApiError.Http)?.let { it.status == 403 && it.code == "MANAGER_REQUIRED" } == true
}

object ChatInitials {
    fun of(title: String): String =
        title.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).mapNotNull { it.firstOrNull()?.uppercaseChar()?.toString() }.joinToString("").ifEmpty { "?" }
}
