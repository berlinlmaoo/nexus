package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

/** The Control Room tabs, iOS order; the BoD-only ones are added for BoD / One Above All. */
object ControlRoomTabs {
    fun forRole(isBoD: Boolean) = buildList {
        addAll(listOf("users", "attendance", "audit", "quests"))
        if (isBoD) addAll(listOf("announcements", "extra-dayoff", "gideon", "app"))
    }
}

@Composable
private fun tabLabel(id: String) = when (id) {
    "users" -> "Users"; "attendance" -> "Absensi"; "audit" -> "Audit"; "quests" -> "Quests"; "announcements" -> "Pengumuman"
    "extra-dayoff" -> stringResource(R.string.ad_extra_dayoff); "gideon" -> "GIDEON"; else -> "App"
}

/** Everything a tab screen may ask the shell for. */
class AdminNav(
    val openUser: (String) -> Unit,
    val openChart: () -> Unit,
    val openProfile: (String) -> Unit,
    val openWeb: (String) -> Unit,
    val openAudit: (String) -> Unit = {},
    val openMemberAttendance: (String) -> Unit = {},
    val openOffices: () -> Unit = {},
)

@Composable
fun ControlRoomScreen(onBack: () -> Unit, nav: AdminNav, tabContent: @Composable (String, Boolean) -> Boolean = { _, _ -> false }) {
    val c = Nx.colors
    val viewer = (LocalContext.current.applicationContext as NexusApplication).container.viewer
    var ready by remember { mutableStateOf(viewer.role != null) }
    LaunchedEffect(Unit) { viewer.load(); ready = true }
    var tab by rememberSaveable { mutableStateOf("users") }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text("Control Room", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        if (!ready) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        // Manager and above only, as the web: anybody else gets a door they can see is locked.
        if (!viewer.canAdminister) { TabEmpty(Icons.Filled.AdminPanelSettings, stringResource(R.string.ad_no_access)); return@Column }
        val tabs = ControlRoomTabs.forRole(viewer.isBoD)
        // Pills that size to their text and scroll, not a segmented control that truncates.
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            tabs.forEach { id ->
                val on = id == tab
                Text(tabLabel(id), fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg,
                    modifier = Modifier.clip(CircleShape).background(if (on) c.violet else c.muted.copy(alpha = 0.6f)).clickable { tab = id }.padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
        HorizontalDivider(color = c.border)
        Box(Modifier.weight(1f)) {
            when (tab) {
                "users" -> UsersTab(viewer.isBoD, nav.openUser, nav.openChart)
                "attendance" -> AttendanceAdminTab(viewer.isBoD, nav.openMemberAttendance, nav.openOffices)
                "audit" -> AuditTab(nav.openAudit)
                "quests" -> QuestsTab()
                "announcements" -> AnnouncementsTab()
                "gideon" -> GideonUsageTab()
                "app" -> AppInstallsTab()
                else -> if (!tabContent(tab, viewer.isBoD)) EmptyState(Icons.Filled.AdminPanelSettings, tabLabel(tab), stringResource(R.string.not_on_android_message),
                    stringResource(R.string.open_on_web), { nav.openWeb("/admin") }, Modifier.fillMaxSize())
            }
        }
    }
}

/** Control Room › Approval chart: who approves whom; the unplaced go to every BoD. */
@Composable
fun ApprovalChartScreen(onBack: () -> Unit, onOpenUser: (String) -> Unit) {
    val api = adminApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { try { roster = api.roster(includeRegistered = false) } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.ad_chart), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        val r = roster
        when {
            r == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            r == null -> TabEmpty(Icons.Filled.AccountTree, error!!)
            else -> {
                val byApprover = r.members.filter { it.approverId != null }.groupBy { it.approverId!! }
                val approvers = r.members.filter { it.userId in byApprover.keys }.sortedWith(compareBy({ -Roles.tier(it.role) }, { it.displayName.lowercase() }))
                val unplaced = Roles.unplaced(r.members).sortedBy { it.displayName.lowercase() }
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { Text(stringResource(R.string.ad_chart_note), fontSize = 12.sp, color = c.mutedFg) }
                    items(approvers, key = { it.id }) { a ->
                        AdminCard {
                            Row(Modifier.clickable { onOpenUser(a.userId) }, verticalAlignment = Alignment.CenterVertically) {
                                Avatar(a.name, a.avatar, 30.dp); Spacer(Modifier.width(8.dp))
                                Text(a.displayName, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                                Pill(Roles.label(a.role), c.violetText)
                            }
                            byApprover[a.userId].orEmpty().sortedBy { it.displayName.lowercase() }.forEach { m ->
                                Row(Modifier.fillMaxWidth().clickable { onOpenUser(m.userId) }.padding(start = 24.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("↳ ", color = c.mutedFg); Avatar(m.name, m.avatar, 22.dp); Spacer(Modifier.width(8.dp))
                                    Text(m.displayName, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                                    Text(Roles.label(m.role), fontSize = 11.sp, color = c.mutedFg)
                                }
                            }
                        }
                    }
                    if (unplaced.isNotEmpty()) item {
                        AdminCard(stringResource(R.string.ad_chart_unplaced, unplaced.size)) {
                            Text(stringResource(R.string.ad_chart_unplaced_sub), fontSize = 12.sp, color = c.warning)
                            unplaced.forEach { m ->
                                Row(Modifier.fillMaxWidth().clickable { onOpenUser(m.userId) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(m.name, m.avatar, 22.dp); Spacer(Modifier.width(8.dp))
                                    Text(m.displayName, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                                    Text(Roles.label(m.role), fontSize = 11.sp, color = c.mutedFg)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
