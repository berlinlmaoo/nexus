package id.znetworks.nexus.feature.projects

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.tasks.FieldValues
import id.znetworks.nexus.feature.tasks.NewTaskFields
import kotlinx.serialization.json.JsonElement
import androidx.compose.ui.platform.LocalContext
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The web's project tabs, same order. [searches]: the tab draws tasks, so the search box filters it. */
enum class ProjectTab(val label: Int, val searches: Boolean = false) {
    OVERVIEW(R.string.ptab_overview), BOARD(R.string.ptab_board, true), LIST(R.string.ptab_list, true),
    SHEET(R.string.ptab_sheet, true), CALENDAR(R.string.ptab_calendar, true), TIMELINE(R.string.ptab_timeline, true),
    SPRINTS(R.string.ptab_sprints), AUTOMATIONS(R.string.ptab_automations), PAGES(R.string.ptab_pages), FORMS(R.string.ptab_forms),
    CHAT(R.string.ptab_chat), FINANCE(R.string.ptab_finance), PNL(R.string.ptab_pnl),
}

data class ProjectDetailState(
    val detail: ProjectDetail? = null,
    val lanes: List<Lane> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val locked: Boolean = false,
    val savedAt: Long? = null,
    val query: String = "",
    val busy: Boolean = false,
    val actionError: String? = null,
    val isBoD: Boolean = false,
) {
    /**
     * The project's tabs (9 Oct, PROJECT-TYPES-TABS): its hidden ones out, Finance only when opted in
     * (older server: the name says finance), P&L only with its flag AND a BoD-tier viewer.
     */
    val tabs: List<ProjectTab> get() = ProjectTabsLogic.visible(ProjectTabsLogic.hidden(detail?.hiddenTabs),
        ProjectTabsLogic.financeOn(detail?.financeEnabled, detail?.name), detail?.enablePnlDashboard == true, isBoD)
}

class ProjectDetailViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(ProjectDetailState())
    val state = _state.asStateFlow()

    init {
        load()
        viewModelScope.launch { c.viewer.load(); _state.update { it.copy(isBoD = c.viewer.isBoD) } }
    }

    fun load() = viewModelScope.launch {
        try {
            val d = api.project(projectId)
            val all = runCatching { api.projectTasks(projectId).value }.getOrDefault(emptyList())
            val lanes = BoardLogic.mergeSubtasks(d.value.taskLists.sortedBy { it.position ?: Int.MAX_VALUE }, all)
            _state.update { it.copy(detail = d.value, lanes = lanes, loading = false, error = null, locked = false, savedAt = d.savedAtMillis) }
            c.shortcuts.visited(id.znetworks.nexus.feature.home.ShortcutRef(d.value.id, d.value.name, d.value.icon, d.value.color))
        } catch (e: ApiError) {
            // 403: an existing project this person is not in.
            val locked = e is ApiError.Http && e.status == 403
            _state.update { it.copy(loading = false, locked = locked, error = if (locked) null else e.describe(res)) }
        }
    }

    fun setQuery(q: String) = _state.update { it.copy(query = q) }
    fun dismissError() = _state.update { it.copy(actionError = null) }

    fun move(taskId: String, laneId: String) {
        _state.update { it.copy(lanes = BoardLogic.move(it.lanes, taskId, laneId)) }
        act(R.string.board_move_failed) { api.updateTask(taskId, buildJsonObject { put("taskListId", JsonPrimitive(laneId)) }) }
    }

    fun toggleDone(t: BoardTask) = act(R.string.board_update_failed) {
        api.updateTask(t.id, buildJsonObject { put("status", JsonPrimitive(if (t.isDone) "TODO" else "DONE")) })
    }

    fun create(laneId: String, title: String, priority: String? = null, due: LocalDate? = null, fields: Map<String, JsonElement> = emptyMap(), onDone: (String) -> Unit = {}) =
        act(R.string.board_create_failed) {
            val id = api.createTask(projectId, laneId, title, priority, due?.toString())
            // Values go on after the task exists (web composer); a refused one is said, the task stays.
            val failed = fields.filter { (_, v) -> FieldValues.filled(v) }.count { (fid, v) -> id.isNotBlank() && runCatching { api.setFieldValue(fid, id, v) }.isFailure }
            if (failed > 0) _state.update { it.copy(actionError = res.getString(R.string.task_fields_not_saved, failed)) }
            onDone(id)
        }

    private fun act(fallback: Int, block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            block()
        } catch (e: ApiError) {
            // PROOF_REQUIRED and the like carry their own sentence.
            _state.update { it.copy(actionError = (e as? ApiError.Http)?.serverMessage ?: res.getString(fallback)) }
        }
        _state.update { it.copy(busy = false) }
        load()
    }
}

