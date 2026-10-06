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
    @State private var openTaskId: String?
    @State private var now = Date()
    @State private var active = true
    /// The width this screen was given, measured: it, not the size class alone, decides the panes.
    @State private var layoutWidth: CGFloat?
    /// Bumped to bring the picked day's list into view on iPhone; `revealedDay` is the last one done.
    @State private var revealDay = 0
    @State private var revealedDay = 0
    @State private var railOpen = false
    @AccessibilityFocusState private var dayHeaderFocused: Bool
    @AppStorage("nexus.calendar.lens") private var lensRaw = "division"
    @AppStorage("nexus.calendar.filters") private var filtersJSON = ""
    @AppStorage("nexus.calendar.collapsed") private var collapsedJSON = "[]"

    enum Mode: Hashable { case month, people }

    /// The one sheet of this screen (one `.sheet(item:)` per view — two make buttons dead).
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

    private static let dayAnchor = "calendar.day"

    // MARK: Derived

    private var uid: String { auth.session?.userId ?? "anon" }
    private var today: String { CalDays.wibToday(now) }
    private var focus: String { (focusId.flatMap { ix.byId[$0] != nil ? $0 : nil }) ?? ix.top?.id ?? "" }
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

    // MARK: Layout

    /// The measured width, or a stand-in from the size class for the frame before it is measured.
    private var width: CGFloat { layoutWidth ?? (hSize == .regular ? 1024 : 390) }
    /// The grid beside the day list only when both fit. A regular size class alone is also a
    /// half-screen Mac window or a Stage Manager tile, where the side-by-side grid shrank to 18–26 pt
    /// cells with day numbers over their counts (impeccable audit, 6 Oct 2026); below 760 pt the
    /// screen stacks like the phone, the layout that works at every width.
    private var twoPane: Bool { hSize == .regular && mode == .month && width >= 760 }
    private var panelWidth: CGFloat { width >= 900 ? 360 : 320 }
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

    // MARK: Body

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
                .background {
                    GeometryReader { g in
                        Color.clear.onChange(of: g.size.width, initial: true) { _, w in
                            if layoutWidth != w { layoutWidth = w }
                        }
                    }
                }
        }
        .navigationTitle(T("Calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .background { shortcuts }
        .task { await firstLoad() }
        .task(id: rangeKey) { await loadItems(silent: items != nil) }
        .task { await pollLoop() }
        .onChange(of: scenePhase) { _, phase in
            active = phase == .active
            if phase == .active { now = Date(); Task { await backgroundRefresh() } }
        }
        .onAppear { router.calendarOnScreen = instance; claimRouterDate(); claimRouterTask(); claimRouterScope() }
        // Covered by the task it opened, this Calendar is still the one a link should land on.
        .onDisappear { if router.calendarOnScreen == instance, openTaskId == nil { router.calendarOnScreen = nil } }
        .onChange(of: router.calendarDate) { _, _ in if router.calendarOnScreen == instance { claimRouterDate() } }
        .onChange(of: router.calendarTaskId) { _, _ in if router.calendarOnScreen == instance { claimRouterTask() } }
        .onChange(of: router.calendarScope) { _, _ in if router.calendarOnScreen == instance { claimRouterScope() } }
        .onChange(of: today) { old, new in if selected == old { selected = new } }
        .sheet(item: $sheet) { s in
            switch s {
            case .filters:
                CalFilterSheet(filters: filtersBinding, ix: ix, items: items?.items ?? [], people: people, myHomes: myHomes)
            case let .preview(id, project, notMember, masked):
                CalTaskPreview(taskId: id, projectName: project, notMember: notMember, masked: masked)
            }
        }
        .navigationDestination(item: $openTaskId) { id in
            TaskDetailView(taskId: id)
                .id(id)
                // Gone some other way than Back (a tab switch, a deeper push): links stop landing here.
                .onDisappear { if openTaskId != nil, router.calendarOnScreen == instance { router.calendarOnScreen = nil } }
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
            ScrollView { SkeletonList(count: 6).padding(16) }
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
                ScrollView { dayPanel.padding(14) }
                    .frame(width: panelWidth)
                    .refreshable { await refreshAll(silent: true) }
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
                    if reduceMotion {
                        proxy.scrollTo(Self.dayAnchor, anchor: .top)
                    } else {
                        withAnimation(.snappy(duration: 0.35)) { proxy.scrollTo(Self.dayAnchor, anchor: .top) }
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
        Text(title).font(NXFont.display(17, .bold)).monospacedDigit().foregroundStyle(NX.foreground)
            .lineLimit(2).minimumScaleFactor(0.8)
            .accessibilityAddTraits(.isHeader)
    }

    /// The whole 44 pt square takes the tap, not only the glyph.
    private func stepButton(_ n: Int) -> some View {
        Button { step(n) } label: {
            Image(systemName: n < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(n < 0 ? (mode == .people ? T("Previous week") : T("Previous month"))
                                  : (mode == .people ? T("Next week") : T("Next month")))
    }

    /// The pill is drawn inside the button, and the button is 44 pt tall: its edge takes the tap too.
    private var todayButton: some View {
        Button { select(today) } label: {
            Text(T("Today")).font(NXFont.text(13, .semibold))
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
    /// so the grid does not move further down.
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

    private var scopeMenu: some View {
        let scope = filters.scope
        let scoped = scope != .all
        return Menu {
            Picker(T("Show"), selection: scopeBinding) {
                ForEach(scopeOptions, id: \.self) { s in
                    Label(scopeLabel(s), systemImage: scopeIcon(s)).tag(s)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: scopeIcon(scope)).font(.system(size: 12, weight: .semibold))
                Text(scopeLabel(scope)).font(NXFont.text(13, .semibold)).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(NX.mutedFg)
            }
            .foregroundStyle(scoped ? NX.violetText : NX.foreground)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(scoped ? NX.accentBg : NX.muted, in: Capsule(style: .continuous))
            .overlay(Capsule(style: .continuous).strokeBorder(scoped ? NX.violetText.opacity(0.35) : NX.border.opacity(0.6)))
            .contentShape(Capsule(style: .continuous))
        }
        .fixedSize()
        .accessibilityLabel(T("Show"))
        .accessibilityValue(scopeLabel(scope))
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
        Binding(get: { filters.scope }, set: { s in
            guard s != filters.scope else { return }
            var f = filters
            f.scope = s
            filtersBinding.wrappedValue = f
        })
    }

    /// Zoom path, then one chip per unit at the focus level (tap = zoom in, or filter a leaf unit).
    /// The two kinds look different now: a chevron where the tap goes deeper, a check where a filter
    /// is on — they used to be identical and only the VoiceOver hint told them apart.
    private var legendRow: some View {
        // No counts for a month that has not arrived (the overlap with the last one is partial).
        let entries = rangeLoaded ? CalendarCore.legend(visible.filter { $0.day.hasPrefix(month) }, ix, focus: focus) : []
        let picked = Set(filters.units)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if let top = ix.top, focus != top.id {
                    let path = Array(ix.ancestors(focus).reversed()) + [focus]
                    ForEach(Array(path.enumerated()), id: \.offset) { i, id in
                        if i > 0 {
                            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
                                .accessibilityHidden(true)
                        }
                        let name = i == 0 ? T("All") : (ix.byId[id]?.name ?? "")
                        if i == path.count - 1 {
                            // Where you are: a marker, not a button.
                            Text(name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                                .padding(.horizontal, 10).frame(minHeight: 28)
                                .background(NX.accentBg, in: Capsule())
                                .frame(minHeight: 44)
                        } else {
                            Button { focusId = (id == top.id) ? nil : id } label: {
                                Text(name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
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
        let zoomable = unit != nil && e.unitId != focus && !(ix.children[e.unitId] ?? []).isEmpty
        let name = e.unitId == "other" ? T("Other") : (unit?.name ?? "")
        let spoken = "\(name), \(CalFormat.tasks(e.count))"
        return Button {
            if zoomable { focusId = e.unitId } else {
                var f = filters
                if let i = f.units.firstIndex(of: e.unitId) { f.units.remove(at: i) } else { f.units.append(e.unitId) }
                filtersBinding.wrappedValue = f
            }
        } label: {
            HStack(spacing: 6) {
                Circle().fill(calUnitColor(unit)).frame(width: 8, height: 8)
                Text(name).font(NXFont.text(12, .semibold)).lineLimit(1)
                Text("\(e.count)").font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.mutedFg)
                if on {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.violetText)
                }
                if zoomable {
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
                }
            }
            .padding(.horizontal, 10).frame(minHeight: 30)
            .background(on ? NX.accentBg : NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? NX.violetText.opacity(0.6) : NX.border))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(spoken)
        .accessibilityHint(zoomable ? String(format: T("Zoom into %@"), name) : String(format: T("Filter by %@"), name))
        .accessibilityAddTraits(on ? .isSelected : [])
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

    /// The filters at work, each with an ✕. A number on the funnel was all that said yesterday's
    /// "Only overdue" was still hiding everyone else's tasks today (impeccable audit, 6 Oct 2026).
    /// The scope is not repeated here: it has its own switch above.
    private var activeFilterRow: some View {
        let f = filters
        let shown = chipFilters(f)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(shown, id: \.self) { c in
                    let text = chipLabel(c, f)
                    Button { withAnimation(.snappy(duration: 0.2)) { clearFilter(c) } } label: {
                        HStack(spacing: 5) {
                            Text(text).lineLimit(1)
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).accessibilityHidden(true)
                        }
                        .font(NXFont.text(12, .semibold))
                        .foregroundStyle(NX.violetText)
                        .padding(.horizontal, 10).frame(minHeight: 30)
                        .background(NX.accentBg, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(text)
                    .accessibilityHint(T("Removes this filter"))
                }
                if shown.count > 1 {
                    Button { withAnimation(.snappy(duration: 0.2)) { resetFilters() } } label: {
                        Text(T("Reset filters")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
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
        let days = CalDays.monthGrid(selected)
        let cells = monthCells(days)
        let holidays = Dictionary((items?.holidays ?? []).map { ($0.day, $0.name) }, uniquingKeysWith: { a, _ in a })
        let monthName = CalFormat.day(month + "-01", "MMMMyyyy")
        let monthHasTasks = (items?.items ?? []).contains { $0.day.hasPrefix(month) }
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
            } else if !monthHasTasks {
                let goAction: (String, () -> Void)? = month != String(today.prefix(7)) ? (T("Go to this month"), goToday) : nil
                banner(String(format: T("Nothing has a due date in %@ yet."), monthName), action: goAction)
            } else if filters.activeCount > 0 && !visible.contains(where: { $0.day.hasPrefix(month) }) {
                banner(T("Nothing matches the filters this month."), action: (T("Reset filters"), resetFilters))
            }
            CalMonthGrid(days: days, month: month, cells: cells, selected: selected, today: today, holidays: holidays, ix: ix, wide: wideCells,
                         loaded: loaded) { select($0, reveal: true) }
                // Apple's Calendar month stops growing at the first accessibility size too: past it the
                // fixed-height cells overflow into the next week. The day list below scales fully.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .opacity(dimmed ? 0.6 : 1)
                .animation(.easeOut(duration: 0.15), value: dimmed)
            HStack(spacing: 14) {
                legendKey(filled: true, T("has tasks to do"))
                legendKey(filled: false, T("done or no status"))
                HStack(spacing: 5) { Capsule().fill(CalTone.overdue).frame(width: 14, height: 2); Text(T("overdue")) }
            }
            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            if loaded, items?.truncated == true {
                banner(T("This month has more tasks than the calendar can show at once."), action: nil)
            }
        }
    }

    /// The key draws a neutral sample: the real dots are each division's own colour.
    private func legendKey(filled: Bool, _ text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(filled ? NX.mutedFg : Color.clear).overlay(Circle().strokeBorder(NX.mutedFg, lineWidth: 1.5)).frame(width: 7, height: 7)
            Text(text)
        }
    }

    /// The action is the app's tint (violet, like the empty states below it) and its button is the
    /// banner's full 44 pt height, so the banner keeps its size.
    private func banner(_ text: String, action: (String, () -> Void)?) -> some View {
        HStack(spacing: 8) {
            Text(text).font(NXFont.text(12.5)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 0)
            if let action {
                Button(action: action.1) {
                    Text(action.0).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                        .padding(.horizontal, 12).frame(minHeight: 30)
                        .background(NX.accentBg, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, action == nil ? 10 : 2)
        .background(NX.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    // MARK: Day

    private var dayPanel: some View {
        let dayItems = visibleByDay[selected] ?? []
        let tree = CalendarCore.dayTree(dayItems, ix, focus: focus, today: today, now: now, windowDays: windowDays)
        let rail = selected == today
            ? CalendarCore.overdueRail(CalendarCore.underFocus(CalendarCore.filterItems(overdue?.items ?? [], filters, context), ix, focus: focus),
                                       todays: dayItems, today: today, now: now, windowDays: windowDays)
            : []
        let ctx = CalRowContext(ix: ix, people: people, today: today, now: now, windowDays: windowDays, lensByPerson: lensByPerson, onOpen: openItem)
        let mine = ix.subtree(myHomes)
        let rel = CalDays.dayDiff(today, selected)
        let holiday = items?.holidays.first { $0.day == selected }?.name
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
            NXSegmented(selection: Binding(get: { lensByPerson }, set: { lensRaw = $0 ? "person" : "division" }),
                        options: [false, true], label: { $0 ? T("By person") : T("By division") }, title: T("Group by"))
            if !rail.isEmpty { overdueRail(rail) }
            if tree.total == 0 && !rangeLoaded {
                notLoaded
            } else if tree.total == 0 {
                let filtered = filters.activeCount > 0
                let monthEmpty = !(items?.items ?? []).contains { $0.day.hasPrefix(month) }
                let emptyAction: (() -> Void)? = filtered ? resetFilters : (selected != today ? goToday : nil)
                EmptyState(icon: filtered ? "line.3.horizontal.decrease.circle" : "calendar",
                           title: filtered ? T("Nothing matches the filters on this day") : T("No tasks on this day"),
                           subtitle: filtered ? T("Filters are hiding the rest. Reset them to see everything.") : (monthEmpty ? T("Nothing has a due date this month yet.") : T("Nobody has a task due on this date.")),
                           tint: CalTone.accentFill,
                           actionTitle: filtered ? T("Reset filters") : (selected != today ? T("Back to today") : nil),
                           actionIcon: nil,
                           action: emptyAction,
                           compact: true)
            } else if let root = tree.root {
                VStack(spacing: 10) {
                    if !root.items.isEmpty || !root.people.isEmpty {
                        let key = "own:\(root.unit.id)"
                        CalSectionCard(node: root, own: true, mine: mine.contains(root.unit.id), collapsed: folded.contains(key), toggle: { toggleCollapse(key) }, ctx: ctx)
                    }
                    ForEach(root.children) { node in
                        let isMine = !ix.subtree([node.unit.id]).isDisjoint(with: mine)
                        CalSectionCard(node: node, own: false, mine: isMine, collapsed: folded.contains(node.unit.id), toggle: { toggleCollapse(node.unit.id) }, ctx: ctx)
                    }
                    if lensByPerson && !tree.unplaced.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(String(format: T("Not in the chart yet · %d"), tree.unplaced.count))
                            ForEach(tree.unplaced, id: \.userId) { p in
                                CalPersonBlock(row: p, unitId: nil, ix: ix, people: people, today: today, now: now, windowDays: windowDays, onOpen: openItem)
                            }
                        }
                        .nexusCard(padding: 10, radius: 18)
                    }
                    if placementsShown(root) > tree.total {
                        Text(String(format: T("A task can show under several divisions. Total: %d unique tasks."), tree.total))
                            .font(NXFont.text(11.5)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
    }

    /// The date, TODAY / TOMORROW / YESTERDAY, the holiday and the count, as one VoiceOver heading.
    /// Picking a day on the grid moves VoiceOver here, instead of leaving the day's tasks some forty
    /// cells, keys and buttons further on.
    private func dayHeading(tree: CalDayTree, rel: Int, holiday: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(CalFormat.day(selected, "EEEEdMMMyyyy")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                if rel == 0 || rel == 1 || rel == -1 {
                    // The app's violet, as "today" is everywhere else (grid, widgets, Watch).
                    Text((rel == 0 ? T("Today") : rel == 1 ? T("Tomorrow") : T("Yesterday")).uppercased())
                        .font(NXFont.text(11, .bold)).foregroundStyle(NX.violetText)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 5))
                }
            }
            if let holiday { Text(holiday).font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.overdue) }
            Text(tree.total > 0 ? "\(CalFormat.tasks(tree.total)) · \(CalFormat.people(tree.people))"
                 : !rangeLoaded ? (failedHere ? T("Couldn't load this") : T("Loading…"))
                 : T("No tasks"))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityFocused($dayHeaderFocused)
    }

    private func dayStepButton(_ n: Int) -> some View {
        Button { select(CalDays.addDays(selected, n)) } label: {
            Image(systemName: n < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NX.foreground)
        .accessibilityLabel(n < 0 ? T("Previous day") : T("Next day"))
    }

    private func overdueRail(_ rail: [CalItem]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(format: T("Overdue · %d"), rail.count).uppercased())
                .font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(CalTone.overdue)
                .padding(.horizontal, 10).padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
            ForEach(rail.prefix(railOpen ? rail.count : 2)) { item in
                CalItemRow(item: item, unitId: item.placements.first?.unitId, ix: ix, people: people, today: today, now: now, windowDays: windowDays,
                           trailingNote: CalFormat.day(item.day, "dMMM"), onOpen: openItem)
            }
            if rail.count > 2 {
                Button { railOpen.toggle() } label: {
                    Text(railOpen ? T("Show less") : T("Show all"))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.overdue)
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

    private var peopleWeek: some View {
        let monday = CalDays.mondayOf(selected)
        let days = (0..<7).map { CalDays.addDays(monday, $0) }
        let rows = CalendarCore.weekRows(visible, ix, focus: focus, monday: monday, today: today, now: now, windowDays: windowDays)
        let thisWeek: (() -> Void)? = days.contains(today) ? nil : goToday
        return CalPeopleWeek(rows: rows, days: days, today: today, now: now, windowDays: windowDays, ix: ix, people: people, wide: peopleTable,
                             onOpenDay: { d in mode = .month; lensRaw = "person"; select(d, reveal: true) }, onOpen: openItem,
                             filtered: filters.activeCount > 0, onResetFilters: resetFilters, onThisWeek: thisWeek)
            .id(monday)
    }

    // MARK: Toolbar and keyboard

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if !twoPane && mode == .month {
            ToolbarItem(placement: .principal) { barTitle }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { sheet = .filters } label: {
                HStack(spacing: 3) {
                    Image(systemName: filters.activeCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    if filters.activeCount > 0 {
                        Text("\(filters.activeCount)")
                            .font(NXFont.text(11, .bold)).monospacedDigit()
                            .foregroundStyle(NX.violetText)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(NX.accentBg, in: Capsule())
                    }
                }
            }
            .accessibilityLabel(filters.activeCount > 0 ? "\(T("Filters")) (\(filters.activeCount))" : T("Filters"))
            .keyboardShortcut("f", modifiers: .command)
        }
    }

    /// One scroll on iPhone: once the list has carried the grid and the day's heading away, the bar
    /// still says which day this is.
    private var barTitle: some View {
        VStack(spacing: 0) {
            Text(T("Calendar")).font(.system(size: 17, weight: .bold)).foregroundStyle(NX.foreground)
            Text(CalFormat.day(selected, "EEEdMMM")).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
        }
        .lineLimit(1)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// iPad / Mac keyboard: ⌘T today, ⌘←/⌘→ month (week in People), ⌥←/⌥→ day, ⌘1/⌘2 lens, ⌘R reload.
    /// Hidden buttons, so they show in the ⌘ overlay without crowding the toolbar.
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

    // MARK: Actions

    /// `reveal`: the day was picked on the grid (or by a link, or from the People week), so its list is
    /// what the person wants next — on iPhone it sits below the fold, so scroll to it, and VoiceOver
    /// moves to its heading in either layout. Arrows and shortcuts keep focus where it is (they are
    /// pressed again and again) and only say which day it is now.
    private func select(_ day: String, reveal: Bool = false) {
        let changed = day != selected
        withAnimation(.snappy(duration: 0.2)) { selected = day }
        if reveal && !twoPane && mode == .month { revealDay += 1 }
        guard voiceOver else { return }
        if reveal {
            dayHeaderFocused = true
        } else if changed {
            announce(day)
        }
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
    private func resetFilters() { filtersBinding.wrappedValue = CalFilters() }

    private func step(_ n: Int) {
        select(mode == .people ? CalDays.addDays(selected, 7 * n) : CalDays.shiftMonth(selected, n))
    }

    private func toggleCollapse(_ key: String) {
        var set = collapsed
        if set.contains(key) { set.remove(key) } else { set.insert(key) }
        collapsedJSON = (try? String(data: JSONEncoder().encode(Array(set).sorted()), encoding: .utf8)) ?? "[]"
    }

    /// Editable through its home project → the full task screen; otherwise read-only. A masked row
    /// opens the reason it cannot be read (a private project, members only) rather than ignoring the
    /// tap; nothing about the task is fetched.
    private func openItem(_ item: CalItem) {
        if item.masked {
            sheet = .preview(taskId: item.key, project: nil, notMember: true, masked: true)
            return
        }
        guard let id = item.taskId else { return }
        if item.canEdit && item.editProjectId == item.project?.id {
            openTaskId = id
        } else {
            sheet = .preview(taskId: id, project: item.project?.name, notMember: true, masked: false)
        }
    }

    /// A calendar widget row (`nexus://calendar?…&task=<id>`) opens its task once, the way a row here
    /// would. Usually it is not in what is loaded yet (cold start, another month, an undated task), so
    /// the server says how it may be opened; masked or gone → the day alone.
    private func claimRouterTask() {
        guard let id = router.calendarTaskId else { return }
        router.calendarTaskId = nil
        // Whatever is open on top gives way first; the new one opens after the pop has finished — a
        // pop and a push in one update are not reliable in a NavigationStack.
        let covered = openTaskId != nil || sheet != nil
        openTaskId = nil
        sheet = nil
        let loaded = items?.items.first(where: { $0.taskId == id })
        Task { @MainActor in
            if covered { try? await Task.sleep(for: .milliseconds(450)) }
            if let loaded {
                openItem(loaded)
                return
            }
            guard let access = try? await APIClient.shared.calendarTask(id: id), access.found, !access.masked else { return }
            if access.canEdit && access.editProjectId == access.projectId {
                openTaskId = id
            } else {
                sheet = .preview(taskId: id, project: nil, notMember: true, masked: false)
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
            openTaskId = nil
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
        // the widget itself draws it. Only once the Bagan is in; before that nobody has a card.
        if scope == .division, structure != nil, myHomes.isEmpty { scope = .me }
        guard scope != filters.scope else { return }
        var f = filters
        f.scope = scope
        filtersBinding.wrappedValue = f
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
    }

    private func setItems(_ r: CalItemsResponse) {
        items = r
        itemsRev += 1
    }

    private func setOverdue(_ r: CalOverdueResponse) {
        overdue = r
        overdueRev += 1
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

    /// Ask again every `calendarPollSeconds` while the screen is up and the app is in front.
    private func pollLoop() async {
        while !Task.isCancelled {
            let seconds = RemoteConfig.shared.calendarPollSeconds
            try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
            if Task.isCancelled { return }
            now = Date()
            if active { await backgroundRefresh() }
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
}
