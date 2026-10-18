import SwiftUI

struct GideonDeleteTaskCard: View {
    let proposal: GideonProposal
    let task: GideonTaskDelete
    var readOnly = false
    let onApply: () -> Void
    let onDiscard: () -> Void
    private var pending: Bool { proposal.isPending && !readOnly }
    private var deleted: Bool { task.deleted == true || proposal.status == "APPLIED" }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "trash").foregroundStyle(NX.danger).frame(width: 32, height: 32)
                    .background(NX.danger.opacity(0.09), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(T(deleted ? "Task deleted" : "Delete task")).font(NXFont.text(14, .bold)).foregroundStyle(NX.danger)
                    Text(task.title).strikethrough(deleted).font(NXFont.text(14, .semibold))
                }
            }
            if pending { Label(T("Waiting for your approval"), systemImage: "circle.fill").font(NXFont.text(12)).foregroundStyle(NX.warning) }
            VStack(spacing: 0) {
                row("Project", task.projectName ?? "—")
                row("Status", [task.status.map { ServerText.enumWord($0) }, task.progress != task.status ? task.progress.map { ServerText.enumWord($0) } : nil].compactMap { $0 }.joined(separator: " · "))
                row("Due", due)
                row("Assignees", task.assignees?.isEmpty == false ? task.assignees!.joined(separator: ", ") : T("Unassigned"))
            }.background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
            Text(T(deleted ? "It can be restored from Control Room → Audit." : "Deleting removes it for everyone in the project, with its subtasks, comments and files. It can be restored from the Audit."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            if pending {
                HStack {
                    Spacer()
                    Button(T("Keep task"), action: onDiscard).buttonStyle(.nxBordered)
                    Button(role: .destructive, action: onApply) { Label(T("Delete task"), systemImage: "trash") }
                        .buttonStyle(.borderedProminent).tint(NX.danger)
                }
            } else { Text(gideonProposalState(proposal, readOnly: readOnly, deleting: true)).font(NXFont.text(12)).foregroundStyle(proposal.status == "FAILED" ? NX.danger : NX.mutedFg) }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(pending ? NX.danger.opacity(0.6) : NX.border))
        .accessibilityIdentifier("gideon.deleteTask." + proposal.id)
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(T(label)).foregroundStyle(NX.mutedFg).frame(width: 104, alignment: .leading)
            Text(value.isEmpty ? "—" : value).frame(maxWidth: .infinity, alignment: .leading)
        }.font(NXFont.text(12)).padding(9)
    }
    private var due: String {
        guard let raw = task.due ?? task.dueDay else { return T("No due date") }
        let timed = raw.contains("T")
        guard let date = timed ? TaskDates.parse(raw) : Optional(CalDays.date(raw)) else { return T("No due date") }
        return AppDateLocale.formatter(timed ? "EEE d MMM HH:mm" : "EEE d MMM", timeZone: TimeZone(secondsFromGMT: 0)).string(from: date)
    }
}

func gideonProposalState(_ p: GideonProposal, readOnly: Bool = false, deleting: Bool = false) -> String {
    switch p.status {
    case "APPLIED": return T(readOnly ? "Applied by them" : "Applied")
    case "DISCARDED": return T(readOnly ? "Discarded by them" : "Discarded")
    case "PENDING": return T(readOnly ? "Not decided yet" : "Waiting for your approval")
    case "APPLYING": return T(deleting ? "Deleting…" : "Applying…")
    case "FAILED": return String(format: T("Couldn't apply: %@"), T(p.error ?? "Couldn't apply it."))
    default: return ServerText.enumWord(p.status)
    }
}

