import XCTest

/// The UI screenshot tour (docs/UI-TOUR.md). Run by scripts/ui-tour.sh on iPhone, iPad and
/// "My Mac (Mac Catalyst)"; it is a camera, not a test of behaviour, and is in no CI.
///
/// For every screen in scripts/ui-tour-screens.json it relaunches the app straight onto that screen
/// (TourDriver.swift: launch arguments, no tapping), waits until the app says it got there and the
/// spinners are gone, and attaches a screenshot named `tour-<screen id>`. The script pulls those out of
/// the .xcresult. One screen that misbehaves is photographed anyway and noted in `tour-results`; it
/// never stops the screens after it.
///
/// Inputs, from the test runner's environment (the script sets them as TEST_RUNNER_<name>):
///   TOUR_EMAIL, TOUR_PASSWORD   the QA account on the DEV server (never committed anywhere)
///   TOUR_SCREENS_JSON           the contents of scripts/ui-tour-screens.json (or TOUR_SCREENS_FILE, a path)
///   TOUR_ONLY                   optional: "calendar,settings" photographs just those
///   TOUR_PROJECT_ID / TOUR_FORM_ID   optional: replace the project / form in the list
///   TOUR_SERVER                 optional: "dev" (default) or "production"
///   TOUR_LANG                   optional: "en" (default) or "id"
final class NEXUSUITour: XCTestCase {
    private struct Config: Decodable {
        let projectId: String
        let formId: String
        let screens: [Screen]
    }

    private struct Screen: Decodable {
        let id: String
        let app: String?
    }

    private struct Outcome: Encodable {
        let id: String
        let status: String
        let settled: Bool
        let seconds: Double
    }

    private let env = ProcessInfo.processInfo.environment
    /// Made in testTour: XCUIApplication belongs to the main actor (as in Xcode's own UI test template).
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    @MainActor
    func testTour() throws {
        app = XCUIApplication()
        let config = try loadConfig()
        let only = Set((env["TOUR_ONLY"] ?? "").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty })
        let wanted = { (id: String) in only.isEmpty || only.contains(id) }
        let email = env["TOUR_EMAIL"] ?? ""
        let password = env["TOUR_PASSWORD"] ?? ""
        guard !email.isEmpty, !password.isEmpty else {
            XCTFail("TOUR_EMAIL / TOUR_PASSWORD are not set. Run scripts/ui-tour.sh instead of the test directly.")
            return
        }
        var outcomes: [Outcome] = []

        // 1. Signed out (the tour's own session only — Keychain.swift), so the login screen shows.
        launch(step: "signout")
        let out = waitForMarker(timeout: 45) { $0.hasPrefix("signed-out") }
        if wanted("login") {
            let started = Date()
            let shown = app.buttons["login.signIn"].waitForExistence(timeout: 20)
            pause(1.0)
            snap("login")
            outcomes.append(Outcome(id: "login", status: shown ? "ok" : "login screen not found (\(out))",
                                    settled: shown, seconds: Date().timeIntervalSince(started)))
        }

        // 2. Sign in to the DEV server with the QA account. On failure the reason — including the
        //    URLError domain/code behind "Can't reach NEXUS" — goes into `tour-login-error`.
        launch(step: "login", extraEnvironment: ["NEXUS_TOUR_EMAIL": email, "NEXUS_TOUR_PASSWORD": password])
        let login = waitForMarker(timeout: 90) { $0.hasPrefix("login-ok") || $0.hasPrefix("login-failed") }
        guard login.hasPrefix("login-ok") else {
            let note = XCTAttachment(string: login)
            note.name = "tour-login-error"
            note.lifetime = .keepAlways
            add(note)
            pause(1.0)
            snap("login-error")
            outcomes.append(Outcome(id: "login-error", status: login, settled: false, seconds: 0))
            attach(outcomes)
            XCTFail("Sign-in failed: \(login)")
            return
        }

        // 3. Every screen, each on a fresh launch.
        for screen in config.screens {
            guard let route = screen.app, route.hasPrefix("nexus://"), wanted(screen.id) else { continue }
            let resolved = route
                .replacingOccurrences(of: "{project}", with: env["TOUR_PROJECT_ID"] ?? config.projectId)
                .replacingOccurrences(of: "{form}", with: env["TOUR_FORM_ID"] ?? config.formId)
            XCTContext.runActivity(named: "Screen \(screen.id)") { _ in
                let started = Date()
                launch(step: "screen", screen: screen.id, route: resolved)
                let status = waitForMarker(timeout: 60) { $0.hasPrefix("ready:") || $0.hasPrefix("no-session") }
                dismissSystemAlerts()
                let settled = waitForSpinnersToStop(timeout: 25)
                pause(1.5)
                dismissSystemAlerts()
                snap(screen.id)
                let ok = status == "ready:\(screen.id)"
                outcomes.append(Outcome(id: screen.id,
                                        status: ok ? (settled ? "ok" : "ok, spinner still visible after 25 s") : status,
                                        settled: settled, seconds: Date().timeIntervalSince(started)))
            }
        }

