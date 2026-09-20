import SwiftUI
import UIKit

@main
struct NexusApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var auth = AuthStore()
    /// The shared instance, not a fresh one: App Intents run outside SwiftUI and can only reach the
    /// router through its static handle, so both sides have to be looking at the same object.
    @State private var router = AppRouter.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FontLoader.registerAll()
        Self.configureAppearance()
        // Activating publishes whatever is already in the Keychain, so a watch paired after signing
        // in catches up without waiting for the next login.
        PhoneSessionBridge.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                // BEFORE .environment(auth), and the order is load-bearing: a ViewModifier's body
                // runs in its PARENT's environment, not in the environment of the content it wraps.
                // Put after, WhatsNewGate looks for AuthStore where nothing has put one — and a
                // non-optional @Environment does not return nil there, it traps. The app opened on
                // a black screen.
                .whatsNew()
                .environment(auth)
                .environment(router)
                .tint(NX.violetText)
                // Siri, Shortcuts, the Live Activity and the widgets all arrive here as a URL
                // — and so does a tapped Universal Link on iOS. AppRouter.open decides which of the
                // two vocabularies (`nexus://` or `https://`) a URL is speaking.
                .onOpenURL { router.open($0) }
                // The Mac half of the same job, and BOTH are required.
                //
                // On iOS a browsing activity reaches a SwiftUI app through `.onOpenURL` and this
                // modifier is never called. On Mac Catalyst it is the exact reverse: a universal
                // link arrives as an NSUserActivity and `.onOpenURL` does not fire, which is why
                // NEXUS-Catalyst.entitlements refused to claim `applinks:` at all until now — a
                // claimed domain with no handler takes the link away from Safari and then does
                // nothing with it, which is worse than not claiming it.
                //
                // Each platform calls exactly one of these two, so there is no double-open to
                // guard against; the router is idempotent for the same URL either way.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { router.open(url) }
                }
                .task(id: auth.session?.userId) {
                    if let userId = auth.session?.userId {
                        await NotificationManager.shared.activate(userId: userId)
                        // The banner promises "sends itself when NEXUS is back". Until 0.1.5 the
                        // only thing that drained the queue was opening the Attendance screen.
                        await AttendanceQueue.shared.flush()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active, let userId = auth.session?.userId else { return }
                    Task { await NotificationManager.shared.reconcileReminders(userId: userId) }
                    Task { await AttendanceQueue.shared.flush() }
                }
        }
    }

    /// Global navigation/tab chrome — match the web: rounded display title, NEXUS background.
    private static func configureAppearance() {
        let bg = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x11141b) : UIColor(rgb: 0xf8f9fb) }

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = bg
        nav.shadowColor = .clear
        nav.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 32, weight: .heavy)]
        nav.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 17, weight: .bold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = bg
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}
