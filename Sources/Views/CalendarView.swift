import SwiftUI

/// The Calendar (master calendar, owner 5 Oct 2026; replaces Team Calendar in 0.1.7): every task with
/// a due date in the company, a dot per Bagan division on the month, the day split by division or by
/// person, and a week "People" view. iPhone: one vertical scroll (header, grid, day). iPad / Mac: the
/// grid beside a 360 pt day list, like Messages. Rules: Shared/CalendarCore.swift (identical to the
/// web and Android, checked by Tests/CalendarGolden); who sees what is decided by the server.
struct CalendarView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.scenePhase) private var scenePhase

    @State private var structure: CalStructure?
    /// The Bagan indexed once per structure, not on every read.
    @State private var ix = CalIndex(units: [], people: [])
    @State private var items: CalItemsResponse?
    @State private var overdue: CalOverdueResponse?
    @State private var loading = true
    @State private var fetching = false
    /// Bumped by every items load; only the newest one settles `fetching`.
    @State private var loadGen = 0
    /// Which Calendar on screen claims a date from a link (a pushed copy must not).
    @State private var instance = UUID()
    @State private var error: String?
    @State private var savedAt: Date?
    @State private var selected: String = CalDays.wibToday()
    @State private var mode: Mode = .month
    @State private var focusId: String?
    @State private var sheet: CalSheet?
    @State private var openTaskId: String?
    @State private var now = Date()
    @State private var active = true
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

    // MARK: Derived

    private var uid: String { auth.session?.userId ?? "anon" }
    private var wide: Bool { hSize == .regular }
    private var today: String { CalDays.wibToday(now) }
    private var focus: String { (focusId.flatMap { ix.byId[$0] != nil ? $0 : nil }) ?? ix.top?.id ?? "" }
    private var windowDays: Int { items?.rules?.overdueWindowDays ?? 14 }
    private var myHomes: [String] { structure?.me?.homeUnitIds ?? [] }
    private var access: String? { structure?.access ?? items?.access }
    private var range: (from: String, to: String) { CalDays.gridRange(selected) }
    private var rangeKey: String { "\(range.from)|\(range.to)" }
    private var month: String { String(selected.prefix(7)) }

    private var filters: CalFilters {
        get { (try? JSONDecoder().decode(CalFilters.self, from: Data(filtersJSON.utf8))) ?? CalFilters() }
    }
    private var filtersBinding: Binding<CalFilters> {
        Binding(get: { filters }, set: { new in
            filtersJSON = (try? String(data: JSONEncoder().encode(new), encoding: .utf8)) ?? ""
        })
    }
    private var collapsed: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: Data(collapsedJSON.utf8))) ?? [])
    }
    private var lensByPerson: Bool { lensRaw == "person" }

    private var people: CalPeople {
        var extra = overdue?.people ?? [:]
        for (k, v) in items?.people ?? [:] { extra[k] = v }
        return CalPeople(ix: ix, extra: extra)
    }

    private var context: CalFilterContext {
        CalFilterContext(ix: ix, meId: structure?.me?.userId, myHomes: myHomes, today: today, now: now, windowDays: windowDays)
    }

    private var visible: [CalItem] {
        CalendarCore.underFocus(CalendarCore.filterItems(items?.items ?? [], filters, context), ix, focus: focus)
    }

    // MARK: Body

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
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
            if phase == .active { now = Date(); Task { await refreshAll(silent: true) } }
        }
        .onAppear { router.calendarOnScreen = instance; claimRouterDate(); claimRouterTask() }
        // Covered by the task it opened, this Calendar is still the one a link should land on.
        .onDisappear { if router.calendarOnScreen == instance, openTaskId == nil { router.calendarOnScreen = nil } }
        .onChange(of: router.calendarDate) { _, _ in if router.calendarOnScreen == instance { claimRouterDate() } }
        .onChange(of: router.calendarTaskId) { _, _ in if router.calendarOnScreen == instance { claimRouterTask() } }
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
        } else if wide && mode == .month {
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) { header; gridArea }
                        .padding(20)
                }
                .refreshable { await refreshAll(silent: true) }
                Divider().overlay(NX.border)
                ScrollView { dayPanel.padding(14) }
                    .frame(width: 360)
                    .refreshable { await refreshAll(silent: true) }
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    if mode == .month {
                        gridArea
                        dayPanel
                    } else {
                        peopleArea
                    }
                }
                .padding(16)
            }
            .refreshable { await refreshAll(silent: true) }
        }
    }

    // MARK: Header (month, view, legend)

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 32, height: 32) }
                    .accessibilityLabel(mode == .people ? T("Previous week") : T("Previous month"))
                Text(title).font(NXFont.display(17, .bold)).monospacedDigit().foregroundStyle(NX.foreground)
                    .frame(minWidth: 130)
                Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 32, height: 32) }
                    .accessibilityLabel(mode == .people ? T("Next week") : T("Next month"))
                Spacer(minLength: 4)
                if selected != today {
                    Button(T("Today")) { select(today) }
                        .font(NXFont.text(13, .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(NX.foreground)
            NXSegmented(selection: $mode, options: [Mode.month, .people], label: { $0 == .month ? T("Month") : T("People") })
                .frame(maxWidth: 320)
            legendRow
            if let savedAt { OfflineNotice(savedAt: savedAt) }
        }
    }

    private var title: String {
        if mode == .people {
            let monday = CalDays.mondayOf(selected)
            return "\(CalFormat.day(monday, "dMMM")) – \(CalFormat.day(CalDays.addDays(monday, 6), "dMMMyyyy"))"
        }
        return CalFormat.day(month + "-01", "MMMMyyyy")
    }

    /// Zoom path, then one chip per unit at the focus level (tap = zoom in, or filter a leaf unit).
    private var legendRow: some View {
        let entries = CalendarCore.legend(visible.filter { $0.day.hasPrefix(month) }, ix, focus: focus)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if let top = ix.top, focus != top.id {
                    let path = Array(ix.ancestors(focus).reversed()) + [focus]
                    ForEach(Array(path.enumerated()), id: \.offset) { i, id in
                        if i > 0 { Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg) }
                        let last = i == path.count - 1
                        Button(i == 0 ? T("All") : (ix.byId[id]?.name ?? "")) { focusId = (id == top.id) ? nil : id }
                            .font(NXFont.text(12, .semibold))
                            .foregroundStyle(last ? CalTone.onNavy : NX.mutedFg)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(last ? CalTone.navy : Color.clear, in: Capsule())
                            .disabled(last)
                    }
                }
                ForEach(entries, id: \.unitId) { e in
                    let unit = ix.byId[e.unitId]
                    let zoomable = unit != nil && e.unitId != focus && !(ix.children[e.unitId] ?? []).isEmpty
                    let on = filters.units.contains(e.unitId)
                    Button {
                        if zoomable { focusId = e.unitId } else {
                            var f = filters
                            if let i = f.units.firstIndex(of: e.unitId) { f.units.remove(at: i) } else { f.units.append(e.unitId) }
                            filtersBinding.wrappedValue = f
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Circle().fill(calUnitColor(unit)).frame(width: 8, height: 8)
                            Text(e.unitId == "other" ? T("Other") : (unit?.name ?? "")).font(NXFont.text(12, .semibold)).lineLimit(1)
                            Text("\(e.count)").font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(on ? CalTone.navy.opacity(0.12) : NX.card, in: Capsule())
                        .overlay(Capsule().strokeBorder(on ? CalTone.navy : NX.border))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(NX.foreground)
                    .accessibilityHint(zoomable ? String(format: T("Zoom into %@"), unit?.name ?? "") : String(format: T("Filter by %@"), unit?.name ?? ""))
                }
            }
        }
    }

    // MARK: Month

    private var gridArea: some View {
        let byDay = CalendarCore.byDay(visible)
        let days = CalDays.monthGrid(selected)
        var cells: [String: CalDayCell] = [:]
        for d in days { cells[d] = CalendarCore.dayCell(d, byDay[d] ?? [], ix, focus: focus, today: today, now: now, windowDays: windowDays) }
        let holidays = Dictionary((items?.holidays ?? []).map { ($0.day, $0.name) }, uniquingKeysWith: { a, _ in a })
        let monthCount = (items?.items ?? []).filter { $0.day.hasPrefix(month) }.count
        let staleRange = items?.from != range.from
        return VStack(alignment: .leading, spacing: 10) {
            if staleRange, !fetching, let error {
                banner(error, action: (T("Try again"), retryNow))
            } else if monthCount == 0 && !fetching {
                let goAction: (String, () -> Void)? = month != String(today.prefix(7)) ? (T("Go to this month"), goToday) : nil
                banner(String(format: T("Nothing has a due date in %@ yet."), CalFormat.day(month + "-01", "MMMMyyyy")), action: goAction)
            } else if visible.filter({ $0.day.hasPrefix(month) }).isEmpty && filters.activeCount > 0 {
                banner(T("Nothing matches the filters this month."), action: (T("Reset filters"), resetFilters))
            }
            CalMonthGrid(days: days, month: month, cells: cells, selected: selected, today: today, holidays: holidays, ix: ix, wide: wide) { select($0) }
                .opacity(fetching ? 0.6 : 1)
            HStack(spacing: 14) {
                legendKey(filled: true, T("has tasks to do"))
                legendKey(filled: false, T("done or no status"))
                HStack(spacing: 5) { Capsule().fill(CalTone.overdue).frame(width: 14, height: 2); Text(T("overdue")) }
            }
            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            if items?.truncated == true {
                banner(T("This month has more tasks than the calendar can show at once."), action: nil)
            }
        }
    }

    private func legendKey(filled: Bool, _ text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(filled ? CalTone.navy : Color.clear).overlay(Circle().strokeBorder(CalTone.navy, lineWidth: 1.5)).frame(width: 7, height: 7)
            Text(text)
        }
    }

    private func banner(_ text: String, action: (String, () -> Void)?) -> some View {
        HStack(spacing: 8) {
            Text(text).font(NXFont.text(12.5)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 0)
            if let action {
                Button(action.0, action: action.1).font(NXFont.text(12, .semibold)).buttonStyle(.plain)
                    .foregroundStyle(CalTone.onNavy).padding(.horizontal, 10).padding(.vertical, 5)
                    .background(CalTone.navy, in: Capsule())
            }
        }
        .padding(10)
        .background(NX.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    // MARK: Day

    private var dayPanel: some View {
        let dayItems = CalendarCore.byDay(visible)[selected] ?? []
        let tree = CalendarCore.dayTree(dayItems, ix, focus: focus, today: today, now: now, windowDays: windowDays)
        let rail = selected == today
            ? CalendarCore.overdueRail(CalendarCore.underFocus(CalendarCore.filterItems(overdue?.items ?? [], filters, context), ix, focus: focus),
                                       todays: dayItems, today: today, now: now, windowDays: windowDays)
            : []
        let ctx = CalRowContext(ix: ix, people: people, today: today, now: now, windowDays: windowDays, lensByPerson: lensByPerson, onOpen: openItem)
        let mine = ix.subtree(myHomes)
        let rel = CalDays.dayDiff(today, selected)
        let holiday = items?.holidays.first { $0.day == selected }?.name
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(CalFormat.day(selected, "EEEEdMMMyyyy")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                        if rel == 0 || rel == 1 || rel == -1 {
                            Text((rel == 0 ? T("Today") : rel == 1 ? T("Tomorrow") : T("Yesterday")).uppercased())
                                .font(NXFont.text(9.5, .bold)).foregroundStyle(CalTone.navy)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(CalTone.navy.opacity(0.12), in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    if let holiday { Text(holiday).font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.overdue) }
                    Text(tree.total > 0 ? "\(CalFormat.tasks(tree.total)) · \(CalFormat.people(tree.people))" : T("No tasks"))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Button { select(CalDays.addDays(selected, -1)) } label: { Image(systemName: "chevron.left").frame(width: 30, height: 30) }
                        .accessibilityLabel(T("Previous day"))
                    Button { select(CalDays.addDays(selected, 1)) } label: { Image(systemName: "chevron.right").frame(width: 30, height: 30) }
                        .accessibilityLabel(T("Next day"))
                }
                .buttonStyle(.plain)
                .foregroundStyle(NX.foreground)
            }
            NXSegmented(selection: Binding(get: { lensByPerson }, set: { lensRaw = $0 ? "person" : "division" }),
                        options: [false, true], label: { $0 ? T("By person") : T("By division") })
            if !rail.isEmpty { overdueRail(rail) }
            if tree.total == 0 {
                let filtered = filters.activeCount > 0
                let monthEmpty = !fetching && !(items?.items ?? []).contains { $0.day.hasPrefix(month) }
                let emptyAction: (() -> Void)? = filtered ? resetFilters : (selected != today ? goToday : nil)
                EmptyState(icon: filtered ? "line.3.horizontal.decrease.circle" : "calendar",
                           title: filtered ? T("Nothing matches the filters on this day") : T("No tasks on this day"),
                           subtitle: filtered ? T("Filters are hiding the rest. Reset them to see everything.") : (monthEmpty ? T("Nothing has a due date this month yet.") : T("Nobody has a task due on this date.")),
                           actionTitle: filtered ? T("Reset filters") : (selected != today ? T("Back to today") : nil),
                           actionIcon: nil,
                           action: emptyAction,
                           compact: true)
            } else if let root = tree.root {
                VStack(spacing: 10) {
                    if !root.items.isEmpty || !root.people.isEmpty {
                        let key = "own:\(root.unit.id)"
                        CalSectionCard(node: root, own: true, mine: mine.contains(root.unit.id), collapsed: collapsed.contains(key), toggle: { toggleCollapse(key) }, ctx: ctx)
                    }
                    ForEach(root.children) { node in
                        let isMine = !ix.subtree([node.unit.id]).isDisjoint(with: mine)
                        CalSectionCard(node: node, own: false, mine: isMine, collapsed: collapsed.contains(node.unit.id), toggle: { toggleCollapse(node.unit.id) }, ctx: ctx)
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

    private func overdueRail(_ rail: [CalItem]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(format: T("Overdue · %d"), rail.count).uppercased())
                .font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(CalTone.overdue)
                .padding(.horizontal, 10).padding(.top, 8)
            ForEach(rail.prefix(railOpen ? rail.count : 2)) { item in
                CalItemRow(item: item, unitId: item.placements.first?.unitId, ix: ix, people: people, today: today, now: now, windowDays: windowDays,
                           trailingNote: CalFormat.day(item.day, "dMMM"), onOpen: openItem)
            }
            if rail.count > 2 {
                Button(railOpen ? T("Show less") : T("Show all")) { railOpen.toggle() }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.overdue).buttonStyle(.plain)
                    .padding(.horizontal, 10).padding(.bottom, 8)
            }
        }
        .background(CalTone.overdue.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(CalTone.overdue.opacity(0.25)))
    }
    @State private var railOpen = false

    private func placementsShown(_ n: CalTreeNode) -> Int {
        n.items.count + n.children.reduce(0) { $0 + placementsShown($1) }
    }

    // MARK: People

    private var peopleArea: some View {
        let monday = CalDays.mondayOf(selected)
        let days = (0..<7).map { CalDays.addDays(monday, $0) }
        let rows = CalendarCore.weekRows(visible, ix, focus: focus, monday: monday, today: today, now: now, windowDays: windowDays)
        return CalPeopleWeek(rows: rows, days: days, today: today, now: now, windowDays: windowDays, ix: ix, people: people, wide: wide,
                             onOpenDay: { d in mode = .month; lensRaw = "person"; select(d) }, onOpen: openItem)
            .id(monday)
    }

    // MARK: Toolbar and keyboard

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { sheet = .filters } label: {
                HStack(spacing: 3) {
                    Image(systemName: filters.activeCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    if filters.activeCount > 0 {
                        Text("\(filters.activeCount)")
                            .font(NXFont.text(11, .bold)).monospacedDigit()
                            .foregroundStyle(CalTone.onNavy)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(CalTone.navy, in: Capsule())
                    }
                }
            }
            .accessibilityLabel(filters.activeCount > 0 ? "\(T("Filters")) (\(filters.activeCount))" : T("Filters"))
            .keyboardShortcut("f", modifiers: .command)
        }
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
            Button(T("Reload")) { Task { await refreshAll(silent: false) } }.keyboardShortcut("r", modifiers: .command)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    // MARK: Actions

    private func select(_ day: String) {
        withAnimation(.snappy(duration: 0.2)) { selected = day }
    }

    private func goToday() { select(today) }
    private func retryNow() { Task { await refreshAll(silent: true) } }
    private func resetFilters() { filtersBinding.wrappedValue = CalFilters() }

    private func step(_ n: Int) {
        select(mode == .people ? CalDays.addDays(selected, 7 * n) : CalDays.shiftMonth(selected, n))
    }

    private func toggleCollapse(_ key: String) {
        var set = collapsed
        if set.contains(key) { set.remove(key) } else { set.insert(key) }
        collapsedJSON = (try? String(data: JSONEncoder().encode(Array(set).sorted()), encoding: .utf8)) ?? "[]"
    }

    /// Editable through its home project → the full task screen; otherwise read-only. Masked rows never open.
    private func openItem(_ item: CalItem) {
        guard !item.masked, let id = item.taskId else { return }
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

    /// A link to /calendar?date=… (notification, deep link) picks the day once.
    private func claimRouterDate() {
        guard let day = router.calendarDate else { return }
        router.calendarDate = nil
        // A day link while a task is open on top: back to the Calendar. When the link names a task as
        // well, claimRouterTask clears the cover itself and waits for the pop before opening.
        if router.calendarTaskId == nil {
            openTaskId = nil
            sheet = nil
        }
        if day.count == 10, CalDays.key(CalDays.date(day)) == day { mode = .month; selected = day }
    }

    // MARK: Loading

    private func firstLoad() async {
        if structure == nil, let hit = ResponseCache.decoded(APIClient.calStructureKey(uid), as: CalStructure.self) { setStructure(hit.value) }
        if items == nil, let hit = ResponseCache.decoded(APIClient.calItemsKey(uid, from: range.from, to: range.to), as: CalItemsResponse.self) {
            items = hit.value
            loading = false
        }
        if overdue == nil, let hit = ResponseCache.decoded(APIClient.calOverdueKey(uid), as: CalOverdueResponse.self) { overdue = hit.value }
        // The items of the month on screen are `.task(id: rangeKey)`'s job.
        await loadStructure()
        await loadOverdue()
    }

    private func refreshAll(silent: Bool) async {
        await loadStructure()
        await loadItems(silent: silent)
        await loadOverdue()
    }

    /// The structure and its index always change together.
    private func setStructure(_ s: CalStructure) {
        structure = s
        ix = CalIndex(units: s.units, people: s.people)
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

    private func loadItems(silent: Bool) async {
        let r = range
        loadGen += 1
        let gen = loadGen
        if !silent { loading = items == nil }
        fetching = true
        defer { if gen == loadGen { fetching = false; loading = false } }
        do {
            let fresh = try await APIClient.shared.calendarItems(from: r.from, to: r.to, userId: uid)
            guard r == range else { return }
            items = fresh
            error = nil
            savedAt = nil
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
                items = hit.value
                savedAt = hit.savedAt
                error = nil
            } else {
                // Keep what is on screen (the grid says it is another range, with Try again).
                error = failure.localizedDescription
                if items?.from != r.from { savedAt = nil }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadOverdue() async {
        do { overdue = try await APIClient.shared.calendarOverdue(userId: uid) } catch { /* the rail just stays empty */ }
    }

    /// Ask again every `calendarPollSeconds` while the screen is up and the app is in front.
    private func pollLoop() async {
        while !Task.isCancelled {
            let seconds = RemoteConfig.shared.calendarPollSeconds
            try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
            if Task.isCancelled { return }
            now = Date()
            if active { await refreshAll(silent: true) }
        }
    }
}
