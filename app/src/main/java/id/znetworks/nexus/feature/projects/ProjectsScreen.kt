package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.drawBehind
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.ui.platform.LocalContext
import id.znetworks.nexus.feature.home.ShortcutRef
import android.app.Application
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.ui.components.AvatarStack
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

data class Tally(val done: Int, val total: Int, val nextDue: LocalDate?)

data class ProjectsState(
    val projects: List<Project> = emptyList(),
    val folders: List<ProjectFolder> = emptyList(),
    val tallies: Map<String, Tally>? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val savedAt: Long? = null,
    val query: String = "",
    val taskHits: List<BoardTask> = emptyList(),
    val searching: Boolean = false,
    val busy: Boolean = false,
    val message: String? = null,
)

class ProjectsViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    val api = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(ProjectsState())
    val state = _state.asStateFlow()
    private var searchJob: Job? = null

    init { load() }

    fun load() = viewModelScope.launch {
        try {
            val p = api.projects()
            val f = runCatching { api.folders().value }.getOrDefault(_state.value.folders)
            _state.update { it.copy(projects = p.value, folders = f, loading = false, error = null, savedAt = p.savedAtMillis) }
            loadTallies(p.value.map { it.id })
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(res)) }
        }
    }

    /** Done/total and the next open due date per project, from ONE fetch, so the numbers agree. */
    private suspend fun loadTallies(ids: List<String>) {
        val tasks = runCatching { api.tasksOf(ids) }.getOrNull() ?: return
        val byProject = tasks.groupBy { it.projectId }
        val today = id.znetworks.nexus.core.time.OfficeTime.today()
        _state.update {
            it.copy(tallies = ids.associateWith { pid ->
                val ts = byProject[pid].orEmpty()
                Tally(
                    done = ts.count { t -> t.isDone },
                    total = ts.size,
                    nextDue = ts.filter { t -> !t.isDone }.mapNotNull { t -> dueDate(t.dueDate) }.filter { d -> !d.isBefore(today) }.minOrNull(),
                )
            })
        }
    }

    fun setQuery(q: String) {
        _state.update { it.copy(query = q) }
        searchJob?.cancel()
        if (q.trim().length < 2) { _state.update { it.copy(taskHits = emptyList(), searching = false) }; return }
        searchJob = viewModelScope.launch {
            delay(300) // debounce, as iOS
            _state.update { it.copy(searching = true) }
            val hits = runCatching { api.searchTasks(q.trim()) }.getOrDefault(emptyList())
            _state.update { it.copy(taskHits = hits.take(20), searching = false) }
        }
    }

    private suspend fun workspaceId(): String? =
        _state.value.projects.firstNotNullOfOrNull { it.workspaceId }
            ?: _state.value.folders.firstNotNullOfOrNull { it.workspaceId }
            ?: runCatching { c.attendanceApi.today().workspace?.id }.getOrNull()

    fun createProject(name: String, icon: String, color: String, folderId: String?, type: ProjectType = ProjectType.TASK, onDone: (String) -> Unit) = act {
        val ws = workspaceId() ?: throw IllegalStateException()
        val id = api.createProject(name, ws, color, icon, folderId, type)
        load()
        if (id.isNotBlank()) onDone(id)
    }

    fun saveFolder(editing: ProjectFolder?, name: String, icon: String, color: String, photo: ByteArray?, onDone: () -> Unit) = act {
        val id = if (editing == null) api.createFolder(workspaceId() ?: throw IllegalStateException(), name, icon, color, null)
        else { api.updateFolder(editing.id, name, icon, color); editing.id }
        // The folder is saved by now: a refused picture keeps it and says why, not a silent close.
        if (photo != null && id != null) {
            try { api.uploadFolderIcon(id, photo) } catch (e: ApiError) { load(); onDone(); throw e }
        }
        load(); onDone()
    }

    fun deleteFolder(f: ProjectFolder) = act { api.deleteFolder(f.id); load() }
    fun move(p: Project, folderId: String?) = act { api.moveProject(p.id, folderId); load() }
    fun dismissMessage() = _state.update { it.copy(message = null) }

    private fun act(block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true, message = null) }
        try {
            block()
        } catch (e: ApiError) {
            _state.update { it.copy(message = e.describe(res)) }
        } catch (e: IllegalStateException) {
            _state.update { it.copy(message = res.getString(R.string.error_cant_reach)) }
        }
        _state.update { it.copy(busy = false) }
    }
}

