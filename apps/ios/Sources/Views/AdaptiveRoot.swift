import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// One list of screens, two shapes.
//
// On a phone the app is a 5-tab bar whose last tab is a launcher grid holding the
// other fourteen screens. That shape exists because a phone has room for five
// destinations and no more. An iPad has room for all eighteen at once, and hiding
// two thirds of them behind a "More" tab on a 13-inch screen would be a phone
// layout wearing an iPad's clothes.
//
// So the destinations live here once, and the root picks a shape from the
// horizontal size class: sidebar + detail when there is width, the existing tab
// bar when there isn't. Both read from the same enum, so a screen added here
// appears in both without touching either layout.
// ─────────────────────────────────────────────────────────────────────────────

enum NXScreen: String, CaseIterable, Identifiable, Hashable {
    // Phone tab roots
    case dashboard, tasks, inbox, projects
    // Home Base
    // `teamCalendar` is the Calendar (0.1.7). The case keeps its old name because its raw value is
    // what `nexus://teamCalendar` resolves against, and links written before the rename must still open.
    case messages, threads, submissions, teamCalendar, roomBooking
    // GIDEON's own page (web sidebar, 12 Oct 2026): the conversation with its chats list. iPad / Mac sidebar.
    case gideon
    // Missions
    case leaderboard, reports
    // Knowledge
    case docs, forms, vault
    // Pulse Check
    case attendance
    // System
    case tickets, teams, settings, admin

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard:    return T("Home")
        case .tasks:        return T("My Tasks")
        case .inbox:        return T("Notifications")
        case .projects:     return T("Projects")
        case .messages:     return T("Messages")
        case .gideon:       return "GIDEON"
        case .threads:      return T("Threads")
        case .submissions:  return T("My Submissions")
        case .teamCalendar: return T("Calendar")
        case .roomBooking:  return T("Room Booking")
        case .leaderboard:  return T("Leaderboard")
        case .reports:      return T("Reports")
        case .docs:         return T("Pages")
        case .forms:        return T("Forms")
        case .vault:        return T("Z Vault")
        case .attendance:   return T("Attendance")
        case .tickets:      return T("Tickets")
        case .teams:        return T("Teams")
        case .settings:     return T("Settings")
        case .admin:        return T("Control Room")
        }
    }

    var icon: String {
        switch self {
        case .dashboard:    return "house.fill"
        case .tasks:        return "checklist"
        case .inbox:        return "tray.fill"
        case .projects:     return "rectangle.stack.fill"
        case .messages:     return "bubble.left.and.bubble.right.fill"
        case .gideon:       return "sparkles"
        case .threads:      return "text.bubble.fill"
        case .submissions:  return "tray.full.fill"
        case .teamCalendar: return "calendar"
        case .roomBooking:  return "door.left.hand.open"
        case .leaderboard:  return "trophy.fill"
        case .reports:      return "chart.bar.fill"
        case .docs:         return "book.fill"
        case .forms:        return "doc.text.fill"
        case .vault:        return "externaldrive.fill"
        case .attendance:   return "clock.badge.checkmark.fill"
        case .tickets:      return "ticket.fill"
        case .teams:        return "person.3.fill"
        case .settings:     return "gearshape.fill"
        case .admin:        return "shield.fill"
        }
    }

    /// The sidebar's outline glyph (dev web: calm, one colour, lucide-like). `icon` stays for the phone's
    /// launcher tiles, which are filled and tinted.
    var sidebarIcon: String {
        switch self {
        case .dashboard:    return "square.grid.2x2"
        case .tasks:        return "checkmark.square"
        case .inbox:        return "tray"
        case .projects:     return "folder"
        case .messages:     return "bubble.left"
        case .gideon:       return "sparkles"
        case .threads:      return "at"
        case .submissions:  return "doc.text"
        case .teamCalendar: return "calendar"
        case .roomBooking:  return "door.left.hand.open"
        case .leaderboard:  return "trophy"
        case .reports:      return "chart.bar"
        case .docs:         return "book"
        case .forms:        return "list.bullet.rectangle"
        case .vault:        return "externaldrive"
        case .attendance:   return "clock.badge.checkmark"
        case .tickets:      return "ticket"
        case .teams:        return "person.3"
        case .settings:     return "gearshape"
        case .admin:        return "shield"
        }
    }

    var tint: Color {
        switch self {
        case .dashboard, .projects, .threads, .teamCalendar, .docs, .vault, .settings, .gideon: return NX.violetText
        case .tasks, .attendance, .reports:                                    return NX.success
        case .inbox, .messages, .forms, .tickets:                              return NX.blue
        case .submissions, .leaderboard:                                       return NX.warning
        case .roomBooking, .teams:                                             return NX.coral
        case .admin:                                                           return NX.danger
        }
    }

    /// How wide this screen's content is allowed to get, or nil to let it fill.
    ///
    /// A column of text or cards has a width past which it stops being readable — the eye loses the
    /// start of the next line. On a 13-inch iPad every screen was running the full width, so a task
    /// title sat alone on a line a foot long.
    ///
    /// nil is not "forgot to set it": the map, the kanban boards and the calendar earn their width.
    /// A board with horizontal columns is *less* usable squeezed into a column, and a map shows more
    /// ground the wider it is.
    var contentMaxWidth: CGFloat? {
        // Every page runs the full width of the detail column, as the web's shared PageLayout does since
        // its UI sweep (12 Oct 2026). Readable widths are kept INSIDE the screens that need them (the
        // page reader caps its text at 760 pt; cards lay out in NXCardGrid columns).
        nil
    }

    /// True for screens that draw their own header instead of a navigation bar. They are the only
    /// ones that need a hand-made sidebar button, because the system's lives in a bar they hide.
    var hidesNavigationBar: Bool {
        switch self {
        // The web-style page header screens (Mac parity, 13 Oct) hide the bar as the sidebar's root too, so
        // they get the same top band that keeps their header clear of the window controls.
        case .dashboard, .inbox, .projects, .threads, .submissions, .leaderboard, .reports, .docs,
             .attendance, .tickets, .admin, .teamCalendar, .vault, .settings, .roomBooking, .gideon:
            return true
        default: return false
        }
    }

    /// The four phone tab roots each build their own NavigationStack. The launcher screens were
    /// written to be pushed INTO MoreView's stack, so they have none of their own — the sidebar
    /// has to supply one or their toolbars and titles simply never appear.
    var ownsNavigationStack: Bool {
        switch self {
        // Messages builds its own stacks in the split layout — one per pane.
        // GIDEON's page brings no stack of its own (GideonPanel(embedded:)), so it works pushed too.
        case .dashboard, .tasks, .inbox, .projects, .messages: return true
        default: return false
        }
    }

    @ViewBuilder var view: some View {
        switch self {
        case .dashboard:    DashboardView()
        case .tasks:        TasksView()
        case .inbox:        InboxView()
        case .projects:     ProjectsView()
        case .messages:     MessagesView(providesOwnStack: true)
        case .gideon:       GideonPanel(embedded: true)
        case .threads:      ThreadsView()
        case .submissions:  SubmissionsView()
        case .teamCalendar: CalendarView()
        case .roomBooking:  RoomBookingView()
        case .leaderboard:  LeaderboardView()
        case .reports:      ReportsView()
        case .docs:         DocsView()
        case .forms:        FormsView()
        case .vault:        VaultView()
        case .attendance:   AttendanceView()
        case .tickets:      TicketsView()
        case .teams:        TeamsView()
        case .settings:     SettingsView()
        case .admin:        AdminView()
        }
    }

    /// The sidebar's name for a screen. The web sidebar calls Home "Dashboard" (its group is "Home");
    /// the phone's tab keeps "Home".
    var sidebarTitle: String {
        self == .dashboard ? T("Dashboard") : title
    }

    /// Sidebar grouping, exactly the dev web's AppSidebar.tsx (Mac parity, 13 Oct 2026): Home · Work ·
    /// Team · System, in the web's order. Only the iPad / Mac sidebar reads this.
    ///
    /// Computed, not a stored `static let`: the titles go through T(), and a stored property is
    /// initialised once and frozen. Switching the app language would then leave every section
    /// header in the old language until the app was killed.
    ///
    /// Reports and Forms have no entry in the web sidebar (the web reaches Reports by its URL and the
    /// audit log, Forms from My Submissions' empty state). They stay reachable here as the last rows of
    /// Work rather than disappear. Pages (`.docs`) and `.teams` were already off the sidebar; their
    /// routes stay alive for old shortcuts and notification links.
    static var groups: [(title: String?, screens: [NXScreen])] { [
        (T("Home"),   [.dashboard, .messages, .gideon, .inbox, .threads, .vault, .tasks, .submissions, .teamCalendar, .roomBooking]),
        (T("Work"),   [.projects, .leaderboard, .reports, .forms]),
        (T("Team"),   [.attendance]),
        (T("System"), [.tickets, .settings, .admin]),
    ] }
}

