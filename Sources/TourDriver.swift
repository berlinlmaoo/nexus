import SwiftUI
import UIKit

// The app's half of the UI screenshot tour (docs/UI-TOUR.md, scripts/ui-tour.sh).
//
// UITests/NEXUSUITour relaunches the app once per screen with launch arguments (TourMode, Config.swift):
//
//   -nexusTour 1                        the tour is driving; nothing below happens without it
//   -nexusServer dev                    this launch talks to the DEV server (not saved)
//   -nexusTourStep signout|login|screen what this launch is for
//   -nexusTourScreen <id>               the screen id from scripts/ui-tour-screens.json
//   -nexusTourRoute <nexus://…>         where to go once signed in
//
// and reads back how it went from one invisible element, `nexus.tour.marker`, whose label is the
// status below. Nothing is tapped to get anywhere: a tap that lands a frame early is the classic
// flaky UI test, and the routes are the same ones a widget or a notification uses.
//
// The credentials arrive in the launch ENVIRONMENT (NEXUS_TOUR_EMAIL / NEXUS_TOUR_PASSWORD), set by the
// test from what scripts/ui-tour.sh read out of the Mac's Keychain. Never in git, never in arguments.

/// The last request that never got an answer, in words a person can act on: the URLError domain and
/// code, the failing URL, and the error under it (TLS, DNS, ATS…). "Can't reach NEXUS" alone says
/// none of that. Kept in memory only; the tour copies it into its report when sign-in fails.
enum NetDiagnostics {
    private static let lock = NSLock()
    private static var lastText: String?

    static var last: String? {
        lock.lock(); defer { lock.unlock() }
        return lastText
    }

    static func record(_ error: Error) {
        let text = describe(error)
        lock.lock()
        lastText = text
        lock.unlock()
        #if DEBUG || NEXUS_DEV_SERVER
        NSLog("[NEXUS net] %@", text)
        #endif
    }

    static func describe(_ error: Error) -> String {
        let ns = error as NSError
        var parts = ["\(ns.domain) \(ns.code)"]
        if let url = error as? URLError {
            parts.append("URLError(\(url.code.rawValue))")
            if let failing = url.failingURL { parts.append("url=\(failing.absoluteString)") }
        }
        parts.append(ns.localizedDescription)
        if let domain = ns.userInfo["_kCFStreamErrorDomainKey"], let code = ns.userInfo["_kCFStreamErrorCodeKey"] {
            parts.append("stream=\(domain)/\(code)")
        }
        var under = ns.userInfo[NSUnderlyingErrorKey] as? NSError
        var depth = 0
        while let e = under, depth < 3 {
            parts.append("underlying \(e.domain) \(e.code): \(e.localizedDescription)")
            under = e.userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }
        return parts.joined(separator: " | ")
    }
}

/// What the tour test reads back. Observable so the marker's label follows it.
@MainActor
@Observable
final class TourState {
    static let shared = TourState()
    var status = "starting"
}

/// Attached once, on the app's root (NexusApp). Draws nothing and does nothing unless TourMode is on.
@MainActor
struct TourDriver: ViewModifier {
    let auth: AuthStore
    let router: AppRouter
    @State private var state = TourState.shared

    @ViewBuilder
    func body(content: Content) -> some View {
        if TourMode.isActive {
            content
                .overlay(alignment: .topLeading) { marker }
                .task { await run() }
        } else {
            content
        }
    }

    /// 2 × 2 points at 2 % opacity: invisible in a screenshot, present for XCUITest (a view at
    /// opacity 0 drops out of the accessibility tree, which is why it is not 0).
    private var marker: some View {
        Text(state.status)
            .font(.system(size: 2))
            .foregroundStyle(Color.primary.opacity(0.02))
            .frame(width: 2, height: 2)
            .clipped()
            .allowsHitTesting(false)
            .accessibilityLabel(state.status)
            .accessibilityIdentifier("nexus.tour.marker")
    }

    private func run() async {
        #if targetEnvironment(macCatalyst)
        fixMacWindow()
        #endif
        switch TourMode.argument("nexusTourStep") ?? "screen" {
        case "signout":
            // The tour's own Keychain account (Keychain.swift): the person's real session is untouched.
            if auth.session != nil { auth.logout() }
            state.status = "signed-out"
        case "login":
            await login()
        default:
            await showScreen()
        }
    }

