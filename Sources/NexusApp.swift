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
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(router)
                .tint(NX.violetText)
                // Siri, Shortcuts, the Live Activity and the widgets all arrive here as a URL.
                .onOpenURL { router.open($0) }
                .task(id: auth.session?.userId) {
                    if let userId = auth.session?.userId {
                        await NotificationManager.shared.activate(userId: userId)
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active, let userId = auth.session?.userId else { return }
                    Task { await NotificationManager.shared.reconcileReminders(userId: userId) }
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
