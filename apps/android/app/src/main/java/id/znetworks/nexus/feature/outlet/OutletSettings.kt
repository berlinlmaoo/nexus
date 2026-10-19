package id.znetworks.nexus.feature.outlet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.social.*
import kotlinx.serialization.json.*

internal fun outletConfigForSave(config: JsonObject): JsonObject = JsonObject(config.mapValues { (_, value) ->
    if (value is JsonArray) JsonArray(value.map { e ->
        val item = e as? JsonObject ?: return@map e
        val clean = if (item.flag("_local")) item - setOf("_local", "id") else item
        outletConfigForSave(JsonObject(clean))
    }) else value
})

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OutletSettings(vm: OutletViewModel, close: () -> Unit) {
    var config by remember { mutableStateOf<JsonObject?>(null) }
    var usage by remember { mutableStateOf(JsonObject(emptyMap())) }
    var failed by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var dirty by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val state by vm.state.collectAsState()
    val dirtyNow by rememberUpdatedState(dirty)
    val busyNow by rememberUpdatedState(state.busy)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { target ->
        if (target == SheetValue.Hidden && dirtyNow && !busyNow) { discard = true; false } else !busyNow
    })
    LaunchedEffect(retry) {
        try { val response = vm.api.config(vm.projectId); config = response.objectAt("config"); usage = response.objectAt("usage"); failed = false }
        catch (_: ApiError) { failed = true }
    }
    fun change(key: String, list: List<JsonObject>) { config = JsonObject(config.orEmpty() + (key to JsonArray(list))); dirty = true }
    val dismiss = { if (!state.busy) { if (dirty) discard = true else close() } }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheet) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.oc_settings), style = MaterialTheme.typography.titleLarge)
            state.notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (failed) TextButton(onClick = { retry++ }) { Text(stringResource(R.string.try_again)) }
            else if (config == null) CircularProgressIndicator()
            config?.let { c ->
                listOf("rsvp" to "RSVP", "hosting" to "Hosting", "communities" to stringResource(R.string.oc_communities)).forEach { (key, label) ->
                    Text(label, style = MaterialTheme.typography.titleMedium)
                    ConfigList(c.rows(key), key == "communities", usage, !state.busy) { change(key, it) }
                }
                Button(onClick = { vm.saveCustom("config", buildJsonObject { put("config", outletConfigForSave(c)) }, close) },
                    enabled = !state.busy && dirty && configValid(c)) { Text(stringResource(R.string.sm_save)) }
            }
            TextButton(onClick = dismiss, enabled = !state.busy) { Text(stringResource(R.string.sm_close)) }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.sm_discard)) },
        confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.sm_discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.sm_keep_editing)) } })
}

private fun configValid(c: JsonObject): Boolean = listOf("rsvp", "hosting", "communities").all { key ->
    c.rows(key).all { item -> item.text(if (key == "communities") "name" else "label").isNotBlank() && item.rows("items").all { it.text("label").isNotBlank() } }
}

@Composable
private fun ConfigList(items: List<JsonObject>, communities: Boolean, usage: JsonObject, enabled: Boolean, change: (List<JsonObject>) -> Unit) {
    var remove by remember { mutableStateOf<JsonObject?>(null) }
    val nameKey = if (communities) "name" else "label"
    fun update(id: String, transform: (JsonObject) -> JsonObject) = change(items.map { if (it.text("id") == id) transform(it) else it })
    fun archive(item: JsonObject) {
        val used = (usage.number(item.text("id")) ?: 0.0) > 0 || item.rows("items").any { (usage.number(it.text("id")) ?: 0.0) > 0 }
        if (used) update(item.text("id")) { JsonObject(it + ("archived" to JsonPrimitive(true))) }
        else change(items.filter { it.text("id") != item.text("id") })
    }
    items.forEachIndexed { index, item ->
        val id = item.text("id")
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(item.text(nameKey), { text -> if (text.length <= 60) update(id) { JsonObject(it + (nameKey to JsonPrimitive(text))) } },
                    enabled = enabled && !item.flag("archived"), label = { Text(stringResource(R.string.oc_label)) }, modifier = Modifier.fillMaxWidth())
                Row {
                    if (item.flag("archived")) TextButton(onClick = { update(id) { JsonObject(it - "archived") } }, enabled = enabled) { Text(stringResource(R.string.sm_restore)) }
                    else TextButton(onClick = {
                        if ((usage.number(id) ?: 0.0) > 0 || item.rows("items").any { (usage.number(it.text("id")) ?: 0.0) > 0 }) remove = item else archive(item)
                    }, enabled = enabled) { Text(stringResource(R.string.oc_remove)) }
                    if (index > 0) TextButton(onClick = { change(items.toMutableList().apply { add(index - 1, removeAt(index)) }) }, enabled = enabled) { Text(stringResource(R.string.sm_move_up)) }
                }
                if (communities && !item.flag("archived")) {
                    Row {
                        listOf("total" to R.string.oc_total_only, "breakdown" to R.string.oc_breakdown).forEach { (mode, label) ->
                            FilterChip(selected = item.text("mode") == mode, onClick = { update(id) { JsonObject(it + ("mode" to JsonPrimitive(mode))) } }, enabled = enabled, label = { Text(stringResource(label)) })
                        }
                    }
                    if (item.text("mode") == "breakdown") ConfigList(item.rows("items"), false, usage, enabled) { sub -> update(id) { JsonObject(it + ("items" to JsonArray(sub))) } }
                }
            }
        }
    }
    TextButton(onClick = {
        change(items + buildJsonObject { put("id", "local_" + java.util.UUID.randomUUID().toString().take(10)); put("_local", true); put(nameKey, ""); if (communities) { put("mode", "total"); put("items", JsonArray(emptyList())) } })
    }, enabled = enabled && items.size < (if (communities) 50 else 30)) { Text(stringResource(if (communities) R.string.oc_add_community else R.string.oc_add_item)) }
    if (remove != null) AlertDialog(onDismissRequest = { remove = null }, title = { Text(stringResource(R.string.oc_archive_confirm)) },
        text = { Text(stringResource(R.string.sm_archive_help)) }, confirmButton = { TextButton(onClick = { archive(remove!!); remove = null }) { Text(stringResource(R.string.sm_archive)) } },
        dismissButton = { TextButton(onClick = { remove = null }) { Text(stringResource(R.string.sm_close)) } })
}
