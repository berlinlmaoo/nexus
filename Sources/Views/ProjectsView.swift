import SwiftUI
import UniformTypeIdentifiers

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var projects: [Project] = []
    @State private var folders: [ProjectFolder] = []
    @State private var loading = true
    @State private var error: String?
    @State private var workspaceId: String?
    @State private var showCreate = false
    @State private var showCreateFolder = false
    @State private var editFolder: ProjectFolder?
    @State private var collapsed: Set<String> = []

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
            .navigationTitle("Mission Control")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showCreate = true } label: { Label("Mission baru", systemImage: "rectangle.stack.badge.plus") }
                        Button { showCreateFolder = true } label: { Label("Folder baru", systemImage: "folder.badge.plus") }
                    } label: { Image(systemName: "plus") }
                    .disabled(workspaceId == nil)
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateProjectSheet(workspaceId: workspaceId ?? "") { await load() }
            }
            .sheet(isPresented: $showCreateFolder) {
                CreateFolderSheet(workspaceId: workspaceId ?? "") { await load() }
            }
            .sheet(item: $editFolder) { f in
                CreateFolderSheet(workspaceId: workspaceId ?? "", editing: f) { await load() }
            }
            .task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else if projects.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "rectangle.stack").font(.system(size: 44)).foregroundStyle(NX.mutedFg)
                Text("Belum ada mission").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 16) {
                    // hero strip (web: "missions visible")
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                        Text("\(projects.count) missions visible").font(NXFont.text(12, .semibold))
                    }
                    .foregroundStyle(NX.violet)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(NX.violet.opacity(0.1), in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .leading)

                    ForEach(Array(rootFolders.enumerated()), id: \.element.id) { idx, f in
                        FolderNode(folder: f, depth: 0, allFolders: folders, projectsByFolder: byFolder,
                                   collapsed: $collapsed, onMove: move, onDeleteFolder: deleteFolder,
                                   onEditFolder: { editFolder = $0 })
                            .revealOnAppear(idx)
                    }
                    ForEach(Array(ungrouped.enumerated()), id: \.element.id) { idx, p in
                        ProjectFolderLink(project: p, folders: folders, onMove: move)
                            .revealOnAppear(rootFolders.count + idx)
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(msg).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }
        .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        error = nil
        do {
            projects = try await APIClient.shared.projects()
            if workspaceId == nil { workspaceId = try? await APIClient.shared.workspaceInfo().workspaceId }
            folders = (try? await APIClient.shared.projectFolders(workspaceId: workspaceId)) ?? []
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Terjadi kesalahan."
        }
        loading = false
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

/// A project shown as a card link, with a "move to folder" context menu.
struct ProjectFolderLink: View {
    let project: Project
    let folders: [ProjectFolder]
    let onMove: (Project, String?) async -> Void
    var body: some View {
        NavigationLink {
            ProjectDetailView(projectId: project.id, projectName: project.name)
        } label: {
            ProjectCard(project: project)
        }
        .buttonStyle(PressableCardStyle())
        .contextMenu {
            Menu("Pindah ke folder") {
                if project.folderId != nil { Button("Tanpa folder") { Task { await onMove(project, nil) } } }
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
            Button {
                if collapsed.contains(folder.id) { collapsed.remove(folder.id) } else { collapsed.insert(folder.id) }
            } label: {
                HStack(spacing: 10) {
                    FolderIconTile(folder: folder)
                    Text(folder.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text("\(count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))
                }
                .padding(12)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button { onEditFolder(folder) } label: { Label("Edit folder", systemImage: "pencil") }
                Button(role: .destructive) { Task { await onDeleteFolder(folder) } } label: { Label("Hapus folder", systemImage: "trash") }
            }

            if isExpanded {
                ForEach(subFolders) { sub in
                    FolderNode(folder: sub, depth: depth + 1, allFolders: allFolders, projectsByFolder: projectsByFolder,
                               collapsed: $collapsed, onMove: onMove, onDeleteFolder: onDeleteFolder, onEditFolder: onEditFolder)
                }
                ForEach(directProjects) { p in
                    ProjectFolderLink(project: p, folders: allFolders, onMove: onMove)
                }
                if directProjects.isEmpty && subFolders.isEmpty {
                    Text("Folder kosong.").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.leading, 8)
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
                        field("NAMA FOLDER") {
                            TextField("mis. Client Pertamina", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field("ICON") {
                            HStack(spacing: 8) {
                                Button { showImporter = true } label: {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NX.violet.opacity(0.12))
                                        if let photo, let ui = UIImage(data: photo.data) {
                                            Image(uiImage: ui).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        } else {
                                            Image(systemName: "photo.badge.plus").font(.system(size: 16)).foregroundStyle(NX.violet)
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
                        field("WARNA") {
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
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(editing == nil ? "Buat folder" : "Simpan") }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(20)
                }
            }
            .navigationTitle(editing == nil ? "Folder baru" : "Edit folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } } }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.image], allowsMultipleSelection: false) { result in
                if case let .success(urls) = result, let url = urls.first {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url) { photo = (url.lastPathComponent, data) }
                }
            }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
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
            if let photo { try? await APIClient.shared.uploadFolderIcon(folderId: folderId, fileName: photo.name, data: photo.data) }
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? "Gagal simpan folder."
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
                AsyncImage(url: URL(string: Config.baseURL.absoluteString + (folder.icon ?? ""))) { img in
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

/// Create a new project (web "Launch a new mission"): name + color.
struct CreateProjectSheet: View {
    let workspaceId: String
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
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
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field("NAMA MISSION") {
                            TextField("mis. PATS Multimedia", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field("ICON") {
                            HStack(spacing: 8) {
                                ForEach(icons, id: \.self) { ic in
                                    Text(ic).font(.system(size: 22)).frame(width: 40, height: 40)
                                        .background(icon == ic ? NX.violet.opacity(0.15) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(icon == ic ? NX.violet : NX.border))
                                        .onTapGesture { icon = ic }
                                }
                            }
                        }
                        field("WARNA") {
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
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Launch mission") }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Mission baru")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } } }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            content()
        }
    }

    private func create() async {
        busy = true; err = nil; defer { busy = false }
        do {
            try await APIClient.shared.createProject(workspaceId: workspaceId, name: name.trimmingCharacters(in: .whitespaces), color: color, icon: icon)
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? "Gagal bikin project."
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

struct ProjectCard: View {
    let project: Project

    private var accent: Color { Color(hex: project.color ?? "#a168be") }
    private var done: Int { 0 }   // completed count not in the list endpoint (matches web's 0 for fresh)
    private var total: Int { project.taskCount }
    private var progress: Double { total > 0 ? Double(done) / Double(total) : 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // header row
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NX.muted)
                    if project.isUploadedIcon {
                        AsyncImage(url: URL(string: Config.baseURL.absoluteString + (project.icon ?? ""))) { img in
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
                metric("Cards", "\(total)")
                metric("Done", "\(done)")
                metric("Lanes", "\(project.laneCount)")
            }
            .padding(.top, 16)

            // progress
            VStack(spacing: 6) {
                HStack {
                    Text("\(Int(progress * 100))% mission energy").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Text("\(max(0, total - done)) left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
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
                    Text("Solo quest").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 11))
                    Text("No deadline").font(NXFont.text(11))
                }.foregroundStyle(NX.mutedFg)
            }
            .padding(.top, 16)
        }
        .padding(18)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Circle().fill(accent.opacity(0.10)).frame(width: 110, height: 110).offset(x: 36, y: -36).allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .nexusShadowSoft()
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
