package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

// A folder's calendar (iOS FolderAggregateView, web /folders/$id on mobile): every task due across
// the folder's projects (sub-folders included), coloured per project, with a curated project subset.

object FolderLogic {
    val PALETTE = listOf("#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b")

    /** Every folder nested under [id], at any depth. */
    fun descendants(id: String, folders: List<ProjectFolder>): Set<String> {
        val out = mutableSetOf<String>()
        fun walk(parent: String) { folders.filter { it.parentFolderId == parent }.forEach { if (out.add(it.id)) walk(it.id) } }
        walk(id)
        return out
    }
    fun folderProjects(id: String, folders: List<ProjectFolder>, projects: List<Project>): List<Project> {
        val tree = descendants(id, folders) + id
        return projects.filter { it.folderId in tree }
    }
    /** An empty curated list means every project in the folder (and the ones added later). */
    fun selected(configured: List<String>, inFolder: List<Project>): List<String> {
        val all = inFolder.map { it.id }
        return if (configured.isEmpty()) all else configured.filter { it in all.toSet() }
    }
    /** All picked is stored as [] so the folder keeps including new projects (as the web). */
    fun toSave(picked: Set<String>, inFolder: List<Project>): List<String> {
        val all = inFolder.map { it.id }
        return if (all.isNotEmpty() && picked.containsAll(all)) emptyList() else all.filter { it in picked }
    }
    fun byDay(tasks: List<BoardTask>, month: YearMonth): Map<Int, List<BoardTask>> =
        tasks.mapNotNull { t -> dueDate(t.dueDate)?.takeIf { YearMonth.from(it) == month }?.let { it.dayOfMonth to t } }
            .groupBy({ it.first }, { it.second })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FolderCalendarScreen(folderId: String, onBack: () -> Unit, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val api = remember { ProjectsApi(container.api) }
    val scope = rememberCoroutineScope()
    var folders by remember { mutableStateOf<List<ProjectFolder>>(emptyList()) }
    var projects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var configured by remember { mutableStateOf<List<String>?>(null) }
    var tasks by remember { mutableStateOf<List<BoardTask>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var colors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var picking by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    val folder = folders.firstOrNull { it.id == folderId }
    val inFolder = FolderLogic.folderProjects(folderId, folders, projects)
    val selectedIds = FolderLogic.selected(configured.orEmpty(), inFolder)
    val byId = projects.associateBy { it.id }
    fun colorOf(pid: String?) = colors[pid] ?: byId[pid]?.color ?: "#7b68ee"

    // A folder that isn't in the list (a deal's execution folder not reachable, a failed load) says so (PIPELINE §15.2).
    var missing by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        missing = false
        folders = runCatching { api.folders().value }.getOrDefault(emptyList())
        projects = runCatching { api.projects().value }.getOrDefault(emptyList())
        missing = folders.none { it.id == folderId }
        configured = folders.firstOrNull { it.id == folderId }?.aggregateProjectIds.orEmpty()
    }
    // A folder renamed or a project moved on another device (Berlin, 8 Oct).
    id.znetworks.nexus.core.realtime.LiveRefresh(folderId, liveMs = 120_000, fallbackMs = 30_000, matches = id.znetworks.nexus.core.realtime.RealtimeEvents::isProjectsOrFolders) {
        runCatching { api.folders().value }.getOrNull()?.let { folders = it }
        runCatching { api.projects().value }.getOrNull()?.let { projects = it }
    }
    LaunchedEffect(configured, projects, tick) {
        if (configured == null) return@LaunchedEffect
        loading = true
        tasks = runCatching { api.tasksOf(selectedIds) }.getOrDefault(emptyList())
        loading = false
    }

    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(folder?.name ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
            IconButton(onClick = { picking = true }, enabled = configured != null) { Icon(Icons.Filled.Tune, stringResource(R.string.fc_pick)) }
        }
        if (missing) {
            id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.Folder, stringResource(R.string.fc_not_found), "",
                stringResource(R.string.try_again), { attempt++ }, Modifier.fillMaxSize())
            return@Column
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.fc_counts, selectedIds.size, tasks.size), fontSize = 12.sp, color = c.mutedFg)
            val chosen = selectedIds.mapNotNull { byId[it] }
            if (chosen.isNotEmpty()) Legend(chosen, ::colorOf) { pid, hex ->
                colors = colors + (pid to hex)
                scope.launch { runCatching { api.updateProject(pid, buildJsonObject { put("color", JsonPrimitive(hex)) }) } }
            }
            when {
                loading -> Row(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.fc_loading), fontSize = 13.sp, color = c.mutedFg)
                }
                selectedIds.isEmpty() -> Empty(stringResource(R.string.fc_no_projects))
                else -> MonthCalendar(tasks, ::colorOf, byId, onOpenTask)
            }
        }
    }
    if (picking) {
        var picked by remember { mutableStateOf(selectedIds.toSet()) }
        AlertDialog(onDismissRequest = { picking = false }, title = { Text(stringResource(R.string.fc_pick)) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(stringResource(R.string.fc_pick_note) + if (configured.isNullOrEmpty()) " " + stringResource(R.string.fc_pick_all_now) else "", fontSize = 12.sp, color = c.mutedFg)
                Row {
                    TextButton(onClick = { picked = inFolder.map { it.id }.toSet() }) { Text(stringResource(R.string.fc_select_all)) }
                    TextButton(onClick = { picked = emptySet() }) { Text(stringResource(R.string.fc_clear), color = c.mutedFg) }
                }
                if (inFolder.isEmpty()) Text(stringResource(R.string.fc_folder_empty), fontSize = 13.sp, color = c.mutedFg)
                inFolder.forEach { p ->
                    val on = p.id in picked
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))
                        .clickable { picked = if (on) picked - p.id else picked + p.id }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (on) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (on) c.violetText else c.mutedFg)
                        Spacer(Modifier.width(10.dp)); ProjectMark(p.icon, 22.dp, projectId = p.id); Spacer(Modifier.width(8.dp))
                        Text(p.name, fontSize = 14.sp, color = c.foreground, maxLines = 1)
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = {
            val next = FolderLogic.toSave(picked, inFolder)
            picking = false
            scope.launch { runCatching { api.setFolderAggregate(folderId, next) }; configured = next; tick++ }
        }) { Text(stringResource(R.string.save)) } }, dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(projects: List<Project>, colorOf: (String?) -> String, onRecolor: (String, String) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            projects.take(6).forEach { p -> Box(Modifier.size(11.dp).background(parseColor(colorOf(p.id), c.violet), CircleShape)); Spacer(Modifier.width(2.dp)) }
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.fc_colors), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
            Text(if (open) "▾" else "▸", color = c.mutedFg)
        }
        if (open) projects.forEach { p ->
            val col = parseColor(colorOf(p.id), c.violet)
            Row(Modifier.fillMaxWidth().clip(CircleShape).background(col.copy(alpha = 0.12f)).clickable { editing = if (editing == p.id) null else p.id }
                .padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(14.dp).background(col, CircleShape)); Spacer(Modifier.width(8.dp))
                Text(p.name, fontSize = 13.sp, color = col, maxLines = 1, modifier = Modifier.weight(1f))
                Text("🎨", fontSize = 11.sp)
            }
            if (editing == p.id) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(start = 4.dp)) {
                FolderLogic.PALETTE.forEach { hex ->
                    Box(Modifier.size(24.dp).clip(CircleShape).background(parseColor(hex, c.violet))
                        .border(2.dp, if (colorOf(p.id).equals(hex, true)) c.foreground else Color.Transparent, CircleShape)
                        .clickable { onRecolor(p.id, hex); editing = null })
                }
            }
        }
    }
}

