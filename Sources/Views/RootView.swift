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
        } else {
            LoginView()
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

/// "More" — houses Absensi + account actions until the full menu is ported.
struct MoreView: View {
    @Environment(AuthStore.self) private var auth
    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                List {
                    Section {
                        NavigationLink {
                            AttendanceView()
                        } label: {
                            Label("Absensi", systemImage: "clock.badge.checkmark.fill")
                        }
                    }
                    Section {
                        if let s = auth.session {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.userName.isEmpty ? s.userEmail : s.userName).font(NXFont.text(15, .semibold))
                                Text(s.userEmail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            }
                        }
                        Button(role: .destructive) { auth.logout() } label: {
                            Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("More")
        }
    }
}