fun dueDate(iso: String?): LocalDate? = iso?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

fun parseColor(hex: String?, fallback: Color): Color = runCatching {
    val h = hex!!.trim().removePrefix("#").let { if (it.length == 3) it.map { ch -> "$ch$ch" }.joinToString("") else it }
    Color(("FF$h").toLong(16))
}.getOrDefault(fallback)

val PROJECT_COLORS = listOf("#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#7B2FBE")
val PROJECT_ICONS = listOf("🚀", "📁", "⭐️", "⚡️", "🎯", "💼", "🎬", "📣")
val FOLDER_ICONS = listOf("📁", "🎬", "📣", "💼", "⭐️", "🎯", "🚀", "📦")

/** An emoji, or an uploaded icon at a `/api/files/…` path. */
@Composable
fun IconTile(icon: String?, fallback: String, size: Int = 44) {
    val c = Nx.colors
    Box(Modifier.size(size.dp).background(c.muted, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
        if (icon != null && icon.startsWith("/")) {
            RemoteImage(icon, Modifier.size(size.dp), maxPx = 200) { Text(fallback, fontSize = (size / 2).sp) }
        } else {
            // An emoji, or a name ("briefcase" → 💼; PROJECT-TYPES-TABS).
            Text(ProjectIcon.emoji(icon) ?: fallback, fontSize = (size / 2).sp)
        }
    }
}

/** "Mission Control" (iOS ProjectsView): search, folder tree, project cards, create. */
@Composable
fun ProjectsScreen(onOpenProject: (String) -> Unit, onOpenTask: (String) -> Unit, onOpenFolder: (String) -> Unit = {}, vm: ProjectsViewModel = viewModel()) {
    val shortcuts = (LocalContext.current.applicationContext as NexusApplication).container.shortcuts
    val shortcutLists by shortcuts.lists.collectAsStateWithLifecycle()
    val pinnedIds = shortcutLists.pinned.map { it.id }
    androidx.compose.runtime.LaunchedEffect(Unit) { shortcuts.refresh() }
    val s by vm.state.collectAsStateWithLifecycle()
    // Live (Berlin, 8 Oct): a project or folder changed anywhere in the workspace; polling only as a fallback.
    id.znetworks.nexus.core.realtime.LiveRefresh(Unit, liveMs = 120_000, fallbackMs = 30_000, matches = id.znetworks.nexus.core.realtime.RealtimeEvents::isProjectsOrFolders) { vm.load().join() }
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var folderEdit by remember { mutableStateOf<ProjectFolder?>(null) }
    var folderCreate by rememberSaveable { mutableStateOf(false) }
    val q = s.query.trim()
    val matched = if (q.isEmpty()) s.projects else s.projects.filter { it.name.contains(q, true) || it.description.orEmpty().contains(q, true) }

    PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.projects_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp,
                        color = c.foreground, modifier = Modifier.weight(1f))
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Add, stringResource(R.string.projects_new)) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.projects_new)) }, leadingIcon = { Icon(Icons.Filled.ViewKanban, null) },
                                onClick = { menu = false; creating = true })
                            DropdownMenuItem(text = { Text(stringResource(R.string.folder_new)) }, leadingIcon = { Icon(Icons.Filled.CreateNewFolder, null) },
                                onClick = { menu = false; folderCreate = true })
                        }
                    }
                }
            }
            item {
                OutlinedTextField(s.query, vm::setQuery, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                    placeholder = { Text(stringResource(R.string.projects_search)) }, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            }
            s.savedAt?.let { item { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg) } }
            when {
                s.loading && s.projects.isEmpty() -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                s.error != null && s.projects.isEmpty() -> item {
                    EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.projects_load_failed), s.error!!, stringResource(R.string.try_again), { vm.load() })
                }
                s.projects.isEmpty() -> item {
                    EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.projects_empty), stringResource(R.string.projects_empty_sub),
                        stringResource(R.string.projects_new), { creating = true })
                }
                q.isNotEmpty() -> {
                    if (matched.isEmpty() && s.taskHits.isEmpty() && !s.searching) item {
                        Text(stringResource(R.string.projects_nothing_matches), color = c.mutedFg, modifier = Modifier.padding(8.dp))
                    }
                    if (matched.isNotEmpty()) item { Section(stringResource(R.string.projects_section_missions)) }
                    items(matched, key = { "p-" + it.id }) { p -> ProjectCard(p, s.tallies?.get(p.id), s.tallies != null, { onOpenProject(p.id) }) }
                    if (s.searching) item { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                    if (s.taskHits.isNotEmpty()) item { Section(stringResource(R.string.projects_section_tasks)) }
                    items(s.taskHits, key = { "t-" + it.id }) { t -> TaskHitRow(t) { onOpenTask(t.id) } }
                }
                else -> {
                    // Pinned (Berlin 29 Sep, iOS 286cada): the person's pins, synced with the web and the other
                    // devices, in the server's order; only projects in this list.
                    val pinned = pinnedIds.mapNotNull { id -> s.projects.firstOrNull { it.id == id } }
                    if (pinned.isNotEmpty()) {
                        item { Section(stringResource(R.string.home_pinned)) }
                        items(pinned, key = { "pin-" + it.id }) { p -> MovableCard(p, s, onOpenProject, vm::move) }
                        item { Section(stringResource(R.string.projects_section_all)) }
                    }
                    val roots = s.folders.filter { it.parentFolderId == null || s.folders.none { f -> f.id == it.parentFolderId } }
                        .sortedWith(compareBy({ it.position ?: Int.MAX_VALUE }, { it.name.lowercase() }))
                    items(roots, key = { "f-" + it.id }) { f ->
                        FolderNode(f, s, depth = 0, onOpenProject, onEdit = { folderEdit = it }, onDelete = vm::deleteFolder, onMove = vm::move, onCalendar = onOpenFolder)
                    }
                    val loose = s.projects.filter { p -> p.folderId == null || s.folders.none { it.id == p.folderId } }
                    if (roots.isNotEmpty() && loose.isNotEmpty()) item { Section(stringResource(R.string.projects_section_missions)) }
                    items(loose, key = { "p-" + it.id }) { p -> MovableCard(p, s, onOpenProject, vm::move) }
                }
            }
        }
    }

    if (creating) CreateProjectDialog(s.folders, busy = s.busy, onDismiss = { creating = false }) { name, icon, color, folder, type ->
        vm.createProject(name, icon, color, folder, type) { id -> creating = false; onOpenProject(id) }
    }
    if (folderCreate || folderEdit != null) FolderDialog(folderEdit, busy = s.busy, onDismiss = { folderCreate = false; folderEdit = null }) { name, icon, color, photo ->
        vm.saveFolder(folderEdit, name, icon, color, photo) { folderCreate = false; folderEdit = null }
    }
    s.message?.let { AlertDialog(onDismissRequest = vm::dismissMessage, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismissMessage) { Text("OK") } }) }
}

