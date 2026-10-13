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
///   TOUR_WEB_BASE               optional: the web the Safari tour opens (default: the DEV server)
///
/// testWebSafariTour is the web's MOBILE reference: the same screens in real Safari on the same
/// simulator (owner, 13 Oct 2026: not Chrome emulation). It runs after testTour (alphabetical order),
/// signs in on the web separately and never touches the app's session. iPhone/iPad simulators only.
final class NEXUSUITour: XCTestCase {
    private struct Config: Decodable {
        let projectId: String
        let formId: String
        let screens: [Screen]
    }

    private struct Screen: Decodable {
        let id: String
        let app: String?
        let web: String?
    }

    private struct Outcome: Encodable {
        let id: String
        let status: String
        var pages = 1
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
                let status = waitForMarker(timeout: 60) {
                    $0.hasPrefix("ready:") || $0.hasPrefix("no-session") || $0.hasPrefix("wrong-screen")
                }
                // A route that did not land (TourDriver checks the project / tab / form actually on screen)
                // is a failure of that screen, not a picture of whatever happened to be there.
                if status.hasPrefix("wrong-screen") || status.hasPrefix("timeout") {
                    XCTFail("\(screen.id): \(status)")
                }
                dismissSystemAlerts()
                let settled = waitForSpinnersToStop(timeout: 25)
                pause(1.5)
                dismissSystemAlerts()
                let first = snap(screen.id)
                let more = snapMorePages(screen.id, prefix: "tour-", first: first, in: app, web: false)
                let ok = status == "ready:\(screen.id)"
                outcomes.append(Outcome(id: screen.id,
                                        status: ok ? (settled ? "ok" : "ok, spinner still visible after 25 s") : status,
                                        pages: 1 + more,
                                        settled: settled, seconds: Date().timeIntervalSince(started)))
            }
        }

        // 4. Sign the tour account out again, so nothing of it is left in the app.
        launch(step: "signout")
        _ = waitForMarker(timeout: 30) { $0.hasPrefix("signed-out") }
        app.terminate()
        attach(outcomes)
    }

    // MARK: - Web in real Safari

    #if !targetEnvironment(macCatalyst)
    private var safari: XCUIApplication!

    @MainActor
    func testWebSafariTour() throws {
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
        let base = (env["TOUR_WEB_BASE"] ?? "https://nexus-prod.tail765d02.ts.net:8443")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCUIApplication().terminate()   // the app tour's last launch; Safari gets the whole screen
        var outcomes: [Outcome] = []

        // 1. The login page, signed out. A session left by an earlier run sends /login straight on to
        //    the dashboard, so that one is ended first through NextAuth's own sign-out page.
        open(base + "/login")
        var form = webElement { $0.secureTextFields }.waitForExistence(timeout: 25)
        if !form {
            open(base + "/api/auth/signout")
            let signOut = safari.webViews.buttons["Sign out"]
            if signOut.waitForExistence(timeout: 15) { signOut.tap(); pause(2.5) }
            open(base + "/login")
            form = webElement { $0.secureTextFields }.waitForExistence(timeout: 25)
        }
        if wanted("login") {
            let started = Date()
            let settled = waitForWebToSettle(timeout: 15)
            snapScreen("safari-login")
            outcomes.append(Outcome(id: "login", status: form ? "ok" : "login form not found",
                                    settled: settled, seconds: Date().timeIntervalSince(started)))
        }

        // 2. Sign in once, typing into the web's own form.
        var signedIn = false
        if form {
            let emailField = webElement { $0.textFields }
            if emailField.waitForExistence(timeout: 5) {
                emailField.tap()
                emailField.typeText(email)
            }
            let passwordField = webElement { $0.secureTextFields }
            passwordField.tap()
            passwordField.typeText(password + "\n")
            let deadline = Date().addingTimeInterval(45)
            while Date() < deadline {
                dismissSafariPrompts()
                if !passwordField.exists { signedIn = true; break }
                pause(0.7)
            }
        }
        guard signedIn else {
            let error = webElement { $0.staticTexts }   // whatever the page says; the screenshot shows the rest
            let note = XCTAttachment(string: "safari login failed at \(base) — form found: \(form); first text: \(error.exists ? error.label : "none")")
            note.name = "safari-login-error"
            note.lifetime = .keepAlways
            add(note)
            snapScreen("safari-login-error")
            outcomes.append(Outcome(id: "login-error", status: "safari sign-in failed", settled: false, seconds: 0))
            attach(outcomes, name: "safari-results")
            XCTFail("Safari sign-in failed")
            return
        }
        pause(1.5)
        dismissSafariPrompts()

        // 3. Every screen with a web route, at the same address the desktop run uses.
        for screen in config.screens {
            guard let route = screen.web, screen.id != "login", wanted(screen.id) else { continue }
            let path = route
                .replacingOccurrences(of: "{project}", with: env["TOUR_PROJECT_ID"] ?? config.projectId)
                .replacingOccurrences(of: "{form}", with: env["TOUR_FORM_ID"] ?? config.formId)
            XCTContext.runActivity(named: "Safari \(screen.id)") { _ in
                let started = Date()
                open(base + path)
                dismissSafariPrompts()
                var settled = waitForWebToSettle(timeout: 25)
                if dismissInstallPrompt() { settled = waitForWebToSettle(timeout: 10) }
                dismissSafariPrompts()
                pause(0.8)
                let first = snapScreen("safari-\(screen.id)")
                let more = snapMorePages(screen.id, prefix: "safari-", first: first, in: safari, web: true)
                let bounced = webElement { $0.secureTextFields }.exists && path.hasPrefix("/login") == false
                outcomes.append(Outcome(id: screen.id,
                                        status: bounced ? "bounced to the login page (session lost)"
                                            : (settled ? "ok" : "ok, page still changing after 25 s"),
                                        pages: 1 + more,
                                        settled: settled, seconds: Date().timeIntervalSince(started)))
            }
        }
        attach(outcomes, name: "safari-results")
    }

    /// The first element of a kind inside the page (never Safari's own address bar).
    @MainActor
    private func webElement(_ kind: (XCUIElement) -> XCUIElementQuery) -> XCUIElement {
        kind(safari.webViews.firstMatch).firstMatch
    }

    /// Opens an address the way a tapped link would: Safari comes to the front on it.
    @MainActor
    private func open(_ address: String) {
        guard let url = URL(string: address) else { return }
        XCUIDevice.shared.system.open(url)
        _ = safari.wait(for: .runningForeground, timeout: 10)
        pause(1.2)   // let the previous page go, or it is the one that "settles"
    }

    /// True once the page has stopped changing: the same amount of text for 1.5 s and no busy indicator.
    @MainActor
    private func waitForWebToSettle(timeout: TimeInterval) -> Bool {
        let web = safari.webViews.firstMatch
        guard web.waitForExistence(timeout: 15) else { return false }
        let deadline = Date().addingTimeInterval(timeout)
        var last = -1
        var stableSince: Date?
        while Date() < deadline {
            let busy = web.activityIndicators.count > 0 || web.progressIndicators.count > 0
            let count = web.staticTexts.count
            if busy || count != last || count < 3 {
                last = count
                stableSince = nil
            } else if let since = stableSince {
                if Date().timeIntervalSince(since) >= 1.5 { return true }
            } else {
                stableSince = Date()
            }
            pause(0.4)
        }
        return false
    }

    /// Safari's own interruptions: save the password, the first-run sheets, location for the page.
    @MainActor
    private func dismissSafariPrompts() {
        let inAlerts = ["Not Now", "Never for This Website", "Allow", "Allow While Using App", "Continue", "OK", "Close"]
        for container in [safari.alerts.firstMatch, safari.sheets.firstMatch,
                          XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch] where container.exists {
            if let label = inAlerts.first(where: { container.buttons[$0].exists }) {
                container.buttons[label].tap()
                pause(0.6)
            }
        }
        for label in ["Not Now", "Never for This Website"] {
            let button = safari.buttons[label]
            if button.exists && button.isHittable { button.tap(); pause(0.6) }
        }
    }

    /// The web's "install NEXUS on your phone" card: answered "don't remind me", as a person would.
    @MainActor
    private func dismissInstallPrompt() -> Bool {
        let match = NSPredicate(format: "label CONTAINS[c] 'remind me' OR label CONTAINS[c] 'Jangan ingatkan'")
        let target = safari.webViews.firstMatch.descendants(matching: .any).matching(match).firstMatch
        guard target.exists, target.isHittable else { return false }
        target.tap()
        pause(0.8)
        return true
    }

    @MainActor
    @discardableResult
    private func snapScreen(_ name: String) -> XCUIScreenshot {
        let shot = XCUIScreen.main.screenshot()
        attachShot(shot, name)
        return shot
    }
    #endif

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
    @discardableResult
    private func snap(_ id: String) -> XCUIScreenshot {
        let shot = takeShot(app)
        attachShot(shot, "tour-\(id)")
        return shot
    }

    @MainActor
    private func takeShot(_ root: XCUIApplication) -> XCUIScreenshot {
        #if targetEnvironment(macCatalyst)
        // The app's window only, not the whole desktop around it.
        return root.windows.firstMatch.screenshot()
        #else
        return XCUIScreen.main.screenshot()
        #endif
    }

    private func attachShot(_ shot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The rest of the screen below the first viewport (owner, 13 Oct 2026: one viewport hid most of it).
    /// Drags the main scroll area up by half its height — slowly, no fling, so pages overlap and nothing
    /// is skipped — and saves `<prefix><id>-2`, `-3`, … until the picture stops changing or
    /// TOUR_MAX_PAGES (default 6) is reached. Board / table / timeline also get one shot swiped left,
    /// for columns clipped on the right. Returns the number of extra shots.
    @MainActor
    private func snapMorePages(_ id: String, prefix: String, first: XCUIScreenshot,
                               in root: XCUIApplication, web: Bool) -> Int {
        let maxPages = Int(env["TOUR_MAX_PAGES"] ?? "") ?? 6
        guard maxPages > 1, let target = scrollTarget(in: root, web: web) else { return 0 }
        var page = 1
        var last = first.pngRepresentation
        if id.hasSuffix("board") || id.hasSuffix("table") || id.hasSuffix("timeline") {
            drag(target, dx: -0.5, dy: 0)
            let shot = takeShot(root)
            if shot.pngRepresentation != last {
                page += 1
                attachShot(shot, "\(prefix)\(id)-\(page)")
                drag(target, dx: 0.5, dy: 0)   // back, so the pages below start from the left edge
                last = takeShot(root).pngRepresentation
            }
        }
        while page < maxPages {
            drag(target, dx: 0, dy: -0.5)
            if !web { _ = waitForSpinnersToStop(timeout: 4) }
            let shot = takeShot(root)
            let data = shot.pngRepresentation
            if data == last { break }
            last = data
            page += 1
            attachShot(shot, "\(prefix)\(id)-\(page)")
        }
        return page - 1
    }

    /// The page in Safari; in the app the largest scroll view, collection view or table on screen.
    @MainActor
    private func scrollTarget(in root: XCUIApplication, web: Bool) -> XCUIElement? {
        if web {
            let page = root.webViews.firstMatch
            return page.exists ? page : nil
        }
        var best: XCUIElement?
        var bestArea: CGFloat = 0
        for query in [root.collectionViews, root.tables, root.scrollViews] {
            for i in 0..<min(query.count, 6) {
                let element = query.element(boundBy: i)
                guard element.exists else { continue }
                let area = element.frame.width * element.frame.height
                if area > bestArea { best = element; bestArea = area }
            }
        }
        return best
    }

    /// dy < 0 scrolls the content up (finger moves up), dx < 0 scrolls it left.
    @MainActor
    private func drag(_ element: XCUIElement, dx: CGFloat, dy: CGFloat) {
        #if targetEnvironment(macCatalyst)
        if dy < 0 { element.swipeUp() } else if dy > 0 { element.swipeDown() }
        else if dx < 0 { element.swipeLeft() } else if dx > 0 { element.swipeRight() }
        #else
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5 - dx / 2, dy: 0.5 - dy / 2))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5 + dx / 2, dy: 0.5 + dy / 2))
        start.press(forDuration: 0.05, thenDragTo: end,
                    withVelocity: XCUIGestureVelocity(rawValue: 700), thenHoldForDuration: 0.3)
        #endif
        pause(0.9)
    }

    private func attach(_ outcomes: [Outcome], name: String = "tour-results") {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(outcomes) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func pause(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}
