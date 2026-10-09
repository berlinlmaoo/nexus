package id.znetworks.nexus.feature.projects

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.Search
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.imePadding
import androidx.compose.ui.focus.focusRequester
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class ProjectSettingsState(
    val detail: ProjectDetail? = null,
    val fields: List<CustomFieldDef> = emptyList(),
    val roster: List<RosterMember> = emptyList(),
    val isBoD: Boolean = false,
    /** Workspace role known yet, and Manager or above (tabs; PROJECT-TYPES-TABS). */
    val roleKnown: Boolean = false,
    val isManager: Boolean = false,
    /** The hidden tabs as just switched, ahead of the server's answer; null = the project's own. */
    val hiddenDraft: Set<String>? = null,
    val busy: Boolean = false,
    val toast: String? = null,
    val error: String? = null,
    val deleted: Boolean = false,
    val duplicatedId: String? = null,
)

class ProjectSettingsViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = ProjectsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(ProjectSettingsState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        val d = async { runCatching { api.project(projectId).value }.getOrNull() }
        val f = async { runCatching { api.customFields(projectId) }.getOrNull() }
        val r = async { runCatching { api.roster() }.getOrNull() }
        c.viewer.load()
        _state.update {
            it.copy(detail = d.await() ?: it.detail, fields = f.await() ?: it.fields, roster = r.await()?.members ?: it.roster, isBoD = c.viewer.isBoD,
                roleKnown = c.viewer.role != null, isManager = c.viewer.canAdminister)
        }
    }

    fun dismiss() = _state.update { it.copy(toast = null, error = null) }
    fun say(msg: Int) = _state.update { it.copy(toast = res.getString(msg)) }

    private fun act(done: Int? = null, block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            block()
            _state.update { it.copy(toast = done?.let(res::getString)) }
        } catch (e: ApiError) {
            // LEAD / BoD refusals come with their own sentence.
            _state.update { it.copy(error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) }
        }
        _state.update { it.copy(busy = false) }
        load()
    }

    fun save(vararg fields: Pair<String, JsonElement>) = act(R.string.ps_saved) { api.updateProject(projectId, JsonObject(fields.toMap())) }

    /** One tab on or off: the WHOLE hidden set goes up; the switch moves at once and goes back on any error. */
    fun setTab(key: String, show: Boolean) {
        val now = _state.value.hiddenDraft ?: ProjectTabsLogic.hidden(_state.value.detail?.hiddenTabs)
        val next = ProjectTabsLogic.toggle(now, key, show)
        _state.update { it.copy(hiddenDraft = next.toSet()) }
        viewModelScope.launch {
            try {
                val reply = api.updateProject(projectId, JsonObject(mapOf("hiddenTabs" to JsonArray(next.map { JsonPrimitive(it) }))))
                _state.update { it.copy(hiddenDraft = null, detail = it.detail?.copy(hiddenTabs = reply["hiddenTabs"] ?: JsonArray(next.map { k -> JsonPrimitive(k) }))) }
            } catch (e: ApiError) {
                val h = e as? ApiError.Http
                _state.update { it.copy(hiddenDraft = null, error = when {
                    h?.code == "TASK_VIEW_REQUIRED" -> res.getString(R.string.ps_tabs_board_or_list)
                    h?.status == 403 -> res.getString(R.string.ps_tabs_managers)
                    else -> h?.serverMessage ?: e.describe(res)
                }) }
            }
        }
    }

    fun createField(name: String, type: String, options: List<String>) = act(R.string.ps_saved) { api.createField(projectId, name, type, options) }
    fun deleteField(id: String) = act { api.deleteField(id) }
    /** Everyone picked in one request; a refusal stays in the picker ([onDone] gets its sentence), success says how many. */
    fun addMembers(ids: Set<String>, onDone: (String?) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            val n = api.addMembers(projectId, ids)
            id.znetworks.nexus.feature.pipeline.PipelineViewModel.membersChanged() // BD / PM pickers read them again
            _state.update { it.copy(busy = false, toast = if (n > 0) res.getQuantityString(R.plurals.ps_n_added, n, n) else res.getString(R.string.ps_already_in)) }
            onDone(null); load()
        } catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(busy = false) }
            onDone(when { h?.status == 403 -> res.getString(R.string.ps_only_managers_add); else -> h?.serverMessage ?: res.getString(R.string.ps_add_failed) })
        }
    }
    fun removeMember(userId: String) = act { api.removeMember(projectId, userId) }
    fun invite(email: String, role: String) = act(R.string.ps_invite_sent) { api.invite(projectId, email, role) }
    fun duplicate() = act(R.string.ps_duplicated) { val id = api.duplicateProject(projectId); _state.update { it.copy(duplicatedId = id.ifBlank { null }) } }
    fun delete() = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try { api.deleteProject(projectId); _state.update { it.copy(deleted = true) } }
        catch (e: ApiError) { _state.update { it.copy(busy = false, error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) } }
    }
}

