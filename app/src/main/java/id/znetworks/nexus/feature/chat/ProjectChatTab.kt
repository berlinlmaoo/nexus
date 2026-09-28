package id.znetworks.nexus.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.EmptyState

/**
 * The project's chat room. Listing conversations provisions it on the server (and adds the
 * caller), so the room is found there and opened as an ordinary thread.
 */
@Composable
fun ProjectChatTab(projectId: String, onOpenChat: (String) -> Unit) {
    val api = ChatApi((LocalContext.current.applicationContext as NexusApplication).container.api)
    var missing by remember { mutableStateOf(false) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(projectId, tick) {
        missing = false
        val room = runCatching { api.conversations().value.conversations }.getOrNull()?.firstOrNull { it.type == "PROJECT" && it.projectId == projectId }
        if (room != null) onOpenChat(room.id) else missing = true
    }
    if (missing) EmptyState(Icons.Filled.Forum, stringResource(R.string.chat_project_missing), stringResource(R.string.chat_project_missing_sub),
        stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
    else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}
