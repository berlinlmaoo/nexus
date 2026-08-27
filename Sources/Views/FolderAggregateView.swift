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

    init(folder: ProjectFolder, allFolders: [ProjectFolder], allProjects: [Project]) {
        self.folder = folder; self.allFolders = allFolders; self.allProjects = allProjects
        _configured = State(initialValue: folder.aggregateProjectIds ?? [])
    }

    static let palette = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"]

    private var folderProjects: [Project] {
        var subtree = FolderAggregateView.descendantFolderIds(folder.id, allFolders); subtree.insert(folder.id)
        return allProjects.filter { ($0.folderId).map(subtree.contains) ?? false }
    }
    private var selectedIds: [String] {
        let all = folderProjects.map(\.id)
        guard !configured.isEmpty else { return all }
        let set = Set(all)
        return configured.filter(set.contains)
    }
    private var projById: [String: Project] { Dictionary(allProjects.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var selectedProjects: [Project] { selectedIds.compactMap { projById[$0] } }

    func colorHex(_ pid: String?) -> String { colorOverride[pid ?? ""] ?? projById[pid ?? ""]?.color ?? "#7b68ee" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("\(selectedIds.count) project · \(tasks.count) task")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)

                if !selectedProjects.isEmpty {
                    ProjectColorLegend(projects: selectedProjects, colorHex: { colorHex($0) }, onRecolor: recolor)
                }

                if loading {
                    HStack(spacing: 8) { ProgressView().tint(NX.violet); Text(T("Loading tasks…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
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
        .navigationTitle(folder.name)
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
        .task { await load() }
    }

    private func load() async {
        loading = true
        tasks = (try? await APIClient.shared.folderTasks(projectIds: selectedIds)) ?? []
        loading = false
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
                Text("Tanggal \(selected.map(String.init) ?? "—")").font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Text("\(dayTasks.count) task").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
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
                            if let ic = p.icon, isEmojiIcon(ic) { Text(ic).font(.system(size: 11)) }
                            Text(p.name).font(NXFont.text(11, .semibold)).foregroundStyle(Color(hex: color)).lineLimit(1)
                        }
                        if let due = ProjDate.parse(task.dueDate) {
                            Text("·").foregroundStyle(NX.mutedFg)
                            Label(ProjDate.dayLabel(due), systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
                Spacer(minLength: 4)
                if let p = task.priority, p.uppercased() != "NONE" { NexusChip(text: p.capitalized, tone: prioTone(p)) }
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
                                        .foregroundStyle(picked.contains(p.id) ? NX.violet : NX.mutedFg.opacity(0.5))
                                    if let ic = p.icon, isEmojiIcon(ic) { Text(ic) } else { Image(systemName: "folder").foregroundStyle(NX.mutedFg) }
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
