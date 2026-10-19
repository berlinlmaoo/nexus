package id.znetworks.nexus.feature.tasks

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.social.text
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
internal fun CustomFileField(projectId: String?, label: String, value: JsonElement?, canEdit: Boolean = true, commit: (JsonElement) -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    val files = (value as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.filter { it.text("url").isNotBlank() }
    val latest by rememberUpdatedState(files)
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var error by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf<JsonObject?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty() || projectId == null || !canEdit || busy) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true; error = null
            val added = mutableListOf<JsonObject>()
            try {
                uris.forEach { uri ->
                    val picked = container.uploads.describe(uri)
                    if (picked == null || picked.size > 250L * 1024 * 1024) {
                        error = context.getString(R.string.cff_limit); return@forEach
                    }
                    progress = 0f
                    added += container.uploads.sendSingle(picked, "/api/custom-fields/upload", listOf("projectId" to projectId), JsonObject.serializer()) { sent, total -> progress = if (total > 0) sent.toFloat() / total else 0f }
                }
            } catch (e: ApiError) { error = e.describe(context.resources) }
            finally {
                if (added.isNotEmpty()) commit(JsonArray((latest + added).distinctBy { it.text("url") }))
                busy = false
            }
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        files.forEach { file ->
            Row {
                TextButton(onClick = { scope.launch {
                    try { if (!FileOpener.open(context, container.api, file.text("url"), file.text("name"), file.text("type").takeIf { it.isNotBlank() })) error = context.getString(R.string.cff_no_viewer) }
                    catch (e: ApiError) { error = e.describe(context.resources) }
                } }, modifier = Modifier.weight(1f)) { Text(file.text("name")) }
                if (canEdit) TextButton(onClick = { removing = file }, enabled = !busy) { Text(stringResource(R.string.cff_remove)) }
            }
        }
        if (files.isEmpty()) Text(stringResource(R.string.cff_empty))
        if (busy) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
        if (canEdit && projectId != null) TextButton(onClick = { picker.launch(arrayOf("*/*")) }, enabled = !busy) { Text(stringResource(R.string.cff_add)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
    removing?.let { file -> AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.cff_confirm, file.text("name"))) },
        confirmButton = { TextButton(onClick = { commit(JsonArray(latest.filter { it.text("url") != file.text("url") })); removing = null }) { Text(stringResource(R.string.cff_remove)) } },
        dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } }) }
}
