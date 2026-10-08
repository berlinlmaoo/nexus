package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError

/** Mute choices, shared by the thread menu and the info screen (CHAT-CONTRACT PATCH /mute). */
object ChatMute {
    fun until(m: ChatThreadViewModel.Mute, now: java.time.Instant = java.time.Instant.now()): String? = when (m) {
        ChatThreadViewModel.Mute.HOURS_8 -> now.plusSeconds(8 * 3600L).toString()
        ChatThreadViewModel.Mute.WEEK -> now.plusSeconds(7 * 86_400L).toString()
        ChatThreadViewModel.Mute.ALWAYS -> "forever"
        ChatThreadViewModel.Mute.OFF -> null
    }

    /** "Muted until 9 Oct, 18:00"; null for "always" (far future) or nothing. */
    fun untilText(mutedUntil: String?, locale: java.util.Locale = java.util.Locale.getDefault()): String? {
        val t = mutedUntil?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() } ?: return null
        if (t.isAfter(java.time.Instant.now().plusSeconds(5L * 365 * 86_400))) return null
        return java.time.format.DateTimeFormatter.ofPattern("d MMM, HH:mm", locale).format(t.atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE))
    }
}

/** The info screen's decisions, kept apart from Compose (ChatInfoTest). */
object ChatInfoLogic {
    /**
     * An older server without the route: Next.js answers its own 404 page, not JSON. A JSON 404 is the
     * route saying "this chat isn't there" — a different message.
     */
    fun missingRoute(e: Throwable) = (e as? ApiError.Http)?.let { it.status == 404 && it.body == null } == true

    /** The app's sentence for a refused change, else [generic]. */
    fun errorRes(e: Throwable, generic: Int): Int {
        val h = e as? ApiError.Http ?: return generic
        return when {
            h.status == 403 && h.code == "MANAGER_REQUIRED" -> R.string.chat_manager_required
            h.status == 403 -> R.string.ci_err_gone_member
            h.status == 404 && h.body != null -> R.string.ci_err_gone_chat
            h.status == 400 && h.serverMessage?.contains("at least one member") == true -> R.string.ci_err_last
            h.code == "BAD_DESCRIPTION" -> R.string.ci_err_desc_len
            else -> generic
        }
    }

    /** The viewer first (shown as "You"), then the server's order (admins first, A–Z). */
    fun ordered(members: List<ChatInfoMember>) = members.filter { it.isMe } + members.filterNot { it.isMe }

    /** Info for a server without /info: what the conversation list already says; no media, search or roles. */
    fun legacy(conv: Conversation, meId: String?) = ChatInfo(
        conversation = ChatInfoConversation(conv.id, conv.type, conv.name, projectId = conv.projectId, memberCount = conv.members.size,
            mutedUntil = conv.mutedUntil, canManageMembers = conv.type == "GROUP" && conv.canManageMembers != false, canEdit = conv.type == "GROUP"),
        members = conv.members.map { m -> ChatInfoMember(m.uid, m.user?.name, m.user?.avatar, isMe = m.uid == meId) },
    )

    /** Remove someone else: Manager+ in a GROUP, never yourself (leaving is Exit group). */
    fun canRemove(info: ChatInfo, m: ChatInfoMember) = info.conversation.type == "GROUP" && info.conversation.canManageMembers && !m.isMe

    const val NAME_MAX = 80
    const val DESCRIPTION_MAX = 500
    const val QUERY_MIN = 2
    const val QUERY_MAX = 100
}
