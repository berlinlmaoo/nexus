package id.znetworks.nexus.ui.shell

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.CheckBox
import id.znetworks.nexus.feature.forms.FormBuilderScreen
import id.znetworks.nexus.feature.forms.FormResponsesScreen
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
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
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
import id.znetworks.nexus.feature.admin.ApprovalChartScreen
import id.znetworks.nexus.feature.admin.ControlRoomScreen
import id.znetworks.nexus.feature.admin.AuditEntryScreen
import id.znetworks.nexus.feature.admin.MemberAttendanceAdminScreen
import id.znetworks.nexus.feature.admin.OfficesScreen
import id.znetworks.nexus.feature.admin.ReflectionsScreen
import id.znetworks.nexus.feature.gideon.GideonScreen
import id.znetworks.nexus.feature.gideon.RemindersScreen
import id.znetworks.nexus.feature.gideon.GideonMemoryScreen
import id.znetworks.nexus.feature.meetings.MeetingsScreen
import id.znetworks.nexus.feature.meetings.MeetingScreen
import id.znetworks.nexus.feature.meetings.NewMeetingScreen
import androidx.navigation.navArgument
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
import id.znetworks.nexus.feature.legal.LegalDocumentScreen
import id.znetworks.nexus.feature.legal.LegalInviteScreen
import id.znetworks.nexus.feature.legal.LegalNav
import id.znetworks.nexus.feature.legal.LegalNewDocumentScreen
import id.znetworks.nexus.feature.legal.LegalOnly
import id.znetworks.nexus.feature.legal.LegalRequestFormScreen
import id.znetworks.nexus.feature.legal.LegalRequestLinksScreen
import id.znetworks.nexus.feature.legal.LegalRequestScreen
import id.znetworks.nexus.feature.legal.LegalScreen
import id.znetworks.nexus.feature.legal.LegalTemplateScreen
import id.znetworks.nexus.feature.legal.LegalUploadDocumentScreen
import id.znetworks.nexus.feature.legal.LegalUploadTemplateScreen
import id.znetworks.nexus.feature.legal.MyLegalRequestScreen
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
    HOME("home", R.string.tab_home, Icons.Outlined.GridView, "/dashboard"),
    TASKS("tasks", R.string.tab_tasks, Icons.Outlined.CheckBox, "/my-tasks"),
    /** The chat list (9 Oct, NAV-HOME-GROUP): a tab with its own back stack, in the slot Tasks had. */
    CHAT("messages", R.string.tab_chat, Icons.Outlined.ChatBubbleOutline, "/messages"),
    INBOX("inbox", R.string.tab_inbox, Icons.Outlined.Inbox, "/inbox"),
    CALENDAR("calendar", R.string.tab_calendar, Icons.Outlined.CalendarMonth, "/calendar"),
    PROJECTS("projects", R.string.tab_projects, Icons.Outlined.Folder, "/projects"),
    MORE("more", R.string.tab_more, Icons.Filled.Menu, ""),
}

/**
 * The tabs (owner, 8 Oct): Home · Tasks · Calendar · Projects · More; Inbox moved into More, which
 * carries its unread badge. With the server's `flags.calendar` off, Inbox takes the Calendar's place.
 */
internal object ShellTabs {
    fun routes(calendarOn: Boolean): List<String> =
        if (calendarOn) listOf("home", "messages", "calendar", "projects", "more") else listOf("home", "messages", "inbox", "projects", "more")
    /** The tab a destination belongs to: "calendar?date={date}…" is the Calendar tab. */
    fun tabOf(route: String?): String? = route?.substringBefore('?')

