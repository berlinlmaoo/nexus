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
    case messages, threads, submissions, teamCalendar, roomBooking
    // Missions
    case leaderboard, reports
    // Knowledge
    case docs, forms
    // Pulse Check
    case attendance
    // System
    case tickets, teams, settings, admin

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard:    return T("Home")
        case .tasks:        return T("Tasks")
        case .inbox:        return T("Inbox")
        case .projects:     return T("Projects")
        case .messages:     return T("Messages")
        case .threads:      return T("Threads")
        case .submissions:  return T("My Submissions")
        case .teamCalendar: return T("Team Calendar")
        case .roomBooking:  return T("Room Booking")
        case .leaderboard:  return T("Leaderboard")
        case .reports:      return T("Reports")
        case .docs:         return T("Knowledge Library")
        case .forms:        return T("Forms")
        case .attendance:   return T("Attendance")
        case .tickets:      return T("Ticket")
        case .teams:        return T("Teams")
        case .settings:     return T("Tuning Room")
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
        case .attendance:   return "clock.badge.checkmark.fill"
        case .tickets:      return "ticket.fill"
        case .teams:        return "person.3.fill"
        case .settings:     return "gearshape.fill"
        case .admin:        return "shield.fill"
        }
    }

    var tint: Color {
        switch self {
        case .dashboard, .projects, .threads, .teamCalendar, .docs, .settings: return NX.violetText
        case .tasks, .attendance, .reports:                                    return NX.success
        case .inbox, .messages, .forms, .tickets:                              return NX.blue
        case .submissions, .leaderboard:                                       return NX.warning
        case .roomBooking, .teams:                                             return NX.coral
        case .admin:                                                           return NX.danger
        }
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
        case .dashboard, .tasks, .inbox, .projects: return true
        default: return false
        }
    }

    @ViewBuilder var view: some View {
        switch self {
        case .dashboard:    DashboardView()
        case .tasks:        TasksView()
        case .inbox:        InboxView()
        case .projects:     ProjectsView()
        case .messages:     MessagesView()
        case .threads:      ThreadsView()
        case .submissions:  SubmissionsView()
        case .teamCalendar: TeamCalendarView()
        case .roomBooking:  RoomBookingView()
        case .leaderboard:  LeaderboardView()
        case .reports:      ReportsView()
        case .docs:         DocsView()
        case .forms:        FormsView()
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
    static var groups: [(title: String?, screens: [NXScreen])] { [
        (nil,                 [.dashboard, .tasks, .inbox, .projects]),
        (T("Home Base"),      [.messages, .threads, .submissions, .teamCalendar, .roomBooking]),
        (T("Missions"),       [.leaderboard, .reports]),
        (T("Knowledge"),      [.docs, .forms]),
        (T("Pulse Check"),    [.attendance]),
        (T("System"),         [.tickets, .teams, .settings, .admin]),
    ] }
}

/// What the sidebar has selected. A fixed screen, or one particular project board — the shortcuts
/// section needs to point at something the eighteen-case enum has no room for.
enum NXSelection: Hashable {
    case screen(NXScreen)
    case project(ProjectRef)
}

/// Picks the shape. Regular width means iPad (any orientation) and, later, a Mac window.
struct AdaptiveRoot: View {
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        if hSize == .regular {
            SidebarRoot()
        } else {
            TabRoot()
        }
    }
}

/// Phone shape — unchanged from before, kept verbatim so the iPad work can't regress it.
struct TabRoot: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label(T("Home"), systemImage: "house.fill") }
            TasksView()
                .tabItem { Label(T("Tasks"), systemImage: "checklist") }
            InboxView()
                .tabItem { Label(T("Inbox"), systemImage: "tray.fill") }
            ProjectsView()
                .tabItem { Label(T("Projects"), systemImage: "rectangle.stack.fill") }
            MoreView()
                .tabItem { Label(T("More"), systemImage: "ellipsis") }
        }
        // NOTE: no .tabBarMinimizeBehavior — the bar stays full-size while scrolling (by request).
    }
}

/// iPad / Mac shape — every destination visible at once, detail on the right.
struct SidebarRoot: View {
    @State private var selection: NXSelection? = .screen(.dashboard)
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var shortcuts = ProjectShortcuts.shared

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List(selection: $selection) {
                ForEach(Array(NXScreen.groups.enumerated()), id: \.offset) { index, group in
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
                        ForEach(group.screens) { screen in
                            Label {
                                Text(screen.title).font(NXFont.text(15, .semibold))
                            } icon: {
                                Image(systemName: screen.icon).foregroundStyle(screen.tint)
                            }
                            .tag(NXSelection.screen(screen))
                        }
                    } header: {
                        if let title = group.title {
                            SectionLabel(title)
                        }
                    }
                }

                Section {
                    AccountFooter()
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
            }
            .listStyle(.sidebar)
            // No title: the sidebar is the app's own furniture, and a word repeating the app name
            // above its own menu is a row of pixels that tells the reader nothing.
            .navigationTitle("")
        } detail: {
            let needsOwnButton = detailHidesNavigationBar
            detail(for: selection ?? .screen(.dashboard))
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
                    if columns == .detailOnly && needsOwnButton {
                        VStack {
                            Spacer(minLength: 0)
                            Button {
                                withAnimation(.snappy) { columns = .all }
                            } label: {
                                Image(systemName: sidebar.leading)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(NX.foreground)
                                    .frame(width: 38, height: 38)
                                    .background(.regularMaterial, in: Circle())
                                    .overlay(Circle().strokeBorder(NX.border))
                                    .nexusShadowSoft()
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(T(Show sidebar))
                            Spacer(minLength: 0)
                        }
                        .padding(.leading, 10)
                        .padding(.trailing, 4)
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    if columns == .detailOnly && needsOwnButton {
                        Color.clear.frame(height: 44)
                    }
                }
        }
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
            if screen.ownsNavigationStack {
                screen.view
            } else {
                NavigationStack { screen.view }
            }
        case .project(let ref):
            // Keyed by id so switching between two shortcuts rebuilds the board instead of
            // leaving the first project's rows on screen under the second one's title.
            NavigationStack { ProjectDetailView(projectId: ref.id, projectName: ref.name) }
                .id(ref.id)
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

    /// The project's own picture where it has one, its emoji where it has that, and only then a
    /// generic glyph — a sidebar of identical symbols is a sidebar you have to read word by word.
    @ViewBuilder private func projectIcon(_ ref: ProjectRef) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7, style: .continuous).fill(NX.muted)
            if ref.isUploadedIcon {
                CachedImage(url: URL(string: Config.baseURL.absoluteString + (ref.icon ?? ""))) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "rectangle.stack").font(.system(size: 12)).foregroundStyle(NX.violetText)
                }
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            } else if let emoji = ref.emoji {
                Text(emoji).font(.system(size: 14))
            } else {
                Image(systemName: "rectangle.stack").font(.system(size: 12)).foregroundStyle(NX.violetText)
            }
        }
        .frame(width: 26, height: 26)
    }
}
