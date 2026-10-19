package id.znetworks.nexus.feature.forms

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.core.realtime.RealtimeRoom
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.HeaderIconButton
import id.znetworks.nexus.ui.components.PageTab
import id.znetworks.nexus.ui.components.PageTabs
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** One project thing the builder routes to: a section, a member, a custom field, a project. */
data class Named(val id: String, val name: String)

/** The studio's alerts: delete (with the count the person sees), delete again after new responses, a failure. */
sealed interface StudioAlert {
    data class Delete(val submissions: Int) : StudioAlert
    data class ForceDelete(val submissions: Int) : StudioAlert
    data class Failed(val title: String, val message: String) : StudioAlert
}

enum class StudioTab { PREVIEW, QUESTIONS, SETTINGS, SHARE, RESPONSES }

data class BuilderState(
    val canEdit: Boolean = false,
    val conflict: Boolean = false,
    val loading: Boolean = true,
    val error: String? = null,
    val projectName: String = "",
    /** The form on the server; null until a new form is created by its first edit. */
    val formId: String? = null,
    val slug: String? = null,
    /** `accessSchedule` as last stored (a duplicate takes it as is while the schedule is untouched). */
    val storedSchedule: JsonElement? = null,
    val responseCount: Int = 0,
    val draft: FormStudioDraft = FormStudioDraft.blank(""),
    val sections: List<Named> = emptyList(),
    val members: List<StudioMember> = emptyList(),
    val editors: List<FormEditorPresence> = emptyList(),
    val customFields: List<id.znetworks.nexus.feature.projects.CustomFieldDef> = emptyList(),
    val busy: Boolean = false,
    val toast: String? = null,
    val undo: DeletedQuestion? = null,
    val alert: StudioAlert? = null,
    /** Deleted or discarded: the screen goes back. */
    val done: Boolean = false,
) {
    val link: String? get() = formId?.let { FormLink.url(slug, it) }
}

/**
 * The form studio (web FormStudio.tsx, iOS FormBuilderView). Route: form-builder/{projectId}?form={id}.
 *
 * Changes save themselves, like the web: 700 ms after the last edit, one save at a time, and once more on the way out.
 * A new form is created by its first edit — nothing is created for a builder opened and left untouched.
 */
class FormBuilderViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["projectId"] ?: ""
    private val openedId: String? = handle.get<String>("form")?.takeIf { it.isNotBlank() }
    private val c = (app as NexusApplication).container
    private val api = FormsApi(app, c.api, c.sessionStore)
    private val projects = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(BuilderState(formId = openedId))
    val state = _state.asStateFlow()
    private var toastJob: Job? = null
    private var undoJob: Job? = null
    private var baseUpdatedAt: JsonElement? = null
    private var version = -1
    private val owner = c.sessionStore.current?.userId
    private val tabId = "android_" + java.util.UUID.randomUUID().toString().replace("-", "")
    private var sending: Pair<FormStudioDraft, FormStudioDraft>? = null
    private var focusedQuestion: String? = null

    val autosave = FormAutosave<FormStudioDraft>(viewModelScope, send = { snap, base, _ -> send(snap, base) },
        hasId = { _state.value.formId != null }, describe = ::describe, serverAuthoritative = true)

    init {
        load()
        viewModelScope.launch { c.realtime.events.collect { event ->
            if (c.sessionStore.current?.userId != owner) return@collect
            val id = _state.value.formId ?: return@collect
            val raw = event.raw?.let { runCatching { NexusJson.parseToJsonElement(it) as? JsonObject }.getOrNull() }
            when {
                event.name == RealtimeEvents.JOIN_DENIED && (raw?.get("room") as? JsonPrimitive)?.content == "form:$id" -> readOnly()
                event.taskId != id -> Unit
                event.name == RealtimeEvents.FORM_OPS -> (raw?.get("form") as? JsonObject)?.let {
                    val own = (raw["originTab"] as? JsonPrimitive)?.content == tabId
                    receive(BuilderForm(it), if (own) sending else null)
                }
                event.name == RealtimeEvents.FORM_PRESENCE -> {
                    val presence = runCatching { NexusJson.decodeFromString(FormPresence.serializer(), event.raw!!) }.getOrNull() ?: return@collect
                    _state.update { it.copy(editors = presence.members.filter { p -> p.userId != owner }) }
                    if (presence.members.firstOrNull { it.userId == owner }?.questionId != focusedQuestion) focus(focusedQuestion)
                }
            }
        } }
    }

    private fun readOnly() { autosave.stopped = true; c.realtime.leave("form:${_state.value.formId}"); _state.update { it.copy(canEdit = false, editors = emptyList(), toast = res.getString(R.string.qa_form_readonly)) } }
    fun focus(id: String?) { focusedQuestion = id; if (_state.value.canEdit) _state.value.formId?.let { c.realtime.sendFormFocus(it, id) } }
    suspend fun refreshLive() {
        val id = _state.value.formId ?: return
        if (c.sessionStore.current?.userId != owner) return
        try { receive(api.builderForm(id)); focus(focusedQuestion) }
        catch (e: ApiError.Http) { if (e.status == 403) readOnly() }
        catch (_: ApiError) { }
    }
    private fun receive(form: BuilderForm, acknowledgement: Pair<FormStudioDraft, FormStudioDraft>? = null) {
        if (form.version <= version || c.sessionStore.current?.userId != owner) return
        val server = FormStudioDraft.of(form)
        val from = acknowledgement?.let { (base, sent) -> FormCoedit.rebase(base, sent, autosave.baseline ?: base) } ?: autosave.baseline
        autosave.receive(server, from, FormCoedit::rebase)
        version = form.version; baseUpdatedAt = form.raw["updatedAt"]
        _state.update { it.copy(formId = form.id, slug = form.slug, storedSchedule = form.schedule, responseCount = if (form.raw.containsKey("_count")) form.submissions else it.responseCount, draft = autosave.draft ?: server) }
    }

    private fun describe(e: Throwable): String =
        (e as? ApiError)?.describe(res) ?: res.getString(R.string.fs_try_moment)

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true, error = null, conflict = false) }
        if (openedId != null) {
            try {
                val f = api.builderForm(openedId)
                val d = FormStudioDraft.of(f)
                baseUpdatedAt = f.raw["updatedAt"]
                _state.update { it.copy(slug = f.slug, storedSchedule = f.schedule, responseCount = f.submissions, draft = d) }
                autosave.start(d, saved = true)
                version = f.version
            } catch (e: ApiError) { _state.update { it.copy(loading = false, error = e.describe(res)) }; return@launch }
        } else if (autosave.baseline == null) {
            val d = FormStudioDraft.blank(res.getString(R.string.fs_what_need))
            _state.update { it.copy(draft = d) }
            autosave.start(d, saved = false)
        }
        // Routing and mapping pick from these, exactly as the web's editor does.
        runCatching { projects.project(projectId).value }.getOrNull()?.let { d ->
            _state.update { s -> s.copy(canEdit = id.znetworks.nexus.feature.projects.ProjectAccess.of(d).canEdit, projectName = d.name, sections = d.taskLists.sortedBy { it.position ?: Int.MAX_VALUE }.map { Named(it.id, it.name) },
                members = d.members.mapNotNull { m -> m.uid.takeIf { it.isNotEmpty() }?.let { StudioMember(it, m.user?.name ?: "—", m.user?.avatar) } }) }
        }
        runCatching { projects.customFields(projectId) }.getOrNull()?.let { l -> _state.update { it.copy(customFields = l) } }
        autosave.stopped = !_state.value.canEdit
        _state.update { it.copy(loading = false) }
    }

    /** One save: PATCH what changed, or create the form (its first save). Bookkeeping happens here, even after the screen left. */
    private suspend fun send(snap: FormStudioDraft, base: FormStudioDraft) {
        if (!_state.value.canEdit || c.sessionStore.current?.userId != owner) return
        val id = _state.value.formId
        if (id != null) {
            val operations = FormCoedit.diff(FormCoedit.document(base), FormCoedit.document(snap))
            if (operations.isEmpty()) { autosave.receive(base, snap, FormCoedit::rebase); return }
            try {
                val batches = operations.chunked(200)
                batches.forEachIndexed { index, ops ->
                    sending = if (index == batches.lastIndex) base to snap else null
                    receive(api.updateOps(id, ops, version.coerceAtLeast(0), tabId), sending)
                }
            } catch (e: ApiError.Http) { if (e.status == 403) readOnly(); throw e }
            finally { sending = null }
            return
        }
        val changes = FormStudioLogic.payload(snap, base, creating = true, untitled = res.getString(R.string.fs_untitled_form))
        val out = api.createForm(JsonObject(changes + ("projectId" to JsonPrimitive(projectId))))
        if (autosave.stopped) {
            // Discarded while it was being created: don't leave it behind.
            runCatching { api.deleteForm(out.id, force = false) }
            return
        }
        _state.update { it.copy(formId = out.id, slug = out.slug, storedSchedule = out.schedule) }
        baseUpdatedAt = out.raw["updatedAt"]
        receive(out, base to snap)
    }

    fun edit(f: (FormStudioDraft) -> FormStudioDraft) {
        if (!_state.value.canEdit || c.sessionStore.current?.userId != owner) return
        _state.update { it.copy(draft = f(it.draft)) }
        autosave.update(_state.value.draft)
    }

    /** By id, never by index: a question can be deleted or moved while its settings are open. */
    fun putField(field: BuilderField) = edit { d -> d.copy(fields = d.fields.map { if (it.id == field.id) field else it }) }

    fun addQuestion(kind: FormQuestionKind): String {
        val q = BuilderField.fresh(kind)
        edit { it.copy(fields = it.fields + q) }
        return q.id
    }

    fun duplicateQuestion(id: String) = edit { d -> FormStudioLogic.duplicate(d.fields, id)?.let { d.copy(fields = it.first) } ?: d }
    fun moveQuestion(id: String, dir: Int) = edit { d -> d.copy(fields = FormStudioLogic.move(d.fields, id, dir)) }

    /** Questions shown only after this one lose that condition; Undo (6 s) puts both back. */
    fun removeQuestion(id: String) {
        val (next, u) = FormStudioLogic.remove(_state.value.draft.fields, id) ?: return
        edit { it.copy(fields = next) }
        _state.update { it.copy(undo = u) }
        undoJob?.cancel()
        undoJob = viewModelScope.launch { delay(6000); _state.update { s -> if (s.undo == u) s.copy(undo = null) else s } }
    }

    fun undoRemove() {
        val u = _state.value.undo ?: return
        edit { it.copy(fields = FormStudioLogic.restore(it.fields, u)) }
        _state.update { it.copy(undo = null) }
    }

    fun retry() = viewModelScope.launch { autosave.flush() }

    fun toast(text: String) {
        _state.update { it.copy(toast = text) }
        toastJob?.cancel()
        toastJob = viewModelScope.launch { delay(1800); _state.update { s -> if (s.toast == text) s.copy(toast = null) else s } }
    }

    /** Preview / Open the form page show the SAVED form, so what was typed is saved first (a new form is created). */
    fun openSaved(then: (String) -> Unit) = viewModelScope.launch {
        autosave.cancelDebounce()
        autosave.awaitIdle()
        autosave.flush(force = true)
        val s = _state.value
        if (s.formId != null && autosave.state.value !is FormSaveState.Failed) then(s.slug ?: s.formId)
    }

    /** The count shown in the dialog is read again first: the builder may have been open for a while. A draft never saved just goes. */
    fun askDelete() = viewModelScope.launch {
        val id = _state.value.formId
        if (id == null) {
            autosave.stopped = true; autosave.cancelDebounce()
            _state.update { it.copy(done = true) }
            return@launch
        }
        runCatching { api.builderForms(projectId).firstOrNull { it.id == id } }.getOrNull()?.let { f -> _state.update { it.copy(responseCount = f.submissions) } }
        _state.update { it.copy(alert = StudioAlert.Delete(it.responseCount)) }
    }

    /** No submissions → a plain delete (a 409 asks again with the count). With submissions → forced with the count seen. */
    fun delete(force: Boolean, expect: Int) {
        val id = _state.value.formId ?: return
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, alert = null) }
            autosave.stopped = true; autosave.cancelDebounce()
            try { api.deleteForm(id, force, expect); _state.update { it.copy(done = true) } }
            catch (e: ApiError) {
                autosave.stopped = false
                val h = e as? ApiError.Http
                val n = (h?.body?.get("submissionCount") as? JsonPrimitive)?.intOrNull
                if (h?.status == 409 && n != null) _state.update { it.copy(responseCount = n, alert = StudioAlert.ForceDelete(n)) }
                else _state.update { it.copy(alert = StudioAlert.Failed(res.getString(R.string.fb_delete_failed), describe(e))) }
            }
            _state.update { it.copy(busy = false) }
        }
    }

    fun dismissAlert() = _state.update { it.copy(alert = null) }

    /** The Responses tab's count, kept on the state (the tab label shows it). */
    fun setResponseCount(n: Int) = _state.update { it.copy(responseCount = n) }

    suspend fun otherProjects(): List<Named> =
        projects.projects().value.filter { it.id != projectId }.map { Named(it.id, it.name) }.sortedBy { it.name.lowercase() }

    /** A copy into another project, with the questions as they are in the editor now (rules out, project links out). */
    fun duplicate(name: String, target: Named) = viewModelScope.launch {
        val s = _state.value
        _state.update { it.copy(busy = true) }
        try {
            api.createForm(FormStudioLogic.duplicatePayload(s.draft, s.storedSchedule, name, "Form", target.id))
            toast(res.getString(R.string.fb_duplicated, target.name))
        } catch (e: ApiError) {
            _state.update { it.copy(alert = StudioAlert.Failed(res.getString(R.string.fb_duplicate), res.getString(R.string.fb_dup_failed, describe(e)))) }
        }
        _state.update { it.copy(busy = false) }
    }

    /** Leaving: what was typed inside the debounce (or during a save still on its way) is saved now instead of dropped. */
    override fun onCleared() {
        autosave.cancelDebounce()
        if (autosave.stopped || !(autosave.dirty || autosave.inflight)) return
        c.appScope.launch(Dispatchers.Main) { autosave.awaitIdle(); autosave.flush() }
    }
}

