package id.znetworks.nexus.ui.shell

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.WatchLater
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.AutoAwesome
import id.znetworks.nexus.feature.auth.AccountScreen
import id.znetworks.nexus.feature.home.HomeScreen
import id.znetworks.nexus.feature.chat.ChatThreadScreen
import id.znetworks.nexus.feature.chat.MessagesScreen
import id.znetworks.nexus.feature.threads.ThreadsScreen
import id.znetworks.nexus.feature.docs.DocReaderScreen
import id.znetworks.nexus.feature.docs.DocsScreen
import id.znetworks.nexus.feature.admin.AdminNav
import id.znetworks.nexus.feature.admin.AdminUserScreen
import id.znetworks.nexus.feature.admin.TeamDetailScreen
import id.znetworks.nexus.feature.projects.FolderCalendarScreen
import id.znetworks.nexus.feature.admin.ApprovalChartScreen
import id.znetworks.nexus.feature.admin.ControlRoomScreen
import id.znetworks.nexus.feature.admin.AuditEntryScreen
import id.znetworks.nexus.feature.admin.MemberAttendanceAdminScreen
import id.znetworks.nexus.feature.admin.OfficesScreen
import id.znetworks.nexus.feature.admin.ReflectionsScreen
import id.znetworks.nexus.feature.gideon.GideonScreen
import id.znetworks.nexus.feature.agenda.RoomBookingScreen
import id.znetworks.nexus.feature.agenda.TeamCalendarScreen
import id.znetworks.nexus.feature.people.LeaderboardScreen
import id.znetworks.nexus.feature.people.MemberProfileScreen
import id.znetworks.nexus.feature.reports.PersonReportScreen
import id.znetworks.nexus.feature.reports.ReportsScreen
import id.znetworks.nexus.feature.vault.VaultPublicScreen
import id.znetworks.nexus.feature.vault.VaultScreen
import id.znetworks.nexus.feature.forms.FormFillScreen
import id.znetworks.nexus.feature.forms.SubmissionsScreen
import id.znetworks.nexus.feature.forms.SubmissionDetailScreen
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.feature.tickets.TicketDetailScreen
import id.znetworks.nexus.feature.tickets.TicketsScreen
import id.znetworks.nexus.feature.whatsnew.WhatsNew
import id.znetworks.nexus.feature.whatsnew.WhatsNewSheet
import id.znetworks.nexus.feature.search.SearchScreen
import id.znetworks.nexus.feature.projects.ProjectSettingsScreen
import id.znetworks.nexus.feature.tasks.MyTasksScreen
import id.znetworks.nexus.feature.tasks.TaskDetailScreen
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import id.znetworks.nexus.feature.projects.ProjectDetailScreen
import id.znetworks.nexus.feature.projects.ProjectsScreen
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.feature.attendance.AttendanceScreen
import id.znetworks.nexus.feature.attendance.trail.TrailConsentHost
import id.znetworks.nexus.feature.inbox.AnnouncementDialog
import id.znetworks.nexus.feature.inbox.InboxScreen
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.AppTheme
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.feature.update.startUpdate
import kotlinx.coroutines.launch

private enum class Tab(val route: String, val label: Int, val icon: ImageVector, val webPath: String) {
    HOME("home", R.string.tab_home, Icons.Filled.Home, "/dashboard"),
    TASKS("tasks", R.string.tab_tasks, Icons.Filled.Checklist, "/my-tasks"),
    INBOX("inbox", R.string.tab_inbox, Icons.Filled.Inbox, "/inbox"),
    PROJECTS("projects", R.string.tab_projects, Icons.Filled.Folder, "/projects"),
    MORE("more", R.string.tab_more, Icons.Filled.Menu, ""),
}

/**
 * Phone shell: Home · Tasks · Inbox · Projects · More, as on iOS. Screens not built yet say so and
 * open the web page instead (PRD §5 Phase 1).
 */
