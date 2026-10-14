import SwiftUI
import UniformTypeIdentifiers

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    /// Web Projects' grid / list switch (header, regular width). Remembered on this device.
    @AppStorage("nexus.projects.viewMode") private var viewMode = "grid"
    @State private var projects: [Project] = []
    @State private var folders: [ProjectFolder] = []
    @State private var loading = true
    @State private var error: String?
    @State private var workspaceId: String?
    /// The one sheet this screen shows (owner rule: one sheet per view — two on the same view is how
    /// one of them silently never presents). New project always opens the type picker first.
    @State private var sheet: ProjectsSheet?
    @State private var collapsed: Set<String> = []
    /// Folders start closed. With everything open, a workspace this size opens as a wall of rows
    /// and the folder structure stops being useful. Only applied once, so a pull-to-refresh does
    /// not re-close what the person just opened.
    @State private var didCollapseInitially = false
    @State private var query = ""
    @State private var hits: SearchResults?
    @State private var searching = false
    @State private var openTaskId: String?
    /// A project New project opens as soon as it is made (an Outlet Sales or Pipeline Dashboard).
    @State private var openBoard: ProjectRef?
    /// projectId → done/total task counts, filled in after the list renders (see `loadProgress`).
    @State private var tallies: [String: ProjectTally] = [:]
    /// A folder's aggregate view opened from its context menu (the calendar button is a link of its own).
    @State private var openFolder: FolderRoute?
    /// Folder waiting on the delete confirmation.
    @State private var confirmDelete: ProjectFolder?
    /// A move, delete or drop the server refused, shown in an alert (same as the board).
    @State private var actionError: String?
    /// The web's Filters row (projects/index.tsx): a status filter and a sort, kept on the device.
    @AppStorage("projects.statusFilter") private var statusFilter = "all"
    @AppStorage("projects.sortMode") private var sortMode = "energy"

    // grouping
    private static let statusOptions: [ProjectsMenuOption] = [
        .init(value: "all", label: "All projects"), .init(value: "ACTIVE", label: "Active"),
        .init(value: "PLANNING", label: "Planning"), .init(value: "ON_HOLD", label: "On hold"),
        .init(value: "COMPLETED", label: "Completed"), .init(value: "ARCHIVED", label: "Archived"),
    ]
    private static let sortOptions: [ProjectsMenuOption] = [
        .init(value: "energy", label: "Sort by progress"), .init(value: "tasks", label: "Sort by number of tasks"),
        .init(value: "name", label: "Sort by name"),
    ]
    private func progress(_ p: Project) -> Double {
        guard let t = tallies[p.id], t.total > 0 else { return 0 }
        return Double(t.done) / Double(t.total)
    }
    /// The projects the filter lets through, in the chosen order (web visibleProjects).
    private var visibleProjects: [Project] {
        projects
            .filter { statusFilter == "all" || ($0.status ?? "ACTIVE").uppercased() == statusFilter }
            .sorted { a, b in
                // Ties fall back to the name, so equal rows keep one order between redraws.
                let byName = a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
                switch sortMode {
                case "name": return byName
                case "tasks": return a.taskCount != b.taskCount ? a.taskCount > b.taskCount : byName
                default:
                    let pa = progress(a), pb = progress(b)
                    return pa != pb ? pa > pb : byName
                }
            }
    }
    private var byFolder: [String: [Project]] {
        Dictionary(grouping: visibleProjects.filter { $0.folderId != nil }) { $0.folderId! }
    }
    private var rootFolders: [ProjectFolder] {
        folders.filter { $0.parentFolderId == nil }.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) }
    }
    private var ungrouped: [Project] {
        let folderIds = Set(folders.map(\.id))
        return visibleProjects.filter { $0.folderId == nil || !folderIds.contains($0.folderId!) }
    }
    private var tree: FolderTree { FolderTree(folders) }

    /// Everything a folder row or a project card can ask of this screen, passed down the tree as one value.
    private var actions: ProjectsActions {
        ProjectsActions(
            moveProject: { p, folderId in await move(p, to: folderId) },
            moveFolder: { f, parentId in await moveFolder(f, to: parentId) },
            drop: { payload, folderId in drop(payload, into: folderId) },
            openProject: { p in openBoard = ProjectRef(id: p.id, name: p.name, icon: p.icon, color: p.color) },
            openFolder: { f in openFolder = FolderRoute(id: f.id) },
            newProject: { f in sheet = .newProjectIn(f) },
            newSubfolder: { f in sheet = .newSubfolder(f) },
            editFolder: { f in sheet = .editFolder(f) },
            deleteFolder: { f in confirmDelete = f }
        )
    }

    private func takeProjectRequest() {
        guard let ref = router.projectRequest else { return }
        router.projectRequest = nil
        // A beat later, not inside the same update: set while the tab is still switching in (onAppear),
        // the push was dropped and the Projects list stayed on screen (UI tour, 13 Oct 2026).
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            openBoard = ref
        }
    }

    /// The sidebar's Projects page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.projects, hSize: hSize, router: router) }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
                    .environment(\.projectsListRows, viewMode == "list")
                    // The delete confirmation sits on the content and the error alert on the stack
                    // around it: two alerts on one view and only one of them ever shows.
                    .alert(T("Delete this folder?"), isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), presenting: confirmDelete) { f in
                        Button(T("Delete"), role: .destructive) { Task { await deleteFolder(f) } }
                        Button(T("Cancel"), role: .cancel) { confirmDelete = nil }
                    } message: { f in
                        Text(String(format: T("\"%@\" goes away. The projects and subfolders in it move up one level, and the folder can be restored from Audit."), f.name))
                    }
            }
            .alert(T("Couldn't update projects"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
                Button("OK") { actionError = nil }
            } message: { Text(actionError ?? "") }
            .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
            .navigationDestination(item: $openBoard) { ref in ProjectDetailView(projectId: ref.id, projectName: ref.name) }
            // A project asked for from outside this screen (AppRouter.openProjectPage): pushed here like a
            // tapped row. onAppear covers a request made before the tab existed, onChange a later one.
            .onAppear { takeProjectRequest() }
            .onChange(of: router.projectRequest) { _, _ in takeProjectRequest() }
            .navigationDestination(item: $openFolder) { route in
                if let f = folders.first(where: { $0.id == route.id }) {
                    FolderAggregateView(folder: f, allFolders: folders, allProjects: projects.filter { $0.folderId != nil })
                }
            }
            .navigationTitle(T("Projects"))
            // Inline, like the other tab roots (Chat, Calendar). The default large title left an empty band
            // with no "Projects" in it above the search field on the iPhone (UI tour 13 Oct 2026).
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { sheet = .newProject } label: { Label(T("New project"), systemImage: "rectangle.stack.badge.plus") }
                        Button { sheet = .newFolder } label: { Label(T("New folder"), systemImage: "folder.badge.plus") }
                    } label: { Image(systemName: "plus") }
                    .disabled(workspaceId == nil)
                }
            }
            .sheet(item: $sheet) { which in
                switch which {
                case .newProject:
                    // The type picker (Task Project, Outlet Sales Dashboard, Pipeline Dashboard; Content
                    // Planner coming soon) is CreateProjectSheet's first step — the only way in.
                    CreateProjectSheet(workspaceId: workspaceId ?? "", onOpenProject: { openBoard = $0 }) { await load() }
                case .newProjectIn(let f):
                    CreateProjectSheet(workspaceId: workspaceId ?? "", onOpenProject: { openBoard = $0 }, folder: f) { await load() }
                case .newFolder:
                    CreateFolderSheet(workspaceId: workspaceId ?? "") { await load() }
                case .newSubfolder(let parent):
                    CreateFolderSheet(workspaceId: workspaceId ?? "", parent: parent) { await load() }
                case .editFolder(let f):
                    CreateFolderSheet(workspaceId: workspaceId ?? "", editing: f) { await load() }
                }
            }
            .task {
                // Projects barely change between visits, so draw the last known list immediately
                // instead of a skeleton, then refresh underneath.
                if projects.isEmpty, let hit = ResponseCache.decoded("projects", as: [Project].self) {
                    // Folders with them, or the cached first paint is the flat list.
                    if let f = ResponseCache.decoded("project-folders", as: [ProjectFolder].self) {
                        folders = f.value
                        collapsed = Set(f.value.map(\.id))
                        didCollapseInitially = true
                    }
                    projects = hit.value
                    loading = false
                }
                await load()
            }
            // Live (owner, 8 Oct 2026): a project moved to another folder on one device showed on the
            // others only after a manual refresh. Now every 30 s while this list is on screen and the
            // app is in front, at once on coming back to the front, and on the realtime client's word
            // once it exists. Coming back to the list from a board is the `.task` above.
            .liveRefresh(every: 30, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.projects, RealtimeKind.folders]) {
                await refreshQuietly()
            }
            .nxSidebarPageChrome(isRoot, phoneSubtitle: T("Every project you're part of.")) { pageHeader }
        }
    }

    // The web's three numbers (projects/index.tsx MiniStat): over every project, not only the filtered ones.
    // "–" while the per-project tallies are still being counted.
    private var summaryProgress: String {
        guard !tallies.isEmpty else { return "–" }
        let total = tallies.values.reduce(0) { $0 + $1.total }
        let done = tallies.values.reduce(0) { $0 + $1.done }
        return total > 0 ? "\(Int((Double(done) / Double(total) * 100).rounded()))%" : "0%"
    }
    private var summaryDone: String {
        tallies.isEmpty ? "–" : "\(tallies.values.reduce(0) { $0 + $1.done })"
    }
    /// Distinct people, not memberships summed over projects (web QA 13 Oct 2026).
    private var summaryMembers: String {
        let ids = Set(projects.flatMap { ($0.members ?? []).compactMap { $0.user?.id } })
        return "\(ids.count)"
    }

    /// Web projects/index.tsx PageHeader: search, grid / list, Folder, primary New project.
    private var pageHeader: some View {
        NXPageHeader(title: T("Projects"), subtitle: T("Every project you're part of.")) {
            // The same search as the phone's field: projects here, tasks from /api/search.
            NXHeaderSearchField(prompt: T("Search projects, owners, sections…"), text: $query)
            NXHeaderIconToggle(systemImage: "square.grid.2x2", label: T("Grid view"), on: viewMode != "list") { viewMode = "grid" }
            NXHeaderIconToggle(systemImage: "list.bullet", label: T("List view"), on: viewMode == "list") { viewMode = "list" }
            Button { sheet = .newFolder } label: { Label(T("Folder"), systemImage: "folder.badge.plus") }
                .buttonStyle(.nxBordered)
                .disabled(workspaceId == nil)
                .accessibilityLabel(T("New folder"))
            Button { sheet = .newProject } label: { Label(T("New project"), systemImage: "plus") }
                .buttonStyle(.nxPrimary)
                .disabled(workspaceId == nil)
                .opacity(workspaceId == nil ? 0.5 : 1)
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else if projects.isEmpty {
            EmptyState(icon: "rectangle.stack", title: T("No projects yet"),
                       subtitle: T("A project is one board for a piece of work: its tasks, people and deadlines in one place. You'll see every project you're part of here — create the first one to get going."),
                       actionTitle: T("New project"), actionIcon: "rectangle.stack.badge.plus") { sheet = .newProject }
        } else {
            ScrollView {
                LazyVStack(spacing: 16) {
                    // On the iPad / Mac page the search lives in the header.
                    if !isRoot {
                        searchField
                        phoneViewBar
                    }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        searchResults
                    } else {
                    ProjectsSummaryCard(shown: visibleProjects.count, total: projects.count,
                                        progressText: summaryProgress, doneText: summaryDone, members: summaryMembers,
                                        statusFilter: $statusFilter, sortMode: $sortMode,
                                        statusOptions: Self.statusOptions, sortOptions: Self.sortOptions)

                    let folderTree = tree
                    let rowActions = actions
                    ForEach(rootFolders) { f in
                        FolderNode(folder: f, depth: 0, tree: folderTree, projectsByFolder: byFolder,
                                   tallies: tallies, collapsed: $collapsed, actions: rowActions)
                    }
                    // Only worth a target once there are folders to take things out of.
                    if !folders.isEmpty {
                        UnfiledDropZone(isEmpty: ungrouped.isEmpty) { payload in drop(payload, into: nil) }
                    }
                    ProjectLinkGroup(projects: ungrouped, tree: folderTree, tallies: tallies, actions: rowActions)
                    }
                }
                .padding(.horizontal, NXSidebarPage.gutter(isRoot))
                .padding(.vertical, isRoot ? 24 : 16)
            }
            .refreshable { await load() }
            // Keyed on the query: typing cancels the previous run, so only the last word searched
            // actually hits the network.
            .task(id: query) { await runSearch(query) }
        }
    }

    private func errorState(_ msg: String) -> some View {
        ErrorState(message: msg) { Task { await load() } }
    }

    /// Pull-to-refresh, first load, and after creating/editing a project or folder.
    ///
    /// Run as its own task on purpose. `.refreshable` cancels the task it hands us when the list
    /// re-renders under the finger, and setting `projects` re-renders it — so the folders request
    /// that came after was cancelled, `try?` turned that into "no folders", and the whole screen fell
    /// back to a flat list of 80 cards ("Foldernya ga muncul", owner, 9 Oct 2026).
    private func load() async {
        await Task { await fetchBoth() }.value
    }

    /// Both lists are fetched first and land together: projects never arrive without their folders.
    /// A folders request that fails keeps the folders already on screen rather than emptying them —
    /// the flat list is only for a workspace that really has no folders.
    private func fetchBoth() async {
        error = nil
        do {
            async let freshProjects = APIClient.shared.projects()
            if workspaceId == nil { workspaceId = try? await APIClient.shared.workspaceInfo().workspaceId }
            var freshFolders = try? await APIClient.shared.projectFolders(workspaceId: workspaceId)
            if freshFolders == nil && folders.isEmpty {
                // Nothing to fall back on yet: one more try before drawing the list ungrouped.
                freshFolders = try? await APIClient.shared.projectFolders(workspaceId: workspaceId)
            }
            let fresh = try await freshProjects
            if let freshFolders {
                if didCollapseInitially {
                    // A folder first seen now (made on another device) starts closed, like every folder.
                    let known = Set(folders.map(\.id))
                    collapsed.formUnion(freshFolders.map(\.id).filter { !known.contains($0) })
                }
                folders = freshFolders
            }
            projects = fresh
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            // Something readable already on screen beats an error page; only report when there is
            // genuinely nothing to show.
            if projects.isEmpty {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
            }
        }
        if !didCollapseInitially {
            collapsed = Set(folders.map(\.id))
            didCollapseInitially = true
        }
        loading = false
        await loadProgress()   // secondary pass — the cards are already on screen
    }

    /// `load` without a sound: projects and folders only, no skeleton, no error page, and a request
    /// that fails leaves the list as it is. Rows are keyed by id, so the scroll position and the
    /// open folders stay; a folder first seen now (made on another device) starts closed, like every
    /// folder does. The progress tallies — one call over every task of every project — are redone
    /// only when the set of projects changed, so a new card does not sit on "Calculating…".
    private func refreshQuietly() async {
        guard !loading else { return }
        guard let fresh = try? await APIClient.shared.projects() else { return }
        if workspaceId == nil { workspaceId = try? await APIClient.shared.workspaceInfo().workspaceId }
        let freshFolders = try? await APIClient.shared.projectFolders(workspaceId: workspaceId)
        let setChanged = Set(fresh.map(\.id)) != Set(projects.map(\.id))
        if let freshFolders {
            let known = Set(folders.map(\.id))
            let added = freshFolders.map(\.id).filter { !known.contains($0) }
            if !added.isEmpty { collapsed.formUnion(added) }
            folders = freshFolders
        }
        projects = fresh
        error = nil
        if setChanged { await loadProgress() }
    }

    /// Web mobile's row under the search (projects/index.tsx PageHeader, UI tour run 7): grid / list and
    /// Folder. New project stays the nav bar's +.
    private var phoneViewBar: some View {
        HStack(spacing: 8) {
            NXHeaderIconToggle(systemImage: "square.grid.2x2", label: T("Grid view"), on: viewMode != "list") { viewMode = "grid" }
            NXHeaderIconToggle(systemImage: "list.bullet", label: T("List view"), on: viewMode == "list") { viewMode = "list" }
            Button { sheet = .newFolder } label: { Label(T("Folder"), systemImage: "folder.badge.plus") }
                .buttonStyle(.nxBordered)
                .disabled(workspaceId == nil)
                .accessibilityLabel(T("New folder"))
            Spacer(minLength: 0)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
            TextField(T("Search projects, owners, sections…"), text: $query)
                .font(NXFont.text(15)).autocorrectionDisabled().submitLabel(.search)
            if searching { ProgressView().scaleEffect(0.7) }
            if !query.isEmpty {
                Button { query = ""; hits = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).touchTarget44(drawn: 20)
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
    }

    /// Projects are matched on the device — the list is already loaded, so filtering it is instant
    /// and works with no signal. Tasks are not loaded here, so those come from the same
    /// /api/search the global search screen uses rather than a second implementation.
    private var matchedProjects: [Project] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return [] }
        // Web visibleProjects' haystack: name, description, status (the list payload carries no owner or
        // section names, so those match nothing on web either).
        return projects.filter { p in
            let hay = [p.name, p.description ?? "", p.status ?? ""].joined(separator: " ").lowercased()
            return hay.contains(needle)
        }
    }

    @ViewBuilder private var searchResults: some View {
        let ps = matchedProjects
        let ts = hits?.tasks ?? []
        if ps.isEmpty && ts.isEmpty && !searching {
            VStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 32)).foregroundStyle(NX.mutedFg)
                Text(T("Nothing matches that.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 40)
        } else {
            if !ps.isEmpty {
                sectionLabel(T("PROJECTS"))
                let folderTree = tree
                let rowActions = actions
                ForEach(ps) { p in
                    ProjectFolderLink(project: p, tree: folderTree, tally: tallies[p.id], actions: rowActions)
                }
            }
            if !ts.isEmpty {
                sectionLabel(T("TASKS"))
                ForEach(ts) { task in
                    Button { openTaskId = task.id } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "checklist").font(.system(size: 14)).foregroundStyle(NX.success)
                            Text(task.title).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                .lineLimit(2).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    private func sectionLabel(_ s: String) -> some View {
        Text(s).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Debounced so a four-letter word is one request, not four.
    private func runSearch(_ raw: String) async {
        let q = raw.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { hits = nil; return }
        try? await Task.sleep(for: .milliseconds(300))
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        hits = try? await APIClient.shared.search(q)
    }

    /// `/api/projects` carries per-lane task TOTALS but no completed count, so the card's progress
    /// bar had nothing real to draw. One extra call covers every project at once (the same endpoint
    /// the folder aggregate calendar uses) and we tally done/total client-side.
    private func loadProgress() async {
        let ids = projects.map(\.id)
        guard !ids.isEmpty, let tasks = try? await APIClient.shared.folderTasks(projectIds: ids) else { return }
        var done: [String: Int] = [:]
        var total: [String: Int] = [:]
        for t in tasks {
            guard let pid = t.projectId else { continue }
            total[pid, default: 0] += 1
            if t.isDone { done[pid, default: 0] += 1 }
        }
        // uniquingKeysWith (not uniqueKeysWithValues) — a duplicate id in the payload would trap.
        tallies = Dictionary(
            ids.map { ($0, ProjectTally(done: done[$0] ?? 0, total: total[$0] ?? 0)) },
            uniquingKeysWith: { first, _ in first }
        )
    }
    /// Moves on screen first, then asks the server; the reload after either keeps the list or puts the
    /// card back where the server has it, and a refusal (only a project's lead may move it) is said.
    private func move(_ p: Project, to folderId: String?) async {
        if let i = projects.firstIndex(where: { $0.id == p.id }) {
            withAnimation(.easeOut(duration: 0.18)) { projects[i].folderId = folderId }
        }
        if let folderId { collapsed.remove(folderId) }   // show where it landed
        do { try await APIClient.shared.setProjectFolder(projectId: p.id, folderId: folderId) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The project wasn't moved.") }
        await load()
    }

    /// Same as `move`, for a folder and everything in it. The rules are checked before this is
    /// offered (`FolderTree.canPlace`); the server checks them again.
    private func moveFolder(_ f: ProjectFolder, to parentId: String?) async {
        guard tree.canPlace(f.id, under: parentId) else { return }
        if let i = folders.firstIndex(where: { $0.id == f.id }) {
            withAnimation(.easeOut(duration: 0.18)) { folders[i].parentFolderId = parentId }
        }
        if let parentId { collapsed.remove(parentId) }
        do { try await APIClient.shared.projectFolderMove(folderId: f.id, parentFolderId: parentId) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The folder wasn't moved.") }
        await load()
    }

    private func deleteFolder(_ f: ProjectFolder) async {
        confirmDelete = nil
        do { try await APIClient.shared.projectFolderDelete(f.id) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The folder wasn't deleted.") }
        await load()
    }

    /// A drag let go over a folder row (`folderId`) or over the "No folder" strip (nil). Returns
    /// false for a drop that would change nothing or break the folder rules, so the item floats back.
    private func drop(_ payload: String, into folderId: String?) -> Bool {
        switch ProjectsDrag.parse(payload) {
        case .project(let id):
            guard let p = projects.first(where: { $0.id == id }) else { return false }
            if let folderId {
                guard p.folderId != folderId else { return false }
            } else {
                guard !ungrouped.contains(where: { $0.id == id }) else { return false }
            }
            Task { await move(p, to: folderId) }
            return true
        case .folder(let id):
            guard let f = folders.first(where: { $0.id == id }), tree.canPlace(id, under: folderId) else { return false }
            Task { await moveFolder(f, to: folderId) }
            return true
        case nil:
            return false
        }
    }
}

/// Pushes a folder's aggregate view from its context menu.
struct FolderRoute: Hashable {
    let id: String
}

/// Everything a folder row or a project card can ask the Projects screen to do: one value down the
/// folder tree instead of a closure per action through every level of the recursion.
struct ProjectsActions {
    let moveProject: (Project, String?) async -> Void
    let moveFolder: (ProjectFolder, String?) async -> Void
    /// Drag payload + target folder (nil = no folder / top level); false = refused.
    let drop: (String, String?) -> Bool
    let openProject: (Project) -> Void
    let openFolder: (ProjectFolder) -> Void
    let newProject: (ProjectFolder) -> Void
    let newSubfolder: (ProjectFolder) -> Void
    let editFolder: (ProjectFolder) -> Void
    let deleteFolder: (ProjectFolder) -> Void
}

/// What a project card or folder row carries while dragged: the id behind a prefix that says which of
/// the two it is (same idea as the board's `.draggable(task.id)`, but a folder row takes both).
enum ProjectsDrag {
    case project(String)
    case folder(String)

    static func payload(project id: String) -> String { "nexus-project:" + id }
    static func payload(folder id: String) -> String { "nexus-folder:" + id }

    /// nil for anything else let go over a row (text dragged in from another app, say).
    static func parse(_ s: String) -> ProjectsDrag? {
        if s.hasPrefix("nexus-project:") { return .project(String(s.dropFirst("nexus-project:".count))) }
        if s.hasPrefix("nexus-folder:") { return .folder(String(s.dropFirst("nexus-folder:".count))) }
        return nil
    }
}

/// The folder tree with the server's rules (lib/folder-tree.ts) checked on the device, so the
/// Move to… menus only offer places the server will accept and a refused drop floats back at once:
/// at most `maxDepth` levels (a top-level folder is level 1), and no folder inside itself or inside
/// one of its own subfolders.
struct FolderTree {
    static let maxDepth = 4
    let folders: [ProjectFolder]
    private let byId: [String: ProjectFolder]
    private let children: [String: [ProjectFolder]]

    init(_ folders: [ProjectFolder]) {
        self.folders = folders
        byId = Dictionary(folders.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        children = Dictionary(grouping: folders.filter { $0.parentFolderId != nil }) { $0.parentFolderId! }
    }

    func folder(_ id: String) -> ProjectFolder? { byId[id] }

    /// 1 for a top-level folder, +1 per folder above it.
    func depth(_ id: String) -> Int {
        var depth = 1
        var seen: Set<String> = [id]
        var cursor = byId[id]?.parentFolderId
        while let parent = cursor, !seen.contains(parent), byId[parent] != nil {
            seen.insert(parent)
            depth += 1
            cursor = byId[parent]?.parentFolderId
        }
        return depth
    }

    /// 1 for a folder with no subfolders, +1 per level below it.
    func height(_ id: String) -> Int {
        var seen: Set<String> = []
        func walk(_ id: String) -> Int {
            guard seen.insert(id).inserted else { return 0 }   // defensive against a cycle
            let below = (children[id] ?? []).map { walk($0.id) }.max() ?? 0
            return 1 + below
        }
        return walk(id)
    }

    func descendants(_ id: String) -> Set<String> {
        var out: Set<String> = []
        var stack = [id]
        while let next = stack.popLast() {
            for child in children[next] ?? [] where out.insert(child.id).inserted { stack.append(child.id) }
        }
        return out
    }

    /// Whether `moving` may go under `parent` (nil = top level). A move to where it already is counts
    /// as no, so it is neither offered nor sent.
    func canPlace(_ moving: String, under parent: String?) -> Bool {
        guard let folder = byId[moving], folder.parentFolderId != parent else { return false }
        guard let parent else { return true }
        guard parent != moving, byId[parent] != nil, !descendants(moving).contains(parent) else { return false }
        return depth(parent) + height(moving) <= Self.maxDepth
    }

    /// Room for one more level under this folder (New subfolder).
    func canHoldSubfolder(_ id: String) -> Bool { depth(id) < Self.maxDepth }

    /// "Clients › ANKER › Launch", so two folders with the same name can be told apart in a menu.
    func path(_ id: String) -> String {
        var names: [String] = []
        var seen: Set<String> = []
        var cursor: String? = id
        while let current = cursor, let f = byId[current], seen.insert(current).inserted {
            names.insert(f.name, at: 0)
            cursor = f.parentFolderId
        }
        return names.joined(separator: " › ")
    }

    /// One folder in a Move to… menu.
    struct Entry: Identifiable {
        let folder: ProjectFolder
        let path: String
        var id: String { folder.id }
    }

    /// Every folder in tree order (a parent, then its subfolders), each with its path.
    var ordered: [Entry] {
        let sort: ([ProjectFolder]) -> [ProjectFolder] = { list in list.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) } }
        var out: [Entry] = []
        var seen: Set<String> = []
        func visit(_ f: ProjectFolder) {
            guard seen.insert(f.id).inserted else { return }
            out.append(Entry(folder: f, path: path(f.id)))
            for child in sort(children[f.id] ?? []) { visit(child) }
        }
        for root in sort(folders.filter { $0.parentFolderId == nil || byId[$0.parentFolderId!] == nil }) { visit(root) }
        return out
    }
}

/// The strip above the projects with no folder: let a project go here to take it out of its folder,
/// or a folder to bring it up to the top level.
struct UnfiledDropZone: View {
    let isEmpty: Bool
    let onDrop: (String) -> Bool
    @State private var targeted = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "tray").font(.system(size: 12, weight: .semibold))
            Text(T("No folder").uppercased()).font(NXFont.text(11, .bold)).tracking(0.5)
            if isEmpty || targeted {
                Text(T("Drop a project here to take it out of its folder."))
                    .font(NXFont.text(13)).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(targeted ? NX.violetText : NX.mutedFg)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .background(targeted ? NX.violet.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(targeted ? NX.violet : NX.border, lineWidth: targeted ? 2 : 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .dropDestination(for: String.self) { items, _ in
            guard let payload = items.first else { return false }
            return onDrop(payload)
        } isTargeted: { t in
            withAnimation(.easeOut(duration: 0.12)) { targeted = t }
        }
    }
}

/// The one sheet `ProjectsView` shows.
private enum ProjectsSheet: Identifiable {
    case newProject
    case newProjectIn(ProjectFolder)
    case newFolder
    case newSubfolder(ProjectFolder)
    case editFolder(ProjectFolder)

    var id: String {
        switch self {
        case .newProject: return "new-project"
        case .newProjectIn(let f): return "new-project-in-\(f.id)"
        case .newFolder: return "new-folder"
        case .newSubfolder(let f): return "new-subfolder-\(f.id)"
        case .editFolder(let f): return "edit-folder-\(f.id)"
        }
    }
}

/// A project shown as a card link. Long-press (right-click on the Mac) for its menu; press and drag
/// to drop it on a folder row or on the "No folder" strip.
struct ProjectFolderLink: View {
    let project: Project
    let tree: FolderTree
    var tally: ProjectTally? = nil
    let actions: ProjectsActions
    @Environment(\.projectsListRows) private var listRows
    var body: some View {
        NavigationLink {
            ProjectDetailView(projectId: project.id, projectName: project.name)
        } label: {
            if listRows {
                ProjectsPageListRow(project: project, tally: tally)
            } else {
                ProjectCard(project: project, tally: tally)
            }
        }
        .buttonStyle(PressableCardStyle())
        // The id is the whole payload, as on the board: the screen already holds the project.
        .draggable(ProjectsDrag.payload(project: project.id)) {
            ProjectCard(project: project, tally: tally).frame(width: 320).opacity(0.9)
        }
        .contextMenu {
            let ref = ProjectRef(id: project.id, name: project.name, icon: project.icon, color: project.color)
            Button { actions.openProject(project) } label: { Label(T("Open project"), systemImage: "arrow.up.right.square") }
            Button {
                ProjectShortcuts.shared.togglePin(ref)
            } label: {
                ProjectShortcuts.shared.isPinned(project.id)
                    ? Label(T("Unpin"), systemImage: "pin.slash")
                    : Label(T("Pin"), systemImage: "pin")
            }
            Menu {
                ForEach(tree.ordered.filter { $0.folder.id != project.folderId }) { entry in
                    Button { Task { await actions.moveProject(project, entry.folder.id) } } label: {
                        Label(entry.path, systemImage: "folder")
                    }
                }
            } label: { Label(T("Move to folder"), systemImage: "folder") }
            if let folderId = project.folderId, tree.folder(folderId) != nil {
                Button { Task { await actions.moveProject(project, nil) } } label: {
                    Label(T("Remove from folder"), systemImage: "tray.and.arrow.up")
                }
            }
        }
    }
}

/// Collapsible folder section (recurses for sub-folders). The header row takes drops: a project
/// dragged onto it moves into this folder, a folder dragged onto it becomes its subfolder.
struct FolderNode: View {
    let folder: ProjectFolder
    let depth: Int
    let tree: FolderTree
    let projectsByFolder: [String: [Project]]
    let tallies: [String: ProjectTally]
    @Binding var collapsed: Set<String>
    let actions: ProjectsActions
    @State private var dropTargeted = false

    private var allFolders: [ProjectFolder] { tree.folders }
    private var subFolders: [ProjectFolder] {
        allFolders.filter { $0.parentFolderId == folder.id }.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) }
    }
    private var directProjects: [Project] { projectsByFolder[folder.id] ?? [] }
    private var isExpanded: Bool { !collapsed.contains(folder.id) }
    private var count: Int { directProjects.count + subFolders.count }

    private func toggle() {
        withAnimation(.easeOut(duration: 0.18)) {
            if collapsed.contains(folder.id) { collapsed.remove(folder.id) } else { collapsed.insert(folder.id) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Web FolderSection header (UI tour run 7): the open / close arrow first, then the folder, its count,
            // and a ⋯ menu with everything the long-press menu has (the folder view among them). The whole row
            // still opens / closes the folder (owner, 10 Oct 2026).
            HStack(spacing: 8) {
                Button(action: toggle) {
                    HStack(spacing: 10) {
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0)).frame(width: 20, height: 30)
                        FolderIconTile(folder: folder)
                        Text(folder.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text("\(count)").font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        Spacer(minLength: 4)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(folder.name)
                .accessibilityHint(isExpanded ? T("Close folder") : T("Open folder"))
                Menu { menu } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(90))
                        .frame(width: 30, height: 30).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: T("More for %@"), folder.name))
            }
            .padding(12)
            // The padding around the row opens it too, so a tap anywhere on the card counts.
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .onTapGesture(perform: toggle)
            .accessibilityAddTraits(.isButton)
            .background(dropTargeted ? NX.violet.opacity(0.10) : NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(dropTargeted ? NX.violet : NX.border, lineWidth: dropTargeted ? 2 : 1)
            )
            .draggable(ProjectsDrag.payload(folder: folder.id)) { dragPreview }
            .dropDestination(for: String.self) { items, _ in
                guard let payload = items.first else { return false }
                return actions.drop(payload, folder.id)
            } isTargeted: { targeted in
                withAnimation(.easeOut(duration: 0.12)) { dropTargeted = targeted }
            }
            .contextMenu { menu }

            if isExpanded {
                ForEach(subFolders) { sub in
                    FolderNode(folder: sub, depth: depth + 1, tree: tree, projectsByFolder: projectsByFolder,
                               tallies: tallies, collapsed: $collapsed, actions: actions)
                }
                ProjectLinkGroup(projects: directProjects, tree: tree, tallies: tallies, actions: actions)
                if directProjects.isEmpty && subFolders.isEmpty {
                    Text(T("Empty folder.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).padding(.leading, 8)
                }
            }
        }
        .padding(.leading, CGFloat(depth) * 14)
    }

    @ViewBuilder private var menu: some View {
        Button { actions.openFolder(folder) } label: { Label(T("Open folder view"), systemImage: "calendar") }
        Button { actions.newProject(folder) } label: { Label(T("New project here"), systemImage: "rectangle.stack.badge.plus") }
        if tree.canHoldSubfolder(folder.id) {
            Button { actions.newSubfolder(folder) } label: { Label(T("New subfolder"), systemImage: "folder.badge.plus") }
        }
        Button { actions.editFolder(folder) } label: { Label(T("Edit folder"), systemImage: "pencil") }
        let targets = tree.ordered.filter { tree.canPlace(folder.id, under: $0.folder.id) }
        let canGoTop = tree.canPlace(folder.id, under: nil)
        if canGoTop || !targets.isEmpty {
            Menu {
                if canGoTop {
                    Button { Task { await actions.moveFolder(folder, nil) } } label: { Label(T("Top level"), systemImage: "arrow.up.to.line") }
                }
                ForEach(targets) { entry in
                    Button { Task { await actions.moveFolder(folder, entry.folder.id) } } label: { Label(entry.path, systemImage: "folder") }
                }
            } label: { Label(T("Move to…"), systemImage: "folder") }
        }
        Button(role: .destructive) { actions.deleteFolder(folder) } label: { Label(T("Delete folder"), systemImage: "trash") }
    }

    private var dragPreview: some View {
        HStack(spacing: 10) {
            FolderIconTile(folder: folder)
            Text(folder.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// Create or edit a project folder: name + emoji/photo icon + color.
struct CreateFolderSheet: View {
    let workspaceId: String
    let editing: ProjectFolder?
    /// Made inside this folder (folder → New subfolder); nil = top level.
    let parent: ProjectFolder?
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var icon: String
    @State private var color: String
    @State private var photo: (name: String, data: Data)?
    @State private var showImporter = false
    @State private var busy = false
    @State private var err: String?

    init(workspaceId: String, editing: ProjectFolder? = nil, parent: ProjectFolder? = nil, onCreated: @escaping () async -> Void) {
        self.workspaceId = workspaceId; self.editing = editing; self.parent = parent; self.onCreated = onCreated
        _name = State(initialValue: editing?.name ?? "")
        _icon = State(initialValue: (editing?.isUploadedIcon == true ? "📁" : (editing?.icon ?? "📁")))
        _color = State(initialValue: editing?.color ?? "#7b68ee")
    }

    private let icons = ["📁", "🎬", "📣", "💼", "⭐️", "🎯", "🚀", "📦"]
    private let colors = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#7B2FBE"]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let parent, editing == nil { FolderPlacementNote(folder: parent) }
                        field(T("FOLDER NAME")) {
                            TextField("mis. Client Pertamina", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field(T("ICON")) {
                            HStack(spacing: 8) {
                                Button { showImporter = true } label: {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NX.violet.opacity(0.12))
                                        if let photo, let ui = UIImage(data: photo.data) {
                                            Image(uiImage: ui).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        } else {
                                            Image(systemName: "photo.badge.plus").font(.system(size: 16)).foregroundStyle(NX.violetText)
                                        }
                                    }
                                    .frame(width: 44, height: 44)
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.violet.opacity(0.4), lineWidth: 1))
                                }.buttonStyle(.plain)
                                ForEach(icons, id: \.self) { ic in
                                    Text(ic).font(.system(size: 20)).frame(width: 40, height: 40)
                                        .background(icon == ic && photo == nil ? NX.violet.opacity(0.15) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(icon == ic && photo == nil ? NX.violet : NX.border))
                                        .onTapGesture { icon = ic; photo = nil }
                                }
                            }
                        }
                        field(T("COLOR")) {
                            HStack(spacing: 10) {
                                ForEach(colors, id: \.self) { c in
                                    Circle().fill(Color(hex: c)).frame(width: 30, height: 30)
                                        .overlay(Circle().strokeBorder(color == c ? NX.foreground : .clear, lineWidth: 2))
                                        .onTapGesture { color = c }
                                }
                            }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(NX.background) }; Text(editing == nil ? T("Create folder") : T("Save")) }
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        // Near-black like the web's primary (it was violet).
                        .buttonStyle(.nxPrimary)
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .opacity(busy || name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                    }
                    .padding(20)
                }
            }
            .navigationTitle(editing != nil ? T("Edit folder") : (parent != nil ? T("New subfolder") : T("New folder")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
            .sheet(isPresented: $showImporter) {
                DocumentPicker(types: [.image], multiple: false) { urls in
                    let result: Result<[URL], Error> = .success(urls)
                    if case let .success(urls) = result, let url = urls.first {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        // Measured before it is read. This closure runs on the main actor, and the
                        // picker will happily hand back a 4 GB panorama that /api/upload/folder-icon
                        // would refuse anyway — reading it first to find that out is a frozen screen
                        // followed by a refusal.
                        let size = APIClient.fileSize(of: url)
                        guard size > 0 else { err = T("Couldn't read that file."); return }
                        guard size <= APIClient.iconByteLimit else {
                            err = APIClient.tooBigToSend(size, limit: APIClient.iconByteLimit)
                                .errorDescription ?? T("Upload failed. Try again.")
                            return
                        }
                        guard let data = try? Data(contentsOf: url) else {
                            err = T("Couldn't read that file.")
                            return
                        }
                        err = nil
                        photo = (url.lastPathComponent, data)
                    }
                }
                .ignoresSafeArea()
            }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
    }

    private func create() async {
        // A second tap before the first answer made a second project (bughunt N-BUG-1).
        guard !busy else { return }
        busy = true; err = nil; defer { busy = false }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        do {
            let folderId: String
            if let editing {
                try await APIClient.shared.projectFolderUpdate(folderId: editing.id, name: trimmed, icon: icon, color: color)
                folderId = editing.id
            } else {
                folderId = try await APIClient.shared.projectFolderCreate(workspaceId: workspaceId, name: trimmed, icon: icon, color: color,
                                                                          parentFolderId: parent?.id)
            }
            // Not `try?`. The folder itself is already saved by the time this runs, so a picture
            // that was refused used to leave the sheet closing on a folder with no icon and nothing
            // said about why. The folder is kept and the reason is shown instead.
            if let photo {
                do {
                    try await APIClient.shared.uploadFolderIcon(folderId: folderId, fileName: photo.name,
                                                                data: photo.data)
                } catch {
                    await onCreated()
                    err = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
                    return
                }
            }
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save folder.")
        }
    }
}

/// "Goes into <folder>" above a create form opened from a folder's menu.
struct FolderPlacementNote: View {
    let folder: ProjectFolder
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "folder").font(.system(size: 12, weight: .semibold))
            Text(String(format: T("Goes into %@"), folder.name)).font(NXFont.text(13, .semibold)).lineLimit(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(NX.violetText)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Folder icon: uploaded photo (AsyncImage) or emoji, on a muted tile.
struct FolderIconTile: View {
    let folder: ProjectFolder

    /// The web's FolderGlyph (project-tree.tsx): a folder's own photo or emoji when it has one, else a drawn
    /// folder in the folder's colour (UI tour 13 Oct 2026: every folder was the same grey 📁, so INTOO's
    /// green and SUWARA's pink were lost).
    private static let folderish: Set<String> = ["📁", "📂", "🗂️", "🗂", "folder"]
    private var hasOwnEmoji: Bool {
        guard let icon = folder.icon?.trimmingCharacters(in: .whitespaces), !icon.isEmpty else { return false }
        return !Self.folderish.contains(icon.lowercased()) && folder.emoji != "📁"
    }
    /// The stored colour; a near-black one (the picker offers #111827) draws in the text colour so it
    /// stays visible in dark mode.
    private var tint: Color {
        guard let hex = folder.color, hex.hasPrefix("#"), hex.count == 7 else { return NX.mutedFg }
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        let r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff
        return (r + g + b) < 120 ? NX.foreground : Color(hex: hex)
    }

    var body: some View {
        ZStack {
            if folder.isUploadedIcon {
                RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NX.muted)
                CachedImage(url: URL(string: Config.baseURL.absoluteString + (folder.icon ?? ""))) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Image(systemName: "folder").font(.system(size: 18, weight: .medium)).foregroundStyle(tint) }
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            } else if hasOwnEmoji {
                Text(folder.emoji).font(.system(size: 18))
            } else {
                Image(systemName: "folder").font(.system(size: 18, weight: .medium)).foregroundStyle(tint)
            }
        }
        .frame(width: 34, height: 34)
    }
}

/// Create a new project (web "Create a new project", 12 Oct 2026): the template gallery first (Blank,
/// the server's templates, the Outlet Sales and Pipeline dashboards), then name, brief, tabs, starter
/// pages and members. Every project but a dashboard opens straight away, as on the web.
struct CreateProjectSheet: View {
    let workspaceId: String
    /// Opens the project just made.
    var onOpenProject: (ProjectRef) -> Void = { _ in }
    /// Made inside this folder (folder → New project here). The one Pipeline board is never filed.
    var folder: ProjectFolder? = nil
    let onCreated: () async -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    /// Step one: what the gallery card picked. nil = the gallery is showing.
    @State private var pick: GalleryPick?
    @State private var name = ""
    @State private var brief = ""
    /// Tabs the new Task Project starts without. Blank: Automations off (owner, 11 Oct 2026); a template
    /// pre-ticks its own tabs (its hiddenTabs). Empty = every tab on.
    @State private var hiddenTabs: Set<String> = [ProjectTab.automations.key ?? "automations"]
    /// "Add starter pages" (a template's starter docs and tasks); on by default, as on the web.
    @State private var starter = true
    /// People added to the new project from the start, any type (owner, 11 Oct 2026).
    @State private var memberIds: Set<String> = []
    /// Their access (Notion-style, owner 13 Oct 2026); the creator is the Project Owner (Full access).
    @State private var memberLevel: ProjectAccessLevel = .edit
    @State private var busy = false
    @State private var err: String?

    private var kind: ProjectKind? { pick?.kind }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if let pick, let kind {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        GalleryChosenHeader(pick: pick) { self.pick = nil; err = nil }
                        if let folder, kind != .pipeline { FolderPlacementNote(folder: folder) }
                        field(T("PROJECT NAME")) {
                            TextField("mis. Z Networks Multimedia", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        if kind == .task {
                            field(T("Brief")) {
                                TextField(T("What's the project, who owns it, and what should move first?"), text: $brief, axis: .vertical)
                                    .lineLimit(3...6)
                                    .font(NXFont.text(15)).padding(12)
                                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                            }
                            field(T("Tabs")) { NewProjectTabsPicker(hiddenTabs: $hiddenTabs) }
                        }
                        if let tp = pick.template, tp.hasStarter {
                            Toggle(isOn: $starter) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(T("Add starter pages")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                    Text(tp.starterDocs.map { "\($0.icon ?? "📄") \($0.title.text)" }.joined(separator: ", "))
                                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                }
                            }
                            .tint(NX.violet)
                            .padding(12)
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field(T("Members")) {
                            HStack(alignment: .top, spacing: 8) {
                                Text(T("Optional. You're the Project Owner (Full access); the people you pick get the access chosen here."))
                                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 4)
                                AccessLevelMenu(value: memberLevel, disabled: busy, accessibilityName: nil, onChange: { memberLevel = $0 })
                            }
                            NewProjectMembersPicker(picked: $memberIds, selfUserId: auth.session?.userId)
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            // An outlet opens straight away (web: "Create project + open dashboard").
                            HStack(spacing: 8) {
                                if busy { ProgressView().tint(NX.background) }
                                Text(kind == .outlet ? T("Create project + open dashboard") : T("Create project"))
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        // Near-black like the web's primary (it was violet).
                        .buttonStyle(.nxPrimary)
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .opacity(busy || name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                    }
                    .padding(20)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
                } else {
                    TemplateGallery { choose($0) }
                }
            }
            .navigationTitle(T("New project"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
    }

    private func choose(_ p: GalleryPick) {
        pick = p
        err = nil
        starter = true
        if let tp = p.template {
            hiddenTabs = Set(tp.hiddenTabs)
        } else {
            hiddenTabs = [ProjectTab.automations.key ?? "automations"]
        }
    }

    private func create() async {
        // A second tap before the first answer made a second project (bughunt N-BUG-1).
        guard !busy else { return }
        busy = true; err = nil; defer { busy = false }
        do {
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            if kind == .pipeline {
                // A new, empty board every time (owner, 11 Oct 2026: the one-company-board rule is gone),
                // opened straight away like an outlet.
                let made = try await APIClient.shared.pipelineBoardCreate(workspaceId: workspaceId, name: trimmed,
                                                                          memberIds: Array(memberIds), memberLevel: memberLevel)
                await onCreated()
                dismiss()
                onOpenProject(made)
                return
            } else if kind == .outlet {
                // Any number of outlets, one project each (owner, 10 Oct 2026, for Ryan); it opens on its
                // Overview once the list knows it.
                let made = try await APIClient.shared.outletProjectCreate(workspaceId: workspaceId, name: trimmed,
                                                                          folderId: folder?.id, memberIds: Array(memberIds),
                                                                          memberLevel: memberLevel)
                await onCreated()
                dismiss()
                onOpenProject(made)
                return
            }
            // Blank or a template: a Task Project. Hidden tabs always sent, [] included (the server hides
            // Automations only when the key is absent). A template is built in the app's language.
            let id = try await APIClient.shared.createProjectFromGallery(
                workspaceId: workspaceId, name: trimmed,
                description: brief.trimmingCharacters(in: .whitespacesAndNewlines),
                folderId: folder?.id, hiddenTabs: hiddenTabs.sorted(), memberIds: Array(memberIds),
                memberLevel: memberLevel, templateId: pick?.template?.id, starter: starter)
            await onCreated()
            dismiss()
            onOpenProject(ProjectRef(id: id, name: trimmed, icon: nil))
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't create project.")
        }
    }
}

/// Faithful port of the web ProjectCard: icon tile + name + description + status chip,
/// Cards/Done/Lanes metrics, "mission energy" progress bar, member avatars + deadline.
/// Press-scale for a whole card used as a NavigationLink/Button label. Lives in a ButtonStyle so
/// the tap still reaches the NavigationLink (an inline `onLongPressGesture` would swallow it).
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Done/total task counts for one project, tallied client-side (see `ProjectsView.loadProgress`).
/// Both numbers come from the SAME fetch so the card's Cards/Done/% can never contradict each other.
struct ProjectTally: Sendable {
    let done: Int
    let total: Int
}

struct ProjectCard: View {
    let project: Project
    /// Filled in by ProjectsView's secondary pass; nil = still counting. `/api/projects` carries a
    /// per-lane task TOTAL but no completed count, so the bar used to be hard-coded to 0 — every
    /// project rendered as a permanent "0% mission energy".
    var tally: ProjectTally? = nil

    private var done: Int? { tally?.done }
    private var total: Int { tally?.total ?? project.taskCount }
    private var progress: Double {
        guard let tally, tally.total > 0 else { return 0 }
        return min(1, Double(tally.done) / Double(tally.total))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // header row
            HStack(alignment: .top, spacing: 12) {
                ProjectMark(icon: project.icon, color: project.color, size: 44, projectId: project.id)

                VStack(alignment: .leading, spacing: 3) {
                    Text(project.name).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    // Nothing when there is no description, like web (UI tour run 7: "No description yet." on every card).
                    if let d = project.description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty {
                        Text(d).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                NexusChip(text: project.statusLabel, tone: statusTone)
            }

            // metrics
            HStack(spacing: 8) {
                metric(T("Cards"), "\(total)")
                metric(T("Done"), done.map { "\($0)" } ?? "—")
                metric(T("Sections"), "\(project.laneCount)")
            }
            .padding(.top, 16)

            // progress
            VStack(spacing: 6) {
                HStack {
                    Text(done == nil ? T("Calculating…") : String(format: T("%d%% done"), Int(progress * 100)))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Text(done.map { String(format: T("%d left"), max(0, total - $0)) } ?? "")
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(NX.muted)
                        Capsule().fill(NX.success).frame(width: geo.size.width * progress)
                    }
                }
                .frame(height: 7)
            }
            .padding(.top, 16)

            // footer
            HStack {
                if project.memberCount > 0 {
                    HStack(spacing: -8) {
                        ForEach(project.memberAvatars, id: \.id) { m in
                            AvatarView(url: m.url, initial: m.initial, size: 24)
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                        }
                        if project.memberCount > 4 {
                            Text("+\(project.memberCount - 4)").font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 24, height: 24).background(NX.muted, in: Circle())
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                        }
                    }
                } else {
                    Text(T("Just you")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 12))
                    Text(T("No deadline")).font(NXFont.text(13))
                }.foregroundStyle(NX.mutedFg)
            }
            .padding(.top, 16)
        }
        .padding(18)
        // Clip only the fill + corner-accent (two cheap shapes) in the BACKGROUND — never the rich card
        // content (it's inset by padding and never reaches the corners). The old `.clipShape` wrapped the
        // whole card, forcing a per-row offscreen rasterization pass while scrolling; this avoids it and
        // collapses the previous double NX.card fill into one.
        .background {
            // A hairline card like the web's (rounded-xl border bg-card); the drop shadow went.
            // No corner blob behind the status pill any more (UI tour run 7): web's card is plain.
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NX.card)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var statusTone: ChipTone {
        switch (project.status ?? "ACTIVE").uppercased() {
        case "AT_RISK": return .warning
        case "OFF_TRACK": return .danger
        case "COMPLETED", "DONE": return .success
        default: return .accent
        }
    }
}

// MARK: - Grid / list (web Projects' view switch, 13 Oct 2026)

private struct ProjectsListRowsKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True when the Projects page is in list mode: projects draw as one-line rows instead of cards.
    var projectsListRows: Bool {
        get { self[ProjectsListRowsKey.self] }
        set { self[ProjectsListRowsKey.self] = newValue }
    }
}

/// A folder's (or the unfiled) projects: cards in NXCardGrid columns, or rows stacked in list mode.
struct ProjectLinkGroup: View {
    let projects: [Project]
    let tree: FolderTree
    let tallies: [String: ProjectTally]
    let actions: ProjectsActions
    @Environment(\.projectsListRows) private var listRows

    var body: some View {
        if listRows {
            VStack(spacing: 8) { links }
        } else {
            NXCardGrid(spacing: 12) { links }
        }
    }

    private var links: some View {
        ForEach(projects) { p in
            ProjectFolderLink(project: p, tree: tree, tally: tallies[p.id], actions: actions)
        }
    }
}

/// One project in list mode: mark, name + description, progress, status.
struct ProjectsPageListRow: View {
    let project: Project
    var tally: ProjectTally? = nil

    private var progress: Double? {
        guard let tally else { return nil }
        guard tally.total > 0 else { return 0 }
        return min(1, Double(tally.done) / Double(tally.total))
    }

    var body: some View {
        HStack(spacing: 12) {
            ProjectMark(icon: project.icon, color: project.color, size: 32, projectId: project.id)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let d = project.description, !d.isEmpty {
                    Text(d).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let progress {
                HStack(spacing: 8) {
                    ProgressView(value: progress).tint(NX.success).frame(width: 80)
                    Text("\(Int(progress * 100))%").font(NXFont.text(13)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        .frame(width: 40, alignment: .trailing)
                }
            }
            NexusChip(text: project.statusLabel, tone: statusTone)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var statusTone: ChipTone {
        switch (project.status ?? "ACTIVE").uppercased() {
        case "AT_RISK": return .warning
        case "OFF_TRACK": return .danger
        case "COMPLETED", "DONE": return .success
        default: return .accent
        }
    }
}