/// A list of cards that becomes two columns once there is width for them.
///
/// A card holding a title and a date is the same card at 440pt as at 900pt — the extra width goes
/// into the gap after the text, not into anything readable. Two columns spend it on a second card
/// instead, and halve the scrolling.
///
/// Drop-in for a LazyVStack: on a phone it IS one, because the size class never reports regular
/// there and a single flexible column lays out exactly the same way.
struct NXCardGrid<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var hSize
    var spacing: CGFloat = 12
    @ViewBuilder let content: () -> Content

    private var columns: [GridItem] {
        #if targetEnvironment(macCatalyst)
        // A Mac window has no cap any more: as many ~380pt columns as fit.
        return [GridItem(.adaptive(minimum: 380), spacing: spacing)]
        #else
        return hSize == .regular
            ? [GridItem(.flexible(), spacing: spacing), GridItem(.flexible(), spacing: spacing)]
            : [GridItem(.flexible())]
        #endif
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: spacing, content: content)
    }
}

/// What the sidebar has selected. A fixed screen, or one particular project board — the shortcuts
/// section needs to point at something the eighteen-case enum has no room for.
enum NXSelection: Hashable {
    case screen(NXScreen)
    case project(ProjectRef)
}

/// Picks the shape. Regular width means iPad (any orientation) and, later, a Mac window.
///
/// The two shapes share no state: crossing the size class (Split View, Slide Over, a narrow Stage
/// Manager tile) builds the other one from nothing. The router tells the new one where the person
/// was, so they stay on that screen — and the Calendar on its day — instead of landing on Home.
struct AdaptiveRoot: View {
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(AppRouter.self) private var router

