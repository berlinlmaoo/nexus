import SwiftUI

/// Project detail with the web's view-switcher tabs (Overview · Board · List · Calendar ·
/// Timeline · Pages · Forms · Files · Chat). Task-centric tabs run off the one project(id) load.
struct ProjectDetailView: View {
    let projectId: String
    let projectName: String
    @Environment(AuthStore.self) private var auth
    @State private var detail: ProjectDetail?
    @State private var loading = true
    @State private var error: String?
    @State private var openTaskId: String?
    @State private var tab: ProjectTab = .board
    @State private var showCreate = false
    @State private var prefillDue: Date?

    private var canCreate: Bool { !(detail?.taskLists?.isEmpty ?? true) }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Divider().overlay(NX.border)
            content
        }
        .background {
            NX.background.ignoresSafeArea()
            RadialGradient(colors: [Color(hex: "#4eb301").opacity(0.05), .clear], center: .topLeading, startRadius: 0, endRadius: 320).ignoresSafeArea()
            RadialGradient(colors: [Color(hex: "#7b4dff").opacity(0.07), .clear], center: .topTrailing, startRadius: 0, endRadius: 320).ignoresSafeArea()
        }
        .navigationTitle(projectName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { prefillDue = nil; showCreate = true } label: { Image(systemName: "plus") }
                    .disabled(!canCreate)
            }
        }
        .sheet(isPresented: $showCreate) {
            CreateTaskSheet(projectId: projectId, lanes: detail?.taskLists ?? [], prefillDue: prefillDue) { await load() }
        }
        .task { await load() }
        .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
    }

    // MARK: tab bar (underline style, horizontally scrollable)

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(ProjectTab.allCases) { t in
                    Button { tab = t } label: {
                        VStack(spacing: 5) {
                            HStack(spacing: 5) {
                                Image(systemName: t.icon).font(.system(size: 12, weight: .semibold))
                                Text(t.rawValue).font(NXFont.text(13, tab == t ? .semibold : .medium))
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

    // MARK: content

    @ViewBuilder private var content: some View {
        switch tab {
        case .pages: ProjectPagesTab(projectId: projectId)
        case .forms: ProjectFormsTab(projectId: projectId, projectName: projectName)
        case .files: ProjectFilesTab(projectId: projectId)
        case .chat:  ProjectChatTab(projectId: projectId, projectName: projectName)
        default:
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                VStack(spacing: 12) {
                    Image(systemName: "lock").font(.system(size: 38)).foregroundStyle(NX.mutedFg)
                    Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                    Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
            } else if let detail {
                switch tab {
                case .overview: OverviewTab(detail: detail)
                case .board:    boardTab(detail)
                case .list:     ListTab(detail: detail, onOpen: { openTaskId = $0 })
                case .calendar: CalendarTab(detail: detail, onOpen: { openTaskId = $0 }, onCreate: { date in prefillDue = date; showCreate = true })
                case .timeline: TimelineTab(detail: detail, onOpen: { openTaskId = $0 })
                default:        EmptyView()
                }
            }
        }
    }

    @ViewBuilder private func boardTab(_ detail: ProjectDetail) -> some View {
        if let lanes = detail.taskLists, !lanes.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(lanes) { lane in
                        LaneColumn(lane: lane, allLanes: lanes, onOpen: { openTaskId = $0 },
                                   onAddTask: { title in await addTask(laneId: lane.id, title: title) },
                                   onMove: { tid, lid in await moveTask(tid, to: lid) })
                    }
                }
                .padding(16)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "square.stack.3d.up.slash").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text("No lanes yet").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text("Project ini belum punya lane.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func load() async {
        error = nil
        do { detail = try await APIClient.shared.project(projectId) }
        catch APIError.unauthorized { auth.logout() }
        catch APIError.http(403) { error = "Project terkunci — kamu belum jadi member project ini." }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat project." }
        loading = false
    }

    private func addTask(laneId: String, title: String) async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        try? await APIClient.shared.createTask(projectId: projectId, taskListId: laneId, title: t)
        await load()
    }

    private func moveTask(_ taskId: String, to laneId: String) async {
        try? await APIClient.shared.updateTask(taskId, ["taskListId": laneId])
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
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(lane.name).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Text("\(lane.tasks?.count ?? 0)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
            }
            .padding(.horizontal, 4)

            ForEach(lane.tasks ?? []) { task in
                Button { onOpen(task.id) } label: { BoardCard(task: task) }.buttonStyle(.plain)
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
                Text("Kosong").font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.6))
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
                    .background(NX.card.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
            }

            if composing {
                VStack(spacing: 8) {
                    TextField("Judul task…", text: $newTitle, axis: .vertical)
                        .font(NXFont.text(14)).focused($focused).lineLimit(3)
                        .padding(10).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.violet.opacity(0.5)))
                        .onSubmit(submit)
                    HStack(spacing: 8) {
                        Button("Batal") { composing = false; newTitle = "" }
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        Spacer()
                        Button(action: submit) {
                            HStack(spacing: 4) { if adding { ProgressView().scaleEffect(0.7) }; Text("Tambah") }
                                .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(NX.violet, in: Capsule())
                        }
                        .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty || adding)
                    }
                }
            } else {
                Button { composing = true; focused = true } label: {
                    HStack(spacing: 6) { Image(systemName: "plus"); Text("Tambah task") }
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }.buttonStyle(.plain)
            }
        }
        .frame(width: 290)
        .padding(12)
        .background(NX.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border))
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

struct BoardCard: View {
    let task: BoardTask

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16)).foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                Text(task.title).font(NXFont.text(14, .bold))
                    .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(task.isDone).lineLimit(3)
                Spacer(minLength: 0)
                if let p = task.priority, p.uppercased() != "NONE" {
                    NexusChip(text: p.capitalized, tone: prioTone(p))
                }
            }
            HStack(spacing: 8) {
                Label(dueText, systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if task.totalSubs > 0 {
                    NexusChip(text: "\(task.doneSubs)/\(task.totalSubs)", tone: task.doneSubs == task.totalSubs ? .success : .neutral, systemImage: "checklist")
                }
                Spacer()
                if task.commentCount > 0 {
                    Label("\(task.commentCount)", systemImage: "bubble.left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                if let ini = task.assigneeInitial {
                    Text(ini).font(NXFont.text(10, .black)).foregroundStyle(NX.violet)
                        .frame(width: 22, height: 22).background(NX.accentBg, in: Circle())
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
        .nexusShadowSoft()
    }

    private var dueText: String {
        guard let iso = task.dueDate else { return "No due" }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "No due" }
        let f = DateFormatter(); f.dateFormat = "d MMM"; f.locale = Locale(identifier: "id_ID"); return f.string(from: d)
    }
    private func prioTone(_ p: String) -> ChipTone {
        switch p.uppercased() { case "URGENT": return .danger; case "HIGH": return .warning; case "MEDIUM": return .info; default: return .neutral }
    }
}
