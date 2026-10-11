import SwiftUI

/// Folder aggregate view — a calendar of every task across the projects in a folder (+ its
/// descendant folders), colour-coded per project. Faithful port of the web `/folders/$folderId`
/// (which is calendar-only on mobile): dot-grid month + day-detail list + collapsible colour
/// legend (also an inline recolour) + a "Pick projects" curated-subset picker.
struct FolderAggregateView: View {
    let folder: ProjectFolder
    let allFolders: [ProjectFolder]
    let allProjects: [Project]

    @State private var tasks: [FolderTask] = []
    @State private var loading = true
    @State private var configured: [String]
    @State private var colorOverride: [String: String] = [:]   // optimistic recolour from the legend
    @State private var pickerOpen = false
    /// The tasks have been read once. Later reads (back from a task, a project moved in) are quiet:
    /// the spinner used to replace the calendar and send it back to this month with no day picked.
    @State private var loadedOnce = false
    /// Fresh copies from the quiet refresh (owner, 8 Oct 2026: a project moved into this folder on
    /// another device must show here). nil until the first one lands; until then the screen draws
    /// what the projects list handed over when it opened it.
    @State private var liveProjects: [Project]?
    @State private var liveFolders: [ProjectFolder]?
    /// The curated subset as the server last said it, so a change made on another device is picked
    /// up without undoing one just made here whose save the server has not answered yet.
    @State private var serverConfigured: [String]

    init(folder: ProjectFolder, allFolders: [ProjectFolder], allProjects: [Project]) {
        self.folder = folder; self.allFolders = allFolders; self.allProjects = allProjects
        _configured = State(initialValue: folder.aggregateProjectIds ?? [])
        _serverConfigured = State(initialValue: folder.aggregateProjectIds ?? [])
    }

    private var projectsNow: [Project] { liveProjects ?? allProjects }
    private var foldersNow: [ProjectFolder] { liveFolders ?? allFolders }
    /// This folder as the last refresh has it (a rename shows in the title).
    private var folderNow: ProjectFolder { foldersNow.first { $0.id == folder.id } ?? folder }

    static let palette = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"]

