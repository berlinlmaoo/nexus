import XCTest
import UIKit

/// Targeted DEV acceptance tour. Uses the normal account, navigation and field controls.
/// Credentials are supplied only through the test runner environment, as in NEXUSUITour.
final class PipelineV8Tour: XCTestCase {
    private var boardId: String { env["PIPELINE_V8_BOARD_ID"] ?? "" }
    private var boardName: String { env["PIPELINE_V8_BOARD_NAME"] ?? "QA Pipeline" }
    private var dealId: String { env["PIPELINE_V8_DEAL_ID"] ?? "" }
    private var emptyDealId: String { env["PIPELINE_V8_EMPTY_ID"] ?? "" }
    private var managerBoardId: String { boardId }
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testAllTableLayout() throws {
        try signIn(email: "qa5@dev.invalid")
        launch(step: "screen", route: "nexus://projects/" + boardId)
        ready()
        XCTAssertTrue(element("pipeline.switcher").waitForExistence(timeout: 30))
        launch(step: "screen", route: "nexus://projects")
        ready()
        tap("pipeline.all.entry")
        XCTAssertTrue(element("pipeline.filter.company").waitForExistence(timeout: 30))
        tap("pipeline.filter.company")
        tapLabel(boardName)
        selectMode("Table", "Tabel")
        shot("13-all-table")
        captureRemainingTableColumns()
    }

    @MainActor
    func testDirectBoardSwitcher() throws {
        try signIn(email: "qa5@dev.invalid")
        // A fresh process enters the board without Projects first loading the directory.
        launch(step: "screen", route: "nexus://projects/" + boardId)
        ready()
        XCTAssertTrue(element("pipeline.switcher").waitForExistence(timeout: 30))
        tap("pipeline.switcher")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", boardName)).firstMatch.exists)
        XCTAssertTrue(element("pipeline.switch.all").exists)
    }

