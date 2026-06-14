import SwiftUI

/// Port of web my-tasks.tsx ("My Quest Log"): tasks grouped Hot today / In motion / Recently slayed,
/// each a row with a done-toggle checkbox, title, lane · comments, priority chip.
struct TasksView: View {
    @Environment(AuthStore.self) private var auth
    @State private var tasks: [MyTask] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationTitle("My Quest Log")
            .task { await load() }
        }
    }

    private var groups: [(label: String, items: [MyTask])] {
        let open = tasks.filter { !$0.isDone }
        let hot = open.filter { isDueSoon($0.dueDate) }
        let motion = open.filter { !isDueSoon($0.dueDate) }
        let done = tasks.filter { $0.isDone }
        return [("Hot today", Array(hot.prefix(8))), ("In motion", Array(motion.prefix(12))), ("Recently slayed", Array(done.prefix(8)))]
            .filter { !$0.1.isEmpty }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            errorState(error)
        } else if tasks.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checklist").font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                Text("Belum ada quest").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text("Task yang di-assign ke kamu muncul di sini.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(groups, id: \.label) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                SectionLabel(group.label)
                                Text("· \(group.items.count)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg.opacity(0.7))
                            }
                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { idx, t in
                                    if idx > 0 { Divider().overlay(NX.border) }
                                    TaskRow(task: t) { await toggle(t) }
                                }
                            }
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                            .nexusShadowSoft()
                        }
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
            Text(msg).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        error = nil
        guard let myId = auth.session?.userId else { loading = false; return }
        do { tasks = try await APIClient.shared.myTasks(assigneeId: myId) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat." }
        loading = false
    }

    private func toggle(_ t: MyTask) async {
        try? await APIClient.shared.setTaskStatus(taskId: t.id, status: t.isDone ? "TODO" : "DONE")
        await load()
    }

    private func isDueSoon(_ iso: String?) -> Bool {
        guard let iso else { return false }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return false }
        return d.timeIntervalSinceNow < 2 * 24 * 60 * 60   // within ~2 days
    }
}

struct TaskRow: View {
    let task: MyTask
    let onToggle: () async -> Void
    @State private var working = false

    var body: some View {
        HStack(spacing: 12) {
            Button {
                working = true
                Task { await onToggle(); working = false }
            } label: {
                ZStack {
                    Circle().strokeBorder(task.isDone ? NX.violet : NX.border, lineWidth: 1.5).frame(width: 22, height: 22)
                    if task.isDone { Circle().fill(NX.violet).frame(width: 22, height: 22); Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
                    if working { ProgressView().scaleEffect(0.6) }
                }
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title ?? "Untitled").font(NXFont.text(14, .semibold))
                    .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(task.isDone).lineLimit(1)
                HStack(spacing: 10) {
                    Label(task.laneName, systemImage: "sparkles").labelStyle(.titleAndIcon)
                    if task.commentCount > 0 { Label("\(task.commentCount)", systemImage: "bubble.left") }
                }
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            if let p = task.priority, p.uppercased() != "NONE" {
                NexusChip(text: p.capitalized, tone: priorityTone(p))
            }
        }
        .padding(14)
    }

    private func priorityTone(_ p: String) -> ChipTone {
        switch p.uppercased() {
        case "URGENT": return .danger
        case "HIGH": return .warning
        case "MEDIUM": return .info
        default: return .neutral
        }
    }
}
