package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.PendingConfirm
import id.znetworks.nexus.ui.components.ConfirmDialog
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Project
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.parseColor
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request

// Teams (iOS TeamDetailView): members, linked projects, division, team shift hours. The list page is
// gone on web and iOS; a team is reached from a user's memberships in Control Room.

@Serializable data class TeamUserRef(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
@Serializable data class TeamMember(val id: String? = null, val userId: String? = null, val role: String? = null, val isAttendancePrimary: Boolean? = null, val user: TeamUserRef? = null) {
    val uid get() = userId ?: user?.id
    val displayName get() = user?.name ?: user?.email ?: "—"
}
@Serializable data class TeamProjRef(val id: String? = null, val name: String? = null, val color: String? = null, val status: String? = null)
@Serializable data class TeamProjectLink(val id: String? = null, val projectId: String? = null, val project: TeamProjRef? = null) {
    val pid get() = projectId ?: project?.id
    val displayName get() = project?.name ?: "Untitled"
}
@Serializable data class DivisionRef(val id: String, val name: String = "", val color: String? = null)
@Serializable data class Team(
    val id: String, val name: String = "", val color: String? = null, val divisionId: String? = null,
    /** Per team from the server; decides what is drawn, the server re-checks every action. */
    val canManage: Boolean? = null,
    /** Attendance supervisors may set shift hours without being Manager/BoD: a separate permission. */
    val canManageAttendanceSettings: Boolean? = null,
    val attendanceShiftOverrideEnabled: Boolean? = null, val attendanceShiftStartTime: String? = null, val attendanceShiftEndTime: String? = null,
    val division: DivisionRef? = null, val members: List<TeamMember> = emptyList(), val projects: List<TeamProjectLink> = emptyList(),
)
@Serializable data class Division(val id: String, val name: String = "", val color: String? = null, val position: Int? = null)

object TeamLogic {
    fun addable(team: Team, roster: List<WsMember>): List<WsMember> {
        val taken = team.members.mapNotNull { it.uid }.toSet()
        return roster.filter { it.userId !in taken }.sortedBy { it.displayName.lowercase() }
    }
    fun linkable(team: Team, projects: List<Project>): List<Project> {
        val taken = team.projects.mapNotNull { it.pid }.toSet()
        return projects.filter { it.id !in taken }
    }
    /** Hours are sent as null when the override is off, so no orphan hours wait to come back. */
    fun shiftBody(teamId: String, on: Boolean, start: String, end: String) = buildJsonObject {
        put("action", "update-attendance-shift"); put("teamId", teamId); put("attendanceShiftOverrideEnabled", on)
        put("attendanceShiftStartTime", if (on) JsonPrimitive(start) else JsonNull); put("attendanceShiftEndTime", if (on) JsonPrimitive(end) else JsonNull)
    }
    /** Projects the person loses when leaving a team: the ones they only have through it. */
    fun losing(ms: UserMemberships?, teamName: String) = ms?.projects.orEmpty().filter { it.viaTeam == teamName }.map { it.name }
}

class TeamsApi(private val api: ApiClient) {
    private suspend fun action(body: JsonObject) = api.send(Request.Builder().url(api.url("/api/teams")).post(body.toString().toJsonBody()).build(), JsonObject.serializer())
    private suspend fun act(name: String, vararg f: Pair<String, Any?>) = action(buildJsonObject {
        put("action", name)
        f.forEach { (k, v) -> when (v) { null -> put(k, JsonNull); is Boolean -> put(k, v); else -> put(k, v.toString()) } }
    })
    suspend fun teams() = api.get("/api/teams", ListSerializer(Team.serializer()))
    suspend fun create(name: String) = api.send(Request.Builder().url(api.url("/api/teams")).post(buildJsonObject { put("name", name.trim()) }.toString().toJsonBody()).build(), Team.serializer())
    suspend fun addMember(team: String, user: String) = act("add-member", "teamId" to team, "userId" to user)
    suspend fun removeMember(team: String, user: String) = act("remove-member", "teamId" to team, "userId" to user)
    suspend fun linkProject(team: String, project: String) = act("link-project", "teamId" to team, "projectId" to project)
    suspend fun unlinkProject(team: String, project: String) = act("unlink-project", "teamId" to team, "projectId" to project)
    suspend fun rename(team: String, name: String) = act("rename-team", "teamId" to team, "name" to name.trim())
    suspend fun delete(team: String) = act("delete-team", "teamId" to team)
    suspend fun setDivision(team: String, division: String?) = act("set-team-division", "teamId" to team, "divisionId" to division)
    suspend fun setPrimary(team: String, user: String, on: Boolean) = act("set-attendance-primary", "teamId" to team, "userId" to user, "isAttendancePrimary" to on)
    suspend fun shift(team: String, on: Boolean, start: String, end: String) = action(TeamLogic.shiftBody(team, on, start, end))
    suspend fun divisions() = api.get("/api/teams?resource=divisions", ListSerializer(Division.serializer()))
    suspend fun createDivision(name: String) = api.send(Request.Builder().url(api.url("/api/teams")).post(buildJsonObject { put("action", "create-division"); put("name", name.trim()) }.toString().toJsonBody()).build(), Division.serializer())
    suspend fun renameDivision(id: String, name: String) = act("update-division", "divisionId" to id, "name" to name.trim())
    suspend fun deleteDivision(id: String) = act("delete-division", "divisionId" to id)
    suspend fun addProjectMember(project: String, user: String) =
        api.send(Request.Builder().url(api.url("/api/projects/$project/members")).post(buildJsonObject { put("userId", user); put("role", "MEMBER") }.toString().toJsonBody()).build(), JsonObject.serializer())
    suspend fun removeProjectMember(project: String, user: String) =
        api.send(Request.Builder().url(api.url("/api/projects/$project/members")).delete(buildJsonObject { put("userId", user) }.toString().toJsonBody()).build(), JsonObject.serializer())
}

@Composable
internal fun teamsApi(): TeamsApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { TeamsApi(c.api) }
}

