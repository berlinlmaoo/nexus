package id.znetworks.nexus.feature.social

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.outlet.OutletFormat
import kotlinx.serialization.json.*

@Composable
internal fun NumberBox(value: String, label: Int, enabled: Boolean, max: Long, placeholder: String = "", change: (String) -> Unit) {
    OutlinedTextField(value, { if (it.isEmpty() || it.all(Char::isDigit)) change(it) }, label = { Text(stringResource(label)) },
        enabled = enabled, isError = SocialDraft.number(value, max) == null, placeholder = { Text(placeholder) },
        visualTransformation = remember(OutletFormat.isId()) { GroupedNumber(if (OutletFormat.isId()) '.' else ',') },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = androidx.compose.ui.text.input.ImeAction.Done), singleLine = true, modifier = Modifier.fillMaxWidth())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SocialDayDialog(d: SocialMonth, date: String, vm: SocialViewModel, busy: Boolean, error: String?, close: () -> Unit) {
    // Freeze the baseline while editing: realtime refresh must not overwrite an unsaved draft.
    val original = remember(date) { d.day(date) }
    val shown = remember(date) { d.platforms.filter { !it.flag("archived") || original.objectAt("platforms").objectAt(it.text("id")).let { p -> SocialDraft.metrics.any { p.number(it) != null } } } }
    val draft = remember(date) { mutableStateMapOf<String, String>().apply {
        shown.forEach { p -> SocialDraft.metrics.forEach { key -> put("${p.text("id")}:$key", original.objectAt("platforms").objectAt(p.text("id")).number(key)?.toLong()?.toString().orEmpty()) } }
        put("worked", original.text("worked")); put("didntWork", original.text("didntWork"))
    } }
    val changed = SocialDraft.day(original, draft).isNotEmpty()
    val valid = draft.all { (k, v) -> if (k.contains(':')) SocialDraft.number(v, if (k.endsWith(":posts")) 10_000 else 1_000_000_000) != null else v.length <= 2000 }
    val editable = d.canRecord && date <= d.today
    var discard by remember { mutableStateOf(false) }
    var targets by remember { mutableStateOf(false) }
    val dismiss = { if (!busy) { if (changed) discard = true else close() } }
    val dirtyNow by rememberUpdatedState(changed)
    val busyNow by rememberUpdatedState(busy)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { target ->
        if (target == SheetValue.Hidden && dirtyNow && !busyNow) { discard = true; false } else !busyNow
    })
    BackHandler { dismiss() }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(OutletFormat.longDay(date, d.today.take(4).toInt()), style = MaterialTheme.typography.titleLarge)
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            shown.forEach { p ->
                val id = p.text("id"); val figures = original.objectAt("platforms").objectAt(id)
                Text(p.text("name"), style = MaterialTheme.typography.titleMedium)
                SocialDraft.metrics.forEach { key -> NumberBox(draft["$id:$key"].orEmpty(), metricLabel(key), editable && !busy,
                    if (key == "posts") 10_000 else 1_000_000_000) { draft["$id:$key"] = it } }
                val engagement = listOf("likes", "comments", "shares").mapNotNull { draft["$id:$it"]?.toDoubleOrNull() }.takeIf { it.isNotEmpty() }?.sum()
                Text("${stringResource(R.string.sm_engagement)}: ${reportNumber(engagement)} / ${reportNumber(figures.number("engagementTarget"))}")
                Text(stringResource(when (figures.text("engagementTargetSource")) { "day" -> R.string.sm_own_target; "month" -> R.string.sm_month_share; else -> R.string.sm_no_target }))
            }
            listOf("worked" to R.string.sm_worked, "didntWork" to R.string.sm_didnt_work).forEach { (key, label) ->
                OutlinedTextField(draft[key].orEmpty(), { if (it.length <= 2000) draft[key] = it }, enabled = editable && !busy,
                    label = { Text(stringResource(label)) }, minLines = 3, modifier = Modifier.fillMaxWidth())
            }
            if (d.canManage) TextButton(onClick = { targets = true }, enabled = !busy) { Text(stringResource(R.string.sm_day_targets)) }
            if (editable) Button(onClick = { vm.write("days/$date", SocialDraft.day(original, draft), close) }, enabled = !busy && changed && valid) { Text(stringResource(R.string.sm_save)) }
            TextButton(onClick = dismiss, enabled = !busy) { Text(stringResource(R.string.sm_close)) }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.sm_discard)) },
        confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.sm_discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.sm_keep_editing)) } })
    if (targets) SocialTargetsDialog(d, date, vm, busy, error) { targets = false }
}