    private func login() async {
        if auth.session != nil {
            state.status = "login-ok (already signed in)"
            return
        }
        let env = ProcessInfo.processInfo.environment
        let email = env["NEXUS_TOUR_EMAIL"] ?? ""
        let password = env["NEXUS_TOUR_PASSWORD"] ?? ""
        guard !email.isEmpty, !password.isEmpty else {
            state.status = "login-failed: NEXUS_TOUR_EMAIL / NEXUS_TOUR_PASSWORD not set"
            return
        }
        state.status = "logging-in"
        // The real sign-in path (AuthStore → APIClient.login), only without the typing.
        await auth.login(email: email, password: password)
        if auth.session != nil {
            state.status = "login-ok"
        } else {
            state.status = "login-failed: \(auth.loginError ?? "no message")"
                + " || server: \(Config.baseURL.absoluteString)"
                + " || network: \(NetDiagnostics.last ?? "no transport error recorded (the server answered)")"
        }
    }

    private func showScreen() async {
        let screen = TourMode.argument("nexusTourScreen") ?? "?"
        guard auth.session != nil else {
            state.status = "no-session:\(screen)"
            return
        }
        // Let the signed-in shape (tab bar or sidebar) mount before asking it to move.
        try? await Task.sleep(for: .milliseconds(1200))
        if let route = TourMode.argument("nexusTourRoute"), let url = URL(string: route) {
            // A project route without its id (an empty TOUR_PROJECT_ID, run 3) opens the Projects list;
            // that is a wrong screen, not a picture of the project.
            if url.host?.lowercased() == "projects", url.query != nil, ProjectTarget(url) == nil {
                state.status = "wrong-screen:\(screen) (no project id in \(route))"
                return
            }
            open(url)
            if let expected = ProjectTarget(url) {
                if let problem = await waitUntilLanded(expected) {
                    state.status = "wrong-screen:\(screen) \(problem)"
                    return
                }
            }
        }
        try? await Task.sleep(for: .milliseconds(800))
        state.status = "ready:\(screen)"
    }

    /// Where a project route must end up: the project, on its tab, or its form builder.
    private struct ProjectTarget {
        let id: String
        let view: String?
        let form: String?
        let query: [URLQueryItem]

        init?(_ url: URL) {
            guard url.scheme?.lowercased() == "nexus", url.host?.lowercased() == "projects",
                  let id = url.pathComponents.first(where: { $0 != "/" }), !id.isEmpty else { return nil }
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            self.id = id
            self.query = items
            self.view = items.first { $0.name == "view" }?.value?.lowercased()
            self.form = items.first { $0.name == "form" }?.value
        }
    }

    private func landed(_ target: ProjectTarget) -> Bool {
        if let form = target.form { return router.formOnScreen == form }
        guard router.projectOnScreen == target.id else { return false }
        guard let view = target.view else { return true }
        let tab = router.projectTabOnScreen ?? ""
        return tab == view || (view == "sheet" && tab == "spreadsheet")
    }

    /// Up to ~12 s. Every 4 s without the project on screen the request is made again: the first one can
    /// arrive before the Projects tab is listening. nil when it landed, else what is on screen instead.
    private func waitUntilLanded(_ target: ProjectTarget) async -> String? {
        for _ in 0..<3 {
            for _ in 0..<16 {
                if landed(target) { return nil }
                try? await Task.sleep(for: .milliseconds(250))
            }
            if router.projectOnScreen != target.id && router.formOnScreen == nil {
                if router.projectLink == nil { router.projectLink = NXProjectLink(projectId: target.id, query: target.query) }
                router.projectRequest = nil
                try? await Task.sleep(for: .milliseconds(150))
                router.openProjectPage(ProjectRef(id: target.id, name: ""))
            }
        }
        if landed(target) { return nil }
        return "(expected project \(target.id), tab \(target.view ?? "any"), form \(target.form ?? "none");"
            + " on screen: project \(router.projectOnScreen ?? "none"), tab \(router.projectTabOnScreen ?? "none"),"
            + " form \(router.formOnScreen ?? "none"))"
    }

    /// `nexus://projects/<id>?view=board&form=<id>` opens the project as a page, the way a tap on it
    /// does; every other route goes through the router like a widget's link.
    private func open(_ url: URL) {
        let isProject = url.scheme?.lowercased() == "nexus" && url.host?.lowercased() == "projects"
        if isProject, let id = url.pathComponents.first(where: { $0 != "/" }), !id.isEmpty {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            router.projectLink = NXProjectLink(projectId: id, query: query)
            router.openProjectPage(ProjectRef(id: id, name: ""))
        } else {
            router.open(url)
        }
    }

    #if targetEnvironment(macCatalyst)
    /// One window size for every Mac screenshot (the web's desktop is shot at 1440 × 900);
    /// `-nexusTourWindow 1280x800` overrides it. macOS shrinks it to fit a smaller screen.
    private func fixMacWindow() {
        let parts = (TourMode.argument("nexusTourWindow") ?? "1440x900").split(separator: "x").compactMap { Double($0) }
        guard parts.count == 2 else { return }
        let size = CGSize(width: parts[0], height: parts[1])
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.sizeRestrictions?.minimumSize = size
            scene.sizeRestrictions?.maximumSize = size
        }
    }
    #endif
}
