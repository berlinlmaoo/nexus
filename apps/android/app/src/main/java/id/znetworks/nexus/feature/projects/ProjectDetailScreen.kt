package id.znetworks.nexus.feature.projects

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
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
import androidx.compose.material.icons.filled.FilterList
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
import androidx.compose.ui.draw.drawBehind
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
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.components.sentence
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
    /** A Pipeline Dashboard's deals (type PIPELINE, 9 Oct): first and where it opens; never on a task project. */
    PIPELINE(R.string.pl_tab),
    /** An Outlet Sales Dashboard (type OUTLET_SALES, OUTLET-SALES §1): these four, then Chat; never on a task project. */
    OUTLET_OVERVIEW(R.string.os_tab_overview), OUTLET_CALENDAR(R.string.ptab_calendar), OUTLET_BOARD(R.string.ptab_board), OUTLET_FORM(R.string.os_tab_form),
    OVERVIEW(R.string.ptab_overview), BOARD(R.string.ptab_board, true), LIST(R.string.ptab_list, true),
    /** The task grid (key "table"); [SHEET] is the project Spreadsheet (key "sheet", 13 Oct). */
    TABLE(R.string.ptab_table, true), SHEET(R.string.ptab_spreadsheet), CALENDAR(R.string.ptab_calendar, true), TIMELINE(R.string.ptab_timeline, true),
    AUTOMATIONS(R.string.ptab_automations), PAGES(R.string.ptab_pages), FORMS(R.string.ptab_forms),
    CHAT(R.string.ptab_chat),
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
    /** Multi-select on Board / List (PROJECT-CUSTOMIZE-CLEANUP §1): non-empty = selecting. */
    val selected: Set<String> = emptySet(),
    /** "3 tasks duplicated", shown once as a toast. */
    val notice: String? = null,
    /** A tap on the Overview (SPRINTS-OVERVIEW §3): Board / List show only these open tasks until cleared. */
    val drill: OverviewDrill? = null,
    /** The template it was built from (DEV-REDESIGN §1): its opening tab, Calendar field and "My …" chip. */
    val template: ProjectTemplate? = null,
    /** The project's Date custom fields, what the Calendar can plot besides the due date (null = not loaded). */
    val dateFields: List<CustomFieldDef>? = null,
    /** The Calendar's field: a Date field's id, null = the due date. Kept per project on this phone. */
    val plotBy: String? = null,
    /** The template's "My …" chip is on: Board / List / Calendar show only the person's own tasks. */
    val mine: Boolean = false,
    /** Saved views (13 Oct): every view is a tab; null = not read yet. */
    val views: List<ProjectView>? = null,
    val canEditShared: Boolean = false,
    /** The project's custom fields (Kategori, columns, groups); null = not read yet. */
    val fields: List<CustomFieldDef>? = null,
    /** Filter / sort / group changes that live on this screen only (below Can edit, or not saved yet). */
    val screenConfigs: Map<String, ViewConfig> = emptyMap(),
    /** The last action that can be taken back, shown for 10 s. */
    val undo: UndoEntry? = null,
    /** 404: the project is gone or the link is wrong. */
    val notFound: Boolean = false,
) {
    val access: ProjectAccess get() = ProjectAccess.of(detail)
    /** A plain task project (not a Pipeline / Outlet board): the one with views. */
    val taskProject: Boolean get() = detail?.type != "PIPELINE" && detail?.type != "OUTLET_SALES"
    /** The view tabs: the project's own, else built-in fallbacks of its visible layouts. */
    val shownViews: List<ProjectView> get() {
        val hidden = ProjectTabsLogic.hidden(detail?.hiddenTabs)
        val v = views
        return if (v.isNullOrEmpty()) ViewsLogic.fallbacks(hidden) else ViewsLogic.visible(v, hidden)
    }
    fun config(v: ProjectView): ViewConfig = screenConfigs[v.id] ?: ViewsLogic.config(v)

    /** The project's tabs (9 Oct, PROJECT-TYPES-TABS): its hidden ones out. No Finance / P&L (PROJECT-CUSTOMIZE-CLEANUP, 11 Oct). */
    val tabs: List<ProjectTab> get() = ProjectTabsLogic.visible(ProjectTabsLogic.hidden(detail?.hiddenTabs),
        isPipeline = detail?.type == "PIPELINE", isOutlet = detail?.type == "OUTLET_SALES")
}

class ProjectDetailViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    private companion object { const val DUE = "dueDate" }
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
            if (d.value.type.isNullOrEmpty() || d.value.type == "TASK") loadTemplateBits(d.value.templateId)
            loadViewsAndFields()
            c.shortcuts.visited(id.znetworks.nexus.feature.home.ShortcutRef(d.value.id, d.value.name, d.value.icon, d.value.color))
        } catch (e: ApiError) {
            // 403: an existing project this person is not in; 404: gone, or a wrong link.
            val locked = e is ApiError.Http && (e.status == 403 || e.status == 401)
            val gone = e is ApiError.Http && e.status == 404
            _state.update { it.copy(loading = false, locked = locked, notFound = gone, error = if (locked || gone) null else e.describe(res)) }
        }
    }

    /** Saved views and custom fields; a view list that can't be read falls back to the built-in layouts. */
    private suspend fun loadViewsAndFields() {
        val v = runCatching { api.views(projectId) }.getOrNull()
        val f = runCatching { api.customFields(projectId) }.getOrNull()
        _state.update { it.copy(views = v?.views ?: it.views ?: emptyList(), canEditShared = v?.canEditShared ?: it.canEditShared, fields = f ?: it.fields ?: emptyList()) }
    }

    // region Views

    private val viewPrefs get() = getApplication<Application>().getSharedPreferences("project_view", android.content.Context.MODE_PRIVATE)
    /** The last view opened here, per project on this phone. */
    fun savedViewId(): String? = viewPrefs.getString(projectId, null)
    fun rememberView(id: String) = viewPrefs.edit().putString(projectId, id).apply()

    fun createView(name: String?, layout: String, shared: Boolean, onDone: (String?) -> Unit) = viewModelScope.launch {
        try {
            val v = api.createView(projectId, name, layout, shared)
            loadViewsAndFields(); onDone(v?.id)
        } catch (e: ApiError) { _state.update { it.copy(actionError = e.sentence(res, R.string.view_save_failed)) } }
    }

    fun renameView(v: ProjectView, name: String) = viewAct { api.updateView(projectId, v.id, name = name) }
    fun deleteView(v: ProjectView) = viewAct { api.deleteView(projectId, v.id) }
    fun duplicateView(v: ProjectView, name: String, onDone: (String?) -> Unit) = viewModelScope.launch {
        try {
            val copy = api.createView(projectId, name, ViewsLogic.layoutOf(v), shared = v.shared && _state.value.canEditShared)
            if (copy != null && v.config != null) api.updateView(projectId, copy.id, config = v.config)
            loadViewsAndFields(); onDone(copy?.id)
        } catch (e: ApiError) { _state.update { it.copy(actionError = e.sentence(res, R.string.view_save_failed)) } }
    }
    /** A built-in view is hidden through the project's hidden tabs (Board or List stays on: the server says so). */
    fun hideBuiltin(key: String) = act(R.string.view_save_failed) {
        val next = ProjectTabsLogic.hidden(_state.value.detail?.hiddenTabs) + key
        api.updateProject(projectId, buildJsonObject { put("hiddenTabs", kotlinx.serialization.json.JsonArray(next.map { JsonPrimitive(it) })) })
    }

    /** Filter / sort / group: saved to the view when [save], else on this screen only. */
    fun applyConfig(v: ProjectView, cfg: ViewConfig, save: Boolean) {
        _state.update { it.copy(screenConfigs = it.screenConfigs + (v.id to cfg)) }
        if (!save) return
        viewModelScope.launch {
            try {
                api.updateView(projectId, v.id, patch = ViewsLogic.patchFor(cfg.rules, cfg.sort, cfg.groupBy, cfg.advanced))
                loadViewsAndFields()
                _state.update { it.copy(screenConfigs = it.screenConfigs - v.id) }
            } catch (e: ApiError) { _state.update { it.copy(actionError = e.sentence(res, R.string.view_save_failed)) } }
        }
    }

    private fun viewAct(block: suspend () -> Unit) = viewModelScope.launch {
        try { block(); loadViewsAndFields() } catch (e: ApiError) {
            _state.update { it.copy(actionError = e.sentence(res, R.string.view_save_failed)) }
        }
    }

    // endregion

    // region Bulk edits with Undo (web task-bulk.tsx + lib/task-undo.ts)

    private var undoSeq = 0L
    private fun offerUndo(label: String, run: suspend () -> Unit) = _state.update { it.copy(undo = UndoEntry(++undoSeq, label, run)) }
    fun dismissUndo(id: Long) = _state.update { if (it.undo?.id == id) it.copy(undo = null) else it }

    /** Runs the entry once: a second tap on the same Undo does nothing. */
    fun undo(entry: UndoEntry) {
        if (_state.value.undo?.id != entry.id) return
        _state.update { it.copy(undo = null) }
        viewModelScope.launch {
            try { entry.run() } catch (_: ApiError) { _state.update { it.copy(actionError = res.getString(R.string.undo_failed)) } }
            load()
        }
    }

    private fun tasksById(ids: Collection<String>) = _state.value.lanes.flatMap { it.tasks }.filter { it.id in ids }.distinctBy { it.id }

    private fun plural(id: Int, n: Int) = res.getQuantityString(id, n, n)

    fun moveTo(ids: List<String>, laneId: String) = bulk {
        val before = tasksById(ids)
        val r = api.batchMove(projectId, ids, taskListId = laneId)
        if (r.failed.isNotEmpty()) _state.update { it.copy(actionError = plural(R.plurals.bulk_update_failed, r.failed.size)) }
        val moved = before.filter { it.id in r.moved.ifEmpty { ids } }
        if (moved.isNotEmpty()) offerUndo(plural(R.plurals.undo_moved, moved.size)) {
            moved.groupBy { (it.taskListId ?: "") to it.status }.forEach { (k, ts) ->
                if (k.first.isNotEmpty()) api.batchMove(projectId, ts.map { it.id }, taskListId = k.first, status = k.second)
            }
        }
    }

    fun setPriority(ids: List<String>, priority: String) = bulk {
        val before = tasksById(ids)
        val r = api.batchMove(projectId, ids, priority = priority)
        if (r.failed.isNotEmpty()) _state.update { it.copy(actionError = plural(R.plurals.bulk_update_failed, r.failed.size)) }
        offerUndo(plural(R.plurals.undo_priority, before.size)) {
            before.groupBy { it.priority?.uppercase() ?: "NONE" }.forEach { (p, ts) -> api.batchMove(projectId, ts.map { it.id }, priority = p) }
        }
    }

    fun assign(ids: List<String>, userId: String) = bulk {
        val targets = tasksById(ids).filter { t -> t.assignees.none { (it.user?.id ?: it.userId) == userId } }
        var failed = 0
        val done = targets.filter { t -> runCatching { api.addAssignee(t.id, userId) }.onFailure { failed++ }.isSuccess }
        if (failed > 0) _state.update { it.copy(actionError = plural(R.plurals.bulk_update_failed, failed)) }
        if (done.isNotEmpty()) offerUndo(plural(R.plurals.undo_assigned, done.size)) { done.forEach { api.removeAssignee(it.id, userId) } }
    }

    fun setDue(ids: List<String>, due: LocalDate?) = bulk {
        val before = tasksById(ids)
        var failed = 0
        val done = before.filter { t ->
            runCatching { api.updateTask(t.id, buildJsonObject { put("dueDate", due?.let { JsonPrimitive(it.toString()) } ?: kotlinx.serialization.json.JsonNull) }) }
                .onFailure { failed++ }.isSuccess
        }
        if (failed > 0) _state.update { it.copy(actionError = plural(R.plurals.bulk_update_failed, failed)) }
        if (done.isNotEmpty()) offerUndo(plural(if (due == null) R.plurals.undo_due_cleared else R.plurals.undo_due_set, done.size)) {
            done.forEach { t -> api.updateTask(t.id, buildJsonObject { put("dueDate", t.dueDate?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) }) }
        }
    }

    /** Gone from the board at once; Undo brings them back through their audit entries (30 min, own deletes). */
    fun delete(ids: List<String>) = bulk {
        _state.update { st -> st.copy(lanes = st.lanes.map { l -> l.copy(tasks = l.tasks.filterNot { it.id in ids }) }) }
        val audit = mutableListOf<String>()
        var failed = 0
        ids.forEach { id -> try { api.deleteTaskForUndo(id)?.let(audit::add) } catch (_: ApiError) { failed++ } }
        if (failed > 0) _state.update { it.copy(actionError = plural(R.plurals.bulk_delete_failed, failed)) }
        val ok = ids.size - failed
        // An older server returns no audit entry: no Undo then.
        if (ok > 0 && audit.isNotEmpty()) offerUndo(plural(R.plurals.undo_deleted, ok)) {
            val r = api.undoDelete(audit)
            if (r.failed.isNotEmpty()) _state.update { it.copy(actionError = plural(R.plurals.bulk_restore_failed, r.failed.size)) }
        }
    }

    /** Status of one task from a table cell (its column = its status option). */
    fun setStatusOption(taskId: String, laneId: String) = moveTo(listOf(taskId), laneId)

    fun setTaskPriority(taskId: String, p: String) = setPriority(listOf(taskId), p)

    fun toggleAssignee(t: BoardTask, userId: String) = act(R.string.pp_change_failed) {
        if (t.assignees.any { (it.user?.id ?: it.userId) == userId }) api.removeAssignee(t.id, userId) else api.addAssignee(t.id, userId)
    }

    /** Keep only what is on screen: a filter, search or view change drops the hidden ones (web C-BUG-4). */
    fun prune(visible: Set<String>) = _state.update { if (it.selected.isEmpty() || visible.containsAll(it.selected)) it else it.copy(selected = it.selected intersect visible) }
    fun selectAll(ids: Collection<String>) = _state.update { it.copy(selected = ids.toSet()) }

    private fun bulk(block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try { block(); _state.update { it.copy(selected = emptySet()) } } catch (e: ApiError) {
            _state.update { it.copy(actionError = e.sentence(res, R.string.pp_change_failed)) }
        }
        _state.update { it.copy(busy = false) }
        load()
    }

    // endregion

    /** A task in a group that is not a section (a Kategori lane): made in the default section, then given the value. */
    fun createInGroup(fieldId: String, value: String, title: String) {
        val lane = StatusOptions.defaultOption(_state.value.lanes)?.id ?: return
        create(lane, title, fields = mapOf(fieldId to JsonPrimitive(value)))
    }

    /** Once per screen: the template (cached 5 min) and the Date fields; the Calendar's field from the saved choice or the template. */
    private suspend fun loadTemplateBits(templateId: String?) {
        if (_state.value.dateFields != null) return
        val template = templateId?.let { id -> runCatching { ProjectTemplatesCache.get(api) }.getOrNull()?.firstOrNull { it.id == id } }
        val dates = runCatching { api.customFields(projectId) }.getOrNull()?.filter { it.kind == "DATE" } ?: return
        val saved = plotPrefs.getString(projectId, null)
        val plot = when {
            saved == DUE -> null
            saved != null && dates.any { it.id == saved } -> saved
            else -> TemplateLogic.calendarFieldId(template, dates)
        }
        _state.update { it.copy(template = template, dateFields = dates, plotBy = plot) }
    }

    private val plotPrefs get() = getApplication<Application>().getSharedPreferences("calendar_plot_by", android.content.Context.MODE_PRIVATE)

    /** Calendar "Plot by": null = the due date. */
    fun setPlotBy(fieldId: String?) {
        plotPrefs.edit().putString(projectId, fieldId ?: DUE).apply()
        _state.update { it.copy(plotBy = fieldId) }
    }

    fun setMine(on: Boolean) = _state.update { it.copy(mine = on) }

    // region Status columns (web board ••• menu; Full access)
    fun renameSection(id: String, name: String) = act(R.string.pp_change_failed) { api.updateSection(projectId, id, name = name) }
    fun colorSection(id: String, color: String) = act(R.string.pp_change_failed) { api.updateSection(projectId, id, color = color) }
    /** One step left / right within its status group (a column never crosses groups by moving). */
    fun moveSection(id: String, dir: Int): Boolean {
        val target = StatusOptions.neighbour(_state.value.lanes, id, dir) ?: return false
        act(R.string.pp_change_failed) { api.updateSection(projectId, id, position = target.position ?: 0) }
        return true
    }
    fun deleteSection(id: String, moveTo: String?) = act(R.string.pp_change_failed) { api.deleteSection(projectId, id, moveTo) }
    fun addSection(group: StatusOptions.Group, name: String) = act(R.string.pp_change_failed) {
        api.createSection(projectId, name, StatusOptions.statusFor(group, name), null)
    }
    // endregion

    /** The status a section stands for (DEV-REDESIGN §1); null = a plain section. */
    fun setSectionStatus(laneId: String, status: String?) = act(R.string.board_update_failed) { api.setSectionStatus(projectId, laneId, status) }

    fun setQuery(q: String) = _state.update { it.copy(query = q) }

    fun setDrill(d: OverviewDrill?) = _state.update { it.copy(drill = d) }
    fun toggleSelect(id: String) = _state.update { it.copy(selected = TaskBulkLogic.toggle(it.selected, id)) }
    fun clearSelection() = _state.update { it.copy(selected = emptySet()) }
    fun noticeShown() = _state.update { it.copy(notice = null) }

    /** One POST per task, in board order (as the web); some failing still keeps the copies that worked. */
    fun duplicate(ids: List<String>, due: LocalDate?, onDone: () -> Unit = {}) = viewModelScope.launch {
        if (ids.isEmpty()) return@launch
        _state.update { it.copy(busy = true) }
        val body = TaskBulkLogic.body(due)
        var failed = 0
        var reason: String? = null
        val copies = mutableListOf<String>()
        ids.forEach { id ->
            try { api.duplicateTaskId(id, body)?.let(copies::add) } catch (e: ApiError) { failed++; if (reason == null) reason = (e as? ApiError.Http)?.serverMessage }
        }
        val ok = ids.size - failed
        if (copies.isNotEmpty()) offerUndo(plural(R.plurals.undo_duplicated, copies.size)) { copies.forEach { api.deleteTask(it) } }
        _state.update {
            it.copy(busy = false, selected = if (failed == 0) emptySet() else it.selected,
                notice = null,
                actionError = if (failed > 0) listOfNotNull(res.getString(R.string.bulk_dup_failed, failed, ids.size), reason).joinToString("\n") else null)
        }
        onDone()
        load()
    }
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
            _state.update { it.copy(actionError = e.sentence(res, fallback)) }
        }
        _state.update { it.copy(busy = false) }
        load()
    }
}

