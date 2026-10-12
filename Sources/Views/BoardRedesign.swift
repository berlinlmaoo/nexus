import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Board pieces of the dev redesign (owner, 12 Oct 2026: "Board like web/Notion"). Standard SwiftUI only —
// the board has broken twice from layout experiments (no offsets, no lazy stack in a two-way scroll):
//   • InlineDraftCard — "New task" at the top of a column: Enter saves and keeps typing (saves queue one
//     after another, the field never disables, only the submitted text is cleared — bughunt C-BUG-2),
//     leaving the field saves a typed title (C-BUG-12), ⤢ saves and opens the task.
//   • MoveUndoBar — "Moved 3 tasks · Undo" for 10 s after a move (web group-move).
//   • ViewChipsBar — the project's saved views for the tab on screen, plus New view / Filter / Rename /
//     Delete.
//   • ViewFilterSheet — the simple filter (AND) and sort of a view.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - inline new card

struct InlineDraftCard: View {
    /// Creates the task; answers its id, or nil when it failed (the title is then put back).
    let onSave: (String) async -> String?
    /// Opens a saved task (⤢).
    let onOpen: (String) -> Void
    let onClose: () -> Void

    @State private var title = ""
    @State private var queue: [String] = []
    @State private var running = false
    @State private var failed: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "circle").font(.system(size: 16)).foregroundStyle(NX.mutedFg.opacity(0.5))
                TextField(T("Task title…"), text: $title, axis: .vertical)
                    .font(NXFont.text(14, .semibold))
                    .lineLimit(1...4)
                    .focused($focused)
                    .submitLabel(.next)
                    .onChange(of: title) { _, v in
                        // Return in a vertical field arrives as a newline: that is "save and next".
                        if v.contains("\n") {
                            let parts = v.components(separatedBy: "\n")
                            title = parts.last ?? ""
                            for p in parts.dropLast() { enqueue(p) }
                        }
                    }
                    .onSubmit { enqueue(title); title = "" }
                    .onKeyPress(.escape) { finish(); return .handled }
            }
            if let failed {
                Text(failed).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
            }
            HStack(spacing: 6) {
                if running || !queue.isEmpty { ProgressView().scaleEffect(0.6) }
                Spacer(minLength: 0)
                Button { discard() } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 44, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Discard"))
                Button { Task { await saveAndOpen() } } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText)
                        .frame(width: 44, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Save and open"))
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.violet.opacity(0.45)))
        .onAppear { focused = true }
        // Tapping elsewhere keeps the card's title as a task (Notion), an empty card just closes.
        .onChange(of: focused) { _, now in if !now { finish() } }
    }

    private func enqueue(_ raw: String) {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        failed = nil
        queue.append(t)
        guard !running else { return }
        running = true
        Task {
            while !queue.isEmpty {
                let next = queue.removeFirst()
                if await onSave(next) == nil {
                    // Put it back where it can be seen and sent again.
                    failed = T("Couldn't add the task. It's back in the box.")
                    if title.isEmpty { title = next }
                }
            }
            running = false
        }
    }

    /// Leaving the card (Esc, a tap elsewhere): a typed title is saved, then the card closes. The save
    /// carries on after the card is gone (it calls the board, not this view).
    private func finish() {
        enqueue(title)
        title = ""
        onClose()
    }

    private func discard() {
        title = ""
        onClose()
    }

    private func saveAndOpen() async {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        title = ""
        if let id = await onSave(t) { onClose(); onOpen(id) }
        else { title = t; failed = T("Couldn't add the task. It's back in the box.") }
    }
}

// MARK: - undo after a move

/// Where the moved tasks were, to put them back: one batch per original column + status (+ priority).
struct MoveUndo: Identifiable, Equatable {
    let id = UUID()
    let count: Int
    let groups: [Group]
    /// The bar's words when it is not a move ("Task deleted", "Assigned 3 tasks").
    var label: String? = nil
    struct Group: Equatable { let taskIds: [String]; let laneId: String?; let status: String?; let priority: String? }
    static func == (a: MoveUndo, b: MoveUndo) -> Bool { a.id == b.id }
}

struct MoveUndoBar: View {
    let undo: MoveUndo
    let onUndo: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.right.circle.fill").foregroundStyle(NX.violetText)
            Text(undo.label ?? (undo.count == 1 ? T("Moved 1 task") : String(format: T("Moved %d tasks"), undo.count)))
                .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
            Spacer(minLength: 4)
            Button(T("Undo"), action: onUndo)
                .font(NXFont.text(14, .bold)).foregroundStyle(NX.violetText)
                .frame(minHeight: 44)
                .keyboardShortcut("z", modifiers: .command)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Close"))
        }
        .padding(.horizontal, 16)
        .background(NX.card)
        .overlay(alignment: .top) { Divider().overlay(NX.border) }
        // Ten seconds, as on the web, then it goes by itself.
        .task(id: undo.id) {
            try? await Task.sleep(for: .seconds(10))
            if !Task.isCancelled { onDismiss() }
        }
    }
}