@Composable
fun ProjectDetailScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenSettings: () -> Unit = {}, onOpenChat: (String) -> Unit = {}, onOpenForm: (String) -> Unit = {}, onOpenDoc: (String) -> Unit = {}, vm: ProjectDetailViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    // Back from settings or a task: what changed there shows here.
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (entered) vm.load() else entered = true }
    // Its tasks change on another device: the project room while this board is open (Berlin, 8 Oct).
    id.znetworks.nexus.core.realtime.RealtimeRoom("project:${vm.projectId}")
    id.znetworks.nexus.core.realtime.LiveRefresh(vm.projectId, liveMs = 120_000, fallbackMs = 30_000, matches = { id.znetworks.nexus.core.realtime.RealtimeEvents.touchesProject(it, vm.projectId) }) { vm.load().join() }
    var tab by rememberSaveable { mutableStateOf(ProjectTab.BOARD) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var createDue by remember { mutableStateOf<LocalDate?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val lanes = BoardLogic.filter(s.lanes, s.query)
    val total = s.lanes.sumOf { it.tasks.size }
    val shown = lanes.sumOf { it.tasks.size }

    Box(Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                s.detail?.let { IconTile(it.icon, "📁", size = 34) }
                Spacer(Modifier.size(10.dp))
                Text(s.detail?.name ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                s.detail?.let { StatusChip(it.status) }
                if (s.detail != null) IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, stringResource(R.string.ps_title)) }
            }
            val tabs = s.tabs
            // The open tab hidden (here or on another device): Board, else List, else the first.
            LaunchedEffect(tabs) { if (s.detail != null) tab = ProjectTabsLogic.fallback(tab, tabs) }
            ScrollableTabRow(selectedTabIndex = tabs.indexOf(tab).coerceAtLeast(0), edgePadding = 12.dp, containerColor = c.background) {
                tabs.forEach { t -> Tab(selected = tab == t, onClick = { tab = t }, text = { Text(stringResource(t.label)) }) }
            }
            if (tab.searches && !s.locked && s.detail != null) {
                OutlinedTextField(
                    s.query, vm::setQuery, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                    trailingIcon = {
                        if (s.query.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                            // "0/84" is an answer, not a failure: an empty board otherwise reads as one that failed.
                            Text("$shown/$total", fontSize = 11.sp, color = c.mutedFg)
                            IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Filled.Close, stringResource(R.string.clear_search)) }
                        }
                    },
                    placeholder = { Text(stringResource(R.string.board_search)) }, shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
            s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
            Box(Modifier.weight(1f)) {
                when {
                    s.loading && s.detail == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    s.locked -> EmptyState(Icons.Filled.Lock, stringResource(R.string.project_locked), stringResource(R.string.project_locked_sub),
                        stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                    s.error != null && s.detail == null -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.project_load_failed), s.error!!,
                        stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                    s.detail != null -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                        val web = { id.znetworks.nexus.ui.shell.openWeb(context, "/projects/${vm.projectId}") }
                        when (tab) {
                            ProjectTab.OVERVIEW -> Overview(s.detail!!, s.lanes)
                            ProjectTab.BOARD -> Board(lanes, s.lanes, onOpenTask, vm)
                            ProjectTab.LIST -> ListTab(lanes, onOpenTask, vm)
                            ProjectTab.SHEET -> SheetTab(vm.projectId, lanes, onOpenTask)
                            ProjectTab.CALENDAR -> CalendarTab(lanes.flatMap { it.tasks }, onOpenTask) { d -> createDue = d; creating = true }
                            ProjectTab.TIMELINE -> TimelineTab(lanes, onOpenTask)
                            ProjectTab.SPRINTS -> SprintsTab(vm.projectId, onOpenTask)
                            ProjectTab.AUTOMATIONS -> AutomationsTab(vm.projectId)
                            ProjectTab.FINANCE -> FinanceTab(vm.projectId)
                            ProjectTab.PNL -> PnlTab(vm.projectId)
                            ProjectTab.PAGES -> id.znetworks.nexus.feature.docs.ProjectPagesTab(vm.projectId, onOpenDoc)
                            ProjectTab.FORMS -> id.znetworks.nexus.feature.forms.ProjectFormsTab(vm.projectId, onOpenForm)
                            ProjectTab.CHAT -> id.znetworks.nexus.feature.chat.ProjectChatTab(vm.projectId) { onOpenChat(it); tab = ProjectTab.BOARD }
                        }
                    }
                }
            }
        }
        if (s.detail != null && s.lanes.isNotEmpty() && tab.searches) {
            FloatingActionButton(onClick = { createDue = null; creating = true }, containerColor = c.violet, contentColor = Color.White,
                modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)) { Icon(Icons.Filled.Add, stringResource(R.string.task_new)) }
        }
    }
    if (creating) CreateTaskDialog(s.lanes, busy = s.busy, initialDue = createDue, projectId = vm.projectId, onDismiss = { creating = false }) { lane, title, prio, due, fields ->
        vm.create(lane, title, prio, due, fields) { id -> creating = false; if (id.isNotBlank()) onOpenTask(id) }
    }
    s.actionError?.let { AlertDialog(onDismissRequest = vm::dismissError, title = { Text(stringResource(R.string.board_update_failed)) },
        text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } }) }
}

