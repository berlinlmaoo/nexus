package id.znetworks.nexus.ui.shell

import androidx.compose.material.icons.automirrored.filled.Chat
import id.znetworks.nexus.feature.forms.FormBuilderScreen
import id.znetworks.nexus.feature.chat.ChatSearchScreen
import id.znetworks.nexus.feature.chat.ChatMediaScreen
import id.znetworks.nexus.feature.chat.ChatInfoScreen
import id.znetworks.nexus.feature.admin.RestoreTarget
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import id.znetworks.nexus.core.Badges
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
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
import id.znetworks.nexus.feature.admin.orgchart.OrgChartScreen
import id.znetworks.nexus.feature.projects.FolderCalendarScreen
import id.znetworks.nexus.feature.admin.ApprovalChartScreen
import id.znetworks.nexus.feature.admin.ControlRoomScreen
import id.znetworks.nexus.feature.admin.AuditEntryScreen
import id.znetworks.nexus.feature.admin.MemberAttendanceAdminScreen
import id.znetworks.nexus.feature.admin.OfficesScreen
import id.znetworks.nexus.feature.admin.ReflectionsScreen
import id.znetworks.nexus.feature.gideon.GideonScreen
import id.znetworks.nexus.feature.agenda.RoomBookingScreen
import id.znetworks.nexus.feature.calendar.CalendarScreen
import id.znetworks.nexus.feature.calendar.TaskPreviewScreen
import id.znetworks.nexus.feature.calendar.CalendarQuadrantScreen
import id.znetworks.nexus.feature.people.LeaderboardScreen
import id.znetworks.nexus.feature.people.MemberProfileScreen
import id.znetworks.nexus.feature.reports.PersonReportScreen
import id.znetworks.nexus.feature.reports.ReportsScreen
import id.znetworks.nexus.feature.vault.VaultPublicScreen
import id.znetworks.nexus.feature.vault.VaultScreen
import id.znetworks.nexus.feature.forms.FormFillScreen
import id.znetworks.nexus.feature.forms.FormsScreen
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
import androidx.compose.foundation.layout.consumeWindowInsets
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
import androidx.compose.runtime.remember
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
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.EnterTransition
import id.znetworks.nexus.ui.components.CompanyOnly
import id.znetworks.nexus.ui.components.rememberIsCompany
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

internal enum class Tab(val route: String, val label: Int, val icon: ImageVector, val webPath: String) {
    HOME("home", R.string.tab_home, Icons.Filled.Home, "/dashboard"),
    TASKS("tasks", R.string.tab_tasks, Icons.Filled.Checklist, "/my-tasks"),
    /** The chat list (9 Oct, NAV-HOME-GROUP): a tab with its own back stack, in the slot Tasks had. */
    CHAT("messages", R.string.tab_chat, Icons.AutoMirrored.Filled.Chat, "/messages"),
    INBOX("inbox", R.string.tab_inbox, Icons.Filled.Inbox, "/inbox"),
    CALENDAR("calendar", R.string.tab_calendar, Icons.Filled.CalendarMonth, "/calendar"),
    PROJECTS("projects", R.string.tab_projects, Icons.Filled.Folder, "/projects"),
    MORE("more", R.string.tab_more, Icons.Filled.Menu, ""),
}

/**
 * The tabs (Berlin, 8 Oct): Home · Tasks · Calendar · Projects · More; Inbox moved into More, which
 * carries its unread badge. With the server's `flags.calendar` off, Inbox takes the Calendar's place.
 */
internal object ShellTabs {
    fun routes(calendarOn: Boolean): List<String> =
        if (calendarOn) listOf("home", "messages", "calendar", "projects", "more") else listOf("home", "messages", "inbox", "projects", "more")
    /** The tab a destination belongs to: "calendar?date={date}…" is the Calendar tab. */
    fun tabOf(route: String?): String? = route?.substringBefore('?')
}

