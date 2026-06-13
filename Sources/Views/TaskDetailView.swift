import SwiftUI

/// Focused port of TaskDetailPanel: title, status/priority, assignees, due, description,
/// subtasks (toggle), comments.
struct TaskDetailView: View {
    let taskId: String
    @Environment(AuthStore.self) private var auth
    @State private var task: TaskDetail?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violet)
            } else if let task {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(task)
                        metaRow(task)
                        if !plainBlockText(task.description).isEmpty { descriptionCard(task) }
                        subtasksCard(task)
                        commentsCard(task)
                    }
                    .padding(16)
                }
            } else {
                Text(error ?? "Gagal memuat task.").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ t: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let parent = t.parent {
                HStack(spacing: 6) {
                    Image(systemName: "checklist").font(.system(size: 11, weight: .bold))
                    Text("Subtask dari").foregroundStyle(NX.accentFg.opacity(0.8))
                    Text(parent.title ?? "task").fontWeight(.semibold).lineLimit(1)
                }
                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.accentFg)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(NX.accentBg, in: Capsule())
            }
            Text(t.title).font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
            HStack(spacing: 8) {
                Button { Task { await toggleDone(t) } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle")
                        Text(t.isDone ? "Done" : "Mark done")
                    }
                    .font(NXFont.text(13, .bold)).foregroundStyle(t.isDone ? NX.success : NX.foreground)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background((t.isDone ? NX.success : NX.muted).opacity(t.isDone ? 0.12 : 1), in: Capsule())
                }.buttonStyle(.plain)
                if let p = t.priority, p.uppercased() != "NONE" { NexusChip(text: p.capitalized, tone: prioTone(p)) }
            }
        }
    }

    private func metaRow(_ t: TaskDetail) -> some View {
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text("ASSIGNED").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                if let names = t.assignees?.compactMap({ $0.user?.name }), !names.isEmpty {
                    Text(names.joined(separator: ", ")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                } else { Text("Unassigned").font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("DUE").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                Text(dueText(t.dueDate)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            }
            Spacer()
        }
        .padding(14).nexusCard(padding: 14, radius: 18)
    }

    private func descriptionCard(_ t: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DESCRIPTION").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            Text(plainBlockText(t.description)).font(NXFont.text(14)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func subtasksCard(_ t: TaskDetail) -> some View {
        let subs = t.subtasks ?? []
        let done = subs.filter(\.isDone).count
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checklist").foregroundStyle(NX.mutedFg)
                Text(subs.isEmpty ? "Subtasks" : "Subtasks · \(done)/\(subs.count)").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            }
            if subs.isEmpty {
                Text("Belum ada subtask.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(subs) { st in
                    HStack(spacing: 10) {
                        Button { Task { await toggleSub(st) } } label: {
                            Image(systemName: st.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18)).foregroundStyle(st.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                        }.buttonStyle(.plain)
                        Text(st.title ?? "Untitled").font(NXFont.text(14))
                            .foregroundStyle(st.isDone ? NX.mutedFg : NX.foreground).strikethrough(st.isDone).lineLimit(2)
                        Spacer()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func commentsCard(_ t: TaskDetail) -> some View {
        let comments = t.comments ?? []
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right").foregroundStyle(NX.mutedFg)
                Text("Comments · \(comments.count)").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            }
            if comments.isEmpty {
                Text("Belum ada komentar.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(comments) { c in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(c.user?.name ?? "Someone").font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                            Spacer()
                            Text(dateText(c.createdAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        Text(c.content ?? "").font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.9)).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    // MARK: data

    private func load() async {
        error = nil
        do { task = try await APIClient.shared.taskDetail(taskId) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat." }
        loading = false
    }
    private func toggleDone(_ t: TaskDetail) async {
        try? await APIClient.shared.setTaskStatus(taskId: t.id, status: t.isDone ? "TODO" : "DONE"); await load()
    }
    private func toggleSub(_ st: TaskDetail.SubDetail) async {
        try? await APIClient.shared.setTaskStatus(taskId: st.id, status: st.isDone ? "TODO" : "DONE"); await load()
    }

    private func prioTone(_ p: String) -> ChipTone {
        switch p.uppercased() { case "URGENT": return .danger; case "HIGH": return .warning; case "MEDIUM": return .info; default: return .neutral }
    }
    private func dueText(_ iso: String?) -> String {
        guard let iso else { return "—" }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "—" }
        let f = DateFormatter(); f.dateFormat = "d MMM yyyy"; f.locale = Locale(identifier: "id_ID"); return f.string(from: d)
    }
    private func dateText(_ iso: String?) -> String {
        guard let iso else { return "" }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "" }
        let f = DateFormatter(); f.dateFormat = "d MMM, HH:mm"; f.locale = Locale(identifier: "id_ID"); return f.string(from: d)
    }
}
