package id.znetworks.nexus.feature.forms

import android.app.Application
import android.content.ClipData
import android.content.Intent
import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.time.format.TextStyle
import java.util.Locale

/** One project thing the builder routes to: a section, a member, a custom field, a project. */
data class Named(val id: String, val name: String)

data class BuilderState(
    val loading: Boolean = true,
    val error: String? = null,
    val formId: String? = null,
    val slug: String? = null,
    val submissions: Int = 0,
    val name: String = "",
    val description: String = "",
    val isPublic: Boolean = false,
    val requireAuth: Boolean = false,
    val schedule: BuilderSchedule = BuilderSchedule.of(null),
    /** accessSchedule is sent only once touched (the server ignores null). */
    val scheduleTouched: Boolean = false,
    val fields: List<BuilderField> = emptyList(),
    val snapshot: String = "",
    val busy: Boolean = false,
    val notice: String? = null,
    val sections: List<Named> = emptyList(),
    val members: List<Named> = emptyList(),
    val customFields: List<Named> = emptyList(),
    /** A DELETE refused for its submissions: their count, for the second question. */
    val deleteCount: Int? = null,
    /** Saved an existing form, or deleted it: the screen goes back. */
    val done: Boolean = false,
)

/** The builder's editing (FORM-BUILDER, iOS FormBuilderView). Route: form-builder/{projectId}?form={id}. */
class FormBuilderViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["projectId"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = FormsApi(app, c.api, c.sessionStore)
    private val projects = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(BuilderState(formId = handle.get<String>("form")?.takeIf { it.isNotBlank() }))
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        val id = _state.value.formId
        try {
            if (id != null) {
                val f = api.builderForms(projectId).firstOrNull { it.id == id }
                if (f == null) { _state.update { it.copy(loading = false, error = res.getString(R.string.fb_gone)) }; return@launch }
                fill(f)
            } else _state.update { s -> s.copy(loading = false, fields = listOf(BuilderField.fresh())).let { it.copy(snapshot = body(it).toString()) } }
        } catch (e: ApiError) { _state.update { it.copy(loading = false, error = e.describe(res)) } }
        // Sections and members (routing, task_list mapping) and custom fields (mapping).
        runCatching { projects.project(projectId).value }.getOrNull()?.let { d ->
            _state.update { s -> s.copy(sections = d.taskLists.sortedBy { it.position ?: Int.MAX_VALUE }.map { Named(it.id, it.name) },
                members = d.members.mapNotNull { m -> (m.userId ?: m.user?.id)?.let { Named(it, m.user?.name ?: "—") } }) }
        }
        runCatching { projects.customFields(projectId) }.getOrNull()?.let { l -> _state.update { it.copy(customFields = l.map { f -> Named(f.id, f.name) }) } }
    }

    private fun fill(f: BuilderForm) = _state.update { s ->
        s.copy(loading = false, error = null, formId = f.id, slug = f.slug, submissions = f.submissions, name = f.name, description = f.description.orEmpty(),
            isPublic = f.isPublic, requireAuth = f.requireAuth, schedule = BuilderSchedule.of(f.schedule), scheduleTouched = false,
            fields = f.fields.map(BuilderField::of)).let { it.copy(snapshot = body(it).toString()) }
    }

    /** What is sent: description `|| null`, accessSchedule only once touched (else null on create, absent on edit). */
    private fun body(s: BuilderState, forCreate: Boolean = s.formId == null): JsonObject = JsonObject(buildMap {
        put("name", JsonPrimitive(s.name.trim()))
        put("description", s.description.trim().takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
        put("fields", JsonArray(s.fields.map { it.json() }))
        put("isPublic", JsonPrimitive(s.isPublic)); put("requireAuth", JsonPrimitive(s.requireAuth))
        if (s.scheduleTouched) put("accessSchedule", s.schedule.json()) else if (forCreate) put("accessSchedule", JsonNull)
    })

    val dirty: Boolean get() = _state.value.let { !it.loading && it.error == null && body(it).toString() != it.snapshot }

    fun edit(f: (BuilderState) -> BuilderState) = _state.update(f)
    fun schedule(f: (BuilderSchedule) -> BuilderSchedule) = _state.update { it.copy(schedule = f(it.schedule), scheduleTouched = true) }
    fun putField(i: Int?, field: BuilderField) = _state.update { s -> s.copy(fields = if (i == null || i !in s.fields.indices) s.fields + field else s.fields.toMutableList().also { it[i] = field }) }
    fun removeField(i: Int) = _state.update { s -> s.copy(fields = s.fields.filterIndexed { k, _ -> k != i }) }
    fun moveField(i: Int, by: Int) = _state.update { s ->
        val j = i + by
        if (i !in s.fields.indices || j !in s.fields.indices) s else s.copy(fields = s.fields.toMutableList().also { val t = it[i]; it[i] = it[j]; it[j] = t })
    }
    fun dismiss() = _state.update { it.copy(notice = null) }

    /** Create keeps the screen open on the new form (the link shows); saving an existing one goes back. */
    fun save() {
        val s = _state.value
        if (s.name.isBlank()) { _state.update { it.copy(notice = res.getString(R.string.fb_need_name)) }; return }
        if (s.fields.isEmpty()) { _state.update { it.copy(notice = res.getString(R.string.fb_need_field)) }; return }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                val id = s.formId
                if (id == null) {
                    val created = api.createForm(JsonObject(body(s) + ("projectId" to JsonPrimitive(projectId))))
                    fill(created); _state.update { it.copy(notice = res.getString(R.string.fb_created)) }
                } else { api.updateForm(id, body(s)); _state.update { it.copy(done = true) } }
            } catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.fb_save_failed) + ": " + ((e as? ApiError.Http)?.serverMessage ?: e.describe(res))) } }
            _state.update { it.copy(busy = false) }
        }
    }

    fun delete(force: Boolean) {
        val id = _state.value.formId ?: return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, deleteCount = null) }
            try { api.deleteForm(id, force); _state.update { it.copy(done = true) } }
            catch (e: ApiError) {
                val h = e as? ApiError.Http
                val n = (h?.body?.get("submissionCount") as? JsonPrimitive)?.intOrNull
                if (h?.status == 409 && n != null) _state.update { it.copy(deleteCount = n) }
                else _state.update { it.copy(notice = res.getString(R.string.fb_delete_failed) + ": " + (h?.serverMessage ?: e.describe(res))) }
            }
            _state.update { it.copy(busy = false) }
        }
    }

    suspend fun otherProjects(): List<Named> =
        projects.projects().value.filter { it.id != projectId }.map { Named(it.id, it.name) }.sortedBy { it.name.lowercase() }

    /** A copy into another project, with the fields as they are in the editor now (rules out, mapping target only). */
    fun duplicate(name: String, target: Named) = viewModelScope.launch {
        val s = _state.value
        _state.update { it.copy(busy = true) }
        try {
            api.createForm(JsonObject(mapOf(
                "name" to JsonPrimitive(name.trim()), "description" to (s.description.trim().takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull),
                "fields" to JsonArray(s.fields.map { it.duplicateJson() }), "isPublic" to JsonPrimitive(s.isPublic), "requireAuth" to JsonPrimitive(s.requireAuth),
                "projectId" to JsonPrimitive(target.id), "accessSchedule" to s.schedule.json())))
            _state.update { it.copy(notice = res.getString(R.string.fb_duplicated, target.name)) }
        } catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.fb_dup_failed, (e as? ApiError.Http)?.serverMessage ?: e.describe(res))) } }
        _state.update { it.copy(busy = false) }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun FormBuilderScreen(onBack: () -> Unit, onOpenForm: (String) -> Unit, vm: FormBuilderViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var editing by remember { mutableStateOf<Int?>(null) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var duplicating by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<String?>(null) } // "start" | "end"
    LaunchedEffect(s.done) { if (s.done) onBack() }
    val leave = { if (vm.dirty) confirmDiscard = true else onBack() }
    BackHandler(onBack = leave)
    fun copyLink(link: String) = scope.launch {
        clipboard.setClipEntry(androidx.compose.ui.platform.ClipEntry(ClipData.newPlainText("form", link)))
    }
    fun shareLink(link: String) = runCatching {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = leave) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(if (s.formId == null) R.string.fb_new else R.string.fb_edit), fontFamily = DisplayFont, fontWeight = FontWeight.Bold,
                fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            TextButton(onClick = vm::save, enabled = !s.busy && !s.loading && s.error == null) { Text(stringResource(R.string.save), fontWeight = FontWeight.Bold) }
        }
        when {
            s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.error != null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { Text(s.error!!, color = c.mutedFg) }
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Block(null) {
                    OutlinedTextField(s.name, { v -> vm.edit { it.copy(name = v) } }, singleLine = true, label = { Text(stringResource(R.string.fb_name)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(s.description, { v -> vm.edit { it.copy(description = v) } }, minLines = 2, maxLines = 5,
                        placeholder = { Text(stringResource(R.string.fb_description)) }, modifier = Modifier.fillMaxWidth())
                }
                Block(stringResource(R.string.fb_publishing)) {
                    SwitchRow(stringResource(R.string.fb_public), stringResource(R.string.fb_public_sub), s.isPublic) { v -> vm.edit { it.copy(isPublic = v) } }
                    SwitchRow(stringResource(R.string.fb_require_auth), stringResource(R.string.fb_require_auth_sub), s.requireAuth) { v -> vm.edit { it.copy(requireAuth = v) } }
                    val id = s.formId
                    if (s.isPublic && id == null) Text(stringResource(R.string.fb_link_after_create), fontSize = 12.sp, color = c.mutedFg)
                    if (s.isPublic && id != null) {
                        val link = FormLink.url(s.slug, id)
                        Text(link, fontSize = 13.sp, color = c.violetText, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { copyLink(link); vm.edit { it.copy(notice = context.getString(R.string.fb_link_copied)) } }) {
                                Icon(Icons.Filled.ContentCopy, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.fb_copy_link)) }
                            OutlinedButton(onClick = { shareLink(link) }) { Icon(Icons.Filled.Share, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.fb_share)) }
                        }
                    }
                }
                Block(stringResource(R.string.fb_availability)) {
                    Text(stringResource(R.string.fb_status), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("" to R.string.fb_auto, "open" to R.string.fb_force_open, "closed" to R.string.fb_force_closed).forEach { (v, l) ->
                            FilterChip(s.schedule.override == v, { vm.schedule { it.copy(override = v) } }, { Text(stringResource(l)) })
                        }
                    }
                    Text(stringResource(when {
                        s.schedule.override == "open" -> if (s.schedule.enabled) R.string.fb_forced_open_sched else R.string.fb_forced_open
                        s.schedule.override == "closed" -> if (s.schedule.enabled) R.string.fb_forced_closed_sched else R.string.fb_forced_closed
                        s.schedule.enabled -> R.string.fb_by_schedule
                        else -> R.string.fb_always
                    }), fontSize = 12.sp, color = c.mutedFg)
                    SwitchRow(stringResource(R.string.fb_limit), null, s.schedule.enabled) { v -> vm.schedule { it.switched(v) } }
                    if (s.schedule.enabled) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FormVocab.DAYS.forEachIndexed { i, d ->
                                FilterChip(i in s.schedule.days, { vm.schedule { sc -> sc.copy(days = if (i in sc.days) sc.days - i else (sc.days + i).sorted()) } },
                                    { Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault())) })
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.fb_opens), fontSize = 13.sp, color = c.mutedFg); OutlinedButton(onClick = { picking = "start" }) { Text(s.schedule.start) }
                            Text(stringResource(R.string.fb_closes), fontSize = 13.sp, color = c.mutedFg); OutlinedButton(onClick = { picking = "end" }) { Text(s.schedule.end) }
                        }
                        Text(stringResource(R.string.fb_timezone) + " · " + s.schedule.timezone, fontSize = 12.sp, color = c.mutedFg)
                    }
                }
                Block(stringResource(R.string.fb_fields_n, s.fields.size)) {
                    s.fields.forEachIndexed { i, f ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { editing = i }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text((f.displayName.ifEmpty { stringResource(R.string.fb_untitled) }) + if (f.required) " *" else "", fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(listOfNotNull(FormVocab.TYPES.firstOrNull { it.first == f.type }?.let { stringResource(it.second) } ?: f.type,
                                    f.showIf?.let { stringResource(R.string.fb_conditional) },
                                    f.rules.takeIf { it.isNotEmpty() }?.let { pluralStringResource(R.plurals.fb_rules_n, it.size, it.size) },
                                    f.mappingTarget.takeIf { it != "none" }?.let { t -> FormVocab.MAPPING.firstOrNull { it.first == t }?.let { stringResource(it.second) } })
                                    .joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                            }
                            IconButton(onClick = { vm.moveField(i, -1) }, enabled = i > 0) { Icon(Icons.Filled.KeyboardArrowUp, null) }
                            IconButton(onClick = { vm.moveField(i, 1) }, enabled = i < s.fields.size - 1) { Icon(Icons.Filled.KeyboardArrowDown, null) }
                            IconButton(onClick = { vm.removeField(i) }) { Icon(Icons.Filled.Delete, stringResource(R.string.fb_delete_field), tint = c.dangerText) }
                        }
                        if (i < s.fields.size - 1) HorizontalDivider(color = c.border.copy(alpha = 0.5f))
                    }
                    OutlinedButton(onClick = { vm.putField(null, BuilderField.fresh()); editing = s.fields.size }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.fb_add_field)) }
                }
                val id = s.formId
                if (id != null) Block(stringResource(R.string.fb_manage)) {
                    Text(pluralStringResource(R.plurals.fb_submissions_n, s.submissions, s.submissions), fontSize = 13.sp, color = c.foreground)
                    TextButton(onClick = { onOpenForm(s.slug ?: id) }) { Text(stringResource(R.string.fb_open_form)) }
                    TextButton(onClick = { duplicating = true }) { Text(stringResource(R.string.fb_duplicate_to)) }
                    TextButton(onClick = { confirmDelete = true }) { Text(stringResource(R.string.fb_delete_form), color = c.dangerText) }
                    Text(stringResource(R.string.fb_manage_note), fontSize = 11.sp, color = c.mutedFg)
                }
            }
        }
    }

    editing?.let { i ->
        val f = s.fields.getOrNull(i)
        if (f == null) editing = null
        else FieldEditor(f, others = s.fields.filterIndexed { k, _ -> k != i }, sections = s.sections, members = s.members, customFields = s.customFields,
            onDone = { vm.putField(i, it); editing = null }, onDelete = { vm.removeField(i); editing = null })
    }
    picking?.let { which ->
        val cur = if (which == "start") s.schedule.start else s.schedule.end
        val st = rememberTimePickerState(cur.substringBefore(':').toInt(), cur.substringAfter(':').toInt(), is24Hour = true)
        AlertDialog(onDismissRequest = { picking = null }, text = { TimePicker(st) }, confirmButton = {
            TextButton(onClick = { val v = "%02d:%02d".format(st.hour, st.minute); vm.schedule { if (which == "start") it.copy(start = v) else it.copy(end = v) }; picking = null }) { Text("OK") }
        }, dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } })
    }
    s.notice?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
    if (confirmDiscard) AlertDialog(onDismissRequest = { confirmDiscard = false }, title = { Text(stringResource(R.string.fb_discard_q)) },
        text = { Text(stringResource(R.string.fb_discard_body)) },
        confirmButton = { TextButton(onClick = { confirmDiscard = false; onBack() }) { Text(stringResource(R.string.fb_discard), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text(stringResource(R.string.fb_keep_editing)) } })
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.fb_delete_q)) },
        text = { Text(stringResource(R.string.fb_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(false) }) { Text(stringResource(R.string.fb_delete_form), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
    s.deleteCount?.let { n ->
        AlertDialog(onDismissRequest = { vm.edit { it.copy(deleteCount = null) } }, title = { Text(stringResource(R.string.fb_has_submissions)) },
            text = { Text(pluralStringResource(R.plurals.fb_delete_count, n, n)) },
            confirmButton = { TextButton(onClick = { vm.delete(true) }) { Text(stringResource(R.string.fb_delete_anyway), color = c.dangerText) } },
            dismissButton = { TextButton(onClick = { vm.edit { it.copy(deleteCount = null) } }) { Text(stringResource(R.string.cancel)) } })
    }
    if (duplicating) DuplicateDialog(s.name, { vm.otherProjects() }, onDismiss = { duplicating = false }) { name, target -> duplicating = false; vm.duplicate(name, target) }
}

@Composable
private fun Block(title: String?, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        title?.let { Text(it.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg) }
        content()
    }
}

@Composable
private fun SwitchRow(title: String, sub: String?, on: Boolean, onChange: (Boolean) -> Unit) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            sub?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
        }
        Switch(on, onChange)
    }
}