@Composable
fun FormBuilderScreen(onBack: () -> Unit, onOpenForm: (String) -> Unit, onOpenTask: (String) -> Unit = {}, vm: FormBuilderViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val save by vm.autosave.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var tab by rememberSaveable { mutableStateOf(StudioTab.QUESTIONS) }
    val visibleTab = if (!s.canEdit && tab != StudioTab.RESPONSES) StudioTab.PREVIEW else tab
    var openField by rememberSaveable { mutableStateOf<String?>(null) }
    var duplicating by remember { mutableStateOf(false) }
    var reloadLatest by remember { mutableStateOf(false) }
    LaunchedEffect(s.done) { if (s.done) onBack() }
    RealtimeRoom(s.formId?.takeIf { s.canEdit }?.let { "form:$it" })
    LiveRefresh(s.formId, null, null, { false }) { vm.refreshLive() }
    LaunchedEffect(s.loading, s.canEdit) { if (!s.loading && !s.canEdit) { tab = StudioTab.PREVIEW; openField = null } }
    LaunchedEffect(openField, s.formId, s.canEdit) { vm.focus(openField) }
    BackHandler(onBack = onBack)
    val untitled = stringResource(R.string.fs_untitled_form)
    val displayName = s.draft.name.trim().ifEmpty { untitled }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        // Top bar: back, "Project ›" over the form's name, the save state, Preview, More.
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = c.foreground) }
            Column(Modifier.weight(1f).padding(end = 6.dp)) {
                if (s.projectName.isNotEmpty()) Text(s.projectName + "  ›", fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (s.draft.branding.icon.isEmpty()) displayName else "${s.draft.branding.icon} $displayName", fontFamily = TextFont,
                    fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() })
                if (!s.loading && s.error == null) { if (s.canEdit) FormSaveIndicator(save, s.formId != null, vm::retry) else Text(stringResource(R.string.acc_view_only), color = c.mutedFg, fontSize = 12.sp) }
            }
            if (!s.loading && s.error == null && s.canEdit) {
                HeaderIconButton(Icons.Filled.Visibility, stringResource(R.string.fb_preview), { vm.openSaved(onOpenForm) })
                Spacer(Modifier.width(6.dp))
                if (s.canEdit) MoreMenu(hasId = s.formId != null, busy = s.busy, onOpenPage = { vm.openSaved(onOpenForm) }, onDuplicate = { duplicating = true }, onDelete = vm::askDelete)
            }
        }
        if (!s.loading && s.error == null) {
            if (save is FormSaveState.Failed) Row(Modifier.fillMaxWidth().background(c.warning.copy(alpha = 0.08f)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text((save as FormSaveState.Failed).message, color = c.warningFg, fontSize = 12.sp, modifier = Modifier.weight(1f))
                if (s.conflict) TextButton(onClick = { reloadLatest = true }) { Text(stringResource(R.string.r21_load_latest)) }
            }
            if (s.editors.isNotEmpty() && s.canEdit) FormEditors(s.editors)
            val tabs = if (!s.canEdit) listOf(PageTab(StudioTab.PREVIEW, stringResource(R.string.fb_preview)), PageTab(StudioTab.RESPONSES, stringResource(R.string.fr_title), count = s.responseCount.takeIf { it > 0 })) else listOf(PageTab(StudioTab.QUESTIONS, stringResource(R.string.fs_tab_questions)), PageTab(StudioTab.SETTINGS, stringResource(R.string.fs_tab_settings)),
                PageTab(StudioTab.SHARE, stringResource(R.string.fs_tab_share)),
                PageTab(StudioTab.RESPONSES, stringResource(R.string.fr_title), count = s.responseCount.takeIf { it > 0 }))
            Box(Modifier.padding(horizontal = 16.dp)) { PageTabs(tabs, visibleTab, { tab = it }) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null -> EmptyState(Icons.Outlined.Description, stringResource(R.string.fs_load_failed), s.error.orEmpty(),
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                else -> when (visibleTab) {
                    StudioTab.PREVIEW -> FormReadOnlyPreview(s.draft)
                    StudioTab.QUESTIONS -> QuestionsCanvas(s, vm, onOpenField = { openField = it }, onChangeAccess = { tab = StudioTab.SETTINGS })
                    StudioTab.SETTINGS -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).background(c.muted.copy(alpha = 0.25f))) {
                        FormStudioSettingsTab(s.draft, s.projectName, s.members, s.responseCount, vm::edit)
                    }
                    StudioTab.SHARE -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).background(c.muted.copy(alpha = 0.25f))) {
                        FormStudioShareTab(s.link, s.draft.isPublic, onOpen = { vm.openSaved(onOpenForm) }, onGoSettings = { tab = StudioTab.SETTINGS },
                            onGoQuestions = { tab = StudioTab.QUESTIONS })
                    }
                    StudioTab.RESPONSES -> {
                        val id = s.formId
                        if (id == null) EmptyState(Icons.Outlined.Inbox, stringResource(R.string.fr_empty), stringResource(R.string.fs_no_responses_sub),
                            stringResource(R.string.fs_go_share), { tab = StudioTab.SHARE }, Modifier.fillMaxSize())
                        else FormResponsesList(vm.projectId, id, onOpenTask, emptyActionLabel = stringResource(if (s.canEdit) R.string.fs_go_share else R.string.fb_preview), onEmptyAction = { tab = if (s.canEdit) StudioTab.SHARE else StudioTab.PREVIEW },
                            emptyMessage = stringResource(R.string.fs_no_responses_sub), onCount = vm::setResponseCount)
                    }
                }
            }
            // Bottom: Undo after a question is deleted, or a short confirmation.
            Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 20.dp, start = 16.dp, end = 16.dp)) {
                val u = s.undo
                if (u != null) UndoToast(u, vm::undoRemove) else s.toast?.let { Toast(it) }
            }
        }
    }

    openField?.takeIf { s.canEdit }?.let { id ->
        val i = s.draft.fields.indexOfFirst { it.id == id }
        if (i < 0) openField = null
        else FormQuestionSettings(s.draft.fields[i], i, s.draft.fields.size, s.draft.fields, s.sections, s.members.map { Named(it.id, it.name) }, s.customFields,
            onChange = vm::putField, onMove = { vm.moveQuestion(id, it) }, onDuplicate = { vm.duplicateQuestion(id) },
            onDelete = { openField = null; vm.removeQuestion(id) }, onClose = { openField = null }, editors = s.editors.filter { it.questionId == id })
    }
    s.alert?.let { a -> StudioAlertDialog(a, vm) }
    if (duplicating) DuplicateDialog(s.draft.name, { vm.otherProjects() }, onDismiss = { duplicating = false }) { name, target -> duplicating = false; vm.duplicate(name, target) }
    if (reloadLatest) androidx.compose.material3.AlertDialog(onDismissRequest = { reloadLatest = false },
        title = { Text(stringResource(R.string.r21_load_latest)) }, text = { Text(stringResource(R.string.r21_discard_draft)) },
        confirmButton = { TextButton(onClick = { reloadLatest = false; vm.load() }) { Text(stringResource(R.string.r21_load_latest)) } },
        dismissButton = { TextButton(onClick = { reloadLatest = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun MoreMenu(hasId: Boolean, busy: Boolean, onOpenPage: () -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderIconButton(Icons.Filled.MoreHoriz, stringResource(R.string.fs_more), { open = true })
        DropdownMenu(open, { open = false }) {
            if (hasId) {
                DropdownMenuItem(text = { Text(stringResource(R.string.fs_open_page)) }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, null) },
                    onClick = { open = false; onOpenPage() })
                DropdownMenuItem(text = { Text(stringResource(R.string.fb_duplicate_to)) }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) },
                    onClick = { open = false; onDuplicate() })
                HorizontalDivider(color = c.border)
            }
            DropdownMenuItem(text = { Text(stringResource(if (hasId) R.string.fb_delete_form else R.string.fs_discard_draft), color = c.dangerText) },
                leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = c.dangerText) }, enabled = !busy, onClick = { open = false; onDelete() })
        }
    }
}

