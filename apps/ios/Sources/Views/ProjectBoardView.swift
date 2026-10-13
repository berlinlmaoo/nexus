import SwiftUI

/// Project detail with the web's view-switcher tabs (Overview · Board · List · Calendar ·
/// Timeline · Pages · Forms · Chat). Task-centric tabs run off the one project(id) load.
struct ProjectDetailView: View {
    let projectId: String
    let projectName: String
    @Environment(AuthStore.self) private var auth
    @State private var detail: ProjectDetail?
    @State private var lanes: [ProjectDetail.Lane] = []   // detail.taskLists + subtasks merged in (board + list)
    @State private var loading = true
    @State private var error: String?
    /// Set when the board was rebuilt from disk because the server could not be reached.
    @State private var cachedFrom: Date?
    @State private var openTaskId: String?
    @State private var openProfile: ProfileTarget?
    @State private var tab: ProjectTab = .board
    @State private var showCreate = false
    /// "+" on the Forms tab (owner, 9 Oct 2026): a pushed form builder, not a third sheet here.
    @State private var newFormOpen = false
    @State private var showSettings = false
    /// ⌘N / ⌘, / ⌘[ / ⌘] / ⌘F do nothing while a sheet (the task popup, settings…) is up over the
    /// project: focus stays in the top-most sheet (QA BoD R2). SheetCover.swift.
    @State private var cover = SheetCover()
    @State private var prefillDue: Date?
    @State private var query = ""
    /// A filter opened from a count on the Overview (owner, 11 Oct 2026): open top-level tasks only,
    /// shown as a chip above the task tabs until it is cleared.
    @State private var drill: OverviewDrill?
    /// Bumped by "+" on a Pipeline Dashboard: the pipeline opens its New deal sheet.
    @State private var newDealRequest = 0
    /// An Outlet Sales Dashboard's month, calendar day and report draft, shared by its four tabs. Made
    /// once the project says it is one.
    @State private var outletStore: OutletSalesStore?
    /// An outlet opens on Overview once (later reloads leave the tab alone).
    @State private var outletLanded = false
    /// A link chose the tab (`?view=`), so the template's default tab must not replace it.
    @State private var tabFromLink = false
    /// A link asked for this form's builder (`?form=<id>`, the web's open form builder).
    @State private var linkedFormId: String?
    /// Multi-select for Duplicate on Board and List (always on since 11 Oct 2026, TaskBatchDuplicate.swift).
    @State private var selection = TaskSelection()
    @Environment(\.dismiss) private var dismiss
    /// True when pushed (a back button makes sense); false as the sidebar's root.
    @Environment(\.isPresented) private var isPresented
    // Project templates (12 Oct 2026; DEV server): the template this project was built from, the
    // project's saved views (only the Calendar's date field and the "My …" preset are read here), the
    // project's DATE fields for Calendar → Plot by, and the "My …" chip.
    @State private var template: ProjectTemplate?
    @State private var savedViews: [ProjectViewLite] = []
    @State private var dateFields: [CustomField] = []
    /// The Calendar's date: nil = due date, else a DATE custom field's id.
    @State private var plotBy: String?
    @State private var extrasLoaded = false
    /// "My meetings" & co.: only tasks assigned to me, on every task tab.
    @State private var mineOnly = false
    // Board like web/Notion (owner, 12 Oct 2026): saved views, the project's fields, undo, option edits.
    @State private var views: [ProjectViewFull] = []
    @State private var canEditShared = false
    @State private var allFields: [CustomField] = []
    /// The view picked on Board and on List (by id), remembered per project on this device.
    @State private var boardViewId: String?
    @State private var listViewId: String?
    @State private var undo: MoveUndo?
    /// The column order before a manual reorder, for its Undo.
    @State private var reorderUndo: ReorderUndo?
    /// Undo for a delete, a bulk assign or a bulk due date.
    @State private var customUndo: CustomUndo?
    @State private var bulkDue: BulkDueRequest?
    @State private var boardAlert: BoardAlert?
    @State private var alertText = ""
    @State private var filterView: ProjectViewFull?
    /// Can view / Can comment: a filter / sort kept on this screen only, per view id (not saved).
    @State private var screenConfigs: [String: ProjectViewConfig] = [:]
    /// iPad / Mac: the task opens as a centred sheet over the board (web popup; owner rejected a side
    /// peek). The phone pushes it, as before.
    @State private var sheetTask: TaskSheetRef?
    @Environment(\.horizontalSizeClass) private var hSize
    @FocusState private var searchFocused: Bool
    /// iPad / Mac: the tab row's search is a magnifier that opens into a field (web ToolbarSearch).
    @State private var searchOpen = false
    /// The ✨ tool on the tab row: GIDEON with this project as context (the web's AI Autofill has no app
    /// counterpart yet).
    @State private var gideonOpen = false
    /// "Add task ▾" → a section: the composer starts there. nil = the first to-do section.
    @State private var createLaneId: String?
    @Environment(AppRouter.self) private var router

    private var meId: String? { auth.session?.userId }

    static func isMine(_ t: BoardTask, me: String?) -> Bool {
        guard let me else { return false }
        return (t.assignees ?? []).contains { $0.user?.id == me }
    }

    private func open(_ id: String) {
        if hSize == .regular { sheetTask = TaskSheetRef(id: id) } else { openTaskId = id }
    }

    private var viewContext: ViewContext { ViewContext(fields: allFields, meId: meId, today: Date()) }

    /// The saved views shown as chips on a layout: the layout's built-in first, then the others of the same
    /// layout (e.g. "Per kategori" on Board). Calendar/Timeline/Table views are their own tabs here.
    private func viewsFor(_ layout: String) -> [ProjectViewFull] {
        let mine = views.filter { $0.layout == layout }
        return mine.filter { $0.builtin == layout } + mine.filter { $0.builtin != layout }.sorted { ($0.position ?? 0) < ($1.position ?? 0) }
    }
    private func activeView(_ layout: String) -> ProjectViewFull? {
        let list = viewsFor(layout)
        let id = layout == "list" ? listViewId : boardViewId
        return list.first { $0.id == id } ?? list.first
    }
    /// What the Board / List draws: the sections (search, drill, "My …" applied) through the view's
    /// filter, sort and grouping.
    private func displayLanes(_ layout: String) -> [ProjectDetail.Lane] {
        ViewEngine.lanes(filteredLanes, config: activeView(layout).map { configOf($0) }, ctx: viewContext)
    }
    /// The Table's row drop (a move); nil below Can edit, so nothing drops there.
    private var tableDrop: (([String], String, String?) -> Void)? {
        guard canEdit else { return nil }
        let visible = filteredLanes
        return { (ids: [String], laneId: String, before: String?) -> Void in
            dropped(ids, on: laneId, before: before, visible: visible)
        }
    }
    /// The view's config as drawn: an on-screen filter (read-only levels) over the saved one.
    private func configOf(_ v: ProjectViewFull) -> ProjectViewConfig { screenConfigs[v.id] ?? v.config }
    private func pickView(_ layout: String, _ id: String?) {
        if layout == "list" { listViewId = id } else { boardViewId = id }
        UserDefaults.standard.set(id, forKey: "nexus.view.\(projectId).\(layout)")
    }

    /// The "My …" preset's name: the saved view the server made for it, else the template's.
    private var myViewName: String? {
        if let v = savedViews.first(where: { $0.builtin == "mine" }), let n = v.name, !n.isEmpty { return n }
        return template?.myView?.name.text
    }

    /// Adding tasks needs Can edit or Full access (project access levels, owner 13 Oct 2026).
    private var canCreate: Bool { !(detail?.taskLists?.isEmpty ?? true) && canEdit }
    /// Can edit or more (access levels round 2): creating, moving, bulk edits, saved views, forms. Can view /
    /// Can comment see the project read-only. Unknown level (older server) = allowed.
    private var canEdit: Bool { detail?.canEditProject ?? true }

    // MARK: pencarian task di dalam project
    //
    // Menyaring di sini, BUKAN di tiap tab. Board, List, Spreadsheet, Calendar dan Timeline
    // semuanya menggambar dari `lanes`; menaruh kotak pencarian di salah satunya berarti hasil
    // yang berubah begitu orang berpindah tab, dan itu terbaca seperti kerusakan.
    //
    // Lajur yang isinya habis tersaring tetap DIGAMBAR, kosong. Menghilangkan lajurnya membuat
    // papan melompat-lompat setiap huruf diketik, dan menyembunyikan fakta bahwa lajur itu
    // memang tidak punya yang dicari.

    private var searchTokens: [String] {
        query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    }

    private var filteredLanes: [ProjectDetail.Lane] {
        let tokens = searchTokens
        let drill = self.drill
        guard !tokens.isEmpty || drill != nil || mineOnly else { return lanes }
        let now = Date()
        return lanes.map { lane in
            lane.with(tasks: (lane.tasks ?? []).filter {
                (tokens.isEmpty || Self.matches($0, laneName: lane.name, tokens: tokens))
                    && (drill?.matches($0, laneId: lane.id, today: now) ?? true)
                    && (!mineOnly || Self.isMine($0, me: meId))
            })
        }
    }

    /// Where an Overview count opens: Board, else List. nil when neither is shown.
    private var drillTab: ProjectTab? {
        let tabs = visibleTabs
        return tabs.contains(.board) ? .board : (tabs.contains(.list) ? .list : nil)
    }

