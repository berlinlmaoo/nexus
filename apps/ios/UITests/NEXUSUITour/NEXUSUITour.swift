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
        /// The same for the web in Safari.
        let webTaps: [String]?
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
        return nil
    }

    /// The labels of one `appTaps` / `webTaps` step: "?Add|Tambah" → ["Add", "Tambah"].
    private static func labels(_ step: String) -> [String] {
        let names = (step.hasPrefix("?") ? String(step.dropFirst()) : step).split(separator: "|").map(String.init)
        return names.isEmpty ? [step] : names
    }

    /// The app's button with one of a step's labels (a menu item is a button too).
    @MainActor
    private func appButton(_ step: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN %@", Self.labels(step))).firstMatch
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
        element.click()
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
        #if targetEnvironment(macCatalyst)
        // The scroll wheel puts the pointer on a row, and its hover highlight alone made "page 2" differ
        // from page 1 while nothing had scrolled, so the wrong wheel direction was never caught (run 11,
        // Legal archive). The pointer goes there first, and the reference picture is taken with it.
        if !web {
            target.element.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: target.visible.midX - target.element.frame.minX,
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
        // Not the Dashboard: it ends in "board" but has no columns to swipe to.
        if (id.hasSuffix("board") && id != "dashboard") || id.hasSuffix("table") || id.hasSuffix("timeline") {
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
        var scrolled = false
        #endif
        while page < maxPages {
            drag(target, dx: 0, dy: -0.5)
            if navigatedAway() { break }
            if !web { _ = waitForSpinnersToStop(timeout: 4) }
            let shot = takeShot(root)
            let data = shot.pngRepresentation
            #if targetEnvironment(macCatalyst)
            // First scroll changed nothing: maybe the wheel goes the other way on this Mac. Once.
            // (Not `page == 1`: a board's sideways shot already made it 2, and the flip never came.)
            if data == last && !scrolled && !flipped {
                flipped = true
                macWheelSign = -macWheelSign
                continue
            }
            #endif
            if data == last { break }
            // Moved, but by less than about a sixth of the view: the end of the scroll, or nothing moved at
            // all and only a clock or a hover changed. That picture is mostly the page before again (UI tour
            // run 13, F-08 / M-27; run 15, R15-I-20 / T-1 / T-2: a 28–60 pt scroll and a pixel-identical page
            // were still kept, because exact pixel rows never matched and the check gave up).
            if let shift = contentShift(from: last, to: data, in: target.visible, window: root.windows.firstMatch.frame),
               shift < minPageShift {
                #if targetEnvironment(macCatalyst)
                if shift == 0 && !scrolled && !flipped {
                    flipped = true
                    macWheelSign = -macWheelSign
                    continue
                }
                #endif
                break
            }
            #if targetEnvironment(macCatalyst)
            scrolled = true
            #endif
            last = data
            page += 1
            attachShot(shot, "\(prefix)\(id)-\(page)")
        }
        return page - 1
    }

    /// The least a page must have moved (fraction of the scrolled view's visible height) to be kept. A drag
    /// asks for half; the last page of a list often moves less, and its new rows still count (run 15: the
    /// leaderboard's last page moved ~0.19 and held the bottom of the ranking).
    private var minPageShift: CGFloat { CGFloat(Double(env["TOUR_MIN_PAGE_SHIFT"] ?? "") ?? 0.15) }

    /// How far the content inside `rect` (screen points) moved up between two screenshots, as a fraction of
    /// the rect's height: 0 = the same rows, 0.5 = half a view. nil when no shift explains the new picture
    /// (a different screen, a sheet that opened): then it counts as a new page.
    ///
    /// The rect is cut into vertical strips, each matched on its own, and the largest shift wins: a column
    /// that does not scroll (the Settings section list, a sticky Name column) shares every pixel row with
    /// the column that does, so whole rows never matched at any shift (run 15).
    private func contentShift(from old: Data, to new: Data, in rect: CGRect, window: CGRect) -> CGFloat? {
        guard let a = stripHashes(old, rect: rect, window: window),
              let b = stripHashes(new, rect: rect, window: window), a.count == b.count else { return nil }
        var moved: CGFloat?
        for (sa, sb) in zip(a, b) {
            guard sa.count == sb.count, sa.count > 40 else { continue }
            let h = sa.count
            var best = (shift: -1, match: 0.0)
            for s in 0..<(h * 3 / 4) {
                let n = h - s
                var same = 0
                for i in 0..<n where sb[i] == sa[i + s] { same += 1 }
                let match = Double(same) / Double(n)
                if match > best.match + 0.01 { best = (s, match) }
                if match > 0.97 { break }
            }
            guard best.shift >= 0, best.match >= 0.6 else { continue }
            moved = max(moved ?? 0, CGFloat(best.shift) / CGFloat(h))
        }
        return moved
    }

    /// For each of 4 vertical strips of `rect`, one hash per pixel row (every other row) in a PNG screenshot
    /// (the picture is of `window`, or of the whole screen when its size says so). A row hashes the mean
    /// colour of 24 blocks, coarsened to 16 levels: a sub-point scroll re-rasterises text a little, and
    /// exact pixels then never matched (run 15: pixel-identical pages differed in 0.1% of their pixels).
    private func stripHashes(_ png: Data, rect: CGRect, window: CGRect) -> [[UInt64]]? {
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
            var out: [UInt64] = []
            out.reserveCapacity((y1 - y0) / 2)
            for y in stride(from: y0, to: y1, by: 2) {
                var hash: UInt64 = 0xcbf29ce484222325
                for block in 0..<blocks {
                    let start = x0 + (strip * blocks + block) * blockWidth
                    var sum = 0
                    for x in start..<(start + blockWidth) {
                        let i = y * bytesPerRow + x * 4
                        sum += Int(pixels[i]) + Int(pixels[i + 1]) + Int(pixels[i + 2])
                    }
                    hash = (hash ^ UInt64((sum / (blockWidth * 3)) >> 4)) &* 0x100000001b3
                }
                out.append(hash)
            }
            return out
        }
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
    ///
    /// iPad / Mac: never the sidebar, and only the part of the page BESIDE it. Run 11, 14 Oct 2026: the
    /// iPad's page scroll view spans the whole window, under the floating sidebar, so the drags down its
    /// left gutter (6 pt in) landed on the sidebar list; pages 2–6 of the dashboard, attendance, Legal
    /// and most other screens scrolled the sidebar and showed the same page.
    @MainActor
    private func scrollTarget(in root: XCUIApplication, web: Bool) -> ScrollTarget? {
        let screen = root.windows.firstMatch.frame
        var window = screen
        if web {
            let page = root.webViews.firstMatch
            guard page.exists else { return nil }
            return ScrollTarget(element: page, visible: page.frame.intersection(window))
        }
        let sidebar = sidebarFrame(in: root, window: window)
        if let sidebar, sidebar.maxX < window.maxX - 80 {
            window = CGRect(x: sidebar.maxX, y: window.minY, width: window.maxX - sidebar.maxX, height: window.height)
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
                let area = visible.width * visible.height * (isViewport ? 1 : 0.5)
                if area > bestArea { best = ScrollTarget(element: element, visible: visible); bestArea = area }
            }
        }
        return best
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