/** A labelled pick from a short list (a dropdown under an outlined button). */
@Composable
private fun <T> Pick(value: String, options: List<Pair<T, String>>, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis); Icon(Icons.Filled.KeyboardArrowDown, null) }
        DropdownMenu(open, { open = false }) { options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { open = false; onPick(v) }) } }
    }
}

/** Name + another project; the copy takes the fields as they are in the editor now. */
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
                                androidx.compose.material3.RadioButton(target == p, { target = p }); Text(p.name, fontSize = 14.sp, color = c.foreground)
                            }
                        }
                    }
                }
                Text(stringResource(R.string.fb_dup_note), fontSize = 11.sp, color = c.mutedFg)
            }
        },
        confirmButton = { TextButton(onClick = { target?.let { onCopy(n, it) } }, enabled = n.isNotBlank() && target != null) { Text(stringResource(R.string.fb_duplicate)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/**
 * One field, full screen: name, type, required, attachment, auto-fill, number format, options, "Only show
 * this field if…", routing rules, "Map answer to", a drawn preview, Delete. Changes stay in the form until
 * the form is saved.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FieldEditor(field: BuilderField, others: List<BuilderField>, sections: List<Named>, members: List<Named>, customFields: List<Named>,
                        onDone: (BuilderField) -> Unit, onDelete: () -> Unit) {
    val c = Nx.colors
    var f by remember(field.id) { mutableStateOf(field) }
    Dialog(onDismissRequest = { onDone(f) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onDone(f) }) { Icon(Icons.Filled.Close, stringResource(R.string.close)) }
                Text(f.displayName.ifEmpty { stringResource(R.string.fb_untitled) }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp,
                    color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                TextButton(onClick = { onDone(f) }) { Text(stringResource(R.string.fb_done), fontWeight = FontWeight.Bold) }
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.fb_kept_note), fontSize = 11.sp, color = c.mutedFg)
                Block(null) {
                    OutlinedTextField(f.name, { f = f.named(it) }, singleLine = true, label = { Text(stringResource(R.string.fb_field_name)) },
                        placeholder = { Text(stringResource(R.string.fb_field_hint)) }, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.fb_type), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                        Pick(FormVocab.TYPES.firstOrNull { it.first == f.type }?.let { stringResource(it.second) } ?: f.type,
                            FormVocab.TYPES.map { it.first to stringResource(it.second) }) { t -> f = f.copy(type = t) }
                    }
                    SwitchRow(stringResource(R.string.fb_required), null, f.required) { f = f.copy(required = it) }
                    if (f.type != "file") SwitchRow(stringResource(R.string.fb_attachment), stringResource(R.string.fb_attachment_sub), f.attachmentEnabled) { f = f.copy(attachmentEnabled = it) }
                    if (f.type == "text" || f.type == "email") {
                        Text(stringResource(R.string.fb_autofill), fontSize = 13.sp, color = c.mutedFg)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("" to R.string.fb_none, "name" to R.string.fb_user_name, "email" to R.string.fb_user_email).forEach { (v, l) ->
                                FilterChip(f.autofill == v, { f = f.copy(autofill = v) }, { Text(stringResource(l)) })
                            }
                        }
                        Text(stringResource(R.string.fb_autofill_sub), fontSize = 11.sp, color = c.mutedFg)
                    }
                    if (f.type == "number") {
                        Text(stringResource(R.string.fb_number_format), fontSize = 13.sp, color = c.mutedFg)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("" to R.string.fb_plain, "currency-idr" to R.string.fb_rupiah).forEach { (v, l) -> FilterChip(f.numberFormat == v, { f = f.copy(numberFormat = v) }, { Text(stringResource(l)) }) }
                        }
                    }
                }
                if (f.hasOptions) Block(stringResource(R.string.fb_options)) {
                    f.options.forEachIndexed { k, o ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(o, { v -> f = f.copy(options = f.options.toMutableList().also { it[k] = v }) }, singleLine = true,
                                placeholder = { Text(stringResource(R.string.fb_option_n, k + 1)) }, modifier = Modifier.weight(1f))
                            IconButton(onClick = { f = f.copy(options = f.options.toMutableList().also { val t = it[k]; it[k] = it[k - 1]; it[k - 1] = t }) }, enabled = k > 0) { Icon(Icons.Filled.KeyboardArrowUp, null) }
                            IconButton(onClick = { f = f.copy(options = f.options.filterIndexed { j, _ -> j != k }) }) { Icon(Icons.Filled.Delete, null, tint = c.dangerText) }
                        }
                    }
                    TextButton(onClick = { f = f.copy(options = f.options + "") }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.fb_add_option)) }
                    if (f.mappingTarget == "task_list" && sections.isNotEmpty())
                        TextButton(onClick = { f = f.copy(options = sections.map { it.name }) }) { Text(stringResource(R.string.fb_use_sections, sections.size)) }
                    Text(stringResource(R.string.fb_blank_dropped), fontSize = 11.sp, color = c.mutedFg)
                }
                Block(stringResource(R.string.fb_branching)) {
                    SwitchRow(stringResource(R.string.fb_show_if), stringResource(R.string.fb_show_if_sub), f.showIf != null) { on ->
                        f = f.copy(showIf = if (on) BuilderCondition(others.firstOrNull()?.id.orEmpty(), "equals", "") else null)
                    }
                    f.showIf?.let { cond ->
                        if (others.isEmpty()) Text(stringResource(R.string.fb_no_other_fields), fontSize = 12.sp, color = c.mutedFg)
                        else {
                            val parent = others.firstOrNull { it.id == cond.fieldId }
                            Pick(parent?.displayName?.ifEmpty { null } ?: stringResource(R.string.fb_choose_field),
                                others.map { it.id to (it.displayName.ifEmpty { "—" }) }) { id -> f = f.copy(showIf = cond.copy(fieldId = id, value = "")) }
                            Pick(stringResource(FormVocab.OPERATORS.first { it.first == cond.op }.second), FormVocab.OPERATORS.map { it.first to stringResource(it.second) }) { op ->
                                f = f.copy(showIf = cond.copy(op = op, value = if (FormVocab.needsValue(op)) cond.value else ""))
                            }
                            if (FormVocab.needsValue(cond.op)) {
                                if (parent?.hasOptions == true && parent.options.isNotEmpty())
                                    Pick(cond.value.ifEmpty { stringResource(R.string.fb_choose_option) }, parent.options.map { it to it }) { v -> f = f.copy(showIf = cond.copy(value = v)) }
                                else OutlinedTextField(cond.value, { v -> f = f.copy(showIf = cond.copy(value = v)) }, singleLine = true,
                                    label = { Text(stringResource(R.string.fb_value)) }, modifier = Modifier.fillMaxWidth())
                            }
                        }
                    }
                }
                Block(stringResource(R.string.fb_routing)) {
                    Text(stringResource(R.string.fb_routing_sub), fontSize = 11.sp, color = c.mutedFg)
                    if (f.rules.isEmpty()) Text(stringResource(R.string.fb_no_rules), fontSize = 12.sp, color = c.mutedFg)
                    f.rules.forEachIndexed { k, r ->
                        fun put(nr: BuilderRule) { f = f.copy(rules = f.rules.toMutableList().also { it[k] = nr }) }
                        Column(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.4f), RoundedCornerShape(10.dp)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.fb_rule_n, k + 1), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.weight(1f))
                                IconButton(onClick = { f = f.copy(rules = f.rules.filterIndexed { j, _ -> j != k }) }) { Icon(Icons.Filled.Delete, stringResource(R.string.fb_delete_rule), tint = c.dangerText) }
                            }
                            Text(stringResource(R.string.fb_if_answer), fontSize = 12.sp, color = c.mutedFg)
                            Pick(stringResource(FormVocab.OPERATORS.firstOrNull { it.first == r.op }?.second ?: R.string.fb_op_equals), FormVocab.OPERATORS.map { it.first to stringResource(it.second) }) { op ->
                                put(r.copy(op = op, value = if (FormVocab.needsValue(op)) r.value else "")) }
                            if (FormVocab.needsValue(r.op)) {
                                if (f.hasOptions && f.options.any { it.isNotBlank() }) Pick(r.value.ifEmpty { stringResource(R.string.fb_choose_option) }, f.options.filter { it.isNotBlank() }.map { it to it }) { put(r.copy(value = it)) }
                                else OutlinedTextField(r.value, { put(r.copy(value = it)) }, singleLine = true, label = { Text(stringResource(R.string.fb_value)) }, modifier = Modifier.fillMaxWidth())
                            }
                            Text(stringResource(R.string.fb_then), fontSize = 12.sp, color = c.mutedFg)
                            Pick(stringResource(FormVocab.ACTIONS.firstOrNull { it.first == r.action }?.second ?: R.string.fb_act_assign), FormVocab.ACTIONS.map { it.first to stringResource(it.second) }) { put(r.copy(action = it)) }
                            if (r.action == "set_task_list") Pick(sections.firstOrNull { it.id == r.targetTaskListId }?.name
                                ?: if (r.targetTaskListId.isNotEmpty()) stringResource(R.string.fb_gone_section) else stringResource(R.string.fb_choose_section),
                                sections.map { it.id to it.name }) { put(r.copy(targetTaskListId = it)) }
                            else Pick(members.firstOrNull { it.id == r.targetUserId }?.name
                                ?: if (r.targetUserId.isNotEmpty()) stringResource(R.string.fb_gone_member) else stringResource(R.string.fb_choose_member),
                                members.map { it.id to it.name }) { put(r.copy(targetUserId = it)) }
                        }
                    }
                    TextButton(onClick = { f = f.copy(rules = f.rules + BuilderRule.fresh()) }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.fb_add_rule)) }
                }
                Block(stringResource(R.string.fb_mapping)) {
                    Pick(stringResource(FormVocab.MAPPING.firstOrNull { it.first == f.mappingTarget }?.second ?: R.string.fb_map_none), FormVocab.MAPPING.map { it.first to stringResource(it.second) }) { t ->
                        f = f.copy(mappingTarget = t, mappingCustomFieldId = if (t == "custom_field") f.mappingCustomFieldId else "") }
                    when (f.mappingTarget) {
                        "custom_field" -> {
                            Pick(customFields.firstOrNull { it.id == f.mappingCustomFieldId }?.name
                                ?: if (f.mappingCustomFieldId.isNotEmpty()) stringResource(R.string.fb_gone_custom) else stringResource(R.string.fb_choose_custom),
                                customFields.map { it.id to it.name }) { f = f.copy(mappingCustomFieldId = it) }
                            Text(stringResource(R.string.fb_map_custom_sub), fontSize = 11.sp, color = c.mutedFg)
                        }
                        "task_list" -> {
                            Text(stringResource(R.string.fb_map_list_sub), fontSize = 11.sp, color = c.mutedFg)
                            if (sections.isEmpty()) Text(stringResource(R.string.fb_no_sections), fontSize = 11.sp, color = c.warning)
                            else Text(stringResource(R.string.fb_sections) + ": " + sections.joinToString(", ") { it.name }, fontSize = 12.sp, color = c.foreground)
                        }
                        "none" -> Text(stringResource(R.string.fb_map_none_sub), fontSize = 11.sp, color = c.mutedFg)
                        else -> Text(stringResource(R.string.fb_map_field_sub), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
                Block(stringResource(R.string.fb_preview)) { FieldPreview(f) }
                TextButton(onClick = onDelete) { Icon(Icons.Filled.Delete, null, tint = c.dangerText); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.fb_delete_field), color = c.dangerText) }
            }
        }
    }
}

/** How the field will look to whoever fills it in (drawn, not interactive). */
@Composable
private fun FieldPreview(f: BuilderField) {
    val c = Nx.colors
    Text((f.displayName.ifEmpty { stringResource(R.string.fb_untitled) }) + if (f.required) " *" else "", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
    val box = Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp)
    when (f.type) {
        "checkbox" -> Row(verticalAlignment = Alignment.CenterVertically) { androidx.compose.material3.Checkbox(false, null, enabled = false); Text(f.displayName, fontSize = 13.sp, color = c.mutedFg) }
        "dropdown", "multi_select" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            f.options.filter { it.isNotBlank() }.ifEmpty { listOf(stringResource(R.string.fb_choose_option)) }.forEach { Text("○ $it", fontSize = 13.sp, color = c.mutedFg) }
        }
        "file" -> Text(stringResource(R.string.fb_choose_file), fontSize = 13.sp, color = c.mutedFg, modifier = box)
        "date" -> Text(stringResource(R.string.fb_pick_date), fontSize = 13.sp, color = c.mutedFg, modifier = box)
        "textarea" -> Text(stringResource(R.string.fb_long_answer), fontSize = 13.sp, color = c.mutedFg, modifier = box.heightIn(min = 72.dp))
        else -> Text(when {
            f.autofill.isNotEmpty() -> stringResource(R.string.fb_filled_from_account)
            f.type == "number" && f.numberFormat == "currency-idr" -> "Rp 9.240.943"
            f.type == "number" -> "9240943"
            else -> stringResource(R.string.fb_short_answer)
        }, fontSize = 13.sp, color = c.mutedFg, modifier = box)
    }
}