    private var folderProjects: [Project] {
        var subtree = FolderAggregateView.descendantFolderIds(folder.id, foldersNow); subtree.insert(folder.id)
        return projectsNow.filter { ($0.folderId).map(subtree.contains) ?? false }
    }
    private var selectedIds: [String] {
        let all = folderProjects.map(\.id)
        guard !configured.isEmpty else { return all }
        let set = Set(all)
        return configured.filter(set.contains)
    }
    private var projById: [String: Project] { Dictionary(projectsNow.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var selectedProjects: [Project] { selectedIds.compactMap { projById[$0] } }

    func colorHex(_ pid: String?) -> String { colorOverride[pid ?? ""] ?? projById[pid ?? ""]?.color ?? "#7b68ee" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("\(selectedIds.count) \(T("projects")) · \(tasks.count) \(T("tasks"))")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)

                if !selectedProjects.isEmpty {
                    ProjectColorLegend(projects: selectedProjects, colorHex: { colorHex($0) }, onRecolor: recolor)
                }

                if loading {
                    HStack(spacing: 8) { ProgressView().tint(NX.violetText); Text(T("Loading tasks…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                } else if selectedIds.isEmpty {
                    FolderEmpty(text: T("This folder has no projects yet. Move a project here, or pick some via 'Pick projects'."))
                } else {
                    FolderCalendar(tasks: tasks, colorHex: { colorHex($0) }, projById: projById)
                }
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(folderNow.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { pickerOpen = true } label: { Image(systemName: "slider.horizontal.3") }
            }
        }
        .sheet(isPresented: $pickerOpen) {
            FolderProjectPicker(folderId: folder.id, projects: folderProjects, selected: selectedIds, usingAll: configured.isEmpty) { newIds in
                configured = newIds
                Task { await load() }
            }
        }
        // Every appearance: the first read with the spinner, later ones (back from a task) quietly.
        .task { await load(quiet: loadedOnce) }
        // Which projects are in this folder, live: every 30 s while on screen and the app is in
        // front, at once on coming back to the front or back to this screen, and on the realtime
        // client's word once it exists. The tasks are read again only when that set changed.
        .liveRefresh(every: 30, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.projects, RealtimeKind.folders],
                     refreshOnReturn: true) {
            await refreshQuietly()
        }
    }

    private func load(quiet: Bool = false) async {
        if !quiet { loading = true }
        let fresh = try? await APIClient.shared.folderTasks(projectIds: selectedIds)
        // A quiet read that fails keeps the calendar as it is.
        if let fresh { tasks = fresh } else if !quiet { tasks = [] }
        loading = false
        loadedOnce = true
    }

    /// Projects and folders re-read without a sound, through the same loaders the projects list
    /// uses. A failed request changes nothing.
    private func refreshQuietly() async {
        guard !loading else { return }
        guard let projects = try? await APIClient.shared.projects() else { return }
        // The workspace of a project already in this folder; with none, every folder the person can
        // see, which still holds this one and everything under it.
        let workspaceId = projectsNow.first { $0.folderId == folder.id }?.workspaceId
        let folders = try? await APIClient.shared.projectFolders(workspaceId: workspaceId)
        let before = selectedIds
        liveProjects = projects
        if let folders {
            liveFolders = folders
            if let mine = folders.first(where: { $0.id == folder.id }) {
                let ids = mine.aggregateProjectIds ?? []
                if ids != serverConfigured {
                    serverConfigured = ids
                    configured = ids
                }
            }
        }
        if selectedIds != before { await load(quiet: true) }
    }

    private func recolor(_ projectId: String, _ hex: String) {
        colorOverride[projectId] = hex
        Task { try? await APIClient.shared.updateProject(projectId, fields: ["color": hex]) }
    }

    /// Recursive set of every folder nested under `id`.
    static func descendantFolderIds(_ id: String, _ folders: [ProjectFolder]) -> Set<String> {
        var out: Set<String> = []
        func walk(_ parent: String) {
            for f in folders where f.parentFolderId == parent {
                if out.insert(f.id).inserted { walk(f.id) }
            }
        }
        walk(id)
        return out
    }
}

private struct FolderEmpty: View {
    let text: String
    var body: some View {
        Text(text).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(28)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
    }
}

// MARK: - Colour legend (collapsible; tap a project → inline recolour)

private struct ProjectColorLegend: View {
    let projects: [Project]
    let colorHex: (String) -> String
    let onRecolor: (String, String) -> Void
    @State private var open = false
    @State private var editing: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.easeInOut(duration: 0.2)) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    HStack(spacing: -4) {
                        ForEach(projects.prefix(6)) { p in
                            Circle().fill(Color(hex: colorHex(p.id))).frame(width: 11, height: 11)
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                        }
                    }
                    Text("Warna project").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(open ? 0 : -90))
                }
            }
            .buttonStyle(.plain)

            if open {
                ForEach(projects) { p in
                    VStack(alignment: .leading, spacing: 6) {
                        Button { withAnimation(.easeInOut(duration: 0.15)) { editing = editing == p.id ? nil : p.id } } label: {
                            HStack(spacing: 8) {
                                Circle().fill(Color(hex: colorHex(p.id))).frame(width: 14, height: 14)
                                    .overlay(Circle().strokeBorder(.black.opacity(0.1)))
                                Text(p.name).font(NXFont.text(13, .medium)).foregroundStyle(Color(hex: colorHex(p.id))).lineLimit(1)
                                Spacer()
                                Image(systemName: "paintpalette").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(Color(hex: colorHex(p.id)).opacity(0.12), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color(hex: colorHex(p.id)).opacity(0.4)))
                        }
                        .buttonStyle(.plain)

                        if editing == p.id {
                            HStack(spacing: 8) {
                                ForEach(FolderAggregateView.palette, id: \.self) { c in
                                    Button { onRecolor(p.id, c); editing = nil } label: {
                                        Circle().fill(Color(hex: c)).frame(width: 24, height: 24)
                                            .overlay(Circle().strokeBorder(colorHex(p.id).lowercased() == c ? NX.foreground : .clear, lineWidth: 2))
                                    }.buttonStyle(.plain)
                                }
                            }
                            .padding(.leading, 4)
                        }
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

// MARK: - Mobile calendar (dot-grid month + day-detail list)

private struct FolderCalendar: View {
    let tasks: [FolderTask]
    let colorHex: (String?) -> String
    let projById: [String: Project]
    @State private var monthOffset = 0
    @State private var selectedDay: Int?

    private var cal: Calendar { ProjDate.cal }
    private var monthDate: Date {
        let base = cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
        return cal.date(byAdding: .month, value: monthOffset, to: base) ?? base
    }
    private var year: Int { cal.component(.year, from: monthDate) }
    private var mon: Int { cal.component(.month, from: monthDate) }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthDate)?.count ?? 30 }
    private var leadingBlanks: Int { (cal.component(.weekday, from: monthDate) + 5) % 7 } // Monday-first
    private var todayDay: Int? {
        let n = Date()
        return cal.component(.year, from: n) == year && cal.component(.month, from: n) == mon ? cal.component(.day, from: n) : nil
    }
    private var byDay: [Int: [FolderTask]] {
        var map: [Int: [FolderTask]] = [:]
        for t in tasks {
            guard let d = ProjDate.parse(t.dueDate), cal.component(.year, from: d) == year, cal.component(.month, from: d) == mon else { continue }
            map[cal.component(.day, from: d), default: []].append(t)
        }
        return map
    }

    var body: some View {
        let days = byDay
        let firstWithTasks = days.keys.sorted().first
        let selected = selectedDay ?? todayDay ?? firstWithTasks
        let dayTasks = selected.flatMap { days[$0] } ?? []

        VStack(alignment: .leading, spacing: 16) {
            VStack(spacing: 10) {
                HStack {
                    Button { goMonth(-1) } label: { Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 34, height: 34) }
                    Spacer()
                    Text(ProjDate.fmt("MMMM yyyy").string(from: monthDate).capitalized).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                    Spacer()
                    Button { goMonth(1) } label: { Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 34, height: 34) }
                }
                let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
                LazyVGrid(columns: cols, spacing: 4) {
                    ForEach(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"], id: \.self) { d in
                        Text(d).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity).padding(.vertical, 2)
                    }
                    ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 38) }
                    ForEach(1...daysInMonth, id: \.self) { day in
                        dayCell(day, has: days[day] != nil, isSel: day == selected, isToday: day == todayDay)
                    }
                }
            }
            .padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(NX.border))

            HStack {
                Text("\(T("Date")) \(selected.map(String.init) ?? "—")").font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Text("\(dayTasks.count) \(T("tasks"))").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if dayTasks.isEmpty {
                FolderEmpty(text: T("Nothing due on this date."))
            } else {
                ForEach(dayTasks) { t in FolderTaskRow(task: t, color: colorHex(t.projectId), project: projById[t.projectId ?? ""]) }
            }
        }
    }

    private func dayCell(_ day: Int, has: Bool, isSel: Bool, isToday: Bool) -> some View {
        Button { selectedDay = day } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSel ? NX.violet : (has ? NX.violet.opacity(0.12) : .clear))
                if !isSel && isToday {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.violet.opacity(0.5))
                }
                Text("\(day)").font(NXFont.text(13, .semibold)).foregroundStyle(isSel ? .white : (has ? NX.foreground : NX.mutedFg))
                if has {
                    Circle().fill(isSel ? Color.white : NX.violet).frame(width: 5, height: 5)
                        .frame(maxHeight: .infinity, alignment: .bottom).padding(.bottom, 4)
                }
            }
            .frame(height: 38)
        }
        .buttonStyle(.plain)
    }

    private func goMonth(_ d: Int) { selectedDay = nil; monthOffset += d }
}

