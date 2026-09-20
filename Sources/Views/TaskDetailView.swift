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
    @State private var showStartPicker = false
    @State private var startValue = Date()
    @State private var showAssignee = false
    @State private var descDraft = ""
    @State private var descOriginal = ""   // parsed once on load — avoids re-parsing block-JSON on every keystroke
    @State private var isBod = false       // gates the "Make it a quest" button (BoD+)
    @State private var showQuestComposer = false
    @State private var openTaskId: String?   // parent / subtask / dependency hops within the stack
    /// An action the server refused. Separate from `error` (which replaces the whole screen while
    /// the task itself cannot load): a comment that failed to post must not blank the task.
    @State private var actionError: String?

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
                ProgressView().tint(NX.violetText)
            } else if let task {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(task)
                        questBanner(task)
                        metaRow(task)
                        if let pid = task.projectId { TaskCustomFieldsCard(projectId: pid, taskId: task.id) }
                        descriptionCard(task)
                        subtasksCard(task)
                        TaskAttachmentsCard(taskId: task.id)
                        TaskDependenciesCard(taskId: task.id, projectId: task.projectId) { openTaskId = $0 }
                        TaskTimeCard(taskId: task.id)
                        commentsCard(task)
                        TaskActivityCard(logs: task.activityLogs ?? [])
                    }
                    .padding(16)
                }
            } else {
                Text(error ?? T("Couldn't load the task.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
        }
        .navigationTitle(T("Task"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) { confirmDelete = true } label: { Label(T("Delete task"), systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .alert(T("Couldn't do that"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
        .confirmationDialog(T("Delete this task?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(T("Delete"), role: .destructive) { Task { await deleteTask() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("The task, its subtasks and comments will be deleted.")) }
        .sheet(isPresented: $showQuestComposer) {
            if let task { QuestComposerSheet(taskId: task.id, taskTitle: task.title) { await load() } }
        }
        .task { await load() }
    }

    /// Quest membership banner ("+N XP" per quest) + the BoD "Make it a quest" button.
    @ViewBuilder private func questBanner(_ t: TaskDetail) -> some View {
        let quests = t.quests ?? []
        if !quests.isEmpty || isBod {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(quests) { q in
                    HStack(spacing: 8) {
                        Image(systemName: "trophy.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.violetText)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(q.title ?? T("Quest")).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                            Text(questSubtitle(q)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer(minLength: 4)
                        QuestXPChip(xp: q.xpReward ?? 0)
                    }
                }
                if isBod {
                    if !quests.isEmpty { Divider().overlay(NX.violet.opacity(0.2)) }
                    Button { showQuestComposer = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "trophy").font(.system(size: 12, weight: .bold))
                            Text(quests.isEmpty ? T("Make it a quest") : T("Create another quest"))
                        }
                        .font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                    }.buttonStyle(.plain)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.violet.opacity(0.25)))
        }
    }
    private func questSubtitle(_ q: TaskQuestRef) -> String {
        if let total = q.total, total > 0 { return "\(q.done ?? 0)/\(total) \(T("tasks done"))" }
        return T("Finish this task to earn XP")
    }

    private func header(_ t: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let parent = t.parent {
                // A breadcrumb naming the parent has to reach it. Back goes wherever you came
                // from, which on a task opened from search or the inbox is not the parent.
                Button { openTaskId = parent.id } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checklist").font(.system(size: 11, weight: .bold))
                        Text(T("Subtask of")).foregroundStyle(NX.accentFg.opacity(0.8))
                        Text(parent.title ?? T("task")).fontWeight(.semibold).lineLimit(1)
                    }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.accentFg)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(NX.accentBg, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            // editable title (commits on submit / when focus leaves)
            TextField(T("Task title"), text: $editTitle, axis: .vertical)
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

                    Button { startValue = parsedDue(t.startDate); showStartPicker = true } label: {
                        controlChip(t.startDate == nil ? "Start —" : "Start \(dueText(t.startDate))", system: "calendar.badge.clock", tone: .neutral)
                    }.buttonStyle(.plain)

                    Button { dueValue = parsedDue(t.dueDate); showDuePicker = true } label: {
                        controlChip(dueText(t.dueDate), system: "calendar", tone: .neutral)
                    }.buttonStyle(.plain)
                }
            }
        }
        .sheet(isPresented: $showDuePicker) {
            datePickerSheet("Due date", $dueValue, onSave: { await update(t, ["dueDate": isoDay(dueValue)]) }, onClear: { await update(t, ["dueDate": NSNull()]) }, close: { showDuePicker = false })
        }
        .sheet(isPresented: $showStartPicker) {
            datePickerSheet("Start date", $startValue, onSave: { await update(t, ["startDate": isoDay(startValue)]) }, onClear: { await update(t, ["startDate": NSNull()]) }, close: { showStartPicker = false })
        }
    }

    private func datePickerSheet(_ title: String, _ value: Binding<Date>, onSave: @escaping () async -> Void, onClear: @escaping () async -> Void, close: @escaping () -> Void) -> some View {
        NavigationStack {
            DatePicker(title, selection: value, displayedComponents: .date)
                .datePickerStyle(.graphical).padding()
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button(T("Delete")) { Task { await onClear(); close() } } }
                    ToolbarItem(placement: .topBarTrailing) { Button(T("Save")) { Task { await onSave(); close() } }.bold() }
                }
        }.presentationDetents([.medium])
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
                        Image(systemName: "pencil").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.violetText)
                    }
                    if let names = t.assignees?.compactMap({ $0.user?.name }), !names.isEmpty {
                        Text(names.joined(separator: ", ")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    } else { Text(T("Unassigned")).font(NXFont.text(13)).foregroundStyle(NX.violetText) }
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
        let dirty = descDraft != descOriginal
        return VStack(alignment: .leading, spacing: 8) {
            Text("DESCRIPTION").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            TextField(T("Add a description…"), text: $descDraft, axis: .vertical)
                .font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(2...12)
                .padding(10).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            if dirty {
                HStack {
                    Button(T("Cancel")) { descDraft = descOriginal }.font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Button(T("Save")) { Task { await update(t, ["description": descDraft]) } }
                        .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 7).background(NX.violet, in: Capsule())
                }
            }
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
                Text(T("No subtasks yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(subs) { st in
                    HStack(spacing: 10) {
                        Button { Task { await toggleSub(st) } } label: {
                            Image(systemName: st.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18)).foregroundStyle(st.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                        }.buttonStyle(.plain)
                        // A subtask is a task: its title opens it, while the circle stays a
                        // separate button so ticking one off never navigates away.
                        Button { openTaskId = st.id } label: {
                            HStack(spacing: 0) {
                                Text(st.title ?? "Untitled").font(NXFont.text(14))
                                    .foregroundStyle(st.isDone ? NX.mutedFg : NX.foreground)
                                    .strikethrough(st.isDone).lineLimit(2).multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // add subtask
            HStack(spacing: 8) {
                TextField(T("+ Add subtask (Enter)"), text: $newSubtask)
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
                Text(T("No comments yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(comments) { c in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            AvatarView(url: c.user?.avatar, initial: String((c.user?.name ?? "?").first ?? "?").uppercased(), size: 20)
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
                TextField(T("Write a comment…"), text: $newComment, axis: .vertical)
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
            descDraft = blockText(t.description)
            descOriginal = descDraft
            if !isBod, let role = (try? await APIClient.shared.workspaceInfo())?.role {
                isBod = role == "BOD" || role == "ONE_ABOVE_ALL"
            }
        }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.") }
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
        if st.isDone { Haptics.tap() } else { Haptics.success() }
        try? await APIClient.shared.setTaskStatus(taskId: st.id, status: st.isDone ? "TODO" : "DONE"); await load()
    }
    // Dismiss only once the server has agreed. Behind `try?` the sheet closed on a 403 too, the
    // task looked deleted, and it was back on the board at the next refresh.
    private func deleteTask() async {
        do { _ = try await APIClient.shared.deleteTask(taskId); dismiss() }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete the task.") }
    }
    // The draft is cleared AFTER the post succeeds; on failure it is still in the box.
    private func addComment(_ t: TaskDetail) {
        let v = newComment.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        Task {
            do { _ = try await APIClient.shared.addComment(taskId: t.id, content: v); newComment = ""; await load() }
            catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post the comment. It's still in the box.") }
        }
    }
    private func addSubtask(_ t: TaskDetail) {
        let v = newSubtask.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, let pid = t.projectId, let lid = t.taskListId else { return }
        Task {
            do { _ = try await APIClient.shared.createTask(projectId: pid, taskListId: lid, title: v, parentId: t.id); newSubtask = ""; await load() }
            catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't add the subtask. It's still in the box.") }
        }
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
                    ProgressView().tint(NX.violetText)
                } else if members.isEmpty {
                    Text(T("No members in this project yet.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                } else {
                    List {
                        ForEach(members) { m in
                            Button { toggle(m.uid) } label: {
                                HStack(spacing: 12) {
                                    Text(m.initial).font(NXFont.text(13, .black)).foregroundStyle(NX.violetText)
                                        .frame(width: 34, height: 34).background(NX.accentBg, in: Circle())
                                    Text(m.displayName).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                                    Spacer()
                                    if selected.contains(m.uid) {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(NX.violetText)
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
                ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { saving = true; await onSave(selected); dismiss() } } label: {
                        if saving { ProgressView().tint(NX.violetText) } else { Text(T("Save")).bold() }
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

/// BoD: bundle THIS task into a `specific_tasks` quest. Done when the task is DONE; XP to its
/// assignee(s); visible to all project members. Mirrors the web "Make it a quest" composer.
struct QuestComposerSheet: View {
    let taskId: String
    let taskTitle: String
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var xp = 10
    @State private var saving = false
    @State private var err: String?

    init(taskId: String, taskTitle: String, onDone: @escaping () async -> Void) {
        self.taskId = taskId; self.taskTitle = taskTitle; self.onDone = onDone
        _title = State(initialValue: taskTitle)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SectionLabel(T("Quest title"))
                    TextField(T("Quest title"), text: $title, axis: .vertical)
                        .font(NXFont.text(15)).padding(12)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))

                    SectionLabel("XP reward")
                    Stepper(value: $xp, in: 1...50) {
                        HStack { Text("Reward").font(NXFont.text(14)).foregroundStyle(NX.foreground); Spacer(); QuestXPChip(xp: xp) }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))

                    Text(T("The quest completes when this task is DONE. XP goes to the assignee, and the quest is visible to every project member. Max 50 XP."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)

                    if let err { Text(err).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }

                    Button { Task { await save() } } label: {
                        HStack(spacing: 6) {
                            if saving { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text(saving ? T("Creating…") : T("Create quest"))
                        }
                    }
                    .buttonStyle(NexusPrimaryButton(fullWidth: true))
                    .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Make it a quest"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }

    private func save() async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        saving = true; err = nil
        do {
            _ = try await APIClient.shared.createTaskQuest(title: t, xpReward: xp, taskIds: [taskId])
            await onDone()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't create the quest.")
            saving = false
        }
    }
}
