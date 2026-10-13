package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PageTab
import id.znetworks.nexus.ui.components.PageTabs
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
    "users" -> "Users"; "attendance" -> stringResource(R.string.home_attendance); "audit" -> "Audit"; "quests" -> "Quests"; "announcements" -> stringResource(R.string.an_tab)
    "extra-dayoff" -> stringResource(R.string.ad_extra_dayoff); "suspects" -> stringResource(R.string.fg_tab); "gideon" -> "GIDEON"; else -> "App"
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
    /** Bagan IP & Divisi (replaced the Teams screen, 5 Oct 2026). */
    val openOrgChart: () -> Unit = {},
)

@Composable
fun ControlRoomScreen(onBack: () -> Unit, nav: AdminNav, tabContent: @Composable (String, Boolean) -> Boolean = { _, _ -> false }) {
    val c = Nx.colors
    val viewer = (LocalContext.current.applicationContext as NexusApplication).container.viewer
    var ready by remember { mutableStateOf(viewer.role != null) }
    LaunchedEffect(Unit) { viewer.load(); ready = true }
    var tab by rememberSaveable { mutableStateOf("users") }
    Column(Modifier.fillMaxSize().background(c.background).dismissKeyboardOnTapOrDrag()) {
        val config by (LocalContext.current.applicationContext as NexusApplication).container.remoteConfig.body.collectAsState()
        val open = ready && viewer.canAdminister
        val tabs = ControlRoomTabs.forRole(viewer.isBoD, config.fakeGpsReview)
        // The sections as the web's underline tabs (scroll sideways when they don't fit), only once access is known.
        PageHeader(stringResource(R.string.mt_control), subtitle = stringResource(R.string.sub_admin), onBack = onBack,
            tabs = if (open) { { PageTabs(tabs.map { PageTab(it, tabLabel(it)) }, tab, { tab = it }) } } else null)
        if (!ready) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        // Manager and above only, as the web: anybody else gets a door they can see is locked.
        if (!viewer.canAdminister) { TabEmpty(Icons.Filled.AdminPanelSettings, stringResource(R.string.ad_no_access)); return@Column }
        Box(Modifier.weight(1f)) {
            when (tab) {
                "users" -> UsersTab(viewer.isBoD, nav.openUser, nav.openChart, nav.openOrgChart)
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
