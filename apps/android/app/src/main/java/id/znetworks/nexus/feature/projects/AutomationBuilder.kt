package id.znetworks.nexus.feature.projects

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/** Edits a copy: untouched config and unknown values survive a round trip. */
@Composable
internal fun AutomationBuilder(projectId: String, original: Automation?, names: AutomationNames, lanes: List<Lane>, api: ProjectsApi, saved: () -> Unit, close: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(original?.name.orEmpty()) }
    var enabled by remember { mutableStateOf(original?.enabled ?: true) }
    var trigger by remember { mutableStateOf(original?.trigger ?: Rule("TASK_CREATED")) }
    var actions by remember { mutableStateOf(original?.steps ?: listOf(Rule("MARK_COMPLETE"))) }
    var conditions by remember { mutableStateOf(original?.conditions ?: Conditions()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var discard by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val dirty = name != original?.name.orEmpty() || enabled != (original?.enabled ?: true) || trigger != (original?.trigger ?: Rule("TASK_CREATED")) || actions != (original?.steps ?: listOf(Rule("MARK_COMPLETE"))) || conditions != (original?.conditions ?: Conditions())
    fun dismiss() { if (!busy) { if (dirty) discard = true else close() } }
    fun mutate(delete: Boolean = false) { busy = true; scope.launch {
        try { if (delete) api.deleteAutomation(original!!.id) else api.saveAutomation(projectId, original?.id?.takeIf { it.isNotEmpty() }, name, enabled, trigger, actions, conditions); saved(); close() }
        catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(ctx.resources) }
        finally { busy = false }
    } }
    Dialog(onDismissRequest = ::dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BackHandler { dismiss() }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding().imePadding()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = ::dismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) }
                    TextButton(onClick = { mutate() }, enabled = !busy && name.isNotBlank() && name.length <= 200 && actions.isNotEmpty()) { Text(stringResource(R.string.save)) }
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(if (original == null) R.string.ab_new else R.string.ab_edit), style = MaterialTheme.typography.titleLarge)
                    OutlinedTextField(name, { if (it.length <= 200) name = it }, label = { Text(stringResource(R.string.ab_name)) }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                    Row { Text(stringResource(R.string.ab_enabled), Modifier.weight(1f)); Switch(enabled, { enabled = it }, enabled = !busy) }
                    Text(stringResource(R.string.au_when_caps), style = MaterialTheme.typography.titleMedium)
                    RuleEditor(trigger, true, names, lanes, !busy) { trigger = it }
                    Text(stringResource(R.string.ab_conditions), style = MaterialTheme.typography.titleMedium)
                    BuilderPick(stringResource(R.string.ab_match), conditions.match, listOf("all" to stringResource(R.string.au_if_all), "any" to stringResource(R.string.au_if_any)), !busy) { conditions = conditions.copy(match = it) }
                    val fields = AutomationText.FIELDS.map { it.key to stringResource(it.value) } + names.fields.map { "cf:${it.key}" to it.value }
                    conditions.rules.forEachIndexed { i, rule ->
                        Card { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            BuilderPick(stringResource(R.string.ab_field), rule.field, fields, !busy) { value -> conditions = conditions.copy(rules = conditions.rules.mapIndexed { n, r -> if (n == i) r.copy(field = value, op = "is", value = null) else r }) }
                            BuilderPick(stringResource(R.string.ab_operator), rule.op, AutomationText.OPS.map { it.key to stringResource(it.value) }, !busy) { value -> conditions = conditions.copy(rules = conditions.rules.mapIndexed { n, r -> if (n == i) r.copy(op = value) else r }) }
                            if (rule.op !in listOf("is_empty", "is_not_empty", "overdue")) BuilderValue(rule.field, rule.text.orEmpty(), names, !busy) { value -> conditions = conditions.copy(rules = conditions.rules.mapIndexed { n, r -> if (n == i) r.copy(value = JsonPrimitive(value)) else r }) }
                            TextButton(onClick = { conditions = conditions.copy(rules = conditions.rules.filterIndexed { n, _ -> n != i }) }, enabled = !busy) { Text(stringResource(R.string.ab_remove)) }
                        } }
                    }
                    TextButton(onClick = { conditions = conditions.copy(rules = conditions.rules + ConditionRule("status", "is", JsonPrimitive("TODO"))) }, enabled = !busy && conditions.rules.size < 10) { Text(stringResource(R.string.ab_add_condition)) }
                    Text(stringResource(R.string.au_do_caps), style = MaterialTheme.typography.titleMedium)
                    if (trigger.type == "SCHEDULED") Text(stringResource(R.string.ab_schedule_hint))
                    actions.forEachIndexed { i, rule ->
                        Card { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${i + 1}", style = MaterialTheme.typography.titleSmall)
                            RuleEditor(rule, false, names, lanes, !busy) { value -> actions = actions.mapIndexed { n, r -> if (n == i) value else r } }
                            Row {
                                if (i > 0) TextButton(onClick = { actions = actions.toMutableList().apply { add(i - 1, removeAt(i)) } }, enabled = !busy) { Text(stringResource(R.string.ab_up)) }
                                TextButton(onClick = { actions = actions.filterIndexed { n, _ -> n != i } }, enabled = !busy) { Text(stringResource(R.string.ab_remove)) }
                            }
                        } }
                    }
                    TextButton(onClick = { actions = actions + Rule("MARK_COMPLETE") }, enabled = !busy && actions.size < 10) { Text(stringResource(R.string.ab_add_action)) }
                    if (original?.id?.isNotEmpty() == true) TextButton(onClick = { deleting = true }, enabled = !busy) { Text(stringResource(R.string.au_delete)) }
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
    if (discard || deleting) AlertDialog(onDismissRequest = { discard = false; deleting = false }, title = { Text(stringResource(if (deleting) R.string.ab_delete_confirm else R.string.ab_discard)) }, confirmButton = { TextButton(onClick = { if (deleting) { deleting = false; mutate(true) } else close() }) { Text(stringResource(if (deleting) R.string.au_delete else R.string.ab_discard_action)) } }, dismissButton = { TextButton(onClick = { discard = false; deleting = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable
internal fun BuilderPick(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean = true, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    OutlinedButton(onClick = { open = true; query = "" }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("$label: ${options.firstOrNull { it.first == value }?.second ?: value}") }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(label) }, text = {
        Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
            OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.search)) })
            options.filter { it.second.contains(query, true) }.forEach { (key, text) -> TextButton(onClick = { change(key); open = false }, modifier = Modifier.fillMaxWidth()) { Text(text) } }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun BuilderValue(field: String?, value: String, names: AutomationNames, enabled: Boolean, change: (String) -> Unit) {
    val opts = when (field) {
        "status" -> AutomationText.STATUSES.map { it.key to stringResource(it.value) }
        "priority" -> AutomationText.PRIORITIES.map { it.key to stringResource(it.value) }
        "section" -> names.sections.toList()
        "assignee", "creator" -> names.people.toList()
        else -> emptyList()
    }
    if (opts.isNotEmpty()) BuilderPick(stringResource(R.string.ab_value), value, listOf("" to stringResource(R.string.ab_any)) + opts, enabled, change)
    else OutlinedTextField(value, { if (it.length <= 2000) change(it) }, label = { Text(stringResource(R.string.ab_value)) }, enabled = enabled, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun RuleEditor(rule: Rule, trigger: Boolean, names: AutomationNames, lanes: List<Lane>, enabled: Boolean, change: (Rule) -> Unit) {
    val types = (if (trigger) AutomationText.TRIGGERS.filterKeys { it !in listOf("TASK_COMPLETED", "WEBHOOK_RECEIVED") } else AutomationText.ACTIONS).map { it.key to stringResource(it.value) }
    BuilderPick(stringResource(if (trigger) R.string.ab_trigger else R.string.ab_action), rule.type.orEmpty(), types, enabled) { type -> change(if (type == "SCHEDULED") Rule(type, config = buildJsonObject { put("frequency", "daily"); put("time", "09:00") }) else Rule(type)) }
    val cfg = rule.config ?: buildJsonObject { }
    fun config(key: String, value: JsonElement) = change(rule.copy(config = JsonObject(cfg + (key to value))))
    @Composable fun input(label: Int, key: String, default: String = "") { OutlinedTextField((cfg[key] as? JsonPrimitive)?.content ?: default, { if (it.length <= 2000) config(key, JsonPrimitive(it)) }, label = { Text(stringResource(label)) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) }
    @Composable fun value(field: String?) { BuilderValue(field, rule.text.orEmpty(), names, enabled) { change(rule.copy(value = JsonPrimitive(it), config = if (rule.type == "STATUS_CHANGED") JsonObject(cfg - "toSection" - "bySection") else if (rule.type == "SET_STATUS") JsonObject(cfg - "sectionId") else rule.config)) } }
    val fields = AutomationText.FIELDS.map { it.key to stringResource(it.value) } + names.fields.map { "cf:${it.key}" to it.value }
    when (rule.type) {
        "SCHEDULED" -> {
            BuilderPick(stringResource(R.string.ab_repeat), (cfg["frequency"] as? JsonPrimitive)?.content ?: "daily", listOf("daily" to stringResource(R.string.au_s_daily), "weekdays" to stringResource(R.string.au_s_weekdays), "weekly" to stringResource(R.string.au_s_weekly), "monthly" to stringResource(R.string.ab_monthly)), enabled) { config("frequency", JsonPrimitive(it)) }
            input(R.string.ab_time, "time", "09:00")
            when ((cfg["frequency"] as? JsonPrimitive)?.content) {
                "weekly" -> { val days = (cfg["days"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.orEmpty(); Column { (1..7).forEach { day -> FilterChip(day in days, { config("days", JsonArray((if (day in days) days - day else days + day).sorted().map { JsonPrimitive(it) })) }, label = { Text(day.toString()) }, enabled = enabled) } }; Text(stringResource(R.string.ab_weekdays)) }
                "monthly" -> input(R.string.ab_month_day, "dayOfMonth", "1")
            }
        }
        "STATUS_CHANGED" -> { BuilderPick(stringResource(R.string.ab_from), (cfg["from"] as? JsonPrimitive)?.content.orEmpty(), listOf("" to stringResource(R.string.ab_any)) + AutomationText.STATUSES.map { it.key to stringResource(it.value) }, enabled) { change(rule.copy(config = JsonObject((cfg - "fromSection" - "bySection") + ("from" to JsonPrimitive(it))))) }; value("status") }
        "SET_STATUS" -> { value("status"); BuilderPick(stringResource(R.string.ab_section), (cfg["sectionId"] as? JsonPrimitive)?.content.orEmpty(), listOf("" to stringResource(R.string.ab_any)) + names.sections.toList(), enabled) { id -> val lane = lanes.find { it.id == id }; change(rule.copy(value = JsonPrimitive(lane?.taskStatus ?: rule.text.orEmpty()), config = JsonObject(cfg + ("sectionId" to JsonPrimitive(id))))) } }
        "SET_PRIORITY" -> value("priority")
        "MOVE_TO_SECTION" -> value("section")
        "FIELD_CHANGED", "SET_FIELD" -> { BuilderPick(stringResource(R.string.ab_field), rule.field.orEmpty(), fields, enabled) { change(rule.copy(field = it, value = null)) }; value(rule.field) }
        "ASSIGNEE_CHANGED" -> value("assignee")
        "ASSIGN_TO", "UNASSIGN" -> {
            val picked = rule.text.orEmpty().split(",").filter { it.isNotBlank() }
            val ctx = LocalContext.current
            val tokens = listOf("@actor", "@creator") + if (rule.type == "UNASSIGN") listOf("@all") else emptyList()
            (names.people.toList() + tokens.map { it to AutomationText.valueText(it, names) { id, args -> ctx.getString(id, *args) } }).forEach { (id, label) ->
                Row { Checkbox(id in picked, { on -> change(rule.copy(value = JsonPrimitive((if (on) picked + id else picked - id).distinct().joinToString(",")))) }, enabled = enabled); Text(label, Modifier.padding(top = 12.dp)) }
            }
        }
        "FORM_SUBMITTED", "DUE_DATE_APPROACHING", "ADD_TAG", "REMOVE_TAG", "ADD_COMMENT", "CREATE_SUBTASK" -> value(null)
        "SEND_NOTIFICATION" -> { value(null); PeopleConfig(cfg, "to", names, enabled, listOf("@assignees", "@actor", "@creator", "@leads")) { key, v -> config(key, v) } }
        "CREATE_TASK", "DUPLICATE_TASK" -> {
            if (rule.type == "CREATE_TASK") value(null)
            BuilderPick(stringResource(R.string.ab_section), (cfg["sectionId"] as? JsonPrimitive)?.content.orEmpty(), listOf("" to stringResource(R.string.ab_any)) + names.sections.toList(), enabled) { config("sectionId", JsonPrimitive(it)) }
            if (rule.type == "CREATE_TASK") { input(R.string.ab_due, "due"); BuilderPick(stringResource(R.string.ab_priority), (cfg["priority"] as? JsonPrimitive)?.content.orEmpty(), listOf("" to stringResource(R.string.ab_any)) + AutomationText.PRIORITIES.map { it.key to stringResource(it.value) }, enabled) { config("priority", JsonPrimitive(it)) }; PeopleConfig(cfg, "assignees", names, enabled, listOf("@actor", "@creator")) { key, v -> config(key, v) } }
        }
    }
}

@Composable
private fun PeopleConfig(cfg: JsonObject, key: String, names: AutomationNames, enabled: Boolean, tokens: List<String>, change: (String, JsonElement) -> Unit) {
    val picked = (cfg[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
    // Roles use the same translated vocabulary as the rule summary.
    val ctx = LocalContext.current
    (names.people.toList() + tokens.map { it to AutomationText.valueText(it, names) { id, args -> ctx.getString(id, *args) } }).forEach { (id, label) ->
        Row { Checkbox(id in picked, { on -> change(key, JsonArray((if (on) picked + id else picked - id).distinct().map { JsonPrimitive(it) })) }, enabled = enabled); Text(label, Modifier.padding(top = 12.dp)) }
    }
}
