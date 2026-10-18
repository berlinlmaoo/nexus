package id.znetworks.nexus.feature.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.CustomFieldDef
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.valueText
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** How a value goes back to the server for each field type (API.md PATCH /api/custom-fields). */
object FieldValues {
    fun text(v: JsonElement?): String = when (v) {
        is JsonPrimitive -> v.contentOrNull.orEmpty()
        is JsonObject -> (v["label"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        else -> ""
    }
    fun list(v: JsonElement?): List<String> = (v as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
    fun place(v: JsonElement?): Pair<String, String> =
        (v as? JsonObject)?.let { ((it["label"] as? JsonPrimitive)?.contentOrNull.orEmpty()) to ((it["mapUrl"] as? JsonPrimitive)?.contentOrNull.orEmpty()) } ?: ("" to "")

    fun toggled(current: List<String>, choice: String) = if (choice in current) current - choice else current + choice

    fun placeValue(label: String, mapUrl: String) = buildJsonObject { put("label", label.trim()); put("mapUrl", mapUrl.trim()) }

    /** New task: only values somebody actually filled are sent (as the web composer). */
    fun filled(v: JsonElement?): Boolean = when (v) {
        is JsonArray -> v.isNotEmpty()
        is JsonObject -> place(v).let { (l, m) -> l.isNotBlank() || m.isNotBlank() }
        is JsonPrimitive -> !v.contentOrNull.isNullOrBlank()
        else -> false
    }
}

/** The New task form's custom fields: every type but the read-only CREATED, held until the task exists. */
@Composable
fun NewTaskFields(fields: List<CustomFieldDef>, values: Map<String, JsonElement>, onChange: (String, JsonElement) -> Unit) {
    fields.filter { it.kind != "CREATED" }.forEach { f -> FieldRow(f.copy(value = values[f.id])) { onChange(f.id, it) } }
}

/** View and edit the project's custom fields on one task (iOS TaskCustomFieldsCard). Hidden when there are none. */
@Composable
fun TaskFieldsCard(projectId: String, taskId: String, onError: (String) -> Unit, canManage: Boolean = false) {
    val c = Nx.colors
    val api = ProjectsApi((LocalContext.current.applicationContext as NexusApplication).container.api)
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var fields by remember(taskId) { mutableStateOf<List<CustomFieldDef>>(emptyList()) }
    LaunchedEffect(projectId, taskId) { fields = runCatching { api.taskFields(projectId, taskId) }.getOrDefault(emptyList()) }
    var adding by remember { mutableStateOf(false) }
    fun commit(f: CustomFieldDef, v: JsonElement) {
        fields = fields.map { if (it.id == f.id) it.copy(value = v) else it }
        scope.launch {
            try {
                if (f.kind == "MULTI_SELECT") api.setFieldChoices(f.id, taskId, FieldValues.list(f.value), FieldValues.list(v))
                else api.setFieldValue(f.id, taskId, v)
                fields = api.taskFields(projectId, taskId)
            }
            catch (e: ApiError) { onError(e.describe(res)); fields = runCatching { api.taskFields(projectId, taskId) }.getOrDefault(fields) }
        }
    }
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        fields.forEach { f -> FieldRow(f) { commit(f, it) } }
        if (canManage) TextButton(onClick = { adding = true }) { Text(stringResource(R.string.r21_add_property), color = c.mutedFg) }
    }
    if (adding) {
        var name by remember { mutableStateOf("") }
        var kind by remember { mutableStateOf("TEXT") }
        var saving by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { if (!saving) adding = false }, title = { Text(stringResource(R.string.r21_add_property)) },
            text = { Column {
                OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.r21_property_name)) })
                Row { listOf("TEXT", "NUMBER", "DATE").forEach { type -> TextButton(onClick = { kind = type }) { Text(if (kind == type) "✓ $type" else type, fontSize = 11.sp) } } }
            } },
            confirmButton = { TextButton(enabled = !saving && name.isNotBlank(), onClick = { saving = true; scope.launch {
                try { api.createField(projectId, name, kind, emptyList()); fields = api.taskFields(projectId, taskId); adding = false }
                catch (e: ApiError) { onError(e.describe(res)) }; saving = false
            } }) { Text(stringResource(R.string.add)) } },
            dismissButton = { TextButton(onClick = { adding = false }, enabled = !saving) { Text(stringResource(R.string.cancel)) } })
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FieldRow(f: CustomFieldDef, onCommit: (JsonElement) -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth()) {
        Text(f.name, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.width(124.dp).padding(top = 12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        when {
            f.kind == "CREATED" -> Text(valueText(f.value) ?: "—", fontSize = 14.sp, color = c.mutedFg)
            f.kind == "DATE" -> {
                var picking by remember { mutableStateOf(false) }
                val current = id.znetworks.nexus.feature.projects.dueDate(FieldValues.text(f.value))
                Box(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).clickable { picking = true }.padding(10.dp)) {
                    Text(current?.toString() ?: "—", fontSize = 15.sp, color = if (current == null) c.mutedFg else c.foreground)
                }
                if (picking) {
                    val st = rememberDatePickerState(initialSelectedDateMillis = (current ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
                    DatePickerDialog(onDismissRequest = { picking = false },
                        confirmButton = { TextButton(onClick = {
                            st.selectedDateMillis?.let { onCommit(JsonPrimitive(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())) }
                            picking = false
                        }) { Text("OK") } },
                        dismissButton = { TextButton(onClick = { onCommit(JsonPrimitive("")); picking = false }) { Text(stringResource(R.string.td_clear_date)) } },
                    ) { DatePicker(st) }
                }
            }
            (f.kind == "SELECT" || f.kind == "STATUS") && f.choices.isNotEmpty() -> {
                var open by remember { mutableStateOf(false) }
                val cur = FieldValues.text(f.value)
                Box {
                    Row(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).clickable { open = true }.padding(10.dp)) {
                        Text(cur.ifBlank { "—" }, fontSize = 15.sp, color = if (cur.isBlank()) c.mutedFg else c.foreground, modifier = Modifier.weight(1f))
                        Text("▾", color = c.mutedFg)
                    }
                    DropdownMenu(open, { open = false }) {
                        DropdownMenuItem(text = { Text("—") }, onClick = { open = false; onCommit(JsonPrimitive("")) })
                        f.choices.forEach { ch -> DropdownMenuItem(text = { Text(ch) }, onClick = { open = false; onCommit(JsonPrimitive(ch)) }) }
                    }
                }
            }
            f.kind == "MULTI_SELECT" && f.choices.isNotEmpty() -> {
                val cur = FieldValues.list(f.value)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    f.choices.forEach { ch ->
                        FilterChip(ch in cur, { onCommit(JsonArray(FieldValues.toggled(cur, ch).map { JsonPrimitive(it) })) }, { Text(ch, fontSize = 12.sp) })
                    }
                }
            }
            f.kind == "PLACE" -> {
                val (l0, m0) = FieldValues.place(f.value)
                var label by remember(f.id, l0) { mutableStateOf(l0) }
                var map by remember(f.id, m0) { mutableStateOf(m0) }
                val save = { if (label != l0 || map != m0) onCommit(FieldValues.placeValue(label, map)) }
                OutlinedTextField(label, { label = it }, singleLine = true, placeholder = { Text(stringResource(R.string.td_place_name)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }),
                    modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused) save() })
                OutlinedTextField(map, { map = it }, singleLine = true, placeholder = { Text(stringResource(R.string.td_place_map)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }),
                    modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused) save() })
            }
            else -> {
                val v0 = FieldValues.text(f.value)
                var v by remember(f.id, v0) { mutableStateOf(v0) }
                val save = { if (v != v0) onCommit(JsonPrimitive(v.trim())) }
                OutlinedTextField(v, { v = it }, singleLine = true, placeholder = { Text(if (f.kind == "NUMBER") "0" else "…") },
                    keyboardOptions = KeyboardOptions(keyboardType = if (f.kind == "NUMBER") KeyboardType.Decimal else KeyboardType.Text, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused) save() })
            }
        }
        }
    }
}
