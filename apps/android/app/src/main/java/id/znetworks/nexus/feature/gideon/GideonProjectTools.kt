package id.znetworks.nexus.feature.gideon

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
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.*
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
internal fun GideonProjectTools(projectId: String) {
    var open by remember { mutableStateOf<String?>(null) }
    Row {
        TextButton(onClick = { open = "schedules" }) { Text(stringResource(R.string.gpt_schedules)) }
        TextButton(onClick = { open = "autofill" }) { Text(stringResource(R.string.gpt_autofill)) }
    }
    open?.let { kind -> ProjectToolsDialog(projectId, kind) { open = null } }
}

@Composable
internal fun GideonAutofillButton(projectId: String) {
    var open by remember(projectId) { mutableStateOf(false) }
    TextButton(onClick = { open = true }) { Text(stringResource(R.string.gpt_autofill)) }
    if (open) ProjectToolsDialog(projectId, "autofill") { open = false }
}

@Composable
private fun ProjectToolsDialog(project: String, kind: String, close: () -> Unit) {
    val ctx = LocalContext.current
    val container = (ctx.applicationContext as NexusApplication).container
    val api = remember { GideonProjectApi(container.api) }
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var fields by remember { mutableStateOf<List<CustomFieldDef>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var editSchedule by remember { mutableStateOf<JsonObject?>(null) }
    var confirmation by remember { mutableStateOf<Pair<String, suspend () -> Unit>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var showRuns by remember { mutableStateOf(false) }
    LaunchedEffect(project, kind, tick) {
        loading = true
        try { data = if (kind == "schedules") api.schedules(project) else api.autofill(project)
            if (kind == "autofill") fields = ProjectsApi(container.api).customFields(project)
            error = null
        } catch (e: ApiError) { error = e.describe(ctx.resources) }
        loading = false
    }
    val running = data?.rows("configs").orEmpty().any { it.objectAt("lastResult").text("at") == "running" }
    LaunchedEffect(running, tick) { if (running) { delay(4000); tick++ } }
    fun perform(action: suspend () -> Unit) { if (busy) return; busy = true; scope.launch {
        try { action(); error = null; tick++ } catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(ctx.resources) }
        finally { busy = false }
    } }
    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) { Column(Modifier.safeDrawingPadding().imePadding()) {
            TextButton(onClick = close, enabled = !busy) { Text(stringResource(R.string.au_close)) }
            if (showRuns) {
                TextButton(onClick = { showRuns = false }) { Text(stringResource(R.string.gpt_schedules)) }
                id.znetworks.nexus.feature.admin.GideonInsightsTab(project)
            } else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(if (kind == "schedules") R.string.gpt_schedules else R.string.gpt_autofill), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(if (kind == "schedules") R.string.gpt_digest_help else R.string.gpt_autofill_help))
                if (loading || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { tick++ }, enabled = !busy) { Text(stringResource(R.string.try_again)) } }
                message?.let { Text(it) }
                val d = data
                if (d != null) {
                    if (!d.flag("configured")) Text(stringResource(R.string.gpt_disconnected))
                    val manage = d.flag("canManage") && !busy
                    if (kind == "schedules") {
                        if (d.flag("canManage")) TextButton(onClick = { showRuns = true }) { Text(stringResource(R.string.au_tab_runs)) }
                        d.rows("schedules").forEach { row -> Card { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(stringResource(R.string.gpt_digest))
                            val dayLabels = listOf(R.string.au_d7,R.string.au_d1,R.string.au_d2,R.string.au_d3,R.string.au_d4,R.string.au_d5,R.string.au_d6)
                            val dayText = (row["weekdays"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.intOrNull }.filter { it in 0..6 }.map { stringResource(dayLabels[it]) }.joinToString(", ")
                            Text(dayText + " / " + row.text("time") + " / " + row.text("timezone"))
                            Text(row.text("instructions"))
                            Row { Text(stringResource(R.string.ab_enabled), Modifier.weight(1f)); Switch(row.flag("enabled"), { on -> perform { api.saveSchedule(project,row.text("id"),buildJsonObject { put("enabled",on) }) } }, enabled = manage) }
                            row.text("nextRunAt").takeIf { it.isNotBlank() }?.let { Text(stringResource(R.string.au_next_run, id.znetworks.nexus.feature.chat.chatTime(it))) }
                            if (row.text("lastStatus").isNotBlank()) Text(scheduleStatus(row.text("lastStatus")) + " / " + id.znetworks.nexus.feature.chat.chatTime(row.text("lastRunAt")))
                            Text(row.objectAt("runsAs").text("name"))
                            if (d.flag("canManage")) {
                                TextButton(onClick = { editSchedule = row }, enabled = manage) { Text(stringResource(R.string.gpt_edit_schedule)) }
                                TextButton(onClick = { perform { api.runSchedule(row.text("id")); message = ctx.getString(R.string.gpt_digest_started) } }, enabled = manage && d.flag("configured")) { Text(stringResource(R.string.au_run_now)) }
                                TextButton(onClick = { confirmation = ctx.getString(R.string.gpt_delete_schedule) to { api.deleteSchedule(row.text("id")); Unit } }, enabled = manage) { Text(stringResource(R.string.au_delete)) }
                            }
                        } } }
                        if (d.flag("canManage")) TextButton(onClick = { editSchedule = buildJsonObject {} }, enabled = manage && d.rows("schedules").size < 3) { Text(stringResource(R.string.gpt_new_schedule)) }
                        Text(stringResource(R.string.gpt_mentions))
                    } else {
                        val configs = d.rows("configs")
                        configs.forEach { config -> val field = fields.find { it.id == config.text("customFieldId") }
                            if (field != null) AutofillConfigCard(config,field,manage,d.flag("configured"),busy, { patch -> perform { api.saveAutofill(field.id,patch) } }, { all ->
                                val action: suspend () -> Unit = { val result = api.runAutofill(field.id, if (all) "all" else "empty"); message = ctx.getString(R.string.gpt_fill_started,result.number("count")?.toInt() ?: 0,result.number("remaining")?.toInt() ?: 0) }
                                if (all) confirmation = ctx.getString(R.string.gpt_refill_confirm) to action else perform(action)
                            }, { confirmation = ctx.getString(R.string.gpt_remove_confirm) to { api.deleteAutofill(field.id); Unit } }, { close(); container.router.open(id.znetworks.nexus.core.nav.Target.Gideon) })
                        }
                        val eligible = fields.filter { it.kind in listOf("TEXT","URL","NUMBER","SELECT","DROPDOWN","MULTI_SELECT","STATUS","DATE") && configs.none { c -> c.text("customFieldId") == it.id } }
                        if (configs.isEmpty()) Text(stringResource(R.string.gpt_no_fields))
                        if (manage) eligible.forEach { field -> TextButton(onClick = { perform { api.saveAutofill(field.id,buildJsonObject {}) } }) { Text(stringResource(R.string.gpt_add_field,field.name)) } }
                    }
                }
            }
        } }
    }
    editSchedule?.let { row -> ScheduleEditor(row, busy, error, { editSchedule = null }, { patch -> perform { api.saveSchedule(project,row.text("id").ifBlank { null },patch); editSchedule = null } }) }
    confirmation?.let { (title,action) -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(title) }, confirmButton = { TextButton(onClick = { confirmation = null; perform(action) }) { Text(stringResource(R.string.confirm)) } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.cancel)) } }) }
}