/**
 * Phone shell: the five tabs of [ShellTabs], as on iOS. Screens not built yet say so and
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
    /** Inbox: its tab when it has one, else a screen pushed over the current one (it lives in More now). */
    fun openInbox() {
        if (!container.remoteConfig.current.calendar) goTab(Tab.INBOX) else nav.navigate(Tab.INBOX.route) { launchSingleTop = true }
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
            Target.Inbox -> { openInbox(); container.router.consumed(t) }
            Target.Settings -> { goTab(Tab.MORE); container.router.consumed(t) }
            is Target.Tab -> { Tab.entries.firstOrNull { it.route == t.route }?.let(::goTab); container.router.consumed(t) }
            is Target.Project -> { container.router.consumed(t); nav.navigate("project/${enc(t.id)}") }
            is Target.Task -> { container.router.consumed(t); nav.navigate("task/${enc(t.id)}") }
            is Target.Threads -> { container.router.consumed(t); nav.navigate(t.postId?.let { "threads?post=${enc(it)}" } ?: "threads") }
            is Target.Tickets -> { container.router.consumed(t); nav.navigate(t.ticketId?.let { "ticket/${enc(it)}" } ?: "tickets") }
            is Target.Form -> { container.router.consumed(t); nav.navigate("form/${enc(t.idOrSlug)}") }
            is Target.Submissions -> { container.router.consumed(t); nav.navigate(t.submissionId?.let { "submission/${enc(it)}" } ?: "submissions") }
            is Target.Docs -> { container.router.consumed(t); nav.navigate(t.docId?.let { "doc/${enc(it)}" } ?: "docs") }
            is Target.Vault -> { container.router.consumed(t); nav.navigate("vault?folder=${enc(t.folderId.orEmpty())}&trash=") }
            is Target.VaultShare -> { container.router.consumed(t); nav.navigate("vault-share/${enc(t.slug)}") }
            is Target.Reports -> { container.router.consumed(t); nav.navigate(t.userId?.let { "report/${enc(it)}/0" } ?: "reports") }
            Target.RoomBooking -> { container.router.consumed(t); nav.navigate("rooms") }
            is Target.Calendar -> {
                container.router.consumed(t)
                // A quadrant widget's whole list (audit #40).
                if (t.view == "quadrant") nav.navigate("calendar-list?q=${enc(t.q.orEmpty())}&scope=${enc(t.scope.orEmpty())}") { launchSingleTop = true }
                // A fresh nonce: the same link tapped again (a widget, a notification) is applied again,
                // while the entry never re-applies one it already used (CalendarLinkGate).
                else nav.navigate(calendarRoute(t.date, t.view, t.lens, t.focus, t.scope, t.task, nonce = System.currentTimeMillis().toString())) { launchSingleTop = true }
            }
            Target.Admin -> { container.router.consumed(t); nav.navigate("admin") }
            Target.Leaderboard -> { container.router.consumed(t); nav.navigate("leaderboard") }
            is Target.Profile -> { container.router.consumed(t); nav.navigate("profile/${enc(t.userId)}") }
            is Target.Folder -> { container.router.consumed(t); nav.navigate("folder/${enc(t.id)}") }
            is Target.Chat -> {
                container.router.consumed(t)
                // Already in that thread (a push tapped while reading it): stay, no second copy (CHAT-REPORT P0).
                val here = nav.currentBackStackEntry
                val inThread = here?.destination?.route == ShellRoutes.CHAT && here.arguments?.getString("id") == t.conversationId
                // A chat push or link opens the Chat tab and pushes that chat on it (NAV-HOME-GROUP).
                if (!inThread) { goTab(Tab.CHAT); t.conversationId?.let { nav.navigate("chat/${enc(it)}") { launchSingleTop = true } } }
            }
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
    // Taken away in the middle of a workday: asked again on every return to the app (iOS 77818ba).
    var alwaysAgain by rememberSaveable { mutableStateOf(false) }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        if (container.remoteConfig.current.requireAlwaysLocation && container.workdayOpen() &&
            id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.missing(context) != null) alwaysAgain = true
        onPauseOrDispose { }
    }
    if (alwaysAgain) id.znetworks.nexus.feature.attendance.trail.AlwaysLocationDialog(onDismiss = { alwaysAgain = false }) { alwaysAgain = false }
    AnnouncementDialog(container.announcements)
    // Once per version, after the location disclosure and announcements have had their turn.
    val version = container.identity.versionName
    var whatsNew by rememberSaveable { mutableStateOf(WhatsNew.due(context, version)) }
    if (whatsNew) WhatsNewSheet(version) { WhatsNew.seen(context, version); whatsNew = false }

    // Tablets and unfolded phones: the same five tabs as a rail on the left (PRD Phase 5).
    val rail = ShellLayout.useRail(androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp)
    val calendarOn = container.remoteConfig.body.collectAsStateWithLifecycle().value.calendar
    val tabs = ShellTabs.routes(calendarOn).mapNotNull { r -> Tab.entries.firstOrNull { it.route == r } }
    val current = tabs.firstOrNull { it.route == ShellTabs.tabOf(route) }
        ?: tabs.firstOrNull { t -> backStack?.destination?.hierarchy?.any { ShellTabs.tabOf(it.route) == t.route } == true }
    // Inbox's unread on whichever entry holds Inbox now: its own tab, or More (Berlin, 8 Oct).
    val inboxUnread by container.badges.inboxUnread.collectAsStateWithLifecycle()
    // Chat carries the chat total (muted rooms left out); More only Inbox's, when Inbox has no tab (NAV-HOME-GROUP).
    val chatUnread by container.badges.chatUnread.collectAsStateWithLifecycle()
    val badgeOn: (Tab) -> String? = { t -> when {
        t == Tab.CHAT -> Badges.label(chatUnread)
        t == Tab.INBOX || (t == Tab.MORE && Tab.INBOX !in tabs) -> Badges.label(inboxUnread)
        else -> null
    } }
    Scaffold(
        containerColor = Nx.colors.background,
        bottomBar = {
            if (!rail) ShellBar(tabs, current, badgeOn, rail = false) { goTab(it) }
        },
    ) { padding ->
      // The bars' padding is consumed here: a screen's imePadding then adds only what the keyboard
      // covers beyond the bottom bar, not the bar again (the gap above the keyboard, point 6).
      androidx.compose.foundation.layout.Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
        if (rail) ShellBar(tabs, current, badgeOn, rail = true) { goTab(it) }
        // iOS push/pop (Berlin, 29 Sep, point 7): a screen slides in from the right and, on back, out to
        // the right while the one below comes back from the left; never a scale/zoom. The predictive
        // back gesture drives the same pop transition. Switching tabs has no animation, as the iOS tab bar.
        NavHost(nav, startDestination = Tab.HOME.route, modifier = Modifier.weight(1f).fillMaxSize(),
            enterTransition = { if (ShellMotion.betweenTabs(initialState.destination.route, targetState.destination.route)) EnterTransition.None else ShellMotion.pushIn },
            exitTransition = { if (ShellMotion.betweenTabs(initialState.destination.route, targetState.destination.route)) ExitTransition.None else ShellMotion.pushOut },
            popEnterTransition = { if (ShellMotion.betweenTabs(initialState.destination.route, targetState.destination.route)) EnterTransition.None else ShellMotion.popIn },
            popExitTransition = { if (ShellMotion.betweenTabs(initialState.destination.route, targetState.destination.route)) ExitTransition.None else ShellMotion.popOut },
        ) {
            composable(Tab.HOME.route) {
                HomeScreen(
                    onOpenAttendance = { nav.navigate("attendance") { launchSingleTop = true } },
                    onOpenInbox = { openInbox() },
                    onSearch = { nav.navigate("search") },
                    onOpenProject = { nav.navigate("project/$it") },
                    onOpenTask = { nav.navigate("task/$it") },
                    onOpenSettings = { goTab(Tab.MORE) },
                    // Quick actions built in the app open here; the rest on the web until built.
                    onOpenGideon = { nav.navigate("gideon") },
                    onOpenWeb = { when (it) { "/messages" -> goTab(Tab.CHAT); "/vault" -> nav.navigate("vault?folder=&trash="); "/tickets" -> nav.navigate("tickets"); "/threads" -> nav.navigate("threads"); "/leaderboard" -> nav.navigate("leaderboard"); "/room-booking" -> nav.navigate("rooms"); "/master-calendar", "/calendar" -> nav.navigate("calendar"); else -> openWeb(context, it) } },
                )
            }
            composable("account") {
                val logout = rememberLogout(onSignOut) { nav.navigate("attendance") { launchSingleTop = true } }
                // deleteAccount() already runs the full logout; the root then shows the login screen.
                var deleting by rememberSaveable { mutableStateOf(false) }
                AccountScreen(onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }, onLogout = logout, onDeleteAccount = { deleting = true })
                if (deleting) DeleteAccountDialog(onDone = { deleting = false }, onCancel = { deleting = false })
            }
            composable("forms") { FormsScreen(onBack = { nav.popBackStack() }, onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") }) }
            composable("threads?post={post}", arguments = listOf(androidx.navigation.navArgument("post") { nullable = true; defaultValue = null })) { e ->
                CompanyOnly(onBack = { nav.popBackStack() }) {
                    ThreadsScreen(onBack = { nav.popBackStack() }, focusPostId = e.arguments?.getString("post"))
                }
            }
            composable("tickets") { TicketsScreen(onBack = { nav.popBackStack() }, onOpenTicket = { nav.navigate("ticket/$it") }) }
            composable("ticket/{id}") { TicketDetailScreen(onBack = { nav.popBackStack() }) }
            composable("form/{id}") { FormFillScreen(onBack = { nav.popBackStack() }, onOpenSubmissions = { nav.navigate("submissions") }) }
            composable("submissions") { SubmissionsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate("submission/${enc(it)}") }, onOpenForms = { nav.navigate("forms") }) }
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
                CompanyOnly(onBack = { nav.popBackStack() }) {
                    VaultScreen(onBack = { nav.popBackStack() }, onOpenFolder = { nav.navigate("vault?folder=$it&trash=") }, onOpenTrash = { nav.navigate("vault?folder=&trash=1") })
                }
            }
            composable("vault-share/{slug}") { e ->
                CompanyOnly(onBack = { nav.popBackStack() }) { VaultPublicScreen(e.arguments?.getString("slug").orEmpty(), onBack = { nav.popBackStack() }) }
            }
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
            // The master Calendar; `team-calendar` stays as an alias for old links and shortcuts.
            composable("calendar?date={date}&view={view}&lens={lens}&focus={focus}&scope={scope}&task={task}&n={n}",
                arguments = listOf("date", "view", "lens", "focus", "scope", "task", "n").map { a -> androidx.navigation.navArgument(a) { nullable = true; defaultValue = null } }) { e ->
                val a = e.arguments
                CalendarScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } }, onOpenMyMission = { goTab(Tab.TASKS) },
                    date = a?.getString("date"), view = a?.getString("view"), lens = a?.getString("lens"), focus = a?.getString("focus"), scope = a?.getString("scope"), task = a?.getString("task"),
                    nonce = a?.getString("n"),
                    onOpenPreview = { id, project -> nav.navigate("task-preview/${enc(id)}?project=${enc(project.orEmpty())}") { launchSingleTop = true } })
            }
            composable("team-calendar") { CalendarScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } }, onOpenMyMission = { goTab(Tab.TASKS) },
                onOpenPreview = { id, project -> nav.navigate("task-preview/${enc(id)}?project=${enc(project.orEmpty())}") { launchSingleTop = true } }) }
            composable("calendar-list?q={q}&scope={scope}", arguments = listOf("q", "scope").map { a -> androidx.navigation.navArgument(a) { nullable = true; defaultValue = null } }) { e ->
                CalendarQuadrantScreen(e.arguments?.getString("q"), e.arguments?.getString("scope"), onBack = { nav.popBackStack() },
                    onOpenDay = { day, scope -> nav.navigate(calendarRoute(date = day, scope = scope, nonce = System.currentTimeMillis().toString())) { launchSingleTop = true } },
                    onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } },
                    onOpenPreview = { id, project -> nav.navigate("task-preview/${enc(id)}?project=${enc(project.orEmpty())}") { launchSingleTop = true } })
            }
            // A task the viewer may read but not edit: a destination like the task screen (audit #38).
            composable("task-preview/{id}?project={project}", arguments = listOf(androidx.navigation.navArgument("project") { nullable = true; defaultValue = null })) { e ->
                TaskPreviewScreen(e.arguments?.getString("id").orEmpty(), e.arguments?.getString("project")?.takeIf { it.isNotEmpty() }) { nav.popBackStack() }
            }
            composable("gideon") { GideonScreen(onBack = { nav.popBackStack() }) }
            composable("admin") {
                ControlRoomScreen(onBack = { nav.popBackStack() }, nav = AdminNav(
                    openUser = { nav.navigate("admin-user/$it") }, openChart = { nav.navigate("admin-chart") }, openOrgChart = { nav.navigate("org-chart") },
                    openProfile = { nav.navigate("profile/$it") }, openWeb = { openWeb(context, it) }, openAudit = { nav.navigate("audit/$it") },
                    openMemberAttendance = { nav.navigate("admin-att/$it") }, openOffices = { nav.navigate("admin-offices") },
                ))
            }
            composable("admin-user/{id}") { e -> AdminUserScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }, onOpenTeam = { nav.navigate("admin-team/$it") }, onOpenChart = { nav.navigate("admin-chart") }) }
            composable("folder/{id}") { e -> FolderCalendarScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") }) }
            // Teams are gone (deleted on the server 30 Sep 2026): a team link opens the Bagan IP & Divisi that replaced them.
            composable("admin-team/{id}") { OrgChartScreen(onBack = { nav.popBackStack() }) }
            composable("org-chart") { OrgChartScreen(onBack = { nav.popBackStack() }) }
            composable("admin-att/{id}") { e -> MemberAttendanceAdminScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenReflections = { nav.navigate("reflections/$it") }) }
            composable("admin-offices") { OfficesScreen(onBack = { nav.popBackStack() }) }
            composable("reflections/{id}") { e -> ReflectionsScreen(e.arguments?.getString("id"), onBack = { nav.popBackStack() }) }
            composable("audit/{id}") { e -> AuditEntryScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() },
                onOpenLink = { type, id -> when (type) { "task" -> nav.navigate("task/$id"); "project" -> nav.navigate("project/$id"); else -> nav.navigate("profile/$id") } },
                // A restored thing of any kind, on the screen this app has for it (RESTORE-ALL-TYPES).
                onOpenTarget = { t -> nav.navigate(when (t.kind) {
                    RestoreTarget.Kind.PROJECT -> "project/${t.id}"; RestoreTarget.Kind.TASK -> "task/${t.id}"
                    RestoreTarget.Kind.DOC -> "doc/${t.id}"; RestoreTarget.Kind.FOLDER -> "folder/${t.id}"
                    RestoreTarget.Kind.ATTENDANCE -> "attendance"; RestoreTarget.Kind.ROOMS -> "rooms"
                    RestoreTarget.Kind.CALENDAR -> t.date?.let { "calendar?date=$it" } ?: "calendar"
                    RestoreTarget.Kind.VAULT -> "vault"; RestoreTarget.Kind.WIRE -> "threads"; RestoreTarget.Kind.CHAT -> "chat/${t.id}"
                }) }) }
            composable("admin-chart") { ApprovalChartScreen(onBack = { nav.popBackStack() }, onOpenUser = { nav.navigate("admin-user/$it") }) }
            composable(Tab.CHAT.route) { MessagesScreen(onBack = null, onOpenChat = { nav.navigate("chat/$it") }) }
            // `at`: open on a message (a search hit, SYSTEM-MESSAGES part 2).
            composable(ShellRoutes.CHAT, arguments = listOf(androidx.navigation.navArgument("at") { nullable = true; defaultValue = null })) { e ->
                val cid = e.arguments?.getString("id").orEmpty()
                ChatThreadScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") }, onOpenInfo = { nav.navigate("chat-info/$cid") })
            }
            composable("chat-info/{id}") { e ->
                val cid = e.arguments?.getString("id").orEmpty()
                ChatInfoScreen(cid, onBack = { nav.popBackStack() },
                    onOpenChat = { nav.navigate("chat/$it") }, onOpenProfile = { nav.navigate("profile/$it") }, onOpenProject = { nav.navigate("project/$it") },
                    onOpenMedia = { nav.navigate("chat-media/$cid") }, onOpenSearch = { nav.navigate("chat-search/$cid") },
                    // Left the group: back past its thread to the chat list.
                    onLeft = { if (!nav.popBackStack(ShellRoutes.CHAT, inclusive = true)) nav.popBackStack() })
            }
            composable("chat-media/{id}") { e -> ChatMediaScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }) }
            composable("chat-search/{id}") { e ->
                val cid = e.arguments?.getString("id").orEmpty()
                ChatSearchScreen(cid, onBack = { nav.popBackStack() }, onOpenMessage = { mid ->
                    // The thread again, opened on that message (its old copy goes, so back still leads to the list).
                    nav.popBackStack(ShellRoutes.CHAT, inclusive = true)
                    nav.navigate("chat/$cid?at=$mid")
                })
            }
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
            // Tasks lives in More now (NAV-HOME-GROUP): a pushed screen with a back arrow.
            composable(Tab.TASKS.route) { MyTasksScreen(onOpenTask = { nav.navigate("task/$it") }, onBrowseProjects = { goTab(Tab.PROJECTS) }, onBack = { nav.popBackStack() }) }
            composable(Tab.INBOX.route) { InboxScreen() }
            composable(Tab.PROJECTS.route) {
                ProjectsScreen(onOpenProject = { nav.navigate("project/$it") }, onOpenTask = { nav.navigate("task/$it") }, onOpenFolder = { nav.navigate("folder/$it") })
            }
            composable(Tab.MORE.route) {
                val logout = rememberLogout(onSignOut) { nav.navigate("attendance") { launchSingleTop = true } }
                MoreScreen(session, logout, open = { r -> nav.navigate(r) { launchSingleTop = true } }, onOpenWhatsNew = { whatsNew = true })
            }
            composable("project/{id}") { entry ->
                ProjectDetailScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") },
                    onOpenSettings = { nav.navigate("project/${entry.arguments?.getString("id")}/settings") },
                    onOpenChat = { nav.navigate("chat/$it") },
                    onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") },
                    onOpenDoc = { nav.navigate("doc/$it") },
                    onBuildForm = { form -> nav.navigate("form-builder/${entry.arguments?.getString("id")}" + (form?.let { "?form=$it" } ?: "")) },
                    onOpenProject = { nav.navigate("project/$it") })
            }
            composable("form-builder/{projectId}?form={form}", arguments = listOf(androidx.navigation.navArgument("form") { nullable = true; defaultValue = null })) {
                FormBuilderScreen(onBack = { nav.popBackStack() }, onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") })
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

/** The tab bar on phones, the rail from 600 dp; [badge] is a tab's unread label or null. */
@Composable
internal fun ShellBar(tabs: List<Tab>, current: Tab?, badge: (Tab) -> String?, rail: Boolean, onTab: (Tab) -> Unit) {
    if (rail) androidx.compose.material3.NavigationRail(containerColor = Nx.colors.card) {
        tabs.forEach { t ->
            androidx.compose.material3.NavigationRailItem(
                selected = t == current, onClick = { onTab(t) },
                icon = { TabIcon(t.icon, badge(t)) },
                label = { TabLabel(stringResource(t.label)) },
            )
        }
    } else NavigationBar(containerColor = Nx.colors.card) {
        tabs.forEach { t ->
            NavigationBarItem(
                selected = t == current, onClick = { onTab(t) },
                icon = { TabIcon(t.icon, badge(t)) },
                label = { TabLabel(stringResource(t.label)) },
            )
        }
    }
}

/** A tab's icon with its unread badge (TalkBack reads the count with the label). */
@Composable
private fun TabIcon(icon: ImageVector, badge: String?) {
    if (badge == null) Icon(icon, contentDescription = null)
    else BadgedBox(badge = { Badge { Text(badge) } }) { Icon(icon, contentDescription = null) }
}

/** Route patterns more than one place compares against. */
internal object ShellRoutes {
    const val CHAT = "chat/{id}?at={at}"
}

/** The shell's navigation motion (iOS push/pop, point 7). */
object ShellMotion {
    private val TABS = setOf("home", "messages", "inbox", "calendar", "projects", "more")
    private const val MS = 300
    fun betweenTabs(from: String?, to: String?) = ShellTabs.tabOf(from) in TABS && ShellTabs.tabOf(to) in TABS
    val pushIn: EnterTransition = slideInHorizontally(tween(MS)) { it }
    val pushOut: ExitTransition = slideOutHorizontally(tween(MS)) { -it / 3 }
    val popIn: EnterTransition = slideInHorizontally(tween(MS)) { -it / 3 }
    val popOut: ExitTransition = slideOutHorizontally(tween(MS)) { it }
}

/** Where the tabs go: a bottom bar on phones, a rail from 600 dp wide (Material's medium width). */
object ShellLayout {
    fun useRail(widthDp: Int) = widthDp >= 600
}

/**
 * An id from a link or a push, as one route segment (audit R3): decoded "a/b" would otherwise change the
 * route and crash the navigation. Navigation decodes the argument again for the screen.
 */
internal fun enc(id: String): String = android.net.Uri.encode(id)

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

/**
 * More (Berlin 29 Sep, UI point 2; iOS RootView MoreView): a launcher grid in sections, two columns,
 * each tile a tinted icon square over its title; the account card and Logout underneath. Settings
 * (language, appearance, offline, update, delete account) live in Tuning Room, as on iOS.
 */
@Composable
internal fun MoreScreen(session: Session, onLogout: () -> Unit, open: (String) -> Unit, onOpenWhatsNew: () -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    // Company only (iOS 14b086f): hidden until known, and outside Z Networks.
    val company = rememberIsCompany() == true
    val calendarOn = container.remoteConfig.body.collectAsStateWithLifecycle().value.calendar
    val inboxUnread by container.badges.inboxUnread.collectAsStateWithLifecycle()
    // Control Room is drawn for MANAGER and above only (the server re-checks every call).
    val canAdmin by androidx.compose.runtime.produceState(container.viewer.canAdminister) { container.viewer.load(); value = container.viewer.canAdminister }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Text(stringResource(R.string.more_title), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = c.foreground,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp)) {
            MoreSection(stringResource(R.string.more_sec_home), listOfNotNull(
                // Inbox lives here when the Calendar holds its tab (Berlin, 8 Oct), with its unread.
                if (calendarOn) MoreItem(R.string.tab_inbox, Icons.Filled.Notifications, c.danger, badge = Badges.label(inboxUnread)) { open("inbox") } else null,
                // Tasks took Messages' place here; Messages is the Chat tab now (NAV-HOME-GROUP).
                MoreItem(R.string.tab_tasks, Icons.Filled.Checklist, c.blue) { open("tasks") },
                if (company) MoreItem(R.string.mt_threads, Icons.Filled.ChatBubble, c.violetText) { open("threads") } else null,
                MoreItem(R.string.mt_submissions, Icons.Filled.Inbox, c.warning) { open("submissions") },
                MoreItem(R.string.mt_rooms, Icons.Filled.MeetingRoom, c.coral) { open("rooms") },
            ))
            MoreSection(stringResource(R.string.more_sec_missions), listOfNotNull(
                MoreItem(R.string.mt_leaderboard, Icons.Filled.EmojiEvents, c.warning) { open("leaderboard") },
                MoreItem(R.string.mt_reports, Icons.Filled.BarChart, c.success) { open("reports") },
            ))
            MoreSection(stringResource(R.string.more_sec_knowledge), listOfNotNull(
                if (company) MoreItem(R.string.mt_vault, Icons.Filled.Storage, c.violetText) { open("vault?folder=&trash=") } else null,
                MoreItem(R.string.mt_forms, Icons.Filled.Description, c.blue) { open("forms") },
            ))
            MoreSection(stringResource(R.string.more_sec_pulse), listOf(
                MoreItem(R.string.mt_attendance, Icons.Filled.WatchLater, c.success) { open("attendance") },
            ))
            MoreSection(stringResource(R.string.more_sec_system), listOfNotNull(
                MoreItem(R.string.mt_ticket, Icons.Filled.ConfirmationNumber, c.blue) { open("tickets") },
                MoreItem(R.string.mt_whats_new, Icons.Filled.AutoAwesome, c.violetText, onClick = onOpenWhatsNew),
                MoreItem(R.string.mt_tuning, Icons.Filled.Settings, c.mutedFg) { open("account") },
                if (canAdmin) MoreItem(R.string.mt_control, Icons.Filled.Shield, c.danger) { open("admin") } else null,
            ))
            AccountFooter(session, onOpenProfile = { open("account") }, onLogout = onLogout)
        }
    }
}

