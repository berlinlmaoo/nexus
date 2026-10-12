import SwiftUI
import GameController

// MARK: - Multi-select + Duplicate on Board and List (owner, 11 Oct 2026)
//
// "Task duplicate mode" used to be a per-project switch. It is now always on in every project, and the
// server reports enableTaskBatchDuplicate = true whatever the column says, so nothing here reads it.
//
// How it is reached, using only standard SwiftUI (no custom gestures — the board has broken twice
// from experiments):
//   • iPhone: long-press a card or row → the context menu → Select. The board is now in selection
//     mode: a tap ticks a task instead of opening it, and a bar at the bottom shows Duplicate.
//   • iPad with a pointer / Mac: right-click → Select or Duplicate. In selection mode a click ticks;
//     ⌘A selects every task on screen, ⌘D duplicates, Esc leaves selection mode.
//   • iPad with a keyboard / Mac: ⌘-click ticks or unticks a task (starting selection mode when it is
//     off), ⇧-click ticks every task between the last one ticked and this one, in on-screen order within
//     that lane (Board) or section (List). The held keys are read from the hardware keyboard (GameController); `TapGesture().modifiers(_:)` is macOS-only
//     as a high-priority gesture on the card's Button: with the key held it wins, without it the gesture
//     fails at once and the Button's plain tap (open / tick) and `.draggable` behave as before.
// Duplicate always asks for the copies' due date first (the web's popup), which is what makes it
// useful for recurring work: same tasks, next week's date.

/// Which tasks are ticked, shared by the Board and List tabs of one project.
@Observable
final class TaskSelection {
    /// True while a tap ticks a task instead of opening it.
    private(set) var active = false
    private(set) var ids: Set<String> = []
    /// The last task ticked by hand: where a ⇧-click range starts.
    private(set) var anchor: String?
    /// Set to open the due-date popup; the project screen presents it.
    var pendingDuplicate: TaskDuplicateRequest?

    func contains(_ id: String) -> Bool { ids.contains(id) }

    /// Selection mode, starting with this task ticked.
    func begin(with id: String) {
        active = true
        ids.insert(id)
        anchor = id
    }

    func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        anchor = id
    }

    /// ⌘-click: tick or untick, starting selection mode when it is off.
    func commandToggle(_ id: String) {
        if active { toggle(id) } else { begin(with: id) }
    }

    /// ⇧-click: tick every task from the anchor to this one in `order` (the lane or section on screen).
    /// With no anchor in that order, it ticks just this task and makes it the anchor.
    func extend(to id: String, in order: [String]) {
        active = true
        guard let a = anchor, let from = order.firstIndex(of: a), let to = order.firstIndex(of: id) else {
            ids.insert(id)
            anchor = id
            return
        }
        for i in min(from, to)...max(from, to) { ids.insert(order[i]) }
        // The anchor stays put, as in Finder: a second ⇧-click grows the same range.
    }

    func selectAll(_ all: [String]) {
        active = true
        ids = Set(all)
    }

    func clear() {
        active = false
        ids = []
        anchor = nil
    }

    /// Duplicate from a context menu: the whole selection when this task is part of it, else the task.
    func requestDuplicate(from id: String) {
        if active && ids.contains(id) && ids.count > 1 {
            pendingDuplicate = TaskDuplicateRequest(taskIds: Array(ids))
        } else {
            pendingDuplicate = TaskDuplicateRequest(taskIds: [id])
        }
    }

    func requestDuplicateSelection() {
        guard !ids.isEmpty else { return }
        pendingDuplicate = TaskDuplicateRequest(taskIds: Array(ids))
    }
}

struct TaskDuplicateRequest: Identifiable {
    let id = UUID()
    let taskIds: [String]
}

/// The context-menu items every task card and row gets. Long-press on iPhone, right-click on iPad/Mac.
struct TaskSelectionMenuItems: View {
    let taskId: String
    let selection: TaskSelection

    var body: some View {
        if selection.active {
            Button {
                selection.toggle(taskId)
            } label: {
                Label(selection.contains(taskId) ? T("Deselect") : T("Select"),
                      systemImage: selection.contains(taskId) ? "circle" : "checkmark.circle")
            }
        } else {
            Button { selection.begin(with: taskId) } label: {
                Label(T("Select"), systemImage: "checkmark.circle")
            }
        }
        Button { selection.requestDuplicate(from: taskId) } label: {
            Label(T("Duplicate"), systemImage: "plus.square.on.square")
        }
    }
}

