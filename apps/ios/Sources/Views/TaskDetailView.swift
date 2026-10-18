import SwiftUI

/// Focused port of TaskDetailPanel: title, status/priority, assignees, due, description,
/// subtasks (toggle), comments.
struct TaskDetailView: View {
    let taskId: String
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var social = TaskPageActions()
    @State private var showCopyProject = false
    @State private var showPropertyEditor = false
    @State private var tagDraft = ""
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    /// The viewer's level on the task's project allows deleting (Can edit / Full access). True until known.
    @State private var canDeleteTask = true
    /// Can view / Can comment open the task read-only (access levels round 2, web TaskDetailPanel's disabled
    /// fieldset): no field, title, subtask or file changes. Can comment keeps the comment box. Both true
    /// until the project's level is known, and for an older server that sends none.
    @State private var canEditTask = true
    @State private var canCommentTask = true
    /// The level, for the one-line notice ("You can comment on this task, but not change it.").
    @State private var viewerLevel: ProjectAccessLevel?
    /// Why the task did not load when there is nothing to show: 403 (not a member) and 404 get their own
    /// state (LoadErrorView) instead of a grey line.
    @State private var loadFailure: Error?
    @State private var task: TaskDetail?
    @State private var loading = true
    @State private var error: String?
    /// Set when the task on screen came off the disk rather than the server.
    @State private var cachedFrom: Date?
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
    /// The project's status options (= its sections, Notion logic, 12 Oct 2026). Empty until loaded, and
    /// for a project whose sections have no status: then the five plain statuses are offered.
    @State private var options: [ProjectDetail.Lane] = []
    /// One write of each kind at a time (bughunt double-submit family: a double tap posted twice).
    @State private var postingComment = false
    @State private var addingSubtask = false
    /// Bumped when the task changed elsewhere, so the fields card re-reads its values.
    @State private var fieldsRefresh = 0
    @FocusState private var titleFocused: Bool
    @FocusState private var descFocused: Bool
    @FocusState private var commentFocused: Bool
    /// ⌘K in the comment box: the link form (web QA 13 Oct 2026, the editor owns ⌘K).
    @State private var commentLink = false
    @State private var keysOwner = "comment-" + UUID().uuidString

