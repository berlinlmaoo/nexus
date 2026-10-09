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
    /// projectId → done/total task counts, filled in after the list renders (see `loadProgress`).
    @State private var tallies: [String: ProjectTally] = [:]

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

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
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
                    // The type picker (Task Project; Finance Dashboard, Content Planner and Pipeline
                    // Dashboard coming soon) is CreateProjectSheet's first step — the only way in.
                    CreateProjectSheet(workspaceId: workspaceId ?? "") { await load() }
                case .newFolder:
                    CreateFolderSheet(workspaceId: workspaceId ?? "") { await load() }
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

                    ForEach(rootFolders) { f in
                        FolderNode(folder: f, depth: 0, allFolders: folders, projectsByFolder: byFolder,
                                   tallies: tallies, collapsed: $collapsed, onMove: move,
                                   onDeleteFolder: deleteFolder, onEditFolder: { sheet = .editFolder($0) })
                    }
                    ForEach(ungrouped) { p in
                        ProjectFolderLink(project: p, folders: folders, tally: tallies[p.id], onMove: move)
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
                ForEach(ps) { p in
                    ProjectFolderLink(project: p, folders: folders, tally: tallies[p.id], onMove: move)
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
    private func move(_ p: Project, to folderId: String?) async {
        try? await APIClient.shared.setProjectFolder(projectId: p.id, folderId: folderId)
        await load()
    }
    private func deleteFolder(_ f: ProjectFolder) async {
        try? await APIClient.shared.projectFolderDelete(f.id)
        await load()
    }
}

/// The one sheet `ProjectsView` shows.
private enum ProjectsSheet: Identifiable {
    case newProject
    case newFolder
    case editFolder(ProjectFolder)

    var id: String {
        switch self {
        case .newProject: return "new-project"
        case .newFolder: return "new-folder"
        case .editFolder(let f): return "edit-folder-\(f.id)"
        }
    }
}

/// A project shown as a card link, with a "move to folder" context menu.
struct ProjectFolderLink: View {
    let project: Project
    let folders: [ProjectFolder]
    var tally: ProjectTally? = nil
    let onMove: (Project, String?) async -> Void
    var body: some View {
        NavigationLink {
            ProjectDetailView(projectId: project.id, projectName: project.name)
        } label: {
            ProjectCard(project: project, tally: tally)
        }
        .buttonStyle(PressableCardStyle())
        .contextMenu {
            let ref = ProjectRef(id: project.id, name: project.name, icon: project.icon)
            Button {
                ProjectShortcuts.shared.togglePin(ref)
            } label: {
                ProjectShortcuts.shared.isPinned(project.id)
                    ? Label(T("Unpin"), systemImage: "pin.slash")
                    : Label(T("Pin"), systemImage: "pin")
            }
            Menu(T("Move to folder")) {
                if project.folderId != nil { Button(T("No folder")) { Task { await onMove(project, nil) } } }
                ForEach(folders.filter { $0.id != project.folderId }) { f in
                    Button { Task { await onMove(project, f.id) } } label: { Label(f.name, systemImage: "folder") }
                }
            }
        }
    }
}

/// Collapsible folder section (recurses for sub-folders).
struct FolderNode: View {
    let folder: ProjectFolder
    let depth: Int
    let allFolders: [ProjectFolder]
    let projectsByFolder: [String: [Project]]
    let tallies: [String: ProjectTally]
    @Binding var collapsed: Set<String>
    let onMove: (Project, String?) async -> Void
    let onDeleteFolder: (ProjectFolder) async -> Void
    let onEditFolder: (ProjectFolder) -> Void

    private var subFolders: [ProjectFolder] {
        allFolders.filter { $0.parentFolderId == folder.id }.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) }
    }
    private var directProjects: [Project] { projectsByFolder[folder.id] ?? [] }
    private var isExpanded: Bool { !collapsed.contains(folder.id) }
    private var count: Int { directProjects.count + subFolders.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button {
                    if collapsed.contains(folder.id) { collapsed.remove(folder.id) } else { collapsed.insert(folder.id) }
                } label: {
                    HStack(spacing: 10) {
                        FolderIconTile(folder: folder)
                        Text(folder.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text("\(count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                    }
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                NavigationLink {
                    FolderAggregateView(folder: folder, allFolders: allFolders, allProjects: Array(projectsByFolder.values.joined()))
                } label: {
                    Image(systemName: "calendar").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                        .frame(width: 30, height: 30).background(NX.violet.opacity(0.12), in: Circle())
                }
                .buttonStyle(.plain)
                Button {
                    if collapsed.contains(folder.id) { collapsed.remove(folder.id) } else { collapsed.insert(folder.id) }
                } label: {
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90)).frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            .contextMenu {
                Button { onEditFolder(folder) } label: { Label(T("Edit folder"), systemImage: "pencil") }
                Button(role: .destructive) { Task { await onDeleteFolder(folder) } } label: { Label(T("Delete folder"), systemImage: "trash") }
            }

            if isExpanded {
                ForEach(subFolders) { sub in
                    FolderNode(folder: sub, depth: depth + 1, allFolders: allFolders, projectsByFolder: projectsByFolder,
                               tallies: tallies, collapsed: $collapsed, onMove: onMove,
                               onDeleteFolder: onDeleteFolder, onEditFolder: onEditFolder)
                }
                ForEach(directProjects) { p in
                    ProjectFolderLink(project: p, folders: allFolders, tally: tallies[p.id], onMove: onMove)
                }
                if directProjects.isEmpty && subFolders.isEmpty {
                    Text(T("Empty folder.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.leading, 8)
                }
            }
        }
        .padding(.leading, CGFloat(depth) * 14)
    }
}

/// Create or edit a project folder: name + emoji/photo icon + color.
struct CreateFolderSheet: View {
    let workspaceId: String
    let editing: ProjectFolder?
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var icon: String
    @State private var color: String
    @State private var photo: (name: String, data: Data)?
    @State private var showImporter = false
    @State private var busy = false
    @State private var err: String?

    init(workspaceId: String, editing: ProjectFolder? = nil, onCreated: @escaping () async -> Void) {
        self.workspaceId = workspaceId; self.editing = editing; self.onCreated = onCreated
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
            .navigationTitle(editing == nil ? T("New folder") : T("Edit folder"))
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
                folderId = try await APIClient.shared.projectFolderCreate(workspaceId: workspaceId, name: trimmed, icon: icon, color: color)
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
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    /// Step one (owner, 9 Oct 2026): what the project is for. nil = the type cards are showing.
    @State private var kind: ProjectKind?
    @State private var name = ""
    @State private var color = "#7B2FBE"
    @State private var icon = "🚀"
    @State private var busy = false
    @State private var err: String?

    private let colors = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#7B2FBE"]
    private let icons = ["🚀", "📁", "⭐️", "⚡️", "🎯", "💼", "🎬", "📣"]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if let kind {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        chosenKind(kind)
                        field(T("PROJECT NAME")) {
                            TextField("mis. Z Networks Multimedia", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field(T("ICON")) {
                            HStack(spacing: 8) {
                                ForEach(icons, id: \.self) { ic in
                                    Text(ic).font(.system(size: 22)).frame(width: 40, height: 40)
                                        .background(icon == ic ? NX.violet.opacity(0.15) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(icon == ic ? NX.violet : NX.border))
                                        .onTapGesture { icon = ic }
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
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Create project")) }
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

    /// Four cards. Task Project and Pipeline Dashboard can be picked; Finance Dashboard and Content
    /// Planner say "Coming soon" and do nothing (owner, 9 Oct 2026).
    private var kindPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(T("What is this project for?")).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                ForEach(ProjectKind.allCases) { k in
                    Button { kind = k } label: { kindCard(k) }
                        .buttonStyle(.plain)
                        .disabled(!k.available)
                }
            }
            .padding(20)
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
            try await APIClient.shared.createProject(workspaceId: workspaceId, name: name.trimmingCharacters(in: .whitespaces), color: color, icon: icon, type: (kind ?? .task).rawValue)
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
                    if project.isUploadedIcon {
                        CachedImage(url: URL(string: Config.baseURL.absoluteString + (project.icon ?? ""))) { img in
                            img.resizable().scaledToFill()
                        } placeholder: { Text("📁").font(.system(size: 22)) }
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    } else {
                        Text(project.emoji).font(.system(size: 22))
                    }
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
