package id.znetworks.nexus.feature.tasks

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.Uploads
import id.znetworks.nexus.feature.projects.BoardTask
import id.znetworks.nexus.feature.projects.ProjectMemberRef
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.time.LocalDate

data class UploadProgress(val name: String, val done: Long, val total: Long)

data class TaskDetailState(
    val task: TaskDetail? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val savedAt: Long? = null,
    val attachments: List<Attachment> = emptyList(),
    val deps: Dependencies = Dependencies(),
    val depsLoaded: Boolean = false,
    val time: List<TimeEntry> = emptyList(),
    val members: List<ProjectMemberRef> = emptyList(),
    val projectTasks: List<BoardTask> = emptyList(),
    val isBoD: Boolean = false,
    val upload: UploadProgress? = null,
    val opening: String? = null,
    val busy: Boolean = false,
    val actionError: String? = null,
    val deleted: Boolean = false,
)

class TaskDetailViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val taskId: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = TaskApi(c.api, c.uploads)
    private val projects = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(TaskDetailState())
    val state = _state.asStateFlow()

    init {
        load()
        viewModelScope.launch { c.viewer.load(); _state.update { it.copy(isBoD = c.viewer.isBoD) } }
    }

    fun load() = viewModelScope.launch {
        try {
            val t = api.task(taskId)
            _state.update { it.copy(task = t.value, savedAt = t.savedAtMillis, loading = false, error = null) }
            loadExtras(t.value.projectId)
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(res)) }
        }
    }

    private fun loadExtras(projectId: String?) = viewModelScope.launch {
        val files = async { runCatching { api.attachments(taskId).value }.getOrNull() }
        val deps = async { runCatching { api.dependencies(taskId) }.getOrNull() }
        val time = async { runCatching { api.timeEntries(taskId) }.getOrNull() }
        val members = async { projectId?.let { runCatching { projects.project(it).value.members }.getOrNull() } }
        _state.update { s ->
            s.copy(
                attachments = files.await() ?: s.attachments,
                deps = deps.await() ?: s.deps, depsLoaded = true,
                time = time.await() ?: s.time,
                members = members.await() ?: s.members,
            )
        }
    }

    fun dismissError() = _state.update { it.copy(actionError = null) }
    fun showError(msg: String) = _state.update { it.copy(actionError = msg) }

    // region edits

    fun setTitle(title: String) {
        val t = _state.value.task ?: return
        if (title.isBlank() || title.trim() == t.title) return
        patch("title" to JsonPrimitive(title.trim()))
    }

    fun setStatus(s: String) = patch("status" to JsonPrimitive(s))
    fun setPriority(p: String) = patch("priority" to JsonPrimitive(p))
    fun setDue(d: LocalDate?) = patch("dueDate" to (d?.let { JsonPrimitive(it.toString()) } ?: JsonNull))
    fun setStart(d: LocalDate?) = patch("startDate" to (d?.let { JsonPrimitive(it.toString()) } ?: JsonNull))
    fun setDescription(text: String, onDone: () -> Unit) = patch("description" to JsonPrimitive(text), onDone = onDone)
    fun setAssignees(ids: Set<String>) = patch("assigneeIds" to JsonArray(ids.map { JsonPrimitive(it) }))

    private fun patch(vararg fields: Pair<String, JsonElement>, onDone: () -> Unit = {}) = act(R.string.td_update_failed) {
        projects.updateTask(taskId, JsonObject(fields.toMap()))
        onDone()
    }

    fun toggleSubtask(s: SubtaskDetail) = act(R.string.td_update_failed) {
        projects.updateTask(s.id, JsonObject(mapOf("status" to JsonPrimitive(if (s.isDone) "TODO" else "DONE"))))
    }

    /** The box keeps the text until the server has it ([onDone] clears it). */
    fun addSubtask(title: String, onDone: () -> Unit) {
        val t = _state.value.task ?: return
        val pid = t.projectId ?: return
        val lane = t.taskListId ?: t.taskList?.id ?: return
        act(R.string.td_subtask_failed) { projects.createTask(pid, lane, title, null, null, parentId = t.id); onDone() }
    }

    fun comment(text: String, onDone: () -> Unit) = act(R.string.td_comment_failed) { api.comment(taskId, text); onDone() }

    fun logTime(minutes: Int, onDone: () -> Unit) = act(R.string.td_update_failed) { api.logTime(taskId, minutes, null); onDone() }

    fun createQuest(title: String, xp: Int, onDone: () -> Unit) = act(R.string.td_quest_failed) { api.createTaskQuest(taskId, title, xp); onDone() }

    fun delete() = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            projects.deleteTask(taskId)
            _state.update { it.copy(busy = false, deleted = true) }
        } catch (e: ApiError) {
            _state.update { it.copy(busy = false, actionError = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.td_delete_failed)) }
        }
    }

    // endregion

    // region dependencies

    fun loadProjectTasks() {
        val pid = _state.value.task?.projectId ?: return
        if (_state.value.projectTasks.isNotEmpty()) return
        viewModelScope.launch {
            runCatching { projects.projectTasks(pid).value }.getOrNull()?.let { l -> _state.update { it.copy(projectTasks = l) } }
        }
    }

    fun addDependency(otherId: String) {
        // A duplicate is a 500 on the server (unique constraint): never send one.
        if (_state.value.deps.dependencies.any { it.dependsOnTask?.id == otherId } || otherId == taskId) return
        act(R.string.td_update_failed) { api.addDependency(taskId, otherId) }
    }

    fun removeDependency(depId: String) = act(R.string.td_update_failed) { api.removeDependency(taskId, depId) }

    // endregion

    // region files

    fun upload(uri: Uri) {
        val picked = c.uploads.describe(uri)
        if (picked == null || picked.size > Uploads.MAX_FILE) {
            _state.update { it.copy(actionError = res.getString(if (picked == null) R.string.td_file_unreadable else R.string.td_file_too_big)) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(upload = UploadProgress(picked.name, 0, picked.size)) }
            try {
                withContext(Dispatchers.IO) {
                    api.upload(taskId, picked) { done, total -> _state.update { it.copy(upload = UploadProgress(picked.name, done, total)) } }
                }
            } catch (e: ApiError) {
                _state.update { it.copy(actionError = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.td_upload_failed)) }
            }
            _state.update { it.copy(upload = null) }
            loadExtras(_state.value.task?.projectId)
            load()
        }
    }

    fun deleteAttachment(a: Attachment) = act(R.string.td_update_failed) { api.deleteAttachment(a.id) }

    /** Downloads with the session, then hands the file to a viewer ([share] = the system share sheet). */
    fun open(a: Attachment, share: Boolean) {
        val url = a.url ?: return
        viewModelScope.launch {
            _state.update { it.copy(opening = a.id) }
            try {
                val ctx = getApplication<Application>()
                val dir = File(ctx.cacheDir, "shared/att-${a.id}").apply { mkdirs() }
                val file = File(dir, a.label.replace("/", "_"))
                if (!file.exists() || file.length() == 0L || (a.size != null && file.length() != a.size)) {
                    file.delete()
                    withContext(Dispatchers.IO) { c.api.download(url, file, null) }
                }
                val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
                val mime = a.mimeType ?: ctx.contentResolver.getType(uri) ?: "*/*"
                val intent = if (share) {
                    Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null)
                } else {
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                runCatching { ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure {
                    _state.update { it.copy(actionError = res.getString(R.string.td_no_viewer)) }
                }
            } catch (e: ApiError) {
                _state.update { it.copy(actionError = e.describe(res)) }
            }
            _state.update { it.copy(opening = null) }
        }
    }

    // endregion

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
