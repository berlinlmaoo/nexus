package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.feature.gideon.GStep
import id.znetworks.nexus.feature.gideon.stepText

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.serialization.json.JsonObject
import java.net.URLEncoder

class GideonInsightsApi(private val api: ApiClient) {
    suspend fun runs(trigger: String, status: String) = api.get("/api/gideon/runs?limit=100&trigger=$trigger&status=$status", JsonObject.serializer())
    suspend fun detail(id: String) = api.get("/api/gideon/runs/" + URLEncoder.encode(id, "UTF-8"), JsonObject.serializer())
}

/** Never infer access to a private chat from access to aggregate run statistics. */
object InsightPrivacy {
    fun title(row: JsonObject) = row.text("title").takeUnless { row.flag("titleHidden") }
    fun steps(detail: JsonObject) = if (detail.flag("stepsHidden")) emptyList() else detail.rows("steps")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun GideonInsightsTab() {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    if (!container.viewer.isBoD) return
    val api = remember { GideonInsightsApi(container.api) }
    var trigger by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var retry by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(trigger, status, retry) {
        loading = true; data = null
        try { data = api.runs(trigger, status); error = null }
        catch (e: ApiError) { error = e.describe(context.resources) }
        loading = false
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.gi_title), style = MaterialTheme.typography.titleLarge)
            data?.objectAt("totals")?.let { totals ->
                Text(stringResource(R.string.gi_days, totals.number("days")?.toInt() ?: 0))
                listOf("runs" to R.string.gi_runs, "completionRate" to R.string.gi_completion, "failures" to R.string.gi_failures, "activeUsers" to R.string.gi_people).forEach { (key, label) ->
                    Text("${stringResource(label)}: ${totals.number(key)?.toInt()?.toString() ?: "—"}" + if (key == "completionRate" && totals.number(key) != null) "%" else "")
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("", "CHAT", "MENTION", "SCHEDULE", "TICKET", "REFLECTION").forEach { key ->
                    FilterChip(selected = trigger == key, onClick = { trigger = key }, label = { Text(stringResource(triggerLabel(key))) })
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("", "RUNNING", "SUCCEEDED", "FAILED").forEach { key ->
                    FilterChip(selected = status == key, onClick = { status = key }, label = { Text(stringResource(statusLabel(key))) })
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.try_again)) } }
            if (!loading && error == null && data?.rows("runs").isNullOrEmpty()) Text(stringResource(R.string.gi_empty))
        }
        items(data?.rows("runs").orEmpty(), key = { it.text("id") }) { run ->
            OutlinedCard(onClick = { selected = run.text("id") }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RunSummary(run)
                    Text(stringResource(R.string.gi_tools, run.number("toolCalls")?.toInt() ?: 0))
                }
            }
        }
    }
    selected?.let { id -> RunDialog(api, id) { selected = null } }
}

@Composable
private fun RunSummary(run: JsonObject) {
    Text(InsightPrivacy.title(run) ?: stringResource(R.string.gi_private), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(triggerLabel(run.text("trigger"))) + " · " + stringResource(statusLabel(run.text("status"))))
    Text(run.objectAt("user").text("name") + " · " + chatTime(run.text("startedAt")), style = MaterialTheme.typography.bodySmall)
    run.number("durationMs")?.let { Text(stringResource(R.string.gi_duration, it.toLong())) }
    if (run.text("error").isNotBlank()) Text(run.text("error"), color = MaterialTheme.colorScheme.error)
}

@Composable
private fun RunDialog(api: GideonInsightsApi, id: String, close: () -> Unit) {
    val context = LocalContext.current
    var detail by remember(id) { mutableStateOf<JsonObject?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(id, retry) { try { detail = api.detail(id); error = null } catch (e: ApiError) { error = e.describe(context.resources) } }
    AlertDialog(onDismissRequest = close, title = { Text(stringResource(R.string.gi_run)) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (detail == null && error == null) CircularProgressIndicator()
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.try_again)) } }
            detail?.let { d ->
                RunSummary(d.objectAt("run"))
                if (d.flag("stepsHidden")) Text(stringResource(R.string.gi_hidden_steps))
                else InsightPrivacy.steps(d).forEach { step ->
                    val tool = step.text("tool")
                    val label = step.text("label").ifEmpty { tool }.let { if (Regex("^[a-z][a-z0-9_]*$").matches(it)) it.replace('_', ' ').replaceFirstChar(Char::titlecase) else it }
                    Text(stepText(GStep(tool = tool, label = label)))
                    if (step.text("error").isNotEmpty()) Text(step.text("error"), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.sm_close)) } })
}

private fun triggerLabel(trigger: String) = when (trigger) {
    "CHAT" -> R.string.gi_chat; "MENTION" -> R.string.gi_mention; "SCHEDULE" -> R.string.gi_schedule
    "TICKET" -> R.string.gi_ticket; "REFLECTION" -> R.string.gi_reflection; else -> R.string.xpa_all
}
private fun statusLabel(status: String) = when (status) {
    "RUNNING" -> R.string.gi_running; "SUCCEEDED" -> R.string.gi_succeeded; "FAILED" -> R.string.gi_failed; else -> R.string.xpa_all
}