private val FIELD_TYPES = listOf("TEXT" to R.string.ps_ft_text, "SELECT" to R.string.ps_ft_select, "MULTI_SELECT" to R.string.ps_ft_multi,
    "STATUS" to R.string.ps_ft_status, "NUMBER" to R.string.ps_ft_number, "DATE" to R.string.ps_ft_date, "PLACE" to R.string.ps_ft_place)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectSettingsScreen(onBack: () -> Unit, onDeleted: () -> Unit, onOpenProject: (String) -> Unit, vm: ProjectSettingsViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    LaunchedEffect(s.deleted) { if (s.deleted) onDeleted() }
    LaunchedEffect(s.duplicatedId) { s.duplicatedId?.let(onOpenProject) }
    var confirmDelete by remember { mutableStateOf(false) }
    var addingField by remember { mutableStateOf(false) }
    var addingPeople by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.ps_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
        }
        val d = s.detail
        if (d == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Identity
            Section(stringResource(R.string.ps_identity)) {
                var name by rememberSaveable(d.name) { mutableStateOf(d.name) }
                var desc by rememberSaveable(d.description) { mutableStateOf(d.description.orEmpty()) }
                var color by rememberSaveable(d.color) { mutableStateOf(d.color ?: PROJECT_COLORS.first()) }
                var icon by rememberSaveable(d.icon) { mutableStateOf(d.icon ?: PROJECT_ICONS.first()) }
                OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.ps_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(desc, { desc = it }, label = { Text(stringResource(R.string.ps_description)) }, maxLines = 4, modifier = Modifier.fillMaxWidth())
                // An uploaded image icon stays unless an emoji is picked.
                EmojiRow(PROJECT_ICONS, icon) { icon = it }
                ColorRow(color) { color = it }
                val dirty = name.trim() != d.name || desc.trim() != d.description.orEmpty() || color != (d.color ?: PROJECT_COLORS.first()) || icon != (d.icon ?: PROJECT_ICONS.first())
                OutlinedButton(onClick = {
                    vm.save("name" to JsonPrimitive(name.trim()), "description" to JsonPrimitive(desc.trim()), "color" to JsonPrimitive(color), "icon" to JsonPrimitive(icon))
                }, enabled = dirty && name.isNotBlank() && !s.busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.ps_save_identity)) }
            }
            // Flags
            Section(stringResource(R.string.ps_customize)) {
                Flag(stringResource(R.string.ps_batch_dup), stringResource(R.string.ps_batch_dup_sub), d.enableTaskBatchDuplicate == true) {
                    vm.save("enableTaskBatchDuplicate" to JsonPrimitive(it))
                }
                Flag(stringResource(R.string.ps_proof), stringResource(R.string.ps_proof_sub), d.requireAttachmentForDone == true) {
                    vm.save("requireAttachmentForDone" to JsonPrimitive(it))
                }
                // Turning P&L on needs BoD+ on the server too.
                if (s.isBoD) Flag("P&L Dashboard", stringResource(R.string.ps_pnl_sub), d.enablePnlDashboard == true) {
                    vm.save("enablePnlDashboard" to JsonPrimitive(it))
                }
                // Finance is opt-in now, like P&L (9 Oct): BoD+ only; off only hides the tab.
                if (s.isBoD) Flag("Finance", stringResource(R.string.ps_finance_sub), ProjectTabsLogic.financeOn(d.financeEnabled, d.name)) {
                    vm.save("financeEnabled" to JsonPrimitive(it))
                }
                var autoIds by remember(d.autoAssignAssigneeIds) { mutableStateOf(d.autoAssignAssigneeIds.toSet()) }
                Flag("Auto assign", stringResource(R.string.ps_auto_sub), d.autoAssignEnabled == true) { on ->
                    if (on && autoIds.isEmpty()) vm.say(R.string.ps_auto_pick_first) else vm.save("autoAssignEnabled" to JsonPrimitive(on), "autoAssignAssigneeIds" to JsonArray(autoIds.map { JsonPrimitive(it) }))
                }
                Text(stringResource(R.string.ps_auto_to), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    d.members.forEach { m ->
                        val uid = m.userId ?: m.user?.id ?: return@forEach
                        FilterChip(uid in autoIds, {
                            autoIds = if (uid in autoIds) autoIds - uid else autoIds + uid
                            if (d.autoAssignEnabled == true && autoIds.isNotEmpty()) vm.save("autoAssignAssigneeIds" to JsonArray(autoIds.map { JsonPrimitive(it) }))
                        }, { Text(m.user?.name ?: "—", fontSize = 12.sp) })
                    }
                }
                if (autoIds.isEmpty()) Text(stringResource(R.string.ps_auto_pick_first), fontSize = 11.sp, color = c.mutedFg)
            }
            // Tabs: which ones this project shows (hiding deletes nothing).
            // A Pipeline Dashboard has no task tabs to choose (as the web's Tune).
            if (d.type != "PIPELINE") Section(stringResource(R.string.ps_tabs)) {
                Text(stringResource(R.string.ps_tabs_sub), fontSize = 12.sp, color = c.mutedFg)
                val hidden = s.hiddenDraft ?: ProjectTabsLogic.hidden(d.hiddenTabs)
                val canChange = s.isManager
                ProjectTab.entries.forEach { t ->
                    val key = ProjectTabsLogic.key(t) ?: return@forEach
                    val locked = ProjectTabsLogic.locked(key, hidden)
                    Flag(stringResource(t.label), if (locked) stringResource(R.string.ps_tabs_board_or_list) else "", key !in hidden,
                        enabled = canChange && !locked && !s.busy) { vm.setTab(key, it) }
                }
                if (s.roleKnown && !canChange) Text(stringResource(R.string.ps_tabs_managers), fontSize = 11.sp, color = c.mutedFg)
            }
            // Custom fields
            Section(stringResource(R.string.ps_fields), action = { TextButton(onClick = { addingField = true }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.add)) } }) {
                if (s.fields.isEmpty()) Text(stringResource(R.string.ps_no_fields), fontSize = 12.sp, color = c.mutedFg)
                s.fields.forEach { f ->
                    var confirm by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(f.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text(listOfNotNull(FIELD_TYPES.firstOrNull { it.first == f.kind }?.let { stringResource(it.second) } ?: f.kind,
                                f.choices.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        IconButton(onClick = { confirm = true }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), tint = c.mutedFg) }
                    }
                    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.ps_delete_field_q, f.name)) },
                        text = { Text(stringResource(R.string.ps_delete_field_body)) },
                        confirmButton = { TextButton(onClick = { confirm = false; vm.deleteField(f.id) }) { Text(stringResource(R.string.delete), color = c.danger) } },
                        dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
                }
            }
            // Members
            Section(stringResource(R.string.ps_members)) {
                d.members.forEach { m ->
                    val uid = m.userId ?: m.user?.id
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.user?.name, m.user?.avatar, 30.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(m.user?.name ?: "—", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            m.role?.let { Text(it.lowercase().replaceFirstChar(Char::titlecase), fontSize = 11.sp, color = c.mutedFg) }
                        }
                        if (uid != null && m.role != "LEAD") IconButton(onClick = { vm.removeMember(uid) }) { Icon(Icons.Filled.Close, stringResource(R.string.ps_remove), tint = c.mutedFg) }
                    }
                }
                Row {
                    TextButton(onClick = { addingPeople = true }) { Icon(Icons.Filled.PersonAdd, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_add_member)) }
                    TextButton(onClick = { inviting = true }) { Icon(Icons.Filled.Email, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_invite)) }
                }
            }
            // Danger
            Section(stringResource(R.string.ps_danger)) {
                if (s.isBoD) OutlinedButton(onClick = vm::duplicate, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.ContentCopy, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_duplicate))
                }
                OutlinedButton(onClick = { confirmDelete = true }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Delete, null, Modifier.size(16.dp), tint = c.danger); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_delete), color = c.danger)
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.ps_delete_q, s.detail?.name.orEmpty())) },
        text = { Text(stringResource(R.string.ps_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete() }) { Text(stringResource(R.string.ps_delete_forever), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
    if (addingField) FieldEditorDialog(onDismiss = { addingField = false }) { n, t, o -> addingField = false; vm.createField(n, t, o) }
    if (addingPeople) AddPeopleDialog(s, onDismiss = { addingPeople = false }) { ids, done -> vm.addMembers(ids) { err -> done(err); if (err == null) addingPeople = false } }
    if (inviting) InviteDialog(onDismiss = { inviting = false }) { e, r -> inviting = false; vm.invite(e, r) }
    (s.error ?: s.toast)?.let { msg ->
        AlertDialog(onDismissRequest = vm::dismiss, text = { Text(msg) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } })
    }
}

@Composable
private fun Section(title: String, action: @Composable () -> Unit = {}, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, modifier = Modifier.weight(1f))
            action()
        }
        content()
    }
}

