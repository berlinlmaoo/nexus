import SwiftUI

/// Switches between login and the authenticated app based on session state.
struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        if auth.isAuthenticated {
            TabView {
                ProjectsView()
                    .tabItem { Label("Projects", systemImage: "folder.fill") }
                AttendanceView()
                    .tabItem { Label("Absensi", systemImage: "clock.badge.checkmark.fill") }
            }
        } else {
            LoginView()
        }
    }
}
