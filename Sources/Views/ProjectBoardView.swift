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
    @State private var prefillDue: Date?
    @State private var isBod = false
    @State private var query = ""
    /// Bumped by "+" on a Pipeline Dashboard: the pipeline opens its New deal sheet.
    @State private var newDealRequest = 0
    /// An Outlet Sales Dashboard's month, calendar day and report draft, shared by its four tabs. Made
    /// once the project says it is one.
    @State private var outletStore: OutletSalesStore?
    /// An outlet opens on Overview once (later reloads leave the tab alone).
    @State private var outletLanded = false
    @Environment(\.dismiss) private var dismiss

    private var canCreate: Bool { !(detail?.taskLists?.isEmpty ?? true) }

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
        guard !tokens.isEmpty else { return lanes }
        return lanes.map { lane in
            ProjectDetail.Lane(
                id: lane.id,
                name: lane.name,
                tasks: (lane.tasks ?? []).filter { Self.matches($0, laneName: lane.name, tokens: tokens) }
            )
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

    /// Tab yang menggambar task, jadi tab yang pantas punya kotak pencarian. Pages, Forms, Chat,
    /// Finance dan P&L punya isinya sendiri dan kotak yang tidak menyaring apa pun di sana hanya
    /// menjanjikan sesuatu yang tidak terjadi.
    private var searchApplies: Bool {
        switch tab {
        // Overview SENGAJA tidak ikut: ia menggambar dari `detail`, bukan `lanes`, jadi kotak
        // pencarian di sana akan ada tapi tidak menyaring apa pun.
        case .board, .list, .sheet, .calendar, .timeline: return true
        default: return false
        }
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
    //   • Finance is opt-in per project like P&L (Project.financeEnabled, switched by BoD). It used
    //     to follow the project's NAME containing "finance", which is how a project nobody had
    //     switched it on for got a Finance tab.
    //   • P&L needs its flag AND a BoD-tier viewer.

    /// Against a server that does not send the flag yet, the old name rule still applies.
    private var financeEnabled: Bool {
        guard let detail else { return false }
        if let flag = detail.financeEnabled { return flag }
        return detail.name.range(of: "finance", options: .caseInsensitive) != nil
    }
    /// P&L needs the per-project flag AND a BoD-tier viewer.
    private var pnlEnabled: Bool { (detail?.enablePnlDashboard ?? false) && isBod }
    private var hiddenTabKeys: Set<String> { Set(detail?.hiddenTabs ?? []) }

    /// A Pipeline Dashboard (owner, 9 Oct 2026): its deals are the project, so it shows Pipeline (first,
    /// and where it opens), Chat, and Finance / P&L when switched on — none of the task tabs, as on the
    /// web. Its three default task sections stay on the server only so an app that does not know the
    /// type still opens it as an empty task project.
    private var isPipeline: Bool { detail?.type == "PIPELINE" }

    /// An Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan): Overview · Calendar · Board · Report form
    /// · Chat, plus Finance / P&L when switched on — the web's order, none of the task tabs. Its Overview,
    /// Calendar and Board are the outlet's own (OutletSalesView.swift), not the task ones of the same name.
    private var isOutlet: Bool { detail?.type == "OUTLET_SALES" }

    private var visibleTabs: [ProjectTab] {
        if isOutlet {
            var tabs = ProjectTab.outletTabs
            if !hiddenTabKeys.contains(ProjectTab.chat.key ?? "") { tabs.append(.chat) }
            if financeEnabled { tabs.append(.finance) }
            if pnlEnabled { tabs.append(.pnl) }
            return tabs
        }
        return ProjectTab.allCases.filter {
            switch $0 {
            case .finance:  return financeEnabled
            case .pnl:      return pnlEnabled
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

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: statusBarTop)   // clear the status bar only (NOT the reserved nav-bar height)
            projectHeader
            tabBar
            Divider().overlay(NX.border)
            if let cachedFrom { OfflineNotice(savedAt: cachedFrom).padding(.vertical, 4) }
            if searchApplies && !isOutlet && !loading && error == nil && !lanes.isEmpty { searchBar }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(projectBackground)
        .ignoresSafeArea(.container, edges: .top)   // the hidden nav bar's height stays in the top safe inset on iOS 26 → drop it
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .sheet(isPresented: $showCreate) {
            CreateTaskSheet(projectId: projectId, lanes: detail?.taskLists ?? [], prefillDue: prefillDue) { await load() }
        }
        .sheet(isPresented: $showSettings) {
            if let detail {
                ProjectSettingsView(projectId: projectId, detail: detail, onChange: { await load() }, onDeleted: { dismiss() })
            }
        }
        .task { await load() }
        // The open tab was just hidden (in settings, or live from another device): land on Board,
        // else List, else whatever is left.
        .onChange(of: visibleTabs) { _, tabs in
            if !tabs.contains(tab) { tab = fallbackTab }
        }
        // Live (owner, 8 Oct 2026): a task created, moved, edited or deleted on another device — or
        // the project itself renamed or changed — shows on the board, list, sheet, calendar and
        // timeline without a reload. The server sends task events only to the project's room, which
        // this screen holds while it is up; the timer is the fallback for when the connection is down.
        .realtimeRoom("project:\(projectId)")
        .liveRefresh(every: 60, on: [.nexusProjectTasksChanged, .nexusWorkspaceChanged],
                     kinds: [RealtimeKind.projects], projectId: projectId) { await reloadQuietly() }
        .alert(T("Couldn't update the board"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
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
        ZStack {
            NX.background
            RadialGradient(colors: [Color(hex: "#4eb301").opacity(0.05), .clear], center: .topLeading, startRadius: 0, endRadius: 320)
            RadialGradient(colors: [Color(hex: "#7b4dff").opacity(0.07), .clear], center: .topTrailing, startRadius: 0, endRadius: 320)
        }
        .ignoresSafeArea()
    }

    // MARK: compact header (native bar hidden — it reserved a tall white gap above the tab bar)

    private var projectHeader: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .bold)).foregroundStyle(NX.foreground)
                    .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
            }
            if let d = detail {
                ProjectMark(icon: d.icon, color: d.color, size: 30, glyph: 20)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            Text(displayName).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
            Spacer(minLength: 6)
            if detail != nil {
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                        .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
                }
            }
            // On the Forms tab "+" means New form, as on the web's Forms tab; on every other tab it is
            // New task. It used to open New task on the Forms tab too (owner, 9 Oct 2026).
            // A Pipeline Dashboard has no task header (web): "+" is New deal on Pipeline and absent on
            // its other tabs, where a new task would land in sections nobody can see.
            if tab == .pipeline {
                Button { newDealRequest += 1 } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .bold)).foregroundStyle(NX.violetText)
                        .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
                }
                .accessibilityLabel(T("New deal"))
            } else if !isPipeline && !isOutlet {
                // An outlet's "Add event" sits in its own header row, next to the month.
                Button {
                    if tab == .forms { newFormOpen = true } else { prefillDue = nil; showCreate = true }
                } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .bold)).foregroundStyle(tab == .forms || canCreate ? NX.violetText : NX.mutedFg)
                        .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
                }
                .disabled(tab != .forms && !canCreate)
                .accessibilityLabel(tab == .forms ? T("New form") : T("New task"))
            }
        }
        .padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 8)
    }

    // MARK: tab bar (underline style, horizontally scrollable)

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(visibleTabs) { t in
                    Button { tab = t } label: {
                        VStack(spacing: 5) {
                            HStack(spacing: 5) {
                                Image(systemName: t.icon).font(.system(size: 12, weight: .semibold))
                                Text(t.label).font(NXFont.text(13, tab == t ? .semibold : .medium))
                            }
                            .foregroundStyle(tab == t ? NX.foreground : NX.mutedFg)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            Rectangle().fill(tab == t ? NX.violet : .clear).frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
        }
    }

    // MARK: kotak pencarian

    private var searchBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                TextField(T("Search tasks in this project…"), text: $query)
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
        case .forms: ProjectFormsBuilderTab(projectId: projectId, projectName: displayName, onNewForm: { newFormOpen = true })
        case .chat:  ProjectChatTab(projectId: projectId, projectName: projectName)
        case .sprints: SprintsTab(projectId: projectId, onOpen: { openTaskId = $0 })
        case .automations: AutomationsTab(projectId: projectId)
        // Belt-and-braces: `tab` could still hold a value that just became hidden after a reload.
        case .finance:
            if financeEnabled { FinanceTab(projectId: projectId) }
            else { TabEmpty(icon: "banknote", text: T("Finance isn't available for this project yet.")) }
        case .pnl:
            if pnlEnabled { PnlTab(projectId: projectId) }
            else { TabEmpty(icon: "dollarsign.circle", text: T("P&L isn't enabled / BoD access required.")) }
        default:
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                ErrorState(message: error, icon: "lock") { Task { await load() } }
            } else if let detail {
                switch tab {
                case .overview: OverviewTab(detail: detail, onOpenMember: { openProfile = $0 })
                case .board:    boardTab(detail)
                case .list:     ListTab(lanes: filteredLanes, onOpen: { openTaskId = $0 })
                case .sheet:    SpreadsheetTab(projectId: projectId, lanes: filteredLanes, onOpen: { openTaskId = $0 })
                case .calendar: CalendarTab(tasks: filteredLanes.flatMap { $0.tasks ?? [] }, onOpen: { openTaskId = $0 }, onCreate: { date in prefillDue = date; showCreate = true })
                case .timeline: TimelineTab(lanes: filteredLanes, onOpen: { openTaskId = $0 })
                default:        EmptyView()
                }
            }
        }
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

    @ViewBuilder private func boardTab(_ detail: ProjectDetail) -> some View {
        let lanes = filteredLanes
        if !lanes.isEmpty {
            // Horizontal-only: each lane is a full-height column that scrolls its own cards
            // vertically (see LaneColumn). The lanes fill the board height, so the HStack never
            // overflows it and the custom header/tab-bar stay put.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(lanes) { lane in
                        LaneColumn(lane: lane, allLanes: lanes, onOpen: { openTaskId = $0 },
                                   onAddTask: { title in await addTask(laneId: lane.id, title: title) },
                                   onMove: { tid, lid in await moveTask(tid, to: lid) })
                    }
                }
                .padding(16)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "square.stack.3d.up.slash").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text("No lanes yet").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text(T("This project has no lanes yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
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
            // P&L visibility depends on the viewer's org role, not just the project flag.
            if let role = (try? await APIClient.shared.workspaceInfo())?.role {
                isBod = role == "BOD" || role == "ONE_ABOVE_ALL"
            }
            // If the selected tab just became hidden (e.g. the flag was turned off), fall back.
            if !visibleTabs.contains(tab) { tab = fallbackTab }
            cachedFrom = nil
        }
        catch APIError.unauthorized { auth.logout() }
        // Not restored from cache on purpose: 403 is the server saying this person is no longer on
        // the project, and answering that with the copy they had before is the one case where a
        // cache would be showing something it has been told not to.
        catch APIError.http(403, _) { error = T("Project locked — you're not a member of this project.") }
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
    static func mergeSubtasks(into lanes: [ProjectDetail.Lane], all: [BoardTask]) -> [ProjectDetail.Lane] {
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
            return ProjectDetail.Lane(id: lane.id, name: lane.name, tasks: out)
        }
    }

    private func addTask(laneId: String, title: String) async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do { _ = try await APIClient.shared.createTask(projectId: projectId, taskListId: laneId, title: t) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't created.") }
        await load()
    }

    private func moveTask(_ taskId: String, to laneId: String) async {
        do { _ = try await APIClient.shared.updateTask(taskId, ["taskListId": laneId]) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The task wasn't moved.") }
        await load()
    }
}

