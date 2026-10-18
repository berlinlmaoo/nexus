package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.i18n.AppDateFormats

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// The Automations tab (DEV-REDESIGN §2; web AutomationsView + AutomationBuilder's run log). Rules are read
// here in plain words, switched on and off and run by hand by the people who lead the project; building
// one stays on the web. Live: `automations-changed` on the project room refetches.

private fun runTone(status: String?): Color = when (status) {
    "SUCCESS" -> Color(0xFF10B981)
    "PARTIAL" -> Color(0xFFF59E0B)
    "FAILED" -> Color(0xFFEF4444)
    "RUNNING" -> Color(0xFF7C3AED)
    else -> Color(0xFF94A3B8)
}

private fun ago(iso: String?): String? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }
    ?.let { DateUtils.getRelativeTimeSpanString(it.toEpochMilli(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString() }

private fun wib(iso: String?): String? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }
    ?.let { AppDateFormats.ofPattern("d MMM HH:mm:ss", Locale.getDefault()).withZone(ZoneId.of("Asia/Jakarta")).format(it) + " WIB" }

@Composable
private fun rememberSay(): Say {
    val ctx = LocalContext.current
    return remember(ctx) { { id: Int, args: Array<out Any> -> ctx.getString(id, *args) } }
}

@Composable
fun AutomationsTab(projectId: String, lanes: List<Lane>, members: List<ProjectMemberRef>) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val api = ProjectsApi((ctx.applicationContext as NexusApplication).container.api)
    val say = rememberSay()
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var data by remember(projectId) { mutableStateOf<AutomationsResponse?>(null) }
    var loadError by remember(projectId) { mutableStateOf<String?>(null) }
    var fields by remember(projectId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Pair<String, Int>?>(null) }
    // Bumped by every live ping: an open run log refetches too.
    var runsTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(projectId, tick) {
        try { data = api.automations(projectId); loadError = null } catch (e: ApiError) { loadError = e.describe(ctx.resources) }
    }
    LaunchedEffect(projectId) { fields = runCatching { api.customFields(projectId) }.getOrDefault(emptyList()).associate { it.id to it.name } }
    LiveRefresh(projectId, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == RealtimeEvents.AUTOMATIONS_CHANGED && it.projectId == projectId }) { tick++; runsTick++ }
    val names = AutomationNames(
        sections = lanes.associate { it.id to it.name },
        people = members.filter { it.uid.isNotEmpty() }.associate { it.uid to (it.user?.name ?: it.user?.email ?: "—") },
        fields = fields,
    )
    val d = data
    when {
        d == null && loadError == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        d == null -> EmptyState(Icons.Filled.Bolt, stringResource(R.string.au_load_failed), loadError.orEmpty(), stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Text(stringResource(R.string.au_intro), fontSize = 13.sp, color = c.mutedFg)
            }
            if (d.automations.isEmpty()) item {
                Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Filled.Bolt, null, tint = c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(28.dp))
                    Text(stringResource(R.string.au_empty_title), fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text(stringResource(if (d.canEdit) R.string.au_empty_lead else R.string.au_empty_member), fontSize = 12.sp, color = c.mutedFg, textAlign = TextAlign.Center)
                    if (d.canEdit) TextButton(onClick = { id.znetworks.nexus.ui.shell.openWeb(ctx, "/projects/$projectId?v=automations") }) { Text(stringResource(R.string.open_on_web)) }
                }
            }
            items(d.automations, key = { it.id }) { a ->
                AutomationRow(a, d.canEdit, names, say,
                    onToggle = { on ->
                        data = d.copy(automations = d.automations.map { if (it.id == a.id) it.copy(enabled = on) else it })
                        scope.launch {
                            try { api.setAutomation(a.id, on) } catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(ctx.resources) }
                            tick++
                        }
                    },
                    onOpen = { tab -> open = a.id to tab })
            }
        }
    }
    val current = open?.let { (id, _) -> d?.automations?.firstOrNull { it.id == id } }
    if (current != null) AutomationDialog(current, d!!.canEdit, open!!.second, names, lanes, runsTick, api, onChanged = { tick++ }) { open = null }
    error?.let { AlertDialog(onDismissRequest = { error = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { error = null }) { Text("OK") } }) }
}

