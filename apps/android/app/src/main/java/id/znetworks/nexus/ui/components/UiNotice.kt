package id.znetworks.nexus.ui.components

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

/** In-app feedback hosted above the shell's navigation. */
object UiNotice {
    private val queue = Channel<String>(Channel.UNLIMITED)
    val messages = queue.receiveAsFlow()
    fun show(message: String) { queue.trySend(message) }
}