        // 4. Sign the tour account out again, so nothing of it is left in the app.
        launch(step: "signout")
        _ = waitForMarker(timeout: 30) { $0.hasPrefix("signed-out") }
        app.terminate()
        attach(outcomes)
    }

    // MARK: - Pieces

    private func loadConfig() throws -> Config {
        var data: Data?
        if let json = env["TOUR_SCREENS_JSON"], !json.isEmpty { data = json.data(using: .utf8) }
        if data == nil, let path = env["TOUR_SCREENS_FILE"] { data = FileManager.default.contents(atPath: path) }
        guard let data else {
            XCTFail("TOUR_SCREENS_JSON is not set. Run scripts/ui-tour.sh instead of the test directly.")
            throw XCTSkip("no screen list")
        }
        return try JSONDecoder().decode(Config.self, from: data)
    }

    @MainActor
    private func launch(step: String, screen: String? = nil, route: String? = nil,
                        extraEnvironment: [String: String] = [:]) {
        if app.state != .notRunning { app.terminate() }
        var args = [
            "-nexusTour", "1",
            "-nexusServer", env["TOUR_SERVER"] ?? "dev",
            "-nexusTourStep", step,
            // UserDefaults' argument domain: read by the app for this launch, never saved.
            "-nexus.language", env["TOUR_LANG"] ?? "en",
            "-nexus.theme", "light",
        ]
        if let screen { args += ["-nexusTourScreen", screen] }
        if let route { args += ["-nexusTourRoute", route] }
        if let window = env["TOUR_MAC_WINDOW"], !window.isEmpty { args += ["-nexusTourWindow", window] }
        app.launchArguments = args
        app.launchEnvironment = extraEnvironment
        app.launch()
    }

    /// Polls the invisible `nexus.tour.marker` (TourDriver.swift) until its label passes `accept`.
    /// Returns that label, or "timeout (…)" with the last label seen.
    @MainActor
    private func waitForMarker(timeout: TimeInterval, until accept: (String) -> Bool) -> String {
        let marker = app.descendants(matching: .any)["nexus.tour.marker"]
        let deadline = Date().addingTimeInterval(timeout)
        var last = ""
        while Date() < deadline {
            if marker.exists {
                last = marker.label
                if accept(last) { return last }
            }
            pause(0.5)
        }
        return last.isEmpty ? "timeout (the app never showed its tour marker)" : "timeout (last: \(last))"
    }

    /// True once no activity indicator has been on screen for a full second.
    @MainActor
    private func waitForSpinnersToStop(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        var quietSince: Date?
        while Date() < deadline {
            if app.activityIndicators.count > 0 {
                quietSince = nil
            } else if let since = quietSince {
                if Date().timeIntervalSince(since) >= 1.0 { return true }
            } else {
                quietSince = Date()
            }
            pause(0.3)
        }
        return false
    }

    /// Location, camera, photos, notifications: the first time a screen asks, iOS puts an alert over
    /// it. Allowed, so the screen is photographed the way somebody who said yes sees it.
    @MainActor
    private func dismissSystemAlerts() {
        #if !targetEnvironment(macCatalyst)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<3 {
            let alert = springboard.alerts.firstMatch
            guard alert.waitForExistence(timeout: 0.5) else { return }
            let preferred = ["Allow While Using App", "Allow", "OK", "Allow Once", "Continue"]
            if let label = preferred.first(where: { alert.buttons[$0].exists }) {
                alert.buttons[label].tap()
            } else if alert.buttons.count > 0 {
                alert.buttons.element(boundBy: alert.buttons.count - 1).tap()
            } else {
                return
            }
            pause(0.5)
        }
        #endif
    }

    @MainActor
    private func snap(_ id: String) {
        #if targetEnvironment(macCatalyst)
        // The app's window only, not the whole desktop around it.
        let shot = app.windows.firstMatch.screenshot()
        #else
        let shot = XCUIScreen.main.screenshot()
        #endif
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "tour-\(id)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attach(_ outcomes: [Outcome]) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(outcomes) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "tour-results"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func pause(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}