/** The page-like canvas: cover, head, one card per question, Add question. */
@Composable
private fun QuestionsCanvas(s: BuilderState, vm: FormBuilderViewModel, onOpenField: (String) -> Unit, onChangeAccess: () -> Unit) {
    val c = Nx.colors
    val d = s.draft
    val sectionNames = s.sections.map { it.name }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        FormCoverBand(d.branding)
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 120.dp)) {
            FormStudioHead(d.name, d.description, d.branding, d.isPublic,
                onName = { v -> vm.edit { it.copy(name = v) } }, onDescription = { v -> vm.edit { it.copy(description = v) } },
                onBranding = { b -> vm.edit { it.copy(branding = b) } }, onChangeAccess = onChangeAccess)
            Column(Modifier.padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                d.fields.forEachIndexed { i, f ->
                    androidx.compose.runtime.key(f.id) {
                        Column {
                        FormQuestionEditors(s.editors.filter { it.questionId == f.id })
                        Box(Modifier.then(s.editors.firstOrNull { it.questionId == f.id }?.let { Modifier.border(1.dp, formEditorColor(it.color), RoundedCornerShape(12.dp)) } ?: Modifier)) {
                        FormQuestionCard(f, i, d.fields.filter { it.id != f.id }, s.customFields, sectionNames,
                            onOpen = { onOpenField(f.id) }, onDuplicate = { vm.duplicateQuestion(f.id) }, onDelete = { vm.removeQuestion(f.id) },
                            onOptions = { opts -> vm.putField(f.copy(options = opts)) })
                        }
                        }
                    }
                }
                if (d.fields.isEmpty()) Text(stringResource(R.string.fs_no_questions), fontSize = 15.sp, color = c.mutedFg)
                Box(Modifier.padding(start = 0.dp)) { AddQuestionMenu { k -> onOpenField(vm.addQuestion(k)) } }
            }
        }
    }
}

