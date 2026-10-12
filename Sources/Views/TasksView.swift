import SwiftUI

/// Port of web my-tasks.tsx: Overdue · Due soon · Later · Done recently (lib/my-tasks.ts, QA 13 Oct 2026),
/// each most urgent first with "Show all" instead of a silent cut; each row a done-toggle checkbox, title,
/// lane · comments · due (red with "Nd late" when overdue), priority chip. "+" makes a task assigned to you.
struct TasksView: View {
    @Environment(AuthStore.self) private var auth
    @State private var tasks: [MyTask] = []
    @State private var loading = true
    @State private var error: String?
    @State private var openTaskId: String?
    /// Groups opened past their first rows ("Show all", web QA S-04: nothing is silently cut).
    @State private var expanded: Set<MyTaskGroupKey> = []
    @State private var composerOpen = false
    @State private var failure: FailureToastPayload?
    /// False when pushed into another stack — More's, where Tasks lives since Chat took its tab
    /// (owner, 9 Oct 2026). A NavigationStack nested inside another one loses the back button on
    /// everything above it (same rule as InboxView and MessagesView).
    var providesOwnStack = true

    var body: some View {
        if providesOwnStack {
            NavigationStack { screen }
        } else {
            screen
        }
    }

    private var screen: some View {
        Group {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationDestination(item: $openTaskId) { tid in TaskDetailView(taskId: tid) }
            .failureToast($failure)
            .navigationTitle(T("My Tasks"))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { composerOpen = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel(T("New task"))
                }
            }
            .sheet(isPresented: $composerOpen) {
                MyTaskComposer(myId: auth.session?.userId) { await load() }
            }
            .task {
                if tasks.isEmpty, let myId = auth.session?.userId,
                   let hit = ResponseCache.decoded("tasks-\(myId)", as: [MyTask].self) {
                    tasks = hit.value
                    loading = false
                }
                await load()
            }
        }
    }

    /// Overdue · Due soon · Later · Done recently, each most urgent first (web lib/my-tasks.ts).
    private var groups: [MyTaskGroup] { MyTaskGrouping.group(tasks, now: Date()) }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else if groups.isEmpty {
            EmptyState(icon: "checklist", title: T("No tasks yet"),
                       subtitle: T("Tasks assigned to you land here, from a project or a form. Nothing is waiting on you right now — pick something up from a project."),
                       actionTitle: T("New task"), actionIcon: "plus") { composerOpen = true }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(groups) { group in groupSection(group) }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func groupSection(_ group: MyTaskGroup) -> some View {
        let first = group.key.firstRows
        let all = expanded.contains(group.key)
        let shown = all ? group.items : Array(group.items.prefix(first))
        let now = Date()
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(group.key.label.uppercased()).font(NXFont.text(11, .bold)).tracking(0.5)
                    .foregroundStyle(group.key == .overdue ? NX.danger : NX.mutedFg)
                Text("· \(group.items.count)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg.opacity(0.7))
            }
            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { idx, t in
                    if idx > 0 { Divider().overlay(NX.border) }
                    TaskRow(task: t, daysLate: MyTaskGrouping.daysLateIfOverdue(t, now: now),
                            onToggle: { await toggle(t) }, onOpen: { openTaskId = t.id })
                }
                if group.items.count > first {
                    Divider().overlay(NX.border)
                    Button {
                        if all { expanded.remove(group.key) } else { expanded.insert(group.key) }
                    } label: {
                        Text(all ? T("Show fewer") : String(format: T("Show all %d"), group.items.count))
                            .font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 14)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                    .nexusShadowSoft()
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            }
        }
    }

    private func errorState(_ msg: String) -> some View {
        ErrorState(message: msg) { Task { await load() } }
    }

    private func load() async {
        error = nil
        guard let myId = auth.session?.userId else { loading = false; return }
        do { tasks = try await APIClient.shared.myTasks(assigneeId: myId) }
        catch APIError.unauthorized { auth.logout() }
        catch {
            if tasks.isEmpty { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.") }
        }
        loading = false
    }

    private func toggle(_ t: MyTask) async {
        if t.isDone { Haptics.tap() } else { Haptics.success() }
        do { _ = try await APIClient.shared.setTaskStatus(taskId: t.id, status: t.isDone ? "TODO" : "DONE") }
        catch { failure = FailureToastPayload(title: T("Couldn't update the task"), error: error) }
        await load()
    }
}

struct TaskRow: View {
    let task: MyTask
    /// Whole WIB days late when the task is overdue (0 = due today, already past); nil = not overdue.
    var daysLate: Int? = nil
    let onToggle: () async -> Void
    let onOpen: () -> Void
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
                // 44 pt hit area, the 22 pt circle unchanged (web My Tasks done, QA round 2).
                .touchTarget44(drawn: 22)
            }
            .buttonStyle(.plain)

            // Only the text side opens the task: the checkbox is already a button, and a button
            // nested inside another one makes neither tap land where the finger went.
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(UntitledText.task(task.title)).font(NXFont.text(14, .semibold))
                            .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                            .strikethrough(task.isDone).lineLimit(1)
                        HStack(spacing: 10) {
                            Label(task.laneName, systemImage: "sparkles").labelStyle(.titleAndIcon).lineLimit(1)
                            if task.commentCount > 0 { Label("\(task.commentCount)", systemImage: "bubble.left") }
                            // Due under the title on every width (web QA S-22: it was hidden on phones).
                            if let due = MyTaskGrouping.dueLabel(task.dueDate) {
                                Text(due).fontWeight(daysLate != nil ? .semibold : .regular)
                                    .foregroundStyle(daysLate != nil ? NX.danger : NX.mutedFg)
                            }
                            if let late = daysLate, late > 0 {
                                Text(String(format: T("%dd late"), late)).fontWeight(.semibold).foregroundStyle(NX.danger)
                            }
                        }
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer(minLength: 4)
                    if let p = task.priority, p.uppercased() != "NONE" {
                        PriorityPill(priority: p)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(14)
    }
}