@Composable
fun ProjectDetailScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenSettings: () -> Unit = {}, onOpenChat: (String) -> Unit = {}, onOpenForm: (String) -> Unit = {}, onOpenDoc: (String) -> Unit = {},
                        /** The form builder: null = a new form (FORM-BUILDER). */ onBuildForm: (String?) -> Unit = {},
                        /** Another project (a won deal's Master Task / Master Calendar, PIPELINE §15). */ onOpenProject: (String) -> Unit = {},
                        /** A won deal's execution folder (PIPELINE §15). */ onOpenFolder: (String) -> Unit = {},
                        /** A fresh GIDEON chat about this project (its name for the context chip). */ onOpenGideon: (String) -> Unit = {},
                        /** Projects (a project that is gone). */ onOpenProjects: () -> Unit = onBack,
                        /** A link's `?view=`: a layout (board, list, table, calendar, timeline), overview or a module tab (forms, sheet…). */
                        initialView: String? = null,
                        vm: ProjectDetailViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    // Back from settings or a task: what changed there shows here.
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (entered) vm.load() else entered = true }
    // Its tasks change on another device: the project room while this board is open (Berlin, 8 Oct).
    id.znetworks.nexus.core.realtime.RealtimeRoom("project:${vm.projectId}")
    id.znetworks.nexus.core.realtime.LiveRefresh(vm.projectId, liveMs = 120_000, fallbackMs = 30_000, matches = { id.znetworks.nexus.core.realtime.RealtimeEvents.touchesProject(it, vm.projectId) }) { vm.load().join() }
    var tab by rememberSaveable { mutableStateOf(ProjectTab.BOARD) }
    // The open view (a saved view's id); the tab follows its layout.
    var viewId by rememberSaveable { mutableStateOf(vm.savedViewId()) }
    // A selection belongs to the task views; leaving them drops it.
    LaunchedEffect(tab) { if (!tab.searches || tab == ProjectTab.CALENDAR || tab == ProjectTab.TIMELINE) { vm.clearSelection() }; if (tab != ProjectTab.BOARD && tab != ProjectTab.LIST) vm.setDrill(null) }
    var newDealRequest by rememberSaveable { mutableStateOf(0) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var createDue by remember { mutableStateOf<LocalDate?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    // Duplicate + date…: the ids waiting for the optional due-date popup.
    var dupDateFor by remember { mutableStateOf<List<String>?>(null) }
    var dueFor by remember { mutableStateOf<List<String>?>(null) }
    var deleting by remember { mutableStateOf<List<String>?>(null) }
    var membersOpen by rememberSaveable { mutableStateOf(false) }
    var newView by rememberSaveable { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<ProjectView?>(null) }
    var renameFor by remember { mutableStateOf<ProjectView?>(null) }
    var deleteViewFor by remember { mutableStateOf<ProjectView?>(null) }
    var templateOpenedGuard by rememberSaveable { mutableStateOf(false) }
    var filterFor by remember { mutableStateOf<ProjectView?>(null) }
    // Access ended while this project was open (join-denied "revoked"): LiveRefresh refetches into the no-access
    // state; say why it changed (web f661bfb).
    LaunchedEffect(vm.projectId) {
        (context.applicationContext as NexusApplication).container.realtime.events.collect { e ->
            if (id.znetworks.nexus.core.realtime.RealtimeEvents.revoked(e, vm.projectId))
                android.widget.Toast.makeText(context, context.getString(R.string.acc_changed), android.widget.Toast.LENGTH_LONG).show()
        }
    }
    LaunchedEffect(s.notice) { s.notice?.let { android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_SHORT).show(); vm.noticeShown() } }
    androidx.activity.compose.BackHandler(enabled = s.selected.isNotEmpty()) { vm.clearSelection() }
    val meId = (context.applicationContext as NexusApplication).container.sessionStore.current?.userId
    val access = s.access
    val lanes = BoardLogic.filter(OverviewLogic.filter(TemplateLogic.mine(s.lanes, if (s.mine) meId else null), s.drill), s.query)
    val total = s.lanes.sumOf { it.tasks.size }
    val shown = lanes.sumOf { it.tasks.size }
    val members = s.detail?.members.orEmpty()

    // The tab row: Overview, the views, then the module tabs (web order); Pipeline / Outlet boards keep their own tabs.
    val tabs = s.tabs
    val views = s.shownViews
    val items: List<PageTabItem> = if (!s.taskProject) tabs.map { PageTabItem.Module(it) } else buildList {
        if (ProjectTab.OVERVIEW in tabs) add(PageTabItem.Overview)
        views.forEach { add(PageTabItem.View(it)) }
        listOf(ProjectTab.SHEET, ProjectTab.PAGES, ProjectTab.FORMS, ProjectTab.CHAT, ProjectTab.AUTOMATIONS).filter { it in tabs }.forEach { add(PageTabItem.Module(it)) }
    }
    val view = views.firstOrNull { it.id == viewId }
    val selectedItem: PageTabItem? = when {
        !s.taskProject -> PageTabItem.Module(tab)
        tab == ProjectTab.OVERVIEW -> PageTabItem.Overview
        tab.searches && view != null -> PageTabItem.View(view)
        else -> items.firstOrNull { it is PageTabItem.Module && it.tab == tab }
    }
    fun select(item: PageTabItem) {
        when (item) {
            PageTabItem.Overview -> tab = ProjectTab.OVERVIEW
            is PageTabItem.View -> { viewId = item.view.id; vm.rememberView(item.view.id); tab = layoutTab(ViewsLogic.layoutOf(item.view)) }
            is PageTabItem.Module -> tab = item.tab
        }
    }
    // A link's ?view= (the UI tour, nexus://projects/<id>?view=…): applied once, when the views are known.
    var linkApplied by rememberSaveable { mutableStateOf(initialView == null) }
    LaunchedEffect(views, tabs, s.detail?.id) {
        if (linkApplied || s.detail == null || s.views == null) return@LaunchedEffect
        linkApplied = true; templateOpenedGuard = true
        val want = initialView!!.lowercase()
        when (want) {
            "overview" -> tab = ProjectTab.OVERVIEW
            "forms" -> tab = ProjectTab.FORMS
            "sheet", "spreadsheet" -> tab = ProjectTab.SHEET
            "pages" -> tab = ProjectTab.PAGES
            "chat" -> tab = ProjectTab.CHAT
            "automations" -> tab = ProjectTab.AUTOMATIONS
            else -> (views.firstOrNull { it.id == want } ?: views.firstOrNull { it.builtin == want } ?: views.firstOrNull { ViewsLogic.layoutOf(it) == want })
                ?.let { v -> viewId = v.id; tab = layoutTab(ViewsLogic.layoutOf(v)) }
        }
    }
    // The open view gone (deleted, hidden, another device): the first view. Built from a template: its tab, once.
    var templateOpened by rememberSaveable { mutableStateOf(false) }
    if (templateOpenedGuard) templateOpened = true
    LaunchedEffect(views, tabs, s.template, s.detail?.id) {
        if (s.detail == null) return@LaunchedEffect
        if (!s.taskProject) { tab = ProjectTabsLogic.fallback(tab, tabs); return@LaunchedEffect }
        val t = s.template
        if (t != null && !templateOpened && viewId == null) {
            templateOpened = true
            TemplateLogic.openingTab(t, tabs)?.let { want -> views.firstOrNull { layoutTab(ViewsLogic.layoutOf(it)) == want }?.let { select(PageTabItem.View(it)); return@LaunchedEffect } }
        }
        if (tab.searches && views.none { it.id == viewId }) views.firstOrNull()?.let { select(PageTabItem.View(it)) }
        if (!tab.searches && tab != ProjectTab.OVERVIEW && tab !in tabs) views.firstOrNull()?.let { select(PageTabItem.View(it)) }
    }

    val cfg = view?.let { s.config(it) } ?: ViewConfig()
    val fields = s.fields.orEmpty()
    val today = id.znetworks.nexus.core.time.OfficeTime.today()
    val visibleTasks = ViewsLogic.sort(ViewsLogic.filter(lanes.flatMap { it.tasks }, cfg, meId, today), cfg)
    val groups = ViewsLogic.group(visibleTasks, s.lanes, cfg.groupBy, fields)
        .filter { it.key !in cfg.hiddenGroups }
        .let { gs -> if (cfg.hideEmptyGroups && tab == ProjectTab.LIST) gs.filter { it.tasks.isNotEmpty() } else gs }
    LaunchedEffect(visibleTasks.map { it.id }) { vm.prune(visibleTasks.map { it.id }.toSet()) }
    // The view's card / column properties (web visibleProps) and the tasks other projects linked in (board, by section).
    val propCtx = PropCtx(CardProps.visible(cfg.visibleProps, view?.let { ViewsLogic.layoutOf(it) } ?: "board", fields, StatusOptions.inUse(s.lanes)),
        fields, s.lanes, s.detail?.members.orEmpty().associate { it.uid to (it.user?.name ?: it.uid) }, today, vm.projectId)
    val linkedLanes = if (tab != ProjectTab.BOARD || cfg.groupBy != "section") emptyList() else {
        val tokens = BoardLogic.tokens(s.query)
        BoardLogic.linkedLanes(s.lanes, vm.projectId) { t -> BoardLogic.matches(t, "", tokens) && ViewsLogic.filter(listOf(t), cfg, meId, today).isNotEmpty() }
    }
    val canAddTask = access.canEdit && s.taskProject && s.lanes.isNotEmpty() && s.detail != null

    Box(Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            val onAdd = if (canAddTask && tab != ProjectTab.FORMS) ({ createDue = null; creating = true }) else if (tab == ProjectTab.FORMS && access.canEdit) ({ onBuildForm(null) }) else null
            val tabsShown = s.detail != null && !s.locked
            ProjectPageHeader(s.detail, onBack, onMembers = { membersOpen = true }, onGideon = { onOpenGideon(s.detail?.name.orEmpty()) }, onSettings = onOpenSettings,
                onAdd = onAdd, addInTabs = tabsShown)
            if (tabsShown) {
                ProjectTabRow(items, selectedItem, canAddView = s.taskProject && access.canEdit && s.views != null, onSelect = ::select,
                    onViewMenu = { menuFor = it }, onAddView = { newView = true }, onAdd = onAdd)
            }
            androidx.compose.material3.HorizontalDivider(color = c.border)
            // The template's "My …" preset (Notion's "My meetings"): assignee = me, on its tab.
            val myView = s.template?.myView
            if (myView != null && meId != null && !s.locked && tab.searches) {
                val lang = templateLang()
                Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 8.dp)) {
                    MineChip(TemplateLogic.say(myView.name, lang), s.mine) { vm.setMine(!s.mine) }
                }
            }
            if (tab.searches && !s.locked && s.detail != null) {
                Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    id.znetworks.nexus.ui.components.CompactSearchField(s.query, vm::setQuery, stringResource(R.string.board_search), Modifier.weight(1f)) {
                        // "0/84" is an answer, not a failure: an empty board otherwise reads as one that failed.
                        Text("$shown/$total", fontSize = 11.sp, color = c.mutedFg)
                        IconButton(onClick = { vm.setQuery("") }, modifier = Modifier.size(36.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.clear_search), modifier = Modifier.size(18.dp)) }
                    }
                    if (view != null && s.taskProject) {
                        Spacer(Modifier.width(8.dp))
                        // The filter button: filled ink with the rule count when the view filters something.
                        Box {
                            id.znetworks.nexus.ui.components.HeaderIconButton(Icons.Filled.FilterList, stringResource(R.string.view_filter), { filterFor = view },
                                primary = cfg.filtered, badge = cfg.rules.size.takeIf { it > 0 }?.toString(), size = 44.dp)
                        }
                    }
                }
            }
            s.drill?.takeIf { tab == ProjectTab.BOARD || tab == ProjectTab.LIST }?.let { d -> DrillBar(d, s.detail, s.lanes, shown) { vm.setDrill(null) } }
            s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
            Box(Modifier.weight(1f)) {
                when {
                    s.loading && s.detail == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    s.notFound -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pp_not_found), stringResource(R.string.pp_not_found_sub),
                        stringResource(R.string.pp_go_projects), onOpenProjects, Modifier.fillMaxSize())
                    s.locked -> EmptyState(Icons.Filled.Lock, stringResource(R.string.pp_no_access), stringResource(R.string.pp_no_access_sub),
                        stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                    s.error != null && s.detail == null -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pp_load_failed), s.error!!,
                        stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                    s.detail != null -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                        val web = { id.znetworks.nexus.ui.shell.openWeb(context, "/projects/${vm.projectId}") }
                        val filteredEmpty = tab.searches && visibleTasks.isEmpty() && (s.query.isNotBlank() || cfg.filtered || s.mine || s.drill != null)
                        when {
                            s.taskProject && tab.searches && views.isEmpty() -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pp_no_views), stringResource(R.string.pp_no_views_sub),
                                stringResource(R.string.pp_settings), onOpenSettings, Modifier.fillMaxSize())
                            filteredEmpty && tab != ProjectTab.BOARD -> EmptyState(Icons.Filled.FilterList, stringResource(R.string.pp_no_match), stringResource(R.string.pp_no_match_sub),
                                stringResource(R.string.filter_clear), {
                                    vm.setQuery(""); vm.setMine(false); vm.setDrill(null)
                                    if (view != null && cfg.rules.isNotEmpty()) vm.applyConfig(view, cfg.copy(rules = emptyList()), save = ViewsLogic.canEditView(view, access, s.canEditShared))
                                }, Modifier.fillMaxSize())
                            s.lanes.isEmpty() && tab.searches && tab != ProjectTab.CALENDAR -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.board_no_lanes),
                                stringResource(R.string.board_no_lanes_sub), stringResource(R.string.open_on_web), web, Modifier.fillMaxSize())
                            total == 0 && (tab == ProjectTab.LIST || tab == ProjectTab.TABLE) && canAddTask -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pp_no_tasks),
                                stringResource(R.string.pp_no_tasks_sub), stringResource(R.string.pp_add_task), { createDue = null; creating = true }, Modifier.fillMaxSize())
                            else -> when (tab) {
                                ProjectTab.OVERVIEW -> ProjectOverview(s.detail!!, s.lanes, onOpenTask,
                                    onDrill = { d -> vm.setDrill(d); views.firstOrNull { it.layout == "board" || it.layout == "list" }?.let { select(PageTabItem.View(it)) } },
                                    onEditBrief = onOpenSettings,
                                    onAddTask = { if (s.lanes.isNotEmpty() && access.canEdit) { createDue = null; creating = true } })
                                ProjectTab.BOARD -> BoardView(groups, cfg, s.lanes, access, vm, s.selected, propCtx, linkedLanes, onOpenTask) { dupDateFor = it }
                                ProjectTab.LIST -> ListView(view?.id ?: "list", groups, cfg, s.lanes, access, vm, s.selected, onOpenTask) { dupDateFor = it }
                                ProjectTab.TABLE -> TableView(groups, cfg, s.lanes, propCtx, members, access, vm, s.selected, onOpenTask) { t -> dueFor = listOf(t.id) }
                                ProjectTab.SHEET -> ProjectSpreadsheetTab(vm.projectId, web)
                                ProjectTab.CALENDAR -> CalendarTab(visibleTasks, onOpenTask,
                                    plot = CalendarPlot(s.dateFields.orEmpty(), s.plotBy, vm::setPlotBy)) { d -> if (canAddTask) { createDue = d; creating = true } }
                                ProjectTab.TIMELINE -> TimelineTab(groups.map { groupLabel(it, cfg.groupBy) to it.tasks }, onOpenTask)
                                ProjectTab.AUTOMATIONS -> AutomationsTab(vm.projectId, s.lanes, s.detail!!.members)
                                ProjectTab.PIPELINE -> id.znetworks.nexus.feature.pipeline.PipelineTab(newDealRequest, onOpenProject, onOpenFolder)
                                ProjectTab.OUTLET_OVERVIEW, ProjectTab.OUTLET_CALENDAR, ProjectTab.OUTLET_BOARD, ProjectTab.OUTLET_FORM -> {
                                    val outletViews = mapOf(ProjectTab.OUTLET_OVERVIEW to id.znetworks.nexus.feature.outlet.OutletView.OVERVIEW,
                                        ProjectTab.OUTLET_CALENDAR to id.znetworks.nexus.feature.outlet.OutletView.CALENDAR,
                                        ProjectTab.OUTLET_BOARD to id.znetworks.nexus.feature.outlet.OutletView.BOARD,
                                        ProjectTab.OUTLET_FORM to id.znetworks.nexus.feature.outlet.OutletView.FORM)
                                    id.znetworks.nexus.feature.outlet.OutletTab(outletViews.getValue(tab), goTo = { v -> tab = outletViews.entries.first { it.value == v }.key })
                                }
                                ProjectTab.PAGES -> id.znetworks.nexus.feature.docs.ProjectPagesTab(vm.projectId, onOpenDoc)
                                ProjectTab.FORMS -> id.znetworks.nexus.feature.forms.ProjectFormsTab(vm.projectId, onOpenForm, onBuildForm)
                                ProjectTab.CHAT -> id.znetworks.nexus.feature.chat.ProjectChatTab(vm.projectId) { onOpenChat(it); views.firstOrNull()?.let { select(PageTabItem.View(it)) } }
                            }
                        }
                    }
                }
            }
        }
        // A Pipeline Dashboard: "+" is New deal on Pipeline, and no task "+" anywhere (its task sections are hidden).
        if (s.detail != null && tab == ProjectTab.PIPELINE) {
            FloatingActionButton(onClick = { newDealRequest++ }, containerColor = c.onyx, contentColor = c.background,
                modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)) { Icon(Icons.Filled.Add, stringResource(R.string.pl_new_deal)) }
        }
        val selectingTab = tab == ProjectTab.BOARD || tab == ProjectTab.LIST || tab == ProjectTab.TABLE
        if (s.selected.isNotEmpty() && selectingTab) {
            val ordered = visibleTasks.map { it.id }.filter { it in s.selected }
            ProjectSelectionBar(s.selected.size, s.busy, s.lanes, members, access.canDelete,
                onMove = { vm.moveTo(ordered, it) }, onPriority = { vm.setPriority(ordered, it) }, onAssign = { vm.assign(ordered, it) },
                onDue = { dueFor = ordered }, onClearDue = { vm.setDue(ordered, null) },
                onDuplicate = { vm.duplicate(ordered, null) }, onDuplicateDate = { dupDateFor = ordered }, onDelete = { deleting = ordered },
                onSelectAll = { vm.selectAll(visibleTasks.map { it.id }) }, onClear = vm::clearSelection,
                modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
        } else s.undo?.let { u ->
            UndoBar(u, onUndo = { vm.undo(u) }, onDismiss = { vm.dismissUndo(u.id) }, modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp))
        }
    }
    dupDateFor?.let { ids ->
        DuplicateDateDialog(ids.size, s.busy, onDismiss = { dupDateFor = null }) { due -> vm.duplicate(ids, due) { dupDateFor = null } }
    }
    dueFor?.let { ids ->
        val initial = s.lanes.flatMap { it.tasks }.firstOrNull { it.id == ids.firstOrNull() }?.dueDate?.let { dueDate(it) }
        DuePickerDialog(if (ids.size == 1) initial else null, onDismiss = { dueFor = null }) { d -> dueFor = null; vm.setDue(ids, d) }
    }
    deleting?.let { ids -> DeleteTasksDialog(ids.size, onDismiss = { deleting = null }) { deleting = null; vm.delete(ids) } }
    if (membersOpen && s.detail != null) MembersDialog(members, canAdd = access.canManage, onAdd = { membersOpen = false; onOpenSettings() }) { membersOpen = false }
    if (newView) NewViewDialog(s.canEditShared, onDismiss = { newView = false }) { name, layout, shared ->
        newView = false
        vm.createView(name, layout, shared) { id -> id?.let { viewId = it; vm.rememberView(it); tab = layoutTab(layout) } }
    }
    menuFor?.let { v ->
        val canEdit = ViewsLogic.canEditView(v, access, s.canEditShared)
        ViewMenuDialog(v, canEdit, ViewsLogic.canDeleteView(v, access, s.canEditShared), onDismiss = { menuFor = null },
            onRename = { renameFor = v }, onFilter = { filterFor = v },
            onDuplicate = {
                val name = context.getString(R.string.view_copy_name, ViewsLogic.name(v) ?: context.getString(layoutTab(ViewsLogic.layoutOf(v)).label))
                vm.duplicateView(v, name) { id -> id?.let { viewId = it; vm.rememberView(it) } }
            },
            onHide = v.builtin?.takeIf { it in ViewsLogic.LAYOUTS }?.let { key -> { vm.hideBuiltin(key) } },
            onDelete = { deleteViewFor = v })
    }
    renameFor?.let { v -> TextPromptDialog(stringResource(R.string.view_rename), ViewsLogic.name(v).orEmpty(), stringResource(R.string.filter_save), onDismiss = { renameFor = null }) { n -> renameFor = null; vm.renameView(v, n) } }
    deleteViewFor?.let { v -> ConfirmDeleteViewDialog(viewLabel(v), onDismiss = { deleteViewFor = null }) { deleteViewFor = null; vm.deleteView(v) } }
    filterFor?.let { v ->
        val canSave = ViewsLogic.canEditView(v, access, s.canEditShared)
        ViewFilterDialog(s.config(v), s.lanes, members, fields, canSave, onDismiss = { filterFor = null }) { next -> filterFor = null; vm.applyConfig(v, next, canSave) }
    }
    if (creating) CreateTaskDialog(StatusOptions.ordered(s.lanes), busy = s.busy, initialDue = createDue, projectId = vm.projectId, onDismiss = { creating = false }) { lane, title, prio, due, fields ->
        vm.create(lane, title, prio, due, fields) { id -> creating = false; if (id.isNotBlank()) onOpenTask(id) }
    }
    s.actionError?.let { AlertDialog(onDismissRequest = vm::dismissError, title = { Text(stringResource(R.string.board_update_failed)) },
        text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } }) }
}

