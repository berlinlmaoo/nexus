import SwiftUI

/// Switches between login and the authenticated app (5-tab bar mirroring the web).
struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @State private var appearance = AppAppearance.shared

    var body: some View {
        content
            // In-app light/dark override. nil = follow the iOS setting.
            // (LoginView keeps its own forced .light — that screen's cream/white art is designed
            // for light only, so it deliberately opts out.)
            .preferredColorScheme(appearance.theme.colorScheme)
    }

    @ViewBuilder private var content: some View {
        if auth.isAuthenticated {
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
        } else {
            LoginView()
        }
    }
}

/// "More" — app-launcher grid mirroring the web sidebar groups (Home Base / Missions /
/// Knowledge / Pulse Check / System) + account footer.
struct MoreView: View {
    @Environment(AuthStore.self) private var auth
    private let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        MoreSection(T("Home Base")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Messages"), "bubble.left.and.bubble.right.fill", NX.blue) { MessagesView() }
                                MoreTile(T("Threads"), "text.bubble.fill", NX.violetText) { ThreadsView() }
                                MoreTile(T("My Submissions"), "tray.full.fill", NX.warning) { SubmissionsView() }
                                MoreTile(T("Team Calendar"), "calendar", NX.violetText) { TeamCalendarView() }
                                MoreTile(T("Room Booking"), "door.left.hand.open", NX.coral) { RoomBookingView() }
                            }
                        }
                        MoreSection(T("Missions")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Leaderboard"), "trophy.fill", NX.warning) { LeaderboardView() }
                                MoreTile(T("Reports"), "chart.bar.fill", NX.success) { ReportsView() }
                            }
                        }
                        MoreSection(T("Knowledge")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Knowledge Library"), "book.fill", NX.violetText) { DocsView() }
                                MoreTile(T("Forms"), "doc.text.fill", NX.blue) { FormsView() }
                            }
                        }
                        MoreSection(T("Pulse Check")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Attendance"), "clock.badge.checkmark.fill", NX.success) { AttendanceView() }
                            }
                        }
                        MoreSection(T("System")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Ticket"), "ticket.fill", NX.blue) { TicketsView() }
                                MoreTile(T("Teams"), "person.3.fill", NX.coral) { TeamsView() }
                                MoreTile(T("Tuning Room"), "gearshape.fill", NX.mutedFg) { SettingsView() }
                                MoreTile(T("Control Room"), "shield.fill", NX.danger) { AdminView() }
                            }
                        }

                        AccountFooter()
                    }
                    .padding(16)
                }
            }
            .navigationTitle(T("More"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Section header + content block for the More grid.
struct MoreSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(title).padding(.leading, 4)
            content()
        }
    }
}

/// One launcher tile: tinted icon square + title, pushes a destination.
struct MoreTile<Destination: View>: View {
    let title: String
    let systemImage: String
    let tint: Color
    @ViewBuilder let destination: () -> Destination
    init(_ title: String, _ systemImage: String, _ tint: Color, @ViewBuilder destination: @escaping () -> Destination) {
        self.title = title; self.systemImage = systemImage; self.tint = tint; self.destination = destination
    }
    var body: some View {
        NavigationLink { destination() } label: {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .semibold)).foregroundStyle(tint)
                    .frame(width: 46, height: 46)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
            .padding(14)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                    .nexusShadowSoft()
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            }
        }
        .buttonStyle(.plain)
    }
}

/// Account card (avatar + name + email) and logout.
struct AccountFooter: View {
    @Environment(AuthStore.self) private var auth
    /// The Keychain `Session` only stores id/name/email — no avatar — so the footer could only ever
    /// draw an initial. Fetch the profile for the real photo.
    @State private var avatar: String?

    var body: some View {
        VStack(spacing: 12) {
            if let s = auth.session {
                let name = s.userName.isEmpty ? s.userEmail : s.userName
                HStack(spacing: 12) {
                    AvatarView(url: avatar, initial: String(name.first ?? "?").uppercased(), size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text(s.userEmail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer()
                }
                .padding(14)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            }
            Button { auth.logout() } label: {
                Label(T("Logout"), systemImage: "rectangle.portrait.and.arrow.right")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(NX.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 4)
        .task { avatar = try? await APIClient.shared.profile().user.avatar }
    }
}