@Composable
private fun Flag(title: String, sub: String, on: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            if (sub.isNotEmpty()) Text(sub, fontSize = 11.sp, color = c.mutedFg)
        }
        Switch(on, onChange, enabled = enabled)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FieldEditorDialog(onDismiss: () -> Unit, onCreate: (String, String, List<String>) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("SELECT") }
    var options by remember { mutableStateOf(listOf<String>()) }
    var draft by rememberSaveable { mutableStateOf("") }
    val needsOptions = type in setOf("SELECT", "MULTI_SELECT", "STATUS")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.ps_new_field)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.ps_field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FIELD_TYPES.forEach { (k, l) -> FilterChip(type == k, { type = k }, { Text(stringResource(l), fontSize = 12.sp) }) }
                }
                if (needsOptions) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        options.forEach { o -> FilterChip(true, { options = options - o }, { Text("$o ✕", fontSize = 12.sp) }) }
                    }
                    OutlinedTextField(draft, { draft = it }, singleLine = true, placeholder = { Text(stringResource(R.string.ps_add_option)) },
                        trailingIcon = { IconButton(onClick = { if (draft.isNotBlank() && draft.trim() !in options) options = options + draft.trim(); draft = "" }) { Icon(Icons.Filled.Add, null) } },
                        modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name, type, if (needsOptions) options else emptyList()) },
            enabled = name.isNotBlank() && (!needsOptions || options.isNotEmpty())) { Text(stringResource(R.string.ps_create_field)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * "Add members" (MEMBER-PICKER.md, web 70a8fe6, iOS bf96669): full height, search by name or email, tick several,
 * one request. Same screen for task projects and the Pipeline Dashboard.
 */
@Composable
private fun AddPeopleDialog(s: ProjectSettingsState, onDismiss: () -> Unit, onAdd: (Set<String>, (String?) -> Unit) -> Unit) {
    val c = Nx.colors
    val inProject = s.detail?.members.orEmpty().mapNotNull { it.userId ?: it.user?.id }.toSet()
    var q by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf(setOf<String>()) }
    var adding by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val candidates = s.roster.filter { m -> (m.userId ?: m.id).let { it != null && it !in inProject } }.sortedBy { (it.name ?: it.email).orEmpty().lowercase() }
    val results = candidates.filter { m -> q.isBlank() || listOfNotNull(m.name, m.email).any { it.contains(q.trim(), ignoreCase = true) } }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                Text(stringResource(R.string.ps_add_member), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.weight(1f))
                TextButton(onClick = { adding = true; error = null; onAdd(picked) { err -> adding = false; error = err } }, enabled = picked.isNotEmpty() && !adding) {
                    if (adding) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text(stringResource(R.string.ps_add_n, picked.size), fontWeight = FontWeight.Bold)
                }
            }
            OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text(stringResource(R.string.ps_search_name_email)) }, shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus))
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (picked.isEmpty()) stringResource(R.string.ps_pick_people) else stringResource(R.string.ps_n_selected, picked.size),
                    fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                if (picked.isNotEmpty()) TextButton(onClick = { picked = emptySet() }) { Text(stringResource(R.string.ps_clear)) }
            }
            error?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            when {
                candidates.isEmpty() -> EmptyNote(stringResource(R.string.ps_everyone_here), stringResource(R.string.ps_everyone_hint))
                results.isEmpty() -> EmptyNote(stringResource(R.string.ps_no_match), stringResource(R.string.ps_no_match_hint))
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                    items(results, key = { it.userId ?: it.id ?: it.email.orEmpty() }) { m ->
                        val uid = m.userId ?: m.id ?: return@items
                        val on = uid in picked
                        Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - uid else picked + uid }.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.name ?: m.email, m.avatar, 32.dp); Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(m.name ?: m.email ?: "—", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                                m.email?.takeIf { it != m.name }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1) }
                            }
                            m.role?.takeIf { it.isNotBlank() }?.let { r ->
                                Text(r.lowercase().replaceFirstChar(Char::titlecase).replace('_', ' '), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                                    modifier = Modifier.background(c.muted, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                                Spacer(Modifier.width(8.dp))
                            }
                            Checkbox(on, { picked = if (on) picked - uid else picked + uid })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyNote(title: String, hint: String) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Text(hint, fontSize = 13.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InviteDialog(onDismiss: () -> Unit, onInvite: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("GUEST") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.ps_invite)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(email, { email = it }, singleLine = true, placeholder = { Text("name@company.com") }, modifier = Modifier.fillMaxWidth())
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("GUEST", "MEMBER", "VIEWER").forEach { r -> FilterChip(role == r, { role = r }, { Text(r.lowercase().replaceFirstChar(Char::titlecase), fontSize = 12.sp) }) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onInvite(email, role) }, enabled = email.contains('@')) { Text(stringResource(R.string.ps_send_invite)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
