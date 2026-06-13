import SwiftUI

/// Focused port of TaskDetailPanel: title, status/priority, assignees, due, description,
/// subtasks (toggle), comments.
struct TaskDetailView: View {
    let taskId: String
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var task: TaskDetail?
    @State private var loading = true
    @State private var error: String?
    @State private var editTitle = ""
    @State private var newComment = ""
    @State private var newSubtask = ""
    @State private var showDuePicker = false
    @State private var dueValue = Date()
    @State private var showAssignee = false

    private let statuses = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
    private let priorities = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]
    private func statusLabel(_ s: String?) -> String {
        switch (s ?? "TODO").uppercased() {
        case "IN_PROGRESS": return "In Progress"; case "IN_REVIEW": return "In Review"
        case "DONE": return "Done"; case "CANCELLED": return "Cancelled"; default: return "To Do"
        }
    }

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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Hapus task", systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Hapus task ini?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Hapus", role: .destructive) { Task { await deleteTask() } }
            Button("Batal", role: .cancel) {}
        } message: { Text("Task beserta subtask & komentarnya akan dihapus.") }
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
            // editable title (commits on submit / when focus leaves)
            TextField("Judul task", text: $editTitle, axis: .vertical)
                .font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
                .onSubmit { commitTitle(t) }

            // controls: status menu · priority menu · due
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(statuses, id: \.self) { s in
                            Button(statusLabel(s)) { Task { await update(t, ["status": s]) } }
                        }
                    } label: { controlChip(statusLabel(t.status), system: "circle.dashed", tone: t.isDone ? .success : .info) }

                    Menu {
                        ForEach(priorities, id: \.self) { p in
                            Button(p.capitalized) { Task { await update(t, ["priority": p]) } }
                        }
                    } label: { controlChip((t.priority ?? "NONE").capitalized, system: "flag.fill", tone: prioTone(t.priority ?? "NONE")) }

                    Button { dueValue = parsedDue(t.dueDate); showDuePicker = true } label: {
                        controlChip(dueText(t.dueDate), system: "calendar", tone: .neutral)
                    }.buttonStyle(.plain)
                }
            }
        }
        .sheet(isPresented: $showDuePicker) {
            NavigationStack {
                DatePicker("Due date", selection: $dueValue, displayedComponents: .date)
                    .datePickerStyle(.graphical).padding()
                    .navigationTitle("Due date").navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) { Button("Hapus") { Task { await update(t, ["dueDate": NSNull()]); showDuePicker = false } } }
                        ToolbarItem(placement: .topBarTrailing) { Button("Simpan") { Task { await update(t, ["dueDate": isoDay(dueValue)]); showDuePicker = false } }.bold() }
                    }
            }.presentationDetents([.medium])
        }
    }

    private func controlChip(_ text: String, system: String, tone: ChipTone) -> some View {
        HStack(spacing: 5) {
            Image(systemName: system).font(.system(size: 11, weight: .bold))
            Text(text).font(NXFont.text(12, .bold))
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).opacity(0.5)
        }
        .foregroundStyle(tone.fg).padding(.horizontal, 10).padding(.vertical, 7)
        .background(tone.bg, in: Capsule())
    }

    private func metaRow(_ t: TaskDetail) -> some View {
        HStack(spacing: 20) {
            Button { showAssignee = true } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text("ASSIGNED").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                        Image(systemName: "pencil").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.violet)
                    }
                    if let names = t.assignees?.compactMap({ $0.user?.name }), !names.isEmpty {
                        Text(names.joined(separator: ", ")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    } else { Text("Unassigned").font(NXFont.text(13)).foregroundStyle(NX.violet) }
                }
            }.buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 4) {
                Text("DUE").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                Text(dueText(t.dueDate)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            }
            Spacer()
        }
        .padding(14).nexusCard(padding: 14, radius: 18)
        .sheet(isPresented: $showAssignee) {
            AssigneePicker(
                projectId: t.projectId,
                current: Set((t.assignees ?? []).compactMap { $0.user?.id }),
                onSave: { ids in await update(t, ["assigneeIds": Array(ids)]) }
            )
        }
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
            // add subtask
            HStack(spacing: 8) {
                TextField("+ Tambah subtask (Enter)", text: $newSubtask)
                    .font(NXFont.text(14)).onSubmit { addSubtask(t) }
                    .padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button { addSubtask(t) } label: {
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }.disabled(newSubtask.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.top, 4)
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
            // add comment
            HStack(spacing: 8) {
                TextField("Tulis komentar…", text: $newComment, axis: .vertical)
                    .font(NXFont.text(14)).lineLimit(1...3).onSubmit { addComment(t) }
                    .padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button { addComment(t) } label: {
                    Image(systemName: "paperplane.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }.disabled(newComment.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    // MARK: data

    private func load() async {
        error = nil
        do {
            let t = try await APIClient.shared.taskDetail(taskId)
            task = t
            editTitle = t.title
        }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat." }
        loading = false
    }
    private func update(_ t: TaskDetail, _ fields: [String: Any]) async {
        try? await APIClient.shared.updateTask(t.id, fields); await load()
    }
    private func commitTitle(_ t: TaskDetail) {
        let v = editTitle.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, v != t.title else { return }
        Task { await update(t, ["title": v]) }
    }
    private func toggleSub(_ st: TaskDetail.SubDetail) async {
        try? await APIClient.shared.setTaskStatus(taskId: st.id, status: st.isDone ? "TODO" : "DONE"); await load()
    }
    private func deleteTask() async {
        try? await APIClient.shared.deleteTask(taskId); dismiss()
    }
    private func addComment(_ t: TaskDetail) {
        let v = newComment.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        newComment = ""
        Task { try? await APIClient.shared.addComment(taskId: t.id, content: v); await load() }
    }
    private func addSubtask(_ t: TaskDetail) {
        let v = newSubtask.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, let pid = t.projectId, let lid = t.taskListId else { return }
        newSubtask = ""
        Task { try? await APIClient.shared.createTask(projectId: pid, taskListId: lid, title: v, parentId: t.id); await load() }
    }
    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f.string(from: d)
    }
    private func parsedDue(_ iso: String?) -> Date {
        guard let iso else { return Date() }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return p.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
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

/// Assign / unassign task members from the project's member pool. Commits the full assigneeIds set.
struct AssigneePicker: View {
    let projectId: String?
    let current: Set<String>
    let onSave: (Set<String>) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var members: [ProjectDetail.ProjectMember] = []
    @State private var selected: Set<String> = []
    @State private var loading = true
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if loading {
                    ProgressView().tint(NX.violet)
                } else if members.isEmpty {
                    Text("Belum ada member di project ini.").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                } else {
                    List {
                        ForEach(members) { m in
                            Button { toggle(m.uid) } label: {
                                HStack(spacing: 12) {
                                    Text(m.initial).font(NXFont.text(13, .black)).foregroundStyle(NX.violet)
                                        .frame(width: 34, height: 34).background(NX.accentBg, in: Circle())
                                    Text(m.displayName).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                                    Spacer()
                                    if selected.contains(m.uid) {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(NX.violet)
                                    } else {
                                        Image(systemName: "circle").foregroundStyle(NX.mutedFg.opacity(0.4))
                                    }
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Assign ke")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { saving = true; await onSave(selected); dismiss() } } label: {
                        if saving { ProgressView() } else { Text("Simpan").bold() }
                    }.disabled(saving)
                }
            }
            .task { await load() }
        }
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }
    private func load() async {
        selected = current
        guard let pid = projectId else { loading = false; return }
        members = (try? await APIClient.shared.project(pid).members) ?? []
        loading = false
    }
}
