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
            open(url)
        }
        try? await Task.sleep(for: .milliseconds(800))
        state.status = "ready:\(screen)"
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