    /**
     * The tab a pushed screen lives under, so the bar keeps it lit (web phone / iPhone: a project page still shows
     * Projects): projects, folders, tasks and forms → Projects; a chat's info, media and search → Chat; the
     * calendar's lists → Calendar. Null = the tab the person came from.
     */
    fun ownerOf(route: String?): String? {
        val r = route ?: return null
        return when {
            r.startsWith("project/") || r.startsWith("task/") || r.startsWith("task-preview/") ||
                r.startsWith("form-builder/") || r.startsWith("form-responses/") -> "projects"
            r.startsWith("chat") -> "messages"
            r.startsWith("team-calendar") || r.startsWith("calendar-list") -> "calendar"
            else -> null
        }
    }
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
        if (!id.znetworks.nexus.core.tour.TourMode.active && Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        container.announcements.refresh()
    }
    // The stored user id can predate a server id change (UUIDv7 switch, 18 Oct 2026): the token still works,
    // but "mine" checks compare against the old id. Take the server's id; MainActivity keys the shell on it.
    LaunchedEffect(session.userId) {
        val fresh = runCatching { id.znetworks.nexus.feature.auth.ProfileApi(container.api).profile().id }.getOrNull()
        if (!fresh.isNullOrBlank() && fresh != session.userId) {
            container.sessionStore.current?.takeIf { it.token == session.token }?.let { container.sessionStore.save(it.copy(userId = fresh)) }
        }
    }