@Composable
fun SignedInShell(session: Session, gateState: VersionGate.State, onSignOut: () -> Unit) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val pending by container.router.pending.collectAsStateWithLifecycle()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    fun goTab(t: Tab) = nav.navigate(t.route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

    // Android 13+: without this, the refused-tap notice and push never show. Asked once.
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        container.announcements.refresh()
    }

    // Links: switch to the owning screen; attendance focus is claimed by that screen itself.
    LaunchedEffect(pending) {
        when (val t = pending) {
            // Claimed by the attendance screen itself (focus survives a cold start and a sign-in).
            is Target.Attendance -> nav.navigate("attendance") { launchSingleTop = true }
            Target.Inbox -> { goTab(Tab.INBOX); container.router.consumed(t) }
            Target.Settings -> { goTab(Tab.MORE); container.router.consumed(t) }
            is Target.Tab -> { Tab.entries.firstOrNull { it.route == t.route }?.let(::goTab); container.router.consumed(t) }
            is Target.Project -> { container.router.consumed(t); nav.navigate("project/${t.id}") }
            is Target.Task -> { container.router.consumed(t); nav.navigate("task/${t.id}") }
            is Target.Threads -> { container.router.consumed(t); nav.navigate(t.postId?.let { "threads?post=$it" } ?: "threads") }
            is Target.Tickets -> { container.router.consumed(t); nav.navigate(t.ticketId?.let { "ticket/$it" } ?: "tickets") }
            is Target.Form -> { container.router.consumed(t); nav.navigate("form/${android.net.Uri.encode(t.idOrSlug)}") }
            is Target.Submissions -> { container.router.consumed(t); nav.navigate(t.submissionId?.let { "submission/$it" } ?: "submissions") }
            is Target.Docs -> { container.router.consumed(t); nav.navigate(t.docId?.let { "doc/$it" } ?: "docs") }
            is Target.Vault -> { container.router.consumed(t); nav.navigate("vault?folder=${t.folderId.orEmpty()}&trash=") }
            is Target.VaultShare -> { container.router.consumed(t); nav.navigate("vault-share/${t.slug}") }
            is Target.Reports -> { container.router.consumed(t); nav.navigate(t.userId?.let { "report/$it/0" } ?: "reports") }
            Target.RoomBooking -> { container.router.consumed(t); nav.navigate("rooms") }
            Target.TeamCalendar -> { container.router.consumed(t); nav.navigate("team-calendar") }
            Target.Admin -> { container.router.consumed(t); nav.navigate("admin") }
            Target.Leaderboard -> { container.router.consumed(t); nav.navigate("leaderboard") }
            is Target.Profile -> { container.router.consumed(t); nav.navigate("profile/${t.userId}") }
            is Target.Folder -> { container.router.consumed(t); nav.navigate("folder/${t.id}") }
            is Target.Chat -> { container.router.consumed(t); nav.navigate(t.conversationId?.let { "chat/$it" } ?: "messages") }
            is Target.Announcement -> { container.router.consumed(t); container.announcements.showOne(t.id) }
            is Target.Web -> { container.router.consumed(t); openWeb(context, t.path) }
            is Target.External -> { container.router.consumed(t); openUrl(context, t.url) }
            // Signed in already: nothing to reset or register.
            is Target.ResetPassword, is Target.Register -> container.router.consumed(t)
            null -> Unit
        }
    }

    // The location disclosure can come due from any screen (a queued check-in landing, a refresh).
    TrailConsentHost(container.workTrail)
    AnnouncementDialog(container.announcements)
    // Once per version, after the location disclosure and announcements have had their turn.
    val version = container.identity.versionName
    var whatsNew by rememberSaveable { mutableStateOf(WhatsNew.due(context, version)) }
    if (whatsNew) WhatsNewSheet(version) { WhatsNew.seen(context, version); whatsNew = false }

    // Tablets and unfolded phones: the same five tabs as a rail on the left (PRD Phase 5).
    val rail = ShellLayout.useRail(androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp)
    val current = Tab.entries.firstOrNull { it.route == route }
        ?: Tab.entries.firstOrNull { t -> backStack?.destination?.hierarchy?.any { it.route == t.route } == true }
    Scaffold(
        containerColor = Nx.colors.background,
        bottomBar = {
            if (!rail) NavigationBar(containerColor = Nx.colors.card) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = t == current, onClick = { goTab(t) },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(stringResource(t.label)) },
                    )
                }
            }
        },
    ) { padding ->
      androidx.compose.foundation.layout.Row(Modifier.fillMaxSize().padding(padding)) {
        if (rail) androidx.compose.material3.NavigationRail(containerColor = Nx.colors.card) {
            Tab.entries.forEach { t ->
                androidx.compose.material3.NavigationRailItem(
                    selected = t == current, onClick = { goTab(t) },
                    icon = { Icon(t.icon, contentDescription = null) },
                    label = { Text(stringResource(t.label)) },
                )
            }
        }
        NavHost(nav, startDestination = Tab.HOME.route, modifier = Modifier.weight(1f).fillMaxSize()) {
            composable(Tab.HOME.route) {
                HomeScreen(
                    onOpenAttendance = { nav.navigate("attendance") { launchSingleTop = true } },
                    onOpenInbox = { goTab(Tab.INBOX) },
                    onSearch = { nav.navigate("search") },
                    onOpenProject = { nav.navigate("project/$it") },
                    onOpenTask = { nav.navigate("task/$it") },
                    onOpenSettings = { goTab(Tab.MORE) },
                    // Quick actions built in the app open here; the rest on the web until built.
                    onOpenGideon = { nav.navigate("gideon") },
                    onOpenWeb = { when (it) { "/messages" -> nav.navigate("messages"); "/threads" -> nav.navigate("threads"); "/leaderboard" -> nav.navigate("leaderboard"); "/room-booking" -> nav.navigate("rooms"); "/master-calendar" -> nav.navigate("team-calendar"); else -> openWeb(context, it) } },
                )
            }
            composable("account") { AccountScreen(onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }) }
            composable("threads?post={post}", arguments = listOf(androidx.navigation.navArgument("post") { nullable = true; defaultValue = null })) { e ->
                ThreadsScreen(onBack = { nav.popBackStack() }, focusPostId = e.arguments?.getString("post"))
            }
            composable("tickets") { TicketsScreen(onBack = { nav.popBackStack() }, onOpenTicket = { nav.navigate("ticket/$it") }) }
            composable("ticket/{id}") { TicketDetailScreen(onBack = { nav.popBackStack() }) }
            composable("form/{id}") { FormFillScreen(onBack = { nav.popBackStack() }, onOpenSubmissions = { nav.navigate("submissions") }) }
            composable("submissions") { SubmissionsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate("submission/$it") }) }
            composable("submission/{id}") { e ->
                val scope = androidx.compose.runtime.rememberCoroutineScope()
                SubmissionDetailScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") },
                    onOpenFile = { url -> scope.launch { runCatching { FileOpener.open(context, container.api, url, url.substringAfterLast('/')) } } })
            }
            composable("docs") { DocsScreen(onBack = { nav.popBackStack() }, onOpenDoc = { nav.navigate("doc/$it") }) }
            composable("doc/{id}") { e -> DocReaderScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }) }
            composable("vault?folder={folder}&trash={trash}", arguments = listOf(
                androidx.navigation.navArgument("folder") { nullable = true; defaultValue = null },
                androidx.navigation.navArgument("trash") { nullable = true; defaultValue = null },
            )) {
                VaultScreen(onBack = { nav.popBackStack() }, onOpenFolder = { nav.navigate("vault?folder=$it&trash=") }, onOpenTrash = { nav.navigate("vault?folder=&trash=1") })
            }
            composable("vault-share/{slug}") { e -> VaultPublicScreen(e.arguments?.getString("slug").orEmpty(), onBack = { nav.popBackStack() }) }
            composable("reports") {
                ReportsScreen(onBack = { nav.popBackStack() }, onOpenPerson = { id, off -> nav.navigate("report/$id/$off") }, onOpenTask = { nav.navigate("task/$it") })
            }
            composable("report/{id}/{offset}") { e ->
                PersonReportScreen(e.arguments?.getString("id").orEmpty(), e.arguments?.getString("offset")?.toIntOrNull() ?: 0,
                    onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") })
            }
            composable("leaderboard") { LeaderboardScreen(onBack = { nav.popBackStack() }, onOpenPerson = { nav.navigate("profile/$it") }) }
            composable("profile/{id}") { e -> MemberProfileScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenChat = { nav.navigate("chat/$it") }) }
            composable("rooms") { RoomBookingScreen(onBack = { nav.popBackStack() }) }
            composable("team-calendar") { TeamCalendarScreen(onBack = { nav.popBackStack() }) }
            composable("gideon") { GideonScreen(onBack = { nav.popBackStack() }) }
            composable("admin") {
                ControlRoomScreen(onBack = { nav.popBackStack() }, nav = AdminNav(
                    openUser = { nav.navigate("admin-user/$it") }, openChart = { nav.navigate("admin-chart") },
                    openProfile = { nav.navigate("profile/$it") }, openWeb = { openWeb(context, it) }, openAudit = { nav.navigate("audit/$it") },
                    openMemberAttendance = { nav.navigate("admin-att/$it") }, openOffices = { nav.navigate("admin-offices") },
                ))
            }
            composable("admin-user/{id}") { e -> AdminUserScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }, onOpenTeam = { nav.navigate("admin-team/$it") }) }
            composable("folder/{id}") { e -> FolderCalendarScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") }) }
            composable("admin-team/{id}") { e -> TeamDetailScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }) }
            composable("admin-att/{id}") { e -> MemberAttendanceAdminScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenReflections = { nav.navigate("reflections/$it") }) }
            composable("admin-offices") { OfficesScreen(onBack = { nav.popBackStack() }) }
            composable("reflections/{id}") { e -> ReflectionsScreen(e.arguments?.getString("id"), onBack = { nav.popBackStack() }) }
            composable("audit/{id}") { e -> AuditEntryScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }) }
            composable("admin-chart") { ApprovalChartScreen(onBack = { nav.popBackStack() }, onOpenUser = { nav.navigate("admin-user/$it") }) }
            composable("messages") { MessagesScreen(onBack = { nav.popBackStack() }, onOpenChat = { nav.navigate("chat/$it") }) }
            composable("chat/{id}") { ChatThreadScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") }) }
            composable("search") {
                SearchScreen(
                    onBack = { nav.popBackStack() },
                    onOpenTask = { nav.navigate("task/$it") },
                    onOpenProject = { nav.navigate("project/$it") },
                    onOpenWeb = { openWeb(context, it) },
                    onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") },
                    onOpenDoc = { nav.navigate("doc/$it") },
                    onOpenPerson = { nav.navigate("profile/$it") },
                )
            }
            composable("attendance") { AttendanceScreen(onBack = { nav.popBackStack() }) }
            composable(Tab.TASKS.route) { MyTasksScreen(onOpenTask = { nav.navigate("task/$it") }, onBrowseProjects = { goTab(Tab.PROJECTS) }) }
            composable(Tab.INBOX.route) { InboxScreen() }
            composable(Tab.PROJECTS.route) {
                ProjectsScreen(onOpenProject = { nav.navigate("project/$it") }, onOpenTask = { nav.navigate("task/$it") }, onOpenFolder = { nav.navigate("folder/$it") })
            }
            composable(Tab.MORE.route) { MoreScreen(session, gateState, onSignOut, onOpenAttendance = { nav.navigate("attendance") { launchSingleTop = true } }, onOpenAccount = { nav.navigate("account") }, onOpenWhatsNew = { whatsNew = true }, onOpenTickets = { nav.navigate("tickets") }, onOpenSubmissions = { nav.navigate("submissions") }, onOpenDocs = { nav.navigate("docs") }, onOpenVault = { nav.navigate("vault?folder=&trash=") }, onOpenReports = { nav.navigate("reports") }, onOpenAdmin = { nav.navigate("admin") }) }
            composable("project/{id}") { entry ->
                ProjectDetailScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") },
                    onOpenSettings = { nav.navigate("project/${entry.arguments?.getString("id")}/settings") },
                    onOpenChat = { nav.navigate("chat/$it") },
                    onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") },
                    onOpenDoc = { nav.navigate("doc/$it") })
            }
            composable("project/{id}/settings") {
                ProjectSettingsScreen(
                    onBack = { nav.popBackStack() },
                    // Deleted: out of the settings AND the project that no longer exists.
                    onDeleted = { nav.popBackStack(); nav.popBackStack() },
                    onOpenProject = { nav.navigate("project/$it") },
                )
            }
            composable("task/{id}") {
                TaskDetailScreen(
                    onBack = { nav.popBackStack() },
                    onOpenTask = { nav.navigate("task/$it") },
                    onOpenProject = { nav.navigate("project/$it") },
                )
            }
        }
      }
    }
}