@Composable
private fun projectsApi(): ProjectsApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { ProjectsApi(c.api) }
}

class PickRow(val id: String, val title: String, val subtitle: String?)

/** One searchable picker for "add member", "link project" and "add to team". */
@Composable
fun PickDialog(title: String, rows: List<PickRow>, empty: String, onDismiss: () -> Unit, onCreate: ((String) -> Unit)? = null, onPick: (String) -> Unit) {
    val c = Nx.colors
    var q by remember { mutableStateOf("") }
    val t = q.trim().lowercase()
    val shown = if (t.isEmpty()) rows else rows.filter { t in it.title.lowercase() || t in it.subtitle.orEmpty().lowercase() }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.search)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
            if (rows.isEmpty() && onCreate == null) Text(empty, fontSize = 13.sp, color = c.mutedFg)
            LazyColumn(Modifier.heightIn(max = 360.dp)) {
                items(shown, key = { it.id }) { r ->
                    // Closed first, on purpose: the work continues on the screen behind, never a second tap here.
                    Column(Modifier.fillMaxWidth().clickable { onDismiss(); onPick(r.id) }.padding(vertical = 10.dp)) {
                        Text(r.title, fontSize = 14.sp, color = c.foreground)
                        r.subtitle?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
                    }
                }
                if (onCreate != null && q.isNotBlank() && rows.none { it.title.equals(q.trim(), ignoreCase = true) }) item {
                    Text(stringResource(R.string.tm_create_named, q.trim()), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.violetText,
                        modifier = Modifier.fillMaxWidth().clickable { onDismiss(); onCreate(q.trim()) }.padding(vertical = 10.dp))
                }
            }
        }
    }, confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamDetailScreen(teamId: String, onBack: () -> Unit, onOpenProfile: (String) -> Unit) {
    val api = teamsApi()
    val admin = adminApi()
    val projectsApi = projectsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var team by remember { mutableStateOf<Team?>(null) }
    var missing by remember { mutableStateOf<String?>(null) }
    var roster by remember { mutableStateOf<List<WsMember>>(emptyList()) }
    var projects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var divisions by remember { mutableStateOf<List<Division>>(emptyList()) }
    var busy by remember { mutableStateOf(setOf<String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    var dialog by remember { mutableStateOf<String?>(null) } // add | link | rename | delete | divisions | division
    var menu by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    // Shift hours are screen state, sent once with Save; a reload never swallows an unsaved edit.
    var shiftOn by remember { mutableStateOf(false) }
    var start by remember { mutableStateOf("09:00") }
    var end by remember { mutableStateOf("18:00") }
    var dirty by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tick) {
        try {
            val t = api.teams().firstOrNull { it.id == teamId }
            team = t; if (t == null) missing = res.getString(R.string.tm_gone)
            if (t != null && !dirty) { shiftOn = t.attendanceShiftOverrideEnabled == true; start = t.attendanceShiftStartTime ?: "09:00"; end = t.attendanceShiftEndTime ?: "18:00" }
        } catch (e: ApiError) { if (team == null) missing = e.describe(res) else error = e.describe(res) }
    }
    LaunchedEffect(Unit) {
        roster = runCatching { admin.roster(includeRegistered = false).members }.getOrDefault(emptyList())
        projects = runCatching { projectsApi.projects().value }.getOrDefault(emptyList())
        divisions = runCatching { api.divisions() }.getOrDefault(emptyList())
    }
    fun act(key: String, after: () -> Unit = {}, work: suspend () -> Unit) {
        if (key in busy) return
        scope.launch {
            busy = busy + key; error = null
            try { work(); after(); tick++ } catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
            busy = busy - key
        }
    }

    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        val t = team
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(t?.name ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
            if (t?.canManage == true) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem({ Text(stringResource(R.string.tm_rename)) }, { menu = false; dialog = "rename" })
                    DropdownMenuItem({ Text(stringResource(R.string.tm_divisions)) }, { menu = false; dialog = "divisions" })
                    DropdownMenuItem({ Text(stringResource(R.string.tm_delete), color = c.danger) }, { menu = false; dialog = "delete" })
                }
            }
        }
        if (t == null) {
            if (missing == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } else TabEmpty(Icons.Filled.Groups, missing!!)
            return@Column
        }
        val canManage = t.canManage == true
        val canManageAtt = t.canManageAttendanceSettings ?: canManage
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).background(parseColor(t.color, c.violet), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                    Text(t.name.take(1).uppercase(), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Black)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(t.name, fontFamily = DisplayFont, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                    Text(stringResource(R.string.tm_counts, t.members.size, t.projects.size), fontSize = 12.sp, color = c.mutedFg)
                }
            }
            error?.let { Text(it, fontSize = 12.sp, color = c.danger) }

            if (canManage) Section(stringResource(R.string.tm_division)) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).clickable(enabled = "div" !in busy) { dialog = "division" }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(parseColor(t.division?.color ?: "#64748B", c.mutedFg), CircleShape)); Spacer(Modifier.width(8.dp))
                    Text(t.division?.name ?: stringResource(R.string.tm_no_division), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                }
            }

            if (canManageAtt) Section(stringResource(R.string.tm_shift)) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.tm_shift_custom), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        Switch(shiftOn, { shiftOn = it; dirty = true })
                    }
                    if (shiftOn) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        TextButton(onClick = { pickTime = "start" }) { Text(stringResource(R.string.tm_in, start)) }
                        TextButton(onClick = { pickTime = "end" }) { Text(stringResource(R.string.tm_out, end)) }
                    } else Text(stringResource(R.string.tm_shift_off), fontSize = 11.sp, color = c.mutedFg)
                    if (dirty) Button(onClick = { act("shift", after = { dirty = false }) { api.shift(t.id, shiftOn, start, end) } }, enabled = "shift" !in busy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(if ("shift" in busy) R.string.saving else R.string.tm_shift_save))
                    }
                }
            }

            Section(stringResource(R.string.tm_members), if (canManage) ({ dialog = "add" }) else null) {
                if (t.members.isEmpty()) Empty(stringResource(R.string.tm_no_members))
                else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card)) {
                    t.members.forEachIndexed { i, m ->
                        if (i > 0) HorizontalDivider(color = c.border)
                        val key = "member-${m.uid}"
                        // Keyed by person: after a reload the open menu stays on the row it was opened on.
                        var open by remember(m.uid) { mutableStateOf(false) }
                        var ask by remember(m.uid) { mutableStateOf<PendingConfirm?>(null) }
                        val askTitle = stringResource(R.string.cf_remove_from_team, m.user?.name ?: m.user?.email ?: "—", t.name)
                        val askAction = stringResource(R.string.tm_remove_member)
                        ConfirmDialog(ask) { ask = null }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(1f).clickable(enabled = m.uid != null) { m.uid?.let(onOpenProfile) }, verticalAlignment = Alignment.CenterVertically) {
                                Avatar(m.displayName, m.user?.avatar, 34.dp, userId = m.userId); Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(m.displayName, fontSize = 14.sp, color = c.foreground, maxLines = 1)
                                    m.user?.email?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1) }
                                }
                            }
                            if (m.isAttendancePrimary == true) Icon(Icons.Filled.Star, stringResource(R.string.tm_primary), Modifier.size(12.dp), tint = c.warning)
                            if (canManage && m.uid != null) Box {
                                IconButton(onClick = { open = true }, enabled = key !in busy) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                                DropdownMenu(open, { open = false }) {
                                    // No "make lead": team leads are gone; approvals live in the approval chart.
                                    if (canManageAtt) DropdownMenuItem({ Text(stringResource(if (m.isAttendancePrimary == true) R.string.tm_unset_primary else R.string.tm_set_primary)) },
                                        { open = false; act(key) { api.setPrimary(t.id, m.uid!!, m.isAttendancePrimary != true) } })
                                    DropdownMenuItem({ Text(stringResource(R.string.tm_remove_member), color = c.danger) }, { open = false; ask = PendingConfirm(askTitle, null, askAction) { act(key) { api.removeMember(t.id, m.uid!!) } } })
                                }
                            }
                        }
                    }
                }
            }

            Section(stringResource(R.string.tm_projects), if (canManage) ({ dialog = "link" }) else null) {
                Text(stringResource(R.string.tm_projects_note), fontSize = 11.sp, color = c.mutedFg)
                if (t.projects.isEmpty()) Empty(stringResource(R.string.tm_no_projects))
                else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card)) {
                    t.projects.forEachIndexed { i, l ->
                        if (i > 0) HorizontalDivider(color = c.border)
                        val key = "project-${l.pid}"
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(10.dp).background(parseColor(l.project?.color, c.violet), RoundedCornerShape(3.dp))); Spacer(Modifier.width(12.dp))
                            Text(l.displayName, fontSize = 14.sp, color = c.foreground, maxLines = 1, modifier = Modifier.weight(1f))
                            if (canManage && l.pid != null) IconButton(onClick = { act(key) { api.unlinkProject(t.id, l.pid!!) } }, enabled = key !in busy) {
                                Icon(Icons.Filled.RemoveCircleOutline, stringResource(R.string.tm_unlink), tint = c.danger)
                            }
                        }
                    }
                }
            }
        }

        when (dialog) {
            "add" -> PickDialog(stringResource(R.string.tm_add_member), TeamLogic.addable(t, roster).map { PickRow(it.userId, it.displayName, it.email) },
                stringResource(R.string.tm_everyone_in), { dialog = null }) { id -> act("add-$id") { api.addMember(t.id, id) } }
            "link" -> PickDialog(stringResource(R.string.tm_link_project), TeamLogic.linkable(t, projects).map { PickRow(it.id, it.name, it.status) },
                stringResource(R.string.tm_all_linked), { dialog = null }) { id -> act("link-$id") { api.linkProject(t.id, id) } }
            "division" -> PickDialog(stringResource(R.string.tm_division), listOf(PickRow("", res.getString(R.string.tm_no_division), null)) + divisions.map { PickRow(it.id, it.name, null) },
                "", { dialog = null }) { id -> act("div") { api.setDivision(t.id, id.ifEmpty { null }) } }
            "rename" -> {
                var draft by remember { mutableStateOf(t.name) }
                AlertDialog(onDismissRequest = { dialog = null }, title = { Text(stringResource(R.string.tm_rename)) },
                    text = { OutlinedTextField(draft, { draft = it }, singleLine = true, label = { Text(stringResource(R.string.tm_name)) }, keyboardOptions = AdminKeyboard.Done) },
                    confirmButton = { TextButton(onClick = { dialog = null; act("rename") { api.rename(t.id, draft) } }, enabled = draft.isNotBlank() && draft.trim() != t.name) { Text(stringResource(R.string.save)) } },
                    dismissButton = { TextButton(onClick = { dialog = null }) { Text(stringResource(R.string.cancel)) } })
            }
            "delete" -> AlertDialog(onDismissRequest = { dialog = null }, title = { Text(stringResource(R.string.tm_delete_q)) },
                // The numbers are said, not left for the person to estimate.
                text = { Text(stringResource(R.string.tm_delete_msg, t.members.size, t.projects.size)) },
                confirmButton = { TextButton(onClick = { dialog = null; act("delete", after = onBack) { api.delete(t.id) } }) { Text(stringResource(R.string.delete), color = c.danger) } },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text(stringResource(R.string.cancel)) } })
            "divisions" -> DivisionsDialog(api, divisions, { dialog = null }) { scope.launch { divisions = runCatching { api.divisions() }.getOrDefault(divisions); tick++ } }
        }
        pickTime?.let { which ->
            val cur = if (which == "start") start else end
            val st = rememberTimePickerState(cur.substringBefore(':').toIntOrNull() ?: 9, cur.substringAfter(':').toIntOrNull() ?: 0, is24Hour = true)
            AlertDialog(onDismissRequest = { pickTime = null }, text = { TimePicker(st) }, confirmButton = { TextButton(onClick = {
                val v = "%02d:%02d".format(st.hour, st.minute); if (which == "start") start = v else end = v; dirty = true; pickTime = null
            }) { Text("OK") } })
        }
    }
}