/** The project Spreadsheet (key "sheet", 13 Oct): native phone v1 (feature/sheets). */
@Composable
internal fun ProjectSpreadsheetTab(projectId: String, openWeb: () -> Unit) {
    id.znetworks.nexus.feature.sheets.ProjectSheetTab(projectId, openWeb)
}

/** "Showing: Overdue · 4 tasks ×" over the Board / List after a tap on the Overview. */
@Composable
private fun DrillBar(d: OverviewDrill, detail: ProjectDetail?, lanes: List<Lane>, shown: Int, onClear: () -> Unit) {
    val c = Nx.colors
    val who = d.assigneeId?.let { id ->
        if (id == "NONE") stringResource(R.string.ov_filter_unassigned)
        else detail?.members?.firstOrNull { it.uid == id }?.user?.name
            ?: lanes.flatMap { it.tasks }.flatMap { it.assignees }.firstOrNull { (it.user?.id ?: it.userId) == id }?.user?.name ?: "—"
    }
    val label = listOfNotNull(
        when (d.due) { "OVERDUE" -> stringResource(R.string.ov_filter_overdue); "NEXT7" -> stringResource(R.string.ov_filter_next7); "NONE" -> stringResource(R.string.ov_filter_nodue); else -> null },
        who,
        d.priority?.let { if (it == "NONE") stringResource(R.string.ov_no_priority) else priorityLabel(it) },
        d.section?.let { id -> lanes.firstOrNull { it.id == id }?.name },
    ).ifEmpty { listOf(stringResource(R.string.ov_filter_open)) }.joinToString(" · ")
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(c.violet.copy(alpha = 0.08f))
        .padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.violetText, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Text("  ·  $shown", fontSize = 13.sp, color = c.mutedFg)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onClear) { Icon(Icons.Filled.Close, stringResource(R.string.ov_filter_clear), tint = c.mutedFg) }
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

