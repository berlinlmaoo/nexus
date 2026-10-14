package id.znetworks.nexus.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Unread counts for the shell (owner, 8 Oct): Inbox moved into More, so More carries Inbox's badge; the
 * Messages entry points carry chat's. Refreshed on foreground, when a push arrives while the app is open,
 * and when the Inbox or the chat list loads. A failed read keeps the last count.
 */
class Badges(
    private val scope: CoroutineScope,
    private val inbox: suspend () -> Int?,
    private val chat: suspend () -> Int?,
) {
    private val _inbox = MutableStateFlow(0)
    private val _chat = MutableStateFlow(0)
    val inboxUnread: StateFlow<Int> = _inbox.asStateFlow()
    val chatUnread: StateFlow<Int> = _chat.asStateFlow()

    fun refresh() {
        scope.launch { inbox()?.let { _inbox.value = it.coerceAtLeast(0) } }
        scope.launch { chat()?.let { _chat.value = it.coerceAtLeast(0) } }
    }

    /** A screen that just read the number itself. */
    fun setInbox(n: Int) { _inbox.value = n.coerceAtLeast(0) }
    fun setChat(n: Int) { _chat.value = n.coerceAtLeast(0) }

    fun clear() { _inbox.value = 0; _chat.value = 0 }

    companion object {
        /** "99+" past 99, nothing at 0. */
        fun label(n: Int): String? = when { n <= 0 -> null; n > 99 -> "99+"; else -> "$n" }
    }
}