    var body: some View {
        Group {
            if hSize == .regular {
                SidebarRoot()
            } else {
                TabRoot()
            }
        }
        .onChange(of: hSize) { old, new in
            guard let old, let new, old != new else { return }
            router.carryAcrossShapes(toSidebar: new == .regular)
        }
        // A sidebar request made while the tab bar is mounted has nobody to answer it; left lying
        // there, it would be answered the next time the window grows, over wherever the person has
        // gone since. (The sidebar clears the tab bar's pending push the same way.)
        .onChange(of: router.sidebarRequest) { _, requested in
            if requested != nil, hSize != .regular { router.sidebarRequest = nil }
        }
    }
}

/// Phone shape: Home · Chat · Calendar · Projects · More. The Calendar took Inbox's place (owner,
/// 8 Oct 2026), and Chat took Tasks' (owner, 9 Oct 2026) — chat is what the crew opens all day, and
/// Tasks moved into More beside Inbox. The More tab carries Inbox's unread count, the Chat tab its
/// own. While the server's `flags.calendar` holds the Calendar back, Inbox keeps the third tab, with
/// the count on it, as before. The iPad / Mac sidebar is not touched.
struct TabRoot: View {
    @Environment(AppRouter.self) private var router
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var badge = InboxBadge.shared
    /// The Chat tab's count. Home's Chat tile used to keep it fresh; the tab does now.
    @State private var chat = ChatStore.shared

    var body: some View {
        @Bindable var router = router
        let calendarTab = RemoteConfig.shared.calendar
        // Tagged and bound so something outside the app can move the tab bar. Without the tags the
        // selection binding matches nothing and every tab silently stops responding to taps.
        TabView(selection: $router.tab) {
            DashboardView()
                .tabItem { Label(T("Home"), systemImage: "house.fill") }
                .tag(PhoneTab.dashboard)
            // Its own stack as a tab root, as the sidebar gives it (MoreView pushes the no-stack form).
            MessagesView(providesOwnStack: true)
                .tabItem { Label(T("Chat"), systemImage: "bubble.left.and.bubble.right.fill") }
                .badge(chat.totalUnread)
                .tag(PhoneTab.messages)
            if calendarTab {
                // The Calendar was written to be pushed into a stack (More's, Home's tiles), so as
                // a tab root it gets one of its own — as the sidebar gives it.
                NavigationStack { CalendarView() }
                    .tabItem { Label(T("Calendar"), systemImage: "calendar") }
                    .tag(PhoneTab.calendar)
            } else {
                InboxView()
                    .tabItem { Label(T("Notifications"), systemImage: "tray.fill") }
                    .badge(badge.count)
                    .tag(PhoneTab.inbox)
            }
            ProjectsView()
                .tabItem { Label(T("Projects"), systemImage: "rectangle.stack.fill") }
                .tag(PhoneTab.projects)
            MoreView()
                .tabItem { Label(T("More"), systemImage: "ellipsis") }
                .badge(calendarTab ? badge.count : 0)
                .tag(PhoneTab.more)
        }
        // NOTE: no .tabBarMinimizeBehavior — the bar stays full-size while scrolling (by request).
        .task { await badge.refresh(force: true) }
        .task(id: auth.session?.userId) { await chat.refreshUnread(userId: auth.session?.userId) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await badge.refresh() }
                Task { await chat.refreshUnread(userId: auth.session?.userId) }
            }
        }
        // A chat push in the foreground or the realtime connection's word: the count moved.
        .onReceive(NotificationCenter.default.publisher(for: .nexusChatPush)) { _ in
            Task { await chat.refreshUnread(userId: auth.session?.userId, force: true) }
        }
        // The server switched the Calendar on or off while the app was open, and the tab that was
        // selected is gone: the same screen opens inside More instead of the bar selecting nothing.
        .onChange(of: calendarTab) { _, on in
            if on, router.tab == .inbox { router.go(.inbox) }
            if !on, router.tab == .calendar { router.go(.teamCalendar) }
        }
    }
}