@Composable
private fun AutomationRow(a: Automation, canEdit: Boolean, names: AutomationNames, say: Say, onToggle: (Boolean) -> Unit, onOpen: (Int) -> Unit) {
    val c = Nx.colors
    val on = a.enabled == true
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))
        .clickable { onOpen(0) }.padding(start = 14.dp, top = 12.dp, bottom = 12.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Bolt, null, tint = if (on) c.violetText else c.mutedFg, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(a.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (on) c.foreground else c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(AutomationText.summary(a, names, say), fontSize = 12.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            // Last run (opens the log), run count; a schedule's next run.
            Row(Modifier.clip(RoundedCornerShape(6.dp)).clickable { onOpen(1) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                if (a.lastRunAt != null) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(runTone(a.lastRunStatus)))
                    Spacer(Modifier.width(5.dp))
                    val status = AutomationText.RUN_STATUS[a.lastRunStatus]?.let { stringResource(it) }
                    Text(listOfNotNull(status, ago(a.lastRunAt), a.runCount.takeIf { it > 0 }?.let { n -> say(if (n == 1) R.string.au_one_run else R.string.au_n_runs, arrayOf(n)) })
                        .joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                } else Text(stringResource(R.string.au_never_ran), fontSize = 11.sp, color = c.mutedFg)
            }
            if (on && a.nextRunAt != null) wib(a.nextRunAt)?.let { Text(stringResource(R.string.au_next_run, it), fontSize = 11.sp, color = c.mutedFg) }
        }
        // Only the people who lead the project switch it; everyone else sees the state.
        Switch(on, onToggle, enabled = canEdit)
    }
}

/** Full screen: the rule in plain words (When / If / Do) and its run log; Run now for leads. */
@Composable
private fun AutomationDialog(a: Automation, canEdit: Boolean, initialTab: Int, names: AutomationNames, lanes: List<Lane>, runsTick: Int, api: ProjectsApi,
                             onChanged: () -> Unit, onDismiss: () -> Unit) {
    val c = Nx.colors
    val say = rememberSay()
    var tab by remember { mutableIntStateOf(initialTab) }
    var localTick by remember { mutableIntStateOf(0) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.au_close)) }
                Text(a.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(72.dp))
            }
            TabRow(tab, containerColor = c.background) {
                Tab(tab == 0, { tab = 0 }, text = { Text(stringResource(R.string.au_tab_rule)) })
                Tab(tab == 1, { tab = 1 }, text = { Text(stringResource(R.string.au_tab_runs)) })
            }
            Box(Modifier.weight(1f)) {
                if (tab == 0) RuleView(a, names, say) else RunLog(a.id, api, runsTick + localTick)
            }
            if (canEdit) RunNowBar(a, lanes, api) { localTick++; onChanged(); tab = 1 }
        }
    }
}

@Composable
private fun RuleView(a: Automation, names: AutomationNames, say: Say) {
    val c = Nx.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RuleSection(stringResource(R.string.au_when_caps), listOf(AutomationText.trigger(a.trigger, names, say)))
        val conds = a.conditions?.rules.orEmpty()
        if (conds.isNotEmpty()) RuleSection(stringResource(if (a.conditions?.match == "any") R.string.au_if_any else R.string.au_if_all),
            conds.map { AutomationText.condition(it, names, say) })
        RuleSection(stringResource(R.string.au_do_caps), a.steps.mapIndexed { i, s -> "${i + 1}. " + AutomationText.action(s, names, say) })
        Text(stringResource(R.string.au_edit_on_web), fontSize = 12.sp, color = c.mutedFg)
    }
}

@Composable
private fun RuleSection(label: String, lines: List<String>) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = c.violetText)
        lines.forEach { Text(it, fontSize = 14.sp, color = c.foreground) }
    }
}

