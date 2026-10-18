import XCTest
import UIKit

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
///   TOUR_WEB_BASE               required for the Safari tour: the dev web it opens (ui-tour.sh passes it)
///   TOUR_LEGAL_DOC_ID / TOUR_LEGAL_FORM_PATH   optional: the Legal document / request form to show
///   TOUR_OUTLET_PROJECT_ID / TOUR_SOCMED_PROJECT_ID   optional: the Outlet Sales / Social Media Report project
///
/// Legal screens (14 Oct 2026): `{legalDoc}` / `{legalForm}` in a route are looked up once per run with
/// the QA account over the API (LegalLookup, GET only): the newest [TEST] document and the general request
/// link. One that cannot be found turns its screens into "skipped: <reason>" instead of failing the run.
/// `appTab` names the Legal tab tapped after landing, `appOpen: legalDoc` taps that document's row: the
/// app has no route to either. Screens with an `account` (legal-hidden, the account without Legal) are
/// the web tour's (tour.mjs) and skipped here.
///
/// Dashboards (14 Oct 2026): `{outlet}` / `{socmed}` are the QA Outlet Sales / Social Media Report projects and
/// `{outletDay}` / `{socmedDay}` a date of theirs with data, looked up the same way (DashboardLookup, GET only).
/// `appTaps` / `webTaps` name buttons pressed in order after landing (a settings sheet, the New project
/// gallery): "A|B" = the English or Indonesian label, a leading "?" = only when the next one is not on screen.
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
        /// Buttons the app tour presses in order once the screen is up ("A|B", "?A": see the header).
        let appTaps: [String]?
        /// Targeted interaction checks after opening the page; used by fix-round QA configs.
        let appActions: [AppAction]?
        struct AppAction: Decodable {
            let kind: String
            let label: String
            let text: String?
        }
        /// The same for the web in Safari.
        let webTaps: [String]?
        /// One captures a still frame; larger values extend this screen's cap over TOUR_MAX_PAGES (run 17, R17-I-06 / T-2: the
        /// leaderboard's ranks 8-43 and the Mac Legal settings' last company never got a page).
        let pages: Int?
        /// How many sideways shots (half a view each) a board or table gets; 1 by default (run 17, T-2: the
        /// iPad Table never reached its Priority / Status columns).
        let sideways: Int?
        /// "trailing": after the page itself, the scroll pane right of it is paged too (run 20, T-4: the Mac
        /// Calendar's day panel scrolls on its own and was never shot below its first screen).
        let pane: String?
    }

    private struct Outcome: Encodable {
        let id: String
        let status: String
        var pages = 1
        let settled: Bool
        let seconds: Double
        /// Mac: false when the NEXUS window could not be brought to the front before a shot, so the
        /// picture may show another app's window (run 5: an editor window in the Mac shots).
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

    /// Runs before the normal tour's sign-out, preserving a real pre-migration Keychain session.
    @MainActor
    func testRestoredIdentity() throws {
        app = XCUIApplication()
        let expected = setting("TOUR_EXPECTED_USER_ID") ?? ""
        XCTAssertFalse(expected.isEmpty, "Set the canonical profile ID for this DEV check")
        if let restored = setting("TOUR_RESTORED_SESSION_JSON") {
            launch(step: "restore-session", extraEnvironment: ["NEXUS_TOUR_RESTORED_SESSION": restored])
            XCTAssertEqual(waitForMarker(timeout: 30) { $0.hasPrefix("session-restored") }, "session-restored")
        }
        launch(step: "screen", screen: "identity-restored", route: "nexus://dashboard")
        let result = waitForMarker(timeout: 45) { $0.hasPrefix("ready:") || $0.hasPrefix("no-session:") }
        XCTAssertTrue(result.hasPrefix("ready:"), result)
        let marker = app.staticTexts["nexus.tour.identity"]
        XCTAssertTrue(marker.waitForExistence(timeout: 15))
        let identity = marker.label
        XCTAssertTrue(identity.contains("current=" + expected), identity)
        XCTAssertTrue(identity.contains("sameCredentials=true"), identity)
        if let old = setting("TOUR_EXPECTED_OLD_ID") { XCTAssertTrue(identity.contains("restored=" + old + ";"), identity) }
        pause(2)
        snap("identity-restored")
        persist(Data(identity.utf8), "tour-identity-proof.txt")
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
        var sessionLost = false
        for screen in config.screens {
            if sessionLost { break }
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
            switch dashboards(resolved, email: email, password: password) {
            case .failure(let skip):
                outcomes.append(Outcome(id: screen.id, status: "skipped: \(skip.reason)", pages: 0, settled: false, seconds: 0))
                continue
            case .success(let filled):
                resolved = filled
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
                if status.hasPrefix("no-session") { sessionLost = true }
                if sessionLost || status.hasPrefix("wrong-screen") || status.hasPrefix("timeout") {
                    XCTFail("\(screen.id): \(status)")
                }
                if status.hasPrefix("skipped") {
                    outcomes.append(Outcome(id: screen.id, status: status, pages: 0, settled: false,
                                            seconds: Date().timeIntervalSince(started)))
                    return
                }
                dismissSystemAlerts()
                let validScreen = status == "ready:\(screen.id)"
                let settled = validScreen && waitForSpinnersToStop(timeout: 25)
                pause(1.5)
                dismissSystemAlerts()
                windowBehind = false
                let first = snap(screen.id)
                var more = validScreen ? snapMorePages(screen.id, prefix: "tour-", first: first, in: app, web: false,
                                         pages: screen.pages, sideways: screen.sideways) : 0
                if validScreen, screen.pane == "trailing", let main = scrollTarget(in: app, web: false),
                   let pane = scrollTarget(in: app, web: false, rightOf: main.visible) {
                    more += snapMorePages(screen.id, prefix: "tour-", first: takeShot(app), in: app, web: false,
                                          pages: screen.pages, sideways: 0, target: pane, pageOffset: 1 + more)
                }
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
            if let data = try? JSONEncoder().encode(outcomes) { persist(data, "tour-results.json") }
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
        let base = webBase
        guard !base.isEmpty else {
            XCTFail("TOUR_WEB_BASE is not set. Run scripts/ui-tour.sh instead of the test directly.")
            return
        }
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
            switch dashboards(path, email: email, password: password) {
            case .failure(let skip):
                outcomes.append(Outcome(id: screen.id, status: "skipped: \(skip.reason)", pages: 0, settled: false, seconds: 0))
                continue
            case .success(let filled):
                path = filled
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
                let tapProblem = screen.webTaps.flatMap { pressWebSteps($0) }
                if tapProblem != nil { settled = false }
                // Checked before the extra pages: the login form's own button, not "a password field" —
                // Settings has one (Change password) and was reported as a lost session (run 3).
                let bounced = isLoginPage() && path.hasPrefix("/login") == false
                let first = snapScreen("safari-\(screen.id)")
                let more = snapMorePages(screen.id, prefix: "safari-", first: first, in: safari, web: true)
                outcomes.append(Outcome(id: screen.id,
                                        status: bounced ? "bounced to the login page (session lost)"
                                            : tapProblem.map { "wrong-screen: \(screen.id) (\($0))" }
                                            ?? (settled ? "ok" : "ok, page still changing after 25 s"),
                                        pages: 1 + more,
                                        settled: settled, seconds: Date().timeIntervalSince(started)))
            }
        }
        attach(outcomes, name: "safari-results")
    }

    /// A screen's `webTaps` in Safari, in order: the page's button (or tab) with one of the labels. nil when
    /// done, else what was missing.
    @MainActor
    private func pressWebSteps(_ steps: [String]) -> String? {
        let page = safari.webViews.firstMatch
        let find = { (step: String) -> XCUIElement in
            let names = Self.labels(step)
            let match = NSPredicate(format: "label IN %@", names)
            let button = page.buttons.matching(match).firstMatch
            return button.exists ? button : page.descendants(matching: .any).matching(match).firstMatch
        }
        for (i, step) in steps.enumerated() {
            if step.hasPrefix("?") {
                if i + 1 < steps.count, find(steps[i + 1]).exists { continue }
                if !find(step).exists { continue }
            }
            let target = find(step)
            guard target.waitForExistence(timeout: 10) else { return "no \"\(Self.labels(step)[0])\" button" }
            target.tap()
            pause(1.0)
            _ = waitForWebToSettle(timeout: 10)
        }
        return nil
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
        (setting("TOUR_WEB_BASE") ?? "")
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
        if let steps = screen.appTaps {
            for (i, step) in steps.enumerated() {
                let button = appButton(step)
                if step.hasPrefix("?") {
                    // Only when the next button is not on screen yet (the iPhone's + menu before New project).
                    if i + 1 < steps.count, appButton(steps[i + 1]).exists, appButton(steps[i + 1]).isHittable { continue }
                    if !button.waitForExistence(timeout: 5) { continue }
                }
                guard button.waitForExistence(timeout: 15) else {
                    return "wrong-screen: \(screen.id) (no \"\(Self.labels(step)[0])\" button found)"
                }
                #if targetEnvironment(macCatalyst)
                _ = bringToFront(app)
                #endif
                revealNativeTab(button)
                guard app.windows.firstMatch.frame.intersects(button.frame), button.isHittable else { return "wrong-screen: \(screen.id) (button is offscreen: \(Self.labels(step)[0]))" }
                // A sheet over it (the button is no longer hittable), a chip now selected, or a new picture.
                guard tapUntil(button, landed: { !button.exists || !button.isHittable || button.isSelected }) else {
                    return "wrong-screen: \(screen.id) (tapped \"\(Self.labels(step)[0])\", nothing opened)"
                }
                pause(1.2)
            }
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
                    press(search)
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
        for action in screen.appActions ?? [] {
            let match = NSPredicate(format: "label CONTAINS %@ OR identifier == %@", action.label, action.label)
            let textMatch = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@ OR identifier == %@", action.label, action.label, action.label)
            switch action.kind {
            case "tap":
                let button = app.buttons.matching(match).firstMatch
                let popup = app.popUpButtons.matching(match).firstMatch
                let field = app.textViews.matching(textMatch).firstMatch
                let text = app.staticTexts.matching(match).firstMatch
                // Catalyst menus may expose a native pop-up control rather than a Button.
                let other = app.descendants(matching: .any).matching(match).firstMatch
                #if targetEnvironment(macCatalyst)
                // Native menu items expose their title rather than a label. The indexed query
                // matches that title as well as explicit accessibility identifiers.
                let menuItem = app.menuItems[action.label]
                let target = button.exists ? button : popup.exists ? popup : field.exists ? field : text.exists ? text : menuItem.exists ? menuItem : other
                #else
                let target = button.exists ? button : popup.exists ? popup : field.exists ? field : text.exists ? text : other
                #endif
                let exists = target.waitForExistence(timeout: 15)
                var usable = exists && target.isHittable
                #if targetEnvironment(macCatalyst)
                // Catalyst can report a visible native menu as non-hittable, or return an
                // infinite activation point. Its on-screen frame still gives a real mouse point.
                if exists, target.elementType == .popUpButton {
                    let frame = target.frame
                    usable = !frame.isEmpty && !frame.isInfinite && app.windows.firstMatch.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
                }
                #endif
                guard usable else {
                    persist(Data(app.debugDescription.utf8), "tour-\(screen.id)-missing-target.txt")
                    return "wrong-screen: missing interaction target \(action.label)"
                }
                press(target)
                pause(1)
            case "type":
                let field = app.textFields.matching(textMatch).firstMatch
                let target = field.exists ? field : app.textViews.matching(textMatch).firstMatch
                guard target.waitForExistence(timeout: 10), target.isHittable else { return "wrong-screen: missing input \(action.label)" }
                press(target)
                dismissKeyboardIntroduction()
                target.typeText(action.text ?? "")
                pause(0.5)
            case "scroll":
                let window = app.windows.firstMatch
                let amount = min(0.55, max(0.1, Double(action.text ?? "0.33") ?? 0.33))
                let x: CGFloat = action.label == "sidebar" ? 0.1 : 0.5
                let start = window.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.78))
                #if targetEnvironment(macCatalyst)
                start.scroll(byDeltaX: 0, deltaY: -macWheelSign * CGFloat(amount) * window.frame.height)
                #else
                let end = window.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.78 - amount))
                start.press(forDuration: 0.05, thenDragTo: end)
                #endif
                pause(1)
            case "hover":
                let target = app.buttons.matching(match).firstMatch
                guard target.waitForExistence(timeout: 10) else { return "wrong-screen: missing hover target \(action.label)" }
                target.hover()
                pause(1.5)
            case "key":
                var modifiers: XCUIElement.KeyModifierFlags = []
                for modifier in (action.text ?? "").split(separator: ",") {
                    switch modifier {
                    case "command": modifiers.insert(.command)
                    case "shift": modifiers.insert(.shift)
                    case "option": modifiers.insert(.option)
                    case "control": modifiers.insert(.control)
                    default: break
                    }
                }
                app.typeKey(action.label == "return" ? XCUIKeyboardKey.return.rawValue : action.label, modifierFlags: modifiers)
                pause(1)
            case "typeFocused":
                dismissKeyboardIntroduction()
                app.typeText(action.text ?? "")
                pause(1)
            case "orientation":
                XCUIDevice.shared.orientation = action.label == "landscape" ? .landscapeLeft : .portrait
                pause(2)
            case "capture": attachShot(takeShot(app), "tour-\(screen.id)-\(action.label)")
            case "tree": persist(Data(app.debugDescription.utf8), "tour-\(screen.id)-\(action.label).txt")
            case "checkValue":
                let target = app.textViews.matching(identifier: action.label).firstMatch
                guard target.exists, (target.value as? String)?.contains(action.text ?? "") == true else {
                    return "wrong-screen: missing expected text in \(action.label)"
                }
            case "checkFrame":
                let target = app.textViews.matching(identifier: action.label).firstMatch
                let limits = (action.text ?? "").split(separator: ",").compactMap { Double($0) }
                guard target.waitForExistence(timeout: 10), limits.count == 2,
                      target.frame.width >= CGFloat(limits[0]), target.frame.height <= CGFloat(limits[1]) else {
                    return "wrong-screen: unexpected frame for \(action.label): \(target.exists ? target.frame.debugDescription : "missing")"
                }
            case "checkRow":
                var frames: [CGRect] = []
                let window = app.windows.firstMatch.frame
                for suffix in (action.text ?? "").split(separator: ",") {
                    let id = action.label + String(suffix)
                    let target = app.descendants(matching: .any).matching(identifier: id).firstMatch
                    guard target.exists, target.isHittable else { return "wrong-screen: unavailable control \(id)" }
                    let frame = target.frame
                    guard !frame.isEmpty, window.contains(CGPoint(x: frame.midX, y: frame.midY)),
                          !frames.contains(where: { abs($0.midX - frame.midX) < 8 && abs($0.midY - frame.midY) < 8 }) else {
                        return "wrong-screen: overlapping controls in \(action.label)"
                    }
                    frames.append(frame)
                }
            case "wait": pause(Double(action.text ?? "2") ?? 2)
            case "absent":
                let target = app.descendants(matching: .any).matching(match).firstMatch
                guard !target.exists else { return "wrong-screen: unexpected content \(action.label)" }
            case "check":
                #if targetEnvironment(macCatalyst)
                let labelled = app.descendants(matching: .any).matching(match).firstMatch
                let menuItem = app.menuItems[action.label]
                let target = labelled.exists ? labelled : menuItem.exists ? menuItem : labelled
                #else
                let target = app.descendants(matching: .any).matching(match).firstMatch
                #endif
                guard target.waitForExistence(timeout: 20) else { return "wrong-screen: missing expected content \(action.label)" }
            default: return "wrong-screen: unknown QA action \(action.kind)"
            }
        }
        return nil
    }

    /// Native tab strips can expose an offscreen button to accessibility without an activation point.
    @MainActor
    private func revealNativeTab(_ button: XCUIElement) {
        for _ in 0..<8 {
            guard button.exists else { return }
            let frame = button.frame
            let window = app.windows.firstMatch.frame
            guard frame.maxX > window.maxX || frame.minX < window.minX else { return }
            guard frame.midY > window.minY, frame.midY < window.maxY else { return }
            // SwiftUI does not always expose the horizontal strip as an accessibility ScrollView.
            // Drag the visible row at the tab's y coordinate, just as a finger would.
            let right = frame.maxX > window.maxX
            let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: right ? window.width - 24 : 24, dy: frame.midY - window.minY))
            let end = origin.withOffset(CGVector(dx: right ? 24 : window.width - 24, dy: frame.midY - window.minY))
            start.press(forDuration: 0.05, thenDragTo: end)
            pause(0.4)
        }
    }

    /// The labels of one `appTaps` / `webTaps` step: "?Add|Tambah" → ["Add", "Tambah"].
    private static func labels(_ step: String) -> [String] {
        var body = step.hasPrefix("?") ? String(step.dropFirst()) : step
        if body.hasPrefix("~") { body = String(body.dropFirst()) }
        let names = body.split(separator: "|").map(String.init)
        return names.isEmpty ? [step] : names
    }

    /// A step whose labels are matched as a part of the button's label ("~, QA Dev, Level": the leaderboard row
    /// "1, QA Dev, Level 6 · Diamond, 1.000 XP" only, never the iPad / Mac sidebar's account button "QA Dev 5, …",
    /// which "~QA Dev" hit in run 19, T-2; a row
    /// label also holds its rank, level and XP), after the optional "?".
    private static func partial(_ step: String) -> Bool {
        (step.hasPrefix("?") ? String(step.dropFirst()) : step).hasPrefix("~")
    }

    /// The app's button with one of a step's labels (a menu item is a button too).
    @MainActor
    private func appButton(_ step: String) -> XCUIElement {
        if Self.partial(step) {
            let any = NSCompoundPredicate(orPredicateWithSubpredicates: Self.labels(step).map { NSPredicate(format: "label CONTAINS %@", $0) })
            return app.buttons.matching(any).firstMatch
        }
        return app.buttons.matching(NSPredicate(format: "label IN %@", Self.labels(step))).firstMatch
    }

    private struct Skip: Error { let reason: String }

    /// `{outlet}`, `{outletDay}`, `{socmed}`, `{socmedDay}` in a route filled in (DashboardLookup), or the
    /// reason the screen is skipped. Routes without them come back unchanged, without a lookup.
    private func dashboards(_ route: String, email: String, password: String) -> Result<String, Skip> {
        let keys = ["outlet", "outletDay", "socmed", "socmedDay"].filter { route.contains("{\($0)}") }
        guard !keys.isEmpty else { return .success(route) }
        let found = DashboardLookup.values(base: webBase, email: email, password: password,
                                           overrides: ["outlet": setting("TOUR_OUTLET_PROJECT_ID"),
                                                       "socmed": setting("TOUR_SOCMED_PROJECT_ID")])
        var filled = route
        for key in keys {
            guard let value = found.values[key] else {
                return .failure(Skip(reason: found.problems[key] ?? "\(key) not looked up"))
            }
            filled = filled.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return .success(filled)
    }

    /// Taps `element` and waits until `landed()` (or the app's picture changed). Run 10, 14 Oct 2026: on
    /// the Mac every Legal tab and document tap was "ok" yet did nothing, and all five Legal screens were
    /// the same picture. The window is brought to the front first (a click on a background window only
    /// makes it key), and on the Mac the element is CLICKED, not tapped: see `press`.
    @MainActor
    private func tapUntil(_ element: XCUIElement, landed: () -> Bool) -> Bool {
        for attempt in 0..<3 {
            #if targetEnvironment(macCatalyst)
            _ = bringToFront(app)
            #endif
            let before = app.windows.firstMatch.screenshot().pngRepresentation
            if attempt == 0 {
                press(element)
            } else {
                guard element.exists else { return landed() }
                press(element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
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

    /// A tap on the iPhone / iPad, a mouse click on the Mac. Run 11, 14 Oct 2026: on Mac Catalyst
    /// XCUIElement.tap() (and a coordinate tap) on a SwiftUI Button (the Legal tabs, a document row) was
    /// delivered at the right point yet the button never fired, three times in a row; click() on the same
    /// element, the mouse event a person sends, switched the tab at once. Not an app bug: a mouse works.
    @MainActor
    private func press(_ element: XCUIElement) {
        #if targetEnvironment(macCatalyst)
        if element.elementType == .popUpButton {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        } else {
            element.click()
        }
        #else
        element.tap()
        #endif
    }

    @MainActor
    private func press(_ point: XCUICoordinate) {
        #if targetEnvironment(macCatalyst)
        point.click()
        #else
        point.tap()
        #endif
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
            // Retained/offscreen tabs can own indicators that never become visible on this page.
            if app.activityIndicators.allElementsBoundByIndex.contains(where: { indicator in
                guard indicator.isHittable else { return false }
                // SwiftUI also exposes determinate usage bars as activity indicators.
                if let value = indicator.value as? String, value.contains("%") || Double(value) != nil { return false }
                if indicator.value is NSNumber { return false }
                return true
            }) {
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
    private func dismissKeyboardIntroduction() {
        #if !targetEnvironment(macCatalyst)
        for context in [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let intro = context.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Speed up your typing")).firstMatch
            if intro.exists {
                let button = context.buttons["Continue"]
                if button.exists && button.isHittable { press(button); pause(0.5) }
            }
        }
        #endif
    }

    @MainActor
    private func dismissSystemAlerts() {
        dismissKeyboardIntroduction()
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
                               in root: XCUIApplication, web: Bool, pages: Int? = nil, sideways: Int? = nil,
                               target chosen: ScrollTarget? = nil, pageOffset: Int = 0) -> Int {
        // Menus and previews are transient: a drag can dismiss them and invalidate their hierarchy.
        if pages == 1 { return 0 }
        let globalMax = Int(env["TOUR_MAX_PAGES"] ?? "") ?? 6
        // `pageOffset`: pages already taken of this screen (a second pane continues their numbering).
        let maxPages = max(globalMax, pages ?? 0) + pageOffset
        guard maxPages > 1, let target = chosen ?? scrollTarget(in: root, web: web) else { return 0 }
        var page = 1 + pageOffset
        var last = first.pngRepresentation
        #if targetEnvironment(macCatalyst)
        // The scroll wheel puts the pointer on a row, and its hover highlight alone made "page 2" differ
        // from page 1 while nothing had scrolled, so the wrong wheel direction was never caught (run 11,
        // Legal archive). The pointer goes there first, and the reference picture is taken with it.
        if !web {
            target.element.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: target.visible.minX + 12 - target.element.frame.minX,
                                     dy: target.visible.midY - target.element.frame.minY))
                .hover()
            pause(0.5)
            last = takeShot(root).pngRepresentation
        }
        #endif
        // A drag that lands on a row can still be read as a tap and push a screen (run 5: the
        // leaderboard opened a profile). Pushed screen = stop paging and go back.
        let backs = { () -> Int in web ? 0 : root.navigationBars.buttons.matching(identifier: "BackButton").count }
        let backsBefore = backs()
        let navigatedAway = { () -> Bool in
            guard !web, backs() > backsBefore else { return false }
            let back = root.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
            if back.exists && back.isHittable { self.press(back); self.pause(1.0) }
            return true
        }
        // Only the project board and table have columns to swipe to: not the Dashboard or the Leaderboard,
        // which merely end in "board" (run 17, R17-I-06: the leaderboard's swipe opened a profile, so ranks
        // 8-43 were never shot). Not the Timeline: its sideways shot only moved the date strip on (the same
        // rows, no bars, the today line gone) on every platform in runs 15-17 (run 17, iPhone R17-I-01); its
        // tasks outside the range are named in its own hint.
        if (id.hasSuffix("-board") || id.hasSuffix("-table")) && sideways != 0 {
            var swiped = 0
            var seen = last
            while swiped < max(1, sideways ?? 1) && page < maxPages {
                drag(target, dx: -0.5, dy: 0)
                swiped += 1
                let shot = takeShot(root)
                if navigatedAway() { return page - 1 - pageOffset }
                let data = shot.pngRepresentation
                if data == seen { break }
                // Run 20 (iPhone R20-I-01): the last swipe did not move the board (it was at its right edge), and
                // the md5 differed only through noise in one pixel column, so the same page was kept twice.
                // Run 20 (R20-I-26): a swipe that only brings in empty columns (the frozen Name column and blank
                // cells) changes almost nothing either. Both go.
                let window = root.windows.firstMatch.frame
                if let share = changedShare(from: seen, to: data, in: target.compare, window: window),
                   share < minSidewaysChange { break }
                page += 1
                attachShot(shot, "\(prefix)\(id)-\(page)")
                seen = data
            }
            if seen != last {
                // Back, so the pages below start from the left edge.
                for _ in 0..<swiped { drag(target, dx: 0.5, dy: 0) }
                last = takeShot(root).pngRepresentation
            }
        }
        #if targetEnvironment(macCatalyst)
        var flipped = false
        var scrolled = false
        #endif
        // Run 18 (iPhone R18-I-01, iPad T-2): the List's pages went back UP and two were byte-identical, so the
        // Done rows were never shot. Pages now only go down: a page whose rows were ALL on an earlier page (fine
        // pixel rows, so look-alike rows with other words still count as new) ends the paging, as does an earlier
        // page's exact picture. And a page the pages around it show whole is replaced by the next one (the
        // short end of a scroll): each page is attached one step late for that.
        let window0 = root.windows.firstMatch.frame
        var seenRows = Set(fineRows(last, in: target.compare, window: window0).compactMap { $0 })
        var savedShots: [Data] = [last]
        var keptRows: [UInt64?] = fineRows(last, in: target.compare, window: window0)
        var pending: (shot: XCUIScreenshot, rows: [UInt64?])?
        func flush() {
            guard let p = pending else { return }
            attachShot(p.shot, "\(prefix)\(id)-\(page)")
            pending = nil
        }
        var retriedInMiddle = false
        /// The retried drag moved the page (see `retriedInMiddle`).
        var retryMoved = false
        // `page` counts the pending page too, so the cap holds.
        while page < maxPages {
            // Run 20 (R20-I-05, T-3, decision 29): the step ends in the gap between two rows, so the next page
            // starts on a whole row instead of one sliced at its top.
            drag(target, dx: 0, dy: -restingStep(last, target: target, window: root.windows.firstMatch.frame))
            if navigatedAway() { break }
            if !web { _ = waitForSpinnersToStop(timeout: 4) }
            var shot = takeShot(root)
            var data = shot.pngRepresentation
            #if targetEnvironment(macCatalyst)
            // First scroll changed nothing: maybe the wheel goes the other way on this Mac. Once.
            // (Not `page == 1`: a board's sideways shot already made it 2, and the flip never came.)
            if (data == last || unmoved(last, data, target.compare, root)) && !scrolled && !flipped {
                flipped = true
                macWheelSign = -macWheelSign
                continue
            }
            #endif
            let stayed = data == last || unmoved(last, data, target.compare, root)
            #if !targetEnvironment(macCatalyst)
            // Run 20 (T-4): the iPad Home's first drag down the left gutter moved nothing and the screen got one
            // page, its Leaderboard cut mid-row. Once per screen, before giving up, the drag is tried again in the
            // middle of the view (a row it starts on and opens is handled by `navigatedAway`).
            if stayed && !retriedInMiddle && savedShots.count == 1 {
                retriedInMiddle = true
                drag(target, dx: 0, dy: -restingStep(last, target: target, window: root.windows.firstMatch.frame), inMiddle: true)
                if navigatedAway() { break }
                _ = waitForSpinnersToStop(timeout: 4)
                let again = takeShot(root)
                if again.pngRepresentation != last && !unmoved(last, again.pngRepresentation, target.compare, root) {
                    retryMoved = true
                    shot = again
                    data = again.pngRepresentation
                }
            }
            #endif
            if stayed && !retryMoved { break }
            retryMoved = false
            // Too little new on it: the end of the scroll, or nothing moved at all and only a clock or a
            // hover changed (UI tour run 13, F-08 / M-27; run 15, R15-I-20 / T-1). A page is dropped only when
            // about 90% of its content rows are already on the page before. Run 16 (R16-I-04): the run 15
            // check measured a scroll SHIFT, and blank rows matched at any shift, so real pages read as "not
            // moved" and were lost (project overview 4 → 1, leaderboard 5 → 2).
            let window = root.windows.firstMatch.frame
            let fresh = newContent(from: last, to: data, in: target.compare, window: window)
            // Run 17 (iPhone R17-I-01, T-1): a page that only MOVED kept passing the check above (the GIDEON
            // empty state 240 pt higher, nothing new). `shiftedNew` explains the new page as the page before
            // moved up by the drag (or less, at the end of the scroll) and counts what that leaves unexplained.
            let moved = shiftedNew(from: last, to: data, in: target.compare, window: window)
            let repeatsBefore = fresh.map { $0.new < minNewContent && $0.inPlace >= minInPlace } ?? false
            let looksRepeated = repeatsBefore || (moved.map { $0 < minShiftedNew } ?? false)
            #if targetEnvironment(macCatalyst)
            // Nothing new at all on the first scroll: maybe the wheel goes the other way.
            if looksRepeated && (fresh?.new ?? 1) < 0.02 && (moved ?? 1) < 0.02 && !scrolled && !flipped {
                flipped = true
                macWheelSign = -macWheelSign
                continue
            }
            #endif
            if savedShots.contains(data) { break }
            // Run 19 (iPhone R19-I-01 / R19-I-04, iPad / Mac T-1): the end of a scroll moved the page only a little
            // and what it brought in holds no text or icon (empty sheet space, a card's bottom edge). The tests
            // above read sub-pixel redraws as new rows and kept it. Such a page goes, whatever they say.
            if shiftedOnly(from: last, to: data, in: target.compare, window: window) { break }
            let rows = fineRows(data, in: target.compare, window: window)
            let content = rows.compactMap { $0 }
            // The share of this page's content rows on no earlier page. Measured offline on runs 16-18 (every
            // vertical page): repeats 0.000 (run 17 iPhone gideon-2, run 18 iPhone / iPad project-list-5); the
            // lowest real page 0.029 (run 17 iPhone legal-settings-6, whose series rows look like PATS's).
            let unseen: CGFloat = content.isEmpty ? (looksRepeated ? 0 : 1)
                : CGFloat(content.filter { !seenRows.contains($0) }.count) / CGFloat(content.count)
            if unseen < minUnseen { break }
            // The shift tests above alone dropped a last page that adds a line or two: the iPad outlet day ended on
            // "No report yet. Fill report…" cut by the screen's bottom, with no page 2 (UI tour run 18, iPad
            // R18-I-07; run 17 iPad outlet-day-2 adds 5.5% new rows). A page they call a repeat goes only when its
            // own rows add almost nothing too (decision 5: a last page stays when it adds content).
            // On the Mac a wheel scroll redraws text at sub-pixel offsets, so nearly every row reads as new: there
            // the shift tests alone decide, as before.
            #if targetEnvironment(macCatalyst)
            if looksRepeated { break }
            #else
            if looksRepeated && unseen < minUnseenOfRepeat { break }
            #endif
            #if targetEnvironment(macCatalyst)
            scrolled = true
            #endif
            last = data
            savedShots.append(data)
            if let p = pending {
                // The page before this one adds nothing that the page before it and this one do not show
                // (>= 98% of its rows): it goes, this one takes its place. Runs 16-18 offline: run 16 iPhone
                // tickets-2 and iPad projects-4, project-table-4 and project-timeline-5, each shown whole by its
                // neighbours; no other page.
                let kept = Set(keptRows.compactMap { $0 }), next = Set(content)
                let own = p.rows.compactMap { $0 }
                let shown = own.filter { kept.contains($0) || next.contains($0) }.count
                if own.isEmpty || CGFloat(shown) / CGFloat(own.count) < minCovered {
                    flush()
                    keptRows = p.rows
                    page += 1
                }
            } else {
                page += 1
            }
            content.forEach { seenRows.insert($0) }
            pending = (shot, rows)
        }
        flush()
        return page - 1 - pageOffset
    }

    /// The share of the pixels of `rect` (right 10 pt left out) whose grey level differs by more than 24 between
    /// the two pictures; nil when they cannot be compared.
    private func changedShare(from old: Data, to new: Data, in rect: CGRect, window: CGRect) -> CGFloat? {
        guard let a = greyRect(old, rect: rect, window: window), let b = greyRect(new, rect: rect, window: window),
              a.width == b.width, a.height == b.height, !a.pixels.isEmpty else { return nil }
        var changed = 0
        a.pixels.withUnsafeBufferPointer { pa in
            b.pixels.withUnsafeBufferPointer { pb in
                for i in 0..<pa.count where abs(Int(pa[i]) - Int(pb[i])) > 24 { changed += 1 }
            }
        }
        return CGFloat(changed) / CGFloat(a.pixels.count)
    }

    /// True when the page did not move at all: almost no pixel changed. Measured offline on every consecutive
    /// page pair of runs 17-20 (drag rects from the logs): the identical iPhone project-board-4/-5 of run 20
    /// change 0.000; the lowest real vertical page (Mac project-timeline-5, rows of look-alike Done tasks) 0.004.
    private func unmoved(_ old: Data, _ new: Data, _ rect: CGRect, _ root: XCUIApplication) -> Bool {
        guard let share = changedShare(from: old, to: new, in: rect, window: root.windows.firstMatch.frame)
        else { return false }
        return share < minVerticalChange
    }

    private var minVerticalChange: CGFloat { CGFloat(Double(env["TOUR_MIN_VERTICAL_CHANGE"] ?? "") ?? 0.001) }
    /// A sideways page that changes less than this share of the pixels adds nothing: run 20 iPhone project-board-5
    /// 0.000, project-table-2 0.002 (only empty columns came in); the lowest real sideways page 0.013 (iPhone
    /// project-table-3, runs 18-20).
    private var minSidewaysChange: CGFloat { CGFloat(Double(env["TOUR_MIN_SIDEWAYS_CHANGE"] ?? "") ?? 0.005) }

    /// The vertical step, as a share of the drag rect's height, that puts the next page's top edge in the middle
    /// of the widest row with no ink (text, icons: grey more than 48 levels off the row's median) between 60 and
    /// 76 % of the view, so that page starts on a whole row; `pageStep` when there is no such gap of 4 pt or more.
    /// Measured offline on runs 20 (iPhone, iPad, Mac; every page but the last): such a gap exists on 198 of 207
    /// pages, 18-46 pt wide (10th-90th percentile), the space between rows and cards, not between two lines of
    /// one row. The range stays inside the 85-110 % of `pageStep` the shift tests search.
    private func restingStep(_ png: Data, target: ScrollTarget, window: CGRect) -> CGFloat {
        guard (env["TOUR_ROW_REST"] ?? "1") != "0",
              let g = greyRect(png, rect: target.visible, window: window), g.height > 100 else { return pageStep }
        let w = g.width, h = g.height
        let lo = Int(CGFloat(h) * 0.60), hi = Int(CGFloat(h) * 0.76)
        var blank = [Bool](repeating: false, count: h)
        g.pixels.withUnsafeBufferPointer { px in
            var hist = [Int](repeating: 0, count: 256)
            for y in lo..<min(h, hi + Int(g.scale * 60)) {
                for i in 0..<256 { hist[i] = 0 }
                for x in 0..<w { hist[Int(px[y * w + x])] += 1 }
                var median = 0, seen = 0
                while median < 255 && seen + hist[median] <= w / 2 { seen += hist[median]; median += 1 }
                var ink = 0
                for x in 0..<w where abs(Int(px[y * w + x]) - median) > 48 { ink += 1; if ink > 2 { break } }
                blank[y] = ink <= 2
            }
        }
        let minRun = Int(g.scale * 4)
        var best: (len: Int, mid: Int)?
        var y = lo
        while y < hi {
            guard blank[y] else { y += 1; continue }
            var e = y
            while e < blank.count && blank[e] { e += 1 }
            if e - y >= minRun, best.map({ e - y > $0.len }) ?? true { best = (e - y, (y + e) / 2) }
            y = e
        }
        guard let best else { return pageStep }
        return CGFloat(min(best.mid, hi)) / CGFloat(h)
    }

    /// A page is a repeat when less than this share of its content rows (`fineRows`) is on no earlier page.
    private var minUnseen: CGFloat { CGFloat(Double(env["TOUR_MIN_UNSEEN"] ?? "") ?? 0.01) }
    /// A page shown by the pages around it to at least this share of its rows is replaced by the next page.
    /// A page the shift tests call a repeat stays only when at least this share of its rows is new.
    private var minUnseenOfRepeat: CGFloat { CGFloat(Double(env["TOUR_MIN_UNSEEN_OF_REPEAT"] ?? "") ?? 0.03) }
    private var minCovered: CGFloat { CGFloat(Double(env["TOUR_MIN_COVERED"] ?? "") ?? 0.98) }

    /// True when `new` is `old` moved up by less than half a page step (the end of the scroll) and the band the
    /// move brought in holds less than `maxRevealedInk` points of rows with dark ink (text, icons, avatars: grey
    /// more than 48 levels off the row's median) that did not sit in the same place before (a floating button),
    /// while almost all ink above that band is explained by the old picture at that shift.
    /// Measured offline on every vertical page of runs 16-19 (rects from the tour logs): it drops exactly the
    /// shift-only pages the reviews name (run 19 iPhone dashboard-3, project-templates-2, socmed-settings-2;
    /// iPad project-table-6; Mac calendar-2, projects-2, socmed-calendar-2; run 17 iPhone gideon-2, iPad
    /// dashboard-3, Mac socmed-day-3) and keeps every last page that adds a line (iPad outlet-day-2 16 pt,
    /// iPhone outlet-calendar-2 12.7 pt, Mac project-overview-3 10 pt, leaderboard-6 with the XP log 36 pt).
    private func shiftedOnly(from old: Data, to new: Data, in rect: CGRect, window: CGRect) -> Bool {
        guard let a = greyRect(old, rect: rect, window: window), let b = greyRect(new, rect: rect, window: window),
              a.width == b.width, a.height == b.height, a.height > 60, a.width > 8 else { return false }
        let w = a.width, h = a.height, scale = a.scale
        // The shift: the row profiles (mean and spread per row) that line up best.
        func profile(_ g: GreyRect) -> (mean: [Double], spread: [Double]) {
            var mean = [Double](repeating: 0, count: h), spread = [Double](repeating: 0, count: h)
            g.pixels.withUnsafeBufferPointer { px in
                for y in 0..<h {
                    var sum = 0, sq = 0
                    for x in 0..<w { let v = Int(px[y * w + x]); sum += v; sq += v * v }
                    let m = Double(sum) / Double(w)
                    mean[y] = m; spread[y] = (Double(sq) / Double(w) - m * m).squareRoot()
                }
            }
            return (mean, spread)
        }
        let pa = profile(a), pb = profile(b)
        let step = CGFloat(h) * pageStep
        var bestErr = Double.infinity, d = 0
        for shift in 0..<min(h - 40, Int(step * 1.15)) {
            var err = 0.0, n = 0
            for y in 0..<(h - shift) where pb.spread[y] > 2 || pa.spread[y + shift] > 2 {
                err += abs(pb.mean[y] - pa.mean[y + shift]); n += 1
            }
            guard n >= 30 else { continue }
            if err / Double(n) < bestErr { bestErr = err / Double(n); d = shift }
        }
        let shiftPt = CGFloat(d) / scale
        guard shiftPt >= 2, CGFloat(d) < step * 0.5 else { return false }
        let ink = 48
        var bandRows = 0, outInk = 0, outLeft = 0
        a.pixels.withUnsafeBufferPointer { pa in
            b.pixels.withUnsafeBufferPointer { pb in
                var hist = [Int](repeating: 0, count: 256)
                for y in 0..<h {
                    for i in 0..<256 { hist[i] = 0 }
                    for x in 0..<w { hist[Int(pb[y * w + x])] += 1 }
                    var median = 0, seen = 0
                    while median < 255 && seen + hist[median] <= w / 2 { seen += hist[median]; median += 1 }
                    let inBand = y >= h - d
                    var rowNew = 0, inPlaceInk = 0, periodicInk = 0
                    for x in 0..<w {
                        let v = Int(pb[y * w + x])
                        guard abs(v - median) > ink else { continue }
                        func near(_ yy: Int) -> Bool { yy >= 0 && yy < h && abs(Int(pa[yy * w + x]) - v) <= ink }
                        let inPlace = near(y - 1) || near(y) || near(y + 1)
                        if inBand {
                            if !inPlace {
                                rowNew += 1
                            } else {
                                inPlaceInk += 1
                                // The old page repeats itself one shift up here (look-alike rows one pitch apart),
                                // and not merely along a vertical line: the "in place" ink is the next row looking
                                // like the last, not a floating overlay.
                                let o = Int(pa[y * w + x])
                                func oldNear(_ yy: Int) -> Bool { yy >= 0 && yy < h && abs(Int(pa[yy * w + x]) - o) <= ink }
                                let periodic = oldNear(y - d - 1) || oldNear(y - d) || oldNear(y - d + 1)
                                let vertical = oldNear(y - 3) && oldNear(y + 3)
                                if periodic && !vertical { periodicInk += 1 }
                            }
                        } else if !inPlace && !near(y + d - 1) && !near(y + d) && !near(y + d + 1) {
                            outLeft += 1
                        }
                        if !inBand { outInk += 1 }
                    }
                    // Run 20 (T-4): a list of look-alike rows ("[TEST] seq SURAT…", leaderboard rows) whose last scroll
                    // moved exactly one row pitch had its new row "in place" over the old last row, so the page that
                    // brought in a real row (the iPad Legal archive's pager, the Home leaderboard's last rows) was
                    // dropped as shift-only. Such a row's in-place ink counts as new. Offline: no decision of runs
                    // 16-20 changes; a synthetic one-pitch end page of iPad legal-archive-4 is now kept (10-15 pt).
                    if inPlaceInk >= 10 && periodicInk * 100 >= inPlaceInk * 85 { rowNew += inPlaceInk }
                    if rowNew >= 3 { bandRows += 1 }
                }
            }
        }
        let revealed = CGFloat(bandRows) / scale
        let unexplained = outInk == 0 ? 0 : CGFloat(outLeft) / CGFloat(outInk)
        return revealed < maxRevealedInk && unexplained < 0.05
    }

    /// A page that only shifted brings in less than this many points of ink rows (one line of the smallest text
    /// is about 8 pt).
    private var maxRevealedInk: CGFloat { CGFloat(Double(env["TOUR_MAX_REVEALED_INK"] ?? "") ?? 6) }

    private struct GreyRect { let pixels: [UInt8]; let width: Int; let height: Int; let scale: CGFloat }

    /// The grey pixels of `rect` (screen points) at full resolution, the right 10 pt (the scroll bar) left out.
    private func greyRect(_ png: Data, rect: CGRect, window: CGRect) -> GreyRect? {
        guard let image = UIImage(data: png)?.cgImage, window.width > 0 else { return nil }
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        let scale = CGFloat(width) / window.width
        let local = rect.offsetBy(dx: -window.minX, dy: -window.minY)
        let x0 = max(0, Int(local.minX * scale)), x1 = min(width, Int((local.maxX - 10) * scale))
        let y0 = max(0, Int(local.minY * scale)), y1 = min(height, Int(local.maxY * scale))
        guard x1 > x0, y1 > y0 else { return nil }
        var out = [UInt8](repeating: 0, count: (x1 - x0) * (y1 - y0))
        let w = x1 - x0
        for y in y0..<y1 {
            for x in x0..<x1 { out[(y - y0) * w + (x - x0)] = pixels[y * width + x] }
        }
        return GreyRect(pixels: out, width: w, height: y1 - y0, scale: scale)
    }

    /// One hash per pixel row of `rect` at full resolution (grey, 8 levels), the right 10 pt (the scroll bar)
    /// left out; nil for a blank row. Unlike `wideRows`, two rows with different words never share a hash, so
    /// "on an earlier page" means the very same row.
    private func fineRows(_ png: Data, in rect: CGRect, window: CGRect) -> [UInt64?] {
        guard let image = UIImage(data: png)?.cgImage, window.width > 0 else { return [] }
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return [] }
        let scale = CGFloat(width) / window.width
        let local = rect.offsetBy(dx: -window.minX, dy: -window.minY)
        let x0 = max(0, Int(local.minX * scale)), x1 = min(width, Int((local.maxX - 10) * scale))
        let y0 = max(0, Int(local.minY * scale)), y1 = min(height, Int(local.maxY * scale))
        guard x1 > x0 + 8, y1 > y0 else { return [] }
        return pixels.withUnsafeBufferPointer { px in
            (y0..<y1).map { y -> UInt64? in
                var hash: UInt64 = 0xcbf29ce484222325
                let row = y * width
                let first = px[row + x0] >> 5
                var flat = true
                for x in x0..<x1 {
                    let v = px[row + x] >> 5
                    if v != first { flat = false }
                    hash = (hash ^ UInt64(v)) &* 0x100000001b3
                }
                return flat ? nil : hash
            }
        }
    }

    /// How far each page drag scrolls, as a fraction of the visible scroll area. 0.7 leaves about 30% of
    /// the page before on screen for context, and reaches more of a long list within TOUR_MAX_PAGES than
    /// the 0.5 of runs 3–16 did (run 16, T-1: 40–70% repeats, while the Mac List covered 35 of 106 rows).
    private var pageStep: CGFloat { CGFloat(Double(env["TOUR_PAGE_STEP"] ?? "") ?? 0.7) }

    /// A page is dropped only when BOTH tests say it is the page before again (losing a real page is worse than
    /// keeping a repeat). Measured offline on every consecutive pair of runs 15 and 16 (296 pages):
    /// - new rows (`minNewContent`): a list of look-alike rows ("REIMBURSE PATS SPORTS · 4 May") can score low
    ///   though it scrolled a whole screen (run 15 iPad timeline-3: 0.09), so this alone is not enough;
    /// - rows still in place (`minInPlace`): the share of the page's rows found within 5% of the same height
    ///   on the page before. That timeline page scores 0.25; true repeats 0.91–1.00 (iPad settings-2 0.09 /
    ///   0.91, Mac overview-4 0.00 / 1.00). No real page with new rows under 0.20 stays above 0.82 in place.
    private var minNewContent: CGFloat { CGFloat(Double(env["TOUR_MIN_NEW_CONTENT"] ?? "") ?? 0.08) }
    /// A page is dropped too when less than this share of the rect's height holds content the page before
    /// cannot explain once it is shifted by the scroll (`shiftedNew`). Measured offline on every consecutive
    /// pair of runs 15-17 (436 pages, rects from the tour logs): repeats 0.00-0.05 (run 17 iPhone gideon-2
    /// 0.00, iPad outlet-day-2 0.01 and project-overview-3 0.04, run 15 Mac overview-4 0.01); the lowest page
    /// with real new rows 0.07 (run 17 iPad socmed-settings-2), then 0.08-0.10 (iPad dashboard-3, outlet-
    /// settings-2, form-builder-2; iPhone project-table-6, form-builder-3).
    private var minShiftedNew: CGFloat { CGFloat(Double(env["TOUR_MIN_SHIFTED_NEW"] ?? "") ?? 0.06) }
    private var minInPlace: CGFloat { CGFloat(Double(env["TOUR_MIN_IN_PLACE"] ?? "") ?? 0.85) }

    /// The share of the new picture's content rows inside `rect` (screen points) that the old picture does
    /// not hold ANYWHERE in that rect: 0 = nothing new, 1 = all new. It does not depend on how far the page
    /// moved, so blank rows (which match at any shift) cannot hide new content. nil when the pictures cannot
    /// be read; then the page counts as new.
    ///
    /// The rect is cut into 4 vertical strips, each compared on its own, and the strip with the most new
    /// rows decides: a column that does not scroll (the Settings section list, a sticky Name column) holds no
    /// new rows, and must not water down the column that scrolled.
    /// `inPlace`: the share of the new picture's content rows found in the old one within 5% of the rect's
    /// height of the same place; the strip with the fewest decides (the one that scrolled).
    private func newContent(from old: Data, to new: Data, in rect: CGRect, window: CGRect) -> (new: CGFloat, inPlace: CGFloat)? {
        guard let a = stripRows(old, rect: rect, window: window, every: 1),
              let b = stripRows(new, rect: rect, window: window, every: 1), a.count == b.count else { return nil }
        var fresh: CGFloat?
        var inPlace: CGFloat = 1
        for (sa, sb) in zip(a, b) {
            let seen = Set(sa.compactMap { $0 })
            let sampled = stride(from: 0, to: sb.count, by: 2).compactMap { i in sb[i].map { (i, $0) } }
            guard sampled.count >= 20 else { continue }
            let unseen = sampled.filter { !seen.contains($0.1) }.count
            fresh = max(fresh ?? 0, CGFloat(unseen) / CGFloat(sampled.count))
            let reach = max(1, sa.count / 20)
            let near = sampled.filter { i, h in
                let lo = max(0, i - reach), hi = min(sa.count - 1, i + reach)
                return lo <= hi && sa[lo...hi].contains(h)
            }.count
            inPlace = min(inPlace, CGFloat(near) / CGFloat(sampled.count))
        }
        return fresh.map { ($0, inPlace) }
    }

    /// The share of `rect`'s height (pixel rows) on the new picture holding content that the old picture,
    /// shifted up by the scroll, does not explain. One hash per pixel row across the WHOLE rect (96 blocks,
    /// 16 levels; blank rows skipped), so a look-alike row in one strip cannot pass for the row that is there.
    /// The shift is first looked for near the drag's own distance (85-110% of `pageStep`, at least half the
    /// overlapping rows equal); failing that (the end of the scroll), the shift whose rows match best. A row
    /// is explained when the old picture holds it at that shift, or in the same place (a sticky header).
    /// nil when the pictures cannot be read; then the page counts as new.
    private func shiftedNew(from old: Data, to new: Data, in rect: CGRect, window: CGRect) -> CGFloat? {
        guard let a = wideRows(old, rect: rect, window: window), let b = wideRows(new, rect: rect, window: window),
              a.count == b.count, b.count > 20 else { return nil }
        let height = b.count
        let step = Int(CGFloat(height) * pageStep)
        func score(_ d: Int) -> (match: Int, compared: Int) {
            var match = 0, compared = 0
            var y = 0
            while y + d < height {
                if let h = b[y], let g = a[y + d] { compared += 1; if h == g { match += 1 } }
                y += 1
            }
            return (match, compared)
        }
        var shift = 0
        var bestMatch = -1
        var fullStep = false
        let lo = max(1, step * 85 / 100), hi = min(height - 1, step * 110 / 100)
        if lo <= hi {
            for d in lo...hi {
                let s = score(d)
                if s.match > bestMatch {
                    bestMatch = s.match; shift = d
                    fullStep = s.compared > 0 && Double(s.match) / Double(s.compared) >= 0.5
                }
            }
        }
        if !fullStep {
            shift = 0
            var bestRatio = -1.0
            for d in 0..<min(height, max(step, 1)) {
                let s = score(d)
                guard s.compared >= 10 else { continue }
                let ratio = Double(s.match) / Double(s.compared)
                if ratio > bestRatio + 0.02 { bestRatio = ratio; shift = d }
            }
        }
        var unexplained = 0
        for y in 0..<height {
            guard let h = b[y] else { continue }
            if y >= height - shift { unexplained += 1; continue }
            if a[y + shift] != h && a[y] != h { unexplained += 1 }
        }
        return CGFloat(unexplained) / CGFloat(height)
    }

    /// One hash per pixel row of `rect` across its whole width (see `shiftedNew`); nil for a blank row.
    private func wideRows(_ png: Data, rect: CGRect, window: CGRect) -> [UInt64?]? {
        guard let image = UIImage(data: png)?.cgImage else { return nil }
        let width = image.width, height = image.height
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn, window.width > 0 else { return nil }
        let scale = CGFloat(width) / window.width
        let local = rect.offsetBy(dx: -window.minX, dy: -window.minY)
        let x0 = max(0, Int(local.minX * scale)), x1 = min(width, Int(local.maxX * scale))
        let y0 = max(0, Int(local.minY * scale)), y1 = min(height, Int(local.maxY * scale))
        let blocks = 96
        let blockWidth = (x1 - x0) / blocks
        guard blockWidth > 0, y1 - y0 > 8 else { return nil }
        var out: [UInt64?] = []
        out.reserveCapacity(y1 - y0)
        for y in y0..<y1 {
            var hash: UInt64 = 0xcbf29ce484222325
            var low = Int.max, high = Int.min
            for block in 0..<blocks {
                let start = x0 + block * blockWidth
                var sum = 0
                for x in start..<(start + blockWidth) {
                    let i = y * bytesPerRow + x * 4
                    sum += Int(pixels[i]) + Int(pixels[i + 1]) + Int(pixels[i + 2])
                }
                let level = (sum / (blockWidth * 3)) >> 4
                low = min(low, level); high = max(high, level)
                hash = (hash ^ UInt64(level)) &* 0x100000001b3
            }
            out.append(low == high ? nil : hash)
        }
        return out
    }

    /// For each of 4 vertical strips of `rect`, one hash per pixel row (every `every` rows) in a PNG
    /// screenshot (the picture is of `window`, or of the whole screen when its size says so); nil for a
    /// blank row (one flat colour across the strip). A row hashes the mean colour of 24 blocks, coarsened to
    /// 16 levels: a sub-point scroll re-rasterises text a little, and exact pixels then never matched (run 15:
    /// pixel-identical pages differed in 0.1% of their pixels). The old page is read at every row, so a
    /// scroll by an odd number of pixels still finds its rows.
    private func stripRows(_ png: Data, rect: CGRect, window: CGRect, every: Int) -> [[UInt64?]]? {
        guard let image = UIImage(data: png)?.cgImage else { return nil }
        let width = image.width, height = image.height
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn, window.width > 0 else { return nil }
        let scale = CGFloat(width) / window.width
        let local = rect.offsetBy(dx: -window.minX, dy: -window.minY)
        let x0 = max(0, Int(local.minX * scale)), x1 = min(width, Int(local.maxX * scale))
        let y0 = max(0, Int(local.minY * scale)), y1 = min(height, Int(local.maxY * scale))
        let strips = 4, blocks = 24
        let blockWidth = (x1 - x0) / (strips * blocks)
        guard blockWidth > 0, y1 - y0 > 8 else { return nil }
        return (0..<strips).map { strip in
            var out: [UInt64?] = []
            out.reserveCapacity((y1 - y0) / every)
            for y in stride(from: y0, to: y1, by: every) {
                var hash: UInt64 = 0xcbf29ce484222325
                var low = Int.max, high = Int.min
                for block in 0..<blocks {
                    let start = x0 + (strip * blocks + block) * blockWidth
                    var sum = 0
                    for x in start..<(start + blockWidth) {
                        let i = y * bytesPerRow + x * 4
                        sum += Int(pixels[i]) + Int(pixels[i + 1]) + Int(pixels[i + 2])
                    }
                    let level = (sum / (blockWidth * 3)) >> 4
                    low = min(low, level); high = max(high, level)
                    hash = (hash ^ UInt64(level)) &* 0x100000001b3
                }
                out.append(low == high ? nil : hash)
            }
            return out
        }
    }

    /// Where the drags go: an element, and the part of it that is actually on screen.
    private struct ScrollTarget {
        let element: XCUIElement
        let visible: CGRect
        /// What the page checks compare: `visible`, except for a sheet or pane that starts right of the
        /// window's edge on iPad / Mac. It lies OVER the sidebar, so all of it is on screen; cut at the
        /// sidebar, the outlet settings sheet lost its labels and its pages compared as icons only (run 17).
        let compare: CGRect
    }

    /// The page in Safari; in the app the scroll view, collection view or table with the most area
    /// ON SCREEN. Measured by the whole frame, the Timeline's inner horizontal scroll view (as tall as
    /// all its rows) beat the vertical one around it; the drags went to its off-screen middle and
    /// pages 1–3 of the iPhone timeline were the same picture (run 5).
    ///
    /// iPad / Mac: never the sidebar, and only the part of the page BESIDE it. Run 11, 14 Oct 2026: the
    /// iPad's page scroll view spans the whole window, under the floating sidebar, so the drags down its
    /// left gutter (6 pt in) landed on the sidebar list; pages 2–6 of the dashboard, attendance, Legal
    /// and most other screens scrolled the sidebar and showed the same page.
    @MainActor
    private func scrollTarget(in root: XCUIApplication, web: Bool, rightOf main: CGRect? = nil) -> ScrollTarget? {
        let screen = root.windows.firstMatch.frame
        var window = screen
        // A pane right of the page's own scroll area (Screen.pane): only that part of the window.
        if let main {
            guard main.maxX < screen.maxX - 120 else { return nil }
            window = CGRect(x: main.maxX - 2, y: screen.minY, width: screen.maxX - main.maxX + 2, height: screen.height)
        }
        if web {
            let page = root.webViews.firstMatch
            guard page.exists else { return nil }
            let shown = page.frame.intersection(window)
            return ScrollTarget(element: page, visible: shown, compare: shown)
        }
        let sidebar = sidebarFrame(in: root, window: window)
        if let sidebar, sidebar.maxX < window.maxX - 80, sidebar.maxX > window.minX {
            window = CGRect(x: sidebar.maxX, y: window.minY, width: window.maxX - sidebar.maxX, height: window.height)
        }
        // iPhone: the floating tab bar hides the bottom of the page. Left in the rect, what sat under it on
        // page N counted as seen, the next page started below it and it was never shot (run 17, iPhone
        // R17-I-06: the Active sessions header, the Home tile labels). The rect ends above the bar.
        var tabTop = screen.maxY
        let tabBar = root.tabBars.firstMatch
        // Not under a sheet: there the bar is covered and the sheet's own scroll view runs to the bottom.
        if tabBar.exists && tabBar.isHittable {
            let bar = tabBar.frame
            if !bar.isEmpty, bar.minY > screen.midY, bar.width > screen.width * 0.5 { tabTop = bar.minY }
        }
        func clipTabBar(_ r: CGRect) -> CGRect {
            guard r.maxY > tabTop, r.minY < tabTop - 80 else { return r }
            return CGRect(x: r.minX, y: r.minY, width: r.width, height: tabTop - r.minY)
        }
        var best: ScrollTarget?
        var bestArea: CGFloat = 0
        for query in [root.collectionViews, root.tables, root.scrollViews] {
            for i in 0..<min(query.count, 16) {
                let element = query.element(boundBy: i)
                guard element.exists else { continue }
                if let sidebar, element.frame.insetBy(dx: 2, dy: 2).intersection(sidebar) == element.frame.insetBy(dx: 2, dy: 2) { continue }
                let visible = element.frame.intersection(window)
                guard !visible.isNull, visible.width > 40, visible.height > 80 else { continue }
                // A frame much taller or wider than what shows of it is content, not a viewport: it is
                // scrolled by something around it.
                // (Against the whole window: a page scroll view under the sidebar is still a viewport.)
                let shown = element.frame.intersection(screen)
                let isViewport = element.frame.height <= shown.height * 1.05 && element.frame.width <= shown.width * 1.05
                // A scroll view under a sheet is not hittable: the sheet's own scroll view is the page now,
                // even when the dimmed page behind it is larger (run 16, T-2: the iPad socmed day sheet and
                // the Mac Legal document got one page, because the drags scrolled the page behind them).
                let covered = !element.isHittable
                let area = visible.width * visible.height * (isViewport ? 1 : 0.5) * (covered ? 0.2 : 1)
                if area > bestArea {
                    let overSidebar = sidebar != nil && element.frame.minX >= screen.minX + 8
                    let whole = element.frame.intersection(screen)
                    best = ScrollTarget(element: element, visible: clipTabBar(visible),
                                        compare: clipTabBar(overSidebar && !whole.isNull ? whole : visible))
                    bestArea = area
                }
            }
        }
        // iPhone: a header laid over the scroll view's top (a safe-area inset: Settings' subtitle and tab strip,
        // ~200 pt) hides what scrolls under it, yet the rect began at the screen top. The step (0.7 of the rect)
        // then left almost no visible overlap, and the rows that sat under the tab bar on page 1 scrolled straight
        // under the header: the "Active sessions" title was never shot (run 18, iPhone R18-I-02; run 17 the
        // same). The rect starts under that header.
        if !web, sidebar == nil, let b = best, let top = overlayBottom(over: b, in: root),
           top > b.visible.minY + 20, top < b.visible.minY + b.visible.height * 0.45 {
            func below(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: top, width: r.width, height: r.maxY - top) }
            best = ScrollTarget(element: b.element, visible: below(b.visible), compare: below(b.compare))
        }
        return best
    }

    /// The bottom of the controls drawn over the top of `target` that are not part of its content (a navigation
    /// bar, a page header in a safe-area inset), from one accessibility snapshot; nil when there are none.
    @MainActor
    private func overlayBottom(over target: ScrollTarget, in root: XCUIApplication) -> CGFloat? {
        guard let tree = try? root.snapshot() else { return nil }
        let frame = target.element.frame
        let rect = target.visible
        let kinds: Set<XCUIElement.ElementType> = [.staticText, .button, .textField, .searchField, .image,
                                                  .segmentedControl, .navigationBar]
        var bottom: CGFloat?
        func visit(_ node: XCUIElementSnapshot) {
            if [.scrollView, .collectionView, .table].contains(node.elementType),
               abs(node.frame.minY - frame.minY) < 1, abs(node.frame.height - frame.height) < 1,
               abs(node.frame.minX - frame.minX) < 1 { return }   // the content: not an overlay
            if kinds.contains(node.elementType), node.frame.height > 0, node.frame.height < 120,
               node.frame.intersects(rect), node.frame.minY >= rect.minY - 1,
               node.frame.maxY <= rect.minY + rect.height * 0.45 {
                bottom = max(bottom ?? node.frame.maxY, node.frame.maxY)
            }
            node.children.forEach(visit)
        }
        visit(tree)
        return bottom
    }

    /// The sidebar's on-screen frame in a regular-width layout (UIKit names its list "Sidebar" on the
    /// iPad and the Mac alike), nil on the iPhone or while the sidebar is collapsed.
    @MainActor
    private func sidebarFrame(in root: XCUIApplication, window: CGRect) -> CGRect? {
        let sidebar = root.collectionViews.matching(NSPredicate(format: "identifier == 'Sidebar' OR label == 'Sidebar'")).firstMatch
        guard sidebar.exists else { return nil }
        let visible = sidebar.frame.intersection(window)
        guard !visible.isNull, visible.width > 40, visible.width < window.width * 0.6 else { return nil }
        return visible
    }

    /// Mac: which way a positive scroll-wheel delta moves the content. Unknown until one scroll did
    /// nothing; snapMorePages flips it once (run 3, 13 Oct 2026).
    /// +1 since run 11: every Mac scroll that moved the page was a negative deltaY for "content up".
    private var macWheelSign: CGFloat = 1

    /// dy < 0 scrolls the content up (finger moves up), dx < 0 scrolls it left. Distances are fractions
    /// of the VISIBLE part of the target, and every point is inside it.
    @MainActor
    private func drag(_ target: ScrollTarget, dx: CGFloat, dy: CGFloat, inMiddle: Bool = false) {
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
        // A vertical scroll turns the wheel in the left gutter, as the touch drags do: in the middle it landed
        // on an inner view (the Legal document's PDF preview) and scrolled that instead of the page, so the
        // Title, Notes and Versions below were never shot (run 17, T-2).
        at(dx == 0 ? rect.minX + 12 : rect.midX, rect.midY).scroll(byDeltaX: macWheelSign * dx * rect.width,
                                                                 deltaY: macWheelSign * dy * rect.height)
        #else
        // Vertical drags run down the left gutter (6 pt in), beside the cards and rows rather than on
        // them: a drag starting on a row could open it (run 5, leaderboard → a profile).
        let gutter = inMiddle ? rect.midX : rect.minX + 6
        let x0: CGFloat = dx == 0 ? gutter : rect.midX - dx * rect.width / 2
        let x1: CGFloat = dx == 0 ? gutter : rect.midX + dx * rect.width / 2
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
    static func call(_ address: String, method: String, body: [String: String]?,
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

/// The run-time values of the dashboard screens, looked up once per test process with the QA account (the
/// same sign-in and sign-out as LegalLookup; GET /api/projects and the projects' month only). `outlet` /
/// `socmed` = the project named "ZZ QA Manager Outlet" / "ZZ QA Social Media Report" (else the first "ZZ QA"
/// project of type OUTLET_SALES / SOCIAL_MEDIA_REPORT) unless overridden; `outletDay` = a day other than today
/// (the newest night waiting for its report, else reported, else with its own daily target); `socmedDay` = the newest date up to today with figures.
/// Each from this month, else the month before. A missing value has its reason in `problems`.
enum DashboardLookup {
    struct Found {
        var values: [String: String] = [:]
        var problems: [String: String] = [:]
    }

    nonisolated(unsafe) private static var cached: Found?

    private struct Kind {
        let key: String, type: String, name: String, api: String
    }

    private static let kinds = [
        Kind(key: "outlet", type: "OUTLET_SALES", name: "ZZ QA Manager Outlet", api: "outlet-sales"),
        Kind(key: "socmed", type: "SOCIAL_MEDIA_REPORT", name: "ZZ QA Social Media Report", api: "social-media"),
    ]

    static func values(base: String, email: String, password: String, overrides: [String: String?]) -> Found {
        if let cached { return cached }
        var f = Found()
        defer { cached = f }
        let call = LegalLookup.call
        guard let login = call(base + "/api/auth/app-login", "POST", ["email": email, "password": password], nil),
              login.status == 200,
              let token = login.json["token"] as? String, let name = login.json["cookieName"] as? String else {
            for k in ["outlet", "outletDay", "socmed", "socmedDay"] { f.problems[k] = "dashboard lookup: QA sign-in over the API failed" }
            return f
        }
        let cookie = "\(name)=\(token)"
        defer { _ = call(base + "/api/auth/app-logout", "POST", nil, cookie) }

        var projects: [[String: Any]]?
        for kind in kinds {
            let dayKey = kind.key + "Day"
            var id = overrides[kind.key] ?? nil
            if id == nil {
                if projects == nil {
                    projects = callList(base + "/api/projects", cookie: cookie)
                }
                let list = projects ?? []
                let named = list.first { ($0["name"] as? String) == kind.name && ($0["type"] as? String) == kind.type }
                let typed = list.first { ($0["type"] as? String) == kind.type && (($0["name"] as? String) ?? "").hasPrefix("ZZ QA") }
                id = (named ?? typed)?["id"] as? String
            }
            guard let id else {
                let why = projects == nil ? "projects not readable by the QA account"
                    : "no \(kind.type) project \"\(kind.name)\" for the QA account"
                f.problems[kind.key] = why
                f.problems[dayKey] = why
                continue
            }
            f.values[kind.key] = id
            let enc = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
            var month: String?
            for _ in 0..<2 where f.values[dayKey] == nil {
                guard let r = call(base + "/api/projects/\(enc)/\(kind.api)" + (month.map { "?month=\($0)" } ?? ""), "GET", nil, cookie),
                      r.status == 200 else {
                    f.problems[dayKey] = "\(kind.api) not readable by the QA account"
                    break
                }
                f.values[dayKey] = kind.key == "outlet" ? outletDay(r.json) : socmedDay(r.json)
                month = monthBefore(r.json["month"] as? String ?? "")
                if month == nil { break }
            }
            if f.values[dayKey] == nil, f.problems[dayKey] == nil {
                f.problems[dayKey] = kind.key == "outlet" ? "no reported night or daily target this month or last"
                    : "no day with figures this month or last"
            }
        }
        return f
    }

    /// GET /api/projects answers a bare array (older shape: `{ projects: [...] }`).
    private static func callList(_ address: String, cookie: String) -> [[String: Any]]? {
        guard let url = URL(string: address) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: [[String: Any]]?
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        let session = URLSession(configuration: config)
        session.dataTask(with: request) { data, response, _ in
            if (response as? HTTPURLResponse)?.statusCode == 200, let data,
               let any = try? JSONSerialization.jsonObject(with: data) {
                result = (any as? [[String: Any]]) ?? ((any as? [String: Any])?["projects"] as? [[String: Any]])
            }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 35)
        session.finishTasksAndInvalidate()
        return result
    }

    /// A day other than today: the calendar opens with today picked and its panel already on screen, so a
    /// shot of today was the outlet-calendar shot again (run 14, P-T1 / N-10). The newest night still
    /// waiting for its report, else the newest reported one, else a day with its own target, else any
    /// event day; never today.
    private static func outletDay(_ json: [String: Any]) -> String? {
        var today = String((json["today"] as? String ?? "").prefix(10))
        if today.isEmpty {
            // An older server without `today`: the WIB calendar day, as the app's.
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "Asia/Jakarta")
            f.dateFormat = "yyyy-MM-dd"
            today = f.string(from: Date())
        }
        let events = (json["events"] as? [[String: Any]]) ?? []
        func dates(_ status: String?) -> [String] {
            events.filter { status == nil || ($0["status"] as? String) == status }
                .compactMap { ($0["date"] as? String).map { String($0.prefix(10)) } }
                .filter { $0 != today }
        }
        let targets = ((json["dayTargets"] as? [[String: Any]]) ?? [])
            .compactMap { ($0["date"] as? String).map { String($0.prefix(10)) } }.filter { $0 != today }
        for list in [dates("WAITING_REPORT"), dates("REPORTED"), targets, dates(nil)] where !list.isEmpty {
            return list.max()
        }
        return nil
    }

    private static func socmedDay(_ json: [String: Any]) -> String? {
        let today = json["today"] as? String ?? "9999-12-31"
        let days = (json["days"] as? [[String: Any]]) ?? []
        return days.filter { day in
            guard let date = day["date"] as? String, date <= today else { return false }
            let platforms = (day["platforms"] as? [String: Any])?.values.compactMap { $0 as? [String: Any] } ?? []
            return platforms.contains { p in
                ["views", "likes", "comments", "shares", "posts"].contains { ((p[$0] as? NSNumber)?.doubleValue ?? 0) > 0 }
            }
        }.compactMap { $0["date"] as? String }.max()
    }

    /// "YYYY-MM" of the month before, nil for anything else.
    private static func monthBefore(_ month: String) -> String? {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return parts[1] == 1 ? String(format: "%04d-12", parts[0] - 1) : String(format: "%04d-%02d", parts[0], parts[1] - 1)
    }
}
