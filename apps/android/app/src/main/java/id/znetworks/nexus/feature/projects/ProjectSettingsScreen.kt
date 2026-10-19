package id.znetworks.nexus.feature.projects

import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.ui.draw.clip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
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
            // Access refusals in words (LAST_OWNER, NEEDS_FULL_ACCESS), else the server's own sentence.
            _state.update { it.copy(error = e.describe(res)) }
        }
        _state.update { it.copy(busy = false) }
        load()
    }

    fun save(vararg fields: Pair<String, JsonElement>) = act(R.string.ps_saved) { api.updateProject(projectId, JsonObject(fields.toMap())) }

    /** The web saves the selection and its enabled state together, including removing the last member. */
    fun autoAssignTo(ids: Set<String>) = act {
        api.updateProject(projectId, JsonObject(mapOf(
            "autoAssignEnabled" to JsonPrimitive(ids.isNotEmpty()),
            "autoAssignAssigneeIds" to JsonArray(ids.map(::JsonPrimitive)),
        )))
        _state.update { it.copy(detail = it.detail?.copy(autoAssignEnabled = ids.isNotEmpty(), autoAssignAssigneeIds = ids.toList())) }
    }

    /** PROJECT-ICON: upload, then store the returned url as the icon. */
    fun setPhoto(jpeg: ByteArray) = act(R.string.ps_saved) {
        val url = api.uploadProjectIcon(projectId, jpeg) ?: throw ApiError.Decoding(IllegalStateException("no url"))
        api.updateProject(projectId, JsonObject(mapOf("icon" to JsonPrimitive(url))))
    }

    /** Back to the default mark: the column's default "folder" (as the web), never an emoji. */
    fun removePhoto() = save("icon" to JsonPrimitive(ProjectMarkLogic.REMOVED))

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
    fun addMembers(ids: Set<String>, level: AccessLevel, onDone: (String?) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            val n = api.addMembers(projectId, ids, level)
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
    fun invite(email: String, level: AccessLevel) = act(R.string.ps_invite_sent) { api.invite(projectId, email, level) }
    /** A member's level; 409 LAST_OWNER is said in words. */
    fun setAccess(userId: String, level: AccessLevel) = act { api.setMemberAccess(projectId, userId, level) }
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
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.pp_settings), subtitle = s.detail?.name, onBack = onBack) {
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        val d = s.detail
        if (d == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        // Read-only for anyone without Full access (13 Oct); an older server sends no level and nothing is locked.
        val access = ProjectAccess.of(d)
        val ro = !access.canManage
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (ro) Text(stringResource(R.string.acc_settings_readonly), fontSize = 13.sp, color = c.warningFg,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.warningBg).padding(12.dp))
            // Identity
            Section(stringResource(R.string.ps_identity)) {
                var name by rememberSaveable(d.name) { mutableStateOf(d.name) }
                var desc by rememberSaveable(d.description) { mutableStateOf(d.description.orEmpty()) }
                OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.ps_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(desc, { desc = it }, label = { Text(stringResource(R.string.ps_description)) }, maxLines = 4, modifier = Modifier.fillMaxWidth())
                // PROJECT-ICON (11 Oct): no emoji and no colour — the mark is the task icon, a photo the only custom icon.
                // The photo saves on its own; the general save sends neither "icon" nor "color".
                var unreadable by remember { mutableStateOf(false) }
                val pick = id.znetworks.nexus.feature.auth.rememberAvatarPicker { jpeg -> unreadable = jpeg == null; if (jpeg != null) vm.setPhoto(jpeg) }
                val hasPhoto = ProjectMarkLogic.isPhoto(d.icon)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProjectMark(d.icon, 48.dp, projectId = d.id)
                    OutlinedButton(onClick = pick, enabled = !s.busy && !ro) { Text(stringResource(if (hasPhoto) R.string.ps_photo_change else R.string.ps_photo_add)) }
                    if (hasPhoto) TextButton(onClick = vm::removePhoto, enabled = !s.busy && !ro) { Text(stringResource(R.string.ps_photo_remove), color = c.danger) }
                }
                if (unreadable) Text(stringResource(R.string.chat_photo_unreadable), fontSize = 12.sp, color = c.danger)
                val dirty = name.trim() != d.name || desc.trim() != d.description.orEmpty()
                OutlinedButton(onClick = {
                    vm.save("name" to JsonPrimitive(name.trim()), "description" to JsonPrimitive(desc.trim()))
                }, enabled = dirty && name.isNotBlank() && !s.busy && !ro, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.ps_save_identity)) }
            }
            // Flags
            Section(stringResource(R.string.ps_customize)) {
                // Only Auto assign is left (PROJECT-CUSTOMIZE-CLEANUP, 11 Oct): duplicate mode is always on (multi-select
                // on Board / List), P&L, Finance and the proof-before-Done rule are gone, and the server ignores those keys.
                val autoIds = d.autoAssignAssigneeIds.toSet()
                Flag("Auto assign", stringResource(R.string.ps_auto_sub), d.autoAssignEnabled == true, enabled = !ro && !s.busy) { on ->
                    if (on && autoIds.isEmpty()) vm.say(R.string.ps_auto_pick_first) else vm.save("autoAssignEnabled" to JsonPrimitive(on), "autoAssignAssigneeIds" to JsonArray(autoIds.map { JsonPrimitive(it) }))
                }
                AutoAssignMembers(d.id, d.members, autoIds, enabled = !ro && !s.busy, onSelect = vm::autoAssignTo)
            }
            // Tabs: which ones this project shows (hiding deletes nothing).
            // A Pipeline Dashboard has no task tabs to choose (as the web's Tune).
            if (d.type != "PIPELINE" && d.type != "OUTLET_SALES" && d.type != "SOCIAL_MEDIA_REPORT") Section(stringResource(R.string.ps_tabs)) {
                Text(stringResource(R.string.ps_tabs_sub), fontSize = 12.sp, color = c.mutedFg)
                val hidden = s.hiddenDraft ?: ProjectTabsLogic.hidden(d.hiddenTabs)
                val canChange = s.isManager && !ro
                ProjectTab.entries.forEach { t ->
                    val key = ProjectTabsLogic.key(t) ?: return@forEach
                    val locked = ProjectTabsLogic.locked(key, hidden)
                    Flag(stringResource(t.label), if (locked) stringResource(R.string.ps_tabs_board_or_list) else "", key !in hidden,
                        enabled = canChange && !locked && !s.busy) { vm.setTab(key, it) }
                }
                if (s.roleKnown && !canChange) Text(stringResource(R.string.ps_tabs_managers), fontSize = 11.sp, color = c.mutedFg)
            }
            // Custom fields
            Section(stringResource(R.string.ps_fields), action = { if (!ro) TextButton(onClick = { addingField = true }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.add)) } }) {
                if (s.fields.isEmpty()) Text(stringResource(R.string.ps_no_fields), fontSize = 12.sp, color = c.mutedFg)
                s.fields.forEach { f ->
                    var confirm by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(f.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text(listOfNotNull(FIELD_TYPES.firstOrNull { it.first == f.kind }?.let { stringResource(it.second) } ?: f.kind,
                                f.choices.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (!ro) IconButton(onClick = { confirm = true }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), tint = c.mutedFg) }
                    }
                    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.ps_delete_field_q, f.name)) },
                        text = { Text(stringResource(R.string.ps_delete_field_body)) },
                        confirmButton = { TextButton(onClick = { confirm = false; vm.deleteField(f.id) }) { Text(stringResource(R.string.delete), color = c.danger) } },
                        dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
                }
            }
            // Members: a level on every row (Full access changes it), Remove asks first; "Lead" reads Project Owner.
            Section(stringResource(R.string.ps_members)) {
                d.members.forEach { m ->
                    val uid = m.userId ?: m.user?.id
                    val level = AccessLevel.ofMember(m.role, m.accessLevel)
                    var levelMenu by remember { mutableStateOf(false) }
                    var confirmRemove by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.user?.name, m.user?.avatar, 30.dp, userId = m.uid)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(m.user?.name ?: "—", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.foreground)
                            if (m.role.equals("LEAD", true)) Text(stringResource(R.string.pp_owner), fontSize = 12.sp, color = c.mutedFg)
                        }
                        Box {
                            TextButton(onClick = { levelMenu = true }, enabled = !ro && uid != null && !s.busy) {
                                Text(accessLabel(level), fontSize = 13.sp, color = if (ro) c.mutedFg else c.foreground)
                                if (!ro) Icon(Icons.Filled.KeyboardArrowDown, null, Modifier.size(16.dp))
                            }
                            DropdownMenu(levelMenu, { levelMenu = false }) {
                                AccessText.LEVELS.forEach { l ->
                                    DropdownMenuItem(text = { Text(accessLabel(l)) }, leadingIcon = { if (l == level) Icon(Icons.Filled.Check, null) },
                                        onClick = { levelMenu = false; if (l != level && uid != null) vm.setAccess(uid, l) })
                                }
                                HorizontalDivider(color = c.border)
                                DropdownMenuItem(text = { Text(stringResource(R.string.acc_remove), color = c.dangerText) }, onClick = { levelMenu = false; confirmRemove = true })
                            }
                        }
                    }
                    if (confirmRemove && uid != null) AlertDialog(onDismissRequest = { confirmRemove = false },
                        text = { Text(stringResource(R.string.acc_remove_q, m.user?.name ?: m.user?.email ?: "—")) },
                        confirmButton = { TextButton(onClick = { confirmRemove = false; vm.removeMember(uid) }) { Text(stringResource(R.string.acc_remove), color = c.dangerText) } },
                        dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text(stringResource(R.string.cancel)) } })
                }
                if (!ro) Row {
                    TextButton(onClick = { addingPeople = true }) { Icon(Icons.Filled.PersonAdd, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_add_member)) }
                    TextButton(onClick = { inviting = true }) { Icon(Icons.Filled.Email, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.acc_invite)) }
                }
            }
            // Danger
            // Delete = Full access; Duplicate = BoD.
            if (!ro || s.isBoD) Section(stringResource(R.string.ps_danger)) {
                if (s.isBoD) OutlinedButton(onClick = vm::duplicate, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.ContentCopy, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ps_duplicate))
                }
                if (!ro) OutlinedButton(onClick = { confirmDelete = true }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
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
    if (addingPeople) AddPeopleDialog(s, onDismiss = { addingPeople = false }) { ids, level, done -> vm.addMembers(ids, level) { err -> done(err); if (err == null) addingPeople = false } }
    if (inviting) InviteDialog(onDismiss = { inviting = false }) { e, l -> inviting = false; vm.invite(e, l) }
    (s.error ?: s.toast)?.let { msg ->
        AlertDialog(onDismissRequest = vm::dismiss, text = { Text(msg) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } })
    }
}