/** Where the tabs go: a bottom bar on phones, a rail from 600 dp wide (Material's medium width). */
object ShellLayout {
    fun useRail(widthDp: Int) = widthDp >= 600
}

@Composable
private fun NotYet(tab: Tab) {
    val context = LocalContext.current
    EmptyState(
        icon = tab.icon,
        title = stringResource(R.string.not_on_android_title),
        message = stringResource(R.string.not_on_android_message),
        actionLabel = stringResource(R.string.open_on_web),
        onAction = { openWeb(context, tab.webPath) },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun MoreScreen(session: Session, gateState: VersionGate.State, onSignOut: () -> Unit, onOpenAttendance: () -> Unit, onOpenAccount: () -> Unit, onOpenWhatsNew: () -> Unit, onOpenTickets: () -> Unit, onOpenSubmissions: () -> Unit, onOpenDocs: () -> Unit, onOpenVault: () -> Unit, onOpenReports: () -> Unit, onOpenAdmin: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val theme by container.appearance.theme.collectAsStateWithLifecycle()
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var pickLanguage by rememberSaveable { mutableStateOf(false) }
    var pickTheme by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val itemColors = ListItemDefaults.colors(containerColor = c.card)
    val shape = Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(session.userName.ifBlank { session.userEmail }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
        Text(session.userEmail, color = c.mutedFg)
        Spacer(Modifier.height(20.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.home_attendance)) },
            supportingContent = { Text(stringResource(R.string.more_attendance_sub)) },
            leadingContent = { Icon(Icons.Filled.WatchLater, null, tint = c.success) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenAttendance),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.acct_title)) },
            supportingContent = { Text(stringResource(R.string.acct_sub)) },
            leadingContent = { Icon(Icons.Filled.Key, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenAccount),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.tk_title)) },
            supportingContent = { Text(stringResource(R.string.tk_more_sub)) },
            leadingContent = { Icon(Icons.Filled.SupportAgent, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenTickets),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.form_my_submissions)) },
            supportingContent = { Text(stringResource(R.string.form_more_sub)) },
            leadingContent = { Icon(Icons.Filled.Assignment, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenSubmissions),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text("Knowledge Library") },
            supportingContent = { Text(stringResource(R.string.docs_more_sub)) },
            leadingContent = { Icon(Icons.Filled.MenuBook, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenDocs),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text("Z Vault") },
            supportingContent = { Text(stringResource(R.string.vault_more_sub)) },
            leadingContent = { Icon(Icons.Filled.Folder, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenVault),
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.rp_title)) },
            supportingContent = { Text(stringResource(R.string.rp_more_sub)) },
            leadingContent = { Icon(Icons.Filled.BarChart, null, tint = c.violetText) },
            colors = itemColors, modifier = shape.clickable(onClick = onOpenReports),
        )
        Spacer(Modifier.height(12.dp))
        // Control Room is drawn for MANAGER and above only (the server re-checks every call).
        val canAdmin by androidx.compose.runtime.produceState(container.viewer.canAdminister) { container.viewer.load(); value = container.viewer.canAdminister }
        if (canAdmin) {
            ListItem(
                headlineContent = { Text("Control Room") },
                supportingContent = { Text(stringResource(R.string.ad_more_sub)) },
                leadingContent = { Icon(Icons.Filled.AdminPanelSettings, null, tint = c.violetText) },
                colors = itemColors, modifier = shape.clickable(onClick = onOpenAdmin),
            )
            Spacer(Modifier.height(12.dp))
        }
        if (WhatsNew.entries(container.identity.versionName).isNotEmpty()) {
            ListItem(
                headlineContent = { Text(stringResource(R.string.wn_title)) },
                supportingContent = { Text(stringResource(R.string.wn_version, container.identity.versionName)) },
                leadingContent = { Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText) },
                colors = itemColors, modifier = shape.clickable(onClick = onOpenWhatsNew),
            )
            Spacer(Modifier.height(12.dp))
        }
        gateState.available?.let { version ->
            // Soft "update available": Tuning Room only, never a nag (REQ-ATT-41).
            ListItem(
                headlineContent = { Text(stringResource(R.string.update_available, version)) },
                leadingContent = { Icon(Icons.Filled.SystemUpdate, null, tint = c.violetText) },
                colors = itemColors, modifier = shape,
                trailingContent = { TextButton(onClick = { startUpdate(context, gateState.storeUrl) }) { Text(stringResource(R.string.update_action)) } },
            )
            Spacer(Modifier.height(12.dp))
        }
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_language)) },
            supportingContent = { Text(stringResource(R.string.settings_language_current)) },
            leadingContent = { Icon(Icons.Filled.Translate, null) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { pickLanguage = true }) { Text(stringResource(R.string.change)) } },
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_appearance)) },
            supportingContent = { Text(stringResource(themeLabel(theme))) },
            leadingContent = { Icon(Icons.Filled.DarkMode, null) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { pickTheme = true }) { Text(stringResource(R.string.change)) } },
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.logout), color = c.danger) },
            leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = c.danger) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { confirmLogout = true }) { Text(stringResource(R.string.logout), color = c.danger) } },
        )
        Spacer(Modifier.height(24.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.delete_account), color = c.danger) },
            supportingContent = { Text(stringResource(R.string.delete_account_sub)) },
            leadingContent = { Icon(Icons.Filled.DeleteForever, null, tint = c.danger) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { deleting = true }) { Text(stringResource(R.string.delete), color = c.danger) } },
        )
        Spacer(Modifier.height(12.dp))
        id.znetworks.nexus.core.offline.OfflineCard()
        Spacer(Modifier.height(12.dp))
        Text("NEXUS ${container.identity.versionName} (${container.identity.versionCode})", fontSize = 11.sp, color = c.mutedFg)
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.logout_confirm_title)) },
            text = { Text(stringResource(R.string.logout_confirm_message)) },
            confirmButton = { TextButton(onClick = { confirmLogout = false; onSignOut() }) { Text(stringResource(R.string.logout), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (pickLanguage) {
        AlertDialog(
            onDismissRequest = { pickLanguage = false },
            title = { Text(stringResource(R.string.settings_language)) },
            text = {
                Column {
                    // Applies immediately, no restart; also shows in Android 13+'s per-app language setting.
                    TextButton(onClick = { pickLanguage = false; setLanguage("en") }) { Text("English") }
                    TextButton(onClick = { pickLanguage = false; setLanguage("in") }) { Text("Bahasa Indonesia") }
                }
            },
            confirmButton = { TextButton(onClick = { pickLanguage = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (pickTheme) {
        AlertDialog(
            onDismissRequest = { pickTheme = false },
            title = { Text(stringResource(R.string.settings_appearance)) },
            text = {
                Column {
                    AppTheme.entries.forEach { t ->
                        TextButton(onClick = { pickTheme = false; container.appearance.set(t) }) { Text(stringResource(themeLabel(t))) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pickTheme = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    // deleteAccount() already runs the full logout; the root then shows the login screen.
    if (deleting) DeleteAccountDialog(onDone = { deleting = false }, onCancel = { deleting = false })
}

private fun themeLabel(t: AppTheme) = when (t) {
    AppTheme.SYSTEM -> R.string.theme_system
    AppTheme.LIGHT -> R.string.theme_light
    AppTheme.DARK -> R.string.theme_dark
}

/**
 * Deactivates and anonymises (history stays as "Deleted account"). The person types DELETE first,
 * as on iOS. Owner decision: deletion lives in the app.
 */
@Composable
private fun DeleteAccountDialog(onDone: () -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    var typed by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onCancel() },
        title = { Text(stringResource(R.string.delete_account)) },
        text = {
            Column {
                Text(stringResource(R.string.delete_account_body))
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(typed, { typed = it }, singleLine = true, placeholder = { Text("DELETE") })
                error?.let { Text(it, color = Nx.colors.danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(enabled = typed.trim() == "DELETE" && !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        container.auth.deleteAccount()
                        onDone()
                    } catch (e: ApiError) {
                        // 409 names the workspace this person is the last owner of: said verbatim.
                        error = e.describe(context.resources)
                        busy = false
                    }
                }
            }) { if (busy) CircularProgressIndicator() else Text(stringResource(R.string.delete), color = Nx.colors.danger) }
        },
        dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

private fun setLanguage(tag: String) = AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))

fun openWeb(context: Context, path: String) = openUrl(context, NexusConfig.PUBLIC_BASE + path)

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