struct GideonCreateTaskCard: View {
    let proposal: GideonProposal
    let target: GideonTaskTarget
    let onApply: (GideonTaskChoice) -> Void
    let onDiscard: () -> Void
    @State private var choice = GideonTaskChoice(projectId: "", assigneeIds: [])
    @State private var options: GideonTaskOptions?
    @State private var loading = false
    @State private var failure: String?
    @State private var chooseProject = false
    @State private var search = ""
    @State private var due = CalDays.date(CalDays.wibToday())
    @State private var hasDue = false
    @State private var hydrated = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(T("Create a task"), systemImage: "checklist").font(NXFont.text(14, .bold))
            if let summary = proposal.summary { Text(summary).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
            property("Title") { Text(target.title) }
            property("Project") {
                Button { chooseProject = true } label: {
                    HStack {
                        Text(target.projects.first { $0.id == choice.projectId }?.name ?? T("Choose a project"))
                        Image(systemName: "chevron.down").font(.system(size: 9))
                    }.padding(6).overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(choice.projectId.isEmpty ? NX.warning : NX.border))
                }.buttonStyle(.plain).accessibilityIdentifier("gideon.createTask.project")
            }
            if choice.projectId.isEmpty {
                Text(T("Pick the project for this task. Only projects you can edit are listed.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else if loading { ProgressView() }
            else if let options {
                property("Status") {
                    Picker(T("Choose a column"), selection: Binding(get: { choice.taskListId ?? "" }, set: { choice.taskListId = $0 })) {
                        Text(T("Choose a column")).tag("")
                        ForEach(options.sections) { section in Text(section.name).tag(section.id) }
                    }.labelsHidden().tint(NX.foreground)
                }
                property("PIC") {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(options.members.filter { choice.assigneeIds.contains($0.id) }) { member in
                            HStack {
                                Text(member.name ?? "—")
                                Button { choice.assigneeIds.removeAll { $0 == member.id } } label: { Image(systemName: "xmark") }
                                    .accessibilityLabel(String(format: T("Remove %@"), member.name ?? "—"))
                            }.padding(5).background(NX.muted, in: Capsule())
                        }
                        Menu {
                            ForEach(options.members) { member in
                                Button { if !choice.assigneeIds.contains(member.id) { choice.assigneeIds.append(member.id) } } label: {
                                    Label(member.name ?? "—", systemImage: choice.assigneeIds.contains(member.id) ? "checkmark" : "person")
                                }
                            }
                        } label: { Text(T(choice.assigneeIds.isEmpty ? "Unassigned" : "Add")) }
                    }
                }
            }
            property("Due") {
                VStack(alignment: .leading) {
                    Toggle(T("No due date"), isOn: Binding(get: { !hasDue }, set: { hasDue = !$0; syncDate() })).font(NXFont.text(12))
                    if hasDue { DatePicker(T("Due"), selection: $due, displayedComponents: .date).labelsHidden().environment(\.timeZone, TimeZone(secondsFromGMT: 0)!) }
                }
            }
            if target.calendar == true { property("Calendar") { Text(T("Shows on the calendar (it has a PIC and a date)")) } }
            if let error = failure ?? proposal.error { Text(T(error)).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            HStack {
                Spacer()
                Button(T("Discard"), action: onDiscard).buttonStyle(.nxBordered)
                Button(T("Apply")) { syncDate(); onApply(choice) }.buttonStyle(.nxPrimary)
                    .disabled(choice.projectId.isEmpty || options == nil || loading)
            }
        }
        .font(NXFont.text(13)).padding(14).background(NX.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.warning.opacity(0.4)))
        .sheet(isPresented: $chooseProject) {
            NavigationStack {
                List {
                    let matches = target.projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
                    if matches.isEmpty { EmptyState(icon: "folder", title: T("No projects found"), subtitle: T("Try a different search.")) }
                    ForEach(matches) { project in
                        Button(project.name) { choice.projectId = project.id; chooseProject = false }
                    }
                }.searchable(text: $search, prompt: T("Search projects"))
                    .navigationTitle(T("Choose a project"))
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { chooseProject = false } } }
            }
        }
        .task {
            guard !hydrated else { return }; hydrated = true
            choice = GideonTaskChoice(projectId: target.chosenProjectId ?? target.projectId ?? "", taskListId: target.taskListId, assigneeIds: target.assigneeIds ?? [], dueDate: target.dueDay)
            if let day = target.dueDay { due = CalDays.date(day); hasDue = true }
        }
        .task(id: choice.projectId) { await loadOptions() }
        .onChange(of: due) { _, _ in syncDate() }
        .accessibilityIdentifier("gideon.createTask." + proposal.id)
    }
    private func property<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(T(label)).foregroundStyle(NX.mutedFg).frame(width: 80, alignment: .leading)
            content().frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func syncDate() { choice.dueDate = hasDue ? AppDateLocale.formatter("yyyy-MM-dd", timeZone: TimeZone(secondsFromGMT: 0)).string(from: due) : nil }
    private func loadOptions() async {
        let id = choice.projectId; options = nil; failure = nil
        guard !id.isEmpty else { return }
        loading = true
        defer { if id == choice.projectId { loading = false } }
        do {
            let result: GideonTaskOptions = try await NativeAPI.request("/api/gideon/task-targets?projectId=" + NativeAPI.escape(id))
            guard id == choice.projectId, !Task.isCancelled else { return }
            choice.reconcile(result, status: target.status); options = result
        } catch { if id == choice.projectId && !Task.isCancelled { failure = error.localizedDescription } }
    }
}