private struct FolderTaskRow: View {
    let task: FolderTask
    let color: String
    let project: Project?

    var body: some View {
        NavigationLink { TaskDetailView(taskId: task.id) } label: {
            HStack(spacing: 10) {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16)).foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.45))
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).font(NXFont.text(14, .semibold)).foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                        .strikethrough(task.isDone).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 5) {
                        if let p = project {
                            ProjectMark(icon: p.icon, color: p.color, size: 14)
                            Text(p.name).font(NXFont.text(11, .semibold)).foregroundStyle(Color(hex: color)).lineLimit(1)
                        }
                        if let due = ProjDate.parse(task.dueDate) {
                            Text("·").foregroundStyle(NX.mutedFg)
                            Label(ProjDate.dayLabel(due), systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
                Spacer(minLength: 4)
                if let p = task.priority, p.uppercased() != "NONE" { PriorityPill(priority: p) }
                if let a = task.assignee { AvatarView(url: a.avatar, initial: String((a.name ?? "?").first ?? "?").uppercased(), size: 24) }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card).nexusShadowSoft()
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
            }
            .overlay(alignment: .leading) { Rectangle().fill(Color(hex: color)).frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2)) }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Curated project picker

private struct FolderProjectPicker: View {
    let folderId: String
    let projects: [Project]
    let selected: [String]
    let usingAll: Bool
    let onSaved: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String>
    @State private var saving = false

