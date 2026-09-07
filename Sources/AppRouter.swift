import SwiftUI

/// The five destinations the phone's tab bar can show.
enum PhoneTab: Hashable {
    case dashboard, tasks, inbox, projects, more
}

/// Where the app should go, when the instruction comes from outside the screen you are standing on.
///
/// Siri, a Shortcut, a tap on the Live Activity, a tap on a widget and a tap on a notification all
/// mean the same thing and must land in the same place. Routing them through one vocabulary is what
/// stops the fifth entry point from inventing its own idea of where "attendance" lives.
@MainActor
@Observable
final class AppRouter {
    /// A single instance, because App Intents run outside SwiftUI and have no environment to read.
    static let shared = AppRouter()

    var tab: PhoneTab = .dashboard

    /// Phone: the launcher screen to push inside the More tab, where everything that is not one of
    /// the four tab roots actually lives. Bound rather than fired-and-forgotten, so swiping back
    /// clears it and a second request works exactly like the first.
    var morePush: NXScreen?

    /// iPad and Mac: the screen the sidebar currently HAS selected, written by SidebarRoot.
    /// The phone answers the same question with `tab`. Both exist so something drawn above the
    /// whole app — the GIDEON launcher — can tell which screen it is sitting on top of, which no
    /// view in either layout is in a position to say.
    var sidebarScreen: NXScreen = .dashboard

    /// iPad and Mac: consumed once by the sidebar, then cleared. A request rather than a piece of
    /// state, so returning to a screen by hand is never undone by a stale flag.
    var sidebarRequest: NXScreen?

    /// The phone tab that IS this screen, or nil when the screen lives behind the More launcher.
    private func tabRoot(for screen: NXScreen) -> PhoneTab? {
        switch screen {
        case .dashboard: return .dashboard
        case .tasks:     return .tasks
        case .inbox:     return .inbox
        case .projects:  return .projects
        default:         return nil
        }
    }

    func go(_ screen: NXScreen) {
        // Both shapes are answered. Only the one on screen reacts, and the other's flag costs
        // nothing — far cheaper than asking this type which layout is currently mounted.
        if let root = tabRoot(for: screen) {
            tab = root
            // Otherwise a launcher screen pushed a moment ago stays on the More stack, and the tab
            // the person just asked for is the one thing they cannot see.
            morePush = nil
        } else {
            tab = .more
            morePush = screen
        }
        sidebarRequest = screen
    }

    /// `nexus://attendance`, and every other screen by its own name — the host is matched against
    /// NXScreen's raw values, so a screen added there is reachable by URL without touching this.
    func open(_ url: URL) {
        guard url.scheme == "nexus" else { return }
        let name = url.host ?? url.pathComponents.first { $0 != "/" } ?? ""
        guard let screen = NXScreen(rawValue: name) else { return }
        go(screen)
    }
}
