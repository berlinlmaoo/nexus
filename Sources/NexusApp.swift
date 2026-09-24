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
    /// Forced-update state. Shared, because APIClient raises it from a 426 outside SwiftUI.
    @State private var versionGate = AppVersionGate.shared

    init() {
        FontLoader.registerAll()
        Self.configureAppearance()
        // Activating publishes whatever is already in the Keychain, so a watch paired after signing
        // in catches up without waiting for the next login.
        PhoneSessionBridge.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            // The update gate goes ABOVE everything by replacing it. While `required` is set RootView
            // is not in the hierarchy at all, so no login, sign-up, splash, sheet or alert can draw
            // over the cover — removing the view that presented them dismisses them. See
            // UpdateRequiredView for why an overlay could not do this.
            ZStack {
                if let requirement = versionGate.required {
                    UpdateRequiredView(requirement: requirement)
                        .tint(NX.violetText)
                        .transition(.opacity)
                } else {
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
                                // Launch and sign-in: an open check-in from earlier today resumes
                                // the trail without the Attendance screen having to be opened.
                                await WorkLocationTracker.shared.reconcileFromServer()
                            }
                        }
                        .onChange(of: scenePhase) { _, phase in
                            // Before the signed-in guard: a signed-out phone needs to learn it is too old
                            // just as much. Throttled inside to once per 30 minutes; the launch check
                            // below is the forced one.
                            if phase == .active { Task { await versionGate.checkPolicy() } }
                            // On the way out, which is the only moment iOS will accept the request: an app
                            // in the foreground is not a candidate for either window.
                            if phase == .background { BackgroundRefresh.schedule() }
                            guard phase == .active, let userId = auth.session?.userId else { return }
                            Task { await NotificationManager.shared.reconcileReminders(userId: userId) }
                            Task { await AttendanceQueue.shared.flush() }
                            // Today's record decides whether the work-hours trail runs. Nothing
                            // else fetches it on a plain return to the app, and a check-in made on
                            // the web (or a check-out) must start or stop the tracker all the same.
                            Task { await WorkLocationTracker.shared.reconcileFromServer() }
                        }
                        // The "why NEXUS wants Always location" sheet, on a host of its own so it
                        // never shares a view with another `.sheet`.
                        .background { WorkLocationPromptHost() }
                }
            }
            .animation(.easeInOut(duration: 0.25), value: versionGate.required)
            // The once-a-day "update by <date>" alert. On the root, beside the lock rather than
            // inside RootView, because it is about the app, not about any one screen.
            .graceWarningNotice()
            // Once per launch, forced: the floor may have moved while the app was closed, and
            // finding out here beats finding out from the first refused request.
            .task { await versionGate.checkPolicy(force: true) }
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
