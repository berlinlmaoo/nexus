import SwiftUI

/// Port of web my-tasks.tsx ("My Quest Log"): tasks grouped Hot today / In motion / Recently slayed,
/// each a row with a done-toggle checkbox, title, lane · comments, priority chip.
struct TasksView: View {
    @Environment(AuthStore.self) private var auth
    @State private var tasks: [MyTask] = []
    @State private var loading = true
    @State private var error: String?
    @State private var openTaskId: String?

    @State private var actionError: String?
    @Environment(AppRouter.self) private var router
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
            .alert(T("Couldn't update the task"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK") { actionError = nil }
        } message: { Text(actionError ?? "") }
            .navigationTitle(T("My Tasks"))
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

    private var groups: [(label: String, items: [MyTask])] {
        let open = tasks.filter { !$0.isDone }
        let hot = open.filter { isDueSoon($0.dueDate) }
        let motion = open.filter { !isDueSoon($0.dueDate) }
        let done = tasks.filter { $0.isDone }
        return [(T("Due soon"), Array(hot.prefix(8))), (T("Later"), Array(motion.prefix(12))), (T("Done recently"), Array(done.prefix(8)))]
            .filter { !$0.1.isEmpty }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else if tasks.isEmpty {
            EmptyState(icon: "checklist", title: T("No tasks yet"),
                       subtitle: T("Tasks assigned to you land here, from a project or a form. Nothing is waiting on you right now — pick something up from a project."),
                       actionTitle: T("Browse projects"), actionIcon: "rectangle.stack") { router.go(.projects) }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(groups, id: \.label) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                SectionLabel(group.label)
                                Text("· \(group.items.count)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg.opacity(0.7))
                            }
                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { idx, t in
                                    if idx > 0 { Divider().overlay(NX.border) }
                                    TaskRow(task: t, onToggle: { await toggle(t) }, onOpen: { openTaskId = t.id })
                                }
                            }
                            .background {
                                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                                    .nexusShadowSoft()
                                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                            }
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
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
        catch { actionError = (error as? LocalizedError)?.errorDescription ?? T("The server refused it; the task is unchanged.") }
        await load()
    }

    private func isDueSoon(_ iso: String?) -> Bool {
        guard let d = ProjDate.parse(iso) else { return false }
        return d.timeIntervalSinceNow < 2 * 24 * 60 * 60   // within ~2 days
    }
}

struct TaskRow: View {
    let task: MyTask
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
            }
            .buttonStyle(.plain)

            // Only the text side opens the task: the checkbox is already a button, and a button
            // nested inside another one makes neither tap land where the finger went.
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(task.title ?? T("Untitled")).font(NXFont.text(14, .semibold))
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