@Composable
private fun MonthCalendar(tasks: List<BoardTask>, colorOf: (String?) -> String, byId: Map<String, Project>, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val today = LocalDate.now(OfficeTime.ZONE)
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var picked by remember { mutableStateOf<Int?>(null) }
    val days = FolderLogic.byDay(tasks, month)
    val todayDay = today.dayOfMonth.takeIf { YearMonth.from(today) == month }
    val selected = picked ?: todayDay ?: days.keys.minOrNull()
    val dayTasks = selected?.let { days[it] }.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { picked = null; month = month.minusMonths(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null) }
                Text(month.atDay(1).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())).replaceFirstChar { it.titlecase() },
                    fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick = { picked = null; month = month.plusMonths(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }
            }
            Row { java.time.DayOfWeek.entries.forEach { d -> Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }
            // Monday first.
            val blanks = month.atDay(1).dayOfWeek.value - 1
            val cells = List(blanks) { null } + (1..month.lengthOfMonth()).toList()
            cells.chunked(7).forEach { week ->
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    (0 until 7).forEach { i ->
                        val day = week.getOrNull(i)
                        Box(Modifier.weight(1f).height(38.dp)) {
                            if (day != null) {
                                val has = days[day] != null; val sel = day == selected
                                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp))
                                    .background(if (sel) c.violet else if (has) c.violet.copy(alpha = 0.12f) else Color.Transparent)
                                    .then(if (!sel && day == todayDay) Modifier.border(1.dp, c.violet.copy(alpha = 0.5f), RoundedCornerShape(12.dp)) else Modifier)
                                    .clickable { picked = day }, contentAlignment = Alignment.Center) {
                                    Text("$day", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (sel) Color.White else if (has) c.foreground else c.mutedFg)
                                    if (has) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).size(5.dp).background(if (sel) Color.White else c.violet, CircleShape))
                                }
                            }
                        }
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.fc_date, selected?.toString() ?: "—"), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.fc_n_tasks, dayTasks.size), fontSize = 12.sp, color = c.mutedFg)
        }
        if (dayTasks.isEmpty()) Empty(stringResource(R.string.fc_nothing_due))
        dayTasks.forEach { t ->
            val pid = t.taskList?.projectId
            val col = parseColor(colorOf(pid), c.violet)
            val done = t.status.equals("DONE", true)
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp)).clickable { onOpenTask(t.id) },
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(4.dp).height(56.dp).background(col))
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (done) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, Modifier.size(16.dp), tint = if (done) c.success else c.mutedFg.copy(alpha = 0.45f))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (done) c.mutedFg else c.foreground, maxLines = 2,
                            textDecoration = if (done) TextDecoration.LineThrough else null)
                        byId[pid]?.let { p -> Row(verticalAlignment = Alignment.CenterVertically) {
                            ProjectMark(p.icon, 12.dp, projectId = p.id); Spacer(Modifier.width(4.dp))
                            Text(p.name, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = col, maxLines = 1)
                        } }
                    }
                    PriorityChip(t.priority, Modifier.padding(start = 6.dp, end = 6.dp))
                    t.assignees.firstOrNull()?.user?.let { u -> Avatar(u.name, u.avatar, 24.dp) }
                }
            }
        }
    }
}

@Composable
private fun Empty(text: String) = Text(text, fontSize = 13.sp, color = Nx.colors.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Nx.colors.card).padding(28.dp))