/// The unread Inbox count on the phone's tab bar: on More, where Inbox lives since the Calendar took
/// its tab (owner, 8 Oct 2026), or on the Inbox tab while the Calendar is held back.
///
/// Read from GET /api/notifications when the tab bar appears, when the app comes to the front and
/// when a push arrives in the foreground (NotificationManager.willPresent); the Inbox and Home's bell
/// hand over what they have just read instead of fetching again.
@MainActor @Observable
final class InboxBadge {
    static let shared = InboxBadge()
    private(set) var count = 0 {
        didSet { if count != oldValue { AppIconBadge.sync() } }
    }
    private var lastFetch: Date?
    /// Whose count it is: signing in as somebody else on the same launch starts from zero, never
    /// from the previous person's number.
    private var userId: String?

    /// At most every 30 seconds unless forced: coming back to the app twice in a row is one fetch.
    func refresh(force: Bool = false) async {
        guard let me = Keychain.load()?.userId else { count = 0; userId = nil; return }
        if me != userId { count = 0; userId = me; lastFetch = nil }
        if !force, let lastFetch, Date().timeIntervalSince(lastFetch) < 30 { return }
        lastFetch = Date()
        // A failure (offline, a server hiccup) leaves the count as it was rather than clearing it.
        guard let n = try? await APIClient.shared.unreadCount() else { return }
        guard Keychain.load()?.userId == me else { return }
        count = max(0, n)
    }

    /// What the Inbox or Home's bell has just read — no second fetch.
    func set(_ n: Int) {
        userId = Keychain.load()?.userId
        count = max(0, n)
    }
}

/// iPad / Mac shape — every destination visible at once, detail on the right.
struct SidebarRoot: View {
    @Environment(AppRouter.self) private var router
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewer = Viewer.shared
    @State private var selection: NXSelection? = .screen(.dashboard)
    @State private var columns: NavigationSplitViewVisibility = .all
    /// The collapsed sidebar floating over the page while the pointer rests on ≡ (Notion's peek).
    @State private var peeking = false
    @State private var shortcuts = ProjectShortcuts.shared
    /// The root's one sheet: search (⌘K), the keyboard shortcuts (⌘/) or a new project (Projects +).
    /// One `.sheet(item:)` rather than several `.sheet`s, because two on one view leaves one of them dead.
    @State private var rootSheet: SidebarRootSheet?
    /// The window's shortcuts stay quiet while a sheet / alert is up over it (QA BoD R2: focus stays in
    /// the top-most sheet). SheetCover.swift.
    @State private var cover = SheetCover()
    /// Live counts on the nav rows, as the web's sidebar shows them: Notifications (unread), Messages
    /// (unread chat) and Attendance (offsite check-outs waiting on a BoD).
    @State private var inboxBadge = InboxBadge.shared
    @State private var chat = ChatStore.shared
    @State private var offsitePending = 0
    /// Needed by the new-project sheet (Projects +). Loaded once; + stays disabled until it is known.
    @State private var workspaceId: String?

    /// Company-only screens (Z Vault, Threads) left out for anyone outside the company workspace,
    /// and the Calendar while the server's `flags.calendar` holds it back.
    private var navGroups: [(title: String?, screens: [NXScreen])] {
        let calendarOn = RemoteConfig.shared.calendar
        return NXScreen.groups.map { g in
            (g.title, g.screens.filter {
                (($0 != .vault && $0 != .threads) || viewer.isCompanyMember) && ($0 != .teamCalendar || calendarOn)
            })
        }
    }