@Composable
private fun ScheduleEditor(row: JsonObject, busy: Boolean, error: String?, close: () -> Unit, save: (JsonObject) -> Unit) {
    val ctx = LocalContext.current
    var days by remember { mutableStateOf((row["weekdays"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.intOrNull } ?: listOf(1)) }
    var time by remember { mutableStateOf(row.text("time").ifBlank { "09:00" }) }
    var zone by remember { mutableStateOf(row.text("timezone").ifBlank { "Asia/Jakarta" }) }
    var language by remember { mutableStateOf(row.text("language").ifBlank { if (ctx.resources.configuration.locales[0].language in listOf("in", "id")) "id" else "en" }) }
    var instructions by remember { mutableStateOf(row.text("instructions")) }
    var discard by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) discard = true }, title = { Text(stringResource(R.string.gpt_digest)) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            listOf(1,2,3,4,5,6,0).forEach { day -> Row { Checkbox(day in days,{ on -> days = if(on) days + day else days - day },enabled = !busy); Text(stringResource(listOf(R.string.au_d7,R.string.au_d1,R.string.au_d2,R.string.au_d3,R.string.au_d4,R.string.au_d5,R.string.au_d6)[day]),Modifier.padding(top=12.dp)) } }
            OutlinedTextField(time,{ time=it },label={Text(stringResource(R.string.gpt_time))},enabled=!busy)
            BuilderPick(stringResource(R.string.gpt_timezone),zone,listOf("Asia/Jakarta","Asia/Makassar","Asia/Jayapura","Asia/Singapore","UTC").map{it to it},!busy){zone=it}
            BuilderPick(stringResource(R.string.gpt_language),language,listOf("en" to stringResource(R.string.gpt_language_en),"id" to stringResource(R.string.gpt_language_id)),!busy){language=it}
            OutlinedTextField(instructions,{ if(it.length<=500) instructions=it },label={Text(stringResource(R.string.gpt_instructions))},enabled=!busy)
        }
    },confirmButton={TextButton(onClick={save(buildJsonObject{put("weekdays",JsonArray(days.distinct().map{JsonPrimitive(it)}));put("time",time);put("timezone",zone);put("language",language);put("instructions",instructions.trim().takeIf{it.isNotEmpty()}?.let{JsonPrimitive(it)}?:JsonNull)})},enabled=!busy&&days.isNotEmpty()&&Regex("([01][0-9]|2[0-3]):[0-5][0-9]").matches(time)){Text(stringResource(R.string.save))}},dismissButton={TextButton(onClick={discard=true},enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(discard) AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.ab_discard))},confirmButton={TextButton(onClick=close){Text(stringResource(R.string.ab_discard_action))}},dismissButton={TextButton(onClick={discard=false}){Text(stringResource(R.string.cancel))}})
}