    init(folderId: String, projects: [Project], selected: [String], usingAll: Bool, onSaved: @escaping ([String]) -> Void) {
        self.folderId = folderId; self.projects = projects; self.selected = selected; self.usingAll = usingAll; self.onSaved = onSaved
        _picked = State(initialValue: Set(selected))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(T("Pick which projects go into this folder's calendar.")
                         + (usingAll ? T(" Right now it's showing EVERY project in the folder.") : ""))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    HStack(spacing: 8) {
                        Button(T("Select all")) { picked = Set(projects.map(\.id)) }.font(NXFont.text(12, .semibold))
                        Button("Kosongkan") { picked = [] }.font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    if projects.isEmpty {
                        Text(T("This folder has no projects yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(.vertical, 8)
                    } else {
                        ForEach(projects) { p in
                            Button { toggle(p.id) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: picked.contains(p.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(picked.contains(p.id) ? NX.violetText : NX.mutedFg.opacity(0.5))
                                    ProjectMark(icon: p.icon, color: p.color, size: 20)
                                    Text(p.name).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                                    Spacer()
                                }
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                            }.buttonStyle(.plain)
                        }
                    }
                }.padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Pick projects"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await save() } } label: { if saving { ProgressView() } else { Text(T("Save")).font(NXFont.text(15, .bold)) } }.disabled(saving)
                }
            }
        }
    }

    private func toggle(_ id: String) { if picked.contains(id) { picked.remove(id) } else { picked.insert(id) } }

    private func save() async {
        saving = true
        // All selected → store [] so the folder auto-includes future projects too (matches web).
        let all = projects.map(\.id)
        let next = picked.count == all.count && all.allSatisfy(picked.contains) ? [] : Array(picked)
        try? await APIClient.shared.setFolderAggregate(folderId: folderId, projectIds: next)
        saving = false
        onSaved(next)
        dismiss()
    }
}

// MARK: - Folder, by id

/// A folder opened by its id alone: "Open folder" on a restored folder in Audit, and "Open execution
/// folder" on a won Pipeline deal (owner, 10 Oct 2026). The folder screen draws from the folder, every
/// folder and every project (it works out which projects sit under it, subfolders included), and the
/// caller has only the id: they are read first, through the same loaders the folder screen refreshes with.
/// Not private: used from AdminAuditViews.swift and PipelineDealView.swift.
struct FolderByIdView: View {
    let folderId: String
    @State private var folder: ProjectFolder?
    @State private var folders: [ProjectFolder] = []
    @State private var projects: [Project] = []
    @State private var failed = false

    var body: some View {
        if let folder {
            FolderAggregateView(folder: folder, allFolders: folders, allProjects: projects)
        } else {
            ZStack {
                NX.background.ignoresSafeArea()
                if failed {
                    ErrorState(message: T("Couldn't load this folder."), icon: "folder") { Task { await load() } }
                } else {
                    ProgressView().tint(NX.violetText)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
        }
    }

    private func load() async {
        failed = false
        do {
            async let readProjects = APIClient.shared.projects()
            // No workspace: every folder this person can see, which holds this one wherever it is.
            async let readFolders = APIClient.shared.projectFolders(workspaceId: nil)
            let (p, f) = try await (readProjects, readFolders)
            projects = p
            folders = f
            // Not among them: deleted again, or out of this person's reach.
            if let match = f.first(where: { $0.id == folderId }) { folder = match } else { failed = true }
        } catch {
            failed = true
        }
    }
}