@Composable
private fun AutoAssignMembers(projectId: String, members: List<ProjectMemberRef>, ids: Set<String>, enabled: Boolean, onSelect: (Set<String>) -> Unit) {
    val c = Nx.colors
    var open by rememberSaveable(projectId) { mutableStateOf(ids.isEmpty()) }
    val expanded = open || ids.isEmpty()
    val selected = members.filter { it.uid in ids }
    val shape = RoundedCornerShape(if (expanded) 16.dp else 24.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.muted.copy(alpha = 0.3f)).border(1.dp, c.border, shape)
        .padding(horizontal = 8.dp, vertical = if (expanded) 8.dp else 0.dp)) {
        if (!expanded) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                id.znetworks.nexus.ui.components.AvatarStack(selected.map { it.user?.name to it.user?.avatar }, size = 22.dp, userIds = selected.map { it.uid })
                Text(selected.joinToString(", ") { it.user?.name ?: it.user?.email ?: it.uid }, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                TextButton(onClick = { open = true }, enabled = enabled) { Text(stringResource(R.string.change), fontSize = 12.sp, color = c.foreground) }
            }
        } else {
            Text(stringResource(R.string.ps_auto_defaults, ids.size), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(4.dp))
            if (members.isEmpty()) Text(stringResource(R.string.ps_auto_no_members), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(4.dp))
            members.filter { it.uid.isNotBlank() }.forEach { member ->
                val checked = member.uid in ids
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                    .background(if (checked) c.onyx.copy(alpha = 0.1f) else androidx.compose.ui.graphics.Color.Transparent)
                    .toggleable(value = checked, enabled = enabled, role = androidx.compose.ui.semantics.Role.Checkbox) { picked ->
                        val next = if (picked) ids + member.uid else ids - member.uid
                        if (picked) open = false // web: a pick folds the list; an un-pick keeps it open
                        onSelect(next)
                    }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(if (checked) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, Modifier.size(16.dp), tint = if (checked) c.foreground else c.mutedFg)
                    Avatar(member.user?.name, member.user?.avatar, 22.dp, userId = member.uid)
                    Text(member.user?.name ?: member.user?.email ?: member.uid, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (ids.isNotEmpty()) TextButton(onClick = { open = false }, modifier = Modifier.align(Alignment.End)) { Text(stringResource(R.string.project_done), color = c.foreground) }
        }
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
                        trailingIcon = { IconButton(onClick = { if (draft.isNotBlank() && draft.trim() !in options) options = options + draft.trim(); draft = "" }) { Icon(Icons.Filled.Add, stringResource(R.string.ps_add_option)) } },
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
private fun AddPeopleDialog(s: ProjectSettingsState, onDismiss: () -> Unit, onAdd: (Set<String>, AccessLevel, (String?) -> Unit) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val inProject = s.detail?.members.orEmpty().mapNotNull { it.userId ?: it.user?.id }.toSet()
    var adding by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Picked people, then their level (13 Oct: adding a person asks the level).
    var picked by remember { mutableStateOf<Set<String>?>(null) }
    val p = picked
    if (p == null) {
        // Multi-select, one "Add N" — no team step (PROJECT-SETUP-MEMBERS B); the picker is shared with New project.
        PeoplePickerDialog(s.roster.filter { m -> ProjectSetupLogic.id(m).let { it != null && it !in inProject } }, emptySet(),
            stringResource(R.string.ps_add_member), { n -> ctx.getString(R.string.ps_add_n, n) },
            stringResource(R.string.ps_everyone_here), stringResource(R.string.ps_everyone_hint), busy = adding, error = error, onDismiss = onDismiss) { ids -> picked = ids }
    } else LevelDialog(stringResource(R.string.ps_add_member), busy = adding, error = error, onDismiss = { picked = null }) { level ->
        adding = true; error = null; onAdd(p, level) { err -> adding = false; error = err }
    }
}

/** "They get": the four levels, Can edit picked. */
@Composable
private fun LevelDialog(title: String, busy: Boolean, error: String?, onDismiss: () -> Unit, onPick: (AccessLevel) -> Unit) {
    var level by rememberSaveable { mutableStateOf(AccessLevel.EDIT) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(title) },
        text = {
            Column {
                Text(stringResource(R.string.acc_they_get), fontSize = 13.sp, color = Nx.colors.mutedFg)
                AccessText.LEVELS.forEach { l ->
                    Row(Modifier.fillMaxWidth().clickable { level = l }, verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(level == l, { level = l }); Text(accessLabel(l))
                    }
                }
                error?.let { Text(it, color = Nx.colors.dangerText, fontSize = 13.sp) }
            }
        },
        confirmButton = { TextButton(onClick = { onPick(level) }, enabled = !busy) { if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.add)) } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun InviteDialog(onDismiss: () -> Unit, onInvite: (String, AccessLevel) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf(AccessLevel.EDIT) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.acc_invite)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(email, { email = it }, singleLine = true, placeholder = { Text("name@company.com") }, modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.acc_they_get), fontSize = 13.sp, color = Nx.colors.mutedFg)
                AccessText.LEVELS.forEach { l ->
                    Row(Modifier.fillMaxWidth().clickable { level = l }, verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(level == l, { level = l }); Text(accessLabel(l))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onInvite(email, level) }, enabled = email.contains('@')) { Text(stringResource(R.string.ps_send_invite)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