    // Links: switch to the owning screen; attendance focus is claimed by that screen itself.
    LaunchedEffect(pending) {
        when (val t = pending) {
            // Claimed by the attendance screen itself (focus survives a cold start and a sign-in).
            is Target.Attendance -> nav.navigate("attendance") { launchSingleTop = true }
            Target.Inbox -> { openInbox(); container.router.consumed(t) }
            Target.Settings -> { goTab(Tab.MORE); container.router.consumed(t) }
            is Target.Tab -> { Tab.entries.firstOrNull { it.route == t.route }?.let(::goTab); container.router.consumed(t) }
            is Target.Project -> { container.router.consumed(t); nav.navigate("project/${enc(t.id)}?view=${enc(t.view.orEmpty())}&date=${enc(t.date.orEmpty())}") }
            is Target.Task -> { container.router.consumed(t); nav.navigate("task/${enc(t.id)}") }
            is Target.Threads -> { container.router.consumed(t); nav.navigate(t.postId?.let { "threads?post=${enc(it)}" } ?: "threads") }
            is Target.Tickets -> { container.router.consumed(t); nav.navigate(t.ticketId?.let { "ticket/${enc(it)}" } ?: "tickets") }
            is Target.Form -> { container.router.consumed(t); nav.navigate("form/${enc(t.idOrSlug)}") }
            is Target.Submissions -> {
                container.router.consumed(t)
                // `?legal=<id>`: one of my Legal requests (the legal_request_status notification links here).
                nav.navigate(t.legalId?.let { "my-legal-request/${enc(it)}" } ?: t.submissionId?.let { "submission/${enc(it)}" } ?: "submissions")
            }
            is Target.Legal -> {
                container.router.consumed(t)
                if (t.docId != null) nav.navigate("legal-doc/${enc(t.docId)}")
                else nav.navigate("legal?tab=${enc(t.tab.orEmpty())}&request=${enc(t.requestId.orEmpty())}")
            }
            is Target.LegalRequestForm -> { container.router.consumed(t); nav.navigate("legal-request-form/${enc(t.linkId)}") }
            is Target.Docs -> { container.router.consumed(t); nav.navigate(t.docId?.let { "doc/${enc(it)}" } ?: "docs") }
            is Target.Vault -> { container.router.consumed(t); nav.navigate("vault?folder=${enc(t.folderId.orEmpty())}&trash=&item=${enc(t.itemId.orEmpty())}") }
            is Target.VaultShare -> { container.router.consumed(t); nav.navigate("vault-share/${enc(t.slug)}") }
            is Target.Reports -> { container.router.consumed(t); nav.navigate(t.userId?.let { "report/${enc(it)}/0" } ?: "reports") }
            Target.RoomBooking -> { container.router.consumed(t); nav.navigate("rooms") }
            is Target.Booking -> { container.router.consumed(t); nav.navigate("rooms?booking=${enc(t.id)}") }
            is Target.Calendar -> {
                container.router.consumed(t)
                // A quadrant widget's whole list (audit #40).
                if (t.view == "quadrant") nav.navigate("calendar-list?q=${enc(t.q.orEmpty())}&scope=${enc(t.scope.orEmpty())}") { launchSingleTop = true }
                // A fresh nonce: the same link tapped again (a widget, a notification) is applied again,
                // while the entry never re-applies one it already used (CalendarLinkGate).
                else nav.navigate(calendarRoute(t.date, t.view, t.lens, t.focus, t.scope, t.task, nonce = System.currentTimeMillis().toString(), folder = t.folder, unit = t.unit, person = t.person, project = t.project, prio = t.prio, done = t.done, overdue = t.overdue)) { launchSingleTop = true }
            }
            Target.Admin -> { container.router.consumed(t); nav.navigate("admin") }
            Target.GideonPerformance -> { container.router.consumed(t); nav.navigate("admin-performance") }
            Target.Reminders -> { container.router.consumed(t); nav.navigate("reminders") }
            Target.GideonMemorySummary -> { container.router.consumed(t); nav.navigate("gideon-memory-summary") }
            Target.GideonMemory -> { container.router.consumed(t); nav.navigate("gideon-memory") }
            Target.Gideon -> { container.router.consumed(t); nav.navigate("gideon") }
            is Target.Meetings -> { container.router.consumed(t); nav.navigate("meetings?project=${enc(t.projectId.orEmpty())}") }
            is Target.Meeting -> { container.router.consumed(t); nav.navigate("meeting/${enc(t.id)}") }
            is Target.NewMeeting -> { container.router.consumed(t); nav.navigate("meeting-new?project=${enc(t.projectId.orEmpty())}") }
            Target.Leaderboard -> { container.router.consumed(t); nav.navigate("leaderboard") }
            is Target.Profile -> { container.router.consumed(t); nav.navigate("profile/${enc(t.userId)}") }
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

    var startupModal by rememberSaveable { mutableStateOf<StartupModal?>(null) }
    var xpLoading by remember { mutableStateOf(!id.znetworks.nexus.core.tour.TourMode.active) }
    var xpPending by remember { mutableStateOf(false) }
    var trailModalBusy by remember { mutableStateOf(false) }
    val disclosure by container.workTrail.disclosureFor.collectAsStateWithLifecycle()
    val announcementQueue by container.announcements.queue.collectAsStateWithLifecycle()
    val announcementsLoading by container.announcements.loading.collectAsStateWithLifecycle()
    TrailConsentHost(container.workTrail, enabled = startupModal == StartupModal.LOCATION_CONSENT, onBusyChanged = { trailModalBusy = it })
    // Taken away in the middle of a workday: asked again on every return to the app (iOS 77818ba).
    var alwaysAgain by rememberSaveable { mutableStateOf(false) }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        alwaysAgain = container.remoteConfig.current.requireAlwaysLocation && container.workdayOpen() &&
            id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.missing(context) != null
        onPauseOrDispose { }
    }
    if (startupModal == StartupModal.ALWAYS_LOCATION) id.znetworks.nexus.feature.attendance.trail.AlwaysLocationDialog(onDismiss = { alwaysAgain = false }) { alwaysAgain = false }
    if (startupModal == StartupModal.ANNOUNCEMENT) AnnouncementDialog(container.announcements)
    // Once per version, after the location disclosure and announcements have had their turn.
    val version = container.identity.versionName
    var whatsNew by rememberSaveable { mutableStateOf(WhatsNew.due(context, version) && !id.znetworks.nexus.core.tour.TourMode.active) }
    LaunchedEffect(announcementQueue, announcementsLoading, disclosure, trailModalBusy, alwaysAgain, whatsNew, xpLoading, xpPending) {
        startupModal = StartupModals.next(startupModal, announcementsLoading, announcementQueue.isNotEmpty(), disclosure != null || trailModalBusy, alwaysAgain, whatsNew, xpLoading, xpPending)
    }
    if (startupModal == StartupModal.PROMO) WhatsNewSheet(version) { WhatsNew.seen(context, version); whatsNew = false }

    id.znetworks.nexus.feature.people.XpPenaltyHost(startupModal == StartupModal.XP_PENALTY) { loading, pending ->
        val enabled = !id.znetworks.nexus.core.tour.TourMode.active
        xpLoading = enabled && loading
        xpPending = enabled && pending
    }

    // Tablets and unfolded phones: the same five tabs as a rail on the left (PRD Phase 5); from 840 dp the
    // web's sidebar with every destination instead (dev web AppSidebar).
    val width = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp
    val sidebar = ShellLayout.useSidebar(width)
    val rail = ShellLayout.useRail(width) && !sidebar
    val calendarOn = container.remoteConfig.body.collectAsStateWithLifecycle().value.calendar
    val tabs = ShellTabs.routes(calendarOn).mapNotNull { r -> Tab.entries.firstOrNull { it.route == r } }
    // The last tab screen shown: a screen pushed over it (Tickets from More, a profile from Home) keeps it lit.
    var lastTab by remember { mutableStateOf<Tab?>(null) }
    val current = tabs.firstOrNull { it.route == ShellTabs.tabOf(route) }
        ?: tabs.firstOrNull { t -> backStack?.destination?.hierarchy?.any { ShellTabs.tabOf(it.route) == t.route } == true }
        ?: tabs.firstOrNull { it.route == ShellTabs.ownerOf(route) }
        ?: lastTab
        // Opened straight from a link or a push (no tab seen yet): every other screen is reached from More.
        ?: tabs.firstOrNull { it == Tab.MORE }.takeIf { route != null }
    LaunchedEffect(current) { if (current != null) lastTab = current }
    // Inbox's unread on whichever entry holds Inbox now: its own tab, or More (owner, 8 Oct).
    val inboxUnread by container.badges.inboxUnread.collectAsStateWithLifecycle()
    // Chat carries the chat total (muted rooms left out); More only Inbox's, when Inbox has no tab (NAV-HOME-GROUP).
    val chatUnread by container.badges.chatUnread.collectAsStateWithLifecycle()
    val badgeOn: (Tab) -> String? = { t -> when {
        t == Tab.CHAT -> Badges.label(chatUnread)
        t == Tab.INBOX || (t == Tab.MORE && Tab.INBOX !in tabs) -> Badges.label(inboxUnread)
        else -> null
    } }
    /** A menu entry (More page, sidebar): tabs are switched to, Inbox goes where it lives, the rest pushed. */
    fun openItem(item: ShellNav.Item) {
        val tab = tabs.firstOrNull { it.route == item.route }
        when {
            item == ShellNav.Item.WHATS_NEW -> whatsNew = true
            item == ShellNav.Item.NOTIFICATIONS -> openInbox()
            tab != null -> goTab(tab)
            item.route.isNotEmpty() -> nav.navigate(item.route) { launchSingleTop = true }
        }
    }
    val shellLogout = rememberLogout(onSignOut) { nav.navigate("attendance") { launchSingleTop = true } }
    // The UI tour (DEBUG): open the asked screen by its route, then say "settled" once it has had time to load.
    // (Collected, not keyed on the value: clearing it must not cancel the wait before "settled" is said.)
    LaunchedEffect(Unit) {
        id.znetworks.nexus.core.tour.TourMode.go.collect { g ->
            if (g == null) return@collect
            id.znetworks.nexus.core.tour.TourMode.consumed()
            val tab = tabs.firstOrNull { it.route == g.route }
            if (tab != null) goTab(tab) else nav.navigate(g.route) { launchSingleTop = true }
            kotlinx.coroutines.delay(4500)
            id.znetworks.nexus.core.tour.TourMode.status("settled ${g.id}")
        }
    }
    val notices = remember { androidx.compose.material3.SnackbarHostState() }
    LaunchedEffect(Unit) { id.znetworks.nexus.ui.components.UiNotice.messages.collect { notices.showSnackbar(it) } }
    Scaffold(
        snackbarHost = { androidx.compose.material3.SnackbarHost(notices) },
        containerColor = Nx.colors.background,
        bottomBar = {
            if (!rail && !sidebar) ShellBar(tabs, current, badgeOn, rail = false) { goTab(it) }
        },
    ) { padding ->
      // The bars' padding is consumed here: a screen's imePadding then adds only what the keyboard
      // covers beyond the bottom bar, not the bar again (the gap above the keyboard, point 6).
      androidx.compose.foundation.layout.Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
        if (rail) ShellBar(tabs, current, badgeOn, rail = true) { goTab(it) }
        if (sidebar) ShellSidebar(session, ShellNav.itemOf(route), onItem = ::openItem, onSearch = { nav.navigate("search") { launchSingleTop = true } }, onLogout = shellLogout)
        // iOS push/pop (owner, 29 Sep, point 7): a screen slides in from the right and, on back, out to
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
            composable("submissions") { SubmissionsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate("submission/${enc(it)}") }, onOpenForms = { nav.navigate("forms") },
                onOpenLegal = { nav.navigate("my-legal-request/${enc(it)}") }) }
            legalRoutes(nav)
            composable("submission/{id}") { e ->
                val scope = androidx.compose.runtime.rememberCoroutineScope()
                SubmissionDetailScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") },
                    onOpenFile = { url -> scope.launch { runCatching { FileOpener.open(context, container.api, url, url.substringAfterLast('/')) } } })
            }
            composable("docs") { DocsScreen(onBack = { nav.popBackStack() }, onOpenDoc = { nav.navigate("doc/$it") }) }
            composable("doc/{id}") { e -> DocReaderScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onGideon = { nav.navigate("gideon") }) }
            composable("vault?folder={folder}&trash={trash}&item={item}", arguments = listOf(
                androidx.navigation.navArgument("folder") { nullable = true; defaultValue = null },
                androidx.navigation.navArgument("trash") { nullable = true; defaultValue = null },
                androidx.navigation.navArgument("item") { nullable = true; defaultValue = null },
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
            composable("rooms?booking={booking}", arguments = listOf(navArgument("booking") { nullable = true; defaultValue = null })) { e -> RoomBookingScreen(bookingId = e.arguments?.getString("booking"), onBack = { nav.popBackStack() }) }
            // The master Calendar; `team-calendar` stays as an alias for old links and shortcuts.
            composable("calendar?date={date}&view={view}&lens={lens}&focus={focus}&scope={scope}&task={task}&n={n}&folder={folder}&unit={unit}&person={person}&project={project}&prio={prio}&done={done}&overdue={overdue}",
                arguments = listOf("date", "view", "lens", "focus", "scope", "task", "n", "folder", "unit", "person", "project", "prio", "done", "overdue").map { a -> androidx.navigation.navArgument(a) { nullable = true; defaultValue = null } }) { e ->
                val a = e.arguments
                CalendarScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } }, onOpenMyMission = { goTab(Tab.TASKS) },
                    date = a?.getString("date"), view = a?.getString("view"), lens = a?.getString("lens"), focus = a?.getString("focus"), scope = a?.getString("scope"), task = a?.getString("task"),
                    nonce = a?.getString("n"), folder = a?.getString("folder"), unit = a?.getString("unit"), person = a?.getString("person"), project = a?.getString("project"), prio = a?.getString("prio"), done = a?.getString("done"), overdue = a?.getString("overdue"),
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
            composable("gideon?project={project}&name={name}", arguments = listOf("project", "name").map { a -> androidx.navigation.navArgument(a) { nullable = true; defaultValue = null } }) { e ->
                val pid = e.arguments?.getString("project")
                GideonScreen(onBack = { nav.popBackStack() }, project = pid?.let { it to (e.arguments?.getString("name") ?: "") })
            }
            listOf("admin", "admin-performance").forEach { adminRoute -> composable(adminRoute) {
                ControlRoomScreen(onBack = { nav.popBackStack() }, initialTab = if (adminRoute == "admin-performance") "gideon" else "users", initialGideon = if (adminRoute == "admin-performance") "performance" else "people", nav = AdminNav(
                    openUser = { nav.navigate("admin-user/$it") }, openChart = { nav.navigate("admin-chart") }, openOrgChart = { nav.navigate("org-chart") },
                    openProfile = { nav.navigate("profile/$it") }, openWeb = { openWeb(context, it) }, openAudit = { nav.navigate("audit/$it") },
                    openMemberAttendance = { nav.navigate("admin-att/$it") }, openOffices = { nav.navigate("admin-offices") },
                ))
            } }
            composable("admin-user/{id}") { e -> AdminUserScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenProfile = { nav.navigate("profile/$it") }, onOpenTeam = { nav.navigate("admin-team/$it") }, onOpenChart = { nav.navigate("admin-chart") }) }
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
                    RestoreTarget.Kind.DOC -> "doc/${t.id}"; RestoreTarget.Kind.FOLDER -> calendarRoute(folder = t.id)
                    RestoreTarget.Kind.ATTENDANCE -> "attendance"; RestoreTarget.Kind.ROOMS -> "rooms"
                    RestoreTarget.Kind.CALENDAR -> t.date?.let { "calendar?date=$it" } ?: "calendar"
                    RestoreTarget.Kind.VAULT -> "vault"; RestoreTarget.Kind.WIRE -> "threads"; RestoreTarget.Kind.CHAT -> "chat/${t.id}"
                    RestoreTarget.Kind.MEETING -> "meeting/${t.id}"
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
            composable("reminders") { RemindersScreen { nav.popBackStack() } }
            composable("gideon-memory-summary") { GideonMemoryScreen(initialSummary = true) { nav.popBackStack() } }
            composable("gideon-memory") { GideonMemoryScreen { nav.popBackStack() } }
            composable("meetings?project={project}", arguments = listOf(navArgument("project") { defaultValue = "" })) { e -> MeetingsScreen(e.arguments?.getString("project")?.takeIf { it.isNotBlank() }, { nav.popBackStack() }) }
            composable("meeting-new?project={project}", arguments = listOf(navArgument("project") { defaultValue = "" })) { e -> NewMeetingScreen(e.arguments?.getString("project")?.takeIf { it.isNotBlank() }, { nav.popBackStack() }) }
            composable("meeting/{id}") { e -> MeetingScreen(e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onAllMeetings = { nav.navigate("meetings") { popUpTo("meeting/{id}") { inclusive = true }; launchSingleTop = true } }) }
            composable(Tab.PROJECTS.route) {
                ProjectsScreen(onOpenProject = { nav.navigate("project/$it") }, onOpenTask = { nav.navigate("task/$it") }, onOpenFolder = { nav.navigate(calendarRoute(folder = it)) },
                    onOpenSettings = { nav.navigate("project/$it/settings") })
            }
            composable(Tab.MORE.route) {
                MoreScreen(session, shellLogout, onItem = ::openItem, onSearch = { nav.navigate("search") { launchSingleTop = true } },
                    tabs = if (sidebar) emptySet() else tabs.map { it.route }.toSet())
            }
            composable("project/{id}?view={view}&date={date}", arguments = listOf(androidx.navigation.navArgument("view") { nullable = true; defaultValue = null }, androidx.navigation.navArgument("date") { nullable = true; defaultValue = null })) { entry ->
                ProjectDetailScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/$it") },
                    onOpenSettings = { nav.navigate("project/${entry.arguments?.getString("id")}/settings") },
                    onOpenChat = { nav.navigate("chat/$it") },
                    onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") },
                    onOpenDoc = { nav.navigate("doc/$it") },
                    onBuildForm = { form -> nav.navigate("form-builder/${entry.arguments?.getString("id")}" + (form?.let { "?form=$it" } ?: "")) },
                    onOpenProject = { nav.navigate("project/$it") }, onOpenFolder = { nav.navigate(calendarRoute(folder = it)) },
                    initialView = entry.arguments?.getString("view"),
                    initialDate = entry.arguments?.getString("date"),
                    onOpenGideon = { name -> nav.navigate("gideon?project=${enc(entry.arguments?.getString("id").orEmpty())}&name=${enc(name)}") }, onOpenProjects = { nav.popBackStack(); goTab(Tab.PROJECTS) })
            }
            composable("form-builder/{projectId}?form={form}", arguments = listOf(androidx.navigation.navArgument("form") { nullable = true; defaultValue = null })) {
                FormBuilderScreen(onBack = { nav.popBackStack() }, onOpenForm = { nav.navigate("form/${android.net.Uri.encode(it)}") },
                    onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } })
            }
            composable("form-responses/{projectId}/{formId}") { e ->
                FormResponsesScreen(e.arguments?.getString("projectId").orEmpty(), e.arguments?.getString("formId").orEmpty(),
                    onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate("task/${enc(it)}") { launchSingleTop = true } })
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
                colors = androidx.compose.material3.NavigationRailItemDefaults.colors(
                    selectedIconColor = Nx.colors.foreground, selectedTextColor = Nx.colors.foreground, indicatorColor = Nx.colors.muted,
                    unselectedIconColor = Nx.colors.mutedFg, unselectedTextColor = Nx.colors.mutedFg),
            )
        }
    } else FloatingTabBar(tabs, current, badge, onTab)
}

