package id.znetworks.nexus.feature.tasks

import androidx.compose.material.icons.automirrored.filled.ArrowBack
import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.projects.BoardTask
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.TaskCard
import id.znetworks.nexus.feature.projects.dueDate
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate

/**
 * My Tasks grouping, a port of the web's lib/my-tasks.ts (QA S-04 / B01, 13 Oct 2026):
 *   Overdue   open, past due: a date-only task once its WIB day is over, a timed task from its time.
 *   Due soon  open, due from now up to the end of the WIB day 3 days ahead.
 *   Later     open, due later, then open without a due date.
 *   Done      done in the last 7 days (completedAt, else updatedAt), newest first.
 * Inside a group the most urgent first: by due day, then priority, then the time, then the title. Cancelled tasks
 * are left out. The screen shows the first [first] of a group and "Show all".
 */
object MyTaskGroups {
    enum class Group(val first: Int) { OVERDUE(20), SOON(12), LATER(12), DONE(8) }

    private const val DAY_MS = 86_400_000L
    private const val WIB_MS = 7 * 3_600_000L
    private val RANK = mapOf("URGENT" to 0, "HIGH" to 1, "MEDIUM" to 2, "LOW" to 3, "NONE" to 4)

    private fun ms(iso: String?): Long? = iso?.takeIf { it.isNotBlank() }?.let { s ->
        runCatching { java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDate.parse(s.take(10)).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
    }
    private fun wibDay(ms: Long) = java.time.Instant.ofEpochMilli(ms + WIB_MS).atZone(java.time.ZoneOffset.UTC).toLocalDate()

    /** A due without a time: stored at 00:00 UTC (web/API date picks) or at 00:00 WIB (older clients). */
    fun isDateOnly(ms: Long): Boolean = Math.floorMod(ms, DAY_MS) == 0L || Math.floorMod(ms + WIB_MS, DAY_MS) == 0L

    fun isOverdueAt(due: String?, now: Long): Boolean {
        val m = ms(due) ?: return false
        return if (isDateOnly(m)) wibDay(m).isBefore(wibDay(now)) else m < now
    }

    private fun rank(p: String?) = RANK[(p ?: "NONE").uppercase()] ?: 4

    private val byUrgency = Comparator<BoardTask> { a, b ->
        val da = ms(a.dueDate); val db = ms(b.dueDate)
        if ((da != null) != (db != null)) return@Comparator if (da != null) -1 else 1
        if (da != null && db != null) {
            val sa = wibDay(da); val sb = wibDay(db)
            if (sa != sb) return@Comparator sa.compareTo(sb)
            if (rank(a.priority) != rank(b.priority)) return@Comparator rank(a.priority) - rank(b.priority)
            if (da != db) return@Comparator da.compareTo(db)
        } else if (rank(a.priority) != rank(b.priority)) return@Comparator rank(a.priority) - rank(b.priority)
        a.title.compareTo(b.title)
    }

    fun group(tasks: List<BoardTask>, now: Long = System.currentTimeMillis(), soonDays: Int = 3): List<Pair<Group, List<BoardTask>>> {
        // The end of the WIB day [soonDays] ahead.
        val soonEnd = wibDay(now + soonDays * DAY_MS).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() - WIB_MS + DAY_MS
        val overdue = mutableListOf<BoardTask>(); val soon = mutableListOf<BoardTask>(); val later = mutableListOf<BoardTask>(); val done = mutableListOf<BoardTask>()
        for (t in tasks) {
            val st = t.status.orEmpty().uppercase()
            if (st == "DONE" || st == "COMPLETED" || st == "COMPLETE") {
                val at = ms(t.completedAt ?: t.updatedAt)
                if (at != null && now - at <= 7 * DAY_MS) done += t
                continue
            }
            if (st == "CANCELLED") continue
            val m = ms(t.dueDate)
            when {
                m == null -> later += t
                isOverdueAt(t.dueDate, now) -> overdue += t
                m < soonEnd -> soon += t
                else -> later += t
            }
        }
        return listOf(Group.OVERDUE to overdue.sortedWith(byUrgency), Group.SOON to soon.sortedWith(byUrgency), Group.LATER to later.sortedWith(byUrgency),
            Group.DONE to done.sortedByDescending { ms(it.completedAt ?: it.updatedAt) ?: 0L }).filter { it.second.isNotEmpty() }
    }
}

data class MyTasksState(
    val tasks: List<BoardTask> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val savedAt: Long? = null,
    val actionError: String? = null,
)

class MyTasksViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(MyTasksState())
    val state = _state.asStateFlow()