    private var drillBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease.circle").font(.system(size: 13, weight: .semibold))
                .foregroundStyle(NX.violetText).accessibilityHidden(true)
            Text(String(format: T("Showing: %@"), drill?.title ?? "")).font(NXFont.text(13, .semibold))
                .foregroundStyle(NX.foreground).lineLimit(1)
            Text("\(matchCount)").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
            Spacer(minLength: 4)
            Button { drill = nil } label: {
                Text(T("Clear filter")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                    .padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .background(NX.accentBg.opacity(0.6))
    }

    /// The template's "My …" preset as a chip (web: a saved view filtered on assignee = me).
    private func myViewBar(_ name: String) -> some View {
        HStack(spacing: 8) {
            Button {
                mineOnly.toggle()
                // Turning it on lands on the preset's own tab when this one draws no tasks for it.
                if mineOnly, let t = template?.myViewTab, visibleTabs.contains(t), !ProjectTab.taskViews.contains(tab) && tab != .table {
                    tab = t
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: mineOnly ? "person.crop.circle.fill" : "person.crop.circle")
                        .font(.system(size: 12, weight: .semibold))
                    Text(name).font(NXFont.text(12, .semibold)).lineLimit(1)
                    if mineOnly { Text("\(matchCount)").font(NXFont.text(11, .semibold)).monospacedDigit() }
                }
                .foregroundStyle(mineOnly ? Color.white : NX.violetText)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(mineOnly ? NX.violet : NX.violet.opacity(0.10), in: Capsule())
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(mineOnly ? .isSelected : [])
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 2)
    }

    /// Calendar → Plot by: the due date, or one of the project's DATE fields. Remembered per project on
    /// this device; until picked, the project's Calendar view decides (a template sets it).
    private var plotChoices: [CalendarPlotChoice] {
        guard !dateFields.isEmpty else { return [] }
        return [CalendarPlotChoice(id: nil, name: T("Due date"))] + dateFields.map { CalendarPlotChoice(id: $0.id, name: $0.name) }
    }
    private var plotKey: String { "nexus.calendarPlot.\(projectId)" }
    private func choosePlot(_ id: String?) {
        plotBy = id
        UserDefaults.standard.set(id ?? "due", forKey: plotKey)
    }

    /// Once per screen: the template, the saved views and the DATE fields. Each is optional: a server
    /// without templates or views answers 404 and the screen is exactly what it was before.
    private func loadTemplateExtras(_ d: ProjectDetail) async {
        guard !extrasLoaded, d.type == nil || d.type == "TASK" else { return }
        extrasLoaded = true
        template = await ProjectTemplateStore.find(d.templateId)
        // A project built from a template opens on the template's tab (web: defaultTab).
        if let t = template?.defaultProjectTab, visibleTabs.contains(t), AppRouter.shared.projectLink == nil, !tabFromLink {
            tab = t
        }
        savedViews = (try? await APIClient.shared.projectViews(projectId)) ?? []
        allFields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? []
        dateFields = allFields.filter { $0.type.uppercased() == "DATE" }
        await reloadViews()
        boardViewId = UserDefaults.standard.string(forKey: "nexus.view.\(projectId).board")
        listViewId = UserDefaults.standard.string(forKey: "nexus.view.\(projectId).list")
        if let saved = UserDefaults.standard.string(forKey: plotKey) {
            plotBy = saved == "due" ? nil : (dateFields.contains { $0.id == saved } ? saved : nil)
        } else if let prop = savedViews.first(where: { $0.builtin == "calendar" })?.config?.dateProp, prop.hasPrefix("cf:") {
            let id = String(prop.dropFirst(3))
            plotBy = dateFields.contains { $0.id == id } ? id : nil
        }
    }

    /// Semua kata harus cocok, urutannya bebas — "budi invoice" menemukan task milik Budi yang
    /// judulnya menyebut invoice, yang tidak bisa dilakukan pencocokan satu potong utuh.
    ///
    /// Isi keranjangnya mengikuti web (`taskMatchesFilters` di $projectId.tsx) sejauh datanya ada:
    /// deskripsi TIDAK ikut karena /api/projects/:id memang tidak mengirimkannya ke sini, dan
    /// berpura-pura mencarinya lebih buruk daripada tidak mencarinya.
    private static func matches(_ t: BoardTask, laneName: String, tokens: [String]) -> Bool {
        var hay = [t.title, laneName, t.status ?? "", t.priority ?? "", t.parent?.title ?? ""]
        hay.append(contentsOf: (t.assignees ?? []).compactMap { $0.user?.name })
        hay.append(contentsOf: (t.customFieldValues ?? []).compactMap { $0.value })
        let joined = hay.joined(separator: " ").lowercased()
        return tokens.allSatisfy { joined.contains($0) }
    }

    /// Tab yang menggambar task, jadi tab yang pantas punya kotak pencarian. Pages, Forms dan Chat
    /// punya isinya sendiri dan kotak yang tidak menyaring apa pun di sana hanya
    /// menjanjikan sesuatu yang tidak terjadi.
    private var searchApplies: Bool {
        switch tab {
        // Overview SENGAJA tidak ikut: ia menggambar dari `detail`, bukan `lanes`, jadi kotak
        // pencarian di sana akan ada tapi tidak menyaring apa pun.
        case .board, .list, .table, .calendar, .timeline: return true
        default: return false
        }
    }

    /// The task tabs with multi-select + Duplicate. Not an outlet's Board, which shows its events.
    private var selectionApplies: Bool { !isOutlet && !isPipeline && canEdit && (tab == .board || tab == .list || tab == .table) }

    /// The selected tasks in board order (lanes, then position), skipping any that vanished meanwhile.
    private func tasksFor(_ ids: [String]) -> [BoardTask] {
        let wanted = Set(ids)
        return lanes.flatMap { $0.tasks ?? [] }.filter { wanted.contains($0.id) }
    }

    private var matchCount: Int { filteredLanes.reduce(0) { $0 + ($1.tasks?.count ?? 0) } }
    private var totalCount: Int { lanes.reduce(0) { $0 + ($1.tasks?.count ?? 0) } }

    /// A board opened from a notification knows the project's id and nothing else — the name
    /// arrives with the payload rather than with the push, so fall back to whatever the board
    /// itself reports once it lands.
    private var displayName: String { projectName.isEmpty ? (detail?.name ?? "") : projectName }

    // MARK: which tabs this project actually gets
    //
    // Same rules as the web's tab bar (owner, 9 Oct 2026):
    //   • a project hides the tabs it doesn't need — Project settings → Tabs, stored as
    //     Project.hiddenTabs with the same keys as web (ProjectTab.key). Hiding only hides.
    //   • Finance and P&L are gone (owner, 11 Oct 2026): no tab, whatever the old flags say.
    private var hiddenTabKeys: Set<String> { Set(detail?.hiddenTabs ?? []) }

    /// A Pipeline Dashboard (owner, 9 Oct 2026): its deals are the project, so it shows Pipeline (first,
    /// and where it opens) and Chat — none of the task tabs, as on the
    /// web. Its three default task sections stay on the server only so an app that does not know the
    /// type still opens it as an empty task project.
    private var isPipeline: Bool { detail?.type == "PIPELINE" }

    /// An Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan): Overview · Calendar · Board · Report form
    /// · Chat — the web's order, none of the task tabs. Its Overview,
    /// Calendar and Board are the outlet's own (OutletSalesView.swift), not the task ones of the same name.
    private var isOutlet: Bool { detail?.type == "OUTLET_SALES" }

    private var visibleTabs: [ProjectTab] {
        if isOutlet {
            var tabs = ProjectTab.outletTabs
            if !hiddenTabKeys.contains(ProjectTab.chat.key ?? "") { tabs.append(.chat) }
            return tabs
        }
        return ProjectTab.allCases.filter {
            switch $0 {
            case .pipeline: return isPipeline
            case .reportForm: return false
            case .chat:     return !hiddenTabKeys.contains($0.key ?? "")
            default:        return !isPipeline && !hiddenTabKeys.contains($0.key ?? "")
            }
        }
    }

    /// Where to land when the open tab is not (or no longer) shown: Board, else List, else the first
    /// tab there is — which for a Pipeline Dashboard is Pipeline.
    private var fallbackTab: ProjectTab {
        if isOutlet { return .overview }
        let tabs = visibleTabs
        return tabs.first { ProjectTab.taskViews.contains($0) } ?? tabs.first ?? .board
    }

    @State private var actionError: String?
    /// "Your access to this project changed" (socket taken out of the project's room, reason revoked).
    @State private var accessToast: FailureToastPayload?
    /// A new task that could not be created while offline / on a blip, and that the inline card could not
    /// take back (it had closed): kept here with Try again (web createInline toast, QA 13 Oct 2026).
    @State private var keptNewTask: KeptNewTask?
    struct KeptNewTask: Identifiable { let id = UUID(); let laneId: String; let title: String; let reason: String }

    var body: some View {
        redesignChrome(baseBody)
    }

    /// The redesign's sheets and alert, kept off `baseBody`'s long modifier chain so the type checker
    /// has two shorter expressions instead of one very long one.
    private func redesignChrome<Content: View>(_ content: Content) -> some View {
        content
            // iPad / Mac: a centred sheet (a form sheet on a wide screen), closed with its own button.
            .sheet(item: $sheetTask, onDismiss: { Task { await reloadQuietly() } }) { ref in
                NavigationStack {
                    TaskDetailView(taskId: ref.id)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { sheetTask = nil }.keyboardShortcut(.cancelAction) } }
                }
            }
            .sheet(item: $filterView) { v in filterSheet(v) }
            .sheet(item: $bulkDue) { r in BulkDueSheet(count: r.taskIds.count) { day in bulkSetDue(r.taskIds, day) } }
            // A task deleted from its screen: Undo here for 10 s (own deletes, 30 min on the server).
            .onReceive(NotificationCenter.default.publisher(for: .nexusTaskDeletedUndoable)) { note in
                guard let id = note.userInfo?["auditLogId"] as? String else { return }
                let title = (note.userInfo?["title"] as? String) ?? ""
                customUndo = CustomUndo(label: title.isEmpty ? T("Task deleted") : String(format: T("Deleted “%@”"), title)) {
                    try? await APIClient.shared.undoDeleteTasks([id])
                }
                Task { await reloadQuietly() }
            }
            .alert(boardAlert?.title ?? "", isPresented: Binding(get: { boardAlert != nil }, set: { if !$0 { boardAlert = nil } }), presenting: boardAlert) { a in
                boardAlertActions(a)
            } message: { a in Text(a.message) }
            .background {
                // Its own anchor: this view already presents three sheets (one presentation per view).
                Color.clear.sheet(isPresented: $gideonOpen) {
                    GideonPanel(openContext: GideonContext(projectId: projectId, projectName: displayName)).environment(auth).environment(router)
                }
            }
            .background {
                // Keyboard: ⌘N = new task (iPad keyboard, Mac).
                Button("") { if !isPipeline && !isOutlet && canCreate && tab != .forms && !cover.isCovered { newTask(in: nil) } }
                    .keyboardShortcut("n", modifiers: .command)
                    .opacity(0).accessibilityHidden(true)
            }
    }

    private func filterSheet(_ v: ProjectViewFull) -> ViewFilterSheet {
        // Below Can edit the filter and sort stay on this screen (the server refuses saving a view).
        let local: ((ProjectViewConfig) -> Void)? = canEdit ? nil : { (c: ProjectViewConfig) -> Void in screenConfigs[v.id] = c }
        return ViewFilterSheet(view: v, lanes: lanes, fields: allFields, members: detail?.members ?? [], onSave: { patch in
            do {
                try await APIClient.shared.updateProjectView(projectId, viewId: v.id, patch: patch)
                await reloadViews()
                return nil
            } catch { return (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the view.") }
        }, onApplyLocal: local, startConfig: screenConfigs[v.id])
    }

    private var baseBody: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: statusBarTop)   // clear the status bar only (NOT the reserved nav-bar height)
            projectHeader
            tabBar
            Divider().overlay(NX.border)
            if let cachedFrom { OfflineNotice(savedAt: cachedFrom).padding(.vertical, 4) }
            // iPad / Mac: the search is the magnifier on the tab row, not a full-width bar.
            if searchApplies && !isOutlet && !loading && error == nil && !lanes.isEmpty && !wideBar { searchBar }
            if drill != nil && searchApplies && !isOutlet { drillBar }
            if let mine = myViewName, searchApplies && !isOutlet && !isPipeline { myViewBar(mine) }
            content
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if selection.active && selectionApplies {
                        TaskSelectionBar(selection: selection, visibleIds: visibleTaskIds,
                                         statusTargets: lanes,
                                         onMove: { ids, laneId in moveLater(ids, to: laneId) },
                                         onPriority: { ids, p in bulkPriority(ids, p) },
                                         members: detail?.members ?? [],
                                         onAssign: { ids, uid in bulkAssign(ids, uid) },
                                         onDue: { ids in bulkDue = BulkDueRequest(taskIds: ids) })
                    } else if let undo {
                        MoveUndoBar(undo: undo, onUndo: { Task { await performUndo(undo) } }, onDismiss: { if self.undo == undo { self.undo = nil } })
                    } else if let c = customUndo {
                        MoveUndoBar(undo: c.bar, onUndo: { let a = c.action; customUndo = nil; Task { await a(); await reloadQuietly() } },
                                    onDismiss: { if customUndo?.bar.id == c.bar.id { customUndo = nil } })
                    } else if let r = reorderUndo {
                        MoveUndoBar(undo: MoveUndo(id: r.id, count: r.count, groups: []), onUndo: { Task { await undoReorder(r) } }, onDismiss: { if reorderUndo?.id == r.id { reorderUndo = nil } })
                    }
                }
                // On `content` rather than the root, which already carries two sheets.
                .sheet(item: $selection.pendingDuplicate) { request in
                    TaskDuplicateSheet(tasks: tasksFor(request.taskIds)) { _ in
                        selection.clear()
                        await reloadQuietly()
                    }
                }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(projectBackground)
        .ignoresSafeArea(.container, edges: .top)   // the hidden nav bar's height stays in the top safe inset on iOS 26 → drop it
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .sheet(isPresented: $showCreate) {
            CreateTaskSheet(projectId: projectId, lanes: detail?.taskLists ?? [], prefillDue: prefillDue,
                            initialLaneId: createLaneId ?? StatusOptions.defaultOption(detail?.taskLists ?? [])?.id) { await load() }
        }
        .sheet(isPresented: $showSettings) {
            if let detail {
                ProjectSettingsView(projectId: projectId, detail: detail, onChange: { await load() }, onDeleted: { dismiss() })
            }
        }
        .task { await load() }
        // Reported for the UI tour's "did the route land" check (AppRouter.projectOnScreen).
        .onAppear { AppRouter.shared.projectOnScreen = projectId }
        .onDisappear { if AppRouter.shared.projectOnScreen == projectId { AppRouter.shared.projectOnScreen = nil } }
        .onChange(of: tab, initial: true) { _, now in AppRouter.shared.projectTabOnScreen = now.rawValue.lowercased() }
        // The open tab was just hidden (in settings, or live from another device): land on Board,
        // else List, else whatever is left.
        .onChange(of: visibleTabs) { _, tabs in
            if !tabs.contains(tab) { tab = fallbackTab }
        }
        // Selection lives on Board and List only; any other tab leaves selection mode.
        .onChange(of: tab) { _, _ in
            if !selectionApplies { selection.clear() }
        }
        // Live (owner, 8 Oct 2026): a task created, moved, edited or deleted on another device — or
        // the project itself renamed or changed — shows on the board, list, sheet, calendar and
        // timeline without a reload. The server sends task events only to the project's room, which
        // this screen holds while it is up; the timer is the fallback for when the connection is down.
        .realtimeRoom("project:\(projectId)")
        // Access ended while open: say so and reload, which lands on the no-access state.
        .onReceive(NotificationCenter.default.publisher(for: .nexusRoomRevoked)) { note in
            guard (note.userInfo?[RealtimeKey.room] as? String) == "project:\(projectId)" else { return }
            accessToast = FailureToastPayload(title: T("Your access to this project changed"),
                                              detail: T("Ask its Project Owner if you still need it."))
            Task { await load() }
        }
        .failureToast($accessToast)
        .liveRefresh(every: 60, on: [.nexusProjectTasksChanged, .nexusWorkspaceChanged],
                     kinds: [RealtimeKind.projects], projectId: projectId) { await reloadQuietly() }
        .alert(T("Couldn't update the board"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
        .alert(T("Couldn't add the task"), isPresented: Binding(get: { keptNewTask != nil }, set: { if !$0 { keptNewTask = nil } }), presenting: keptNewTask) { k in
            // Re-sends it as typed. The card is gone, so this is the only copy: no duplicate.
            Button(T("Try again")) { Task { _ = await addTask(laneId: k.laneId, title: k.title, kept: { false }) } }
            Button(T("Discard"), role: .destructive) {}
        } message: { k in Text("“\(k.title)” · \(k.reason)") }
        // Recorded here rather than at each tap site, so a project counts as visited whichever
        // route led in: the projects list, a sidebar shortcut, or a link out of a task.
        .task { if !displayName.isEmpty { ProjectShortcuts.shared.visit(ProjectRef(id: projectId, name: displayName, icon: nil)) } }
        // The icon only exists after the board loads, so record it again when it arrives.
        .onChange(of: detail?.icon) { _, icon in
            if !displayName.isEmpty { ProjectShortcuts.shared.visit(ProjectRef(id: projectId, name: displayName, icon: icon, color: detail?.color)) }
        }
        // The colour draws the project's mark (ProjectMark) in the shortcut rows; record a change too.
        .onChange(of: detail?.color) { _, color in
            if !displayName.isEmpty { ProjectShortcuts.shared.visit(ProjectRef(id: projectId, name: displayName, icon: detail?.icon, color: color)) }
        }
        // A board reached from a notification has no name to record on the way in, and a nameless
        // row in the shortcut list is worse than no row at all. Catch it when the board finally
        // reports one — which for a project without an icon the line above never would.
        .onChange(of: detail?.name) { _, _ in
            if !displayName.isEmpty { ProjectShortcuts.shared.visit(ProjectRef(id: projectId, name: displayName, icon: detail?.icon, color: detail?.color)) }
        }
        .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }

        .navigationDestination(isPresented: $newFormOpen) {
            FormBuilderView(projectId: projectId, projectName: displayName, formId: nil)
        }
        .navigationDestination(item: $linkedFormId) { formId in
            FormBuilderView(projectId: projectId, projectName: displayName, formId: formId)
        }
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
    }

    /// Real status-bar height from the window (does NOT include the reserved nav-bar height that the
    /// container top-safe-inset keeps even with the bar hidden on iOS 26).
    private var statusBarTop: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow)?.safeAreaInsets.top ?? 47
    }

    /// Single-expression background (a `.background { multi-statement closure }` mishandles the top
    /// safe area and reserved a tall gap above the content).
    private var projectBackground: some View {
        // Plain, as on the dev web: the page is the content, not a backdrop.
        NX.background.ignoresSafeArea()
    }

    // MARK: page header (dev web: the project's icon and a large title, actions on the right)

    private var wide: Bool { hSize == .regular }
    /// The web's one tab row (views as tabs, modules as icons, tools at the right): a task project on a
    /// wide screen. An outlet or a pipeline keeps its own short row.
    private var wideBar: Bool { wide && !isOutlet && !isPipeline }

    /// The task composer, starting in `laneId` (nil = the first to-do section, web addTask()).
    private func newTask(in laneId: String?) {
        guard !cover.isCovered else { return }
        prefillDue = nil
        createLaneId = laneId
        showCreate = true
    }

    private var projectHeader: some View {
        HStack(spacing: 10) {
            // ≡ while the iPad / Mac sidebar is collapsed: "≡ ✅ Tasks Tracker" (Notion, owner 14 Oct 2026).
            SidebarReopenButton()
            // Only when there is somewhere to go back to: opened from the sidebar the board is the root.
            if isPresented {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold)).foregroundStyle(NX.foreground)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(T("Back"))
            }
            ProjectMark(icon: detail?.icon, color: nil, size: wide ? 34 : 28, projectId: projectId)
            Text(displayName).font(NXFont.display(wide ? 26 : 20, wide ? .semibold : .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                // The name before the buttons: a portrait iPad cut it to "Finance P…" (UI tour run 5).
                .layoutPriority(1)
            if let chip = detail?.readOnlyLevelChip { ProjectLevelChip(text: chip) }
            Spacer(minLength: 6)
            if let d = detail {
                // iPad / Mac (web header): the members' faces, then Ask GIDEON and Project settings.
                if wide { ProjectMemberStack(members: d.members ?? []) { if !cover.isCovered { showSettings = true } }.padding(.trailing, 4) }
                // Ask GIDEON about this project: a new chat scoped to it (web header, 12 Oct 2026).
                AskGideonButton(context: GideonContext(projectId: projectId, projectName: displayName), labelled: wide)
                ProjectHeaderButton(title: T("Project settings"), icon: "slider.horizontal.3", labelled: wide) { if !cover.isCovered { showSettings = true } }
                    .keyboardShortcut(",", modifiers: .command)
            }
            // iPad / Mac: Add task lives on the tab row (split button), not in the header (web 267).
            if !wideBar { addButton }
        }
        .padding(.leading, isPresented ? 6 : (wide ? 24 : 14))
        .padding(.trailing, wide ? 24 : 14)
        .padding(.top, wide ? 12 : 4).padding(.bottom, 4)
    }

    /// On the Forms tab "+" means New form, as on the web's Forms tab; on every other tab it is New task.
    /// A Pipeline Dashboard has no task header (web): "+" is New deal on Pipeline and absent on its other
    /// tabs. An outlet's "Add event" sits in its own header row, next to the month.
    @ViewBuilder private var addButton: some View {
        if tab == .pipeline {
            ProjectHeaderButton(title: T("New deal"), icon: "plus", labelled: wide, prominent: true) { newDealRequest += 1 }
        } else if !isPipeline && !isOutlet && canEdit {
            // Can view / Can comment: no Add task / New form (access levels round 2).
            ProjectHeaderButton(title: tab == .forms ? T("New form") : T("Add task"), icon: "plus", labelled: wide,
                                prominent: true, enabled: tab == .forms || canCreate) {
                if tab == .forms { newFormOpen = true } else { newTask(in: nil) }
            }
        }
    }

    // MARK: tab row (dev web: icon + label chips, the saved views beside their layout, "+" new view)

    private func layoutOf(_ t: ProjectTab) -> String? {
        switch t {
        case .board: return "board"
        case .list: return "list"
        default: return nil
        }
    }

    /// The saved views of a layout other than its built-in one ("Per kategori" on Board).
    private func extraViews(_ t: ProjectTab) -> [ProjectViewFull] {
        guard let layout = layoutOf(t) else { return [] }
        return viewsFor(layout).filter { $0.builtin != layout }
    }

    private func viewTitle(_ v: ProjectViewFull) -> String {
        v.title(fieldName: { id in allFields.first { $0.id == id }?.name })
    }

    private func tabIsOn(_ t: ProjectTab) -> Bool {
        guard tab == t else { return false }
        guard let layout = layoutOf(t), let v = activeView(layout) else { return true }
        return v.builtin == layout
    }

    private func pickTab(_ t: ProjectTab) {
        tab = t
        if let layout = layoutOf(t), let builtin = viewsFor(layout).first(where: { $0.builtin == layout }) {
            pickView(layout, builtin.id)
        }
    }

    private var tabBar: some View {
        Group {
            if wideBar { wideTabBar } else { chipTabBar }
        }
        .padding(.vertical, 4)
        // Keyboard (iPad keyboard, Mac): ⌘[ / ⌘] previous / next tab, ⌘F search the project.
        .background {
            Group {
                Button("") { if !cover.isCovered { stepTab(-1) } }.keyboardShortcut("[", modifiers: .command)
                Button("") { if !cover.isCovered { stepTab(1) } }.keyboardShortcut("]", modifiers: .command)
                Button("") {
                    guard searchApplies && !cover.isCovered else { return }
                    if wideBar { searchOpen = true }
                    searchFocused = true
                }.keyboardShortcut("f", modifiers: .command)
                SheetCover.Anchor(cover: cover).frame(width: 0, height: 0)
            }
            .opacity(0).accessibilityHidden(true)
        }
    }

    /// The phone's row (and an outlet's / a pipeline's anywhere): every tab as an icon + label chip.
    private var chipTabBar: some View {
        HStack(spacing: 4) {
            ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(chipItems) { item in
                        Group {
                            switch item {
                            case .tab(let t): tabChip(t)
                            case .view(let v, let t): viewChip(v, tab: t)
                            }
                        }
                        .id(item.id)
                    }
                    if let layout = layoutOf(tab), canEdit {
                        Button { alertText = ""; boardAlert = .newView(layout: layout) } label: {
                            Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 34, height: 34).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                        .accessibilityLabel(T("New view"))
                    }
                }
                .padding(.horizontal, wide ? 18 : 8)
            }
            .modifier(TabRowOverflow(activeId: activeTabItemId, proxy: proxy))
            }
            if let layout = layoutOf(tab), let v = activeView(layout) {
                let filtered = configOf(v).isFiltered
                Button { filterView = v } label: {
                    Image(systemName: filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(filtered ? NX.violetText : NX.mutedFg)
                        .frame(width: 40, height: 40).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .padding(.trailing, wide ? 18 : 8)
                .accessibilityLabel(T("Filter and sort…"))
            }
        }
    }

    // MARK: wide tab row (dev web 267: Overview · the views · + | module icons … tools · Add task ▾)

    /// A view tab on the wide row: a built-in task tab, or a saved view of Board / List.
    private enum ViewTabItem: Identifiable {
        case tab(ProjectTab)
        case view(ProjectViewFull, ProjectTab)
        var id: String {
            switch self {
            case .tab(let t): return "tab:\(t.rawValue)"
            case .view(let v, _): return "view:\(v.id)"
            }
        }
    }

    private static let viewTabOrder: [ProjectTab] = [.board, .list, .table, .calendar, .timeline]
    private static let moduleTabOrder: [ProjectTab] = [.sheet, .pages, .forms, .chat]

    /// The views in the project's own order (web: by the view's position), the saved views of a layout
    /// among them; before the views load, the app's order.
    private var viewTabItems: [ViewTabItem] {
        let shown = visibleTabs.filter { Self.viewTabOrder.contains($0) }
        var ranked: [(pos: Int, seq: Int, item: ViewTabItem)] = []
        var seq = 0
        for (i, t) in shown.enumerated() {
            let builtinPos = views.first { $0.builtin == t.key }?.position
            ranked.append((pos: builtinPos ?? i, seq: seq, item: ViewTabItem.tab(t))); seq += 1
            for v in extraViews(t) {
                ranked.append((pos: v.position ?? (builtinPos ?? i), seq: seq, item: ViewTabItem.view(v, t))); seq += 1
            }
        }
        return ranked.sorted { $0.pos != $1.pos ? $0.pos < $1.pos : $0.seq < $1.seq }.map(\.item)
    }

    /// The phone row in the same order as the wide one and the web: the views by the project's own
    /// position, where the first view tab would sit; every other tab where it was. The phone used the
    /// app's fixed order, so "Board" came before "Per kategori" while the web, the iPad and the Mac put
    /// it after (UI tour run 4).
    private var chipItems: [ViewTabItem] {
        var out: [ViewTabItem] = []
        var placed = false
        for t in visibleTabs {
            if Self.viewTabOrder.contains(t) {
                if !placed { out += viewTabItems; placed = true }
            } else {
                out.append(.tab(t))
            }
        }
        return out
    }

    private var wideTabBar: some View {
        HStack(spacing: 8) {
            ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    if visibleTabs.contains(.overview) { wideViewTab(.tab(.overview)).id(ViewTabItem.tab(.overview).id) }
                    ForEach(viewTabItems) { item in wideViewTab(item).id(item.id) }
                    if canEdit {
                        Button { alertText = ""; boardAlert = .newView(layout: layoutOf(tab) ?? "board") } label: {
                            Image(systemName: "plus").font(.system(size: 14, weight: .regular)).foregroundStyle(NX.mutedFg)
                                .frame(width: 34, height: 34).frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                        .help(T("New view"))
                        .accessibilityLabel(T("New view"))
                    }
                    let modules = Self.moduleTabOrder.filter { visibleTabs.contains($0) }
                    if !modules.isEmpty {
                        ProjectTabDivider()
                        ForEach(modules) { t in
                            ProjectIconTab(title: t.label, icon: t.macIcon, on: tab == t) { pickTab(t) }
                                .id(ViewTabItem.tab(t).id)
                        }
                    }
                }
                .padding(.leading, 18)
            }
            .modifier(TabRowOverflow(activeId: activeTabItemId, proxy: proxy))
            }
            wideTools
                .fixedSize()
                .padding(.trailing, 24)
        }
    }

    /// The id of the tab (or saved view) on screen, as the rows tag their items.
    private var activeTabItemId: String {
        if let layout = layoutOf(tab), let v = activeView(layout), v.builtin != layout {
            return ViewTabItem.view(v, tab).id
        }
        return ViewTabItem.tab(tab).id
    }

    @ViewBuilder private func wideViewTab(_ item: ViewTabItem) -> some View {
        switch item {
        case .tab(let t):
            let builtin = layoutOf(t).flatMap { l in viewsFor(l).first { $0.builtin == l } }
            ProjectViewTab(title: t.label, icon: t.macIcon, on: tabIsOn(t),
                           filtered: builtin.map { configOf($0).isFiltered } ?? false,
                           hasMenu: builtin != nil, action: { pickTab(t) }) {
                if let builtin { viewMenuItems(builtin) }
            }
            .contextMenu { if let builtin { viewMenuItems(builtin) } }
        case .view(let v, let t):
            let layout = layoutOf(t) ?? "board"
            ProjectViewTab(title: viewTitle(v), icon: t.macIcon, on: tab == t && activeView(layout)?.id == v.id,
                           filtered: configOf(v).isFiltered, hasMenu: true,
                           action: { tab = t; pickView(layout, v.id) }) {
                viewMenuItems(v)
            }
            .contextMenu { viewMenuItems(v) }
        }
    }

    /// The tools at the right of the wide row. Filter / sort / group / view settings act on the Board or
    /// List view on screen (they are one sheet in the app); search on every task tab.
    private var wideTools: some View {
        HStack(spacing: 2) {
            if let layout = layoutOf(tab), let v = activeView(layout) {
                let c = configOf(v)
                ProjectToolIcon(icon: "line.3.horizontal.decrease", label: T("Filter"), active: c.isFiltered) { filterView = v }
                ProjectToolIcon(icon: "arrow.up.arrow.down", label: T("Sort"), active: !c.sort.isEmpty) { filterView = v }
                ProjectToolIcon(icon: "rectangle.grid.1x2", label: T("Group"), active: (c.groupBy ?? "section") != "section") { filterView = v }
            }
            if visibleTabs.contains(.automations) {
                ProjectToolIcon(icon: "bolt", label: T("Automations"), active: tab == .automations) { tab = .automations }
            }
            if detail != nil {
                ProjectToolIcon(icon: "sparkles", label: T("Ask GIDEON")) { if !cover.isCovered { gideonOpen = true } }
            }
            if searchApplies && !lanes.isEmpty {
                ProjectToolbarSearch(query: $query, open: $searchOpen, focused: $searchFocused,
                                     count: "\(matchCount)/\(totalCount)")
            }
            if let layout = layoutOf(tab), let v = activeView(layout) {
                Menu { viewMenuItems(v) } label: {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 15, weight: .regular)).foregroundStyle(NX.mutedFg)
                        .frame(width: 34, height: 34).frame(minHeight: 44).contentShape(Rectangle())
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .help(T("View settings"))
                .accessibilityLabel(T("View settings"))
            }
            wideAddButton.padding(.leading, 8)
        }
    }

    /// Add task ▾ on the task tabs; New form on Forms (web Forms tab). Nothing below Can edit.
    @ViewBuilder private var wideAddButton: some View {
        if canEdit {
            if tab == .forms {
                Button { newFormOpen = true } label: { Label(T("New form"), systemImage: "plus") }
                    .buttonStyle(.nxPrimary)
            } else {
                AddTaskSplitButton(sections: StatusOptions.ordered(detail?.taskLists ?? []), enabled: canCreate) { laneId in
                    newTask(in: laneId)
                }
            }
        }
    }

    private func tabChip(_ t: ProjectTab) -> some View {
        let builtin = layoutOf(t).flatMap { l in viewsFor(l).first { $0.builtin == l } }
        return ProjectTabChip(title: t.label, icon: t.icon, on: tabIsOn(t),
                              filtered: builtin.map { configOf($0).isFiltered } ?? false) { pickTab(t) }
            .contextMenu {
                if let builtin { viewMenuItems(builtin) }
            }
    }

    private func viewChip(_ v: ProjectViewFull, tab t: ProjectTab) -> some View {
        let layout = layoutOf(t) ?? "board"
        return ProjectTabChip(title: viewTitle(v), icon: t.icon, on: tab == t && activeView(layout)?.id == v.id,
                              filtered: configOf(v).isFiltered) {
            tab = t
            pickView(layout, v.id)
        }
        .contextMenu { viewMenuItems(v) }
    }

    @ViewBuilder private func viewMenuItems(_ v: ProjectViewFull) -> some View {
        Button { filterView = v } label: { Label(T("Filter and sort…"), systemImage: "line.3.horizontal.decrease.circle") }
        // Saved views are made, renamed and deleted from Can edit (access levels round 2).
        if canEdit {
            Button { alertText = v.name ?? ""; boardAlert = .renameView(v) } label: { Label(T("Rename…"), systemImage: "pencil") }
            if v.canDelete {
                Button(role: .destructive) { boardAlert = .deleteView(v) } label: { Label(T("Delete view"), systemImage: "trash") }
            }
        }
    }

    private func stepTab(_ d: Int) {
        let tabs = visibleTabs
        guard let i = tabs.firstIndex(of: tab), tabs.indices.contains(i + d) else { return }
        tab = tabs[i + d]
    }

    // MARK: kotak pencarian

    private var searchBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                TextField(T("Search tasks in this project…"), text: $query)
                    .focused($searchFocused)
                    .font(NXFont.text(14))
                    .foregroundStyle(NX.foreground)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                if !query.isEmpty {
                    // Angkanya sebelum tombol hapus: "0 dari 84" adalah jawaban, bukan kegagalan,
                    // dan tanpa itu papan kosong terbaca seperti board yang gagal dimuat.
                    Text("\(matchCount)/\(totalCount)")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                        .monospacedDigit()
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                            .touchTarget44(drawn: 18)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(query.isEmpty ? NX.border : NX.violet.opacity(0.55)))
            .padding(.horizontal, 14).padding(.vertical, 8)
            Divider().overlay(NX.border)
        }
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        if isOutlet, tab.isOutletView, let outletStore {
            OutletSalesTab(store: outletStore, tab: $tab)
        } else {
            taskContent
        }
    }

    @ViewBuilder private var taskContent: some View {
        switch tab {
        case .pipeline:
            if isPipeline { PipelineTab(projectId: projectId, newDealRequest: newDealRequest) }
            else { EmptyView() }
        case .pages: ProjectPagesTab(projectId: projectId)
        // The project's spreadsheet: its own data, not the tasks — no search box, no task filters.
        case .sheet: ProjectSheetsTab(projectId: projectId)
        case .forms: ProjectFormsBuilderTab(projectId: projectId, projectName: displayName, onNewForm: { newFormOpen = true }, canEdit: canEdit)
        case .chat:  ProjectChatTab(projectId: projectId, projectName: projectName, canPost: detail?.canCommentProject ?? true)
        case .automations: AutomationsTab(projectId: projectId)
        default:
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                ProjectUnavailableView(message: error, retry: { Task { await load() } }, goToProjects: { dismiss() })
            } else if let detail {
                switch tab {
                case .overview:
                    OverviewTab(
                        detail: detail,
                        onDrill: drillTab.map { target -> (OverviewDrill) -> Void in { (d: OverviewDrill) in drill = d; tab = target } },
                        onOpenTask: { open($0) },
                        onEditBrief: { showSettings = true },
                        onAddTask: canCreate ? { () -> Void in newTask(in: nil) } : nil,
                        onOpenMember: { openProfile = $0 }
                    )
                case .board:    boardTab(detail)
                case .list:     listTab()
                case .table:    tableTab()
                case .calendar: CalendarTab(tasks: filteredLanes.flatMap { $0.tasks ?? [] }, onOpen: { open($0) },
                                            onCreate: { date in if canCreate { prefillDue = date; createLaneId = nil; showCreate = true } },
                                            canCreate: canCreate,
                                            dateFieldId: plotBy, plotChoices: plotChoices, onPlotBy: { choosePlot($0) })
                case .timeline: TimelineTab(lanes: filteredLanes, onOpen: { open($0) })
                default:        EmptyView()
                }
            }
        }
    }

    /// A link into a task project: `?view=` names a tab by the web's key (board, list, table, calendar,
    /// timeline, overview, sheet, pages, forms, chat, automations), `?form=` opens that form's builder.
    /// Claimed once, and only for this project; a tab this project hides is ignored.
    private func claimLink() {
        guard let link = AppRouter.shared.projectLink, link.projectId == projectId else { return }
        AppRouter.shared.projectLink = nil
        if let key = link.view,
           let t = ProjectTab.allCases.first(where: { $0.rawValue.lowercased() == key || ($0 == .sheet && key == "sheet") }),
           visibleTabs.contains(t) {
            tab = t
            tabFromLink = true
        }
        if let form = link.form { linkedFormId = form }
    }

    /// The first load of an outlet: its store, Overview, and whatever a link asked for — `view`, `event`
    /// (the form on it, or the calendar on its day) and `date` (the calendar's day / a new event's day).
    private func landOutlet() {
        let store: OutletSalesStore
        if let outletStore { store = outletStore } else {
            store = OutletSalesStore(projectId: projectId)
            outletStore = store
        }
        if !outletLanded {
            outletLanded = true
            tab = .overview
        }
        guard let link = AppRouter.shared.projectLink, link.projectId == projectId else { return }
        AppRouter.shared.projectLink = nil
        let view = link.view ?? (link.event != nil ? "form" : nil)
        if let date = link.date {
            store.selectedDay = date
            Task { await store.show(month: String(date.prefix(7))) }
        }
        switch view {
        case "form":
            store.openForm(eventId: link.event, date: link.date)
            tab = .reportForm
        case "calendar":
            tab = .calendar
            if let id = link.event {
                Task {
                    if let e = await store.fetchEvent(id) {
                        store.selectedDay = e.date
                        await store.show(month: e.month)
                    }
                }
            }
        case "board": tab = .board
        default: tab = .overview
        }
    }

    @ViewBuilder private func viewChips(_ layout: String) -> some View {
        let list = viewsFor(layout)
        if !list.isEmpty {
            ViewChipsBar(
                views: list, activeId: activeView(layout)?.id,
                fieldName: { id in allFields.first { $0.id == id }?.name },
                onPick: { pickView(layout, $0) },
                onNew: { alertText = ""; boardAlert = .newView(layout: layout) },
                onFilter: { filterView = $0 },
                onRename: { v in alertText = v.name ?? ""; boardAlert = .renameView(v) },
                onDelete: { boardAlert = .deleteView($0) },
                canEdit: canEdit
            )
            Divider().overlay(NX.border)
        }
    }

    private var visibleTaskIds: [String] {
        if tab == .table { return filteredLanes.flatMap { ($0.tasks ?? []).map(\.id) } }
        return displayLanes(tab == .list ? "list" : "board").flatMap { ($0.tasks ?? []).map(\.id) }
    }

    /// The Table (web ProjectTableView): every task grouped by its status / section, edited in place.
    private func tableTab() -> ProjectTableTab {
        let statusOptions = StatusOptions.inUse(lanes)
        let editable = canEdit
        return ProjectTableTab(
            projectId: projectId,
            lanes: filteredLanes,
            allLanes: lanes,
            members: detail?.members ?? [],
            statusOptions: statusOptions,
            selection: editable ? selection : nil,
            onOpen: { open($0) },
            onDrop: tableDrop,
            onMoveTo: editable ? { (id: String, laneId: String) -> Void in moveLater([id], to: laneId) } : nil,
            onSetStatus: editable ? { (id: String, status: String) -> Void in setTaskStatus(id, status) } : nil,
            onSetPriority: editable ? { (id: String, p: String) -> Void in bulkPriority([id], p) } : nil,
            onToggleAssignee: editable ? { (id: String, uid: String, has: Bool) -> Void in toggleAssignee(id, uid, has) } : nil,
            onAddTask: (editable && canCreate) ? { (laneId: String, title: String) async -> String? in
                await addTask(laneId: laneId, title: title)
            } : nil
        )
    }

    /// The Table's status menu on a project without status options: the task's own status.
    private func setTaskStatus(_ id: String, _ status: String) {
        Task {
            do { _ = try await APIClient.shared.updateTask(id, ["status": status]) }
            catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the change.") }
            await reloadQuietly()
        }
    }

    /// The Table's assignee menu: adds or removes one person (web AssigneeCell).
    private func toggleAssignee(_ id: String, _ userId: String, _ has: Bool) {
        Task {
            do {
                if has { try await APIClient.shared.removeTaskAssignee(id, userId: userId) }
                else { try await APIClient.shared.addTaskAssignee(id, userId: userId) }
            } catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the change.") }
            await reloadQuietly()
        }
    }

    @ViewBuilder private func boardTab(_ detail: ProjectDetail) -> some View {
        let shown = displayLanes("board")
        let statusStyle = StatusOptions.inUse(lanes) && shown.allSatisfy { !$0.id.hasPrefix("grp:") }
        let grouped = shown.contains { $0.id.hasPrefix("grp:") }
        VStack(spacing: 0) {
            if !shown.isEmpty {
                // Horizontal-only: each column is a full-height lane that scrolls its own cards
                // vertically (see LaneColumn), so the board never pans in two directions at once.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        // Tasks other projects linked in: read-only lanes first, as on the web (grouped by
                        // section only — a board grouped by another property has nowhere to put them).
                        if !grouped {
                            ForEach(linkedLanes(detail)) { lane in linkedColumn(lane, groupRow: statusStyle) }
                        }
                        ForEach(Array(shown.enumerated()), id: \.element.id) { i, lane in
                            laneColumn(lane, at: i, in: shown, statusStyle: statusStyle, grouped: grouped)
                        }
                        if statusStyle && detail.canManageProject { addStatusColumn }
                    }
                    .padding(14)
                    .frame(maxHeight: .infinity, alignment: .top)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyState(icon: "square.stack.3d.up.slash", title: T("No sections yet"),
                           subtitle: T("This project has no sections yet. Add one from Project settings."),
                           actionTitle: T("Project settings"), actionIcon: "gearshape") { showSettings = true }
            }
        }
    }

    /// The tasks other projects linked into this one, one lane per source project, unfinished first (web
    /// linkedLanes). A task of this very project linked back into it is not repeated.
    private func linkedLanes(_ detail: ProjectDetail) -> [ProjectDetail.Lane] {
        var order: [String] = []
        var bySource: [String: (name: String, tasks: [BoardTask])] = [:]
        for list in detail.taskLists ?? [] {
            for link in list.taskProjects ?? [] {
                guard let task = link.task else { continue }
                let source = link.sourceProjectId ?? "linked"
                if source == projectId { continue }
                var group = bySource[source] ?? (name: link.sourceProjectName ?? T("Another project"), tasks: [BoardTask]())
                if !group.tasks.contains(where: { $0.id == task.id }) { group.tasks.append(task) }
                if bySource[source] == nil { order.append(source) }
                bySource[source] = group
            }
        }
        return order.compactMap { id in
            guard let g = bySource[id] else { return nil }
            let tasks = g.tasks.filter { !$0.isDone } + g.tasks.filter { $0.isDone }
            return ProjectDetail.Lane(id: "linked:\(id)", name: g.name, tasks: tasks)
        }
    }

    /// A linked lane: cards open their task, nothing is added, moved or dropped here.
    private func linkedColumn(_ lane: ProjectDetail.Lane, groupRow: Bool) -> LaneColumn {
        LaneColumn(
            lane: lane, allLanes: [lane], selection: selection,
            onOpen: { id in open(id) },
            onAddTask: { _, _ in nil },
            onDrop: { _, _ in },
            onMoveTo: { _, _ in },
            canAdd: false,
            canEdit: false,
            linked: true,
            groupRow: groupRow
        )
    }

    /// One column, built outside the ForEach so the type checker sees one plain call.
    private func laneColumn(_ lane: ProjectDetail.Lane, at i: Int, in shown: [ProjectDetail.Lane], statusStyle: Bool, grouped: Bool) -> LaneColumn {
        let firstOfGroup = i == 0 || shown[i - 1].group != lane.group
        let label: String? = statusStyle && firstOfGroup ? lane.group.label : nil
        var sectionStatus: ((String?) async -> Void)? = nil
        // Status columns are edited with Full access only (project access levels).
        let manages = detail?.canManageProject ?? true
        if !statusStyle && !grouped && manages {
            sectionStatus = { status in await setSectionStatus(lane.id, status) }
        }
        let addable = ViewEngine.groupTarget(lane.id)?.prop != "assignee"
        return LaneColumn(
            lane: lane, allLanes: shown, selection: selection,
            statusStyle: statusStyle || grouped,
            groupLabel: label,
            onOpen: { id in open(id) },
            onAddTask: { title, kept in await addTask(laneId: lane.id, title: title, kept: kept) },
            onDrop: { ids, before in dropped(ids, on: lane.id, before: before, visible: shown) },
            onMoveTo: { tid, lid in moveLater([tid], to: lid) },
            options: statusStyle && manages ? optionActions(lane) : nil,
            onSetStatus: sectionStatus,
            canAdd: addable && canEdit,
            canEdit: canEdit
        )
    }

    /// Bulk assign: adds the person to every selected task that does not have them (web); Undo removes
    /// them again from exactly those.
    private func bulkAssign(_ ids: [String], _ userId: String) {
        let tasks = lanes.flatMap { $0.tasks ?? [] }.filter { ids.contains($0.id) }
        Task {
            var added: [String] = []
            for t in tasks where !(t.assignees ?? []).contains(where: { $0.user?.id == userId }) {
                if (try? await APIClient.shared.addTaskAssignee(t.id, userId: userId)) != nil { added.append(t.id) }
            }
            selection.clear()
            customUndo = CustomUndo(label: added.count == 1 ? T("Assigned 1 task") : String(format: T("Assigned %d tasks"), added.count)) {
                for id in added { try? await APIClient.shared.removeTaskAssignee(id, userId: userId) }
            }
            await reloadQuietly()
        }
    }

    /// Bulk due date (or none); Undo puts each task's own date back.
    private func bulkSetDue(_ ids: [String], _ day: Date?) {
        let tasks = lanes.flatMap { $0.tasks ?? [] }.filter { ids.contains($0.id) }
        let value: Any
        if let day { value = Self.isoDay(day) } else { value = NSNull() }
        Task {
            var before: [(String, String?)] = []
            for t in tasks {
                if (try? await APIClient.shared.updateTask(t.id, ["dueDate": value])) != nil { before.append((t.id, t.dueDate)) }
            }
            selection.clear()
            customUndo = CustomUndo(label: before.count == 1 ? T("Changed the due date of 1 task") : String(format: T("Changed the due date of %d tasks"), before.count)) {
                for (id, old) in before {
                    let v: Any
                    if let old { v = String(old.prefix(10)) } else { v = NSNull() }
                    try? await APIClient.shared.updateTask(id, ["dueDate": v])
                }
            }
            await reloadQuietly()
        }
    }

    private static func isoDay(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: d)
    }

    /// Bulk priority from the selection bar: one batch call, Undo puts each task's old priority back.
    private func bulkPriority(_ ids: [String], _ priority: String) {
        let before = lanes.flatMap { $0.tasks ?? [] }.filter { ids.contains($0.id) }
        Task { await moveToGroup(before, prop: "priority", value: priority) }
    }

    private func moveLater(_ ids: [String], to laneId: String) {
        Task { await moveTasks(ids, to: laneId) }
    }

    @ViewBuilder private func listTab() -> some View {
        let shown = displayLanes("list")
        VStack(spacing: 0) {
            // Can view / Can comment: rows open, nothing selects or drags (access levels round 2).
            let drop: (([String], String, String?) -> Void)? = canEdit
                ? { (ids: [String], laneId: String, before: String?) -> Void in dropped(ids, on: laneId, before: before, visible: shown) }
                : nil
            ListTab(lanes: shown, fields: allFields, onOpen: { open($0) }, selection: canEdit ? selection : nil,
                    statusStyle: StatusOptions.inUse(lanes) || shown.contains { $0.id.hasPrefix("grp:") },
                    onDrop: drop,
                    statusOf: rowStatusLookup())
        }
    }

    /// Each task's status option (the real section it sits in), for the List's status pill. Built once
    /// per render; nil for every task when the project has no status options.
    private func rowStatusLookup() -> (BoardTask) -> RowStatus? {
        guard StatusOptions.inUse(lanes) else { return { _ in nil } }
        var byTask: [String: RowStatus] = [:]
        for lane in lanes {
            let st = RowStatus(name: lane.name, colorKey: lane.colorKey)
            for t in lane.tasks ?? [] { byTask[t.id] = st }
        }
        return { byTask[$0.id] }
    }

    /// "+ Status" after the last column: a new option in one of the three groups (web StatusPicker).
    private var addStatusColumn: some View {
        Menu {
            Section(T("Add a status to")) {
                ForEach(StatusGroup.allCases) { g in
                    Button(g.label) { alertText = ""; boardAlert = .addStatus(g) }
                }
            }
        } label: {
            Label(T("Status"), systemImage: "plus")
                .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                .frame(width: 140, height: 44)
                .contentShape(Rectangle())
        }
        .padding(.top, 18)
        .accessibilityLabel(T("Add a status"))
    }

    private func load() async {
        error = nil
        do {
            let d = try await APIClient.shared.project(projectId)
            detail = d
            // Before the task reads below, so an outlet never flashes an empty task board.
            if d.type == "OUTLET_SALES" { landOutlet() }
            // Best-effort: the project payload is parentId-only, so pull the full task set and merge
            // subtasks into their lane (under the parent) for the board + list. Calendar/Timeline use detail.
            let all = (try? await APIClient.shared.projectTasks(projectId)) ?? []
            lanes = Self.mergeSubtasks(into: d.taskLists ?? [], all: all)
            // If the selected tab just became hidden (e.g. the flag was turned off), fall back.
            if !visibleTabs.contains(tab) { tab = fallbackTab }
            if d.type != "OUTLET_SALES" { claimLink() }
            cachedFrom = nil
            Task { await loadTemplateExtras(d) }
        }
        catch APIError.unauthorized { auth.logout() }
        // Not restored from cache on purpose: 403 is the server saying this person is no longer on
        // the project, and answering that with the copy they had before is the one case where a
        // cache would be showing something it has been told not to.
        catch APIError.http(403, _) { error = ProjectOpenFailure.forbiddenText }
        catch APIError.http(404, _) { error = ProjectOpenFailure.notFoundText }
        catch {
            if restoreFromCache() {
                self.error = nil
            } else {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the project.")
            }
        }
        loading = false
    }

    /// The live reload: the same two requests as `load`, quietly. Nothing on screen changes unless
    /// both answer — no spinner, no error page, and no saved copy swapped in for a board that was
    /// live a moment ago. A board that never loaded is left to its own retry button.
    private func reloadQuietly() async {
        guard detail != nil, !loading else { return }
        guard let d = try? await APIClient.shared.project(projectId),
              let all = try? await APIClient.shared.projectTasks(projectId) else { return }
        detail = d
        lanes = Self.mergeSubtasks(into: d.taskLists ?? [], all: all)
        if !visibleTabs.contains(tab) { tab = fallbackTab }
        cachedFrom = nil
        error = nil
    }

    /// The board as it stood the last time the server answered. Lanes and tasks are merged by the
    /// same function the live path uses, so an offline board is arranged exactly like a live one
    /// rather than being a second, subtly different reading of the same data.
    private func restoreFromCache() -> Bool {
        guard let d = ResponseCache.decoded("project-\(projectId)", as: ProjectDetail.self) else { return false }
        detail = d.value
        let all = ResponseCache.decoded("project-tasks-\(projectId)", as: [BoardTask].self)?.value ?? []
        lanes = Self.mergeSubtasks(into: d.value.taskLists ?? [], all: all)
        if d.value.type == "OUTLET_SALES" { landOutlet() }
        if !visibleTabs.contains(tab) { tab = fallbackTab }
        cachedFrom = d.savedAt
        return true
    }

    /// Merge subtasks into their section lane, placed right under their parent (orphans — parent in
    /// another lane — go at the lane's end). Resolves each subtask's parent title client-side.
    static func mergeSubtasks(into sections: [ProjectDetail.Lane], all: [BoardTask]) -> [ProjectDetail.Lane] {
        // Status options draw in the web's order: To-do, In progress, Complete, then the project's own
        // order inside each group (StatusOptions.swift). Plain sections keep theirs.
        let lanes = StatusOptions.ordered(sections)
        let subs = all.filter { $0.isSubtask && !($0.taskListId ?? "").isEmpty }
        if subs.isEmpty { return lanes }
        var titleById: [String: String] = [:]
        for t in all { titleById[t.id] = t.title }
        var subsByLane: [String: [BoardTask]] = [:]
        for s in subs {
            var sub = s
            if let pid = s.parentId { sub.parent = BoardParent(id: pid, title: titleById[pid]) }
            subsByLane[s.taskListId!, default: []].append(sub)
        }
        return lanes.map { lane in
            guard let ls = subsByLane[lane.id], !ls.isEmpty else { return lane }
            let parents = lane.tasks ?? []
            let pidSet = Set(parents.map(\.id))
            var byParent: [String: [BoardTask]] = [:]
            var orphans: [BoardTask] = []
            for s in ls {
                if let pid = s.parentId, pidSet.contains(pid) { byParent[pid, default: []].append(s) }
                else { orphans.append(s) }
            }
            var out: [BoardTask] = []
            for p in parents { out.append(p); out.append(contentsOf: byParent[p.id] ?? []) }
            out.append(contentsOf: orphans)
            return lane.with(tasks: out)
        }
    }

    /// A new task from a column's inline card. A virtual column (a view grouped by priority or a field)
    /// makes the task in the default status and gives it that column's value; a filtered view fills in
    /// the filter's single values so the new task does not vanish at once (bughunt C-BUG-9).
    /// `kept` answers, after a failure, whether the inline card takes the title back; when it does not, a
    /// connection failure keeps the title here with Try again (one keeper, never two: QA 13 Oct 2026).
    private func addTask(laneId: String, title: String, kept: @escaping @MainActor () -> Bool = { false }) async -> String? {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        let layout = tab == .list ? "list" : "board"
        // The Table draws the real sections without a view: no view filter fills in values there.
        let config = (tab == .board || tab == .list) ? activeView(layout).map { configOf($0) } : nil
        var section = laneId
        var priority: String?
        var assignMe = false
        var fieldValues: [String: String] = [:]
        func take(_ prop: String, _ value: String) {
            if prop == "priority" { priority = value }
            else if prop == "section" { section = value }
            else if prop == "assignee" { assignMe = assignMe || value == ViewEngine.me || value == meId }
            else if prop.hasPrefix("cf:") { fieldValues[String(prop.dropFirst(3))] = value }
        }
        for r in config?.simple ?? [] where r.op == "any_of" && r.value.strings.count == 1 { take(r.prop, r.value.strings[0]) }
        if let g = ViewEngine.groupTarget(laneId) {
            section = StatusOptions.defaultOption(lanes)?.id ?? lanes.first?.id ?? ""
            if g.value != ViewEngine.none { take(g.prop, g.value) }
        }
        guard !section.isEmpty else { return nil }
        do {
            let id = try await APIClient.shared.createTask(projectId: projectId, taskListId: section, title: t,
                                                           priority: priority, placement: "top")
            if assignMe, let meId { try? await APIClient.shared.updateTask(id, ["assigneeIds": [meId]]) }
            for (fid, v) in fieldValues { try? await APIClient.shared.setCustomFieldValue(fieldId: fid, taskId: id, value: v) }
            await reloadQuietly()
            return id
        } catch {
            let reason = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't created.")
            let transient = isTransientFailure(error)
            if transient && kept() {
                // The card shows "It's back in the box" with the title in its field: nothing more here.
            } else if transient {
                keptNewTask = KeptNewTask(laneId: laneId, title: t, reason: reason)
            } else {
                // A refusal (no right to add, a 4xx): said, not retried.
                actionError = reason
            }
            return nil
        }
    }

    /// Lane menu → Section status (12 Oct 2026): what tasks moved into this section become.
    private func setSectionStatus(_ laneId: String, _ status: String?) async {
        do { try await APIClient.shared.setSectionTaskStatus(projectId: projectId, sectionId: laneId, taskStatus: status) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change it.") }
        await reloadQuietly()
    }

    /// Cards dropped on a column: a card that is part of the selection carries the whole selection (in
    /// screen order, only what is visible — bughunt C-BUG-4); an unselected card moves alone and clears
    /// the selection (web group-move).
    private func dropped(_ ids: [String], on laneId: String, before beforeId: String?, visible: [ProjectDetail.Lane]) {
        guard let first = ids.first else { return }
        let onScreen = visible.flatMap { ($0.tasks ?? []).map(\.id) }
        var moving: [String]
        if selection.active && selection.contains(first) {
            moving = onScreen.filter { selection.contains($0) }
        } else {
            moving = ids
            selection.clear()
        }
        let target = visible.first { $0.id == laneId }
        let inColumn: Set<String> = Set((target?.tasks ?? []).map(\.id))
        // Cards that already live in this column: manual order (web board, C-BUG-6) — only on a status /
        // section column of a view without a sort, as on the web.
        let sameColumn = moving.filter { inColumn.contains($0) }
        if !sameColumn.isEmpty, sameColumn.count == moving.count {
            if canReorder(laneId) { Task { await reorder(sameColumn, in: laneId, before: beforeId) } }
            return
        }
        moving = moving.filter { !inColumn.contains($0) }
        guard !moving.isEmpty else { return }
        Task { await moveTasks(moving, to: laneId) }
    }

    /// Manual order is offered on real columns of a view that is not sorted (web canReorder).
    private func canReorder(_ laneId: String) -> Bool {
        guard !laneId.hasPrefix("grp:") else { return false }
        let layout = tab == .list ? "list" : "board"
        let config = activeView(layout).map { configOf($0) }
        return (config?.sort.isEmpty ?? true) && ((config?.groupBy ?? "section") == "section")
    }

    /// The web's reorderIn: the moved cards (in their order) go before `beforeId`, or to the end.
    private func reorder(_ moved: [String], in laneId: String, before beforeId: String?) async {
        guard let lane = lanes.first(where: { $0.id == laneId }) else { return }
        let all = lane.tasks ?? []
        let order = all.filter { !$0.isSubtask }.map(\.id)
        let set = Set(moved)
        let rest = order.filter { !set.contains($0) }
        let at = beforeId.flatMap { rest.firstIndex(of: $0) } ?? rest.count
        let next = Array(rest[..<at]) + order.filter { set.contains($0) } + Array(rest[at...])
        guard next != order else { return }
        // On screen at once: top-level cards in the new order, each followed by its subtasks.
        let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let subs = all.filter(\.isSubtask)
        var arranged: [BoardTask] = []
        for id in next {
            if let t = byId[id] { arranged.append(t) }
            arranged.append(contentsOf: subs.filter { $0.parentId == id })
        }
        arranged.append(contentsOf: subs.filter { s in !next.contains(s.parentId ?? "") })
        lanes = lanes.map { l -> ProjectDetail.Lane in l.id == laneId ? l.with(tasks: arranged) : l }
        do {
            try await APIClient.shared.reorderTasks(taskListId: laneId, orderedIds: next, movedId: moved.first)
            reorderUndo = ReorderUndo(laneId: laneId, order: order, count: moved.count)
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't moved.")
            await reloadQuietly()
        }
    }

    /// Moves tasks to a column: on screen at once, then one POST /api/tasks/batch-move (the server runs
    /// each task's normal rules — column status, Done wins, automations — and announces each live).
    /// A virtual column sets its priority / field instead. Undo for 10 s puts every task back.
    private func moveTasks(_ ids: [String], to laneId: String) async {
        let all = lanes.flatMap { $0.tasks ?? [] }
        let before = ids.compactMap { id in all.first { $0.id == id } }
        guard !before.isEmpty else { return }
        if let g = ViewEngine.groupTarget(laneId) {
            await moveToGroup(before, prop: g.prop, value: g.value)
            return
        }
        // Optimistic: take the cards out of their columns and put them at the top of the target.
        let moved = Set(ids)
        let movedTasks = ids.compactMap { id in all.first { $0.id == id } }
        lanes = lanes.map { lane -> ProjectDetail.Lane in
            var rest = (lane.tasks ?? []).filter { !moved.contains($0.id) }
            if lane.id == laneId { rest = movedTasks + rest }
            return lane.with(tasks: rest)
        }
        do {
            let r = try await APIClient.shared.batchMoveTasks(ids, taskListId: laneId)
            if let f = r.failed, !f.isEmpty {
                actionError = String(format: T("%d of the tasks couldn't be moved."), f.count)
            }
            let okIds = Set(r.moved ?? ids)
            let groups = Dictionary(grouping: before.filter { okIds.contains($0.id) }) { "\($0.taskListId ?? "")|\($0.status ?? "")" }
            undo = MoveUndo(count: okIds.count, groups: groups.values.map { ts in
                MoveUndo.Group(taskIds: ts.map(\.id), laneId: ts.first?.taskListId, status: ts.first?.status, priority: nil)
            })
            selection.clear()
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't moved.")
        }
        await reloadQuietly()
    }

    /// A view grouped by priority or a select field: dropping sets that value.
    private func moveToGroup(_ tasks: [BoardTask], prop: String, value: String) async {
        let v = value == ViewEngine.none ? "" : value
        do {
            if prop == "priority" {
                _ = try await APIClient.shared.batchMoveTasks(tasks.map(\.id), priority: v.isEmpty ? "NONE" : v)
                let groups = Dictionary(grouping: tasks) { $0.priority ?? "NONE" }
                undo = MoveUndo(count: tasks.count, groups: groups.map { MoveUndo.Group(taskIds: $0.value.map(\.id), laneId: nil, status: nil, priority: $0.key) })
            } else if prop == "status" {
                _ = try await APIClient.shared.batchMoveTasks(tasks.map(\.id), status: v)
            } else if prop.hasPrefix("cf:") {
                let fid = String(prop.dropFirst(3))
                for t in tasks { try await APIClient.shared.setCustomFieldValue(fieldId: fid, taskId: t.id, value: v) }
            } else {
                actionError = T("Tasks can't be moved into this group. Change the person in the task instead.")
            }
            selection.clear()
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't moved.")
        }
        await reloadQuietly()
    }

    private func undoReorder(_ r: ReorderUndo) async {
        reorderUndo = nil
        try? await APIClient.shared.reorderTasks(taskListId: r.laneId, orderedIds: r.order, movedId: nil)
        await reloadQuietly()
    }

    private func performUndo(_ u: MoveUndo) async {
        undo = nil
        for g in u.groups {
            if let p = g.priority { _ = try? await APIClient.shared.batchMoveTasks(g.taskIds, priority: p) }
            else { _ = try? await APIClient.shared.batchMoveTasks(g.taskIds, taskListId: g.laneId, status: g.status) }
        }
        await reloadQuietly()
    }

    // MARK: status options + views (alerts)

    private func optionActions(_ lane: ProjectDetail.Lane) -> LaneOptionActions {
        LaneOptionActions(
            rename: { alertText = lane.name; boardAlert = .renameStatus(lane) },
            color: { key in Task { await optionChange { try await APIClient.shared.updateStatusOption(projectId: projectId, id: lane.id, color: key) } } },
            move: { dir in Task { await moveOption(lane, dir) } },
            delete: { moveTo in boardAlert = .deleteStatus(lane, moveTo: moveTo) }
        )
    }

    /// Left/right inside its group: takes the neighbour's position (web StatusPicker).
    private func moveOption(_ lane: ProjectDetail.Lane, _ dir: Int) async {
        let same = StatusOptions.ordered(lanes).filter { $0.group == lane.group }
        guard let i = same.firstIndex(where: { $0.id == lane.id }), same.indices.contains(i + dir) else { return }
        let other = same[i + dir]
        await optionChange { try await APIClient.shared.updateStatusOption(projectId: projectId, id: lane.id, position: other.position ?? (i + dir)) }
    }

    private func optionChange(_ work: () async throws -> Void) async {
        do { try await work() }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change the status options.") }
        await reloadQuietly()
    }

    private func reloadViews() async {
        if let r = try? await APIClient.shared.projectViewsFull(projectId) {
            views = r.views ?? []
            canEditShared = r.canEditShared ?? false
        }
    }

    @ViewBuilder private func boardAlertActions(_ a: BoardAlert) -> some View {
        switch a {
        case .renameStatus(let lane):
            TextField(T("Name"), text: $alertText)
            Button(T("Save")) {
                let name = alertText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty { Task { await optionChange { try await APIClient.shared.updateStatusOption(projectId: projectId, id: lane.id, name: name) } } }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .addStatus(let group):
            TextField(T("Name"), text: $alertText)
            Button(T("Add")) {
                let name = alertText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty {
                    Task { await optionChange { _ = try await APIClient.shared.createStatusOption(projectId: projectId, name: name, taskStatus: group.statusForNewOption(named: name)) } }
                }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .deleteStatus(let lane, let moveTo):
            Button(T("Delete"), role: .destructive) {
                Task { await optionChange { try await APIClient.shared.deleteStatusOption(projectId: projectId, id: lane.id, moveTo: moveTo) } }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .newView(let layout):
            TextField(T("Name"), text: $alertText)
            Button(T("Create")) {
                let name = alertText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty {
                    Task {
                        do {
                            let v = try await APIClient.shared.createProjectView(projectId, name: name, layout: layout, shared: false, config: ["groupBy": "section"])
                            await reloadViews()
                            pickView(layout, v.id)
                            filterView = v
                        } catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the view.") }
                    }
                }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .renameView(let v):
            TextField(T("Name"), text: $alertText)
            Button(T("Save")) {
                let name = alertText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty {
                    Task {
                        do { try await APIClient.shared.updateProjectView(projectId, viewId: v.id, name: name); await reloadViews() }
                        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the view.") }
                    }
                }
            }
            Button(T("Cancel"), role: .cancel) {}
        case .deleteView(let v):
            Button(T("Delete"), role: .destructive) {
                Task {
                    do { try await APIClient.shared.deleteProjectView(projectId, viewId: v.id); await reloadViews() }
                    catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete the view.") }
                }
            }
            Button(T("Cancel"), role: .cancel) {}
        }
    }

}

struct LaneColumn: View {
    let lane: ProjectDetail.Lane
    let allLanes: [ProjectDetail.Lane]
    let selection: TaskSelection
    /// The project works with status options: the column is tinted in its option's colour and its
    /// header is the option's pill (web board, owner 12 Oct 2026). Plain sections keep the old look.
    var statusStyle = false
    /// "To-do" / "In progress" / "Complete" above the first column of each group; nil elsewhere.
    var groupLabel: String? = nil
    let onOpen: (String) -> Void
    /// Creates a task in this column from the inline card; answers its id (nil = failed).
    let onAddTask: (String, @escaping @MainActor () -> Bool) async -> String?
    /// Task ids dropped on this column, and the card they were dropped on (nil = the column's empty end).
    /// The board decides: cards from this column are reordered (manual order), others move here; a
    /// selected card drags the whole selection.
    let onDrop: ([String], String?) -> Void
    /// The card menu's "Move to": one task to another column.
    let onMoveTo: (String, String) -> Void
    /// Status option actions (status options only); nil hides them.
    var options: LaneOptionActions? = nil
    /// Section status (plain sections only): nil = no menu.
    var onSetStatus: ((String?) async -> Void)? = nil
    /// False for a column that cannot take a new card (a group by assignee).
    var canAdd = true
    /// Can edit or more (access levels round 2): false = cards open, but nothing drags, drops, moves or
    /// gets selected.
    var canEdit = true
    /// Tasks another project linked into this one (server taskLists[].taskProjects): a read-only lane
    /// named after the source project, with a "Linked" tag and a dashed outline — the web board's
    /// linked lanes, drawn first (UI tour run 5).
    var linked = false
    /// Draw the group-label row even when this column is not a status column, so a linked lane lines up
    /// with status columns beside it.
    var groupRow = false
    @State private var composing = false
    /// True while a card is hovering over this column, so the target is obvious before you let go.
    @State private var dropTargeted = false

    /// Unfinished work first, finished work after it (a stable split; `position` decides inside each).
    /// A status column holds one status, so this only matters for plain sections.
    private var orderedTasks: [BoardTask] {
        let tasks = lane.tasks ?? []
        return tasks.filter { !$0.isDone } + tasks.filter { $0.isDone }
    }

    var body: some View {
        // A FIXED column header above a per-column vertical scroll (one axis each; the board's
        // horizontal scroll is the parent's). Proven on device; no lazy stack in a two-way scroll.
        VStack(alignment: .leading, spacing: 4) {
            if statusStyle || groupRow {
                Text(groupLabel ?? " ").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).padding(.leading, 6)
            }
            VStack(alignment: .leading, spacing: 10) {
                header
                // "New task" sits under the header, above the cards, so a long column never has to be
                // scrolled to its end to add one; the new card lands at the top (placement "top").
                if canAdd {
                    if composing {
                        InlineDraftCard(onSave: onAddTask, onOpen: onOpen, onClose: { composing = false })
                    } else {
                        Button { composing = true } label: {
                            HStack(spacing: 6) { Image(systemName: "plus"); Text(T("New task")) }
                                .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 8).frame(minHeight: 40)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                    }
                }
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(orderedTasks) { task in card(task) }
                        if (lane.tasks ?? []).isEmpty && !composing {
                            Text(T("No tasks")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.7))
                                .frame(maxWidth: .infinity).padding(.vertical, 18)
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
            .padding(10)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(linked ? Color.clear : (statusStyle ? lane.swatch.lane : NX.card.opacity(0.6)), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(dropTargeted ? NX.violet : (statusStyle && !linked ? Color.clear : NX.border),
                                  style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: linked ? [5, 4] : []))
            )
            // The whole column is the target, not just the gap under the last card.
            .dropDestination(for: String.self) { ids, _ in
                guard canEdit, !ids.isEmpty else { return false }
                onDrop(ids, nil)
                return true
            } isTargeted: { targeted in
                withAnimation(.easeOut(duration: 0.12)) { dropTargeted = targeted }
            }
        }
        .frame(width: 280)
        .frame(maxHeight: .infinity, alignment: .top)   // the column fills the board height so its scroll is bounded
    }

    private var header: some View {
        HStack(spacing: 8) {
            if statusStyle {
                StatusPill(name: lane.name, colorKey: lane.colorKey, size: 13)
            } else {
                Text(lane.name).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                if linked {
                    Text(T("Linked")).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .fixedSize()
                }
                if let status = lane.taskStatus {
                    Text(TaskStatusName.label(status)).font(NXFont.text(10, .semibold)).foregroundStyle(NX.violetText)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.violet.opacity(0.10), in: Capsule())
                        .lineLimit(1)
                }
            }
            Text("\(lane.tasks?.count ?? 0)").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
            Spacer(minLength: 0)
            if let options { optionMenu(options) }
            else if let onSetStatus { sectionStatusMenu(onSetStatus) }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder private func card(_ task: BoardTask) -> some View {
        if canEdit {
            editableCard(task)
        } else {
            // Read-only: the card opens the task, nothing else.
            Button { onOpen(task.id) } label: { BoardCard(task: task) }
                .buttonStyle(.plain)
                .hoverEffect(.lift)
        }
    }

    private func editableCard(_ task: BoardTask) -> some View {
        // In selection mode a tap ticks the card instead of opening it.
        Button {
            if selection.active { selection.toggle(task.id) } else { onOpen(task.id) }
        } label: {
            // The tick is drawn inside the card, so the column's scroll view never clips it.
            BoardCard(task: task, selectMark: selection.active ? selection.contains(task.id) : nil)
                .overlay {
                    if selection.active && selection.contains(task.id) {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.violet, lineWidth: 2)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selection.active && selection.contains(task.id) ? .isSelected : [])
        // ⌘-click ticks, ⇧-click ticks the range in this column's on-screen order (iPad keyboard, Mac).
        .taskModifierClicks(task.id, selection: selection) { orderedTasks.map(\.id) }
        .hoverEffect(.lift)
        // The id is the payload; a selected card carries the whole selection (the board reads it on drop).
        .draggable(task.id) {
            let count = selection.active && selection.contains(task.id) ? selection.ids.count : 1
            BoardCard(task: task).frame(width: 250).opacity(0.9)
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text("\(count)").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(NX.violetFill, in: Capsule())
                            .offset(x: 6, y: -6)
                    }
                }
        }
        // A card dropped ON a card lands just before it (manual order, or a move into this column at
        // that place). Standard drop API — no geometry.
        .dropDestination(for: String.self) { ids, _ in
            guard !ids.isEmpty, !ids.contains(task.id) else { return false }
            onDrop(ids, task.id)
            return true
        }
        .contextMenu {
            TaskSelectionMenuItems(taskId: task.id, selection: selection)
            let others = allLanes.filter { $0.id != lane.id }
            if !others.isEmpty {
                Menu(T("Move to")) {
                    ForEach(others) { l in
                        Button(l.name) { onMoveTo(task.id, l.id) }
                    }
                }
            }
        }
    }

    /// The column's ••• menu for a status option: rename, colour, order inside its group, delete (its
    /// tasks move to the option picked first). Web StatusPicker's option menu.
    private func optionMenu(_ o: LaneOptionActions) -> some View {
        Menu {
            Button { o.rename() } label: { Label(T("Rename…"), systemImage: "pencil") }
            Menu {
                ForEach(StatusColor.keys, id: \.self) { k in
                    Button { o.color(k) } label: {
                        if lane.colorKey == k { Label(StatusColor.label(k), systemImage: "checkmark") } else { Text(StatusColor.label(k)) }
                    }
                }
            } label: { Label(T("Colour"), systemImage: "paintpalette") }
            Button { o.move(-1) } label: { Label(T("Move left"), systemImage: "arrow.left") }
            Button { o.move(1) } label: { Label(T("Move right"), systemImage: "arrow.right") }
            let others = allLanes.filter { $0.id != lane.id && !$0.id.hasPrefix("grp:") }
            if !others.isEmpty {
                Menu {
                    Section(T("Its tasks move to")) {
                        ForEach(others) { l in
                            Button(role: .destructive) { o.delete(l.id) } label: { Text(l.name) }
                        }
                    }
                } label: { Label(T("Delete status…"), systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                .frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .accessibilityLabel(String(format: T("Options for %@"), lane.name))
    }

    /// The web's lane menu "Section status" for a plain section: tasks moved into it get this status.
    private func sectionStatusMenu(_ set: @escaping (String?) async -> Void) -> some View {
        Menu {
            Section(T("Tasks moved into this section get this status.")) {
                Button { Task { await set(nil) } } label: {
                    if lane.taskStatus == nil { Label(T("None (plain section)"), systemImage: "checkmark") }
                    else { Text(T("None (plain section)")) }
                }
                ForEach(TaskStatusName.all, id: \.self) { s in
                    Button { Task { await set(s) } } label: {
                        if lane.taskStatus == s { Label(TaskStatusName.label(s), systemImage: "checkmark") }
                        else { Text(TaskStatusName.label(s)) }
                    }
                }
            }
        } label: {
            Image(systemName: lane.taskStatus == nil ? "checkmark.circle" : "checkmark.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(lane.taskStatus == nil ? NX.mutedFg : NX.violetText)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(T("Section status"))
    }
}

/// What a status option's column menu can do; the board performs it.
struct LaneOptionActions {
    let rename: () -> Void
    let color: (String) -> Void
    let move: (Int) -> Void
    /// Delete, moving its tasks to the option with this id first.
    let delete: (String) -> Void
}

/// "+N XP" pill — shown on any task that's part of one or more task-bundle quests (board + list).
struct QuestXPChip: View {
    let xp: Int
    var body: some View {
        Text("+\(xp) XP")
            .font(NXFont.text(10, .bold)).foregroundStyle(NX.violetText)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// "↳ Subtask · <parent>" mark — flags a card/row as a subtask and names its parent task.
struct SubtaskBadge: View {
    let parentTitle: String?
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "arrow.turn.down.right").font(.system(size: 9, weight: .bold))
            Text(parentTitle.map { "Subtask · \($0)" } ?? "Subtask").lineLimit(1)
        }
        .font(NXFont.text(10, .bold)).foregroundStyle(Color(hex: "#7c3aed"))
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(Color(hex: "#7c3aed").opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct BoardCard: View {
    let task: BoardTask
    /// nil = not in selection mode; else whether this card is ticked (multi-select, TaskBatchDuplicate.swift).
    var selectMark: Bool? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if task.isSubtask { SubtaskBadge(parentTitle: task.parent?.title) }
            HStack(alignment: .top, spacing: 8) {
                if let selectMark { TaskSelectionMark(selected: selectMark) }
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16)).foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                Text(task.title).font(NXFont.text(14, .bold))
                    .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(task.isDone).lineLimit(3)
                Spacer(minLength: 0)
                if let p = task.priority, p.uppercased() != "NONE" {
                    PriorityPill(priority: p)
                }
            }
            CFChipRow(values: task.customFieldValues)
            HStack(spacing: 8) {
                // No "No due" placeholder on every card (Notion shows nothing when there is no date).
                if let due = dueText {
                    Label(due, systemImage: "clock").font(NXFont.text(11)).foregroundStyle(isOverdue ? NX.danger : NX.mutedFg)
                }
                if task.totalSubs > 0 {
                    NexusChip(text: "\(task.doneSubs)/\(task.totalSubs)", tone: task.doneSubs == task.totalSubs ? .success : .neutral, systemImage: "checklist")
                }
                if task.hasQuest { QuestXPChip(xp: task.questXP) }
                Spacer()
                if task.commentCount > 0 {
                    Label("\(task.commentCount)", systemImage: "bubble.left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                HStack(spacing: -7) {
                    ForEach(task.assigneeAvatars, id: \.id) { a in
                        AvatarView(url: a.url, initial: a.initial, size: 22)
                            .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // Shadow on the flat shape, not the card's content — cheap to rasterize per scroll.
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        }
    }

    private var dueText: String? {
        guard let d = ProjDate.parse(task.dueDate) else { return nil }
        return ProjDate.fmt("d MMM").string(from: d)   // cached parser + formatter
    }
    private var isOverdue: Bool {
        guard !task.isDone, let d = ProjDate.parse(task.dueDate) else { return false }
        return ProjDate.cal.startOfDay(for: d) < ProjDate.cal.startOfDay(for: Date())
    }
}


/// A row of tabs wider than the screen (iPad / Mac with many views: "Timeli…" cut at the edge, UI tour
/// run 5), as the web's view-toolbar does it: the selected tab is scrolled into view, and the trailing
/// edge fades out so a cut tab reads as "more this way" rather than a broken label. The content gets a
/// matching trailing margin, so the last tab can always scroll clear of the fade.
private struct TabRowOverflow: ViewModifier {
    let activeId: String
    let proxy: ScrollViewProxy
    private let fade: CGFloat = 28

    func body(content: Content) -> some View {
        content
            .contentMargins(.trailing, fade, for: .scrollContent)
            .mask {
                HStack(spacing: 0) {
                    Rectangle()
                    LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .leading, endPoint: .trailing)
                        .frame(width: fade)
                }
            }
            .onAppear {
                // After the first layout, or scrollTo finds no frames yet.
                DispatchQueue.main.async { proxy.scrollTo(activeId) }
            }
            .onChange(of: activeId) { _, id in
                withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(id) }
            }
    }
}
