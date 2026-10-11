import SwiftUI
import UniformTypeIdentifiers

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
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
    /// The company's Pipeline board, opened when New project → Pipeline Dashboard finds it already
    /// exists (owner/GM, 9 Oct 2026: one board for the whole company).
    @State private var openBoard: ProjectRef?
    /// projectId → done/total task counts, filled in after the list renders (see `loadProgress`).
    @State private var tallies: [String: ProjectTally] = [:]
    /// A folder's aggregate view opened from its context menu (the calendar button is a link of its own).
    @State private var openFolder: FolderRoute?
    /// Folder waiting on the delete confirmation.
    @State private var confirmDelete: ProjectFolder?
    /// A move, delete or drop the server refused, shown in an alert (same as the board).
    @State private var actionError: String?

    // grouping
    private var byFolder: [String: [Project]] {
        Dictionary(grouping: projects.filter { $0.folderId != nil }) { $0.folderId! }
    }
    private var rootFolders: [ProjectFolder] {
        folders.filter { $0.parentFolderId == nil }.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) }
    }
    private var ungrouped: [Project] {
        let folderIds = Set(folders.map(\.id))
        return projects.filter { $0.folderId == nil || !folderIds.contains($0.folderId!) }
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

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
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
            .navigationDestination(item: $openFolder) { route in
                if let f = folders.first(where: { $0.id == route.id }) {
                    FolderAggregateView(folder: f, allFolders: folders, allProjects: projects.filter { $0.folderId != nil })
                }
            }
            .navigationTitle(T("Mission Control"))
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
                    CreateProjectSheet(workspaceId: workspaceId ?? "", onOpenExisting: { openBoard = $0 }) { await load() }
                case .newProjectIn(let f):
                    CreateProjectSheet(workspaceId: workspaceId ?? "", onOpenExisting: { openBoard = $0 }, folder: f) { await load() }
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
                    searchField
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        searchResults
                    } else {
                    // hero strip (web: "projects visible")
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                        Text(projects.count == 1 ? T("1 project visible") : String(format: T("%d projects visible"), projects.count))
                            .font(NXFont.text(12, .semibold))
                    }
                    .foregroundStyle(NX.violetText)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(NX.violet.opacity(0.1), in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .leading)

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
                    ForEach(ungrouped) { p in
                        ProjectFolderLink(project: p, tree: folderTree, tally: tallies[p.id], actions: rowActions)
                    }
                    }
                }
                .padding(16)
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

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
            TextField(T("Search projects and tasks…"), text: $query)
                .font(NXFont.text(15)).autocorrectionDisabled().submitLabel(.search)
            if searching { ProgressView().scaleEffect(0.7) }
            if !query.isEmpty {
                Button { query = ""; hits = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg)
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
        return projects.filter { $0.name.lowercased().contains(needle) }
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
                    .font(NXFont.text(11)).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(targeted ? NX.violetText : NX.mutedFg)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .background(targeted ? NX.violet.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(targeted ? NX.violet : NX.border, style: StrokeStyle(lineWidth: targeted ? 2 : 1, dash: [5]))
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
    var body: some View {
        NavigationLink {
            ProjectDetailView(projectId: project.id, projectName: project.name)
        } label: {
            ProjectCard(project: project, tally: tally)
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
            // The whole row opens / closes the folder (owner, 10 Oct 2026: the small arrow alone sat next
            // to the Master Calendar button and was easy to miss). Only the calendar button does
            // something else; the arrow stays as the visual cue.
            HStack(spacing: 8) {
                Button(action: toggle) {
                    HStack(spacing: 10) {
                        FolderIconTile(folder: folder)
                        Text(folder.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text("\(count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                        Spacer(minLength: 4)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                NavigationLink {
                    FolderAggregateView(folder: folder, allFolders: allFolders, allProjects: Array(projectsByFolder.values.joined()))
                } label: {
                    Image(systemName: "calendar").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                        .frame(width: 30, height: 30).background(NX.violet.opacity(0.12), in: Circle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
                Button(action: toggle) {
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90)).frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
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
                ForEach(directProjects) { p in
                    ProjectFolderLink(project: p, tree: tree, tally: tallies[p.id], actions: actions)
                }
                if directProjects.isEmpty && subFolders.isEmpty {
                    Text(T("Empty folder.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.leading, 8)
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
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.violet.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4])))
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
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(editing == nil ? T("Create folder") : T("Save")) }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
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
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NX.muted)
            if folder.isUploadedIcon {
                CachedImage(url: URL(string: Config.baseURL.absoluteString + (folder.icon ?? ""))) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Text("📁").font(.system(size: 18)) }
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            } else {
                Text(folder.emoji).font(.system(size: 18))
            }
        }
        .frame(width: 34, height: 34)
    }
}

/// Create a new project (web "Create a new project"): the type first, then name, icon and colour.
struct CreateProjectSheet: View {
    let workspaceId: String
    /// Opens a project that already exists instead of making one: the company's one Pipeline board
    /// (owner/GM, 9 Oct 2026: "Desainnya cuma satu papan/pipeline utama buat semua deal").
    var onOpenExisting: (ProjectRef) -> Void = { _ in }
    /// Made inside this folder (folder → New project here). The one Pipeline board is never filed.
    var folder: ProjectFolder? = nil
    let onCreated: () async -> Void
    @State private var viewer = Viewer.shared
    @Environment(\.dismiss) private var dismiss
    /// Step one (owner, 9 Oct 2026): what the project is for. nil = the type cards are showing.
    @State private var kind: ProjectKind?
    @State private var name = ""
    @State private var color = "#7B2FBE"
    @State private var busy = false
    @State private var err: String?

    private let colors = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#7B2FBE"]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if let kind {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        chosenKind(kind)
                        if let folder, kind != .pipeline { FolderPlacementNote(folder: folder) }
                        field(T("PROJECT NAME")) {
                            TextField("mis. Z Networks Multimedia", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        // No icon field (owner, 11 Oct 2026): every project is drawn as a square in its
                        // colour (ProjectMark); a photo can be added later in Project settings.
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
                            // An outlet opens straight away (web: "Create project + open dashboard").
                            HStack(spacing: 8) {
                                if busy { ProgressView().tint(.white) }
                                Text(kind == .outlet ? T("Create project + open dashboard") : T("Create project"))
                            }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(20)
                }
                } else {
                    kindPicker
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

    /// Four cards. Task Project, Outlet Sales Dashboard and Pipeline Dashboard can be picked; Content
    /// Planner says "Coming soon" and does nothing (owner, 9 Oct 2026; Outlet Sales took Finance
    /// Dashboard's card on 10 Oct 2026).
    private var kindPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(T("What is this project for?")).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                // Pipeline Dashboard is offered to the board's members (picking it opens the board) and,
                // while none exists, to anyone of the company (owner, 9 Oct 2026); a non-member would
                // only be told to ask the board's lead to add them.
                ForEach(ProjectKind.allCases.filter { $0 != .pipeline || viewer.canAccessPipeline }) { k in
                    Button { pick(k) } label: { kindCard(k) }
                        .buttonStyle(.plain)
                        .disabled(!k.available)
                }
            }
            .padding(20)
        }
        .task { await viewer.loadIfNeeded() }
    }

    /// There is one Pipeline board for the whole company: once it exists, picking the type opens it
    /// rather than asking for a name the server would refuse (409 PIPELINE_EXISTS).
    private func pick(_ k: ProjectKind) {
        if k == .pipeline, let board = viewer.pipelineBoard {
            dismiss()
            onOpenExisting(board)
        } else {
            kind = k
        }
    }

    private func kindCard(_ k: ProjectKind) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: k.symbol).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(k.available ? NX.violetText : NX.mutedFg)
                .frame(width: 40, height: 40)
                .background(k.available ? NX.violet.opacity(0.12) : NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(k.title).font(NXFont.text(15, .bold)).foregroundStyle(k.available ? NX.foreground : NX.mutedFg)
                    if !k.available { NexusChip(text: T("Coming soon")) }
                }
                Text(k.blurb).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if k.available {
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg).padding(.top, 12)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(k.available ? NX.card : NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: k.available ? [] : [4])))
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// The chosen type above the form, with the way back to the cards.
    private func chosenKind(_ k: ProjectKind) -> some View {
        HStack(spacing: 8) {
            Image(systemName: k.symbol).font(.system(size: 12, weight: .semibold))
            Text(k.title).font(NXFont.text(13, .semibold))
            Spacer(minLength: 4)
            Button(T("Change type")) { kind = nil }.font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
        }
        .foregroundStyle(NX.violetText)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func create() async {
        busy = true; err = nil; defer { busy = false }
        do {
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            if kind == .pipeline {
                // A board made meanwhile by someone else comes back as 409 PIPELINE_EXISTS with its id:
                // open it, not an error (owner/GM, 9 Oct 2026: one board for the whole company).
                switch try await APIClient.shared.pipelineBoardCreate(workspaceId: workspaceId, name: trimmed, color: color) {
                case .exists(let board):
                    dismiss()
                    onOpenExisting(board)
                    return
                case .created:
                    // The "Pipeline" entry in More / the sidebar learns the new board's id.
                    await viewer.reload()
                }
            } else if kind == .outlet {
                // Any number of outlets, one project each (owner, 10 Oct 2026, for Ryan); it opens on its
                // Overview once the list knows it.
                let made = try await APIClient.shared.outletProjectCreate(workspaceId: workspaceId, name: trimmed, color: color,
                                                                          folderId: folder?.id)
                await onCreated()
                dismiss()
                onOpenExisting(made)
                return
            } else {
                try await APIClient.shared.createProject(workspaceId: workspaceId, name: trimmed, color: color,
                                                        type: (kind ?? .task).rawValue, folderId: folder?.id)
            }
            await onCreated()
            dismiss()
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

    private var accent: Color { Color(hex: project.color ?? "#a168be") }
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
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NX.muted)
                    ProjectMark(icon: project.icon, color: project.color, size: 44, glyph: 24)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(project.name).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(project.description?.isEmpty == false ? project.description! : "No brief yet — add one and make the mission clearer.")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
                Spacer(minLength: 4)
                NexusChip(text: project.statusLabel, tone: statusTone)
            }

            // metrics
            HStack(spacing: 8) {
                metric(T("Cards"), "\(total)")
                metric(T("Done"), done.map { "\($0)" } ?? "—")
                metric(T("Lanes"), "\(project.laneCount)")
            }
            .padding(.top, 16)

            // progress
            VStack(spacing: 6) {
                HStack {
                    Text(done == nil ? T("Calculating…") : "\(Int(progress * 100))% mission energy")
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Text(done.map { "\(max(0, total - $0)) left" } ?? "")
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
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
                    Text(T("Solo quest")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 11))
                    Text(T("No deadline")).font(NXFont.text(11))
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
            RoundedRectangle(cornerRadius: 28, style: .continuous).fill(NX.card)
                .overlay(alignment: .topTrailing) {
                    Circle().fill(accent.opacity(0.10)).frame(width: 110, height: 110).offset(x: 36, y: -36)
                }
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
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
