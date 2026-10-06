import SwiftUI

/// The Calendar (master calendar, owner 5 Oct 2026; replaces Team Calendar in 0.1.7): every task with
/// a due date in the company, a dot per Bagan division on the month, the day split by division or by
/// person, and a week "People" view. iPhone: one vertical scroll (header, grid, day). iPad / Mac: the
/// grid beside a day list, like Messages, whenever the window is wide enough for both. Rules:
/// Shared/CalendarCore.swift (identical to the web and Android, checked by Tests/CalendarGolden); who
/// sees what is decided by the server.
struct CalendarView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    @State private var structure: CalStructure?
    /// The Bagan indexed once per structure, not on every read.
    @State private var ix = CalIndex(units: [], people: [])
    @State private var items: CalItemsResponse?
    @State private var overdue: CalOverdueResponse?
    /// Bumped whenever `ix`, `items` or `overdue` is replaced; `memo` recomputes by them.
    @State private var ixRev = 0
    @State private var itemsRev = 0
    @State private var overdueRev = 0
    @State private var memo = CalendarDerived()
    @State private var loading = true
    /// A load the person can see is in flight: a month they moved to, Try again, pull to refresh.
    /// Background refreshes (the poll, coming back to the app) never set it.
    @State private var fetching = false
    /// ⌘R: asked for, so the grid may show it is working even though its month is loaded.
    @State private var reloading = false
    /// Bumped by every items load; only the newest one settles `fetching`.
    @State private var loadGen = 0
    /// Which Calendar on screen claims a date from a link (a pushed copy must not).
    @State private var instance = UUID()
    @State private var error: String?
    /// The range ("from|to") whose items failed to load: the reason belongs to that month only.
    @State private var errorKey: String?
    @State private var savedAt: Date?
    @State private var selected: String = CalDays.wibToday()
    @State private var mode: Mode = .month
    @State private var focusId: String?
    @State private var sheet: CalSheet?
    /// The task a row opened on this Calendar's own stack (see CalPush).
    @State private var pushedTask: CalPush?
    @State private var now = Date()
    @State private var active = true
    /// The width this screen was given, measured in 8 pt steps: it, not the size class alone, decides
    /// the panes.
    @State private var layoutWidth: CGFloat?
    /// Bumped to bring the picked day's list into view on iPhone; `revealedDay` is the last one done.
    @State private var revealDay = 0
    @State private var revealedDay = 0
    /// How the next of those scrolls (see `Reveal`).
    @State private var revealKind: Reveal = .day
    @State private var railOpen = false
    /// The first appearance has been dealt with. Coming back from a task this Calendar opened is an
    /// appearance too, and must not scroll anything.
    @State private var appeared = false
    /// "My division" was asked for (a widget, a link, the setting kept from before) by someone without
    /// a card in the Bagan, and the Calendar shows Mine instead; the header says why until the scope
    /// is changed.
    @State private var divisionFellBack = false
    @AccessibilityFocusState private var dayHeaderFocused: Bool
    /// Where VoiceOver goes when the element it was on disappears under it: the chip that focused the
    /// calendar on a division, a filter chip that was removed (impeccable re-audit, 7 Oct 2026).
    @AccessibilityFocusState private var a11yTarget: A11yTarget?
    @AppStorage("nexus.calendar.lens") private var lensRaw = "division"
    @AppStorage("nexus.calendar.filters") private var filtersJSON = ""
    @AppStorage("nexus.calendar.collapsed") private var collapsedJSON = "[]"
    /// The day panel beside the grid holds the text people read, so it widens with their text size
    /// (the grid itself stops growing at AX1). 320 pt at the default size.
    @ScaledMetric(relativeTo: .body) private var panelScaled: CGFloat = 320

    enum Mode: Hashable { case month, people }

    /// What a row opens on the Calendar's own stack: the full task screen when the task can be edited
    /// through its home project, the read-only preview otherwise. Both are pushed, so identical rows
    /// open the same way; the preview used to rise as a sheet while its neighbour slid in, and only the
    /// tap told which one a row was (impeccable re-audit, 7 Oct 2026).
    enum CalPush: Hashable {
        case edit(id: String)
        case read(id: String, project: String?)

        var taskId: String {
            switch self {
            case .edit(let id): return id
            case .read(let id, _): return id
            }
        }
    }

    /// The one sheet of this screen (one `.sheet(item:)` per view — two make buttons dead). The task
    /// preview is a sheet only for a masked row: there is nothing to read, only why.
    enum CalSheet: Identifiable {
        case filters
        case preview(taskId: String, project: String?, notMember: Bool, masked: Bool)
        var id: String {
            switch self {
            case .filters: return "filters"
            case .preview(let id, _, _, _): return "preview-\(id)"
            }
        }
    }

    /// A filter shown as a removable chip under the header.
    private enum ChipFilter: CaseIterable { case units, people, projects, priorities, hideDone, overdueOnly }

    /// VoiceOver's landing places when the legend or the filter chips change under it.
    private enum A11yTarget: Hashable {
        /// The breadcrumb's last item: the division the calendar is focused on now.
        case crumb
        /// A legend chip, by unit.
        case unitChip(String)
        /// An active filter's chip.
        case filterChip(ChipFilter)
        /// The Filters button in the bar.
        case filtersButton
    }

    /// `day`: the day's heading to the top of the screen (a day picked on the grid, a link). `peek`:
    /// only far enough for the heading and its first tasks to show, with most of the month still above
    /// them (Today). `opening`: the same as the Calendar opens, at once rather than animated — it
    /// happens while the screen slides in, and a scroll on top of that would be motion for nothing.
    private enum Reveal { case day, peek, opening }

    /// Why an empty day is empty, and the one button that undoes it.
    private struct EmptyCopy {
        let icon: String
        let title: String
        let subtitle: String
        let actionTitle: String?
        let action: (() -> Void)?
    }

    private static let dayAnchor = "calendar.day"
    /// The day's heading row (the peek scrolls to it).
    private static let headAnchor = "calendar.day.head"
    /// The top of the day panel beside the grid.
    private static let panelTop = "calendar.panel.top"
    /// Where the peek leaves the day's heading: two fifths of the way down the screen.
    private static let peekPoint = UnitPoint(x: 0.5, y: 0.4)

    // MARK: Derived

    private var uid: String { auth.session?.userId ?? "anon" }
    private var today: String { CalDays.wibToday(now) }
    private var focus: String { (focusId.flatMap { ix.byId[$0] != nil ? $0 : nil }) ?? ix.top?.id ?? "" }
    /// The division the calendar is focused on, when it is not the whole chart.
    private var focusUnit: CalUnit? {
        guard let top = ix.top, focus != top.id else { return nil }
        return ix.byId[focus]
    }
    private var windowDays: Int { items?.rules?.overdueWindowDays ?? 14 }
    private var myHomes: [String] { structure?.me?.homeUnitIds ?? [] }
    private var access: String? { structure?.access ?? items?.access }
    private var range: (from: String, to: String) { CalDays.gridRange(selected) }
    private var rangeKey: String { "\(range.from)|\(range.to)" }
    /// The tasks on screen belong to the month on screen. Not so while another month is on its way
    /// (a silent load keeps the last one up) or after it failed — and "No tasks" would then be a
    /// confident wrong answer about a month nobody has seen yet.
    private var rangeLoaded: Bool { items?.from == range.from && items?.to == range.to }
    /// The month on screen failed to load, and nobody is trying it again right now.
    private var failedHere: Bool { error != nil && errorKey == rangeKey }
    private var month: String { String(selected.prefix(7)) }

    /// What a size-class swap carries over to the Calendar the other shape builds (AppRouter).
    private var carry: CalendarCarry {
        CalendarCarry(day: selected, people: mode == .people, focusId: focusId, taskId: pushedTask?.taskId)
    }

    // MARK: Layout

    /// The measured width, or a stand-in from the size class for the frame before it is measured.
    private var width: CGFloat { layoutWidth ?? (hSize == .regular ? 1024 : 390) }
    /// The day panel beside the grid: 320 / 360 pt at the default text size, wider at larger ones, at
    /// most 45% of the window. It used to stay 320 / 360 at every size, so the text people read was
    /// squeezed into a column narrower than any iPhone while the capped grid took the rest (impeccable
    /// re-audit, 7 Oct 2026).
    private var panelWidth: CGFloat {
        let base: CGFloat = width >= 900 ? 360 : 320
        let grown = max(base, base * panelScaled / 320)
        return min(grown, (width * 0.45).rounded(.down))
    }
    /// The grid beside the day list only when both fit. A regular size class alone is also a
    /// half-screen Mac window or a Stage Manager tile, where the side-by-side grid shrank to 18–26 pt
    /// cells with day numbers over their counts (impeccable audit, 6 Oct 2026); below 760 pt — or when
    /// a panel widened for large text would leave the grid under 56 pt a column — the screen stacks
    /// like the phone, the layout that works at every width.
    private var twoPane: Bool {
        guard hSize == .regular, mode == .month, width >= 760 else { return false }
        let column: CGFloat = (width - panelWidth - 41) / 7
        return column >= 56
    }
    /// What the header and the month grid get across (the pane's padding taken off).
    private var gridWidth: CGFloat { twoPane ? width - panelWidth - 1 - 40 : width - 32 }
    /// The tall cell (count, four dots, holiday name) needs about 56 pt a column.
    private var wideCells: Bool { hSize == .regular && gridWidth / 7 >= 56 }
    /// The People week as a table (a 180 pt name column and seven days) only where it has room.
    private var peopleTable: Bool { hSize == .regular && width >= 820 }
    /// Month / People and Everyone / Mine / My division side by side as two switches.
    private var headerWide: Bool { gridWidth >= 560 }

    // MARK: Derived once per change (see CalendarDerived)

    private var filters: CalFilters {
        if memo.filtersJSON != filtersJSON {
            memo.filters = (try? JSONDecoder().decode(CalFilters.self, from: Data(filtersJSON.utf8))) ?? CalFilters()
            memo.filtersJSON = filtersJSON
        }
        return memo.filters
    }
    private var filtersBinding: Binding<CalFilters> {
        Binding(get: { filters }, set: { new in
            filtersJSON = (try? String(data: JSONEncoder().encode(new), encoding: .utf8)) ?? ""
        })
    }
    private var collapsed: Set<String> {
        if memo.collapsedJSON != collapsedJSON {
            memo.collapsed = Set((try? JSONDecoder().decode([String].self, from: Data(collapsedJSON.utf8))) ?? [])
            memo.collapsedJSON = collapsedJSON
        }
        return memo.collapsed
    }
    private var lensByPerson: Bool { lensRaw == "person" }

    private var people: CalPeople {
        let key = "\(itemsRev)|\(overdueRev)|\(ixRev)"
        if let hit = memo.people, memo.peopleKey == key { return hit }
        var extra = overdue?.people ?? [:]
        for (k, v) in items?.people ?? [:] { extra[k] = v }
        let fresh = CalPeople(ix: ix, extra: extra)
        memo.people = fresh
        memo.peopleKey = key
        return fresh
    }

    private var context: CalFilterContext {
        CalFilterContext(ix: ix, meId: structure?.me?.userId, myHomes: myHomes, today: today, now: now, windowDays: windowDays)
    }

    /// Everything `visible` depends on.
    private var visibleKey: String {
        "\(itemsRev)|\(ixRev)|\(filtersJSON)|\(focus)|\(today)|\(now.timeIntervalSince1970)|\(windowDays)|\(structure?.me?.userId ?? "")|\(myHomes.joined(separator: ","))"
    }

    private var visible: [CalItem] {
        let key = visibleKey
        if memo.visibleKey != key {
            let shown = CalendarCore.underFocus(CalendarCore.filterItems(items?.items ?? [], filters, context), ix, focus: focus)
            memo.visible = shown
            memo.byDay = CalendarCore.byDay(shown)
            memo.visibleKey = key
        }
        return memo.visible
    }

    private var visibleByDay: [String: [CalItem]] {
        _ = visible
        return memo.byDay
    }

    /// One cell per grid day. None for a month that has not arrived: dots from the neighbouring
    /// month's overlap would pass for this month's.
    private func monthCells(_ days: [String]) -> [String: CalDayCell] {
        guard rangeLoaded else { return [:] }
        let key = "\(visibleKey)|\(month)"
        if memo.cellsKey != key {
            let byDay = visibleByDay
            var cells: [String: CalDayCell] = [:]
            for d in days { cells[d] = CalendarCore.dayCell(d, byDay[d] ?? [], ix, focus: focus, today: today, now: now, windowDays: windowDays) }
            memo.cells = cells
            memo.cellsKey = key
        }
        return memo.cells
    }

    // The rest used to be worked out in body on every pass — a day tap, a poll tick, every frame of a
    // Mac window being resized (impeccable re-audit, 7 Oct 2026). Each is now kept until one of the
    // things it is made from changes, like `visible` above.

    /// The 42 days of the month on screen.
    private var monthDays: [String] {
        if memo.monthDaysKey != month {
            memo.monthDays = CalDays.monthGrid(selected)
            memo.monthDaysKey = month
        }
        return memo.monthDays
    }

    /// The loaded range's holidays by day, and whether anything at all is due in the month on screen.
    private var monthFacts: (holidays: [String: String], hasTasks: Bool) {
        let key = "\(itemsRev)|\(month)"
        if memo.factsKey != key {
            memo.holidays = Dictionary((items?.holidays ?? []).map { ($0.day, $0.name) }, uniquingKeysWith: { a, _ in a })
            memo.monthHasTasks = (items?.items ?? []).contains { $0.day.hasPrefix(month) }
            memo.factsKey = key
        }
        return (memo.holidays, memo.monthHasTasks)
    }

    /// The legend's chips for the month on screen, at the focus level. None for a month that has not
    /// arrived (the overlap with the last one is partial).
    private var legendEntries: [CalLegendEntry] {
        guard rangeLoaded else { return [] }
        let key = "\(visibleKey)|\(month)"
        if memo.legendKey != key {
            let shown = visible.filter { $0.day.hasPrefix(month) }
            memo.legend = CalendarCore.legend(shown, ix, focus: focus)
            memo.monthVisibleCount = shown.count
            memo.legendKey = key
        }
        return memo.legend
    }

    /// Unique tasks shown in the month on screen (after the scope, the filters and the focus).
    private var monthVisibleCount: Int {
        _ = legendEntries
        return memo.monthVisibleCount
    }

    /// The selected day's tree.
    private var dayTree: CalDayTree {
        let key = "\(visibleKey)|\(selected)"
        if memo.treeKey != key {
            memo.tree = CalendarCore.dayTree(visibleByDay[selected] ?? [], ix, focus: focus, today: today, now: now, windowDays: windowDays)
            memo.treeKey = key
        }
        return memo.tree
    }

    /// Today's overdue rail (empty on any other day).
    private var railItems: [CalItem] {
        guard selected == today else { return [] }
        let key = "\(visibleKey)|\(overdueRev)"
        if memo.railKey != key {
            let shown = CalendarCore.underFocus(CalendarCore.filterItems(overdue?.items ?? [], filters, context), ix, focus: focus)
            memo.rail = CalendarCore.overdueRail(shown, todays: visibleByDay[today] ?? [], today: today, now: now, windowDays: windowDays)
            memo.railKey = key
        }
        return memo.rail
    }

    /// The People week of the selected day.
    private var weekRows: [CalWeekRow] {
        let monday = CalDays.mondayOf(selected)
        let key = "\(visibleKey)|\(monday)"
        if memo.weekKey != key {
            memo.weekRows = CalendarCore.weekRows(visible, ix, focus: focus, monday: monday, today: today, now: now, windowDays: windowDays)
            memo.weekKey = key
        }
        return memo.weekRows
    }

    /// The viewer's cards and everything below them; `mineOrAbove` adds every card above them, so a
    /// section reads "You" when it holds one of them.
    private var mineUnits: Set<String> {
        updateMine()
        return memo.mine
    }
    private var mineOrAbove: Set<String> {
        updateMine()
        return memo.mineOrAbove
    }
    private func updateMine() {
        let key = "\(ixRev)|\(myHomes.joined(separator: ","))"
        guard memo.mineKey != key else { return }
        let mine = ix.subtree(myHomes)
        var above = mine
        for home in myHomes { above.formUnion(ix.ancestors(home)) }
        memo.mine = mine
        memo.mineOrAbove = above
        memo.mineKey = key
    }

    // MARK: Body

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
                .background {
                    GeometryReader { g in
                        Color.clear.onChange(of: g.size.width, initial: true) { _, w in
                            // In 8 pt steps: a Mac or Stage Manager window being dragged used to rebuild
                            // the whole screen on every frame of the drag (impeccable re-audit, 7 Oct
                            // 2026), and only the 760 / 820 / 900 pt and 56 pt-a-column steps matter.
                            let stepped = (w / 8).rounded(.down) * 8
                            if layoutWidth != stepped { layoutWidth = stepped }
                        }
                    }
                }
        }
        .navigationTitle(T("Calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .background { shortcuts }
        .publishesCalendarMenu(menuActions)
        .task { await firstLoad() }
        .task(id: rangeKey) { await loadItems(silent: items != nil) }
        .task { await pollLoop() }
        .onChange(of: scenePhase) { _, phase in
            active = phase == .active
            if phase == .active { now = Date(); Task { await backgroundRefresh() } }
        }
        .onAppear { appear() }
        // Covered by the task it opened, this Calendar is still the one a link should land on.
        .onDisappear {
            if router.calendarOnScreen == instance, pushedTask == nil {
                router.calendarOnScreen = nil
                router.calendarLeftAt = Date()
            }
        }
        .onChange(of: router.calendarDate) { _, _ in if router.calendarOnScreen == instance { claimRouterDate() } }
        .onChange(of: router.calendarTaskId) { _, _ in if router.calendarOnScreen == instance { claimRouterTask() } }
        .onChange(of: router.calendarScope) { _, _ in if router.calendarOnScreen == instance { claimRouterScope() } }
        .onChange(of: today) { old, new in if selected == old { selected = new } }
        .onChange(of: carry) { _, state in if router.calendarOnScreen == instance { router.calendarState = state } }
        // A size-class swap that left its carry after this Calendar had already appeared.
        .onChange(of: router.calendarCarryAt) { _, _ in if router.calendarOnScreen == instance { _ = claimCarry() } }
        .sheet(item: $sheet) { s in
            switch s {
            case .filters:
                CalFilterSheet(filters: filtersBinding, ix: ix, items: items?.items ?? [], people: people, myHomes: myHomes)
            case let .preview(id, project, notMember, masked):
                CalTaskPreview(taskId: id, projectName: project, notMember: notMember, masked: masked)
            }
        }
        .navigationDestination(item: $pushedTask) { push in
            Group {
                switch push {
                case .edit(let id):
                    TaskDetailView(taskId: id).id(id)
                case let .read(id, project):
                    CalTaskPreview(taskId: id, projectName: project, notMember: true, masked: false, pushed: true).id(id)
                }
            }
            // Gone some other way than Back (a tab switch, a deeper push): links stop landing here.
            .onDisappear {
                if pushedTask != nil, router.calendarOnScreen == instance {
                    router.calendarOnScreen = nil
                    router.calendarLeftAt = Date()
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if access == "none" {
            EmptyState(icon: "lock", title: T("This calendar is for members of the company"),
                       subtitle: T("You are in a personal workspace. Ask a BoD or Manager to add you to the company's workspace; the Calendar then shows the tasks of everyone there."))
        } else if access == "off" {
            EmptyState(icon: "calendar", title: T("The Calendar is on its way"),
                       subtitle: T("It opens for BoD and Managers first, then for everyone. Your own tasks are still in Tasks."))
        } else if loading && items == nil {
            // Shapes only, so VoiceOver found nothing but the title and Filters on a cold start: one
            // element that says what is happening (impeccable re-audit, 7 Oct 2026).
            ScrollView {
                SkeletonList(count: 6).padding(16)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(T("Loading…"))
            }
        } else if let error, items == nil || structure == nil {
            ErrorState(message: error, icon: "calendar") { Task { await refreshAll(silent: false) } }
        } else if twoPane {
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) { header; gridArea }
                        .padding(20)
                }
                .refreshable { await refreshAll(silent: true) }
                Divider().overlay(NX.border)
                ScrollViewReader { panel in
                    ScrollView {
                        dayPanel.padding(14).id(Self.panelTop)
                    }
                    .refreshable { await refreshAll(silent: true) }
                    // Another day starts at its heading. The panel used to keep the last day's scroll,
                    // so the new date, its count and its first divisions sat above the visible part
                    // (impeccable re-audit, 7 Oct 2026). At once, not animated: it is a new page.
                    .onChange(of: selected) { _, _ in panel.scrollTo(Self.panelTop, anchor: .top) }
                }
                .frame(width: panelWidth)
            }
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if mode == .month {
                            gridArea
                            dayPanel.id(Self.dayAnchor)
                        } else {
                            peopleArea
                        }
                    }
                    .padding(16)
                }
                .refreshable { await refreshAll(silent: true) }
                // A day picked on the grid changed a list below the fold, so the tap looked like it
                // did nothing (impeccable audit, 6 Oct 2026): bring the list up. A `.task` rather than
                // an onChange, so a link that picked the day before this scroll existed still lands.
                .task(id: revealDay) {
                    guard revealDay != revealedDay else { return }
                    revealedDay = revealDay
                    try? await Task.sleep(for: .milliseconds(60))
                    let target: String = revealKind == .day ? Self.dayAnchor : Self.headAnchor
                    let anchor: UnitPoint = revealKind == .day ? .top : Self.peekPoint
                    if reduceMotion || revealKind == .opening {
                        proxy.scrollTo(target, anchor: anchor)
                    } else {
                        withAnimation(.snappy(duration: 0.35)) { proxy.scrollTo(target, anchor: anchor) }
                    }
                }
            }
        }
    }

    // MARK: Header (month, view, scope, legend, filters)

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            monthRow
            switchRow
            if divisionFellBack { chartNote }
            legendRow
            if !chipFilters(filters).isEmpty { activeFilterRow }
            if let savedAt { OfflineNotice(savedAt: savedAt) }
        }
    }

    /// ‹ October 2026 › … Today. At accessibility text sizes Today drops below, so the title keeps
    /// the width it needs.
    @ViewBuilder private var monthRow: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) { stepButton(-1); monthTitle; stepButton(1) }
                if selected != today { todayButton }
            }
        } else {
            HStack(spacing: 0) {
                stepButton(-1)
                monthTitle.frame(minWidth: 130)
                stepButton(1)
                Spacer(minLength: 4)
                if selected != today { todayButton }
            }
        }
    }

    private var monthTitle: some View {
        Text(title).font(NXFont.display(CalType.size(17), .bold)).monospacedDigit().foregroundStyle(NX.foreground)
            .lineLimit(2).minimumScaleFactor(0.8)
            .accessibilityAddTraits(.isHeader)
    }

    /// The whole 44 pt square takes the tap, not only the glyph. On the Mac, a tooltip names it and its
    /// shortcut: there is no ⌘ overlay there.
    private func stepButton(_ n: Int) -> some View {
        let name = n < 0 ? (mode == .people ? T("Previous week") : T("Previous month"))
                         : (mode == .people ? T("Next week") : T("Next month"))
        return Button { step(n) } label: {
            Image(systemName: n < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(name)
        .macHelp(n < 0 ? "\(name) (⌘←)" : "\(name) (⌘→)")
    }

    /// The pill is drawn inside the button, and the button is 44 pt tall: its edge takes the tap too.
    /// On iPhone it also brings today's first tasks up under the month, as opening the Calendar does.
    private var todayButton: some View {
        Button {
            select(today)
            peek()
        } label: {
            Text(T("Today")).font(NXFont.text(CalType.size(13), .semibold))
                .padding(.horizontal, 14).frame(minHeight: 30)
                .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
    }

    private var title: String {
        if mode == .people {
            let monday = CalDays.mondayOf(selected)
            return "\(CalFormat.day(monday, "dMMM")) – \(CalFormat.day(CalDays.addDays(monday, 6), "dMMMyyyy"))"
        }
        return CalFormat.day(month + "-01", "MMMMyyyy")
    }

    /// Month / People, and whose tasks: on screen, one tap, the way the web header has it. "Mine"
    /// used to live only in the Filters sheet behind an unlabelled funnel (impeccable audit, 6 Oct
    /// 2026). Two switches where there is room; on a phone the scope is a menu beside the view switch,
    /// so the grid does not move further down. Whose tasks is a VIEW, like Month / People, not a
    /// filter: it is drawn like the view switch and never counts as one.
    @ViewBuilder private var switchRow: some View {
        if headerWide {
            HStack(spacing: 10) {
                modeSwitch.frame(maxWidth: 240)
                NXSegmented(selection: scopeBinding, options: scopeOptions, label: { scopeLabel($0) }, title: T("Show"))
                    .frame(maxWidth: 380)
                Spacer(minLength: 0)
            }
        } else if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                modeSwitch
                scopeMenu
            }
        } else {
            HStack(spacing: 8) {
                modeSwitch.frame(maxWidth: 320)
                scopeMenu.layoutPriority(1)
            }
        }
    }

    private var modeSwitch: some View {
        NXSegmented(selection: $mode, options: [Mode.month, .people], label: { $0 == .month ? T("Month") : T("People") }, title: T("View"))
    }

    /// The same neutral capsule whichever scope is on, like the view switch beside it. Its violet
    /// "on" look made Mine read as a filter at work (impeccable re-audit, 7 Oct 2026).
    private var scopeMenu: some View {
        let scope = filters.scope
        return Menu {
            Picker(T("Show"), selection: scopeBinding) {
                ForEach(scopeOptions, id: \.self) { s in
                    Label(scopeLabel(s), systemImage: scopeIcon(s)).tag(s)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: scopeIcon(scope)).font(.system(size: CalType.size(12), weight: .semibold))
                Text(scopeLabel(scope)).font(NXFont.text(CalType.size(13), .semibold)).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: CalType.size(10), weight: .semibold))
                    .foregroundStyle(NX.mutedFg)
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(NX.muted, in: Capsule(style: .continuous))
            .overlay(Capsule(style: .continuous).strokeBorder(NX.border.opacity(0.6)))
            .contentShape(Capsule(style: .continuous))
        }
        .fixedSize()
        .accessibilityLabel(T("Show"))
        .accessibilityValue(scopeLabel(scope))
    }

    /// Why Mine is on when "My division" was asked for.
    private var chartNote: some View {
        Label(T("You are not in the chart yet, so \"My division\" is off."), systemImage: "info.circle")
            .font(NXFont.text(CalType.size(12)))
            .foregroundStyle(NX.mutedFg)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// "My division" only for someone placed in the chart (or already set to it).
    private var scopeOptions: [CalScope] {
        myHomes.isEmpty && filters.scope != .division ? [.all, .me] : [.all, .me, .division]
    }

    private func scopeLabel(_ s: CalScope) -> String {
        s == .all ? T("Everyone") : s == .me ? T("Mine") : T("My division")
    }

    private func scopeIcon(_ s: CalScope) -> String {
        s == .all ? "person.3" : s == .me ? "person" : "person.2"
    }

    private var scopeBinding: Binding<CalScope> {
        Binding(get: { filters.scope }, set: { s in setScope(s) })
    }

    /// Whose tasks, changed by the person (the switch, an empty state's "Show everyone").
    private func setScope(_ s: CalScope) {
        divisionFellBack = false
        guard s != filters.scope else { return }
        var f = filters
        f.scope = s
        filtersBinding.wrappedValue = f
    }

    private func showEveryone() { setScope(.all) }

    /// The focus path, then one chip per unit at the focus level (tap = focus the calendar on it, or
    /// filter by a unit with nothing below it). The two kinds look different: the focus mark where the
    /// tap narrows the calendar to that division, a check where a filter is on.
    private var legendRow: some View {
        let entries = legendEntries
        let picked = Set(filters.units)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if let top = ix.top, focus != top.id {
                    let path = Array(ix.ancestors(focus).reversed()) + [focus]
                    ForEach(Array(path.enumerated()), id: \.offset) { i, id in
                        if i > 0 {
                            Image(systemName: "chevron.right").font(.system(size: CalType.size(9), weight: .bold)).foregroundStyle(NX.mutedFg)
                                .accessibilityHidden(true)
                        }
                        let name = i == 0 ? T("All divisions") : (ix.byId[id]?.name ?? "")
                        if i == path.count - 1 {
                            // Where you are: plain text, a marker. It used to be the violet capsule of
                            // the filter chips and the banner buttons, and was tapped as one.
                            Text(name).font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(NX.foreground)
                                .lineLimit(1)
                                .padding(.horizontal, 6)
                                .frame(minHeight: 44)
                                .accessibilityValue(rangeLoaded ? CalFormat.tasks(monthVisibleCount) : "")
                                .accessibilityAddTraits(.isSelected)
                                .accessibilityFocused($a11yTarget, equals: .crumb)
                        } else {
                            let child = path[i + 1]
                            Button { climb(to: id, from: child, top: top.id) } label: {
                                Text(name).font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(NX.mutedFg)
                                    .padding(.horizontal, 8)
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                ForEach(entries, id: \.unitId) { e in
                    legendChip(e, on: picked.contains(e.unitId))
                }
            }
        }
    }

    private func legendChip(_ e: CalLegendEntry, on: Bool) -> some View {
        let unit = ix.byId[e.unitId]
        let focusable = unit != nil && e.unitId != focus && !(ix.children[e.unitId] ?? []).isEmpty
        let name = e.unitId == "other" ? T("Other") : (unit?.name ?? "")
        let count = CalFormat.tasks(e.count)
        let spoken = focusable ? "\(String(format: T("Focus on %@"), name)), \(count)" : "\(name), \(count)"
        let hint = focusable ? "" : String(format: T("Filter by %@"), name)
        return Button {
            if focusable {
                focusId = e.unitId
                // The chip VoiceOver was on is gone (the legend is now the division's own cards):
                // land on the breadcrumb, which names the division and its count.
                moveVoiceOver(to: .crumb)
            } else {
                var f = filters
                if let i = f.units.firstIndex(of: e.unitId) { f.units.remove(at: i) } else { f.units.append(e.unitId) }
                filtersBinding.wrappedValue = f
            }
        } label: {
            HStack(spacing: 6) {
                Circle().fill(calUnitColor(unit)).frame(width: 8, height: 8)
                Text(name).font(NXFont.text(CalType.size(12), .semibold)).lineLimit(1)
                Text("\(e.count)").font(NXFont.text(CalType.size(12))).monospacedDigit().foregroundStyle(NX.mutedFg)
                if on {
                    Image(systemName: "checkmark").font(.system(size: CalType.size(10), weight: .bold)).foregroundStyle(NX.violetText)
                }
                if focusable {
                    // The focus mark, as on the web and Android: this name narrows the calendar to
                    // that division; a name without it filters.
                    Image(systemName: "scope").font(.system(size: CalType.size(11), weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
            }
            .padding(.horizontal, 10).frame(minHeight: 30)
            // On: an outline and the check, not the filled capsule of the filter tokens and buttons.
            .background(NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? NX.violetText : NX.border, lineWidth: on ? 1.5 : 1))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(spoken)
        .accessibilityHint(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityFocused($a11yTarget, equals: .unitChip(e.unitId))
    }

    /// Back up the focus path (a breadcrumb). VoiceOver lands on the level it arrived at; at the top,
    /// where the breadcrumb goes away, on the chip of the division it came back from.
    private func climb(to id: String, from child: String, top: String) {
        let toTop = id == top
        focusId = toTop ? nil : id
        guard voiceOver else { return }
        if toTop {
            a11yTarget = nil
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                if legendEntries.contains(where: { $0.unitId == child }) {
                    a11yTarget = .unitChip(child)
                } else {
                    AccessibilityNotification.Announcement(T("All divisions")).post()
                }
            }
        } else {
            moveVoiceOver(to: .crumb)
        }
    }

    private func leaveFocus() { focusId = nil }

    /// VoiceOver onto `target` once the change that removed the element it was on has been drawn.
    private func moveVoiceOver(to target: A11yTarget) {
        guard voiceOver else { return }
        a11yTarget = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            a11yTarget = target
        }
    }

    // MARK: Active filters

    private func chipFilters(_ f: CalFilters) -> [ChipFilter] {
        ChipFilter.allCases.filter { c in
            switch c {
            case .units: return !f.units.isEmpty
            case .people: return !f.people.isEmpty
            case .projects: return !f.projects.isEmpty
            case .priorities: return !f.priorities.isEmpty
            case .hideDone: return f.hideDone
            case .overdueOnly: return f.overdueOnly
            }
        }
    }

    private func chipLabel(_ c: ChipFilter, _ f: CalFilters) -> String {
        switch c {
        case .units: return "\(T("Divisions")) · \(f.units.count)"
        case .people: return "\(T("People")) · \(f.people.count)"
        case .projects: return "\(T("Projects")) · \(f.projects.count)"
        case .priorities: return "\(T("Priority")) · \(f.priorities.count)"
        case .hideDone: return T("Hide done tasks")
        case .overdueOnly: return T("Only overdue")
        }
    }

    private func clearFilter(_ c: ChipFilter) {
        var f = filters
        switch c {
        case .units: f.units = []
        case .people: f.people = []
        case .projects: f.projects = []
        case .priorities: f.priorities = []
        case .hideDone: f.hideDone = false
        case .overdueOnly: f.overdueOnly = false
        }
        filtersBinding.wrappedValue = f
    }

    /// One filter off. VoiceOver moves to the chip that takes its place, or to Filters once none is
    /// left: the chip it was on is gone.
    private func removeFilter(_ c: ChipFilter, from shown: [ChipFilter]) {
        let rest = shown.filter { $0 != c }
        let at = shown.firstIndex(of: c) ?? 0
        withAnimation(.snappy(duration: 0.2)) { clearFilter(c) }
        let target: A11yTarget
        if rest.isEmpty {
            target = .filtersButton
        } else {
            target = .filterChip(rest[min(at, rest.count - 1)])
        }
        moveVoiceOver(to: target)
    }

    /// The filters at work, each with an ✕. A number on the funnel was all that said yesterday's
    /// "Only overdue" was still hiding everyone else's tasks today (impeccable audit, 6 Oct 2026).
    /// The scope is not here: it is a view, with its own switch above, and Reset leaves it alone.
    private var activeFilterRow: some View {
        let f = filters
        let shown = chipFilters(f)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(shown, id: \.self) { c in
                    let text = chipLabel(c, f)
                    Button { removeFilter(c, from: shown) } label: {
                        HStack(spacing: 5) {
                            Text(text).lineLimit(1)
                            Image(systemName: "xmark").font(.system(size: CalType.size(9), weight: .bold)).accessibilityHidden(true)
                        }
                        .font(NXFont.text(CalType.size(12), .semibold))
                        .foregroundStyle(NX.violetText)
                        .padding(.horizontal, 10).frame(minHeight: 30)
                        .background(NX.accentBg, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(text)
                    .accessibilityHint(T("Removes this filter"))
                    .accessibilityFocused($a11yTarget, equals: .filterChip(c))
                }
                if shown.count > 1 {
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { resetFilters() }
                        moveVoiceOver(to: .filtersButton)
                    } label: {
                        Text(T("Reset filters")).font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 8)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Month

    private var gridArea: some View {
        let loaded = rangeLoaded
        let days = monthDays
        let cells = monthCells(days)
        let facts = monthFacts
        let monthName = CalFormat.day(month + "-01", "MMMMyyyy")
        let shownThisMonth = loaded ? monthVisibleCount : 0
        // Only a load the person is waiting for dims the grid. The poll used to drop it to 60% for
        // every round trip, a blink a minute while someone was reading it.
        let dimmed = fetching && (!loaded || reloading)
        return VStack(alignment: .leading, spacing: 10) {
            // The banners speak about what is loaded, never about a request in flight, so a background
            // refresh cannot make them vanish and come back (moving the grid by their height).
            if !loaded {
                if failedHere {
                    banner(String(format: T("Couldn't load %@."), monthName), action: (T("Try again"), retryNow))
                }
            } else if !facts.hasTasks {
                let goAction: (String, () -> Void)? = month != String(today.prefix(7)) ? (T("Go to this month"), goToday) : nil
                banner(String(format: T("Nothing has a due date in %@ yet."), monthName), action: goAction)
            } else if shownThisMonth == 0 {
                emptyMonthBanner
            }
            CalMonthGrid(days: days, month: month, cells: cells, selected: selected, today: today, holidays: facts.holidays, ix: ix, wide: wideCells,
                         loaded: loaded) { select($0, reveal: true) }
                // Apple's Calendar month stops growing at the first accessibility size too: past it the
                // fixed-height cells overflow into the next week. The day list below scales fully.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .opacity(dimmed ? 0.6 : 1)
                .animation(.easeOut(duration: 0.15), value: dimmed)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 14) {
                    legendKey(filled: true, T("has tasks to do"))
                    legendKey(filled: false, T("done or no status"))
                    HStack(spacing: 5) { Capsule().fill(CalTone.overdue).frame(width: 14, height: 2); Text(T("overdue")) }
                }
                if !legendEntries.isEmpty {
                    Text(T("Dots follow the IP & Division Chart. A name with the focus icon focuses the calendar on that division; any other name filters it."))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg)
            if loaded, items?.truncated == true {
                banner(T("This month has more tasks than the calendar can show at once."), action: nil)
            }
        }
    }

    /// Nothing shown this month although something is due in it: said in the words of what narrows
    /// the calendar, with the one action that undoes it. The filters first, then the focus, then
    /// whose tasks — the scope used to be called a filter here, and Reset turned it off.
    @ViewBuilder private var emptyMonthBanner: some View {
        if filters.activeCount > 0 {
            banner(T("Nothing matches the filters this month."), action: (T("Reset filters"), resetFilters))
        } else if let unit = focusUnit {
            banner(String(format: T("Nothing in %@ this month."), unit.name), action: (T("All divisions"), leaveFocus))
        } else if filters.scope == .me {
            banner(T("You have nothing due this month."), action: (T("Show everyone"), showEveryone))
        } else if filters.scope == .division {
            banner(T("Nothing due in your division this month."), action: (T("Show everyone"), showEveryone))
        }
    }

    /// The key draws a neutral sample: the real dots are each division's own colour.
    private func legendKey(filled: Bool, _ text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(filled ? NX.mutedFg : Color.clear).overlay(Circle().strokeBorder(NX.mutedFg, lineWidth: 1.5)).frame(width: 7, height: 7)
            Text(text)
        }
    }

    /// The action is a system bordered button in the app's tint: it looked exactly like the filter
    /// tokens beside it (and like the breadcrumb), so "Go to this month" read as a filter (impeccable
    /// re-audit, 7 Oct 2026). The banner keeps its 44 pt height.
    private func banner(_ text: String, action: (String, () -> Void)?) -> some View {
        HStack(spacing: 8) {
            Text(text).font(NXFont.text(CalType.size(12.5))).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 0)
            if let action {
                Button(action.0, action: action.1)
                    .font(NXFont.text(CalType.size(12), .semibold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(NX.violetText)
                    .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, action == nil ? 10 : 2)
        .background(NX.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    // MARK: Day

    private var dayPanel: some View {
        let tree = dayTree
        let rail = railItems
        let ctx = CalRowContext(ix: ix, people: people, today: today, now: now, windowDays: windowDays, lensByPerson: lensByPerson, onOpen: openItem,
                                meId: structure?.me?.userId ?? auth.session?.userId)
        let mine = mineUnits
        let above = mineOrAbove
        let rel = CalDays.dayDiff(today, selected)
        let holiday = monthFacts.holidays[selected]
        let folded = collapsed
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                dayHeading(tree: tree, rel: rel, holiday: holiday)
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    dayStepButton(-1)
                    dayStepButton(1)
                }
            }
            .id(Self.headAnchor)
            NXSegmented(selection: Binding(get: { lensByPerson }, set: { lensRaw = $0 ? "person" : "division" }),
                        options: [false, true], label: { $0 ? T("By person") : T("By division") }, title: T("Group by"))
            if !rail.isEmpty { overdueRail(rail) }
            if tree.total == 0 && !rangeLoaded {
                notLoaded
            } else if tree.total == 0 {
                dayEmpty
            } else if let root = tree.root {
                VStack(spacing: 10) {
                    if !root.items.isEmpty || !root.people.isEmpty {
                        let key = "own:\(root.unit.id)"
                        CalSectionCard(node: root, own: true, mine: mine.contains(root.unit.id), collapsed: folded.contains(key), toggle: { toggleCollapse(key) }, ctx: ctx)
                    }
                    ForEach(root.children) { node in
                        CalSectionCard(node: node, own: false, mine: above.contains(node.unit.id), collapsed: folded.contains(node.unit.id), toggle: { toggleCollapse(node.unit.id) }, ctx: ctx)
                    }
                    if lensByPerson && !tree.unplaced.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(format: T("Not in the chart yet · %d"), tree.unplaced.count).uppercased()).calCaps()
                                .foregroundStyle(NX.mutedFg)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(viewerFirst(tree.unplaced), id: \.userId) { p in
                                CalPersonBlock(row: p, unitId: nil, ix: ix, people: people, today: today, now: now, windowDays: windowDays, onOpen: openItem)
                            }
                        }
                        .nexusCard(padding: 10, radius: 18)
                    }
                    if placementsShown(root) > tree.total {
                        Text(String(format: T("A task can show under several divisions. Total: %d unique tasks."), tree.total))
                            .font(NXFont.text(CalType.size(11.5))).foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
    }

    /// The viewer's own row first; everyone else keeps the order the rules gave them.
    private func viewerFirst(_ rows: [CalPersonRow]) -> [CalPersonRow] {
        guard let me = auth.session?.userId, let at = rows.firstIndex(where: { $0.userId == me }), at > 0 else { return rows }
        var out = rows
        out.insert(out.remove(at: at), at: 0)
        return out
    }

    /// An empty day, in the words of what narrows it.
    @ViewBuilder private var dayEmpty: some View {
        let copy = emptyDay
        EmptyState(icon: copy.icon, title: copy.title, subtitle: copy.subtitle, tint: CalTone.accentFill,
                   actionTitle: copy.actionTitle, actionIcon: nil, action: copy.action, compact: true)
    }

    /// The filters, the focus or whose tasks, and the button that undoes exactly that one. "Reset
    /// filters" used to answer all three, said a filter was hiding tasks while Mine was on, and threw
    /// Mine away (impeccable re-audit, 7 Oct 2026).
    private var emptyDay: EmptyCopy {
        if filters.activeCount > 0 {
            return EmptyCopy(icon: "line.3.horizontal.decrease.circle", title: T("Nothing matches the filters on this day"),
                             subtitle: T("Filters are hiding the rest. Reset them to see everything."),
                             actionTitle: T("Reset filters"), action: { resetFilters(); refocusDay() })
        }
        if let unit = focusUnit {
            return EmptyCopy(icon: "scope", title: String(format: T("Nothing in %@ on this day"), unit.name),
                             subtitle: T("Other divisions are outside the focus."),
                             actionTitle: T("All divisions"), action: { leaveFocus(); refocusDay() })
        }
        switch filters.scope {
        case .me:
            return EmptyCopy(icon: "person", title: T("You have nothing due on this day"),
                             subtitle: T("Only your own tasks are shown."),
                             actionTitle: T("Show everyone"), action: { showEveryone(); refocusDay() })
        case .division:
            return EmptyCopy(icon: "person.2", title: T("Nothing due in your division on this day"),
                             subtitle: T("Only your division's tasks are shown."),
                             actionTitle: T("Show everyone"), action: { showEveryone(); refocusDay() })
        case .all:
            let back: (() -> Void)? = selected != today ? goToday : nil
            return EmptyCopy(icon: "calendar", title: T("No tasks on this day"),
                             subtitle: monthFacts.hasTasks ? T("Nobody has a task due on this date.") : T("Nothing has a due date this month yet."),
                             actionTitle: selected != today ? T("Back to today") : nil, action: back)
        }
    }

    /// VoiceOver to the day's heading (which now says how many tasks there are) once the list behind
    /// an empty state's button has come back.
    private func refocusDay() {
        guard voiceOver else { return }
        dayHeaderFocused = false
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            dayHeaderFocused = true
        }
    }

    /// The date, TODAY / TOMORROW / YESTERDAY, the holiday and the count, as one VoiceOver heading.
    /// Picking a day on the grid moves VoiceOver here, instead of leaving the day's tasks some forty
    /// cells, keys and buttons further on.
    private func dayHeading(tree: CalDayTree, rel: Int, holiday: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(CalFormat.day(selected, "EEEEdMMMyyyy")).font(NXFont.display(CalType.size(16), .bold)).foregroundStyle(NX.foreground)
                if rel == 0 || rel == 1 || rel == -1 {
                    // The app's violet, as "today" is everywhere else (grid, widgets, Watch).
                    Text((rel == 0 ? T("Today") : rel == 1 ? T("Tomorrow") : T("Yesterday")).uppercased()).calCaps()
                        .foregroundStyle(NX.violetText)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 5))
                }
            }
            if let holiday { Text(holiday).font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(CalTone.overdue) }
            Text(tree.total > 0 ? "\(CalFormat.tasks(tree.total)) · \(CalFormat.people(tree.people))"
                 : !rangeLoaded ? (failedHere ? T("Couldn't load this") : T("Loading…"))
                 : T("No tasks"))
                .font(NXFont.text(CalType.size(12))).foregroundStyle(NX.mutedFg)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityFocused($dayHeaderFocused)
    }

    private func dayStepButton(_ n: Int) -> some View {
        let name = n < 0 ? T("Previous day") : T("Next day")
        return Button { select(CalDays.addDays(selected, n)) } label: {
            Image(systemName: n < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(name)
        .macHelp(n < 0 ? "\(name) (⌥←)" : "\(name) (⌥→)")
    }

    private func overdueRail(_ rail: [CalItem]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(format: T("Overdue · %d"), rail.count).uppercased()).calCaps()
                .foregroundStyle(CalTone.overdue)
                .padding(.horizontal, 10).padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
            ForEach(rail.prefix(railOpen ? rail.count : 2)) { item in
                CalItemRow(item: item, unitId: item.placements.first?.unitId, ix: ix, people: people, today: today, now: now, windowDays: windowDays,
                           trailingNote: CalFormat.day(item.day, "dMMM"), onOpen: openItem)
            }
            if rail.count > 2 {
                Button { railOpen.toggle() } label: {
                    Text(railOpen ? T("Show less") : T("Show all"))
                        .font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(CalTone.overdue)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(CalTone.overdue.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(CalTone.overdue.opacity(0.25)))
    }

    private func placementsShown(_ n: CalTreeNode) -> Int {
        n.items.count + n.children.reduce(0) { $0 + placementsShown($1) }
    }

    /// The month on screen has not arrived: loading, or the reason it failed and a way to try again.
    @ViewBuilder private var notLoaded: some View {
        if failedHere {
            ErrorState(message: error ?? "", icon: "calendar", retry: retryNow)
        } else {
            SkeletonList(count: 3)
        }
    }

    // MARK: People

    @ViewBuilder private var peopleArea: some View {
        if rangeLoaded {
            peopleWeek
        } else {
            notLoaded
        }
    }

    /// No `.id(monday)` any more: it threw the whole week away and built it again on every ‹ › step
    /// (impeccable re-audit, 7 Oct 2026). The rows are kept per week in `memo`.
    private var peopleWeek: some View {
        let monday = CalDays.mondayOf(selected)
        let days = (0..<7).map { CalDays.addDays(monday, $0) }
        let thisWeek: (() -> Void)? = days.contains(today) ? nil : goToday
        return CalPeopleWeek(rows: weekRows, days: days, today: today, now: now, windowDays: windowDays, ix: ix, people: people, wide: peopleTable,
                             onOpenDay: { d in mode = .month; lensRaw = "person"; select(d, reveal: true) }, onOpen: openItem,
                             filtered: filters.activeCount > 0, onResetFilters: resetFilters, onThisWeek: thisWeek,
                             focusName: focusUnit?.name, onAllDivisions: leaveFocus, scope: filters.scope, onShowEveryone: showEveryone)
    }

    // MARK: Toolbar and keyboard

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if !twoPane && mode == .month {
            ToolbarItem(placement: .principal) { barTitle }
        }
        ToolbarItem(placement: .topBarTrailing) {
            // Filters only: whose tasks (Everyone / Mine / My division) is a view and has no say in
            // the count.
            let count = filters.activeCount
            Button { sheet = .filters } label: {
                HStack(spacing: 3) {
                    Image(systemName: count > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    if count > 0 {
                        Text("\(count)")
                            .font(NXFont.text(CalType.size(11), .bold)).monospacedDigit()
                            .foregroundStyle(NX.violetText)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(NX.accentBg, in: Capsule())
                    }
                }
            }
            .accessibilityLabel(count > 0 ? "\(T("Filters")) (\(count))" : T("Filters"))
            .accessibilityFocused($a11yTarget, equals: .filtersButton)
            .keyboardShortcut("f", modifiers: .command)
            .macHelp("\(T("Filters")) (⌘F)")
        }
    }

    /// One scroll on iPhone: once the list has carried the grid and the day's heading away, the bar
    /// still says which day this is.
    private var barTitle: some View {
        VStack(spacing: 0) {
            Text(T("Calendar")).font(.system(size: CalType.size(17), weight: .bold)).foregroundStyle(NX.foreground)
            Text(CalFormat.day(selected, "EEEdMMM")).font(NXFont.text(CalType.size(11), .medium)).foregroundStyle(NX.mutedFg)
        }
        .lineLimit(1)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// iPad / Mac keyboard: ⌘T today, ⌘←/⌘→ month (week in People), ⌥←/⌥→ day, ⌘1/⌘2 lens, ⌘R reload.
    /// Hidden buttons, so they show in the ⌘ overlay without crowding the toolbar. The Mac has no
    /// overlay: there the same commands are a Calendar menu in the menu bar (CalendarMenuCommands).
    private var shortcuts: some View {
        Group {
            Button(T("Today")) { select(today) }.keyboardShortcut("t", modifiers: .command)
            Button(mode == .people ? T("Previous week") : T("Previous month")) { step(-1) }.keyboardShortcut(.leftArrow, modifiers: .command)
            Button(mode == .people ? T("Next week") : T("Next month")) { step(1) }.keyboardShortcut(.rightArrow, modifiers: .command)
            Button(T("Previous day")) { select(CalDays.addDays(selected, -1)) }.keyboardShortcut(.leftArrow, modifiers: .option)
            Button(T("Next day")) { select(CalDays.addDays(selected, 1)) }.keyboardShortcut(.rightArrow, modifiers: .option)
            Button(T("By division")) { lensRaw = "division" }.keyboardShortcut("1", modifiers: .command)
            Button(T("By person")) { lensRaw = "person" }.keyboardShortcut("2", modifiers: .command)
            Button(T("Reload")) { reloadNow() }.keyboardShortcut("r", modifiers: .command)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    /// The Mac menu bar's handle on this Calendar. Off while a task or a sheet covers it, so the
    /// arrows are not taken from a text field up there.
    private var menuActions: CalendarMenuActions {
        CalendarMenuActions(
            enabled: pushedTask == nil && sheet == nil,
            people: mode == .people,
            today: { select(today) },
            step: { n in step(n) },
            stepDay: { n in select(CalDays.addDays(selected, n)) },
            lens: { byPerson in lensRaw = byPerson ? "person" : "division" },
            reload: { reloadNow() },
            filters: { sheet = .filters })
    }

    // MARK: Actions

    /// `reveal`: the day was picked on the grid (or by a link, or from the People week), so its list is
    /// what the person wants next — on iPhone it sits below the fold, so scroll to it, and VoiceOver
    /// moves to its heading in either layout. Arrows and shortcuts keep focus where it is (they are
    /// pressed again and again) and only say which day it is now.
    private func select(_ day: String, reveal: Bool = false) {
        let changed = day != selected
        withAnimation(.snappy(duration: 0.2)) { selected = day }
        if reveal && !twoPane && mode == .month {
            revealKind = .day
            revealDay += 1
        }
        guard voiceOver else { return }
        if reveal {
            dayHeaderFocused = true
        } else if changed {
            announce(day)
        }
    }

    /// On iPhone, today's heading and its first tasks into view with most of the month still above
    /// them. Opening the Calendar used to show no task at all at the default text size: the header,
    /// the month and its key filled the screen (impeccable re-audit, 7 Oct 2026).
    private func peek(opening: Bool = false) {
        guard !twoPane, mode == .month else { return }
        revealKind = opening ? .opening : .peek
        revealDay += 1
    }

    private func announce(_ day: String) {
        var parts = [CalFormat.day(day, "EEEEdMMMM")]
        // A count only for a month that is loaded: about one still on its way it would be a guess.
        if items?.from == CalDays.gridRange(day).from { parts.append(CalFormat.tasks(visibleByDay[day]?.count ?? 0)) }
        AccessibilityNotification.Announcement(parts.joined(separator: ", ")).post()
    }

    private func goToday() { select(today) }
    private func retryNow() { Task { await refreshAll(silent: true) } }
    private func reloadNow() {
        Task {
            reloading = true
            await refreshAll(silent: false)
            reloading = false
        }
    }
    /// Every filter off; whose tasks stays as it is (it is a view, not a filter).
    private func resetFilters() { filtersBinding.wrappedValue = filters.cleared() }

    private func step(_ n: Int) {
        select(mode == .people ? CalDays.addDays(selected, 7 * n) : CalDays.shiftMonth(selected, n))
    }

    private func toggleCollapse(_ key: String) {
        var set = collapsed
        if set.contains(key) { set.remove(key) } else { set.insert(key) }
        collapsedJSON = (try? String(data: JSONEncoder().encode(Array(set).sorted()), encoding: .utf8)) ?? "[]"
    }

    /// Editable through its home project → the full task screen; otherwise the read-only preview,
    /// pushed the same way (CalPush). A masked row opens the reason it cannot be read (a private
    /// project, members only) rather than ignoring the tap; nothing about the task is fetched.
    private func openItem(_ item: CalItem) {
        if item.masked {
            sheet = .preview(taskId: item.key, project: nil, notMember: true, masked: true)
            return
        }
        guard let id = item.taskId else { return }
        if item.canEdit && item.editProjectId == item.project?.id {
            pushedTask = .edit(id: id)
        } else {
            pushedTask = .read(id: id, project: item.project?.name)
        }
    }

    /// Every appearance: the links waiting for this Calendar. The first one also takes back the day a
    /// size-class swap left behind, or — opening on today — brings today's first tasks into view.
    private func appear() {
        router.calendarOnScreen = instance
        let first = !appeared
        appeared = true
        let carried = first && claimCarry()
        claimRouterDate()
        claimRouterTask()
        claimRouterScope()
        router.calendarState = carry
        if first && !carried && revealDay == 0 && mode == .month && selected == today { peek(opening: true) }
    }

    /// The window crossed the size class with a Calendar on screen, and the app was rebuilt in its
    /// other shape around this one: the day, Month or People, the focus and an open task come back as
    /// they were. They used to start over on today (impeccable re-audit, 7 Oct 2026). A carry nobody
    /// claimed within a few seconds is stale, and not applied to a Calendar opened later by hand.
    private func claimCarry() -> Bool {
        guard let c = router.calendarCarry else { return false }
        router.calendarCarry = nil
        guard let at = router.calendarCarryAt, Date().timeIntervalSince(at) < 5 else { return false }
        selected = c.day
        mode = c.people ? .people : .month
        focusId = c.focusId
        // Opened the way a widget's task opens (claimRouterTask, right after this).
        if let task = c.taskId, router.calendarTaskId == nil { router.calendarTaskId = task }
        return true
    }

    /// A calendar widget row (`nexus://calendar?…&task=<id>`) opens its task once, the way a row here
    /// would. Usually it is not in what is loaded yet (cold start, another month, an undated task), so
    /// the server says how it may be opened. Every outcome answers the tap: a task that is gone or
    /// cannot be reached opens the preview, which says which ("This task no longer exists", "Can't
    /// reach NEXUS right now" with Try again), and a masked one says it belongs to a private project.
    /// A failed lookup used to end in silence (impeccable re-audit, 7 Oct 2026).
    private func claimRouterTask() {
        guard let id = router.calendarTaskId else { return }
        router.calendarTaskId = nil
        // Whatever is open on top gives way first; the new one opens after the pop has finished — a
        // pop and a push in one update are not reliable in a NavigationStack.
        let covered = pushedTask != nil || sheet != nil
        pushedTask = nil
        sheet = nil
        let loaded = items?.items.first(where: { $0.taskId == id })
        Task { @MainActor in
            if covered { try? await Task.sleep(for: .milliseconds(450)) }
            if let loaded {
                openItem(loaded)
                return
            }
            let access: CalTaskAccess
            do {
                access = try await APIClient.shared.calendarTask(id: id)
            } catch APIError.unauthorized {
                auth.logout()
                return
            } catch {
                pushedTask = .read(id: id, project: nil)
                return
            }
            if access.masked {
                sheet = .preview(taskId: id, project: nil, notMember: true, masked: true)
            } else if access.found && access.canEdit && access.editProjectId == access.projectId {
                pushedTask = .edit(id: id)
            } else {
                pushedTask = .read(id: id, project: nil)
            }
        }
    }

    /// A link to /calendar?date=… (notification, deep link) picks the day once, and on iPhone brings
    /// its list into view.
    private func claimRouterDate() {
        guard let day = router.calendarDate else { return }
        router.calendarDate = nil
        // A day link while a task is open on top: back to the Calendar. When the link names a task as
        // well, claimRouterTask clears the cover itself and waits for the pop before opening.
        if router.calendarTaskId == nil {
            pushedTask = nil
            sheet = nil
        }
        if day.count == 10, CalDays.key(CalDays.date(day)) == day {
            mode = .month
            select(day, reveal: true)
        }
    }

    /// A widget link's `&scope=` becomes the Calendar's Show setting, once: the app opens on the same
    /// tasks the widget showed, and the switch in the header says so.
    private func claimRouterScope() {
        guard let raw = router.calendarScope else { return }
        router.calendarScope = nil
        guard var scope = CalScope(rawValue: raw) else { return }
        // "My division" for someone without a card in the Bagan would filter out every task: Mine, as
        // the widget itself draws it, with the note saying why. Only once the Bagan is in; before that
        // nobody has a card, and `setStructure` makes the same call when it arrives.
        var fellBack = false
        if scope == .division, structure != nil, myHomes.isEmpty {
            scope = .me
            fellBack = true
        }
        if scope != filters.scope {
            var f = filters
            f.scope = scope
            filtersBinding.wrappedValue = f
        }
        divisionFellBack = fellBack
    }

    // MARK: Loading

    private func firstLoad() async {
        if structure == nil, let hit = ResponseCache.decoded(APIClient.calStructureKey(uid), as: CalStructure.self) { setStructure(hit.value) }
        if items == nil, let hit = ResponseCache.decoded(APIClient.calItemsKey(uid, from: range.from, to: range.to), as: CalItemsResponse.self) {
            setItems(hit.value)
            loading = false
        }
        if overdue == nil, let hit = ResponseCache.decoded(APIClient.calOverdueKey(uid), as: CalOverdueResponse.self) { setOverdue(hit.value) }
        // The items of the month on screen are `.task(id: rangeKey)`'s job.
        await loadStructure()
        await loadOverdue()
    }

    /// Pull to refresh, Try again, ⌘R: everything, the Bagan included.
    private func refreshAll(silent: Bool) async {
        let id = uid
        async let freshOverdue = try? APIClient.shared.calendarOverdue(userId: id)
        await loadStructure()
        await loadItems(silent: silent)
        if let o = await freshOverdue { setOverdue(o) }
    }

    /// The poll and coming back to the app: the month and the overdue list, side by side, and nothing
    /// on screen moves until they are in. The Bagan only when the items say its version changed
    /// (`loadItems`), not three requests a minute.
    private func backgroundRefresh() async {
        if structure == nil { await loadStructure() }
        let id = uid
        async let freshOverdue = try? APIClient.shared.calendarOverdue(userId: id)
        await loadItems(silent: true, quiet: true)
        if let o = await freshOverdue { setOverdue(o) }
    }

    /// The structure and its index always change together — and only when the Bagan did: the same
    /// version is the same chart, so the index is not rebuilt for nothing.
    private func setStructure(_ s: CalStructure) {
        if let old = structure, old.version != nil, old.version == s.version, old.access == s.access, old.me == s.me { return }
        structure = s
        ix = CalIndex(units: s.units, people: s.people)
        ixRev += 1
        // "My division" kept from before (or from a link that came before the Bagan) for someone with
        // no card in it would hide every task: Mine instead, with the note under the switch.
        if filters.scope == .division, s.me?.homeUnitIds.isEmpty ?? true {
            var f = filters
            f.scope = .me
            filtersBinding.wrappedValue = f
            divisionFellBack = true
        }
    }

    /// A poll that found nothing new changes nothing: the same answer used to replace the month and
    /// redraw every row once a minute (impeccable re-audit, 7 Oct 2026). `now` is not compared — the
    /// server's clock moves on every answer.
    private func setItems(_ r: CalItemsResponse) {
        if let old = items, Self.sameItems(old, r) { return }
        items = r
        itemsRev += 1
    }

    private func setOverdue(_ r: CalOverdueResponse) {
        if let old = overdue, Self.sameOverdue(old, r) { return }
        overdue = r
        overdueRev += 1
    }

    private static func sameItems(_ a: CalItemsResponse, _ b: CalItemsResponse) -> Bool {
        guard a.v == b.v, a.from == b.from, a.to == b.to, a.today == b.today, a.access == b.access else { return false }
        guard a.structureVersion == b.structureVersion, a.rules == b.rules, a.truncated == b.truncated else { return false }
        guard a.holidays == b.holidays, a.people == b.people else { return false }
        return a.items == b.items
    }

    private static func sameOverdue(_ a: CalOverdueResponse, _ b: CalOverdueResponse) -> Bool {
        guard a.v == b.v, a.today == b.today, a.access == b.access, a.structureVersion == b.structureVersion else { return false }
        guard a.rules == b.rules, a.truncated == b.truncated, a.people == b.people else { return false }
        return a.items == b.items
    }

    private func loadStructure() async {
        do {
            setStructure(try await APIClient.shared.calendarStructure(userId: uid))
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            // No Bagan held at all = nothing can be grouped or placed: say so (as the web does).
            if structure == nil { self.error = error.localizedDescription }
        }
    }

    /// `quiet`: a background refresh. It shows nothing while in flight (no dimming, no skeleton, no
    /// banner going away and back) and only its answer changes the screen.
    private func loadItems(silent: Bool, quiet: Bool = false) async {
        let r = range
        let key = "\(r.from)|\(r.to)"
        loadGen += 1
        let gen = loadGen
        if !silent { loading = items == nil }
        if !quiet {
            fetching = true
            // Trying this month again: show it is on its way, not the last failure.
            if errorKey == key { errorKey = nil }
        }
        defer {
            if gen == loadGen {
                if fetching { fetching = false }
                if loading { loading = false }
            }
        }
        do {
            let fresh = try await APIClient.shared.calendarItems(from: r.from, to: r.to, userId: uid)
            guard r == range else { return }
            setItems(fresh)
            if error != nil { error = nil }
            if errorKey != nil { errorKey = nil }
            if savedAt != nil { savedAt = nil }
            if let v = fresh.structureVersion, v != structure?.version { await loadStructure() }
            // The widgets ride along (throttled inside), so what the Home Screen shows follows this screen.
            Task { await CalendarWidgetPresence.refresh() }
        } catch APIError.unauthorized {
            auth.logout()
        } catch _ where Task.isCancelled || r != range {
            // Cancelled (month changed again, screen pushed away) or superseded: not "offline". The
            // load for the range on screen decides what shows.
            return
        } catch let failure as APIError where failure.nobodyAnswered {
            if let hit = ResponseCache.decoded(APIClient.calItemsKey(uid, from: r.from, to: r.to), as: CalItemsResponse.self) {
                setItems(hit.value)
                savedAt = hit.savedAt
                error = nil
                errorKey = nil
            } else {
                // Keep what is on screen (the grid says it is another range, with Try again).
                error = failure.localizedDescription
                errorKey = key
                if items?.from != r.from { savedAt = nil }
            }
        } catch {
            self.error = error.localizedDescription
            errorKey = key
        }
    }

    private func loadOverdue() async {
        do { setOverdue(try await APIClient.shared.calendarOverdue(userId: uid)) } catch { /* the rail just stays empty */ }
    }

    /// Ask again every `calendarPollSeconds` while the screen is up and the app is in front. The clock
    /// moves after the answers are in, not before them, so a tick redraws once — and only because a
    /// timed task may have turned overdue — instead of up to three times.
    private func pollLoop() async {
        while !Task.isCancelled {
            let seconds = RemoteConfig.shared.calendarPollSeconds
            try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
            if Task.isCancelled { return }
            guard active else { continue }
            await backgroundRefresh()
            now = Date()
        }
    }
}

/// What CalendarView derives from its state, worked out once per change of what it depends on instead
/// of on every body pass: a day tap used to decode the filters' JSON about twenty times and run the
/// whole filter pipeline three or four times (impeccable audit, 6 Oct 2026). A plain class held in
/// @State, so filling it never invalidates the view; every input is part of a key.
private final class CalendarDerived {
    var filtersJSON: String?
    var filters = CalFilters()
    var collapsedJSON: String?
    var collapsed: Set<String> = []
    var peopleKey: String?
    var people: CalPeople?
    var visibleKey: String?
    var visible: [CalItem] = []
    var byDay: [String: [CalItem]] = [:]
    var cellsKey: String?
    var cells: [String: CalDayCell] = [:]
    var monthDaysKey: String?
    var monthDays: [String] = []
    var factsKey: String?
    var holidays: [String: String] = [:]
    var monthHasTasks = false
    var legendKey: String?
    var legend: [CalLegendEntry] = []
    var monthVisibleCount = 0
    var treeKey: String?
    var tree = CalDayTree(root: nil, total: 0, people: 0, unplaced: [])
    var railKey: String?
    var rail: [CalItem] = []
    var weekKey: String?
    var weekRows: [CalWeekRow] = []
    var mineKey: String?
    var mine: Set<String> = []
    var mineOrAbove: Set<String> = []
}

// MARK: - Mac menu bar

/// What the Calendar on screen can do from the Mac's menu bar (CalendarMenuCommands), handed up by
/// the Calendar as a scene value.
struct CalendarMenuActions {
    /// False while a task or a sheet covers the Calendar.
    let enabled: Bool
    /// The People week: the steps move by weeks.
    let people: Bool
    let today: () -> Void
    let step: (Int) -> Void
    let stepDay: (Int) -> Void
    let lens: (Bool) -> Void
    let reload: () -> Void
    let filters: () -> Void
}

private struct CalendarMenuKey: FocusedValueKey {
    typealias Value = CalendarMenuActions
}

extension FocusedValues {
    /// The Calendar on screen, for the Mac's Calendar menu; nil anywhere else.
    var calendarMenu: CalendarMenuActions? {
        get { self[CalendarMenuKey.self] }
        set { self[CalendarMenuKey.self] = newValue }
    }
}

/// Mac: the Calendar's keyboard commands as a Calendar menu in the menu bar, each with its shortcut,
/// for the Calendar on screen and greyed out anywhere else. On the iPad they show in the ⌘ overlay;
/// the Mac has none, so there they could not be discovered (impeccable re-audit, 7 Oct 2026).
struct CalendarMenuCommands: Commands {
    @FocusedValue(\.calendarMenu) private var calendar

    private var on: Bool { calendar?.enabled == true }
    private var people: Bool { calendar?.people == true }

    var body: some Commands {
        CommandMenu(T("Calendar")) {
            Section {
                Button(T("Today")) { calendar?.today() }
                    .keyboardShortcut("t", modifiers: .command)
                    .disabled(!on)
            }
            Section {
                Button(people ? T("Previous week") : T("Previous month")) { calendar?.step(-1) }
                    .keyboardShortcut(.leftArrow, modifiers: .command)
                    .disabled(!on)
                Button(people ? T("Next week") : T("Next month")) { calendar?.step(1) }
                    .keyboardShortcut(.rightArrow, modifiers: .command)
                    .disabled(!on)
                Button(T("Previous day")) { calendar?.stepDay(-1) }
                    .keyboardShortcut(.leftArrow, modifiers: .option)
                    .disabled(!on)
                Button(T("Next day")) { calendar?.stepDay(1) }
                    .keyboardShortcut(.rightArrow, modifiers: .option)
                    .disabled(!on)
            }
            Section {
                Button(T("By division")) { calendar?.lens(false) }
                    .keyboardShortcut("1", modifiers: .command)
                    .disabled(!on)
                Button(T("By person")) { calendar?.lens(true) }
                    .keyboardShortcut("2", modifiers: .command)
                    .disabled(!on)
            }
            Section {
                Button(T("Filters") + "…") { calendar?.filters() }
                    .keyboardShortcut("f", modifiers: .command)
                    .disabled(!on)
                Button(T("Reload")) { calendar?.reload() }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(!on)
            }
        }
    }
}

private extension View {
    /// Mac: hands the Calendar menu its actions. Elsewhere the ⌘ overlay already lists the shortcuts.
    func publishesCalendarMenu(_ actions: CalendarMenuActions) -> some View {
        #if targetEnvironment(macCatalyst)
        return focusedSceneValue(\.calendarMenu, actions)
        #else
        return self
        #endif
    }

    /// Mac: a tooltip for an icon-only control, with its shortcut. Not on iPhone or iPad, where `help`
    /// becomes the VoiceOver hint and would only repeat the label.
    func macHelp(_ text: String) -> some View {
        #if targetEnvironment(macCatalyst)
        return help(text)
        #else
        return self
        #endif
    }
}