/** Create, rename, delete divisions; deleting one keeps its teams (they become ungrouped). */
@Composable
private fun DivisionsDialog(api: TeamsApi, divisions: List<Division>, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Division?>(null) }
    fun run(work: suspend () -> Unit) { if (busy) return; scope.launch { busy = true; problem = null; try { work(); onChanged() } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }; busy = false } }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.tm_divisions)) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text(stringResource(R.string.tm_new_division)) }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                TextButton(onClick = { val n = name; run { api.createDivision(n); name = "" } }, enabled = !busy && name.isNotBlank()) { Text(stringResource(R.string.add)) }
            }
            if (divisions.isEmpty()) Text(stringResource(R.string.tm_no_divisions), fontSize = 12.sp, color = c.mutedFg)
            divisions.forEach { d ->
                var open by remember { mutableStateOf(false) }
                var ask by remember { mutableStateOf<PendingConfirm?>(null) }
                val askTitle = stringResource(R.string.cf_delete_division, d.name)
                val askAction = stringResource(R.string.tm_delete_division)
                ConfirmDialog(ask) { ask = null }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(parseColor(d.color ?: "#64748B", c.mutedFg), CircleShape)); Spacer(Modifier.width(8.dp))
                    Text(d.name, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
                    Box {
                        IconButton(onClick = { open = true }, enabled = !busy) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                        DropdownMenu(open, { open = false }) {
                            DropdownMenuItem({ Text(stringResource(R.string.tm_rename)) }, { open = false; renaming = d })
                            DropdownMenuItem({ Text(stringResource(R.string.tm_delete_division), color = c.danger) }, { open = false; ask = PendingConfirm(askTitle, null, askAction) { run { api.deleteDivision(d.id) } } })
                        }
                    }
                }
            }
            problem?.let { Text(it, fontSize = 12.sp, color = c.danger) }
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } })
    renaming?.let { d ->
        var draft by remember(d.id) { mutableStateOf(d.name) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text(stringResource(R.string.tm_rename_division)) },
            text = { OutlinedTextField(draft, { draft = it }, singleLine = true, keyboardOptions = AdminKeyboard.Done) },
            confirmButton = { TextButton(onClick = { renaming = null; if (draft.isNotBlank() && draft.trim() != d.name) run { api.renameDivision(d.id, draft) } }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Section(title: String, onAdd: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontFamily = DisplayFont, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
            if (onAdd != null) IconButton(onClick = onAdd) { Icon(Icons.Filled.AddCircle, stringResource(R.string.add), tint = c.violetText) }
        }
        content()
    }
}

@Composable
private fun Empty(text: String) = Text(text, fontSize = 12.sp, color = Nx.colors.mutedFg, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Nx.colors.card).padding(14.dp))

