import SwiftUI

@main
struct NEXUSWatchApp: App {
    @State private var auth = WatchAuth.shared
    /// The page on screen. A calendar complication (`nexus://calendar`) turns to the Calendar.
    @State private var page = 0
    @Environment(\.scenePhase) private var scenePhase

    init() {
        WatchConnectivityBridge.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.session != nil {
                    TabView(selection: $page) {
                        TodayView().tag(0)
                        CalendarView().tag(1)
                        CrewView().tag(2)
                        ApprovalsView().tag(3)
                    }
                    .tabViewStyle(.verticalPage)
                    .environment(auth)
                } else {
                    SignedOutView(everHeardFromPhone: auth.everHeardFromPhone)
                }
            }
            // Every time the app comes to the front, the calendar complications get a fresh snapshot
            // (throttled inside, so raising the wrist twice in a minute fetches once).
            .onOpenURL { url in
                if url.host == "calendar" { page = 1 }
            }
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    Task { await WatchCalendarGlance.refresh() }
                }
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
            Text(everHeardFromPhone ? wt("Signed out", "Belum masuk") : wt("Open NEXUS on your iPhone", "Buka NEXUS di iPhone"))
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(everHeardFromPhone
                 ? wt("Sign in on your iPhone and this will follow.", "Masuk di iPhone, jam ini ikut.")
                 : wt("Sign in there once, and the watch picks it up.", "Masuk sekali di sana, jam ini ikut tersambung."))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}
