import SwiftUI
import UIKit

@main
struct NexusApp: App {
    @State private var auth = AuthStore()

    init() { Self.configureAppearance() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(NX.violet)
        }
    }

    /// Global navigation/tab chrome — match the web: rounded display title, NEXUS background.
    private static func configureAppearance() {
        let bg = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x11141b) : UIColor(rgb: 0xf8f9fb) }

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = bg
        nav.shadowColor = .clear
        if let large = roundedFont(34, .heavy) { nav.largeTitleTextAttributes = [.font: large] }
        if let inline = roundedFont(17, .bold) { nav.titleTextAttributes = [.font: inline] }
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = bg
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    private static func roundedFont(_ size: CGFloat, _ weight: UIFont.Weight) -> UIFont? {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard let descriptor = base.fontDescriptor.withDesign(.rounded) else { return base }
        return UIFont(descriptor: descriptor, size: size)
    }
}
