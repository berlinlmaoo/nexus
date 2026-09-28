package id.znetworks.nexus.feature.tasks

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

/** Web my-tasks / iOS TasksView ("My Quest Log"): Hot today, In motion, Recently slayed. */
object MyTaskGroups {
    enum class Group { HOT, MOTION, DONE }

    /** Open tasks due within two days (overdue included) are hot; the soonest first. */
    fun group(tasks: List<BoardTask>, today: LocalDate): List<Pair<Group, List<BoardTask>>> {
        val open = tasks.filterNot { it.isDone }
        val hot = open.filter { t -> dueDate(t.dueDate)?.let { !it.isAfter(today.plusDays(1)) } == true }.sortedBy { dueDate(it.dueDate) }
        val motion = open - hot.toSet()
        val done = tasks.filter { it.isDone }
        return listOf(Group.HOT to hot.take(8), Group.MOTION to motion.take(12), Group.DONE to done.take(8)).filter { it.second.isNotEmpty() }
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
fun MyTasksScreen(onOpenTask: (String) -> Unit, onBrowseProjects: () -> Unit, vm: MyTasksViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    // Every visit re-reads: a task finished on its own screen must not stay "hot" here.
    LaunchedEffect(Unit) { vm.load() }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Text(stringResource(R.string.mytasks_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp,
            color = c.foreground, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp))
        s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
        Box(Modifier.weight(1f)) {
            when {
                s.loading && s.tasks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null -> EmptyState(Icons.Filled.Checklist, stringResource(R.string.mytasks_load_failed), s.error!!,
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                s.tasks.isEmpty() -> EmptyState(Icons.Filled.Checklist, stringResource(R.string.mytasks_empty), stringResource(R.string.mytasks_empty_sub),
                    stringResource(R.string.mytasks_browse), onBrowseProjects, Modifier.fillMaxSize())
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                    val groups = MyTaskGroups.group(s.tasks, OfficeTime.today())
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        groups.forEach { (g, list) ->
                            item(key = "h-$g") {
                                Text(
                                    stringResource(when (g) {
                                        MyTaskGroups.Group.HOT -> R.string.mytasks_hot
                                        MyTaskGroups.Group.MOTION -> R.string.mytasks_motion
                                        MyTaskGroups.Group.DONE -> R.string.mytasks_done
                                    }).uppercase() + " · ${list.size}",
                                    fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, color = c.mutedFg,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                            items(list, key = { "${g}-${it.id}" }) { t ->
                                TaskCard(t, onClick = { onOpenTask(t.id) }, onToggleDone = { vm.toggle(t) }, showProject = true)
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
