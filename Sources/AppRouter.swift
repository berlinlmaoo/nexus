import SwiftUI

/// The five destinations the phone's tab bar can show.
enum PhoneTab: Hashable {
    case dashboard, tasks, inbox, projects, more
}

/// Where the app should go, when the instruction comes from outside it.
///
/// Siri, a Shortcut, a tap on the Live Activity and a tap on a widget all mean the same thing and
/// must land in the same place. Routing them through one vocabulary is what stops the fourth entry
/// point from inventing its own idea of where "attendance" lives.
@MainActor
@Observable
final class AppRouter {
    /// A single instance, because App Intents run outside SwiftUI and have no environment to read.
    static let shared = AppRouter()

    var tab: PhoneTab = .dashboard

    /// Phone: drives the push inside the More tab, where attendance actually lives.
    var attendancePushed = false

    /// iPad and Mac: consumed once by the sidebar, then cleared. A request rather than a piece of
    /// state, so returning to a screen by hand is never undone by a stale flag.
    var sidebarRequest: NXScreen?

    enum Destination: String {
        case attendance
    }

    func go(_ destination: Destination) {
        switch destination {
        case .attendance:
            // Both shapes are answered. Only the one on screen reacts, and the other's flag costs
            // nothing — far cheaper than asking this type which layout is currently mounted.
            tab = .more
            attendancePushed = true
            sidebarRequest = .attendance
        }
    }

    /// `nexus://attendance`
    func open(_ url: URL) {
        guard url.scheme == "nexus" else { return }
        let name = url.host ?? url.pathComponents.first { $0 != "/" } ?? ""
        guard let destination = Destination(rawValue: name) else { return }
        go(destination)
    }
}