    fun load() = viewModelScope.launch {
        val me = c.sessionStore.current?.userId ?: return@launch
        try {
            val r = api.myTasks(me)
            _state.update { it.copy(tasks = r.value, savedAt = r.savedAtMillis, loading = false, error = null) }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = if (it.tasks.isEmpty()) e.describe(res) else null) }
        }
    }

    fun toggle(t: BoardTask) = viewModelScope.launch {
        try {
            api.updateTask(t.id, JsonObject(mapOf("status" to JsonPrimitive(if (t.isDone) "TODO" else "DONE"))))
        } catch (e: ApiError) {
            _state.update { it.copy(actionError = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.board_update_failed)) }
        }
        load()
    }

    fun dismissError() = _state.update { it.copy(actionError = null) }
}

@Composable
fun MyTasksScreen(onOpenTask: (String) -> Unit, onBrowseProjects: () -> Unit, onBack: (() -> Unit)? = null, vm: MyTasksViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    id.znetworks.nexus.core.realtime.LiveRefresh(Unit, null, null,
        { id.znetworks.nexus.core.realtime.RealtimeEvents.isMyTasks(it) || it.name in id.znetworks.nexus.core.realtime.RealtimeEvents.TASK },
        refreshOnResume = true, debounceMs = 400) { vm.load().join() }
    var expanded by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(setOf<MyTaskGroups.Group>()) }
    Column(Modifier.fillMaxSize().background(c.background)) {
        // Opened from More (no longer a tab): a back arrow beside the title.
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.mytasks_title), subtitle = stringResource(R.string.sub_my_tasks), onBack = onBack)
        s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
        Box(Modifier.weight(1f)) {
            when {
                s.loading && s.tasks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null -> EmptyState(Icons.Filled.Checklist, stringResource(R.string.mytasks_load_failed), s.error!!,
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                s.tasks.isEmpty() -> EmptyState(Icons.Filled.Checklist, stringResource(R.string.mytasks_empty), stringResource(R.string.mytasks_empty_sub),
                    stringResource(R.string.mytasks_browse), onBrowseProjects, Modifier.fillMaxSize())
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                    val groups = MyTaskGroups.group(s.tasks)
                    // Nothing open and nothing done this week: the empty state, like the web (done tasks age out).
                    if (groups.isEmpty()) EmptyState(Icons.Filled.Checklist, stringResource(R.string.mytasks_empty), stringResource(R.string.mytasks_empty_sub),
                        stringResource(R.string.mytasks_browse), onBrowseProjects, Modifier.fillMaxSize())
                    else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        groups.forEach { (g, list) ->
                            item(key = "h-$g") {
                                Text(
                                    stringResource(when (g) {
                                        MyTaskGroups.Group.OVERDUE -> R.string.mytasks_overdue
                                        MyTaskGroups.Group.SOON -> R.string.mytasks_soon
                                        MyTaskGroups.Group.LATER -> R.string.mytasks_later
                                        MyTaskGroups.Group.DONE -> R.string.mytasks_done
                                    }).uppercase() + " · ${list.size}",
                                    fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
                                    color = if (g == MyTaskGroups.Group.OVERDUE) c.danger else c.mutedFg,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                            val all = g in expanded
                            items(if (all) list else list.take(g.first), key = { "${g}-${it.id}" }) { t ->
                                TaskCard(t, onClick = { onOpenTask(t.id) }, onToggleDone = { vm.toggle(t) }, showProject = true)
                            }
                            if (list.size > g.first) item(key = "more-$g") {
                                TextButton(onClick = { expanded = if (all) expanded - g else expanded + g }) {
                                    Text(if (all) stringResource(R.string.mytasks_show_fewer) else stringResource(R.string.mytasks_show_all, list.size))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    s.actionError?.let {
        AlertDialog(onDismissRequest = vm::dismissError, title = { Text(stringResource(R.string.board_update_failed)) }, text = { Text(it) },
            confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } })
    }
}