    /// The sidebar itself: the docked column, and the same list floating over the page while it peeks.
    @ViewBuilder private func sidebarList() -> some View {
        List(selection: $selection) {
            ForEach(Array(navGroups.enumerated()), id: \.offset) { _, group in
                Section {
                    // Control Room is drawn only for MANAGER and above, matching the web and the
                    // phone launcher. The routes behind it refuse everyone else regardless; this
                    // just stops offering a door that opens onto a wall of 403s.
                    ForEach(group.screens.filter { $0 != .admin || viewer.canAdminister }) { screen in
                        navRow(screen)
                    }
                    // No "Pipeline" row under Work (owner, 9 Oct 2026): the board is a project
                    // like any other, reached from Projects (pinned, or the list).
                } header: {
                    if let title = group.title {
                        SidebarGroupLabel(text: title)
                    }
                }
            }

            // The web's Projects tree, after the nav groups: "Projects" with its + and the
            // Pinned shortcuts (SidebarProjectTree.tsx).
            Section {
                if shortcuts.pinned.isEmpty {
                    Text(T("Pin a project to keep it here."))
                        .font(NXFont.text(13))
                        .foregroundStyle(NX.mutedFg)
                        .selectionDisabled()
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "pin").font(.system(size: 11))
                        Text(T("Pinned")).font(NXFont.text(12, .medium))
                    }
                    .foregroundStyle(NX.mutedFg)
                    .selectionDisabled()
                    .accessibilityAddTraits(.isHeader)
                    projectRows(shortcuts.pinned)
                }
            } header: {
                HStack {
                    SidebarGroupLabel(text: T("Projects"))
                    Spacer(minLength: 4)
                    if workspaceId != nil {
                        Button { rootSheet = .newProject } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 13, weight: .regular))
                                .foregroundStyle(NX.mutedFg)
                                .frame(width: 26, height: 26)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .help(T("New project"))
                        .accessibilityLabel(T("New project"))
                    }
                }
            }
        }
        .listStyle(.sidebar)
        #if targetEnvironment(macCatalyst)
        // The web's sidebar is 256 wide with 30 pt rows. The Mac (the iPad app at 77 %) used the iPad's
        // touch sidebar: about 375 wide with 47 pt rows, so the nav ran off the bottom before Team and
        // System and the page lost a quarter of the window (UI tour run 4). A pointer needs no 44 pt
        // rows; the iPad keeps them.
        .environment(\.defaultMinListRowHeight, 30)
        #endif
        .scrollIndicators(.hidden)
        // Fixed header and footer, like the web's SidebarHeader / SidebarFooter: they stay put while
        // the nav scrolls between them.
        .safeAreaInset(edge: .top, spacing: 0) {
            SidebarBrandHeader(
                // The one sidebar control while it is open. In the peek panel the same icon docks
                // the sidebar open, as in Notion.
                onCollapse: { toggleSidebar() },
                onSearch: { if !cover.isCovered { rootSheet = .search } }
            )
            .background(.bar)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SidebarAccountFooter(
                onOpenProfile: { selection = .screen(.settings) },
                onShortcuts: { if !cover.isCovered { rootSheet = .shortcuts } }
            )
            .background(.bar)
        }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebarList()
            #if targetEnvironment(macCatalyst)
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 340)
            #endif
            // Apple's own toggle lives in the DETAIL column's navigation bar, so it appeared on the
            // seventeen screens that have one and vanished on the two that don't — the control moved
            // depending on where you happened to be. Remove it and carry one handle everywhere.
            .toolbar(removing: .sidebarToggle)
            // No title: the header above the nav carries the name, as on the web.
            .navigationTitle("")
            // The pinned projects, live (owner, 8 Oct 2026): a pin, rename or new icon made on another
            // device shows here within 30 s while the sidebar is on screen and the app is in front,
            // at once on coming back to the front, and on the realtime client's word once it exists.
            .liveRefresh(every: 30, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.projects]) {
                await shortcuts.syncPins()
                keepProjectSelection()
            }
        } detail: {
            let needsTopBand = detailHidesNavigationBar
            detail(for: selection ?? .screen(.dashboard))
                // The bar sat against the right edge of the reading column rather than the window,
                // which read as a stray line down the middle of the screen. Content is scrolled by
                // hand here, not dragged by the bar.
                .scrollIndicators(.hidden)
                // The sidebar control for the page headers: the ≡ before a title while the sidebar is
                // collapsed (SidebarToggle.swift). Notion-like (owner, 14 Oct 2026); it replaces the round
                // handle that floated in the gutter between the sidebar and the page.
                .environment(\.sidebarControl, SidebarControl(
                    collapsed: columns == .detailOnly,
                    toggle: { toggleSidebar() },
                    peek: { on in peeking = on && columns == .detailOnly }
                ))
                // Screens that hide their navigation bar get an empty band at the top: once the sidebar
                // is away, iPadOS's window controls (and the Mac's traffic lights) land on the detail
                // column, and the band keeps the page header clear of them. Reserved whatever the
                // sidebar is doing — an inset that comes and goes mid-animation snaps instead of sliding.
                .safeAreaInset(edge: .top, spacing: 0) {
                    if needsTopBand {
                        Color.clear.frame(height: 44)
                    }
                }
        }
        // Peek: the pointer rests on ≡ while the sidebar is collapsed → the sidebar floats over the page
        // and goes away once the pointer leaves it (Notion). Picking a row closes it (onChange(selection)).
        .overlay(alignment: .topLeading) {
            if peeking && columns == .detailOnly {
                sidebarList()
                    .frame(width: 280)
                    .frame(maxHeight: .infinity)
                    .background(NX.background)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    .shadow(color: .black.opacity(0.18), radius: 18, y: 6)
                    .padding(.leading, 8)
                    .padding(.top, 52)
                    .padding(.bottom, 12)
                    .onHover { inside in if !inside { peeking = false } }
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.9), value: peeking)
        // Keyboard (iPad keyboard, Mac): ⌘1…⌘7 jump to Home, Projects, My Tasks, Notifications, Messages,
        // Calendar and Attendance — the menu bar lists them under the app's commands.
        .background {
            Group {
                ForEach(Array(Self.shortcutScreens.enumerated()), id: \.offset) { i, screen in
                    Button(screen.title) { if !cover.isCovered { selection = .screen(screen) } }
                        .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
                }
                // ⌘K: search everything (web). Not while an editor has the keyboard: there ⌘K adds a link.
                Button(T("Search")) { if !cover.isCovered { rootSheet = .search } }
                    .keyboardShortcut("k", modifiers: .command)
                    .disabled(EditorKeys.shared.editorHasKeyboard)
                // ⌘/: every keyboard shortcut of the app (web "?" / ⌘/ dialog, QA 13 Oct 2026).
                Button(T("Keyboard shortcuts")) { if !cover.isCovered { rootSheet = .shortcuts } }
                    .keyboardShortcut("/", modifiers: .command)
                // ⌘\ shows or hides the sidebar, as in Notion (owner, 14 Oct 2026; it was ⌘S).
                Button(T("Show or hide the sidebar")) { toggleSidebar() }
                    .keyboardShortcut("\\", modifiers: .command)
                SheetCover.Anchor(cover: cover).frame(width: 0, height: 0)
            }
            .opacity(0).accessibilityHidden(true)
        }
        // An outside instruction arrives as a request, not as state, and is cleared the moment it
        // is answered. Held as state it would keep dragging the sidebar back to attendance every
        // time this view redrew, and no amount of tapping elsewhere would stick.
        // Environment passed explicitly: a sheet on Mac Catalyst does not always inherit it (GideonPanel).
        .sheet(item: $rootSheet) { which in
            switch which {
            case .search: NavigationStack { SearchView() }.environment(auth).environment(router)
            case .shortcuts: KeyboardShortcutsHelp().environment(auth).environment(router)
            // The same gallery-first sheet as Projects' own + (ProjectsView.swift); the project made
            // opens in the detail column.
            case .newProject:
                CreateProjectSheet(workspaceId: workspaceId ?? "", onOpenProject: { ref in
                    selection = .project(ref)
                }) {
                    NotificationCenter.default.post(name: .nexusWorkspaceChanged, object: nil,
                                                    userInfo: [RealtimeKey.kind: RealtimeKind.projects])
                }
                .environment(auth).environment(router)
            }
        }
        .task { await viewer.loadIfNeeded() }
        .task { if workspaceId == nil { workspaceId = try? await APIClient.shared.workspaceInfo().workspaceId } }
        // The counts beside Notifications and Messages (the phone's tab bar keeps them fresh there).
        .task { await inboxBadge.refresh(force: true) }
        .task(id: auth.session?.userId) { await chat.refreshUnread(userId: auth.session?.userId) }
        // Attendance: offsite check-outs waiting on a BoD, every 45 s like the web; BoD / One Above All only.
        .task(id: viewer.isBoD) {
            guard viewer.isBoD else { offsitePending = 0; return }
            while !Task.isCancelled {
                if let items = try? await APIClient.shared.offsiteCheckouts(status: "PENDING") {
                    offsitePending = items.count
                }
                try? await Task.sleep(for: .seconds(45))
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await inboxBadge.refresh() }
            Task { await chat.refreshUnread(userId: auth.session?.userId) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusChatPush)) { _ in
            Task { await chat.refreshUnread(userId: auth.session?.userId, force: true) }
        }
        // A request made before this shape existed: the screen the tab bar was showing when the window
        // grew past compact (AppRouter.carryAcrossShapes), or a link that arrived on a cold start.
        .onAppear {
            if let requested = router.sidebarRequest {
                selection = .screen(requested)
                router.sidebarRequest = nil
                router.morePush = nil
            }
            if let requested = router.projectRequest {
                selection = .project(requested)
                router.projectRequest = nil
            }
        }
        // `go` also leaves a push for the phone's More tab, which is not mounted here: cleared with the
        // request, or the tab bar would open on it the next time the window narrows.
        .onChange(of: router.sidebarRequest) { _, requested in
            guard let requested else { return }
            selection = .screen(requested)
            router.sidebarRequest = nil
            router.morePush = nil
        }
        // A project asked for as a page (AppRouter.openProjectPage): selected like a pinned shortcut.
        .onChange(of: router.projectRequest) { _, requested in
            guard let requested else { return }
            selection = .project(requested)
            router.projectRequest = nil
        }
        // Publish where the sidebar is standing, so the floating GIDEON launcher — drawn above the
        // whole app, outside this layout — can tell Home from everything else. A project shortcut
        // is not Home, and reports itself as Projects.
        .onChange(of: selection) { _, now in
            peeking = false
            switch now ?? .screen(.dashboard) {
            case .screen(let screen): router.sidebarScreen = screen
            case .project:            router.sidebarScreen = .projects
            }
        }
    }

    /// Opens or closes the sidebar. A spring, named here rather than left to the system: .snappy is short
    /// by design and NavigationSplitView reveals a column more generously than it takes one away, so
    /// closing looked instant next to opening. Nothing moves behind a sheet.
    private func toggleSidebar() {
        guard !cover.isCovered else { return }
        peeking = false
        withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
            columns = columns == .detailOnly ? .all : .detailOnly
        }
    }

    /// ⌘1…⌘7, in this order. Also read by the keyboard shortcuts sheet (KeyboardShortcutsHelp.swift).
    static let shortcutScreens: [NXScreen] = [.dashboard, .projects, .tasks, .inbox, .messages, .teamCalendar, .attendance]

    /// A project shortcut is selected by its whole ref (id, name, icon). When a refresh brings the same
    /// project back renamed or with a new icon, its row's tag changes and the List would show nothing
    /// selected while its board is still open: follow it to the new ref. Same id, so the board stays.
    private func keepProjectSelection() {
        guard case .project(let ref) = selection,
              let now = (shortcuts.pinned + shortcuts.recent).first(where: { $0.id == ref.id }),
              now != ref else { return }
        selection = .project(now)
    }

    /// Whether the detail column draws without a navigation bar, and therefore has nowhere for the
    /// system's sidebar button to live. Project boards hide their bar too, so a shortcut opened
    /// from the sidebar would otherwise strand the user exactly like Dashboard did.
    private var detailHidesNavigationBar: Bool {
        switch selection {
        case .screen(let s):  return s.hidesNavigationBar
        case .project:        return true
        case nil:             return NXScreen.dashboard.hidesNavigationBar
        }
    }

    @ViewBuilder private func detail(for selection: NXSelection) -> some View {
        switch selection {
        case .screen(let screen):
            readable(screen.contentMaxWidth) {
                if screen.ownsNavigationStack {
                    screen.view
                } else if screen.hidesNavigationBar {
                    NavigationStack { screen.view }
                } else {
                    // A screen that keeps its navigation bar (Forms, Teams): ≡ is the bar's first item.
                    NavigationStack { screen.view.modifier(SidebarReopenToolbar()) }
                }
            }
        case .project(let ref):
            // A project board is columns side by side, so it takes whatever width it is given.
            // Keyed by id so switching between two shortcuts rebuilds the board instead of
            // leaving the first project's rows on screen under the second one's title.
            NavigationStack { ProjectDetailView(projectId: ref.id, projectName: ref.name) }
                .id(ref.id)
        }
    }

    /// Centres a screen inside a reading-width column, on a background that still runs edge to edge.
    ///
    /// The background is painted here rather than left to the screen, because each screen paints its
    /// own inside its own bounds — capped to 900pt, that would have left bare gutters either side
    /// in the system's colour instead of the app's.
    @ViewBuilder private func readable<Content: View>(_ maxWidth: CGFloat?,
                                                     @ViewBuilder content: () -> Content) -> some View {
        if let maxWidth {
            ZStack {
                NX.background.ignoresSafeArea()
                content().frame(maxWidth: maxWidth)
            }
        } else {
            content()
        }
    }

    /// One nav row: outline glyph, the web's name, and its live count when there is one.
    @ViewBuilder private func navRow(_ screen: NXScreen) -> some View {
        let selected = selection == .screen(screen)
        Label {
            HStack(spacing: 6) {
                Text(screen.sidebarTitle).font(NXFont.text(15)).lineLimit(1)
                Spacer(minLength: 4)
                let n = badgeCount(screen)
                if n > 0 { SidebarCountBadge(count: n, warning: screen == .attendance, onSelection: selected) }
            }
        } icon: {
            // Calm, one colour (dev web); white on the selection fill.
            Image(systemName: screen.sidebarIcon)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(selected ? Color.white : NX.mutedFg)
        }
        .tag(NXSelection.screen(screen))
        .modifier(MacSidebarRowInsets())
    }

    private func badgeCount(_ screen: NXScreen) -> Int {
        switch screen {
        case .inbox:      return inboxBadge.count
        case .messages:   return chat.totalUnread
        case .attendance: return viewer.isBoD ? offsitePending : 0
        default:          return 0
        }
    }

    /// Pinned project rows. Unpin / remove sit in the context menu (right click, long press), as the web
    /// keeps them in the row's menu rather than as a visible pin on every row.
    @ViewBuilder private func projectRows(_ refs: [ProjectRef]) -> some View {
        ForEach(refs) { ref in
            HStack(spacing: 10) {
                projectIcon(ref)
                Text(ref.name).font(NXFont.text(15)).lineLimit(1)
            }
            .tag(NXSelection.project(ref))
            .modifier(MacSidebarRowInsets())
            .contextMenu {
                Button {
                    shortcuts.togglePin(ref)
                } label: {
                    Label(shortcuts.isPinned(ref.id) ? T("Unpin") : T("Pin"),
                          systemImage: shortcuts.isPinned(ref.id) ? "pin.slash" : "pin")
                }
                Button(role: .destructive) {
                    shortcuts.forget(ref.id)
                } label: {
                    Label(T("Remove from sidebar"), systemImage: "xmark")
                }
            }
        }
    }

    @ViewBuilder private func projectIcon(_ ref: ProjectRef) -> some View {
        ProjectRefIcon(ref: ref, size: 20)
    }
}