// MARK: - saved views bar

struct ViewChipsBar: View {
    /// The views for the layout on screen (the built-in one first).
    let views: [ProjectViewFull]
    let activeId: String?
    let fieldName: (String) -> String?
    let onPick: (String?) -> Void
    let onNew: () -> Void
    let onFilter: (ProjectViewFull) -> Void
    let onRename: (ProjectViewFull) -> Void
    let onDelete: (ProjectViewFull) -> Void

    private var active: ProjectViewFull? { views.first { $0.id == activeId } ?? views.first }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(views) { v in
                    let on = v.id == (active?.id ?? "")
                    Button { onPick(v.id) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: icon(v)).font(.system(size: 11, weight: .semibold))
                            Text(v.title(fieldName: fieldName)).lineLimit(1)
                            if v.config.isFiltered { Image(systemName: "line.3.horizontal.decrease").font(.system(size: 9, weight: .bold)) }
                        }
                        .font(NXFont.text(12, .semibold))
                        .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(on ? NX.muted : Color.clear, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .contextMenu { menuItems(v) }
                }
                Menu {
                    Button { onNew() } label: { Label(T("New view"), systemImage: "plus") }
                    if let active {
                        Divider()
                        menuItems(active)
                    }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel(T("View options"))
            }
            .padding(.horizontal, 12)
        }
    }

    @ViewBuilder private func menuItems(_ v: ProjectViewFull) -> some View {
        Button { onFilter(v) } label: { Label(T("Filter and sort…"), systemImage: "line.3.horizontal.decrease.circle") }
        Button { onRename(v) } label: { Label(T("Rename…"), systemImage: "pencil") }
        if v.canDelete {
            Button(role: .destructive) { onDelete(v) } label: { Label(T("Delete view"), systemImage: "trash") }
        }
    }

    private func icon(_ v: ProjectViewFull) -> String {
        if (v.config.groupBy ?? "section") != "section" { return "square.grid.3x1.below.line.grid.1x2" }
        switch v.layout {
        case "list": return "list.bullet"
        case "table": return "tablecells"
        case "calendar": return "calendar"
        case "timeline": return "chart.bar.xaxis"
        default: return "rectangle.split.3x1"
        }
    }
}

// MARK: - filter + sort of a view

/// The simple filter (all rules must match) and the sort of one view, saved to the view for everyone who
/// shares it. Properties: status, priority, assignee, due date, title and the project's select fields.
struct ViewFilterSheet: View {
    let view: ProjectViewFull
    let lanes: [ProjectDetail.Lane]
    let fields: [CustomField]
    let members: [ProjectDetail.ProjectMember]
    /// Saves `{ filter: { simple, advanced }, sort, groupBy }`.
    let onSave: ([String: Any]) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var rules: [ViewFilterRule] = []
    @State private var sort: [ViewSort] = []
    @State private var groupBy = "section"
    @State private var saving = false
    @State private var problem: String?

    private var selectFields: [CustomField] { fields.filter { ["SELECT", "STATUS", "MULTI_SELECT"].contains($0.type.uppercased()) } }

