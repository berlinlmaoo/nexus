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

    var tint: Color {
        switch self {
        case .dashboard, .projects, .threads, .teamCalendar, .docs, .vault, .settings: return NX.violetText
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
        #if targetEnvironment(macCatalyst)
        // Mac: every screen fills the window. Capped, a full-screen Mac showed one column in the
        // middle with most of the window empty either side (owner, 29 Sep 2026).
        return nil
        #else
        switch self {
        // Messages is two panes side by side once there is room, and a two-column layout wants the
        // width the same way a board does — capped, it sat squeezed in the middle of the screen
        // with empty margins either side.
        case .attendance, .projects, .submissions, .teamCalendar, .roomBooking, .reports, .messages:
            return nil
        default:
            return 900
        }
        #endif
    }

    /// True for screens that draw their own header instead of a navigation bar. They are the only
    /// ones that need a hand-made sidebar button, because the system's lives in a bar they hide.
    var hidesNavigationBar: Bool {
        switch self {
        case .dashboard: return true
        default: return false
        }
    }

    /// The four phone tab roots each build their own NavigationStack. The launcher screens were
    /// written to be pushed INTO MoreView's stack, so they have none of their own — the sidebar
    /// has to supply one or their toolbars and titles simply never appear.
    var ownsNavigationStack: Bool {
        switch self {
        // Messages builds its own stacks in the split layout — one per pane.
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

    /// Sidebar grouping, mirroring the web nav and the phone launcher.
    ///
    /// Computed, not a stored `static let`: the titles go through T(), and a stored property is
    /// initialised once and frozen. Switching the app language would then leave every section
    /// header in the old language until the app was killed.
    /// The plain names the web uses since 12 Oct 2026 (owner: no gimmicky terms): Home · Work · Team ·
    /// System, with Projects, My Tasks and Notifications at the top.
    static var groups: [(title: String?, screens: [NXScreen])] { [
        (nil,                 [.dashboard, .projects, .tasks, .inbox]),
        (T("Home"),           [.messages, .threads, .vault, .submissions, .teamCalendar, .roomBooking]),
        (T("Work"),           [.leaderboard, .reports, .forms]),
        (T("Team"),           [.attendance]),
        // `.teams` dilepas dari daftar: halaman daftar-tim sudah tidak ada di web maupun di HP.
        // Rute layarnya SENGAJA dibiarkan hidup di bawah — pintasan lama dan tautan dari
        // notifikasi masih bisa menunjuk ke sana, dan layar kosong lebih buruk daripada layar
        // yang tidak lagi ada di menu.
        (T("System"),         [.tickets, .settings, .admin]),
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
    @State private var viewer = Viewer.shared
    @State private var selection: NXSelection? = .screen(.dashboard)
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var shortcuts = ProjectShortcuts.shared

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

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List(selection: $selection) {
                ForEach(Array(navGroups.enumerated()), id: \.offset) { index, group in
                    // Project shortcuts sit directly under the four top-level destinations, not at
                    // the bottom of the list. They are the rows reached most often, and a shortcut
                    // you have to scroll past everything else to reach is not a shortcut.
                    if index == 1 {
                        if !shortcuts.pinned.isEmpty {
                            Section { projectRows(shortcuts.pinned) } header: { SectionLabel(T("Pinned")) }
                        }
                        // Anything already pinned is skipped: a project in both lists reads as a
                        // duplicate rather than as two kinds of shortcut.
                        let recents = shortcuts.recent.filter { !shortcuts.isPinned($0.id) }
                        if !recents.isEmpty {
                            Section { projectRows(recents) } header: { SectionLabel(T("Recent")) }
                        }
                    }
                    Section {
                        // Control Room is drawn only for MANAGER and above, matching the web and the
                        // phone launcher. The routes behind it refuse everyone else regardless; this
                        // just stops offering a door that opens onto a wall of 403s.
                        ForEach(group.screens.filter { $0 != .admin || viewer.canAdminister }) { screen in
                            Label {
                                Text(screen.title).font(NXFont.text(15, .semibold))
                            } icon: {
                                // White on the violet selection: Home's own violet vanished into it.
                                Image(systemName: screen.icon)
                                    .foregroundStyle(selection == .screen(screen) ? Color.white : screen.tint)
                            }
                            .tag(NXSelection.screen(screen))
                        }
                        // No "Pipeline" row under Missions (owner, 9 Oct 2026): the board is a project
                        // like any other, reached from Projects (pinned, recent, or the list).
                    } header: {
                        if let title = group.title {
                            SectionLabel(title)
                        }
                    }
                }

                Section {
                    AccountFooter { selection = .screen(.settings) }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
            }
            .listStyle(.sidebar)
            .scrollIndicators(.hidden)
            // Apple's own toggle lives in the DETAIL column's navigation bar, so it appeared on the
            // seventeen screens that have one and vanished on the two that don't — the control moved
            // depending on where you happened to be. Remove it and carry one handle everywhere.
            .toolbar(removing: .sidebarToggle)
            // No title: the sidebar is the app's own furniture, and a word repeating the app name
            // above its own menu is a row of pixels that tells the reader nothing.
            .navigationTitle("")
            // The pinned projects, live (owner, 8 Oct 2026): a pin, rename or new icon made on another
            // device shows here within 30 s while the sidebar is on screen and the app is in front,
            // at once on coming back to the front, and on the realtime client's word once it exists.
            .liveRefresh(every: 30, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.projects]) {
                await shortcuts.syncPins()
                keepProjectSelection()
            }
        } detail: {
            let needsOwnButton = detailHidesNavigationBar
            detail(for: selection ?? .screen(.dashboard))
                // The bar sat against the right edge of the reading column rather than the window,
                // which read as a stray line down the middle of the screen. Content is scrolled by
                // hand here, not dragged by the bar.
                .scrollIndicators(.hidden)
                // NavigationSplitView parks its own show/hide button in the DETAIL column's
                // navigation bar. Dashboard and the project board both hide that bar to draw their
                // own headers, so there it has nowhere to live: collapse the sidebar once and it
                // can never be brought back.
                //
                // Two insets, both only while the sidebar is away, because they answer two
                // different problems.
                //
                // The LEADING strip carries the button: left edge, vertically centred, like a
                // handle you pull the sidebar out by. It cannot sit in the top-left corner —
                // iPadOS draws its own window controls there and they do not move for anyone —
                // and safeAreaInset reserves the strip rather than floating over content, so
                // nothing is ever covered.
                //
                // The TOP band is empty on purpose. It exists only to push the screen's own header
                // clear of those same window controls, which land on the detail column once the
                // sidebar is no longer underneath them.
                .safeAreaInset(edge: .leading, spacing: 0) {
                    // Always present, and it swings both ways. Removing Apple's toolbar toggle took
                    // the only control that could CLOSE the sidebar with it — a handle that appears
                    // once the sidebar is gone can bring it back but can never send it away.
                    VStack {
                        Spacer(minLength: 0)
                        Button {
                            // A spring rather than .snappy, and named here rather than left to the
                            // system: .snappy is short by design, and NavigationSplitView reveals a
                            // column more generously than it takes one away — closing looked
                            // instant next to opening. The same curve in both directions is the
                            // point; the duration is only long enough to be seen.
                            withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                                columns = columns == .detailOnly ? .all : .detailOnly
                            }
                        } label: {
                            Image(systemName: "sidebar.leading")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(columns == .detailOnly ? NX.foreground : NX.violetText)
                                .frame(width: 38, height: 38)
                                .background(.regularMaterial, in: Circle())
                                .overlay(Circle().strokeBorder(NX.border))
                                .nexusShadowSoft()
                                // The 38 pt circle is what is drawn; the tap takes the 44 pt square
                                // around it, the least a finger needs (impeccable re-audit round 3,
                                // 8 Oct 2026). The pointer's lift keeps to the circle.
                                .frame(width: 44, height: 44)
                                .contentShape(.interaction, Rectangle())
                                .contentShape(.hoverEffect, Circle().inset(by: 3))
                        }
                        .buttonStyle(.plain)
                        // A trackpad pointer that doesn't change shape over a control leaves you
                        // guessing whether it is one. .lift also makes the circle read as a button
                        // rather than a decoration parked at the edge.
                        .hoverEffect(.lift)
                        // ⌘S because the sidebar is the thing being shown or hidden, and nothing
                        // else in the app claims it. Works whether or not the button is on screen.
                        .keyboardShortcut("s", modifiers: .command)
                        .accessibilityLabel(columns == .detailOnly ? T("Show sidebar") : T("Hide sidebar"))
                        Spacer(minLength: 0)
                    }
                    // 3 pt less each side than with the 38 pt frame: the strip keeps its width and the
                    // circle its place.
                    .padding(.leading, 7)
                    .padding(.trailing, 1)
                }
                // Reserved on every screen that hides its navigation bar, whatever the sidebar is
                // doing. It used to appear and disappear with the sidebar, and a safe-area inset
                // that comes and goes mid-animation is not animated by the same transaction as the
                // columns are — the content snapped while the sidebar slid, which is why the
                // collapse looked instant one time and animated the next.
                .safeAreaInset(edge: .top, spacing: 0) {
                    if needsOwnButton {
                        Color.clear.frame(height: 44)
                    }
                }
        }
        // Keyboard (iPad keyboard, Mac): ⌘1…⌘7 jump to Home, Projects, My Tasks, Notifications, Messages,
        // Calendar and Attendance — the menu bar lists them under the app's commands.
        .background {
            Group {
                ForEach(Array(Self.shortcutScreens.enumerated()), id: \.offset) { i, screen in
                    Button(screen.title) { selection = .screen(screen) }
                        .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
                }
            }
            .opacity(0).accessibilityHidden(true)
        }
        // An outside instruction arrives as a request, not as state, and is cleared the moment it
        // is answered. Held as state it would keep dragging the sidebar back to attendance every
        // time this view redrew, and no amount of tapping elsewhere would stick.
        .task { await viewer.loadIfNeeded() }
        // A request made before this shape existed: the screen the tab bar was showing when the window
        // grew past compact (AppRouter.carryAcrossShapes), or a link that arrived on a cold start.
        .onAppear {
            if let requested = router.sidebarRequest {
                selection = .screen(requested)
                router.sidebarRequest = nil
                router.morePush = nil
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
        // Publish where the sidebar is standing, so the floating GIDEON launcher — drawn above the
        // whole app, outside this layout — can tell Home from everything else. A project shortcut
        // is not Home, and reports itself as Projects.
        .onChange(of: selection) { _, now in
            switch now ?? .screen(.dashboard) {
            case .screen(let screen): router.sidebarScreen = screen
            case .project:            router.sidebarScreen = .projects
            }
        }
    }

    private static let shortcutScreens: [NXScreen] = [.dashboard, .projects, .tasks, .inbox, .messages, .teamCalendar, .attendance]

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
                } else {
                    NavigationStack { screen.view }
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

    @ViewBuilder private func projectRows(_ refs: [ProjectRef]) -> some View {
        ForEach(refs) { ref in
            HStack(spacing: 10) {
                projectIcon(ref)
                Text(ref.name).font(NXFont.text(15, .medium)).lineLimit(1)
                Spacer(minLength: 6)
                // A visible button, not only a long press: a gesture nobody is told about is a
                // feature nobody finds. .borderless keeps the tap on the button instead of letting
                // the row swallow it and change the selection.
                Button {
                    shortcuts.togglePin(ref)
                } label: {
                    Image(systemName: shortcuts.isPinned(ref.id) ? "pin.fill" : "pin")
                        .font(.system(size: 13))
                        .foregroundStyle(shortcuts.isPinned(ref.id) ? NX.violetText : NX.mutedFg)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(shortcuts.isPinned(ref.id) ? T("Unpin") : T("Pin"))
            }
            .tag(NXSelection.project(ref))
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
        ProjectRefIcon(ref: ref)
    }
}

/// A shortcut row's project mark: its photo, or the default task tile (ProjectMark, owner 11 Oct
/// 2026 — stored emoji are no longer drawn).
///
/// Shared rather than private to the sidebar: the phone's Dashboard shows the same shortcuts, and
/// two drawings of the same thing drift apart the first time one of them is touched.
struct ProjectRefIcon: View {
    let ref: ProjectRef
    var size: CGFloat = 26

    var body: some View {
        ProjectMark(icon: ref.icon, color: ref.color, size: size)
    }
}