@Composable
private fun UndoToast(u: DeletedQuestion, onUndo: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.onyx).padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.fs_question_deleted), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.background)
            if (u.dependents.isNotEmpty()) Text(pluralStringResource(R.plurals.fs_dependents, u.dependents.size, u.dependents.size), fontSize = 12.sp,
                color = c.background.copy(alpha = 0.8f))
        }
        Text(stringResource(R.string.fs_undo), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.background,
            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onUndo).heightIn(min = 36.dp).padding(horizontal = 8.dp, vertical = 8.dp))
    }
}

@Composable
private fun Toast(text: String) {
    val c = Nx.colors
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.background,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(c.onyx).padding(horizontal = 14.dp, vertical = 9.dp))
}

@Composable
private fun StudioAlertDialog(a: StudioAlert, vm: FormBuilderViewModel) {
    val c = Nx.colors
    when (a) {
        is StudioAlert.Delete, is StudioAlert.ForceDelete -> {
            val n = if (a is StudioAlert.Delete) a.submissions else (a as StudioAlert.ForceDelete).submissions
            val lead = if (a is StudioAlert.ForceDelete) stringResource(R.string.fs_new_responses) + " " else ""
            val body = lead + if (n == 0) stringResource(R.string.fs_delete_plain)
                else pluralStringResource(R.plurals.fs_form_has, n, n) + " " + stringResource(R.string.fs_delete_tail)
            AlertDialog(onDismissRequest = vm::dismissAlert, title = { Text(stringResource(R.string.fb_delete_q)) }, text = { Text(body) },
                confirmButton = { TextButton(onClick = { vm.delete(force = n > 0 || a is StudioAlert.ForceDelete, expect = n) }) {
                    Text(stringResource(if (a is StudioAlert.ForceDelete) R.string.fb_delete_anyway else R.string.fb_delete_form), color = c.dangerText) } },
                dismissButton = { TextButton(onClick = vm::dismissAlert) { Text(stringResource(R.string.cancel)) } })
        }
        is StudioAlert.Failed -> AlertDialog(onDismissRequest = vm::dismissAlert, title = { Text(a.title) }, text = { Text(a.message) },
            confirmButton = { TextButton(onClick = vm::dismissAlert) { Text("OK") } })
    }
}