    @MainActor
    func testBoD() throws {
        try signIn(email: "qa5@dev.invalid")
        launch(step: "screen", route: "nexus://projects")
        ready()
        let allEntry = element("pipeline.all.entry")
        XCTAssertTrue(allEntry.waitForExistence(timeout: 30))
        shot("01-projects-pinned-row")
        allEntry.tap()
        XCTAssertTrue(element("pipeline.filter.company").waitForExistence(timeout: 30))
        selectMode("Board", "Board")
        shot("01b-projects-entry-all")

        launch(step: "screen", route: "nexus://projects/" + boardId)
        ready()
        XCTAssertTrue(element("pipeline.switcher").waitForExistence(timeout: 30))
        selectMode("Board", "Board")
        openFestival()
        shot("02-drawer-top")
        tapLabel(localized("History", "Riwayat"))
        pause(1.5)
        shot("19a-item-history")
        tapLabel(localized("Details", "Detail"))
        reveal("pipeline.barter.value")
        shot("03a-barter")
        reveal("pipeline.cashback.section")
        XCTAssertEqual(app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "pipeline.cashback.name.")).count, 2)
        shot("03b-cashback")
        cancelItemDeletion("Delete recipient", "Hapus penerima", shot: "03c-recipient-delete-confirmation")
        reveal("pipeline.contacts.section")
        shot("04-contacts")
        let role = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "pipeline.contacts.role.")).firstMatch
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "pipeline.contacts.role.")).count, 2)
        XCTAssertTrue(role.exists && role.isHittable, "Visible contact role picker")
        role.tap()
        shot("04b-contact-roles")
        tapLabel(localized("Client", "Klien"))
        cancelItemDeletion("Delete contact", "Hapus kontak", shot: "04c-contact-delete-confirmation")
        reveal("pipeline.budgets.section")
        XCTAssertEqual(app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "pipeline.budgets.name.")).count, 2)
        shot("05-budget")
        // The QA fixture deliberately has one overspent and one under-budget category.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Over by Rp 6.000.000", "Lebih Rp 6.000.000")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Remaining Rp 5.000.000", "Sisa Rp 5.000.000")).firstMatch.exists)
        cancelItemDeletion("Delete category", "Hapus kategori", shot: "05b-category-delete-confirmation")
        let categoryId = "pipeline.costs.category.c_venue"
        reveal(categoryId)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "pipeline.costs.category.")).count, 3)
        shot("06a-realcost-category")
        tap(categoryId)
        shot("06b-category-picker")
        dismissPopover()
        reveal("pipeline.documents.section")
        shot("06c-documents")
        reveal("pipeline.documents.type")
        tap("pipeline.documents.type")
        shot("06d-document-types")
        tapLabel(localized("SPK (Work Order)", "SPK"))
        closeDeal()

        tap("pipeline.presentation")
        XCTAssertEqual(element("pipeline.presentation").value as? String, localized("On", "Nyala"))
        openFestival()
        tapLabel(localized("History", "Riwayat"))
        pause(1.5)
        shot("19b-presenting-item-history")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Rp 25.000.000")).firstMatch.exists)
        tapLabel(localized("Details", "Detail"))
        reveal("pipeline.barter.value")
        shot("07a-presenting-barter")
        XCTAssertFalse(app.textFields.matching(NSPredicate(format: "label IN %@", ["Barter value", "Nilai barter"])).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label == %@", "Rp 5.000.000")).firstMatch.exists)
        XCTAssertFalse(element("pipeline.cashback.section").exists)
        XCTAssertFalse(element("pipeline.budgets.section").exists)
        reveal("pipeline.contacts.section")
        shot("07b-presenting-contacts")
        XCTAssertFalse(element(categoryId).exists)
        closeDeal()

        tap("pipeline.switcher")
        shot("08-board-switcher")
        tap("pipeline.switch.all")
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
        shot("09-confirm-show-all-companies")
        let cancel = app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Batal"])).firstMatch
        cancel.tap()
        XCTAssertFalse(app.alerts.firstMatch.exists)
        tap("pipeline.switcher")
        tap("pipeline.switch.all")
        app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Show all companies", "Tampilkan semua perusahaan"])).firstMatch.tap()
        XCTAssertTrue(element("pipeline.filter.company").waitForExistence(timeout: 30))
        pause(2)
        shot("10-all-pipelines-presenting")
        XCTAssertEqual(element("pipeline.presentation").value as? String, localized("On", "Nyala"))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label IN %@", ["New deal", "Deal baru", "Add your first deal", "Tambah deal pertama"])).firstMatch.exists)
        tap("pipeline.presentation")
        shot("11-all-pipelines-board")
        tap("pipeline.filter.company")
        shot("12a-company-filter")
        tapLabel(boardName)
        pause(2)
        tap("pipeline.filter.year")
        shot("12b-year-filter")
        tapLabel("2027")
        pause(2)
        shot("12c-company-year-filtered")
        XCTAssertFalse(element("pipeline.deal." + dealId).exists)
        tap("pipeline.filter.year")
        tapLabel(localized("All years", "Semua tahun"))
        pause(2)
        selectMode("Table", "Tabel")
        shot("13-all-table")
        captureRemainingTableColumns()
        selectMode("Health", "Kesehatan")
        shot("13b-all-health")
        selectMode("Board", "Board")
        openFestival()
        shot("14-deal-from-all-company-label")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", boardName)).firstMatch.exists)
        tap("pipeline.deal.backToAll")
        tap("pipeline.switcher")
        shot("14b-switcher-from-all")
        let boardChoice = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", boardName))
            .allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(boardChoice, "Visible company board choice")
        boardChoice?.tap()
        pause(2)
        XCTAssertFalse(element("pipeline.filter.company").exists)
        XCTAssertTrue(element("pipeline.filter.year").waitForExistence(timeout: 30))
        tap("pipeline.filter.year")
        tapLabel("2027")
        pause(2)
        shot("15-board-year-2027")
        XCTAssertFalse(element("pipeline.deal." + dealId).exists)
        tap("pipeline.presentation")
        tap("pipeline.board.back")
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
        shot("15b-confirm-return-to-all")
        app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Batal"])).firstMatch.tap()
        XCTAssertFalse(element("pipeline.filter.company").exists)
        tap("pipeline.board.back")
        app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Show all companies", "Tampilkan semua perusahaan"])).firstMatch.tap()
        XCTAssertTrue(element("pipeline.filter.company").waitForExistence(timeout: 20))
        XCTAssertEqual(element("pipeline.presentation").value as? String, localized("On", "Nyala"))
    }

    @MainActor
    func testEmptyStates() throws {
        try signIn(email: "qa5@dev.invalid")
        launch(step: "screen", route: "nexus://projects/" + boardId)
        ready()
        selectMode("Table", "Tabel")
        tap("pipeline.deal." + emptyDealId)
        XCTAssertTrue(element("pipeline.deal.scroll").waitForExistence(timeout: 20))
        reveal("pipeline.cashback.section")
        shot("16-empty-cashback-open-deal")
        // Open/lost deals preserve the existing folded Contract-through-Closing group.
        reveal("pipeline.deal.later")
        tap("pipeline.deal.later")
        reveal("pipeline.contacts.section")
        shot("17-empty-contacts")
        reveal("pipeline.budgets.section")
        shot("18-empty-budget")
    }

    @MainActor
    func testManager() throws {
        try signIn(email: "qa2@dev.invalid")
        launch(step: "screen", route: "nexus://projects")
        ready()
        pause(3)
        XCTAssertFalse(element("pipeline.all.entry").exists)
        shot("20-manager-projects")
        launch(step: "screen", route: "nexus://projects/" + managerBoardId)
        ready()
        XCTAssertTrue(element("pipeline.presentation").waitForExistence(timeout: 30))
        XCTAssertFalse(element("pipeline.switcher").exists)
        selectMode("Board", "Board")
        shot("21-manager-board-plain-title")
    }

    @MainActor
    private func signIn(email: String) throws {
        app = XCUIApplication()
        guard !boardId.isEmpty, !dealId.isEmpty, !emptyDealId.isEmpty else { throw XCTSkip("Supply isolated DEV fixture IDs with pipeline-v8-tour.sh") }
        guard let password = env["TOUR_PASSWORD"], !password.isEmpty else { throw XCTSkip("TOUR_PASSWORD is required") }
        launch(step: "signout")
        XCTAssertTrue(marker("signed-out", timeout: 45))
        launch(step: "login", extra: ["NEXUS_TOUR_EMAIL": email, "NEXUS_TOUR_PASSWORD": password])
        XCTAssertTrue(marker("login-ok", timeout: 90), "QA sign-in failed")
    }

    @MainActor
    private func launch(step: String, route: String? = nil, extra: [String: String] = [:]) {
        if app.state != .notRunning { app.terminate() }
        app.launchArguments = ["-nexusTour", "1", "-nexusServer", "dev", "-nexusTourStep", step,
                               "-nexusTourScreen", "pipeline-v8", "-nexus.language", env["TOUR_LANG"] ?? "en", "-nexus.theme", "light"]
        if let route { app.launchArguments += ["-nexusTourRoute", route] }
        app.launchEnvironment = extra
        app.launch()
    }

    @MainActor
    private func ready() { XCTAssertTrue(marker("ready:", timeout: 60), element("nexus.tour.marker").label); pause(2) }

    @MainActor
    private func marker(_ prefix: String, timeout: TimeInterval) -> Bool {
        let value = element("nexus.tour.marker")
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if value.exists && value.label.hasPrefix(prefix) { return true }
            pause(0.5)
        } while Date() < deadline
        return false
    }

    @MainActor
    private func openFestival() {
        let card = element("pipeline.deal." + dealId)
        if !card.exists || !card.isHittable {
            let stageDot = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", localized("Won – In Execution,", "Won — Eksekusi,"))).firstMatch
            if stageDot.exists { stageDot.tap(); pause(0.7) }
            else {
                let board = element("pipeline.board.scroll")
                for _ in 0..<7 where !card.isHittable { board.swipeLeft() }
            }
        }
        XCTAssertTrue(card.waitForExistence(timeout: 20))
        if !card.isHittable {
            let panes = app.scrollViews.allElementsBoundByIndex.filter {
                let frame = $0.frame
                return $0.identifier != "pipeline.board.scroll" && frame.height > 150
                    && frame.minX <= card.frame.midX && frame.maxX >= card.frame.midX && $0.isHittable
            }
            if let column = panes.min(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
                for _ in 0..<8 where !card.isHittable { column.swipeUp(velocity: 500) }
            }
        }
        XCTAssertTrue(card.isHittable, "Fixture card is outside the visible board column")
        card.tap()
        XCTAssertTrue(element("pipeline.deal.scroll").waitForExistence(timeout: 20))
        pause(1)
    }

    @MainActor
    private func closeDeal() {
        let button = app.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["Done", "Selesai"])).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
        pause(1)
    }

    @MainActor
    private func element(_ identifier: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: identifier).firstMatch }

    @MainActor
    private func tap(_ identifier: String) {
        let target = element(identifier)
        XCTAssertTrue(target.waitForExistence(timeout: 20), identifier)
        target.tap()
        pause(0.6)
    }

    @MainActor
    private func tapLabel(_ label: String) {
        let target = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 15), label)
        target.tap()
        pause(0.6)
    }

    @MainActor
    private func selectMode(_ en: String, _ id: String) {
        let button = app.segmentedControls.buttons.matching(NSPredicate(format: "label == %@", localized(en, id))).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 20))
        button.tap()
        pause(0.6)
        XCTAssertTrue(button.isSelected, "Selected pipeline mode: " + en)
    }

    @MainActor
    private func captureRemainingTableColumns() {
        guard UIDevice.current.userInterfaceIdiom == .pad else { return }
        let scroll = element("pipeline.table.scroll")
        scroll.swipeLeft(velocity: 500)
        scroll.swipeLeft(velocity: 500)
        pause(0.6)
        let health = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["HEALTH", "KESEHATAN"])).firstMatch
        XCTAssertTrue(health.isHittable)
        XCTAssertLessThanOrEqual(health.frame.maxX, app.frame.maxX - 8, "Complete trailing table column is visible")
        shot("13c-table-right-columns")
        scroll.swipeRight(velocity: 500)
        scroll.swipeRight(velocity: 500)
    }

    @MainActor
    private func cancelItemDeletion(_ en: String, _ id: String, shot name: String) {
        let button = app.buttons.matching(NSPredicate(format: "label == %@", localized(en, id)))
            .allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(button, "Visible delete action for " + en)
        button?.tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
        shot(name)
        app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Batal"])).firstMatch.tap()
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    @MainActor
    private func reveal(_ identifier: String) {
        let target = element(identifier)
        let scroll = element("pipeline.deal.scroll")
        let navigationBottom = app.navigationBars.allElementsBoundByIndex
            .filter { $0.isHittable }.map { $0.frame.maxY }.max() ?? scroll.frame.minY + 72
        let visibleTop = max(scroll.frame.minY, navigationBottom)
        let visibleBottom = scroll.frame.maxY - 100
        let desiredTop = visibleTop + 80
        var useRightGutter = false
        for _ in 0..<18 {
            if target.exists && target.frame.height > 0 {
                let delta = target.frame.minY - desiredTop
                if target.frame.minY >= visibleTop + 16 && target.frame.minY <= desiredTop + 160
                    && target.frame.maxY < visibleBottom { pause(0.3); return }
                let distance = min(max(abs(delta), 60), (visibleBottom - visibleTop) * 0.45)
                let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
                    dx: useRightGutter ? scroll.frame.maxX - 6 : scroll.frame.minX + 6,
                    dy: delta > 0 ? visibleBottom - 40 : visibleTop + 60))
                let end = start.withOffset(CGVector(dx: 0, dy: delta > 0 ? -distance : distance))
                let before = target.frame.minY
                let wasInRightGutter = useRightGutter
                start.press(forDuration: 0.1, thenDragTo: end, withVelocity: XCUIGestureVelocity(rawValue: 100), thenHoldForDuration: 0.8)
                pause(0.5)
                if abs(target.frame.minY - before) < 2 {
                    // The final section cannot be aligned near the top once the scroll reaches its end.
                    if wasInRightGutter && target.frame.minY > visibleTop + 16
                        && target.frame.maxY < visibleBottom { return }
                    useRightGutter = true
                }
            } else {
                scroll.swipeUp(velocity: 500)
            }
        }
        shot("failure-reveal-" + identifier)
        XCTFail("Could not reveal " + identifier)
    }

    @MainActor
    private func dismissPopover() {
        // Re-selecting the current category closes the menu without changing the fixture.
        let current = app.buttons.matching(NSPredicate(format: "label == %@", "Venue")).firstMatch
        if current.exists { current.tap() }
        else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.15)).tap() }
        pause(0.5)
    }

    private func localized(_ en: String, _ id: String) -> String { env["TOUR_LANG"] == "id" ? id : en }

    @MainActor
    private func shot(_ name: String) {
        let deadline = Date().addingTimeInterval(20)
        var quietSince: Date?
        repeat {
            let busy = app.activityIndicators.allElementsBoundByIndex.contains { $0.isHittable }
            if busy { quietSince = nil }
            else if let quietSince, Date().timeIntervalSince(quietSince) > 0.5 { break }
            else if quietSince == nil { quietSince = Date() }
            pause(0.3)
        } while Date() < deadline
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "pipeline-v8-" + name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = env["TOUR_OUT_DIR"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent(name + ".png"))
            try? Data(app.debugDescription.utf8).write(to: URL(fileURLWithPath: folder).appendingPathComponent(name + ".txt"))
        }
    }

    private func pause(_ seconds: TimeInterval) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
}

private extension XCUIElement {
    @MainActor func tapIfPresent() { if exists && isHittable { tap() } }
}