/**
 * The phone tab bar like the web phone and the iPhone (owner, 14 Oct 2026): a floating rounded bar with a border and
 * a soft shadow, inset from the edges; the current tab on a muted pill in the foreground colour (web), the others muted.
 */
@Composable
private fun FloatingTabBar(tabs: List<Tab>, current: Tab?, badge: (Tab) -> String?, onTab: (Tab) -> Unit) {
    val c = Nx.colors
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(26.dp)
    Box(Modifier.fillMaxWidth().background(c.background).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth()
            .shadow(10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.14f))
            .clip(shape).background(c.card).border(1.dp, c.border, shape).padding(5.dp)
            .selectableGroup(),
            verticalAlignment = Alignment.CenterVertically) {
            tabs.forEach { t ->
                val on = t == current
                val tint = if (on) c.foreground else c.mutedFg
                Column(Modifier.weight(1f).clip(androidx.compose.foundation.shape.RoundedCornerShape(21.dp)).background(if (on) c.muted else Color.Transparent)
                    .selectable(selected = on, role = Role.Tab, onClick = { onTab(t) }).padding(top = 7.dp, bottom = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    val b = badge(t)
                    if (b == null) Icon(t.icon, null, tint = tint, modifier = Modifier.size(22.dp))
                    else BadgedBox(badge = { Badge { Text(b) } }) { Icon(t.icon, null, tint = tint, modifier = Modifier.size(22.dp)) }
                    Spacer(Modifier.height(3.dp))
                    Text(stringResource(t.label), fontSize = 11.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, color = tint, maxLines = 1)
                }
            }
        }
    }
}