/// A shortcut row's project mark: its photo, or the default grey page icon (ProjectMark; stored
/// emoji are no longer drawn since 11 Oct 2026, page icon = option A since 14 Oct).
///
/// Shared rather than private to the sidebar: the phone's Dashboard shows the same shortcuts, and
/// two drawings of the same thing drift apart the first time one of them is touched.
struct ProjectRefIcon: View {
    let ref: ProjectRef
    var size: CGFloat = 26

    var body: some View {
        ProjectMark(icon: ref.icon, color: ref.color, size: size, projectId: ref.id)
    }
}

/// What SidebarRoot's single sheet shows.
enum SidebarRootSheet: String, Identifiable {
    case search, shortcuts, newProject
    var id: String { rawValue }
}

/// A sidebar group label in the web's style: small, medium weight, muted, not upper-cased
/// (SidebarGroupLabel, text-xs). `textCase(nil)` because List headers upper-case by default.
/// Mac only: the web sidebar's row padding (py-1.5 px-2) instead of the iPad's touch insets.
struct MacSidebarRowInsets: ViewModifier {
    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content.listRowInsets(EdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 10))
        #else
        content
        #endif
    }
}

struct SidebarGroupLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(NXFont.text(12, .medium))
            .foregroundStyle(NX.mutedFg)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The count beside a nav row (web: rounded-full 10px bold; Attendance amber, the others quiet).
struct SidebarCountBadge: View {
    let count: Int
    var warning = false
    /// The row is selected: on the selection fill a quiet badge turns white.
    var onSelection = false

    var body: some View {
        Text(count > 9 ? "9+" : "\(count)")
            .font(NXFont.text(11, .bold)).monospacedDigit()
            .foregroundStyle(warning ? Color.white : (onSelection ? Color.white : NX.foreground))
            .padding(.horizontal, 6).padding(.vertical, 1)
            .frame(minWidth: 18)
            .background(warning ? NX.warning : (onSelection ? Color.white.opacity(0.25) : NX.muted), in: Capsule())
            .accessibilityLabel(String(count))
    }
}
