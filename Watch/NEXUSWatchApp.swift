import SwiftUI

@main
struct NEXUSWatchApp: App {
    @State private var auth = WatchAuth.shared

    init() {
        WatchConnectivityBridge.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            if auth.session != nil {
                TabView {
                    TodayView()
                    CrewView()
                    ApprovalsView()
                }
                .tabViewStyle(.verticalPage)
                .environment(auth)
            } else {
                SignedOutView(everHeardFromPhone: auth.everHeardFromPhone)
            }
        }
    }
}

/// There is no sign-in here by design, so this screen says what to do rather than offering a form
/// that cannot work.
struct SignedOutView: View {
    let everHeardFromPhone: Bool

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(everHeardFromPhone ? "Signed out" : "Open NEXUS on your iPhone")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(everHeardFromPhone
                 ? "Sign in on your iPhone and this will follow."
                 : "Sign in there once, and the watch picks it up.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}