@Composable
private fun AutofillConfigCard(c: JsonObject, field: CustomFieldDef, manage: Boolean, configured: Boolean, busy: Boolean, save: (JsonObject)->Unit, run: (Boolean)->Unit, remove: ()->Unit, review: ()->Unit) {
    var prompt by remember(c.text("customFieldId"),c.text("prompt")) { mutableStateOf(c.text("prompt")) }
    val running=c.objectAt("lastResult").text("at")=="running"
    fun toggle(key:String,on:Boolean)=save(buildJsonObject{put(key,on)})
    Card { Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(field.name,style=MaterialTheme.typography.titleMedium)
        listOf("enabled" to R.string.ab_enabled,"onCreate" to R.string.gpt_on_create,"onUpdate" to R.string.gpt_on_update).forEach{(key,label)->Row{Text(stringResource(label),Modifier.weight(1f));Switch(c.flag(key),{toggle(key,it)},enabled=manage)}}
        val modes=when(field.kind){"SELECT","DROPDOWN","MULTI_SELECT","STATUS"->listOf("classify");"TEXT"->listOf("summary","extract","classify");else->listOf("extract")}
        BuilderPick(stringResource(R.string.gpt_mode),c.text("mode"),modes.map{it to stringResource(when(it){"summary"->R.string.gpt_summary;"classify"->R.string.gpt_classify;else->R.string.gpt_extract})},manage){save(buildJsonObject{put("mode",it)})}
        OutlinedTextField(prompt,{if(it.length<=1000)prompt=it},label={Text(stringResource(R.string.gpt_instructions))},enabled=manage,modifier=Modifier.fillMaxWidth())
        TextButton(onClick={save(buildJsonObject{put("prompt",prompt)})},enabled=manage&&prompt!=c.text("prompt")){Text(stringResource(R.string.save))}
        Row{Text(stringResource(R.string.gpt_review),Modifier.weight(1f));Switch(c.text("approval")!="auto",{save(buildJsonObject{put("approval",if(it)"review" else "auto")})},enabled=manage)}
        if(c.text("approval")!="auto") TextButton(onClick=review,enabled=!busy){Text(stringResource(R.string.gpt_review_gideon))}
        if(c.text("lastRunAt").isNotBlank())Text(scheduleStatus(c.text("lastStatus")) + " / " + id.znetworks.nexus.feature.chat.chatTime(c.text("lastRunAt")))
        val last=c.objectAt("lastResult")
        if(running)Text(stringResource(R.string.gpt_running)) else if(last.isNotEmpty())Text(stringResource(R.string.gpt_result,last.number("filled")?.toInt()?:0,last.number("proposed")?.toInt()?:0,last.number("skipped")?.toInt()?:0))
        last.text("error").takeIf{it.isNotBlank()}?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        if(manage){TextButton(onClick={run(false)},enabled=configured&&!running&&!busy){Text(stringResource(R.string.gpt_fill_empty))};TextButton(onClick={run(true)},enabled=configured&&!running&&!busy){Text(stringResource(R.string.gpt_refill))};TextButton(onClick=remove,enabled=!running&&!busy){Text(stringResource(R.string.ab_remove))}}
    } }
}

@Composable
private fun scheduleStatus(status: String): String = stringResource(when(status) { "RUNNING" -> R.string.gi_running; "SUCCEEDED", "SUCCESS" -> R.string.gi_succeeded; "FAILED" -> R.string.gi_failed; else -> R.string.au_never_ran })