struct LaneColumn: View {
    let lane: ProjectDetail.Lane
    let allLanes: [ProjectDetail.Lane]
    let onOpen: (String) -> Void
    let onAddTask: (String) async -> Void
    let onMove: (String, String) async -> Void
    @State private var composing = false
    @State private var newTitle = ""
    @State private var adding = false
    /// True while a card is hovering over this column, so the target is obvious before you let go.
    @State private var dropTargeted = false

    /// Unfinished work first, finished work after it.
    ///
    /// The server orders a lane by `position` — the manual order cards were put in — which is the
    /// right answer for a pure kanban board, where the column IS the status and nothing inside it
    /// is ever "done". NEXUS lets a task be ticked off without leaving its column, so that
    /// assumption leaks: a finished card sits wherever it happened to be, between two live ones.
    ///
    /// The split is stable, so `position` still decides the order inside each half — dragging a
    /// card to a lane still lands it where the server put it, relative to its peers.
    private var orderedTasks: [BoardTask] {
        let tasks = lane.tasks ?? []
        return tasks.filter { !$0.isDone } + tasks.filter { $0.isDone }
    }
    @FocusState private var focused: Bool

    var body: some View {
        // ClickUp-style column: a FIXED lane header above a per-lane vertical scroll, so only this
        // column's visible cards render (reliable culling) and the header stays put — faithful to
        // the web board, and far smoother than the old whole-board 2-axis pan on a task-heavy lane.
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(lane.name).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Text("\(lane.tasks?.count ?? 0)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
            }
            .padding(.horizontal, 4)

            // Add task sits under the lane header, above the cards (like the web board's "Spawn card"),
            // so a long lane never has to be scrolled to its end to add one.
            if composing {
                VStack(spacing: 8) {
                    TextField(T("Task title…"), text: $newTitle, axis: .vertical)
                        .font(NXFont.text(14)).focused($focused).lineLimit(3)
                        .padding(10).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.violet.opacity(0.5)))
                        .onSubmit(submit)
                    HStack(spacing: 8) {
                        Button(T("Cancel")) { composing = false; newTitle = "" }
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        Spacer()
                        Button(action: submit) {
                            HStack(spacing: 4) { if adding { ProgressView().scaleEffect(0.7) }; Text(T("Add")) }
                                .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(NX.violet, in: Capsule())
                        }
                        .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty || adding)
                    }
                }
            } else {
                Button { composing = true; focused = true } label: {
                    HStack(spacing: 6) { Image(systemName: "plus"); Text(T("Add task")) }
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }

            ScrollView(.vertical, showsIndicators: false) {
              LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(orderedTasks) { task in
                Button { onOpen(task.id) } label: { BoardCard(task: task) }.buttonStyle(.plain)
                    .hoverEffect(.lift)
                    // The task id is the whole payload. Dragging the card itself would mean making
                    // Task Transferable and shipping a copy of the model between columns, when all
                    // the drop needs to know is which task moved — the board already holds the rest.
                    .draggable(task.id) {
                        BoardCard(task: task).frame(width: 260).opacity(0.9)
                    }
                    .contextMenu {
                        let others = allLanes.filter { $0.id != lane.id }
                        if !others.isEmpty {
                            Menu("Pindah ke") {
                                ForEach(others) { l in
                                    Button(l.name) { Task { await onMove(task.id, l.id) } }
                                }
                            }
                        }
                    }
            }
            if (lane.tasks ?? []).isEmpty && !composing {
                Text(T("Empty")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.6))
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
                    .background(NX.card.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
            }

              }   // LazyVStack
            }     // per-lane ScrollView
        }
        .frame(width: 290)
        .frame(maxHeight: .infinity, alignment: .top)   // lane fills the board height so its scroll is bounded
        .padding(12)
        .background(NX.card.opacity(dropTargeted ? 0.9 : 0.6), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(dropTargeted ? NX.violet : NX.border, lineWidth: dropTargeted ? 2 : 1)
        )
        // The whole column is the target, not just the gap under the last card: aiming at a
        // list's empty tail is a game, and the answer to "which column" is the column.
        .dropDestination(for: String.self) { ids, _ in
            guard let taskId = ids.first else { return false }
            // A card dropped back where it started would still cost a round trip to the server and
            // a board reload, for a move that did not happen.
            guard !(lane.tasks ?? []).contains(where: { $0.id == taskId }) else { return false }
            Task { await onMove(taskId, lane.id) }
            return true
        } isTargeted: { targeted in
            withAnimation(.easeOut(duration: 0.12)) { dropTargeted = targeted }
        }
    }

    private func submit() {
        let t = newTitle.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !adding else { return }
        adding = true
        Task {
            await onAddTask(t)
            newTitle = ""; composing = false; adding = false
        }
    }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if task.isSubtask { SubtaskBadge(parentTitle: task.parent?.title) }
            HStack(alignment: .top, spacing: 8) {
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
                Label(dueText, systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
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
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // Shadow on the flat shape, not the card's content — cheap to rasterize per scroll.
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
        }
    }

    private var dueText: String {
        guard let d = ProjDate.parse(task.dueDate) else { return "No due" }
        return ProjDate.fmt("d MMM").string(from: d)   // cached parser + formatter
    }
}
