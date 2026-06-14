import SwiftUI

/// Switches between login and the authenticated app (5-tab bar mirroring the web).
struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        if auth.isAuthenticated {
            TabView {
                DashboardView()
                    .tabItem { Label("Home", systemImage: "house.fill") }
                TasksView()
                    .tabItem { Label("Tasks", systemImage: "checklist") }
                InboxView()
                    .tabItem { Label("Inbox", systemImage: "tray.fill") }
                ProjectsView()
                    .tabItem { Label("Projects", systemImage: "rectangle.stack.fill") }
                MoreView()
                    .tabItem { Label("More", systemImage: "ellipsis") }
            }
            .tabBarMinimizeOnScrollCompat()
        } else {
            LoginView()
        }
    }
}

extension View {
    /// iOS 26: shrink the floating tab bar into a compact pill while scrolling down, expand on
    /// scroll up. No-op on earlier OSes (deployment target is iOS 17).
    @ViewBuilder func tabBarMinimizeOnScrollCompat() -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }
}

/// Placeholder for screens not yet ported (Tasks, Inbox).
struct ComingSoonView: View {
    let title: String
    let systemImage: String
    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 12) {
                    Image(systemName: systemImage).font(.system(size: 44)).foregroundStyle(NX.violet.opacity(0.6))
                    Text("\(title) lagi dibangun").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                    Text("Layar ini bakal di-porting dari web.").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                }
            }
            .navigationTitle(title)
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
                        MoreSection("Home Base") {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile("Messages", "bubble.left.and.bubble.right.fill", NX.blue) { MessagesView() }
                                MoreTile("Pengajuan Saya", "tray.full.fill", NX.warning) { SubmissionsView() }
                                MoreTile("Team Calendar", "calendar", NX.violet) { TeamCalendarView() }
                                MoreTile("Room Booking", "door.left.hand.open", NX.coral) { RoomBookingView() }
                            }
                        }
                        MoreSection("Missions") {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile("Leaderboard", "trophy.fill", NX.warning) { LeaderboardView() }
                                MoreTile("Reports", "chart.bar.fill", NX.success) { ReportsView() }
                            }
                        }
                        MoreSection("Knowledge") {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile("Knowledge Library", "book.fill", NX.violet) { DocsView() }
                                MoreTile("Forms", "doc.text.fill", NX.blue) { FormsView() }
                            }
                        }
                        MoreSection("Pulse Check") {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile("Absensi", "clock.badge.checkmark.fill", NX.success) { AttendanceView() }
                            }
                        }
                        MoreSection("System") {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile("Teams", "person.3.fill", NX.coral) { TeamsView() }
                                MoreTile("Tuning Room", "gearshape.fill", NX.mutedFg) { SettingsView() }
                                MoreTile("Control Room", "shield.fill", NX.danger) { AdminView() }
                            }
                        }

                        AccountFooter()
                    }
                    .padding(16)
                }
            }
            .navigationTitle("More")
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
            Text(title.uppercased()).font(NXFont.text(11, .bold)).tracking(0.6)
                .foregroundStyle(NX.mutedFg).padding(.leading, 4)
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
            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            .nexusShadowSoft()
        }
        .buttonStyle(.plain)
    }
}

/// Account card (avatar + name + email) and logout.
struct AccountFooter: View {
    @Environment(AuthStore.self) private var auth
    var body: some View {
        VStack(spacing: 12) {
            if let s = auth.session {
                let name = s.userName.isEmpty ? s.userEmail : s.userName
                HStack(spacing: 12) {
                    Text(String(name.first ?? "?").uppercased())
                        .font(NXFont.text(16, .bold)).foregroundStyle(NX.violet)
                        .frame(width: 46, height: 46).background(NX.violet.opacity(0.12), in: Circle())
                        .overlay(Circle().strokeBorder(NX.border))
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
                Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(NX.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 4)
    }
}