/// The tick drawn on a card or row while selection mode is on. It sits INSIDE the card, at the leading
/// edge of the title row (never in an overlay on the corner: the lane's scroll view clips anything
/// that sticks out). Ticked = a filled accent circle with a white check; not ticked = an outline.
struct TaskSelectionMark: View {
    let selected: Bool
    var body: some View {
        Group {
            if selected {
                Image(systemName: "checkmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(Color.white, NX.violetFill)
            } else {
                Image(systemName: "circle")
                    .foregroundStyle(NX.mutedFg.opacity(0.7))
            }
        }
        .font(.system(size: 20, weight: .medium))
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

extension View {
    /// ⌘-click and ⇧-click on a task card or row (iPad with a keyboard, Mac). `order` is read only on a
    /// ⇧-click: the ids of the lane or section this task is in, top to bottom as drawn.
    func taskModifierClicks(_ taskId: String, selection: TaskSelection?, order: @escaping () -> [String]) -> some View {
        modifier(TaskModifierClicks(taskId: taskId, selection: selection, order: order))
    }
}

struct TaskModifierClicks: ViewModifier {
    let taskId: String
    let selection: TaskSelection?
    let order: () -> [String]
    @ObservedObject private var keys = ModifierKeys.shared

    @ViewBuilder
    func body(content: Content) -> some View {
        if let selection {
            // While ⌘ or ⇧ is held the tap is ours (tick / extend); otherwise it falls through to the
            // card's own tap, drag and context menu untouched. TapGesture.modifiers(_:) is macOS-only,
            // so the held keys come from the hardware keyboard (GameController) instead.
            content.highPriorityGesture(
                TapGesture().onEnded {
                    if keys.shift { selection.extend(to: taskId, in: order()) } else { selection.commandToggle(taskId) }
                },
                including: (keys.command || keys.shift) ? .all : .subviews
            )
        } else {
            content
        }
    }
}

/// Which of ⌘ / ⇧ is held on a hardware keyboard (iPad keyboard, Mac). Published on the main thread.
final class ModifierKeys: ObservableObject {
    static let shared = ModifierKeys()
    @Published private(set) var command = false
    @Published private(set) var shift = false

    private init() {
        NotificationCenter.default.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
            self?.attach()
        }
        attach()
    }

    private func attach() {
        guard let input = GCKeyboard.coalesced?.keyboardInput else { return }
        input.keyChangedHandler = { [weak self] _, _, _, _ in
            DispatchQueue.main.async { self?.refresh() }
        }
        refresh()
    }

    private func refresh() {
        guard let k = GCKeyboard.coalesced?.keyboardInput else { command = false; shift = false; return }
        let cmd = (k.button(forKeyCode: .leftGUI)?.isPressed ?? false) || (k.button(forKeyCode: .rightGUI)?.isPressed ?? false)
        let sh = (k.button(forKeyCode: .leftShift)?.isPressed ?? false) || (k.button(forKeyCode: .rightShift)?.isPressed ?? false)
        if cmd != command { command = cmd }
        if sh != shift { shift = sh }
    }
}

/// The bar at the bottom of the Board and List while selection mode is on.
struct TaskSelectionBar: View {
    let selection: TaskSelection
    /// Every task the tab is showing right now (after the search filter), for Select all.
    let visibleIds: [String]
    /// Bulk edits on the selection (web, 12 Oct 2026: bulk status / priority). Empty = Duplicate only.
    var statusTargets: [ProjectDetail.Lane] = []
    var onMove: (([String], String) -> Void)? = nil
    var onPriority: (([String], String) -> Void)? = nil
    var members: [ProjectDetail.ProjectMember] = []
    var onAssign: (([String], String) -> Void)? = nil
    var onDue: (([String]) -> Void)? = nil

    /// Only what is on screen: a task hidden by search or a filter is never acted on (bughunt C-BUG-4).
    private var targetIds: [String] { visibleIds.filter { selection.contains($0) } }

    var body: some View {
        HStack(spacing: 12) {
            Button(T("Cancel")) { selection.clear() }
                .font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
                .keyboardShortcut(.cancelAction)
            Spacer(minLength: 4)
            VStack(spacing: 2) {
                Text(selection.ids.isEmpty ? T("Pick tasks to duplicate") : String(format: T("%d selected"), selection.ids.count))
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(1)
                Button(T("Select all")) { selection.selectAll(visibleIds) }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                    .keyboardShortcut("a", modifiers: .command)
                    .disabled(visibleIds.isEmpty)
            }
            Spacer(minLength: 4)
            if onMove != nil || onPriority != nil {
                Menu {
                    if let onMove, !statusTargets.isEmpty {
                        Menu(T("Move to")) {
                            ForEach(statusTargets) { l in Button(l.name) { onMove(targetIds, l.id) } }
                        }
                    }
                    if let onPriority {
                        Menu(T("Priority")) {
                            ForEach(TaskPriorityName.all, id: \.self) { p in Button(TaskPriorityName.label(p)) { onPriority(targetIds, p) } }
                        }
                    }
                    if let onAssign, !members.isEmpty {
                        Menu(T("Assign to")) {
                            ForEach(members) { m in Button(m.displayName) { onAssign(targetIds, m.uid) } }
                        }
                    }
                    if let onDue {
                        Button { onDue(targetIds) } label: { Label(T("Due date…"), systemImage: "calendar") }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 20)).foregroundStyle(NX.violetText)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .disabled(targetIds.isEmpty)
                .accessibilityLabel(T("Change the selected tasks"))
            }
            Button {
                // Visible tasks only (C-BUG-4); everything selected when the caller gave no list.
                let ids = visibleIds.isEmpty ? Array(selection.ids) : targetIds
                if !ids.isEmpty { selection.pendingDuplicate = TaskDuplicateRequest(taskIds: ids) }
            } label: {
                Label(T("Duplicate"), systemImage: "plus.square.on.square")
                    .font(NXFont.text(14, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(selection.ids.isEmpty ? NX.mutedFg.opacity(0.5) : NX.violet, in: Capsule())
            }
            .buttonStyle(.plain)
            .keyboardShortcut("d", modifiers: .command)
            .disabled(selection.ids.isEmpty)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(NX.card)
        .overlay(alignment: .top) { Divider().overlay(NX.border) }
    }
}

/// The due-date popup: one date for every copy, as on the web. POST /api/tasks/{id}/duplicate per task;
/// the server copies subtasks, assignees and custom fields, and names each copy "<title> (Copy)".
struct TaskDuplicateSheet: View {
    let tasks: [BoardTask]
    /// Called with how many copies were made, once at least one was.
    let onDuplicated: (Int) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var due: Date
    @State private var working = false
    @State private var problem: String?
    /// Tasks already copied, so trying again after a partial failure never copies them twice.
    @State private var copied: Set<String> = []

    init(tasks: [BoardTask], onDuplicated: @escaping (Int) async -> Void) {
        self.tasks = tasks
        self.onDuplicated = onDuplicated
        // Starts on the first task's own due date, so moving a week ahead is a few taps.
        _due = State(initialValue: tasks.lazy.compactMap { ProjDate.parse($0.dueDate) }.first ?? Date())
    }

    private var title: String {
        tasks.count == 1 ? T("Duplicate 1 task") : String(format: T("Duplicate %d tasks"), tasks.count)
    }

    private var names: String {
        let shown = tasks.prefix(3).map(\.title).joined(separator: ", ")
        return tasks.count > 3 ? shown + ", " + String(format: T("and %d more"), tasks.count - 3) : shown
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(T("Pick the due date for the copies. Everything else — subtasks, assignees, fields — is copied as it is."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                    DatePicker(T("New due date"), selection: $due, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .tint(NX.violetText)
                    Text(names)
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    if let problem {
                        Text(problem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    }
                    Button { Task { await run() } } label: {
                        HStack(spacing: 6) {
                            if working { ProgressView().tint(.white) }
                            Text(working ? T("Duplicating…") : T("Duplicate"))
                        }
                        .font(NXFont.text(15, .bold))
                    }
                    .buttonStyle(NexusPrimaryButton())
                    .disabled(working || tasks.isEmpty)
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Cancel")) { dismiss() }.disabled(working)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(working)
    }

    /// Same day format as the task detail's due date (yyyy-MM-dd, Jakarta).
    private var dueDay: String {
        let f = DateFormatter()
        f.calendar = ProjDate.cal
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: due)
    }

    private func run() async {
        // A double tap duplicated every task twice (bughunt C-BUG-8).
        guard !working else { return }
        working = true
        problem = nil
        let day = dueDay
        var made = 0
        // One at a time: the server places each copy at the end of its section, and parallel posts
        // would race for the same position.
        for t in tasks where !copied.contains(t.id) {
            if (try? await APIClient.shared.duplicateTask(t.id, dueDate: day)) != nil {
                copied.insert(t.id)
                made += 1
            }
        }
        working = false
        if made > 0 { await onDuplicated(made) }
        let left = tasks.count - copied.count
        if left == 0 {
            dismiss()
        } else {
            problem = String(format: T("%d of %d tasks weren't duplicated. Try again."), left, tasks.count)
        }
    }
}