/** Name + another project; the copy takes the questions as they are in the editor now. */
@Composable
private fun DuplicateDialog(name: String, load: suspend () -> List<Named>, onDismiss: () -> Unit, onCopy: (String, Named) -> Unit) {
    val c = Nx.colors
    var n by remember { mutableStateOf(name) }
    var list by remember { mutableStateOf<List<Named>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<Named?>(null) }
    LaunchedEffect(Unit) { try { list = load() } catch (e: ApiError) { failed = true } }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.fb_duplicate)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(n, { n = it }, singleLine = true, label = { Text(stringResource(R.string.fb_new_name)) }, modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.fb_target), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                when {
                    failed -> Text(stringResource(R.string.fb_projects_failed), fontSize = 12.sp, color = c.dangerText)
                    list == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    list!!.isEmpty() -> Text(stringResource(R.string.fb_only_project), fontSize = 12.sp, color = c.mutedFg)
                    else -> Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState())) {
                        list!!.forEach { p ->
                            Row(Modifier.fillMaxWidth().clickable { target = p }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                androidx.compose.material3.RadioButton(target == p, { target = p })
                                // Each project's own mark, as iOS's "Duplicate to another project".
                                id.znetworks.nexus.feature.projects.ProjectMark(null, 22.dp, projectId = p.id); Spacer(Modifier.width(10.dp))
                                Text(p.name, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
                Text(stringResource(R.string.fb_dup_note), fontSize = 11.sp, color = c.mutedFg)
            }
        },
        confirmButton = { TextButton(onClick = { target?.let { onCopy(n, it) } }, enabled = target != null) { Text(stringResource(R.string.fb_duplicate)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}
