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
import androidx.compose.runtime.collectAsState
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
    /** [fakeGps]: the server's `fakeGpsReview` flag (remote config). */
    fun forRole(isBoD: Boolean, fakeGps: Boolean = true) = buildList {
        addAll(listOf("users", "attendance", "audit", "quests"))
        if (isBoD) addAll(listOfNotNull("announcements", "extra-dayoff", "suspects".takeIf { fakeGps }, "gideon", "app"))
    }
}

@Composable
private fun tabLabel(id: String) = when (id) {
    "users" -> "Users"; "attendance" -> "Absensi"; "audit" -> "Audit"; "quests" -> "Quests"; "announcements" -> "Pengumuman"
    "extra-dayoff" -> stringResource(R.string.ad_extra_dayoff); "suspects" -> stringResource(R.string.fg_fake); "gideon" -> "GIDEON"; else -> "App"
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
        val config by (LocalContext.current.applicationContext as NexusApplication).container.remoteConfig.body.collectAsState()
        val tabs = ControlRoomTabs.forRole(viewer.isBoD, config.fakeGpsReview)
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
                "extra-dayoff" -> ExtraDayOffTab(viewer.isBoD)
                "suspects" -> FakeGpsTab()
                "announcements" -> AnnouncementsTab()
                "gideon" -> GideonUsageTab()
                "app" -> AppInstallsTab()
                else -> if (!tabContent(tab, viewer.isBoD)) EmptyState(Icons.Filled.AdminPanelSettings, tabLabel(tab), stringResource(R.string.not_on_android_message),
                    stringResource(R.string.open_on_web), { nav.openWeb("/admin") }, Modifier.fillMaxSize())
            }
        }
    }
}