    var body: some View {
        NavigationStack {
            Form {
                Section(T("Show tasks where")) {
                    if view.config.advanced != nil {
                        // An and/or filter built on the web: kept as it is; the app does not edit it.
                        Text(T("This view has an advanced filter. Edit it on the web; sort and grouping can be changed here."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    } else if rules.isEmpty {
                        Text(T("No filter: every task is shown.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }
                    if view.config.advanced == nil {
                    ForEach($rules) { $rule in ruleRow($rule) }
                        .onDelete { rules.remove(atOffsets: $0) }
                    Menu {
                        Button(T("Status")) { rules.append(ViewFilterRule(prop: "section", op: "any_of", value: .list([]))) }
                        Button(T("Priority")) { rules.append(ViewFilterRule(prop: "priority", op: "any_of", value: .list([]))) }
                        Button(T("Assignee")) { rules.append(ViewFilterRule(prop: "assignee", op: "any_of", value: .list([ViewEngine.me]))) }
                        Button(T("Due date")) { rules.append(ViewFilterRule(prop: "due", op: "overdue", value: .empty)) }
                        Button(T("Title")) { rules.append(ViewFilterRule(prop: "title", op: "contains", value: .text(""))) }
                        ForEach(selectFields) { f in
                            Button(f.name) { rules.append(ViewFilterRule(prop: "cf:\(f.id)", op: "any_of", value: .list([]))) }
                        }
                    } label: { Label(T("Add a filter"), systemImage: "plus") }
                    }
                }
                Section(T("Sort")) {
                    Picker(T("Sort by"), selection: Binding(get: { sort.first?.prop ?? "" }, set: { p in
                        sort = p.isEmpty ? [] : [ViewSort(prop: p, dir: sort.first?.dir ?? "asc")]
                    })) {
                        Text(T("Manual order")).tag("")
                        Text(T("Due date")).tag("due")
                        Text(T("Priority")).tag("priority")
                        Text(T("Title")).tag("title")
                        Text(T("Start date")).tag("start")
                    }
                    if !sort.isEmpty {
                        Picker(T("Direction"), selection: Binding(get: { sort.first?.dir ?? "asc" }, set: { d in
                            if let p = sort.first?.prop { sort = [ViewSort(prop: p, dir: d)] }
                        })) {
                            Text(T("Ascending")).tag("asc")
                            Text(T("Descending")).tag("desc")
                        }
                        .pickerStyle(.segmented)
                    }
                }
                Section(T("Group by")) {
                    Picker(T("Group by"), selection: $groupBy) {
                        Text(T("Status")).tag("section")
                        Text(T("Priority")).tag("priority")
                        Text(T("Assignee")).tag("assignee")
                        ForEach(selectFields.filter { $0.type.uppercased() != "MULTI_SELECT" }) { f in Text(f.name).tag("cf:\(f.id)") }
                    }
                }
                if let problem {
                    Text(problem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
            }
            .navigationTitle(view.title(fieldName: { id in fields.first { $0.id == id }?.name }))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if saving { ProgressView() } else { Text(T("Save")).bold() } }
                        .disabled(saving)
                }
            }
            .onAppear {
                rules = view.config.simple
                sort = view.config.sort
                groupBy = view.config.groupBy ?? "section"
            }
        }
    }

    private func ruleRow(_ rule: Binding<ViewFilterRule>) -> ViewFilterRuleRow {
        ViewFilterRuleRow(rule: rule, title: propName(rule.wrappedValue.prop), options: options(rule.wrappedValue.prop))
    }

    private func propName(_ p: String) -> String {
        switch p {
        case "section", "status": return T("Status")
        case "priority": return T("Priority")
        case "assignee": return T("Assignee")
        case "due": return T("Due date")
        case "start": return T("Start date")
        case "title": return T("Title")
        default:
            if p.hasPrefix("cf:") { return fields.first { $0.id == String(p.dropFirst(3)) }?.name ?? T("Field") }
            return p
        }
    }

    private func options(_ prop: String) -> [FilterOption] {
        switch prop {
        case "section": return lanes.map { FilterOption(value: $0.id, label: $0.name) }
        case "status": return TaskStatusName.all.map { FilterOption(value: $0, label: TaskStatusName.label($0)) }
        case "priority": return ViewEngine.priorityOrder.map { FilterOption(value: $0, label: TaskPriorityName.label($0)) }
        case "assignee":
            return [FilterOption(value: ViewEngine.me, label: T("Me"))] + members.map { FilterOption(value: $0.uid, label: $0.displayName) }
        default:
            if prop.hasPrefix("cf:") {
                return (fields.first { $0.id == String(prop.dropFirst(3)) }?.choices ?? []).map { FilterOption(value: $0, label: $0) }
            }
            return []
        }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        var patch: [String: Any] = ["sort": sort.map(\.json), "groupBy": groupBy]
        // An advanced filter from the web is never overwritten from here.
        if view.config.advanced == nil { patch["filter"] = ["simple": rules.map(\.json), "advanced": NSNull()] }
        if let err = await onSave(patch) { problem = err } else { dismiss() }
    }
}

// MARK: - board alerts and refs

/// A task opened as a sheet (iPad / Mac). `.sheet(item:)` needs something Identifiable.
struct TaskSheetRef: Identifiable, Hashable { let id: String }

/// Every centred alert of the board, one at a time (house rule: alerts, never confirmation dialogs; two
/// alerts never on one view).
enum BoardAlert: Identifiable {
    case renameStatus(ProjectDetail.Lane)
    case addStatus(StatusGroup)
    case deleteStatus(ProjectDetail.Lane, moveTo: String)
    case newView(layout: String)
    case renameView(ProjectViewFull)
    case deleteView(ProjectViewFull)

    var id: String {
        switch self {
        case .renameStatus(let l): return "rs-\(l.id)"
        case .addStatus(let g): return "as-\(g.rawValue)"
        case .deleteStatus(let l, let m): return "ds-\(l.id)-\(m)"
        case .newView(let l): return "nv-\(l)"
        case .renameView(let v): return "rv-\(v.id)"
        case .deleteView(let v): return "dv-\(v.id)"
        }
    }

    var title: String {
        switch self {
        case .renameStatus: return T("Rename status")
        case .addStatus(let g): return String(format: T("New status in %@"), g.label)
        case .deleteStatus(let l, _): return String(format: T("Delete “%@”?"), l.name)
        case .newView: return T("New view")
        case .renameView: return T("Rename view")
        case .deleteView(let v): return String(format: T("Delete “%@”?"), v.name ?? T("Untitled view"))
        }
    }

    var message: String {
        switch self {
        case .renameStatus: return T("The column and every task in it keep their place.")
        case .addStatus: return T("A new status is a new column on the board.")
        case .deleteStatus: return T("Its tasks move to the status you picked first. Control Room › Audit can restore it.")
        case .newView: return T("A view only you see, with its own filter, sort and grouping.")
        case .renameView: return ""
        case .deleteView: return T("Tasks are not deleted. Control Room › Audit can restore the view.")
        }
    }
}

/// A manual reorder's previous column order, for Undo.
struct ReorderUndo: Identifiable {
    let id = UUID()
    let laneId: String
    let order: [String]
    let count: Int
}


/// One value a filter can pick.
struct FilterOption: Hashable {
    let value: String
    let label: String
}

/// One filter rule's editor, split out of ViewFilterSheet so each piece type-checks on its own.
struct ViewFilterRuleRow: View {
    @Binding var rule: ViewFilterRule
    let title: String
    let options: [FilterOption]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            editor
        }
    }

    @ViewBuilder private var editor: some View {
        if rule.prop == "due" || rule.prop == "start" {
            datePicker
        } else if rule.prop == "title" {
            TextField(T("Contains…"), text: titleBinding)
        } else {
            choicePicker
            if rule.op == "any_of" || rule.op == "none_of" {
                ForEach(options, id: \.value) { o in optionRow(o) }
            }
        }
    }

    private var datePicker: some View {
        Picker(T("When"), selection: $rule.op) {
            Text(T("Overdue")).tag("overdue")
            Text(T("Today")).tag("today")
            Text(T("This week")).tag("this_week")
            Text(T("Next 7 days")).tag("next_days")
            Text(T("Not set")).tag("empty")
            Text(T("Set")).tag("not_empty")
        }
    }

    private var choicePicker: some View {
        Picker(T("Condition"), selection: $rule.op) {
            Text(T("Is any of")).tag("any_of")
            Text(T("Is none of")).tag("none_of")
            Text(T("Is empty")).tag("empty")
            Text(T("Is not empty")).tag("not_empty")
        }
    }

    private var titleBinding: Binding<String> {
        Binding(get: { rule.value.strings.first ?? "" }, set: { rule.value = .text($0) })
    }

    private func optionRow(_ o: FilterOption) -> some View {
        let on = rule.value.strings.contains(o.value)
        return Button {
            var cur = rule.value.strings
            if on { cur.removeAll { $0 == o.value } } else { cur.append(o.value) }
            rule.value = .list(cur)
        } label: {
            HStack {
                Text(o.label).foregroundStyle(NX.foreground)
                Spacer()
                if on { Image(systemName: "checkmark").foregroundStyle(NX.violetText) }
            }
            .frame(minHeight: 36).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}


/// An Undo that is not a move: what the bar says and how to undo it (task delete, bulk assign, bulk due).
struct CustomUndo {
    let bar: MoveUndo
    let action: () async -> Void
    init(label: String, action: @escaping () async -> Void) {
        bar = MoveUndo(count: 0, groups: [], label: label)
        self.action = action
    }
}

/// The tasks a bulk "Due date…" applies to (sheet item).
struct BulkDueRequest: Identifiable {
    let id = UUID()
    let taskIds: [String]
}

/// One due date for several tasks, or none (web bulk edit, C-BUG-15).
struct BulkDueSheet: View {
    let count: Int
    let onApply: (Date?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var day = Date()

    var body: some View {
        NavigationStack {
            DatePicker(T("Due date"), selection: $day, displayedComponents: .date)
                .datePickerStyle(.graphical).tint(NX.violetText).padding()
                .navigationTitle(count == 1 ? T("Due date") : String(format: T("Due date for %d tasks"), count))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button(T("Clear")) { onApply(nil); dismiss() } }
                    ToolbarItem(placement: .topBarTrailing) { Button(T("Save")) { onApply(day); dismiss() }.bold() }
                }
        }
        .presentationDetents([.medium, .large])
    }
}

extension Notification.Name {
    /// A task was deleted from its detail screen; userInfo "auditLogId", "title". The project screen offers
    /// Undo for 10 s (POST /api/tasks/undo-delete, own deletes within 30 min).
    static let nexusTaskDeletedUndoable = Notification.Name("nexus.task.deleted.undoable")
}