@Composable
internal fun SocialTargetsDialog(d: SocialMonth, date: String?, vm: SocialViewModel, busy: Boolean, error: String?, close: () -> Unit) {
    val original = remember(d.month, date) { d.targets(date).associateBy { it.text("platformId") } }
    val draft = remember(d.month, date) { mutableStateMapOf<String, String>().apply {
        d.platforms.filter { !it.flag("archived") }.forEach { p -> SocialDraft.targetKeys.forEach { key ->
            put("${p.text("id")}:$key", original[p.text("id")]?.number(key)?.toLong()?.toString().orEmpty())
        } }
    } }
    val valid = draft.all { (k, v) -> SocialDraft.number(v, if (k.endsWith(":postsTarget")) 1_000_000 else 2_000_000_000) != null }
    var discard by remember { mutableStateOf(false) }
    val changed = draft.any { (key, value) ->
        val id = key.substringBefore(':'); val metric = key.substringAfter(':')
        SocialDraft.number(value, if (metric == "postsTarget") 1_000_000 else 2_000_000_000) != (original[id]?.get(metric) ?: JsonNull)
    }
    val dismiss = { if (!busy) { if (changed) discard = true else close() } }
    AlertDialog(onDismissRequest = dismiss, title = { Text(stringResource(if (date == null) R.string.sm_month_targets else R.string.sm_day_targets)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            Text(stringResource(R.string.sm_month_share))
            d.platforms.filter { !it.flag("archived") }.forEach { p ->
                Text(p.text("name"))
                SocialDraft.targetKeys.forEach { key -> NumberBox(draft["${p.text("id")}:$key"].orEmpty(), metricLabel(key), !busy,
                    if (key == "postsTarget") 1_000_000 else 2_000_000_000,
                    placeholder = if (date != null) d.targets(null).firstOrNull { it.text("platformId") == p.text("id") }?.number(key)?.let {
                        java.text.DecimalFormat("#,##0.##").format(it / java.time.YearMonth.parse(d.month).lengthOfMonth())
                    }.orEmpty() else "") { draft["${p.text("id")}:$key"] = it } }
            }
        } }, confirmButton = { TextButton(enabled = !busy && valid, onClick = {
            val platforms = buildJsonObject {
                d.platforms.filter { !it.flag("archived") }.forEach { p ->
                    val id = p.text("id")
                    val changes = buildJsonObject { SocialDraft.targetKeys.forEach { key ->
                        val next = SocialDraft.number(draft["$id:$key"].orEmpty(), if (key == "postsTarget") 1_000_000 else 2_000_000_000)!!
                        if (next != (original[id]?.get(key) ?: JsonNull)) put(key, next)
                    } }
                    if (changes.isNotEmpty()) put(id, changes)
                }
            }
            vm.write(if (date == null) "targets" else "day-targets", buildJsonObject {
                put(if (date == null) "month" else "date", date ?: d.month); put("platforms", platforms)
            }, close)
        }) { Text(stringResource(R.string.sm_save)) } }, dismissButton = { TextButton(onClick = dismiss, enabled = !busy) { Text(stringResource(R.string.sm_close)) } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.sm_discard)) },
        confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.sm_discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.sm_keep_editing)) } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SocialSettingsDialog(d: SocialMonth, vm: SocialViewModel, busy: Boolean, error: String?, close: () -> Unit) {
    var config by remember { mutableStateOf<List<JsonObject>?>(null) }
    var usage by remember { mutableStateOf(JsonObject(emptyMap())) }
    var loadError by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var archive by remember { mutableStateOf<String?>(null) }
    val targetOriginal = remember { d.targets(null).associateBy { it.text("platformId") } }
    val targetDraft = remember { mutableStateMapOf<String, String>().apply {
        d.platforms.filter { !it.flag("archived") }.forEach { p -> SocialDraft.targetKeys.forEach { k -> put("${p.text("id")}:$k", targetOriginal[p.text("id")]?.number(k)?.toLong()?.toString().orEmpty()) } }
    } }
    var discard by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }
    val dirtyNow by rememberUpdatedState(dirty)
    val busyNow by rememberUpdatedState(busy)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { target ->
        if (target == SheetValue.Hidden && dirtyNow && !busyNow) { discard = true; false } else !busyNow
    })
    LaunchedEffect(retry) {
        try { val r = vm.api.config(); config = r.objectAt("config").rows("platforms"); usage = r.objectAt("usage"); loadError = false }
        catch (_: ApiError) { loadError = true }
    }
    fun update(id: String, transform: (JsonObject) -> JsonObject) { config = config?.map { if (it.text("id") == id) transform(it) else it }; dirty = true }
    val dismiss = { if (!busy) { if (dirty) discard = true else close() } }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheet) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.sm_settings), style = MaterialTheme.typography.titleLarge)
            Text(OutletFormat.monthLabel(d.month))
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            if (loadError) TextButton(onClick = { retry++ }) { Text(stringResource(R.string.try_again)) }
            else if (config == null) CircularProgressIndicator()
            config?.forEachIndexed { index, p ->
                val id = p.text("id")
                OutlinedTextField(p.text("name"), { name -> if (name.length <= 40) update(id) { JsonObject(it + ("name" to JsonPrimitive(name))) } },
                    label = { Text(stringResource(R.string.sm_platform)) }, enabled = !busy && !p.flag("archived"))
                if (!p.flag("archived") && !p.flag("_local")) SocialDraft.targetKeys.forEach { k ->
                    NumberBox(targetDraft["$id:$k"].orEmpty(), metricLabel(k), !busy, if (k == "postsTarget") 1_000_000 else 2_000_000_000) { targetDraft["$id:$k"] = it; dirty = true }
                }
                Row {
                    if (p.flag("archived")) TextButton(onClick = { update(id) { JsonObject(it + ("archived" to JsonPrimitive(false))) } }, enabled = !busy) { Text(stringResource(R.string.sm_restore)) }
                    if (!p.flag("archived")) TextButton(onClick = {
                        if ((usage.number(id) ?: 0.0) > 0) archive = id else update(id) { JsonObject(it + ("archived" to JsonPrimitive(true))) }
                    }, enabled = !busy && config!!.count { !it.flag("archived") } > 1) { Text(stringResource(R.string.sm_archive)) }
                    if (index > 0) TextButton(onClick = {
                        config = config!!.toMutableList().apply { add(index - 1, removeAt(index)) }; dirty = true
                    }, enabled = !busy) { Text(stringResource(R.string.sm_move_up)) }
                }
            }
            TextButton(onClick = {
                config = config.orEmpty() + buildJsonObject { put("id", "local_" + java.util.UUID.randomUUID().toString().take(10)); put("_local", true); put("name", "") }; dirty = true
            }, enabled = !busy && config != null && config!!.size < 12) { Text(stringResource(R.string.sm_add_platform)) }
            Button(onClick = {
                val platforms = buildJsonObject { config!!.filter { !it.flag("archived") && !it.flag("_local") }.forEach { p ->
                    val id = p.text("id")
                    val changes = buildJsonObject { SocialDraft.targetKeys.forEach { k ->
                        val next = SocialDraft.number(targetDraft["$id:$k"].orEmpty(), if (k == "postsTarget") 1_000_000 else 2_000_000_000)!!
                        if (next != (targetOriginal[id]?.get(k) ?: JsonNull)) put(k, next)
                    } }
                    if (changes.isNotEmpty()) put(id, changes)
                } }
                val clean = config!!.map { if (it.flag("_local")) JsonObject(it - setOf("id", "_local")) else it }
                vm.settings(buildJsonObject { put("platforms", JsonArray(clean)) }, buildJsonObject { put("month", d.month); put("platforms", platforms) },
                    configured = { if (it.isNotEmpty()) config = it.rows("platforms") }, done = close)
            }, enabled = !busy && config != null && config!!.all { it.text("name").isNotBlank() } && config!!.any { !it.flag("archived") } &&
                targetDraft.all { (k, v) -> SocialDraft.number(v, if (k.endsWith(":postsTarget")) 1_000_000 else 2_000_000_000) != null }) { Text(stringResource(R.string.sm_save)) }
            TextButton(onClick = dismiss, enabled = !busy) { Text(stringResource(R.string.sm_close)) }
        }
    }
    if (archive != null) AlertDialog(onDismissRequest = { archive = null }, title = { Text(stringResource(R.string.sm_archive_confirm)) },
        text = { Text(stringResource(R.string.sm_archive_help)) }, confirmButton = { TextButton(onClick = {
            update(archive!!) { JsonObject(it + ("archived" to JsonPrimitive(true))) }; archive = null
        }) { Text(stringResource(R.string.sm_archive)) } }, dismissButton = { TextButton(onClick = { archive = null }) { Text(stringResource(R.string.sm_close)) } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.sm_discard)) },
        confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.sm_discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.sm_keep_editing)) } })
}