    private let statuses = TaskStatusName.all
    private let priorities = TaskPriorityName.all
    private func statusLabel(_ s: String?) -> String { TaskStatusName.label((s ?? "TODO").uppercased()) }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText)
            } else if let task {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let cachedFrom { OfflineNotice(savedAt: cachedFrom) }
                        if !canEditTask { readOnlyNotice }
                        header(task)
                        questBanner(task)
                        metaRow(task)
                        if let pid = task.projectId {
                            TaskCustomFieldsCard(projectId: pid, taskId: task.id, creatorLeft: task.creator?.deactivatedAt != nil, refreshToken: fieldsRefresh)
                                .disabled(!canEditTask)
                        }
                        if canEditTask, let pid = task.projectId {
                            Button { showPropertyEditor = true } label: {
                                Label(T("Add a property"), systemImage: "plus").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            }.buttonStyle(.plain).frame(minHeight: 36)
                            .sheet(isPresented: $showPropertyEditor) { CustomFieldEditor(projectId: pid) { fieldsRefresh += 1 } }
                        }
                        // The description is a block document, edited like a page (merged into the live
                        // document on the server, so web editors see it at once).
                        TaskBodyCard(taskId: task.id, projectId: task.projectId, title: task.title, refreshToken: fieldsRefresh)
                            .disabled(!canEditTask)
                        subtasksCard(task)
                        // Payout proofs are ordinary attachments since 12 Oct 2026 (owner); Blocked by and
                        // Time tracked are gone from the task, as on the web.
                        TaskAttachmentsCard(taskId: task.id, canEdit: canEditTask)
                        commentsCard(task)
                        TaskActivityCard(logs: task.activityLogs ?? [])
                    }
                    .padding(hSize == .regular ? 32 : 20)
                    .frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
                }
            } else if let loadFailure {
                LoadErrorView(error: loadFailure, what: T("this task"),
                              notFoundTitle: T("This task doesn't exist any more"),
                              notFoundMessage: T("It was deleted, or the link is wrong. A board member or manager can restore a deleted task from Control Room → Audit for 90 days."),
                              forbiddenTitle: T("You can't open this task"),
                              forbiddenMessage: T("It's in a project you're not a member of. Ask its Project Owner to add you."),
                              retry: { Task { await load() } })
            } else {
                Text(error ?? T("Couldn't load the task.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
        }
        .navigationTitle(T("Task"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if task != nil {
                    HStack(spacing: 10) {
                        socialButton("Follow", icon: social.following ? "bell.fill" : "bell", active: social.following) { await social.toggle("followers", id: taskId) }
                        socialButton("Favourite", icon: social.favourite ? "star.fill" : "star", active: social.favourite) { await social.toggle("favourite", id: taskId) }
                        socialButton("Like", icon: social.liked ? "heart.fill" : "heart", active: social.liked) { await social.toggle("likes", id: taskId) }
                        if isBod {
                            Button { showQuestComposer = true } label: { Image(systemName: "trophy").font(.system(size: 14)).foregroundStyle(NX.warning) }
                                .accessibilityLabel(T("Make it a quest"))
                        }
                        Menu {
                            if canEditTask {
                                Button { Task { await copyTask() } } label: { Label(T("Copy task"), systemImage: "doc.on.doc") }
                                Button { showCopyProject = true } label: { Label(T("Copy to another project"), systemImage: "folder") }
                            }
                            Button { dismiss(); router.open(.task(taskId)) } label: { Label(T("Open as page"), systemImage: "arrow.up.left.and.arrow.down.right") }
                            if canDeleteTask { Button(role: .destructive) { confirmDelete = true } label: { Label(T("Delete task"), systemImage: "trash") } }
                        } label: { Image(systemName: "ellipsis").font(.system(size: 16)) }
                        .accessibilityLabel(T("Task actions"))
                    }.frame(minHeight: 44)
                }
            }
        }
        .alert(T("Couldn't do that"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
        .alert(T("Delete this task?"), isPresented: $confirmDelete) {
            Button(T("Delete"), role: .destructive) { Task { await deleteTask() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("The task, its subtasks and comments will be deleted.")) }
        .sheet(isPresented: $showQuestComposer) {
            if let task { QuestComposerSheet(taskId: task.id, taskTitle: task.title) { await load() } }
        }
        .task {
            // A comment typed here earlier and never posted comes back into the box.
            if newComment.isEmpty { newComment = LocalDrafts.text("comment:\(taskId)") }
            await load()
            await social.load(taskId)
        }
        .sheet(isPresented: $showCopyProject) { TaskCopyProjectSheet(taskId: taskId, sourceProjectId: task?.projectId) }
        .alert(T("Couldn't do that"), isPresented: Binding(get: { social.error != nil }, set: { if !$0 { social.error = nil } })) {
            Button(T("OK")) { social.error = nil }
        } message: { Text(social.error ?? "") }
        // Closing the task saves what was typed (bughunt C-BUG-1 / Notion): the title and the
        // description, when they differ from what the server has.
        .onDisappear { flushEdits(); EditorKeys.shared.release(keysOwner) }
        // Live (owner, 8 Oct 2026): a comment, a status or assignee change, a new subtask made on
        // another device shows here without a reload. Task events go only to the project's room, so
        // the screen holds it once the task has said which project it lives in.
        .realtimeRoom(task?.projectId.map { "project:\($0)" })
        // The task on screen is GIDEON's page context (web pushGideonPage "task") for ⌘O and the launcher.
        .gideonPage(task.flatMap { t in t.projectId.map { GideonContext(projectId: $0, projectName: nil, taskId: t.id, taskTitle: t.title) } })
        .liveRefresh(every: 60, on: [.nexusProjectTasksChanged], projectId: task?.projectId, taskId: taskId) {
            await reloadQuietly()
        }
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
            // Editable title: saved on Return, when focus leaves it and when the task closes. A vertical
            // TextField turns Return into a newline (bughunt C-BUG-25), so a newline ends the edit instead.
            TextField(T("Task title"), text: $editTitle, axis: .vertical)
                .font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
                .focused($titleFocused)
                .submitLabel(.done)
                .onSubmit { commitTitle(t) }
                .onChange(of: editTitle) { _, v in
                    if v.contains("\n") {
                        editTitle = v.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                        titleFocused = false
                    }
                }
                .onChange(of: titleFocused) { _, focused in if !focused { commitTitle(t) } }
                .disabled(!canEditTask)


        }
        .sheet(isPresented: $showDuePicker) {
            datePickerSheet(T("Due date"), $dueValue, onSave: { await update(t, ["dueDate": isoDay(dueValue)]) }, onClear: { await update(t, ["dueDate": NSNull()]) }, close: { showDuePicker = false })
        }
        .sheet(isPresented: $showStartPicker) {
            datePickerSheet(T("Start date"), $startValue, onSave: { await update(t, ["startDate": isoDay(startValue)]) }, onClear: { await update(t, ["startDate": NSNull()]) }, close: { showStartPicker = false })
        }
    }

    private func socialButton(_ name: String, icon: String, active: Bool, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            Image(systemName: icon).font(.system(size: 14)).foregroundStyle(active ? NX.violetText : NX.mutedFg)
        }.disabled(social.busy).accessibilityLabel(T(name))
    }

    private func copyTask() async {
        do { try await APIClient.shared.duplicateTask(taskId, dueDate: nil) }
        catch { actionError = error.localizedDescription }
    }

    private func datePickerSheet(_ title: String, _ value: Binding<Date>, onSave: @escaping () async -> Void, onClear: @escaping () async -> Void, close: @escaping () -> Void) -> some View {
        NavigationStack {
            DatePicker(title, selection: value, displayedComponents: .date)
                .datePickerStyle(.graphical).padding()
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button(T("Clear")) { Task { await onClear(); close() } } }
                    ToolbarItem(placement: .topBarTrailing) { Button(T("Save")) { Task { await onSave(); close() } }.bold() }
                }
        }.presentationDetents([.medium])
    }

    /// Status: the project's options grouped To-do / In progress / Complete, the current one as a coloured
    /// pill (web StatusPicker). Picking an option moves the task to that column and the server gives it the
    /// column's status. A project without status options gets the five plain statuses, as before.
    @ViewBuilder private func statusControl(_ t: TaskDetail) -> some View {
        if StatusOptions.inUse(options) {
            let current = options.first { $0.id == t.taskListId }
            Menu {
                ForEach(StatusGroup.allCases) { g in
                    let inGroup = options.filter { $0.group == g }
                    if !inGroup.isEmpty {
                        Section(g.label) {
                            ForEach(inGroup) { o in
                                Button { Task { await update(t, ["taskListId": o.id]) } } label: {
                                    if o.id == t.taskListId { Label(o.name, systemImage: "checkmark") } else { Text(o.name) }
                                }
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    StatusPill(name: current?.name ?? statusLabel(t.status),
                               colorKey: current?.colorKey ?? (StatusColor.forStatus[(t.status ?? "TODO").uppercased()] ?? "gray"))
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .accessibilityLabel(T("Status"))
        } else {
            Menu {
                ForEach(statuses, id: \.self) { s in
                    Button(statusLabel(s)) { Task { await update(t, ["status": s]) } }
                }
            } label: { controlChip(statusLabel(t.status), system: "circle.dashed", tone: t.isDone ? .success : .info) }
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
        VStack(alignment: .leading, spacing: 2) {
            propertyRow("Status", icon: "circle.dashed") {
                HStack(spacing: 8) {
                    Button { Task { await update(t, ["status": t.isDone ? "TODO" : "DONE"]) } } label: {
                        Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle").foregroundStyle(t.isDone ? NX.success : NX.mutedFg)
                    }.buttonStyle(.plain).disabled(!canEditTask).accessibilityLabel(T("Done"))
                    statusControl(t).disabled(!canEditTask)
                }
            }
            propertyRow("Priority", icon: "flag") {
                Menu {
                    ForEach(priorities, id: \.self) { p in
                        Button(TaskPriorityName.label(p)) { Task { await update(t, ["priority": p]) } }
                    }
                } label: { Text(TaskPriorityName.label(t.priority)).font(NXFont.text(14)).foregroundStyle(NX.foreground) }
                .disabled(!canEditTask)
            }
            propertyRow("Assignees", icon: "person.2") {
                Button { showAssignee = true } label: {
                    if let people = t.assignees?.compactMap({ $0.user }), !people.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(Array(people.prefix(3).enumerated()), id: \.offset) { _, person in
                                AvatarView(url: person.avatar, initial: String((person.name ?? "?").prefix(1)), size: 20)
                            }
                            assigneeLine(people).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(2)
                        }
                    } else { Text(T("Unassigned")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg) }
                }.buttonStyle(.plain).disabled(!canEditTask)
            }
            propertyRow("Start date", icon: "calendar.badge.clock") {
                Button { startValue = parsedDue(t.startDate); showStartPicker = true } label: {
                    Text(t.startDate == nil ? "—" : dueText(t.startDate)).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                }.buttonStyle(.plain).disabled(!canEditTask)
            }
            propertyRow("Due date", icon: "calendar") {
                Button { dueValue = parsedDue(t.dueDate); showDuePicker = true } label: {
                    Text(t.dueDate == nil ? "—" : dueText(t.dueDate)).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                }.buttonStyle(.plain).disabled(!canEditTask)
            }
            propertyRow("Tags", icon: "tag") {
                FlowLayout(spacing: 6) {
                    ForEach(t.tags ?? [], id: \.self) { tag in
                        HStack(spacing: 4) {
                            Text(tag).font(NXFont.text(12))
                            if canEditTask {
                                Button { Task { await update(t, ["removeTags": [tag]]) } } label: { Image(systemName: "xmark").font(.system(size: 8)) }.buttonStyle(.plain)
                            }
                        }.padding(4).background(NX.muted, in: RoundedRectangle(cornerRadius: 4))
                    }
                    if canEditTask {
                        TextField(T("Add tag"), text: $tagDraft).font(NXFont.text(13)).frame(width: 100)
                            .onSubmit {
                                let tag = tagDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                                guard !tag.isEmpty else { return }
                                tagDraft = ""
                                Task { await update(t, ["addTags": [tag]]) }
                            }
                    }
                }
            }
            if let creator = t.creator, let name = creator.name {
                propertyRow("Created by", icon: "person.crop.circle") { creatorLine(SystemUsers.name(name, avatar: creator.avatar), creator) }
            }
        }
        .sheet(isPresented: $showAssignee) {
            AssigneePicker(projectId: t.projectId, current: Set((t.assignees ?? []).compactMap { $0.user?.id }), onSave: { ids in
                let base = Set((t.assignees ?? []).compactMap { $0.user?.id })
                await update(t, ["addAssigneeIds": Array(ids.subtracting(base)), "removeAssigneeIds": Array(base.subtracting(ids))])
            })
        }
    }

    private func propertyRow<Content: View>(_ label: String, icon: String, @ViewBuilder value: () -> Content) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Label(T(label), systemImage: icon).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .frame(width: hSize == .regular ? 150 : 115, alignment: .leading)
            value().frame(maxWidth: .infinity, alignment: .leading)
        }.frame(minHeight: 40)
    }

    /// "Created by Rina", with her picture (owner, 8 Oct 2026). Every task has a maker, so this no
    /// longer depends on the project having a CREATED custom field — which stays as it is. Someone
    /// who was offboarded keeps the credit and gets the muted "Left", as an assignee does.
    private func creatorLine(_ name: String, _ creator: TaskDetail.CreatorRef) -> some View {
        // Split around the name so it can be set in bold in either language's word order.
        let parts = T("Created by %@").components(separatedBy: "%@")
        let before = parts.first ?? ""
        let after = parts.count > 1 ? parts[1] : ""
        return HStack(spacing: 8) {
            if SystemUsers.isAutomation(avatar: creator.avatar) {
                AutomationAvatar(size: 22)
            } else {
                AvatarView(url: creator.avatar, initial: String(name.prefix(1)).uppercased(), size: 22)
            }
            (Text(before).foregroundColor(NX.mutedFg)
                + Text(name).font(NXFont.text(13, .semibold)).foregroundColor(NX.foreground)
                + Text(after).foregroundColor(NX.mutedFg))
                .font(NXFont.text(13))
                .lineLimit(1)
            if creator.deactivatedAt != nil { LeftTag() }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// "Budi Left, Sari": the names, with a small muted "Left" after anyone offboarded (left the
    /// company). Their tasks stay assigned to them (owner, 8 Oct 2026); one line of text, so the row
    /// keeps its height and its truncation.
    private func assigneeLine(_ people: [BoardTask.Assignee.UserRef]) -> Text {
        people.enumerated().reduce(Text("")) { line, item in
            var next = line + Text(item.offset == 0 ? "" : ", ") + Text(item.element.name ?? "")
            if item.element.deactivatedAt != nil {
                next = next + Text(" " + LeftTag.leftWord).font(NXFont.text(10, .semibold)).foregroundColor(ChipTone.neutral.fg)
            }
            return next
        }
    }

    private func subtasksCard(_ t: TaskDetail) -> some View {
        let subs = t.subtasks ?? []
        let done = subs.filter(\.isDone).count
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checklist").foregroundStyle(NX.mutedFg)
                Text(subs.isEmpty ? T("Subtasks") : "\(T("Subtasks")) · \(done)/\(subs.count)").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            }
            if subs.isEmpty {
                Text(T("No subtasks yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(subs) { st in
                    HStack(spacing: 10) {
                        Button { Task { await toggleSub(st) } } label: {
                            Image(systemName: st.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18)).foregroundStyle(st.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                                .touchTarget44(drawn: 21)
                        }.buttonStyle(.plain)
                        .disabled(!canEditTask)
                        // A subtask is a task: its title opens it, while the circle stays a
                        // separate button so ticking one off never navigates away.
                        Button { openTaskId = st.id } label: {
                            HStack(spacing: 0) {
                                Text(st.title ?? T("Untitled")).font(NXFont.text(14))
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
            // add subtask (Can edit and up)
            if canEditTask {
            HStack(spacing: 8) {
                TextField(T("+ Add subtask (Enter)"), text: $newSubtask)
                    .font(NXFont.text(14)).onSubmit { addSubtask(t) }
                    .padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button { addSubtask(t) } label: {
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel(T("Add subtask"))
                .disabled(newSubtask.trimmingCharacters(in: .whitespaces).isEmpty || addingSubtask)
            }
            .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    private func commentsCard(_ t: TaskDetail) -> some View {
        let comments = (t.comments ?? []).sorted { ($0.createdAt ?? "", $0.id) < ($1.createdAt ?? "", $1.id) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right").foregroundStyle(NX.mutedFg)
                Text("\(T("Comments")) · \(comments.count)").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            }
            if comments.isEmpty {
                Text(T("No comments yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(comments) { c in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            // An automation's comment (system user "Automation"): ⚡, its name in the app's language.
                            if SystemUsers.isAutomation(avatar: c.user?.avatar) {
                                AutomationAvatar(size: 20)
                            } else {
                                AvatarView(url: c.user?.avatar, initial: String((c.user?.name ?? "?").first ?? "?").uppercased(), size: 20)
                            }
                            Text(SystemUsers.name(c.user?.name, avatar: c.user?.avatar, fallback: "Someone")).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                            Spacer()
                            Text(dateText(c.createdAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        Text(Linkified.text(c.content ?? "")).font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.9)).fixedSize(horizontal: false, vertical: true)
                            .tint(NX.violetText)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            // add comment (Can comment and up; Can view reads only)
            if canCommentTask {
            HStack(spacing: 8) {
                TextField(T("Write a comment…"), text: $newComment, axis: .vertical)
                    .font(NXFont.text(14)).lineLimit(1...3).onSubmit { addComment(t) }
                    .focused($commentFocused)
                    // Kept on the phone until the server has it (QA 13 Oct 2026): closing the task or a
                    // failed post while offline never loses the words.
                    .onChange(of: newComment) { _, v in LocalDrafts.set("comment:\(taskId)", v) }
                    .onChange(of: commentFocused) { _, f in
                        if f { EditorKeys.shared.claim(keysOwner) } else { EditorKeys.shared.release(keysOwner) }
                    }
                    // Hardware keyboard: Enter posts, Shift+Enter is a new line (web comment box).
                    .onKeyPress(keys: [.return], phases: .down) { press in
                        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { return .ignored }
                        addComment(t)
                        return .handled
                    }
                    .background {
                        if commentFocused {
                            Button("") { commentLink = true }
                                .keyboardShortcut("k", modifiers: .command)
                                .opacity(0).accessibilityHidden(true)
                        }
                    }
                    .padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .sheet(isPresented: $commentLink) {
                        LinkInsertSheet { text, href in
                            // A comment is plain text: the address is written in (shown as a link).
                            let piece = text.isEmpty ? href : "\(text) \(href)"
                            let sep = newComment.isEmpty || newComment.hasSuffix(" ") || newComment.hasSuffix("\n") ? "" : " "
                            newComment += sep + piece
                            commentFocused = true
                        }
                    }
                Button { addComment(t) } label: {
                    Group {
                        if postingComment { ProgressView().tint(.white).scaleEffect(0.7) }
                        else { Image(systemName: "paperplane.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(.white) }
                    }
                    .frame(width: 36, height: 36).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel(T("Send"))
                .disabled(newComment.trimmingCharacters(in: .whitespaces).isEmpty || postingComment)
            }
            .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }

    // MARK: data

    /// One line above a read-only task (web TaskDetailPanel, QA round 2).
    private var readOnlyNotice: some View {
        Text(viewerLevel == .comment ? T("You can comment on this task, but not change it.") : T("View only: you can read this task, but not change it."))
            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func load() async {
        error = nil
        loadFailure = nil
        do {
            let t = try await APIClient.shared.taskDetail(taskId)
            task = t
            editTitle = t.title
            // A rename that could not be sent when the task was closed offline: back in the field and
            // sent now (a failure says so and leaves it in the field).
            let keptTitle = LocalDrafts.text("tasktitle:\(t.id)").trimmingCharacters(in: .whitespacesAndNewlines)
            LocalDrafts.clear("tasktitle:\(t.id)")
            if !keptTitle.isEmpty, keptTitle != t.title {
                editTitle = keptTitle
                commitTitle(t)
            }
            descDraft = blockText(t.description)
            descOriginal = descDraft
            await loadOptions(t.projectId)
            if !isBod, let role = (try? await APIClient.shared.workspaceInfo())?.role {
                isBod = role == "BOD" || role == "ONE_ABOVE_ALL"
            }
            cachedFrom = nil
        }
        catch APIError.unauthorized { auth.logout() }
        // Not from the cache: 403 = not a member of the task's project (task read follows project access
        // since 13 Oct 2026), 404 = deleted. Each gets its own state.
        catch APIError.http(403, _) where task == nil { loadFailure = APIError.http(403, nil) }
        catch APIError.http(404, _) where task == nil { loadFailure = APIError.http(404, nil) }
        catch {
            // The brief a person walked onto a site to read is worth more than the reason it could
            // not be refreshed. Editing still goes through the server and still fails loudly.
            if let hit = ResponseCache.decoded("task-\(taskId)", as: TaskDetail.self) {
                task = hit.value
                editTitle = hit.value.title
                descDraft = blockText(hit.value.description)
                descOriginal = descDraft
                cachedFrom = hit.savedAt
            } else {
                loadFailure = error
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.")
            }
        }
        loading = false
    }
    /// The live reload: the task as the server has it now, quietly, and careful with what is being
    /// typed. The title and description boxes follow the server only while they still hold what was
    /// last loaded; the comment and subtask boxes are never touched.
    private func reloadQuietly() async {
        guard task != nil, !loading else { return }
        guard let t = try? await APIClient.shared.taskDetail(taskId) else { return }
        // Someone else's rename shows here unless this person is editing the title right now
        // (bughunt C-BUG-3: the popup kept the old title and wrote it back).
        let titleUntouched = editTitle == (task?.title ?? "") && !titleFocused
        let descriptionUntouched = descDraft == descOriginal && !descFocused
        task = t
        if titleUntouched { editTitle = t.title }
        if descriptionUntouched {
            descDraft = blockText(t.description)
            descOriginal = descDraft
        }
        cachedFrom = nil
        fieldsRefresh += 1
        await loadOptions(t.projectId)
    }

    /// The project's status options for the status picker: the light sections call, else (a viewer, an
    /// older server) the project payload. Empty = plain statuses.
    private func loadOptions(_ projectId: String?) async {
        guard let projectId else { options = []; return }
        // One project read: the access level (delete gating) and, when the options call fails, the lanes.
        let project = try? await APIClient.shared.project(projectId)
        if let project {
            canDeleteTask = project.canEditProject
            canEditTask = project.canEditProject
            canCommentTask = project.canCommentProject
            viewerLevel = project.viewerLevel
        }
        if let rows = try? await APIClient.shared.statusOptions(projectId: projectId) {
            options = StatusOptions.ordered(rows.map {
                ProjectDetail.Lane(id: $0.id, name: $0.name, tasks: nil, taskStatus: $0.taskStatus, color: $0.color, position: $0.position)
            })
        } else if options.isEmpty, let lanes = project?.taskLists {
            options = StatusOptions.ordered(lanes.map { $0.with(tasks: []) })
        }
    }

    /// The title and description as typed, when they differ from what the server has. Runs as the task
    /// closes, so it does not wait for the answers.
    private func flushEdits() {
        guard let t = task else { return }
        var fields: [String: Any] = [:]
        let title = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty, title != t.title { fields["title"] = title }
        guard !fields.isEmpty else { return }
        let id = t.id
        Task {
            do { try await APIClient.shared.updateTask(id, fields) }
            catch {
                // Offline / a blip while closing: the new title is kept on the phone and sent the next
                // time this task opens (one keeper — it is cleared once the server has it).
                if isTransientFailure(error), let title = fields["title"] as? String { LocalDrafts.set("tasktitle:\(id)", title) }
            }
        }
    }
    /// One field change. A refusal is said out loud (it used to vanish behind try?) and the screen goes
    /// back to what the server has.
    private func update(_ t: TaskDetail, _ fields: [String: Any]) async {
        do { try await APIClient.shared.updateTask(t.id, fields) }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the change.") }
        if fields["description"] != nil { descOriginal = descDraft }
        await reloadQuietly()
    }
    private func commitTitle(_ t: TaskDetail) {
        let v = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { editTitle = task?.title ?? t.title; return }
        guard v != (task?.title ?? t.title) else { return }
        Task { await update(t, ["title": v]) }
    }
    private func toggleSub(_ st: TaskDetail.SubDetail) async {
        if st.isDone { Haptics.tap() } else { Haptics.success() }
        try? await APIClient.shared.setTaskStatus(taskId: st.id, status: st.isDone ? "TODO" : "DONE"); await load()
    }
    // Dismiss only once the server has agreed. Behind `try?` the sheet closed on a 403 too, the
    // task looked deleted, and it was back on the board at the next refresh.
    private func deleteTask() async {
        do {
            let auditId = try await APIClient.shared.deleteTaskUndoable(taskId)
            if let auditId {
                NotificationCenter.default.post(name: .nexusTaskDeletedUndoable, object: nil,
                                                userInfo: ["auditLogId": auditId, "title": task?.title ?? ""])
            }
            dismiss()
        }
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete the task.") }
    }
    // The draft is cleared AFTER the post succeeds; on failure it is still in the box.
    // One comment in flight at a time (a double tap posted it twice). The box is cleared only after the
    // server has it — and only of the text that was sent — so a failed comment is never lost (C-BUG-7).
    private func addComment(_ t: TaskDetail) {
        let v = newComment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, !postingComment else { return }
        postingComment = true
        Task {
            defer { postingComment = false }
            do {
                _ = try await APIClient.shared.addComment(taskId: t.id, content: v)
                if newComment.trimmingCharacters(in: .whitespacesAndNewlines) == v { newComment = "" }
                await reloadQuietly()
            }
            catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post the comment. It's still in the box.") }
        }
    }
    private func addSubtask(_ t: TaskDetail) {
        let v = newSubtask.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, !addingSubtask, let pid = t.projectId, let lid = t.taskListId else { return }
        addingSubtask = true
        Task {
            defer { addingSubtask = false }
            do {
                _ = try await APIClient.shared.createTask(projectId: pid, taskListId: lid, title: v, parentId: t.id)
                if newSubtask.trimmingCharacters(in: .whitespaces) == v { newSubtask = "" }
                await reloadQuietly()
            }
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
        switch p.uppercased() { case "URGENT": return .danger; case "HIGH": return .danger; case "MEDIUM": return .info; default: return .neutral }
    }
    private func dueText(_ iso: String?) -> String {
        guard let iso else { return T("No due date") }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "—" }
        let f = DateFormatter()
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        // The WIB day, with its time only when it has one (web fmtDue, QA S-23): 00:00 UTC (how the apps
        // store a picked day) and 00:00 WIB (the web's older picks) are a day, never "07:00".
        f.timeZone = TimeZone(identifier: MyTaskGrouping.isDateOnly(d) && d.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400) == 0 ? "UTC" : "Asia/Jakarta")
        f.dateFormat = MyTaskGrouping.isDateOnly(d) ? "d MMM yyyy" : "d MMM yyyy, HH:mm"
        return f.string(from: d)
    }
    private func dateText(_ iso: String?) -> String {
        guard let iso else { return "" }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "" }
        return AppDateLocale.formatter("d MMM HH:mm").string(from: d)
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
                                    AvatarView(url: m.user?.avatar, initial: m.initial, size: 34)
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
            .navigationTitle(T("Assignees"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) }
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

                    SectionLabel(T("XP reward"))
                    Stepper(value: $xp, in: 1...50) {
                        HStack { Text(T("Reward")).font(NXFont.text(14)).foregroundStyle(NX.foreground); Spacer(); QuestXPChip(xp: xp) }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))

                    Text(T("The quest completes when this task is done. XP goes to the assignee, and the quest is visible to every project member. Max 50 XP."))
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
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) } }
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