@Composable
private fun Section(text: String) = Text(text.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
    color = Nx.colors.mutedFg, letterSpacing = 1.sp, modifier = Modifier.padding(top = 4.dp))

@Composable
private fun FolderNode(
    f: ProjectFolder, s: ProjectsState, depth: Int, onOpen: (String) -> Unit,
    onEdit: (ProjectFolder) -> Unit, onDelete: (ProjectFolder) -> Unit, onMove: (Project, String?) -> Unit,
    onCalendar: (String) -> Unit = {},
) {
    val c = Nx.colors
    var open by rememberSaveable(f.id) { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val children = s.folders.filter { it.parentFolderId == f.id }.sortedWith(compareBy({ it.position ?: Int.MAX_VALUE }, { it.name.lowercase() }))
    val projects = s.projects.filter { it.folderId == f.id }
    Column(Modifier.padding(start = (depth * 12).dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
                    .clickable { open = !open }.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (open) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                Spacer(Modifier.size(6.dp))
                IconTile(f.icon, "📁", size = 30)
                Spacer(Modifier.size(10.dp))
                Text(f.name, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                Text("${projects.size}", fontSize = 12.sp, color = c.mutedFg)
                // Every task due across this folder's projects (iOS FolderAggregateView).
                IconButton(onClick = { onCalendar(f.id) }) { Icon(Icons.Filled.CalendarMonth, stringResource(R.string.fc_open), tint = c.violetText) }
                IconButton(onClick = { menu = true }) { Text("⋯", color = c.mutedFg, fontSize = 18.sp) }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.folder_edit)) }, onClick = { menu = false; onEdit(f) })
                DropdownMenuItem(text = { Text(stringResource(R.string.folder_delete), color = c.danger) }, onClick = { menu = false; confirmDelete = true })
            }
        }
        if (open) {
            children.forEach { FolderNode(it, s, depth + 1, onOpen, onEdit, onDelete, onMove, onCalendar) }
            projects.forEach { MovableCard(it, s, onOpen, onMove) }
            if (children.isEmpty() && projects.isEmpty()) Text(stringResource(R.string.folder_empty), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(start = 8.dp))
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.folder_delete_q, f.name)) },
        text = { Text(stringResource(R.string.folder_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete(f) }) { Text(stringResource(R.string.delete), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
}

/** A project card with a long-press "Move to folder" menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MovableCard(p: Project, s: ProjectsState, onOpen: (String) -> Unit, onMove: (Project, String?) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        ProjectCard(p, s.tallies?.get(p.id), s.tallies != null, onClick = { onOpen(p.id) }, onLongClick = { menu = true })
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            val shortcuts = (LocalContext.current.applicationContext as NexusApplication).container.shortcuts
            val lists by shortcuts.lists.collectAsStateWithLifecycle()
            val pinned = lists.pinned.any { it.id == p.id }
            DropdownMenuItem(text = { Text(stringResource(if (pinned) R.string.home_unpin else R.string.home_pin)) },
                leadingIcon = { Icon(if (pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, null) },
                onClick = { menu = false; shortcuts.refresh(); shortcuts.togglePin(ShortcutRef(p.id, p.name, p.icon, p.color)) })
            HorizontalDivider()
            Text(stringResource(R.string.folder_move_to), fontSize = 12.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            if (p.folderId != null) DropdownMenuItem(text = { Text(stringResource(R.string.folder_none)) }, onClick = { menu = false; onMove(p, null) })
            s.folders.filter { it.id != p.folderId }.forEach { f ->
                DropdownMenuItem(text = { Text("${ProjectIcon.emoji(f.icon) ?: "📁"} ${f.name}") }, onClick = { menu = false; onMove(p, f.id) })
            }
        }
    }
}

/** Port of the iOS/web ProjectCard: icon, brief, status, Cards/Done/Lanes, progress, members, next due. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ProjectCard(p: Project, tally: Tally?, talliesLoaded: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null) {
    val c = Nx.colors
    val accent = parseColor(p.color, c.violet)
    val total = tally?.total ?: p.taskCount
    val done = tally?.done
    val progress = if (tally != null && tally.total > 0) (tally.done.toFloat() / tally.total).coerceIn(0f, 1f) else 0f
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(28.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        Box(Modifier.align(Alignment.TopEnd).offset(36.dp, (-36).dp).size(110.dp).background(accent.copy(alpha = 0.10f), CircleShape))
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                IconTile(p.icon, "📁")
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(p.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.project_no_brief), fontSize = 12.sp, color = c.mutedFg, maxLines = 2)
                }
                StatusChip(p.status)
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Metric(stringResource(R.string.project_cards), "$total", Modifier.weight(1f))
                Metric(stringResource(R.string.project_done), done?.toString() ?: "—", Modifier.weight(1f))
                Metric(stringResource(R.string.project_lanes), "${p.laneCount}", Modifier.weight(1f))
            }
            Spacer(Modifier.height(16.dp))
            Row {
                Text(if (done == null) stringResource(if (talliesLoaded) R.string.project_no_progress else R.string.project_calculating)
                else stringResource(R.string.project_energy, (progress * 100).toInt()), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                if (done != null) Text(stringResource(R.string.project_left, maxOf(0, total - done)), fontSize = 11.sp, color = c.mutedFg)
            }
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(progress = { progress }, color = c.success, trackColor = c.muted,
                modifier = Modifier.fillMaxWidth().height(7.dp).clip(CircleShape))
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (p.memberCount > 0) AvatarStack(p.members.map { it.user?.name to it.user?.avatar }, size = 24.dp, max = 4)
                else Text(stringResource(R.string.project_solo), fontSize = 11.sp, color = c.mutedFg)
                Spacer(Modifier.weight(1f))
                Icon(Icons.Filled.Schedule, null, tint = c.mutedFg, modifier = Modifier.size(12.dp))
                Spacer(Modifier.size(4.dp))
                Text(tally?.nextDue?.let { stringResource(R.string.project_next_due, DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()).format(it)) }
                    ?: stringResource(R.string.project_no_deadline), fontSize = 11.sp, color = c.mutedFg)
            }
        }
    }
}

@Composable
fun StatusChip(status: String?) {
    val c = Nx.colors
    val (label, tone) = when (status.orEmpty().uppercase()) {
        "AT_RISK" -> R.string.pstatus_at_risk to c.warning
        "OFF_TRACK" -> R.string.pstatus_off_track to c.danger
        "COMPLETED", "DONE" -> R.string.pstatus_completed to c.success
        "ARCHIVED" -> R.string.pstatus_archived to c.mutedFg
        "ON_HOLD", "PAUSED" -> R.string.pstatus_on_hold to c.mutedFg
        else -> R.string.pstatus_active to c.accentFg
    }
    Text(stringResource(label), color = tone, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(tone.copy(alpha = 0.15f), CircleShape).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
private fun Metric(label: String, value: String, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        Text(label, fontSize = 10.sp, color = c.mutedFg)
    }
}

@Composable
private fun TaskHitRow(t: BoardTask, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(t.title, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(t.taskList?.project?.name, t.taskList?.name).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
        }
        TaskStatusChip(t.status)
    }
}

@Composable
private fun CreateProjectDialog(folders: List<ProjectFolder>, busy: Boolean, onDismiss: () -> Unit, onCreate: (String, String, String, String?, ProjectType) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var icon by rememberSaveable { mutableStateOf(PROJECT_ICONS.first()) }
    var color by rememberSaveable { mutableStateOf("#7B2FBE") }
    var folder by rememberSaveable { mutableStateOf<String?>(null) }
    // First: what the project is for (9 Oct). Only Task Project is built; the rest say "Coming soon".
    var type by rememberSaveable { mutableStateOf<ProjectType?>(null) }
    val c = Nx.colors
    if (type == null) {
        AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.pt_question)) },
            text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) { ProjectType.entries.forEach { t -> TypeCard(t) { type = t } } } },
            confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
        return
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.projects_new)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(type!!.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                    TextButton(onClick = { type = null }, enabled = !busy) { Text(stringResource(R.string.pt_change)) }
                }
                OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.project_name)) }, modifier = Modifier.fillMaxWidth())
                EmojiRow(PROJECT_ICONS, icon) { icon = it }
                ColorRow(color) { color = it }
                if (folders.isNotEmpty()) {
                    var open by remember { mutableStateOf(false) }
                    Box {
                        TextButton(onClick = { open = true }) { Text(folders.firstOrNull { it.id == folder }?.name ?: stringResource(R.string.folder_none)) }
                        DropdownMenu(open, { open = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.folder_none)) }, onClick = { folder = null; open = false })
                            folders.forEach { f -> DropdownMenuItem(text = { Text(f.name) }, onClick = { folder = f.id; open = false }) }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(name, icon, color, folder, type ?: ProjectType.TASK) }, enabled = name.isNotBlank() && !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.project_launch))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun FolderDialog(editing: ProjectFolder?, busy: Boolean, onDismiss: () -> Unit, onSave: (String, String, String, ByteArray?) -> Unit) {
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    var unreadable by remember { mutableStateOf(false) }
    val pick = id.znetworks.nexus.feature.auth.rememberAvatarPicker { jpeg -> unreadable = jpeg == null; if (jpeg != null) photo = jpeg }
    var name by rememberSaveable(editing?.id) { mutableStateOf(editing?.name.orEmpty()) }
    var icon by rememberSaveable(editing?.id) { mutableStateOf(editing?.icon?.takeIf { !it.startsWith("/") } ?: FOLDER_ICONS.first()) }
    var color by rememberSaveable(editing?.id) { mutableStateOf(editing?.color ?: PROJECT_COLORS.first()) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(if (editing == null) R.string.folder_new else R.string.folder_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.folder_name)) }, modifier = Modifier.fillMaxWidth())
                EmojiRow(FOLDER_ICONS, if (photo == null) icon else "") { icon = it; photo = null }
                TextButton(onClick = pick) { Text(stringResource(if (photo != null) R.string.folder_photo_chosen else R.string.folder_photo)) }
                if (unreadable) Text(stringResource(R.string.chat_photo_unreadable), fontSize = 12.sp, color = Nx.colors.danger)
                ColorRow(color) { color = it }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(name, icon, color, photo) }, enabled = name.isNotBlank() && !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                else Text(stringResource(if (editing == null) R.string.folder_create else R.string.save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
internal fun EmojiRow(options: List<String>, selected: String, onPick: (String) -> Unit) {
    val c = Nx.colors
    // The stored value may be a name ("briefcase") or an emoji not offered here: it shows as its emoji, first,
    // and tapping what is already chosen changes nothing (the stored value goes back as it was).
    fun norm(e: String?) = e?.replace("\uFE0F", "")
    val current = ProjectIcon.emoji(selected)
    val all = if (current != null && options.none { norm(it) == norm(current) }) listOf(current) + options else options
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        all.forEach { e ->
            val on = norm(e) == norm(current)
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(if (on) c.accentBg else c.muted)
                .border(if (on) 2.dp else 0.dp, if (on) c.violet else Color.Transparent, RoundedCornerShape(10.dp))
                .clickable { if (!on) onPick(e) }, contentAlignment = Alignment.Center) { Text(e, fontSize = 18.sp) }
        }
    }
}

@Composable
internal fun ColorRow(selected: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PROJECT_COLORS.forEach { hex ->
            val col = parseColor(hex, Color.Gray)
            Box(Modifier.size(28.dp).clip(CircleShape).background(col)
                .border(if (hex.equals(selected, true)) 3.dp else 0.dp, Nx.colors.foreground, CircleShape).clickable { onPick(hex) })
        }
    }
}

/** One project type: Task Project opens the form; the others are muted, dashed and "Coming soon". */
@Composable
private fun TypeCard(t: ProjectType, onPick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(14.dp)
    val frame = if (t.ready) Modifier.border(1.dp, c.border, shape)
        else Modifier.drawBehind {
            drawRoundRect(c.border, cornerRadius = androidx.compose.ui.geometry.CornerRadius(14.dp.toPx()),
                style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
        }
    Row(Modifier.fillMaxWidth().clip(shape).background(if (t.ready) c.card else c.muted.copy(alpha = 0.4f)).then(frame)
        .clickable(enabled = t.ready, onClick = onPick).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(when (t) { ProjectType.TASK -> "✅"; ProjectType.FINANCE -> "💰"; ProjectType.CONTENT -> "🗓️"; ProjectType.PIPELINE -> "🤝" },
            fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (t.ready) c.foreground else c.mutedFg)
                if (!t.ready) Text(stringResource(R.string.pt_soon), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg,
                    modifier = Modifier.padding(start = 6.dp).background(c.muted, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
            Text(stringResource(t.description), fontSize = 12.sp, color = c.mutedFg)
        }
    }
}