/** The web tab bar's colours: the current tab in the foreground (web text-primary) on a soft muted pill. */
@Composable
private fun shellItemColors() = androidx.compose.material3.NavigationBarItemDefaults.colors(
    selectedIconColor = Nx.colors.foreground, selectedTextColor = Nx.colors.foreground, indicatorColor = Nx.colors.muted,
    unselectedIconColor = Nx.colors.mutedFg, unselectedTextColor = Nx.colors.mutedFg,
)

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

/**
 * Where the navigation goes: a bottom bar on phones, a rail from 600 dp wide (Material's medium width), the
 * web's full sidebar from 840 dp (Material's expanded width).
 */
object ShellLayout {
    fun useRail(widthDp: Int) = widthDp >= 600
    fun useSidebar(widthDp: Int) = widthDp >= 840
}

/**
 * An id from a link or a push, as one route segment (audit R3): decoded "a/b" would otherwise change the
 * route and crash the navigation. Navigation decodes the argument again for the screen.
 */
internal fun enc(id: String): String = android.net.Uri.encode(id)

/**
 * Legal (owner, 14 Oct 2026; invitation only): the home with its five tabs, a document, New document / Create addendum
 * / Create document from a request, uploads, a template, a request on the board, the request links and Invite. Every
 * Legal-member route sits behind [LegalOnly]; the request form (`/f/legal-…`) and my own requests are for anyone signed in.
 */
