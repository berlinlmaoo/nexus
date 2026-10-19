package id.znetworks.nexus.feature.vault

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.HeaderIconButton
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.theme.Nx

@Composable
internal fun VaultHeader(trash: Boolean, folder: String?, list: VaultList?, busy: Boolean, uploading: Boolean, back: () -> Unit,
    onUpload: () -> Unit, onPhotos: () -> Unit, onNewFolder: () -> Unit, onTrash: () -> Unit, onSelect: () -> Unit, onEmptyTrash: () -> Unit) {
    var add by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var storage by remember { mutableStateOf(false) }
    PageHeader(if (trash) stringResource(R.string.vault_trash) else "Z Vault",
        subtitle = if (!trash && folder == null) stringResource(R.string.sub_vault) else null, onBack = back) {
        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        if (trash) {
            if (list?.items?.isNotEmpty() == true) TextButton(onClick = onEmptyTrash) { Text(stringResource(R.string.vault_empty_trash), color = Nx.colors.dangerText) }
        } else {
            if (list?.canWrite == true) Box {
                HeaderIconButton(Icons.Filled.Add, stringResource(R.string.ui_vault_add), { add = true }, primary = true)
                DropdownMenu(add, { add = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.ui_vault_upload_file)) }, enabled = !uploading, onClick = { add = false; onUpload() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.ui_vault_from_photos)) }, enabled = !uploading, onClick = { add = false; onPhotos() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.vault_new_folder)) }, onClick = { add = false; onNewFolder() })
                }
            }
            Box {
                HeaderIconButton(Icons.Filled.MoreHoriz, stringResource(R.string.more), { more = true })
                DropdownMenu(more, { more = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.ui_vault_select)) }, enabled = list?.items?.any { it.canModify == true } == true, onClick = { more = false; onSelect() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.vault_trash)) }, onClick = { more = false; onTrash() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.ui_vault_storage)) }, onClick = { more = false; storage = true })
                }
            }
        }
    }
    if (storage) AlertDialog(onDismissRequest = { storage = false }, title = { Text(stringResource(R.string.ui_vault_storage)) }, text = {
        VaultRules.usage(list?.quota)?.let { usage -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LinearProgressIndicator(progress = { usage.percent / 100f }, color = if (usage.nearlyFull) Nx.colors.dangerText else Nx.colors.onyx, modifier = Modifier.fillMaxWidth())
            Text(stringResource(R.string.vault_quota, VaultRules.humanSize(usage.used), VaultRules.humanSize(usage.total)))
        } }
    }, confirmButton = { TextButton(onClick = { storage = false }) { Text(stringResource(R.string.close)) } })
}
