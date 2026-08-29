import SwiftUI
import UIKit

@main
struct NexusApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FontLoader.registerAll()
        Self.configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(NX.violetText)
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