/**
 * Control Room › user › Teams & projects: chips that can be edited. Direct projects can be removed;
 * ones that come through a team cannot (the team sync would write them back).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MembershipEditor(userId: String, userName: String, ms: UserMemberships?, canEdit: Boolean, onOpenTeam: (String) -> Unit, run: (suspend () -> Unit) -> Unit) {
    val api = teamsApi()
    val projectsApi = projectsApi()
    val c = Nx.colors
    var allTeams by remember { mutableStateOf<List<Team>>(emptyList()) }
    var allProjects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var dialog by remember { mutableStateOf<String?>(null) }
    var leaving by remember { mutableStateOf<MTeam?>(null) }
    LaunchedEffect(canEdit) {
        allTeams = runCatching { api.teams() }.getOrDefault(emptyList())
        if (canEdit) allProjects = runCatching { projectsApi.projects().value }.getOrDefault(emptyList())
    }
    val projects = ms?.projects.orEmpty(); val teams = ms?.teams.orEmpty()
    AdminCard(stringResource(R.string.tm_teams_projects)) {
        if (canEdit) Text(stringResource(R.string.tm_join_note), fontSize = 11.sp, color = c.mutedFg)
        Text(stringResource(R.string.tm_projects).uppercase(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            projects.forEach { p ->
                var open by remember { mutableStateOf(false) }
                var ask by remember { mutableStateOf<PendingConfirm?>(null) }
                val askTitle = stringResource(R.string.cf_leave_project, p.name)
                val askAction = stringResource(R.string.tm_leave_project)
                ConfirmDialog(ask) { ask = null }
                Box {
                    Chip(p.name + (p.viaTeam?.let { " · via $it" } ?: ""), null,
                        if (canEdit && p.viaTeam == null) ({ open = true }) else null)
                    DropdownMenu(open, { open = false }) {
                        DropdownMenuItem({ Text(stringResource(R.string.tm_leave_project), color = c.danger) }, { open = false; ask = PendingConfirm(askTitle, null, askAction) { run { api.removeProjectMember(p.id, userId) } } })
                    }
                }
            }
            if (canEdit) Chip("+ " + stringResource(R.string.tm_project_word), null) { dialog = "project" }
        }
        if (projects.isEmpty() && !canEdit) Text(stringResource(R.string.tm_no_project_yet), fontSize = 11.sp, color = c.mutedFg)
        Text(stringResource(R.string.ad_teams).uppercase(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            teams.forEach { t ->
                var open by remember { mutableStateOf(false) }
                val full = allTeams.firstOrNull { it.id == t.id }
                Box {
                    Chip(t.name, t.color ?: "#7B2FBE", if (canEdit || full != null) ({ open = true }) else null)
                    DropdownMenu(open, { open = false }) {
                        if (full != null) DropdownMenuItem({ Text(stringResource(if (full.canManage == true) R.string.tm_manage else R.string.tm_open)) }, { open = false; onOpenTeam(t.id) })
                        if (canEdit) DropdownMenuItem({ Text(stringResource(R.string.tm_remove_member), color = c.danger) }, { open = false; leaving = t })
                    }
                }
            }
            // No "+ Team": teams are retired (POST /api/teams answers 410 TEAMS_RETIRED); the Bagan IP & Divisi replaced them.
        }
        if (teams.isEmpty() && !canEdit) Text(stringResource(R.string.tm_no_team_yet), fontSize = 11.sp, color = c.mutedFg)
    }
    when (dialog) {
        "project" -> PickDialog(stringResource(R.string.tm_add_to_project, userName), allProjects.filter { p -> projects.none { it.id == p.id } }.map { PickRow(it.id, it.name, it.status) },
            stringResource(R.string.tm_all_linked), { dialog = null }) { id -> run { api.addProjectMember(id, userId) } }
        "team" -> PickDialog(stringResource(R.string.tm_add_to_team, userName), allTeams.filter { t -> t.canManage == true && teams.none { it.id == t.id } }.map { PickRow(it.id, it.name, null) },
            "", { dialog = null }, onCreate = { name -> run { val nt = api.create(name); api.addMember(nt.id, userId) } }) { id -> run { api.addMember(id, userId) } }
    }
    leaving?.let { t ->
        val lose = TeamLogic.losing(ms, t.name)
        AlertDialog(onDismissRequest = { leaving = null }, title = { Text(stringResource(R.string.tm_leave_q, userName, t.name)) },
            text = { Text(if (lose.isEmpty()) stringResource(R.string.tm_leave_nothing) else stringResource(R.string.tm_leave_lose, lose.size, lose.joinToString(", "))) },
            confirmButton = { TextButton(onClick = { leaving = null; run { api.removeMember(t.id, userId) } }) { Text(stringResource(R.string.tm_remove_member), color = c.danger) } },
            dismissButton = { TextButton(onClick = { leaving = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Chip(text: String, dot: String?, onClick: (() -> Unit)?) {
    val c = Nx.colors
    Row(Modifier.clip(RoundedCornerShape(8.dp)).background(c.background).border(1.dp, c.border, RoundedCornerShape(8.dp))
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        if (dot != null) { Box(Modifier.size(6.dp).background(parseColor(dot, c.violet), CircleShape)); Spacer(Modifier.width(5.dp)) }
        Text(text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = if (onClick != null && dot == null && text.startsWith("+")) c.violetText else c.foreground, maxLines = 1)
    }
}