private class MoreItem(val title: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector, val tint: androidx.compose.ui.graphics.Color, val badge: String? = null, val onClick: () -> Unit)

/** Section label + a two-column grid of tiles (iOS MoreSection + LazyVGrid). */
@Composable
private fun MoreSection(title: String, items: List<MoreItem>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(start = 4.dp))
        items.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.height(androidx.compose.foundation.layout.IntrinsicSize.Max)) {
                row.forEach { MoreTile(it, Modifier.weight(1f).fillMaxHeight()) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** iOS MoreTile: 46dp tinted square (14% fill, radius 14) and a semibold title, on a white card (radius 18). */
@Composable
private fun MoreTile(item: MoreItem, modifier: Modifier) {
    val c = Nx.colors
    val shape = RoundedCornerShape(18.dp)
    Column(modifier.shadow(3.dp, shape, ambientColor = c.foreground.copy(alpha = 0.08f), spotColor = c.foreground.copy(alpha = 0.08f))
        .clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(onClick = item.onClick)
        .defaultMinSize(minHeight = 110.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(46.dp).background(item.tint.copy(alpha = 0.14f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
            if (item.badge == null) Icon(item.icon, null, tint = item.tint, modifier = Modifier.size(22.dp))
            else BadgedBox(badge = { Badge { Text(item.badge) } }) { Icon(item.icon, null, tint = item.tint, modifier = Modifier.size(22.dp)) }
        }
        Text(stringResource(item.title), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2)
    }
}

/** iOS AccountFooter: avatar + name + email (opens Tuning Room), then Logout. */
@Composable
private fun AccountFooter(session: Session, onOpenProfile: () -> Unit, onLogout: () -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    // The session stores no photo: the profile has it.
    val avatar by androidx.compose.runtime.produceState<String?>(null) {
        value = runCatching { id.znetworks.nexus.feature.auth.ProfileApi(container.api).profile().avatar }.getOrNull()
    }
    val name = session.userName.ifBlank { session.userEmail }
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(onClick = onOpenProfile).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically) {
            id.znetworks.nexus.ui.components.Avatar(name, avatar, size = 46.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                Text(session.userEmail, fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
            }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.danger.copy(alpha = 0.1f)).clickable(onClick = onLogout).padding(vertical = 13.dp),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, tint = c.danger, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.logout), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
        }
    }
}

/**
 * The person's own Logout, from More and from Tuning Room: confirmed, and refused while a workday
 * runs (Berlin 28 Sep, iOS b186172). The returned lambda starts it; the dialogs are drawn here.
 */
@Composable
private fun rememberLogout(onSignOut: () -> Unit, onOpenAttendance: () -> Unit): () -> Unit {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var logoutBlocked by rememberSaveable { mutableStateOf(false) }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.logout_confirm_title)) },
            text = { Text(stringResource(R.string.logout_confirm_message)) },
            // Checked again: a check-in could have landed while the dialog was open.
            confirmButton = { TextButton(onClick = { confirmLogout = false; if (container.signOutBlocked()) logoutBlocked = true else onSignOut() }) { Text(stringResource(R.string.logout), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (logoutBlocked) AlertDialog(
        onDismissRequest = { logoutBlocked = false },
        title = { Text(id.znetworks.nexus.core.config.configText("signout.blocked.title", R.string.logout_blocked_title)) },
        text = { Text(id.znetworks.nexus.core.config.configText("signout.blocked.body", R.string.logout_blocked_body)) },
        confirmButton = { TextButton(onClick = { logoutBlocked = false; onOpenAttendance() }) { Text(stringResource(R.string.home_attendance)) } },
        dismissButton = { TextButton(onClick = { logoutBlocked = false }) { Text("OK") } },
    )
    return { if (container.signOutBlocked()) logoutBlocked = true else confirmLogout = true }
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

fun openWeb(context: Context, path: String) = openUrl(context, NexusConfig.PUBLIC_BASE + path)

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/**
 * A tab label on ONE line (Berlin, 29 Sep, point 3): "Kotak Masuk" used to wrap and push the bar up.
 * The text shrinks to fit (12 → 9 sp) instead, so the bar keeps its height in every language.
 */
@Composable
private fun TabLabel(text: String) = androidx.compose.foundation.text.BasicText(
    text, maxLines = 1, softWrap = false,
    style = androidx.compose.material3.LocalTextStyle.current.copy(color = androidx.compose.material3.LocalContentColor.current),
    autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = 9.sp, maxFontSize = 12.sp, stepSize = 0.5.sp),
)

/** `calendar?date=…`, with only the arguments that are set (each one encoded). */
internal fun calendarRoute(date: String? = null, view: String? = null, lens: String? = null, focus: String? = null, scope: String? = null, task: String? = null, nonce: String? = null): String {
    val args = listOf("date" to date, "view" to view, "lens" to lens, "focus" to focus, "scope" to scope, "task" to task, "n" to nonce).filter { it.second != null }
    return if (args.isEmpty()) "calendar" else "calendar?" + args.joinToString("&") { (k, v) -> "$k=${android.net.Uri.encode(v)}" }
}
