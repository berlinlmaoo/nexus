import SwiftUI

/// The five destinations the phone's tab bar can show.
enum PhoneTab: Hashable {
    case dashboard, tasks, inbox, projects, more
}

/// A destination that means nothing without an argument.
///
/// NXScreen is eighteen names with a String raw value, and it has to stay exactly that. The sidebar
/// tags its rows with it, `NXScreen(rawValue:)` is how `nexus://<name>` is resolved, and a Swift
/// enum carrying associated values cannot be RawRepresentable at all — so "the form with this id"
/// has no case to be. A form is the first destination in this app with a payload, so it gets a
/// small vocabulary of its own ALONGSIDE that enum rather than an eviscerating change inside it.
struct NXFormRequest: Identifiable, Hashable {
    /// A form id OR its slug. `/api/forms/{id}/public` resolves either, which is the whole reason
    /// the link people actually share can read `/f/pengajuan-finance-management` instead of a cuid.
    let id: String
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

    /// Whether Home is showing its own root, or has something pushed on top of it.
    ///
    /// `tab` and `sidebarScreen` only answer half the question. Home is a tab AND a NavigationStack,
    /// and Messages, Attendance, Leaderboard, Room Booking, Threads and Team Calendar are all
    /// pushed INTO that stack by the quick-action tiles — so the tab never changes, and a launcher
    /// that reads only the tab rides along on top of a chat composer's own buttons.
    ///
    /// Written by DashboardView's root content rather than read off a `path` binding, because every
    /// push out of Home is a view-based `NavigationLink { … }`: those carry no value for a path to
    /// hold, so a bound path would report an empty stack on every one of them. Appearing and
    /// disappearing is the one signal that covers all of them, `.navigationDestination(item:)`
    /// included, and it costs one write per push rather than anything per frame.
    var homeIsRoot = true

    /// iPad and Mac: consumed once by the sidebar, then cleared. A request rather than a piece of
    /// state, so returning to a screen by hand is never undone by a stale flag.
    var sidebarRequest: NXScreen?

    /// A form somebody asked for from outside the app — a tapped `/f/…` link, almost always.
    ///
    /// Held here instead of pushed onto a tab, because it is not a screen this app navigates TO. It
    /// arrives with an argument, it is finished the moment it is submitted, and it has to behave
    /// identically whether the phone's tab bar or the iPad's sidebar happens to be mounted —
    /// `morePush` can do none of the three. RootView presents it above both shapes and clears this
    /// when the sheet closes.
    ///
    /// It is deliberately NOT cleared when the request cannot be served yet. A link tapped by
    /// somebody who is signed out opens the app on the login screen; the request waits there and
    /// the form appears by itself once they are in, rather than being thrown away by the very
    /// login it caused.
    var formRequest: NXFormRequest?

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

    /// Everything that arrives from outside the app comes through here.
    ///
    /// Two vocabularies, and they are not interchangeable. `nexus://attendance` is the app's own
    /// scheme, spoken by the widgets, the Live Activity and Shortcuts, and it names a SCREEN.
    /// `https://nexus.znetworks.id/f/…` is a Universal Link — a real web address that somebody was
    /// sent and tapped — and it names a form. The https half is why this no longer returns the
    /// moment the scheme is not `nexus`; that one guard was what dropped every tapped form link.
    func open(_ url: URL) {
        // Coalesced rather than switched as an Optional, and lowercased because a scheme is
        // case-insensitive by spec while a Swift string literal is not.
        switch (url.scheme ?? "").lowercased() {
        case "nexus": openScheme(url)
        case "https": openWeb(url)
        default:      break
        }
    }

    /// `nexus://attendance`, and every other screen by its own name — the host is matched against
    /// NXScreen's raw values, so a screen added there is reachable by URL without touching this.
    private func openScheme(_ url: URL) {
        let name = url.host ?? url.pathComponents.first { $0 != "/" } ?? ""
        guard let screen = NXScreen(rawValue: name) else { return }
        go(screen)
    }

    /// `https://nexus.znetworks.id/f/<id-or-slug>` — the address the Forms screen copies to the
    /// clipboard, and the only web path this app claims.
    ///
    /// Narrow on purpose, in both directions. `Config.isNexusHost` rather than a suffix match, for
    /// exactly the reason it was written: a host that merely ENDS with the right letters belongs to
    /// whoever registered it. And one path shape rather than a general web router, because the
    /// entitlement claims `/f/*` and nothing else — a handler that understood more than the app
    /// actually claims could only ever be dead code, while one that understood less would open the
    /// app onto whatever it was already showing.
    ///
    /// `pathComponents` arrives percent-DECODED, which is what the API client wants: it encodes the
    /// id once when it builds the request, so a slug with a space in it survives the round trip and
    /// nothing is ever double-encoded.
    private func openWeb(_ url: URL) {
        guard Config.isNexusHost(url) else { return }
        let parts = url.pathComponents.filter { $0 != "/" }
        // Exactly two: `/f/<id>` is a single segment on the web too (the SPA route is `/f/$formId`).
        // A deeper path under /f/ is not a form and must not be answered with somebody else's.
        guard parts.count == 2, parts[0] == "f", !parts[1].isEmpty else { return }
        formRequest = NXFormRequest(id: parts[1])
    }
}