/** The template's "My …" chip: on = only the person's own tasks. */
@Composable
private fun MineChip(label: String, on: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.clip(CircleShape).border(1.dp, if (on) c.violet.copy(alpha = 0.4f) else c.border, CircleShape)
        .background(if (on) c.violet.copy(alpha = 0.1f) else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (on) { Icon(Icons.Filled.Check, null, tint = c.violetText, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (on) c.violetText else c.mutedFg)
    }
}

/** Section status (DEV-REDESIGN §1): centred, None + the five statuses; tasks moved in take the one picked. */
@Composable
internal fun SectionStatusDialog(section: String, current: String?, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.sec_status_title, section)) },
        text = {
            Column {
                Text(stringResource(R.string.sec_status_hint), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(bottom = 8.dp))
                (listOf<String?>(null) + TemplateLogic.SECTION_STATUSES).forEach { st ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { onPick(st) }.padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(selected = current == st, onClick = { onPick(st) })
                        Text(if (st == null) stringResource(R.string.sec_status_none) else taskStatusLabel(st), fontSize = 14.sp, color = c.foreground)
                    }
                }
            }
        },
        confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** One user action that can be taken back, however many tasks it touched. */
class UndoEntry(val id: Long, val label: String, val run: suspend () -> Unit)