@Composable
private fun Board(lanes: List<Lane>, allLanes: List<Lane>, onOpenTask: (String) -> Unit, vm: ProjectDetailViewModel) {
    val c = Nx.colors
    val context = androidx.compose.ui.platform.LocalContext.current
    if (allLanes.isEmpty()) {
        // Lanes are set up on the web board (as on iOS); a task needs a lane to live in.
        EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.board_no_lanes), stringResource(R.string.board_no_lanes_sub),
            stringResource(R.string.open_on_web), { id.znetworks.nexus.ui.shell.openWeb(context, "/projects/${vm.projectId}") }, Modifier.fillMaxSize())
        return
    }
    LazyRow(contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
        items(lanes, key = { it.id }) { lane ->
            Column(Modifier.width(290.dp).fillMaxHeight().clip(RoundedCornerShape(20.dp)).background(c.muted.copy(alpha = 0.5f)).padding(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(lane.name, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                    Text("${lane.tasks.size}", fontSize = 12.sp, color = c.mutedFg)
                }
                Spacer(Modifier.height(8.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f, fill = false)) {
                    if (lane.tasks.isEmpty()) item { Text(stringResource(R.string.board_empty_lane), fontSize = 12.sp, color = c.mutedFg.copy(alpha = 0.6f), modifier = Modifier.padding(8.dp)) }
                    items(lane.tasks, key = { it.id }) { t -> MovableTask(t, allLanes, onOpenTask, vm) }
                }
                InlineAdd(onAdd = { vm.create(lane.id, it) })
            }
        }
    }
}

/** A card whose long-press offers "Move to" another lane (drag on iOS; a menu works everywhere). */
@Composable
private fun MovableTask(t: BoardTask, lanes: List<Lane>, onOpenTask: (String) -> Unit, vm: ProjectDetailViewModel) {
    var menu by remember { mutableStateOf(false) }
    Box {
        TaskCard(t, onClick = { onOpenTask(t.id) }, onToggleDone = { vm.toggleDone(t) }, onLongClick = { menu = true })
        DropdownMenu(menu, { menu = false }) {
            Text(stringResource(R.string.board_move_to), fontSize = 12.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            lanes.filter { it.id != t.taskListId }.forEach { l ->
                DropdownMenuItem(text = { Text(l.name) }, onClick = { menu = false; vm.move(t.id, l.id) })
            }
        }
    }
}

@Composable
private fun InlineAdd(onAdd: (String) -> Unit) {
    val c = Nx.colors
    var composing by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    if (!composing) {
        TextButton(onClick = { composing = true }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.size(4.dp)); Text(stringResource(R.string.board_add_task))
        }
    } else {
        Column(Modifier.fillMaxWidth().padding(top = 6.dp).background(c.card, RoundedCornerShape(12.dp)).padding(8.dp)) {
            OutlinedTextField(title, { title = it }, placeholder = { Text(stringResource(R.string.board_task_title)) }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { composing = false; title = "" }) { Text(stringResource(R.string.cancel)) }
                TextButton(onClick = { onAdd(title); composing = false; title = "" }, enabled = title.isNotBlank()) { Text(stringResource(R.string.add)) }
            }
        }
    }
}

@Composable
private fun ListTab(lanes: List<Lane>, onOpenTask: (String) -> Unit, vm: ProjectDetailViewModel) {
    val c = Nx.colors
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxSize()) {
        lanes.forEach { lane ->
            item(key = "h-" + lane.id) {
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(lane.name.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, letterSpacing = 1.sp, modifier = Modifier.weight(1f))
                    Text("${lane.tasks.size}", fontSize = 11.sp, color = c.mutedFg)
                }
            }
            if (lane.tasks.isEmpty()) item(key = "e-" + lane.id) { Text(stringResource(R.string.board_empty_lane), fontSize = 12.sp, color = c.mutedFg) }
            items(lane.tasks, key = { it.id }) { t -> TaskCard(t, onClick = { onOpenTask(t.id) }, onToggleDone = { vm.toggleDone(t) }) }
        }
    }
}

