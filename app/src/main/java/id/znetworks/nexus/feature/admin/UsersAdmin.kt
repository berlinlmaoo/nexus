package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
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
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.auth.ProfileApi
import id.znetworks.nexus.feature.auth.rememberAvatarPicker
import androidx.compose.material3.LocalTextStyle
import androidx.compose.ui.text.font.FontFamily
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

@Composable
internal fun adminApi(): AdminApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { AdminApi(c.api) }
}

@Composable
internal fun AdminCard(title: String? = null, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        title?.let { Text(it, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground) }
        content()
    }
}

object UsersLogic {
    /** "3 projects · 2 teams", or "0 projects" when nowhere yet (iOS membershipSummary). */
    fun membershipSummary(m: UserMemberships): String {
        val p = m.projects.size; val t = m.teams.size
        val proj = "$p project" + if (p == 1) "" else "s"
        return if (t == 0) proj else "$proj · $t team" + if (t == 1) "" else "s"
    }
}

/** Control Room › Users: the roster (A–Z), role counts as filters, search, add people, approval chart. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UsersTab(isBoD: Boolean, onOpenUser: (String) -> Unit, onOpenChart: () -> Unit) {
    val api = adminApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var role by rememberSaveable { mutableStateOf("ALL") }
    var q by rememberSaveable { mutableStateOf("") }
    var inviting by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var memberships by remember { mutableStateOf<Map<String, UserMemberships>>(emptyMap()) }
    LaunchedEffect(tick) { try { roster = api.roster(); error = null } catch (e: ApiError) { error = e.describe(res) } }
    // One call for everyone (BoD; others get an empty map and no summary line), never one per row.
    LaunchedEffect(tick) { memberships = api.memberships() }
    val r = roster
    when {
        r == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        r == null -> TabEmpty(Icons.Filled.PersonAdd, error!!)
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(role == "ALL", { role = "ALL" }, { Text("Total · ${r.members.size}") })
                    Roles.ALL.forEach { k -> FilterChip(role == k, { role = if (role == k) "ALL" else k }, { Text("${Roles.label(k)} · ${r.members.count { it.role == k }}") }) }
                }
            }
            // BoD and One Above All only, as iOS and the server (a Manager's every save would be 403).
            if (isBoD) item {
                val unplaced = Roles.unplaced(r.members).size
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).clickable(onClick = onOpenChart).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AccountTree, null, tint = c.violetText); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.ad_chart), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(if (unplaced == 0) stringResource(R.string.ad_chart_all_placed) else stringResource(R.string.ad_chart_unplaced, unplaced),
                            fontSize = 12.sp, color = if (unplaced == 0) c.mutedFg else c.warning)
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.ad_search)) },
                        shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f))
                    if (isBoD) IconButton(onClick = { inviting = true }) { Icon(Icons.Filled.PersonAdd, stringResource(R.string.ad_invite), tint = c.violetText) }
                }
            }
            val shown = Roles.filter(r.members, role, q)
            if (shown.isEmpty()) item { Text(stringResource(R.string.ad_no_match), fontSize = 12.sp, color = c.mutedFg) }
            items(shown, key = { it.id }) { m ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).clickable { onOpenUser(m.userId) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(m.name, m.avatar, 34.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(m.displayName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        m.email?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        // Only what is ON: most people use none, and "off" badges on every row hide the few.
                        if (m.flexiTimeEnabled || m.noGeofenceMode || !m.googleWorkspaceEmail.isNullOrEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (m.flexiTimeEnabled) Text("⚡ Flexi", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.warning)
                            if (m.noGeofenceMode) Text("📱 Mobile", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                            if (!m.googleWorkspaceEmail.isNullOrEmpty()) Text("@", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.violetText)
                        }
                        // BoD without an approver is the top of the chain, not a gap.
                        val approver = m.approver?.name?.takeIf { it.isNotEmpty() }
                        if (approver != null) Text(stringResource(R.string.ad_approver_is, approver), fontSize = 10.sp, color = c.mutedFg, maxLines = 1)
                        else if (m.role == "STAFF" || m.role == "MANAGER") Text(stringResource(R.string.ad_not_placed), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.warning)
                        memberships[m.userId]?.let { Text(UsersLogic.membershipSummary(it), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg) }
                    }
                    Pill(Roles.label(m.role), if (Roles.tier(m.role) >= 3) c.violetText else c.mutedFg)
                }
            }
            // Signed up but not in this workspace yet: one tap brings them in (BoD).
            val reg = r.availableUsers.filter { q.isBlank() || (it.name.orEmpty() + it.email.orEmpty()).contains(q.trim(), true) }
            if (isBoD && reg.isNotEmpty()) {
                item { Text(stringResource(R.string.ad_not_in_ws, reg.size), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(top = 10.dp)) }
                items(reg, key = { "reg-" + it.id }) { u ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(u.name, u.avatar, 30.dp); Spacer(Modifier.width(10.dp))
                        Text(u.name ?: u.email ?: "—", fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        TextButton(onClick = {
                            val ws = r.workspaceId ?: return@TextButton
                            scope.launch {
                                // Moves a self-signed-up person out of their personal workspace.
                                try { api.invite(u.email.orEmpty(), "STAFF", ws, absorb = true); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                            }
                        }) { Text(stringResource(R.string.ad_bring_in)) }
                    }
                }
            }
        }
    }
    if (inviting && r?.workspaceId != null) {
        var email by rememberSaveable { mutableStateOf("") }
        var newRole by rememberSaveable { mutableStateOf("STAFF") }
        AlertDialog(onDismissRequest = { inviting = false }, title = { Text(stringResource(R.string.ad_invite)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(email, { email = it }, singleLine = true, placeholder = { Text("name@company.com") }, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Roles.assignable(r.role).forEach { k -> FilterChip(newRole == k, { newRole = k }, { Text(Roles.label(k), fontSize = 12.sp) }) } }
                }
            },
            confirmButton = { TextButton(onClick = {
                inviting = false
                scope.launch { try { val out = api.invite(email, newRole, r.workspaceId); notice = if (InviteResult.emailFailed(out)) res.getString(R.string.wm_added_no_email, InviteResult.email(out, email)) else res.getString(R.string.ad_invited); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
            }, enabled = email.contains('@')) { Text(stringResource(R.string.ps_send_invite)) } },
            dismissButton = { TextButton(onClick = { inviting = false }) { Text(stringResource(R.string.cancel)) } })
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

/** One member: role, approver, attendance mode, rest days, work hours, account, memberships, danger. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdminUserScreen(userId: String, onBack: () -> Unit, onOpenProfile: (String) -> Unit, onOpenTeam: (String) -> Unit = {}) {
    val api = adminApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    val viewer = (context.applicationContext as NexusApplication).container.viewer
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var ms by remember { mutableStateOf<UserMemberships?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf<String?>(null) } // "approver" | "role" | "hours"
    var confirm by remember { mutableStateOf<String?>(null) } // "remove" | "delete"
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) {
        roster = runCatching { api.roster(includeRegistered = false) }.getOrNull()
        ms = api.memberships()[userId]
        viewer.load()
    }
    val r = roster; val m = r?.members?.firstOrNull { it.userId == userId }; val ws = r?.workspaceId
    fun run(block: suspend () -> Unit) = scope.launch {
        busy = true
        try { block(); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        busy = false
    }
    fun patch(vararg f: Pair<String, JsonElement>) { if (m != null && ws != null) run { api.patchMember(m.id, ws, f.toMap()) } }

    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(m?.displayName ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        if (r == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        if (m == null || ws == null) { TabEmpty(Icons.Filled.PersonAdd, stringResource(R.string.ad_not_member)); return@Column }
        // As iOS AdminUserDetailView: attendance settings and the account for BoD/OAA; role, Google,
        // memberships and the danger zone only on someone below you (One Above All: anyone).
        val canManage = Roles.tier(r.role) >= 3
        val canEdit = Roles.canEdit(r.role, m.role)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { onOpenProfile(m.userId) }) {
                Avatar(m.name, m.avatar, 56.dp); Spacer(Modifier.width(12.dp))
                Column {
                    Text(m.displayName, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
                    Text(listOfNotNull(m.email, m.phoneNumber).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                }
            }
            AdminCard(stringResource(R.string.ad_role)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(Roles.label(m.role), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                    // Only roles strictly below mine, and never above-or-equal members.
                    if (Roles.canEdit(r.role, m.role)) TextButton(onClick = { picking = "role" }) { Text(stringResource(R.string.change)) }
                }
            }
            if (canManage) AdminCard(stringResource(R.string.ad_approval)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(m.approver?.name ?: stringResource(R.string.ad_no_approver), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(stringResource(if (m.approverId == null) R.string.ad_no_approver_sub else R.string.ad_approver_sub), fontSize = 11.sp, color = c.mutedFg)
                    }
                    if (canManage) TextButton(onClick = { picking = "approver" }) { Text(stringResource(R.string.change)) }
                }
            }
            if (canManage) AdminCard(stringResource(R.string.ad_att_mode)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("Flexi time", fontSize = 14.sp, color = c.foreground); Text(stringResource(R.string.ad_flexi_sub), fontSize = 11.sp, color = c.mutedFg) }
                    Switch(m.flexiTimeEnabled, { patch("flexiTimeEnabled" to JsonPrimitive(it)) }, enabled = canManage && !busy)
                }
                HorizontalDivider(color = c.border)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(stringResource(R.string.location_free), fontSize = 14.sp, color = c.foreground); Text(stringResource(R.string.ad_nogeo_sub), fontSize = 11.sp, color = c.mutedFg) }
                    Switch(m.noGeofenceMode, { patch("noGeofenceMode" to JsonPrimitive(it)) }, enabled = canManage && !busy)
                }
            }
            if (canManage) AdminCard(stringResource(R.string.ad_rest_days)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DayOfWeek.entries.forEach { d ->
                        val on = d.value in m.restDays
                        FilterChip(on, {
                            val next = if (on) m.restDays - d.value else m.restDays + d.value
                            // Fewer than 7: somebody always has a working day (server rule).
                            if (next.size < 7) patch("restDays" to JsonArray(next.sorted().map { JsonPrimitive(it) }))
                        }, { Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault())) }, enabled = canManage && !busy)
                    }
                }
            }
            if (canManage) AdminCard(stringResource(R.string.ad_work_hours)) {
                val def = if (m.attendanceShiftStartTime != null) "${m.attendanceShiftStartTime}–${m.attendanceShiftEndTime}" else stringResource(R.string.ad_follows_team)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(def, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                    if (canManage) TextButton(onClick = { picking = "hours" }) { Text(stringResource(R.string.change)) }
                }
                m.attendanceShiftByDay?.takeIf { it.isNotEmpty() }?.let { byDay ->
                    Text(byDay.entries.sortedBy { it.key }.joinToString(" · ") { (k, v) -> "${DayOfWeek.of(k.toInt()).getDisplayName(TextStyle.SHORT, Locale.getDefault())} ${v.start}–${v.end}" },
                        fontSize = 12.sp, color = c.mutedFg)
                }
            }
            if (canEdit) AdminCard(stringResource(R.string.gw_title)) {
                var linking by remember { mutableStateOf(false) }
                Text(stringResource(R.string.gw_card_sub), fontSize = 11.sp, color = c.mutedFg)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.googleWorkspaceEmail ?: stringResource(R.string.gw_not_linked_yet), fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        color = if (m.googleWorkspaceEmail == null) c.mutedFg else c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                    TextButton(onClick = { linking = true }) { Text(stringResource(if (m.googleWorkspaceEmail == null) R.string.gw_link else R.string.change)) }
                }
                if (linking) GoogleLinkDialog(m.userId, m.displayName, m.googleWorkspaceEmail, { linking = false }) { tick++ }
            }
            MembershipEditor(m.userId, m.displayName, ms, canEdit, onOpenTeam) { block -> run(block) }
            if (canManage) {
                val profiles = remember { ProfileApi((context.applicationContext as NexusApplication).container.api) }
                AccountCard(m, onPhoto = { jpeg -> if (jpeg == null) notice = res.getString(R.string.chat_photo_unreadable) else run { profiles.uploadMemberAvatar(m.id, jpeg); notice = res.getString(R.string.ad_photo_changed) } }) { f -> run { api.updateAccount(m.userId, f) } }
            }
            if (canEdit && m.userId != (context.applicationContext as NexusApplication).container.sessionStore.current?.userId) AdminCard(stringResource(R.string.ps_danger)) {
                OutlinedButton(onClick = { confirm = "remove" }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.ad_remove_ws), color = c.danger) }
                if (viewer.isBoD) OutlinedButton(onClick = { confirm = "delete" }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.ad_delete_user), color = c.danger) }
            }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
    if (m != null && ws != null) when (picking) {
        "role" -> AlertDialog(onDismissRequest = { picking = null }, title = { Text(stringResource(R.string.ad_role)) },
            text = { Column { Roles.assignable(r?.role).forEach { k -> TextButton(onClick = { picking = null; patch("role" to JsonPrimitive(k)) }) { Text(Roles.label(k)) } } } },
            confirmButton = {}, dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } })
        "approver" -> {
            // Anyone but the person (iOS, server): a loop is still refused below (makesCycle).
            val candidates = r!!.members.filter { it.userId != m.userId }.sortedWith(compareBy({ -Roles.tier(it.role) }, { it.displayName.lowercase() }))
            AlertDialog(onDismissRequest = { picking = null }, title = { Text(stringResource(R.string.ad_approval)) },
                text = {
                    LazyColumn(Modifier.heightIn(max = 380.dp)) {
                        item { TextButton(onClick = { picking = null; run { api.setApprover(m, ws, null) } }) { Text(stringResource(R.string.ad_detach)) } }
                        items(candidates, key = { it.id }) { a ->
                            val loop = Roles.makesCycle(r.members, m.userId, a.userId)
                            Row(Modifier.fillMaxWidth().clickable(enabled = !loop) { picking = null; run { api.setApprover(m, ws, a.userId) } }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(a.name, a.avatar, 26.dp); Spacer(Modifier.width(8.dp))
                                Text(a.displayName + " · " + Roles.label(a.role), fontSize = 13.sp, color = if (loop) c.mutedFg else c.foreground, modifier = Modifier.weight(1f))
                                if (loop) Text(stringResource(R.string.ad_loop), fontSize = 10.sp, color = c.mutedFg)
                            }
                        }
                    }
                }, confirmButton = {}, dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } })
        }
        "hours" -> HoursDialog(m, onDismiss = { picking = null }) { start, end ->
            picking = null
            // Both set or both null; the per-day map is left as it is.
            patch("attendanceShiftStartTime" to (start?.let { JsonPrimitive(it) } ?: JsonNull), "attendanceShiftEndTime" to (end?.let { JsonPrimitive(it) } ?: JsonNull))
        }
    }
    confirm?.let { what ->
        AlertDialog(onDismissRequest = { confirm = null },
            title = { Text(stringResource(if (what == "remove") R.string.ad_remove_ws_q else R.string.ad_delete_user_q, m?.displayName.orEmpty())) },
            text = { Text(stringResource(if (what == "remove") R.string.ad_remove_ws_body else R.string.ad_delete_user_body)) },
            confirmButton = { TextButton(onClick = {
                confirm = null
                if (m != null && ws != null) scope.launch {
                    try { if (what == "remove") api.removeMember(m.id, ws) else api.deleteUser(m.userId); onBack() }
                    catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                }
            }) { Text(stringResource(R.string.delete), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun AccountCard(m: WsMember, onPhoto: (ByteArray?) -> Unit, onSave: (Map<String, JsonElement>) -> Unit) {
    var name by rememberSaveable(m.name) { mutableStateOf(m.name.orEmpty()) }
    var email by rememberSaveable(m.email) { mutableStateOf(m.email.orEmpty()) }
    var password by rememberSaveable { mutableStateOf("") }
    val pick = rememberAvatarPicker(onPhoto)
    AdminCard(stringResource(R.string.ad_account)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(m.name, m.avatar, 56.dp); Spacer(Modifier.width(12.dp))
            TextButton(onClick = pick) { Text(stringResource(R.string.pf_change_photo)) }
        }
        OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.signup_name)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, singleLine = true, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, singleLine = true, label = { Text(stringResource(R.string.reset_new_password)) }, textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
            supportingText = { Text(stringResource(R.string.ad_password_hint)) }, modifier = Modifier.fillMaxWidth())
        // Only changed keys: re-sending an unchanged email can 409.
        val fields = buildMap<String, JsonElement> {
            if (name.trim() != m.name.orEmpty() && name.trim().length >= 2) put("name", JsonPrimitive(name.trim()))
            if (email.trim() != m.email.orEmpty() && email.contains('@')) put("email", JsonPrimitive(email.trim()))
            if (password.length >= 8) put("password", JsonPrimitive(password))
        }
        TextButton(onClick = { onSave(fields); password = "" }, enabled = fields.isNotEmpty()) { Text(stringResource(R.string.save)) }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun HoursDialog(m: WsMember, onDismiss: () -> Unit, onSave: (String?, String?) -> Unit) {
    var start by remember { mutableStateOf(m.attendanceShiftStartTime ?: "09:00") }
    var end by remember { mutableStateOf(m.attendanceShiftEndTime ?: "18:00") }
    var editing by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.ad_work_hours)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { editing = "start" }, modifier = Modifier.weight(1f)) { Text(start) }
                    OutlinedButton(onClick = { editing = "end" }, modifier = Modifier.weight(1f)) { Text(end) }
                }
                Text(stringResource(R.string.ad_hours_note), fontSize = 11.sp, color = Nx.colors.mutedFg)
                TextButton(onClick = { onSave(null, null) }) { Text(stringResource(R.string.ad_follows_team)) }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(start, end) }, enabled = start != end) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
    editing?.let { which ->
        val cur = if (which == "start") start else end
        val st = rememberTimePickerState(cur.substringBefore(':').toInt(), cur.substringAfter(':').toInt(), is24Hour = true)
        AlertDialog(onDismissRequest = { editing = null }, text = { TimePicker(st) }, confirmButton = {
            TextButton(onClick = { val v = "%02d:%02d".format(st.hour, st.minute); if (which == "start") start = v else end = v; editing = null }) { Text("OK") }
        })
    }
}