private fun androidx.navigation.NavGraphBuilder.legalRoutes(nav: androidx.navigation.NavHostController) {
    val back: () -> Unit = { nav.popBackStack() }
    val legalNav = LegalNav(
        back = back,
        openDoc = { nav.navigate("legal-doc/${enc(it)}") },
        newDoc = { parent, request -> nav.navigate("legal-new?parent=${enc(parent.orEmpty())}&request=${enc(request.orEmpty())}") },
        uploadDoc = { nav.navigate("legal-upload") },
        openTemplate = { nav.navigate("legal-template/${enc(it)}") },
        newTemplate = { nav.navigate("legal-template-new") },
        openRequest = { nav.navigate("legal-request/${enc(it)}") },
        requestLinks = { nav.navigate("legal-request-links") },
        invite = { nav.navigate("legal-invite") },
    )
    fun opt(vararg names: String) = names.map { a -> androidx.navigation.navArgument(a) { nullable = true; defaultValue = null } }
    fun arg(e: androidx.navigation.NavBackStackEntry, k: String) = e.arguments?.getString(k)?.takeIf { it.isNotEmpty() }
    // A screen that made something is replaced by what it made (back goes to where it was opened from).
    fun replace(route: String, pattern: String) = nav.navigate(route) { popUpTo(pattern) { inclusive = true } }

    composable("legal?tab={tab}&request={request}", arguments = opt("tab", "request")) { e ->
        LegalScreen(legalNav, arg(e, "tab"), arg(e, "request"))
    }
    composable("legal-doc/{id}") { e ->
        LegalOnly(back) {
            LegalDocumentScreen(arg(e, "id").orEmpty(), onBack = back, onOpenDoc = legalNav.openDoc, onCreateAddendum = { legalNav.newDoc(it, null) })
        }
    }
    composable("legal-new?parent={parent}&request={request}", arguments = opt("parent", "request")) { e ->
        LegalOnly(back) {
            LegalNewDocumentScreen(arg(e, "parent"), arg(e, "request"), onBack = back,
                onCreated = { replace("legal-doc/${enc(it)}", "legal-new?parent={parent}&request={request}") })
        }
    }
    composable("legal-upload") { LegalOnly(back) { LegalUploadDocumentScreen(back) { replace("legal-doc/${enc(it)}", "legal-upload") } } }
    composable("legal-template-new") { LegalOnly(back) { LegalUploadTemplateScreen(back) { replace("legal-template/${enc(it)}", "legal-template-new") } } }
    composable("legal-template/{id}") { e -> LegalOnly(back) { LegalTemplateScreen(arg(e, "id").orEmpty(), back) } }
    composable("legal-request/{id}") { e ->
        LegalOnly(back) {
            LegalRequestScreen(arg(e, "id").orEmpty(), onBack = back, onOpenDoc = legalNav.openDoc, onCreateDoc = { legalNav.newDoc(null, it) })
        }
    }
    composable("legal-request-links") { LegalOnly(back) { LegalRequestLinksScreen(back) } }
    composable("legal-invite") { LegalOnly(back) { LegalInviteScreen(back) } }
    // The request form behind a link: any signed-in person, not only Legal.
    composable("legal-request-form/{id}") { e ->
        LegalRequestFormScreen(arg(e, "id").orEmpty(), onBack = back, onOpenMine = { id ->
            nav.navigate("submissions") { popUpTo("legal-request-form/{id}") { inclusive = true } }
            nav.navigate("my-legal-request/${enc(id)}")
        })
    }
    composable("my-legal-request/{id}") { e -> MyLegalRequestScreen(arg(e, "id").orEmpty(), back) }
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

/**
 * The person's own Logout, from More and from Tuning Room: confirmed, and refused while a workday
 * runs (owner 28 Sep, iOS b186172). The returned lambda starts it; the dialogs are drawn here.
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
                NxTextField(typed, { typed = it }, singleLine = true, placeholder = { Text("DELETE") })
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

fun openWeb(context: Context, path: String) = openUrl(context, NexusConfig.base + path)

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/**
 * A tab label on ONE line (owner, 29 Sep, point 3): "Kotak Masuk" used to wrap and push the bar up.
 * The text shrinks to fit (12 → 9 sp) instead, so the bar keeps its height in every language.
 */
@Composable
private fun TabLabel(text: String) = androidx.compose.foundation.text.BasicText(
    text, maxLines = 1, softWrap = false,
    style = androidx.compose.material3.LocalTextStyle.current.copy(color = androidx.compose.material3.LocalContentColor.current),
    autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = 9.sp, maxFontSize = 12.sp, stepSize = 0.5.sp),
)

/** `calendar?date=…`, with only the arguments that are set (each one encoded). */
internal fun calendarRoute(date: String? = null, view: String? = null, lens: String? = null, focus: String? = null, scope: String? = null, task: String? = null, nonce: String? = null, folder: String? = null, unit: String? = null, person: String? = null, project: String? = null, prio: String? = null, done: String? = null, overdue: String? = null): String {
    val args = listOf("date" to date, "view" to view, "lens" to lens, "focus" to focus, "scope" to scope, "task" to task, "n" to nonce, "folder" to folder, "unit" to unit, "person" to person, "project" to project, "prio" to prio, "done" to done, "overdue" to overdue).filter { it.second != null }
    return if (args.isEmpty()) "calendar" else "calendar?" + args.joinToString("&") { (k, v) -> "$k=${android.net.Uri.encode(v)}" }
}
