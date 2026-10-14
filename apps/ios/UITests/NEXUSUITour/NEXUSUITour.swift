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
///   TOUR_LEGAL_DOC_ID / TOUR_LEGAL_FORM_PATH   optional: the Legal document / request form to show
///
/// Legal screens (14 Oct 2026): `{legalDoc}` / `{legalForm}` in a route are looked up once per run with
/// the QA account over the API (LegalLookup, GET only): the newest [TEST] document and the general request
/// link. One that cannot be found turns its screens into "skipped: <reason>" instead of failing the run.
/// `appTab` names the Legal tab tapped after landing, `appOpen: legalDoc` taps that document's row: the
/// app has no route to either. Screens with an `account` (legal-hidden, the account without Legal) are
/// the web tour's (tour.mjs) and skipped here.
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
        /// Shot as another account by the web tour only ("nonmember": legal-hidden).
        let account: String?
        /// The tab to tap once the screen is up (Legal: Templates, Requests, Companies & numbering).
        let appTab: String?
        /// "legalDoc": tap the row of the looked-up Legal document.
        let appOpen: String?
    }

    private struct Outcome: Encodable {
        let id: String
        let status: String
        var pages = 1
        let settled: Bool
        let seconds: Double
        /// Mac: false when the NEXUS window could not be brought to the front before a shot, so the
        /// picture may show another app's window (run 5: a Claude / editor window in the Mac shots).
        var frontmost: Bool? = nil
    }

    private let env = ProcessInfo.processInfo.environment

    /// An optional input, nil when unset OR empty. ui-tour.sh always passes TEST_RUNNER_TOUR_PROJECT_ID
    /// (empty unless overridden), and `env[...] ?? default` took the empty string: every project route
    /// became `/projects/?v=…` and all project-* screens of run 3 showed the Projects list.
    private func setting(_ name: String) -> String? {
        guard let value = env[name]?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
        return value
    }
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
            persist(Data(login.utf8), "tour-login-error.txt")
            pause(1.0)
            snap("login-error")
            outcomes.append(Outcome(id: "login-error", status: login, settled: false, seconds: 0))
            attach(outcomes)
            XCTFail("Sign-in failed: \(login)")
            return
        }

        // 3. Every screen, each on a fresh launch.
        for screen in config.screens {
            guard screen.account == nil, let route = screen.app, wanted(screen.id) else { continue }
            var resolved = route
                .replacingOccurrences(of: "{project}", with: setting("TOUR_PROJECT_ID") ?? config.projectId)
                .replacingOccurrences(of: "{form}", with: setting("TOUR_FORM_ID") ?? config.formId)
                .replacingOccurrences(of: "{webBase}", with: webBase)
            let needsDoc = screen.appOpen == "legalDoc" || resolved.contains("{legalDoc}")
            if needsDoc || resolved.contains("{legalForm}") {
                let legal = LegalLookup.values(base: webBase, email: email, password: password,
                                               docOverride: setting("TOUR_LEGAL_DOC_ID"), formOverride: setting("TOUR_LEGAL_FORM_PATH"))
                let missing = needsDoc && legal.docId == nil ? legal.docProblem
                    : resolved.contains("{legalForm}") && legal.formPath == nil ? legal.formProblem : nil
                if let missing {
                    outcomes.append(Outcome(id: screen.id, status: "skipped: \(missing)", pages: 0, settled: false, seconds: 0))
                    continue
                }
                resolved = resolved
                    .replacingOccurrences(of: "{legalDoc}", with: legal.docId ?? "")
                    .replacingOccurrences(of: "{legalForm}", with: legal.formPath ?? "")
            }
            guard resolved.hasPrefix("nexus://") || resolved.hasPrefix("https://") else { continue }
            XCTContext.runActivity(named: "Screen \(screen.id)") { _ in
                let started = Date()
                launch(step: "screen", screen: screen.id, route: resolved)
                var status = waitForMarker(timeout: 60) {
                    $0.hasPrefix("ready:") || $0.hasPrefix("no-session") || $0.hasPrefix("wrong-screen")
                }
                // Legal's tabs and documents have no route of their own: the test taps there, as a person would.
                if status == "ready:\(screen.id)", let problem = tapThrough(screen, email: email, password: password) {
                    status = problem
                }
                // A route that did not land (TourDriver checks the project / tab / form actually on screen)
                // is a failure of that screen, not a picture of whatever happened to be there.
                if status.hasPrefix("wrong-screen") || status.hasPrefix("timeout") {
                    XCTFail("\(screen.id): \(status)")
                }
                if status.hasPrefix("skipped") {
                    outcomes.append(Outcome(id: screen.id, status: status, pages: 0, settled: false,
                                            seconds: Date().timeIntervalSince(started)))
                    return
                }
                dismissSystemAlerts()
                let settled = waitForSpinnersToStop(timeout: 25)
                pause(1.5)
                dismissSystemAlerts()
                windowBehind = false
                let first = snap(screen.id)
                let more = snapMorePages(screen.id, prefix: "tour-", first: first, in: app, web: false)
                let ok = status == "ready:\(screen.id)"
                var line = ok ? (settled ? "ok" : "ok, spinner still visible after 25 s") : status
                if windowBehind { line += "; NEXUS window was not frontmost for a shot (another window may show)" }
                var outcome = Outcome(id: screen.id, status: line, pages: 1 + more,
                                      settled: settled, seconds: Date().timeIntervalSince(started))
                #if targetEnvironment(macCatalyst)
                outcome.frontmost = !windowBehind
                #endif
                outcomes.append(outcome)
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
        let base = (setting("TOUR_WEB_BASE") ?? "https://nexus-prod.tail765d02.ts.net:8443")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCUIApplication().terminate()   // the app tour's last launch; Safari gets the whole screen
        var outcomes: [Outcome] = []

        // 1. The login page, signed out. A session left by an earlier run sends /login straight on to
        //    the dashboard, so that one is ended first through NextAuth's own sign-out page.
        // `?lang=` stores the tour language in this browser (web lib/lang.ts), like the desktop run's
        // localStorage: without it Safari showed the web's default Indonesian beside English desktop shots.
        let login = base + "/login?lang=" + (setting("TOUR_LANG") ?? "en")
        open(login)
        var form = webElement { $0.secureTextFields }.waitForExistence(timeout: 25)
        if !form {
            open(base + "/api/auth/signout")
            let signOut = safari.webViews.buttons["Sign out"]
            if signOut.waitForExistence(timeout: 15) { signOut.tap(); pause(2.5) }
            open(login)
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
            persist(Data((note.name ?? "").utf8) + Data(" — see screenshot".utf8), "safari-login-error.txt")
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
            guard screen.account == nil, let route = screen.web, screen.id != "login", wanted(screen.id) else { continue }
            var path = route
                .replacingOccurrences(of: "{project}", with: setting("TOUR_PROJECT_ID") ?? config.projectId)
                .replacingOccurrences(of: "{form}", with: setting("TOUR_FORM_ID") ?? config.formId)
            if path.contains("{legalDoc}") || path.contains("{legalForm}") {
                let legal = LegalLookup.values(base: base, email: email, password: password,
                                               docOverride: setting("TOUR_LEGAL_DOC_ID"), formOverride: setting("TOUR_LEGAL_FORM_PATH"))
                let missing = path.contains("{legalDoc}") && legal.docId == nil ? legal.docProblem
                    : path.contains("{legalForm}") && legal.formPath == nil ? legal.formProblem : nil
                if let missing {
                    outcomes.append(Outcome(id: screen.id, status: "skipped: \(missing)", pages: 0, settled: false, seconds: 0))
                    continue
                }
                path = path
                    .replacingOccurrences(of: "{legalDoc}", with: legal.docId ?? "")
                    .replacingOccurrences(of: "{legalForm}", with: legal.formPath ?? "")
            }
            XCTContext.runActivity(named: "Safari \(screen.id)") { _ in
                let started = Date()
                open(base + path)
                dismissSafariPrompts()
                var settled = waitForWebToSettle(timeout: 25)
                if dismissInstallPrompt() { settled = waitForWebToSettle(timeout: 10) }
                dismissSafariPrompts()
                scrollWebToTop()
                pause(0.8)
                // Checked before the extra pages: the login form's own button, not "a password field" —
                // Settings has one (Change password) and was reported as a lost session (run 3).
                let bounced = isLoginPage() && path.hasPrefix("/login") == false
                let first = snapScreen("safari-\(screen.id)")
                let more = snapMorePages(screen.id, prefix: "safari-", first: first, in: safari, web: true)
                outcomes.append(Outcome(id: screen.id,
                                        status: bounced ? "bounced to the login page (session lost)"
                                            : (settled ? "ok" : "ok, page still changing after 25 s"),
                                        pages: 1 + more,
                                        settled: settled, seconds: Date().timeIntervalSince(started)))
            }
        }
        attach(outcomes, name: "safari-results")
    }

    /// The web's sign-in form: a password field AND its "Sign in" / "Masuk" button.
    @MainActor
    private func isLoginPage() -> Bool {
        guard webElement({ $0.secureTextFields }).exists else { return false }
        let signIn = NSPredicate(format: "label BEGINSWITH[c] 'Sign in' OR label BEGINSWITH[c] 'Masuk'")
        return safari.webViews.firstMatch.buttons.matching(signIn).firstMatch.exists
    }

    /// Safari sometimes opens an address already scrolled down (the dashboard, calendar, threads and
    /// settings shots of run 3 started mid-page). A tap on the status bar is iOS's own "back to top".
    @MainActor
    private func scrollWebToTop() {
        let page = safari.webViews.firstMatch
        guard page.exists else { return }
        for _ in 0..<2 {
            let before = XCUIScreen.main.screenshot().pngRepresentation
            safari.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0)).withOffset(CGVector(dx: 0, dy: 20)).tap()
            pause(1.0)
            if XCUIScreen.main.screenshot().pngRepresentation == before { return }
        }
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

    /// The dev web's origin: the Safari tour's base, and the host of `https://…/f/<id>` app routes
    /// (the app opens only links of its own server's host, Config.isNexusHost).
    private var webBase: String {
        (setting("TOUR_WEB_BASE") ?? "https://nexus-prod.tail765d02.ts.net:8443")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// The taps a screen's `appTab` / `appOpen` ask for, after the route landed. nil when done, else the
    /// status for that screen ("wrong-screen: …", or "skipped: …" when the thing to open is not there).
    @MainActor
    private func tapThrough(_ screen: Screen, email: String, password: String) -> String? {
        if let tab = screen.appTab {
            // The English label, or the Indonesian one when the tour runs in Indonesian.
            let names = [tab, Self.indonesian[tab]].compactMap { $0 }
            let match = NSPredicate(format: "label IN %@ OR label ENDSWITH %@ OR label ENDSWITH %@",
                                    names, ", " + names[0], ", " + (names.last ?? names[0]))
            let bar = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label IN %@", ["Legal sections", "Bagian Legal"])).firstMatch
            var button = bar.buttons.matching(match).firstMatch
            if !(bar.waitForExistence(timeout: 15) && button.waitForExistence(timeout: 5)) {
                button = app.buttons.matching(match).firstMatch   // tabs drawn without their container label
            }
            guard button.waitForExistence(timeout: 5) else { return "wrong-screen: \(screen.id) (no \"\(tab)\" tab found)" }
            // NXTabs marks the chosen tab .isSelected; the picture changing counts too.
            guard tapUntil(button, landed: { button.isSelected }) else {
                return "wrong-screen: \(screen.id) (tapped the \"\(tab)\" tab, it did not open)"
            }
            pause(1.2)
        }
        if screen.appOpen == "legalDoc" {
            let legal = LegalLookup.values(base: webBase, email: email, password: password,
                                           docOverride: setting("TOUR_LEGAL_DOC_ID"), formOverride: setting("TOUR_LEGAL_FORM_PATH"))
            // The row is a button whose label holds the document's title; [TEST] when only the id was given.
            let title = legal.docTitle ?? "[TEST]"
            let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
            if !row.waitForExistence(timeout: 20) {
                // Not on the first page of the archive: search for it, as a person would (typing saves nothing).
                let search = app.textFields.firstMatch
                if search.waitForExistence(timeout: 5) {
                    search.tap()
                    search.typeText(title)
                    pause(1.5)
                }
            }
            guard row.waitForExistence(timeout: 15) else {
                return "skipped: Legal document \"\(title)\" not in the app's archive"
            }
            // The document is pushed over the archive: its row leaves the hierarchy.
            guard tapUntil(row, landed: { !row.exists }) else {
                return "wrong-screen: \(screen.id) (tapped \"\(title)\", the document did not open)"
            }
            pause(2.0)
        }
        return nil
    }

    /// Taps `element` and waits until `landed()` (or the app's picture changed). Run 10, 14 Oct 2026: on
    /// the Mac every Legal tab and document tap was "ok" yet did nothing, and all five Legal screens were
    /// the same picture. The NEXUS window is brought to the front only for a shot (takeShot), so the click
    /// went to a window that was not key, and macOS spends a click on a background window on making it
    /// key. So: front first, a normal tap, and if nothing happened a click at the element's centre.
    @MainActor
    private func tapUntil(_ element: XCUIElement, landed: () -> Bool) -> Bool {
        for attempt in 0..<3 {
            #if targetEnvironment(macCatalyst)
            _ = bringToFront(app)
            #endif
            let before = app.windows.firstMatch.screenshot().pngRepresentation
            if attempt == 0 {
                element.tap()
            } else {
                guard element.exists else { return landed() }
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            let deadline = Date().addingTimeInterval(4)
            while Date() < deadline {
                pause(0.5)
                if landed() { return true }
            }
            // No trait to read (or a slow load): a different picture is a tap that registered.
            if app.windows.firstMatch.screenshot().pngRepresentation != before { return true }
        }
        return landed()
    }

    /// The Indonesian labels of the tabs named in ui-tour-screens.json (LocalizationLegal.swift).
    private static let indonesian = [
        "Templates": "Template",
        "Requests": "Pengajuan",
        "Companies & numbering": "Perusahaan & penomoran",
        "Documents": "Dokumen",
        "Members": "Member",
    ]

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
            "-nexusServer", setting("TOUR_SERVER") ?? "dev",
            "-nexusTourStep", step,
            // UserDefaults' argument domain: read by the app for this launch, never saved.
            "-nexus.language", setting("TOUR_LANG") ?? "en",
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

    /// Set when a Mac shot was taken although the NEXUS window would not come to the front.
    private var windowBehind = false

    @MainActor
    private func takeShot(_ root: XCUIApplication) -> XCUIScreenshot {
        #if targetEnvironment(macCatalyst)
        // The app's window only, not the whole desktop around it. An element screenshot is still a
        // picture of that part of the SCREEN: with another window (Claude, an editor, Xcode) on top,
        // that window was in the shot (run 5). So the app is brought to the front first, every time.
        if !bringToFront(root) { windowBehind = true }
        return root.windows.firstMatch.screenshot()
        #else
        return XCUIScreen.main.screenshot()
        #endif
    }

    #if targetEnvironment(macCatalyst)
    /// Activates the app and waits until it is the foreground app AND its window is hit-testable at its
    /// centre (a window of another app over it fails that test). Up to four tries; false if it never was.
    @MainActor
    private func bringToFront(_ root: XCUIApplication) -> Bool {
        for _ in 0..<4 {
            root.activate()
            _ = root.wait(for: .runningForeground, timeout: 5)
            let window = root.windows.firstMatch
            if root.state == .runningForeground, window.exists, window.isHittable {
                pause(0.4)   // the window server finishes the reorder before the pixels are read
                return true
            }
            pause(0.8)
        }
        return false
    }
    #endif

    private func attachShot(_ shot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        persist(shot.pngRepresentation, name + ".png")
    }

    /// Also writes the file straight into TOUR_OUT_DIR on the Mac (ui-tour.sh): Xcode 27 can hang
    /// closing the result bundle after the tests finish, and a killed run must not lose the pictures.
    private func persist(_ data: Data, _ fileName: String) {
        guard let dir = env["TOUR_OUT_DIR"], !dir.isEmpty else { return }
        let folder = URL(fileURLWithPath: dir, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appendingPathComponent(fileName), options: .atomic)
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
        // A drag that lands on a row can still be read as a tap and push a screen (run 5: the
        // leaderboard opened a profile). Pushed screen = stop paging and go back.
        let backs = { () -> Int in web ? 0 : root.navigationBars.buttons.matching(identifier: "BackButton").count }
        let backsBefore = backs()
        let navigatedAway = { () -> Bool in
            guard !web, backs() > backsBefore else { return false }
            let back = root.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
            if back.exists && back.isHittable { back.tap(); self.pause(1.0) }
            return true
        }
        if id.hasSuffix("board") || id.hasSuffix("table") || id.hasSuffix("timeline") {
            drag(target, dx: -0.5, dy: 0)
            let shot = takeShot(root)
            if navigatedAway() { return page - 1 }
            if shot.pngRepresentation != last {
                page += 1
                attachShot(shot, "\(prefix)\(id)-\(page)")
                drag(target, dx: 0.5, dy: 0)   // back, so the pages below start from the left edge
                last = takeShot(root).pngRepresentation
            }
        }
        #if targetEnvironment(macCatalyst)
        var flipped = false
        #endif
        while page < maxPages {
            drag(target, dx: 0, dy: -0.5)
            if navigatedAway() { break }
            if !web { _ = waitForSpinnersToStop(timeout: 4) }
            let shot = takeShot(root)
            let data = shot.pngRepresentation
            #if targetEnvironment(macCatalyst)
            // First scroll changed nothing: maybe the wheel goes the other way on this Mac. Once.
            if data == last && page == 1 && !flipped {
                flipped = true
                macWheelSign = -macWheelSign
                continue
            }
            #endif
            if data == last { break }
            last = data
            page += 1
            attachShot(shot, "\(prefix)\(id)-\(page)")
        }
        return page - 1
    }

    /// Where the drags go: an element, and the part of it that is actually on screen.
    private struct ScrollTarget {
        let element: XCUIElement
        let visible: CGRect
    }

    /// The page in Safari; in the app the scroll view, collection view or table with the most area
    /// ON SCREEN. Measured by the whole frame, the Timeline's inner horizontal scroll view (as tall as
    /// all its rows) beat the vertical one around it; the drags went to its off-screen middle and
    /// pages 1–3 of the iPhone timeline were the same picture (run 5).
    @MainActor
    private func scrollTarget(in root: XCUIApplication, web: Bool) -> ScrollTarget? {
        let window = root.windows.firstMatch.frame
        if web {
            let page = root.webViews.firstMatch
            guard page.exists else { return nil }
            return ScrollTarget(element: page, visible: page.frame.intersection(window))
        }
        var best: ScrollTarget?
        var bestArea: CGFloat = 0
        for query in [root.collectionViews, root.tables, root.scrollViews] {
            for i in 0..<min(query.count, 8) {
                let element = query.element(boundBy: i)
                guard element.exists else { continue }
                let visible = element.frame.intersection(window)
                guard !visible.isNull, visible.width > 40, visible.height > 80 else { continue }
                // A frame much taller or wider than what shows of it is content, not a viewport: it is
                // scrolled by something around it.
                let isViewport = element.frame.height <= visible.height * 1.05 && element.frame.width <= visible.width * 1.05
                let area = visible.width * visible.height * (isViewport ? 1 : 0.5)
                if area > bestArea { best = ScrollTarget(element: element, visible: visible); bestArea = area }
            }
        }
        return best
    }

    /// Mac: which way a positive scroll-wheel delta moves the content. Unknown until one scroll did
    /// nothing; snapMorePages flips it once (run 3, 13 Oct 2026).
    private var macWheelSign: CGFloat = -1

    /// dy < 0 scrolls the content up (finger moves up), dx < 0 scrolls it left. Distances are fractions
    /// of the VISIBLE part of the target, and every point is inside it.
    @MainActor
    private func drag(_ target: ScrollTarget, dx: CGFloat, dy: CGFloat) {
        let frame = target.element.frame
        let rect = target.visible
        // Absolute screen points, expressed from the element's own origin (XCUICoordinate's way).
        let origin = target.element.coordinate(withNormalizedOffset: .zero)
        func at(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
            origin.withOffset(CGVector(dx: x - frame.minX, dy: y - frame.minY))
        }
        #if targetEnvironment(macCatalyst)
        // A scroll-wheel event at a point, not swipeUp(): a swipe needs the element's hit point, and a
        // scroll view half covered by its neighbour (Messages: list beside the chat) has none — the
        // failed swipe ended the whole Mac run after 7 screens (run 3, 13 Oct 2026).
        at(rect.midX, rect.midY).scroll(byDeltaX: macWheelSign * dx * rect.width,
                                        deltaY: macWheelSign * dy * rect.height)
        #else
        // Vertical drags run down the left gutter (6 pt in), beside the cards and rows rather than on
        // them: a drag starting on a row could open it (run 5, leaderboard → a profile).
        let x0: CGFloat = dx == 0 ? rect.minX + 6 : rect.midX - dx * rect.width / 2
        let x1: CGFloat = dx == 0 ? rect.minX + 6 : rect.midX + dx * rect.width / 2
        let start = at(x0, rect.midY - dy * rect.height / 2)
        let end = at(x1, rect.midY + dy * rect.height / 2)
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
        persist(data, name + ".json")
    }

    private func pause(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}

/// The run-time values of the Legal screens, looked up once per test process with the QA account:
/// POST /api/auth/app-login (the app's own sign-in), GET /api/legal/documents?q=[TEST] and GET
/// /api/legal/request-links, then POST /api/auth/app-logout, which ends that one session only. Nothing
/// else is written. The password stays in memory; nothing here is logged.
enum LegalLookup {
    struct Values {
        var docId: String?
        var docTitle: String?
        var docProblem = "no [TEST] Legal document on dev"
        var formPath: String?
        var formProblem = "no general Legal request link"
    }

    nonisolated(unsafe) private static var cached: Values?

    static func values(base: String, email: String, password: String,
                       docOverride: String?, formOverride: String?) -> Values {
        if let cached { return cached }
        var v = Values()
        v.docId = docOverride
        v.formPath = formOverride
        defer { cached = v }
        if docOverride != nil && formOverride != nil { return v }

        guard let login = call(base + "/api/auth/app-login", method: "POST",
                               body: ["email": email, "password": password], cookie: nil),
              login.status == 200,
              let token = login.json["token"] as? String, let name = login.json["cookieName"] as? String else {
            v.docProblem = "Legal lookup: QA sign-in over the API failed"
            v.formProblem = v.docProblem
            return v
        }
        let cookie = "\(name)=\(token)"
        defer { _ = call(base + "/api/auth/app-logout", method: "POST", body: nil, cookie: cookie) }

        if docOverride == nil {
            let q = "[TEST]".addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            if let r = call(base + "/api/legal/documents?q=\(q)&limit=20", method: "GET", body: nil, cookie: cookie), r.status == 200 {
                let docs = (r.json["documents"] as? [[String: Any]]) ?? []
                if let doc = docs.first(where: { (($0["title"] as? String) ?? "").contains("[TEST]") }) {
                    v.docId = doc["id"] as? String
                    v.docTitle = doc["title"] as? String
                }
            } else {
                v.docProblem = "Legal documents not readable by the QA account"
            }
        }
        if formOverride == nil {
            if let r = call(base + "/api/legal/request-links", method: "GET", body: nil, cookie: cookie), r.status == 200 {
                let links = (r.json["links"] as? [[String: Any]]) ?? []
                v.formPath = links.first(where: { ($0["scope"] as? String) == "general" })?["path"] as? String
            } else {
                v.formProblem = "Legal request links not readable by the QA account"
            }
        }
        return v
    }

    /// One blocking request (the tour test is sequential by nature); nil on a transport error.
    private static func call(_ address: String, method: String, body: [String: String]?,
                             cookie: String?) -> (status: Int, json: [String: Any])? {
        guard let url = URL(string: address) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        if let cookie { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: (Int, [String: Any])?
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        let session = URLSession(configuration: config)
        session.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse {
                let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
                result = (http.statusCode, json)
            }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 35)
        session.finishTasksAndInvalidate()
        return result.map { (status: $0.0, json: $0.1) }
    }
}