@Composable
private fun RunLog(automationId: String, api: ProjectsApi, refresh: Int) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var runs by remember(automationId) { mutableStateOf<List<AutomationRun>?>(null) }
    var hasMore by remember(automationId) { mutableStateOf(false) }
    var failed by remember(automationId) { mutableStateOf<String?>(null) }
    var loadingMore by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(automationId, refresh) {
        try { val r = api.automationRuns(automationId); runs = r.runs; hasMore = r.hasMore; failed = null }
        catch (e: ApiError) { failed = e.describe(ctx.resources) }
    }
    val list = runs
    when {
        list == null && failed == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        list == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { Text(stringResource(R.string.au_runs_failed), color = c.mutedFg, textAlign = TextAlign.Center) }
        list.isEmpty() -> Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically)) {
            Icon(Icons.Filled.Bolt, null, tint = c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(28.dp))
            Text(stringResource(R.string.au_no_runs), fontWeight = FontWeight.SemiBold, color = c.foreground)
            Text(stringResource(R.string.au_no_runs_sub), fontSize = 12.sp, color = c.mutedFg, textAlign = TextAlign.Center)
        }
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(list, key = { it.id }) { r ->
                val open = expanded == r.id
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
                    Row(Modifier.fillMaxWidth().clickable { expanded = if (open) null else r.id }.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            val event = AutomationText.EVENTS[r.event]?.let { stringResource(it) } ?: r.event
                            val task = r.task?.title ?: if (r.taskId != null) stringResource(R.string.au_task_deleted) else null
                            Text(listOfNotNull(event, task).joinToString(" · "), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(wib(r.createdAt), r.actor?.name).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                        }
                        Box(Modifier.size(7.dp).clip(CircleShape).background(runTone(r.status)))
                        Spacer(Modifier.width(5.dp))
                        Text(AutomationText.RUN_STATUS[r.status]?.let { stringResource(it) } ?: r.status, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                    }
                    if (open) Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (r.steps.isEmpty()) Text(stringResource(R.string.au_no_steps), fontSize = 12.sp, color = c.mutedFg)
                        r.steps.forEach { st ->
                            Row(verticalAlignment = Alignment.Top) {
                                when {
                                    !st.ok -> Icon(Icons.Filled.Warning, null, tint = c.danger, modifier = Modifier.size(14.dp))
                                    st.skipped -> Box(Modifier.size(14.dp).border(1.dp, c.mutedFg.copy(alpha = 0.5f), CircleShape))
                                    else -> Icon(Icons.Filled.Check, null, tint = Color(0xFF10B981), modifier = Modifier.size(14.dp))
                                }
                                Spacer(Modifier.width(6.dp))
                                val label = AutomationText.ACTIONS[st.type]?.let { stringResource(it) } ?: st.type
                                Text("$label · ${st.message}", fontSize = 12.sp, color = if (st.ok) c.foreground else c.dangerText)
                            }
                        }
                        r.error?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.dangerText) }
                        r.durationMs?.let { Text(stringResource(R.string.au_ms, it), fontSize = 11.sp, color = c.mutedFg) }
                    }
                }
            }
            if (hasMore) item {
                OutlinedButton(onClick = {
                    val last = list.lastOrNull()?.createdAt ?: return@OutlinedButton
                    loadingMore = true
                    scope.launch {
                        try { val r = api.automationRuns(automationId, last); runs = list + r.runs; hasMore = r.hasMore }
                        catch (_: ApiError) { }
                        loadingMore = false
                    }
                }, enabled = !loadingMore, modifier = Modifier.fillMaxWidth()) { Text(stringResource(if (loadingMore) R.string.au_loading else R.string.au_load_older)) }
            }
        }
    }
}

/** Run now (LEAD): on a task of this project, or on none (only task-free actions run then). */
@Composable
private fun RunNowBar(a: Automation, lanes: List<Lane>, api: ProjectsApi, onRan: () -> Unit) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val tasks = remember(lanes) { lanes.flatMap { it.tasks }.take(300) }
    var taskId by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    Row(Modifier.fillMaxWidth().background(c.card).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            TextButton(onClick = { menu = true }, enabled = !busy) {
                Text(tasks.firstOrNull { it.id == taskId }?.title ?: stringResource(R.string.au_no_task), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                Icon(Icons.Filled.KeyboardArrowDown, null, modifier = Modifier.size(16.dp))
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.au_no_task)) }, onClick = { taskId = null; menu = false })
                tasks.forEach { t -> DropdownMenuItem(text = { Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = { taskId = t.id; menu = false }) }
            }
        }
        OutlinedButton(onClick = {
            busy = true
            scope.launch {
                result = try {
                    val r = api.runAutomation(a.id, taskId)
                    val run = r.run
                    if (run == null) ctx.getString(R.string.au_ran_nothing)
                    else ctx.getString(R.string.au_ran, AutomationText.RUN_STATUS[run.status]?.let(ctx::getString) ?: run.status).also { onRan() }
                } catch (e: ApiError) { (e as? ApiError.Http)?.serverMessage ?: ctx.getString(R.string.au_run_failed_to) }
                busy = false
            }
        }, enabled = !busy) {
            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            else { Icon(Icons.Filled.PlayArrow, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.au_run_now)) }
        }
    }
    result?.let { AlertDialog(onDismissRequest = { result = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { result = null }) { Text("OK") } }) }
}
