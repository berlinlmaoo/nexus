package id.znetworks.nexus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.theme.Nx

/** The same group picture in the list, thread and info, with the existing group mark when absent. */
@Composable
internal fun ChatGroupAvatar(name: String?, photo: String?, size: Dp, conversationId: String) {
    val c = Nx.colors
    val currentPhoto = groupPhotoUrl(conversationId, photo)
    if (!currentPhoto.isNullOrBlank()) Avatar(name, currentPhoto, size, initials = ChatInitials.of(name.orEmpty()))
    else Box(Modifier.size(size).background(c.violet.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Groups, null, tint = c.violetText, modifier = Modifier.size(size * 0.46f))
    }
}

@Composable
internal fun groupPhotoUrl(conversationId: String, fallback: String?): String? =
    ChatAvatars.avatars.collectAsState().value.let { if (it.containsKey(conversationId)) it[conversationId] else fallback }

/** Only mounted when canEditAvatar permits it; removal follows the info screen's Material confirmation pattern. */
@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun ChatGroupPhotoActions(photo: String?, busy: Boolean, onPick: () -> Unit, onRemove: () -> Unit) {
    val c = Nx.colors
    var confirmingRemoval by remember(photo) { mutableStateOf(false) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
        TextButton(onClick = onPick, enabled = !busy) {
            Text(stringResource(if (photo.isNullOrBlank()) R.string.cg_photo_add else R.string.cg_photo_change))
        }
        if (!photo.isNullOrBlank()) TextButton(onClick = { confirmingRemoval = true }, enabled = !busy) {
            Text(stringResource(R.string.cg_photo_remove), color = c.dangerText)
        }
    }
    if (confirmingRemoval && !photo.isNullOrBlank()) AlertDialog(
        onDismissRequest = { confirmingRemoval = false },
        title = { Text(stringResource(R.string.cg_photo_remove_q)) },
        text = { Text(stringResource(R.string.cg_photo_remove_body)) },
        confirmButton = {
            TextButton(onClick = { confirmingRemoval = false; onRemove() }, enabled = !busy) {
                Text(stringResource(R.string.remove), color = c.dangerText)
            }
        },
        dismissButton = { TextButton(onClick = { confirmingRemoval = false }) { Text(stringResource(R.string.cancel)) } },
    )
}