@Composable
private fun Overview(d: ProjectDetail, lanes: List<Lane>) {
    val c = Nx.colors
    val all = lanes.flatMap { it.tasks }
    val done = all.count { it.isDone }
    val overdue = all.count { !it.isDone && (dueDate(it.dueDate)?.isBefore(id.znetworks.nexus.core.time.OfficeTime.today()) == true) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(d.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.project_no_brief), color = c.foreground)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OverviewStat(stringResource(R.string.project_cards), "${all.size}", Modifier.weight(1f))
            OverviewStat(stringResource(R.string.project_done), "$done", Modifier.weight(1f))
            OverviewStat(stringResource(R.string.overview_overdue), "$overdue", Modifier.weight(1f), if (overdue > 0) c.danger else null)
        }
        LinearProgressIndicator(progress = { if (all.isEmpty()) 0f else done.toFloat() / all.size }, color = c.success, trackColor = c.muted,
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)))
        Text(stringResource(R.string.overview_by_lane).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, letterSpacing = 1.sp)
        lanes.forEach { l ->
            Row { Text(l.name, color = c.foreground, modifier = Modifier.weight(1f)); Text("${l.tasks.count { it.isDone }}/${l.tasks.size}", color = c.mutedFg) }
        }
        Text(stringResource(R.string.overview_members, d.members.size).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, letterSpacing = 1.sp)
        d.members.forEach { m ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(m.user?.name, m.user?.avatar, 32.dp)
                Spacer(Modifier.size(10.dp))
                Text(m.user?.name ?: "?", color = c.foreground, modifier = Modifier.weight(1f))
                m.role?.let { Pill(it.lowercase().replaceFirstChar(Char::titlecase), c.mutedFg) }
            }
        }
    }
}

@Composable
private fun OverviewStat(label: String, value: String, modifier: Modifier, tone: Color? = null) {
    val c = Nx.colors
    Column(modifier.background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = tone ?: c.foreground)
        Text(label, fontSize = 11.sp, color = c.mutedFg)
    }
}

/** New task: title, lane, priority (none → urgent), deadline. Custom fields come in a later step. */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun CreateTaskDialog(lanes: List<Lane>, busy: Boolean, initialDue: LocalDate? = null, projectId: String? = null, onDismiss: () -> Unit, onCreate: (String, String, String?, LocalDate?, Map<String, JsonElement>) -> Unit) {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    var fields by remember { mutableStateOf<List<CustomFieldDef>>(emptyList()) }
    var values by remember { mutableStateOf<Map<String, JsonElement>>(emptyMap()) }
    LaunchedEffect(projectId) { if (projectId != null) fields = runCatching { ProjectsApi(container.api).customFields(projectId) }.getOrDefault(emptyList()) }
    var title by rememberSaveable { mutableStateOf("") }
    var lane by rememberSaveable { mutableStateOf(lanes.firstOrNull()?.id) }
    var prio by rememberSaveable { mutableStateOf("NONE") }
    var due by remember { mutableStateOf(initialDue) }
    var picking by remember { mutableStateOf(false) }
    var laneMenu by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.task_new)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.board_task_title)) }, modifier = Modifier.fillMaxWidth())
                Box {
                    OutlinedButton(onClick = { laneMenu = true }) { Text(lanes.firstOrNull { it.id == lane }?.name ?: "—") }
                    DropdownMenu(laneMenu, { laneMenu = false }) { lanes.forEach { l -> DropdownMenuItem(text = { Text(l.name) }, onClick = { lane = l.id; laneMenu = false }) } }
                }
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TaskEnums.PRIORITIES.reversed().forEach { p -> FilterChip(prio == p, { prio = p }, { Text(priorityLabel(p), fontSize = 12.sp) }) }
                }
                OutlinedButton(onClick = { picking = true }) {
                    Text(due?.let { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(it) } ?: stringResource(R.string.task_add_deadline))
                }
                NewTaskFields(fields, values) { id, v -> values = values + (id to v) }
            }
        },
        confirmButton = {
            TextButton(onClick = { lane?.let { onCreate(it, title, prio, due, values) } }, enabled = title.isNotBlank() && lane != null && !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.add))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
    if (picking) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (due ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton(onClick = { st.selectedDateMillis?.let { due = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }; picking = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { due = null; picking = false }) { Text(stringResource(R.string.task_no_deadline)) } },
        ) { DatePicker(st) }
    }
}
