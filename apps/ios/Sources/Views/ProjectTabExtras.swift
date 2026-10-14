import SwiftUI

// Automations moved to AutomationsViews.swift (rebuilt 12 Oct 2026, When / If / Do).

// ============================================================================
// Table — the web's `table` view (components/projects/ProjectTableView.tsx, owner screenshot 274,
// Mac parity 13 Oct 2026): a bordered grid, column headers with their type icons, the tasks grouped by
// status / section in collapsible groups (the coloured pill + count) with "+ New task" under each, and the
// cells edited in place (assignee, priority, status menus). Needs NO new API: it reuses the tasks already
// loaded for the board plus /api/custom-fields.
//
// Structure (no lazy stack in a two-way scroll): a horizontal ScrollView, only scrolling when the columns
// are wider than the window, holding a FIXED header above a vertical ScrollView of NON-lazy rows. The row
// count is bounded the web's way (Incremental: 40 per group, then 25 more per tap).
// ============================================================================

/// The Table's column widths for one window width: the web's grid (Name minmax(240px, 2fr), every other
/// column minmax(140px, 1fr), a 40px open column). Wider than the window = it scrolls sideways.
struct TableColumns: Equatable {
    var name: CGFloat
    var col: CGFloat
    var field: CGFloat
    var fieldCount: Int
    let open: CGFloat = 40
    /// Assignee, Due date, Priority, Status.
    static let fixedCount = 4
    var total: CGFloat { name + col * CGFloat(Self.fixedCount) + field * CGFloat(fieldCount) + open }

    static func fit(width: CGFloat, fieldCount: Int, compact: Bool) -> TableColumns {
        let minName: CGFloat = compact ? 200 : 260
        let minCol: CGFloat = compact ? 120 : 150
        let flex = CGFloat(fixedCount + fieldCount)
        let minTotal = minName + minCol * flex + 40
        let share = max(0, width - minTotal) / (flex + 2)
        if !compact && share == 0 {
            // Wider than the window on an iPad / Mac: the window's edge falls on a column boundary, the
            // name column taking up the rest, so no amount is cut mid-number at the edge ("Rp 6.842.09",
            // UI tour run 11, PD-1); the trailing fade still says more columns lie that way.
            let fit = max(1, floor((width - minName) / minCol))
            let name = max(minName, width - fit * minCol)
            return TableColumns(name: name, col: minCol, field: minCol, fieldCount: fieldCount)
        }
        if compact && share == 0 {
            // A phone never fits the table: size the name so the screen's edge falls through the MIDDLE of
            // a column (Notion's peek), never on a column's edge, where "Due date" read as the last column,
            // cut with no ellipsis (UI tour run 9, I5).
            let name = max(170, min(260, width - minCol * 1.5))
            return TableColumns(name: name, col: minCol, field: minCol, fieldCount: fieldCount)
        }
        return TableColumns(name: minName + 2 * share, col: minCol + share, field: minCol + share, fieldCount: fieldCount)
    }
}

struct ProjectTableTab: View {
    let projectId: String
    /// The sections as drawn (search and the Overview drill applied), subtasks merged in.
    let lanes: [ProjectDetail.Lane]
    /// Every section, for the Status menu (a task can move to one the search hides).
    let allLanes: [ProjectDetail.Lane]
    let members: [ProjectDetail.ProjectMember]
    /// The project works with status options: the groups and the Status column are the options.
    let statusOptions: Bool
    /// Multi-select (Can edit and up); nil = rows only open.
    var selection: TaskSelection? = nil
    let onOpen: (String) -> Void
    /// Rows dropped on a row / group (ids, that section, that row): a move like the List's.
    var onDrop: (([String], String, String?) -> Void)? = nil
    // In-place edits; nil below Can edit (the cell is then plain text).
    var onMoveTo: ((String, String) -> Void)? = nil
    var onSetStatus: ((String, String) -> Void)? = nil
    var onSetPriority: ((String, String) -> Void)? = nil
    var onToggleAssignee: ((String, String, Bool) -> Void)? = nil
    /// "+ New task" under a group; answers the new task's id (nil = failed, the board says why).
    var onAddTask: ((String, String) async -> String?)? = nil

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var fields: [CustomField] = []
    @State private var collapsed: Set<String> = []
    /// How many rows each group draws (web Incremental: 40, then 25 more).
    @State private var shown: [String: Int] = [:]
    @State private var draftLane: String?
    @State private var draftTitle = ""
    @FocusState private var draftFocused: Bool

    private var compact: Bool { hSize != .regular }
    /// Date fields that hold names ("Request by" from a Notion import): a person icon, not a calendar.
    private var nameFields: Set<String> {
        let tasks = lanes.flatMap { $0.tasks ?? [] }
        return Set(fields.filter { ["DATE", "CREATED"].contains($0.type.uppercased()) && cfFieldHoldsNames($0.id, in: tasks) }.map(\.id))
    }
    private var hasTasks: Bool { lanes.contains { !($0.tasks ?? []).isEmpty } }

    var body: some View {
        Group {
            if lanes.isEmpty || (!hasTasks && onAddTask == nil) {
                EmptyState(icon: "tablecells", title: T("No tasks yet"),
                           subtitle: T("Tasks you add to this project show up here. Start with the first one."))
            } else {
                GeometryReader { geo in
                    let pad: CGFloat = compact ? 12 : 24
                    let cols = TableColumns.fit(width: geo.size.width - pad * 2, fieldCount: fields.count, compact: compact)
                    grid(cols, visibleWidth: geo.size.width - pad * 2)
                        .padding(.horizontal, pad).padding(.vertical, 12)
                }
            }
        }
        .task { fields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? [] }
    }

    private func grid(_ cols: TableColumns, visibleWidth: CGFloat) -> some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 0) {
                TableHeaderRow(cols: cols, fields: fields, nameFields: nameFields)
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(lanes) { lane in group(lane, cols) }
                    }
                    .padding(.bottom, 24)
                }
            }
            .frame(width: cols.total)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        // More columns to the right: the edge fades instead of cutting a label clean (UI tour run 9, I5).
        .overlay(alignment: .trailing) {
            if cols.total > visibleWidth + 1 {
                LinearGradient(colors: [NX.card.opacity(0), NX.card], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 28)
                    .allowsHitTesting(false)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }

    // MARK: groups

    private func group(_ lane: ProjectDetail.Lane, _ cols: TableColumns) -> some View {
        let isCollapsed = collapsed.contains(lane.id)
        let tasks = lane.tasks ?? []
        let limit = shown[lane.id] ?? 40
        return VStack(alignment: .leading, spacing: 0) {
            groupHeader(lane, count: tasks.count, collapsed: isCollapsed)
            if !isCollapsed {
                let order: () -> [String] = { tasks.map(\.id) }
                ForEach(Array(tasks.prefix(limit))) { t in
                    row(t, laneId: lane.id, cols: cols, order: order)
                }
                if tasks.count > limit {
                    let more = min(25, tasks.count - limit)
                    Button { shown[lane.id] = limit + 25 } label: {
                        Text(String(format: T("Show %d more"), more))
                            .font(NXFont.text(14, .medium)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .overlay(alignment: .bottom) { TableHairline() }
                }
                if onAddTask != nil { newTaskRow(lane.id) }
            }
        }
        .contentShape(Rectangle())
        // A whole group takes a drop (web: drag a row's grip onto another group).
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            guard let onDrop, !ids.isEmpty else { return false }
            onDrop(ids, lane.id, nil)
            return true
        }
    }

    private func groupHeader(_ lane: ProjectDetail.Lane, count: Int, collapsed isCollapsed: Bool) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.2)) {
                if isCollapsed { collapsed.remove(lane.id) } else { collapsed.insert(lane.id) }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                    .frame(width: 18)
                if statusOptions {
                    StatusPill(name: lane.name, colorKey: lane.colorKey, size: 14)
                } else {
                    Text(lane.name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                Text("\(count)").font(NXFont.text(14)).foregroundStyle(NX.mutedFg).monospacedDigit()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(NX.card)
        .overlay(alignment: .bottom) { TableHairline() }
        .accessibilityLabel("\(lane.name), \(count)")
        .accessibilityValue(isCollapsed ? T("Collapsed") : T("Expanded"))
    }

    private func row(_ t: BoardTask, laneId: String, cols: TableColumns, order: @escaping () -> [String]) -> some View {
        let laneStatus: RowStatus? = statusOptions
            ? allLanes.first { $0.id == laneId }.map { RowStatus(name: $0.name, colorKey: $0.colorKey) }
            : nil
        return ProjectTableRow(
            task: t, laneId: laneId, cols: cols, fields: fields,
            status: laneStatus ?? RowStatus.plain(t), statusOptions: statusOptions,
            allLanes: allLanes, members: members, selection: selection, order: order,
            onOpen: onOpen, onDrop: onDrop, onMoveTo: onMoveTo, onSetStatus: onSetStatus,
            onSetPriority: onSetPriority, onToggleAssignee: onToggleAssignee
        )
    }

    // MARK: + New task

    @ViewBuilder private func newTaskRow(_ laneId: String) -> some View {
        if draftLane == laneId {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                TextField(T("Task title"), text: $draftTitle)
                    .focused($draftFocused)
                    .font(NXFont.text(15))
                    .submitLabel(.done)
                    .onSubmit { submit(laneId) }
                Button(T("Cancel")) { draftLane = nil; draftTitle = "" }
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: 640, minHeight: 42, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { TableHairline() }
        } else {
            Button {
                draftTitle = ""
                draftLane = laneId
                draftFocused = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .semibold))
                    Text(T("New task")).font(NXFont.text(15))
                }
                .foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .overlay(alignment: .bottom) { TableHairline() }
        }
    }

    /// Creates the task and keeps the field open for the next one (web inline draft). A failure is told by
    /// the board, which keeps the title with Try again.
    private func submit(_ laneId: String) {
        let title = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let onAddTask else { return }
        draftTitle = ""
        draftFocused = true
        Task { _ = await onAddTask(laneId, title) }
    }
}

/// The Table's 1pt grid line under a row.
struct TableHairline: View {
    var body: some View { Rectangle().fill(NX.border).frame(height: 1) }
}

/// The column headers: each property's type icon and name (web PropIcon + label).
struct TableHeaderRow: View {
    let cols: TableColumns
    let fields: [CustomField]
    /// Date fields holding names (cfFieldHoldsNames).
    var nameFields: Set<String> = []

    var body: some View {
        HStack(spacing: 0) {
            cell(T("Name"), icon: "textformat", width: cols.name, first: true)
            cell(T("Assignee"), icon: "person", width: cols.col)
            cell(T("Due date"), icon: "calendar", width: cols.col)
            // The project's fields come right after the dates, as on the web's table (Harga, Request by,
            // Tanggal Penggunaan…, then Priority and Status): an iPad beside the sidebar showed the four
            // built-in columns and never a field (UI tour run 10, IPD-4).
            ForEach(fields) { f in
                cell(f.name, icon: nameFields.contains(f.id) ? "person" : Self.icon(f.type), width: cols.field)
            }
            cell(T("Priority"), icon: "flag", width: cols.col)
            cell(T("Status"), icon: "rectangle.split.3x1", width: cols.col)
            Color.clear.frame(width: cols.open, height: 40)
                .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1) }
        }
        .background(NX.card)
        .overlay(alignment: .bottom) { TableHairline() }
    }

    private func cell(_ title: String, icon: String, width: CGFloat, first: Bool = false) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12))
            Text(title).font(NXFont.text(13)).lineLimit(1).truncationMode(.tail)
        }
        .foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 12)
        .frame(width: width, height: 40, alignment: .leading)
        .clipped()
        .overlay(alignment: .leading) { if !first { Rectangle().fill(NX.border).frame(width: 1) } }
        // A long name is cut ("Tanggal Peng…"): the pointer shows it whole (UI tour run 11, MC-10).
        .help(title)
    }

    static func icon(_ type: String) -> String {
        switch type.uppercased() {
        case "NUMBER": return "number"
        case "DATE": return "calendar"
        case "CREATED": return "clock"
        case "SELECT", "STATUS": return "chevron.down.circle"
        case "MULTI_SELECT": return "list.bullet"
        case "PLACE": return "mappin.and.ellipse"
        case "URL": return "link"
        case "CHECKBOX": return "checkmark.square"
        case "FILE": return "paperclip"
        default: return "text.alignleft"
        }
    }
}

/// One Table row: name (opens, ticks in selection mode), assignee / priority / status menus, the due date,
/// the project's fields, and the open chevron. Every cell has a fixed width, so the columns line up.
struct ProjectTableRow: View {
    let task: BoardTask
    let laneId: String
    let cols: TableColumns
    let fields: [CustomField]
    let status: RowStatus
    let statusOptions: Bool
    let allLanes: [ProjectDetail.Lane]
    let members: [ProjectDetail.ProjectMember]
    let selection: TaskSelection?
    let order: () -> [String]
    let onOpen: (String) -> Void
    let onDrop: (([String], String, String?) -> Void)?
    let onMoveTo: ((String, String) -> Void)?
    let onSetStatus: ((String, String) -> Void)?
    let onSetPriority: ((String, String) -> Void)?
    let onToggleAssignee: ((String, String, Bool) -> Void)?

    private let rowH: CGFloat = 50
    private var selecting: Bool { selection?.active ?? false }
    private var selected: Bool { selection?.contains(task.id) ?? false }

    var body: some View {
        HStack(spacing: 0) {
            nameCell
            assigneeCell.modifier(TableCell(width: cols.col, height: rowH))
            dueCell.modifier(TableCell(width: cols.col, height: rowH))
            ForEach(fields) { f in
                openButton { Text(fieldText(f)).font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.9)).lineLimit(1) }
                    .modifier(TableCell(width: cols.field, height: rowH))
            }
            priorityCell.modifier(TableCell(width: cols.col, height: rowH))
            statusCell.modifier(TableCell(width: cols.col, height: rowH))
            openButton {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .medium)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity)
            }
            .modifier(TableCell(width: cols.open, height: rowH, inset: 0))
            .accessibilityLabel(T("Open"))
        }
        .background(selecting && selected ? NX.violet.opacity(0.10) : Color.clear)
        .overlay(alignment: .bottom) { TableHairline() }
        .accessibilityAddTraits(selecting && selected ? .isSelected : [])
        // Dropped on a row: just before it (manual order inside the group, or a move to that place).
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            guard let onDrop, !ids.isEmpty, !ids.contains(task.id) else { return false }
            onDrop(ids, laneId, task.id)
            return true
        }
    }

    // MARK: cells

    @ViewBuilder private var nameCell: some View {
        let base = Button {
            if selecting, let selection { selection.toggle(task.id) } else { onOpen(task.id) }
        } label: {
            HStack(spacing: 8) {
                if selecting { TaskSelectionMark(selected: selected) }
                if task.isSubtask {
                    Image(systemName: "arrow.turn.down.right").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                }
                Text(task.title)
                    .font(NXFont.text(16, .medium))
                    .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(task.isDone)
                    .lineLimit(1)
                if task.hasQuest { QuestXPChip(xp: task.questXP) }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .medium)).foregroundStyle(NX.mutedFg.opacity(0.6))
            }
            .padding(.leading, task.isSubtask ? 26 : 14).padding(.trailing, 10)
            .frame(width: cols.name, height: rowH, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .taskModifierClicks(task.id, selection: selection, order: order)
        if let selection, onDrop != nil {
            // The name is the grip (web: the row's drag handle sits in the name cell); a long press lifts it.
            base
                .contextMenu { TaskSelectionMenuItems(taskId: task.id, selection: selection) }
                .draggable(task.id)
        } else {
            base
        }
    }

    @ViewBuilder private var assigneeCell: some View {
        if let onToggleAssignee, !members.isEmpty {
            Menu {
                ForEach(members.filter { !$0.uid.isEmpty }, id: \.uid) { m in
                    let has = (task.assignees ?? []).contains { $0.user?.id == m.uid }
                    Button { onToggleAssignee(task.id, m.uid, has) } label: {
                        if has { Label(m.displayName, systemImage: "checkmark") } else { Text(m.displayName) }
                    }
                }
            } label: { avatars }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(T("Assignee"))
        } else {
            openButton { avatars }
        }
    }

    private var avatars: some View {
        HStack(spacing: -6) {
            ForEach(task.assigneeAvatars, id: \.id) { a in
                AvatarView(url: a.url, initial: a.initial, size: 26)
                    .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
            }
            if task.assigneeAvatars.isEmpty {
                Text("—").font(NXFont.text(14)).foregroundStyle(NX.mutedFg.opacity(0.6))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var dueCell: some View {
        openButton {
            if let due = ProjDate.parse(task.dueDate) {
                let overdue = !task.isDone && due < ProjDate.cal.startOfDay(for: Date())
                Text(AppDateLocale.shortDate(due, timeZone: ProjDate.cal.timeZone))
                    .font(NXFont.text(14, overdue ? .medium : .regular))
                    .foregroundStyle(overdue ? NX.danger : NX.foreground.opacity(0.9))
                    .lineLimit(1).truncationMode(.tail)
            }
        }
    }

    @ViewBuilder private var priorityCell: some View {
        let p = (task.priority ?? "NONE").uppercased()
        if let onSetPriority {
            Menu {
                ForEach(TaskPriorityName.all, id: \.self) { v in
                    Button { onSetPriority(task.id, v) } label: {
                        if v == p { Label(TaskPriorityName.label(v), systemImage: "checkmark") } else { Text(TaskPriorityName.label(v)) }
                    }
                }
            } label: { priorityFace(p) }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(T("Priority"))
        } else {
            openButton { priorityFace(p) }
        }
    }

    private func priorityFace(_ p: String) -> some View {
        HStack(spacing: 0) {
            if p != "NONE" { TablePill(text: TaskPriorityName.label(p), tone: prioTone(p)) }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var statusCell: some View {
        if statusOptions, let onMoveTo {
            Menu {
                ForEach(StatusOptions.ordered(allLanes)) { l in
                    Button { if l.id != laneId { onMoveTo(task.id, l.id) } } label: {
                        if l.id == laneId { Label(l.name, systemImage: "checkmark") } else { Text(l.name) }
                    }
                }
            } label: { statusFace(menu: true) }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(T("Status"))
        } else if !statusOptions, let onSetStatus {
            let current = (task.status ?? "TODO").uppercased()
            Menu {
                ForEach(TaskStatusName.all, id: \.self) { s in
                    Button { if s != current { onSetStatus(task.id, s) } } label: {
                        if s == current { Label(TaskStatusName.label(s), systemImage: "checkmark") } else { Text(TaskStatusName.label(s)) }
                    }
                }
            } label: { statusFace(menu: true) }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(T("Status"))
        } else {
            openButton { statusFace(menu: false) }
        }
    }

    private func statusFace(menu: Bool) -> some View {
        HStack(spacing: 6) {
            StatusPill(name: status.name, colorKey: status.colorKey, size: 13).fixedSize()
            if menu {
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// A plain cell: a tap opens the task (or ticks it in selection mode), like the web row.
    private func openButton<L: View>(@ViewBuilder _ label: () -> L) -> some View {
        Button {
            if selecting, let selection { selection.toggle(task.id) } else { onOpen(task.id) }
        } label: {
            HStack(spacing: 0) { label(); Spacer(minLength: 0) }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Reuses the board's chip formatter so currency / multi-select / place values read the same here as on
    /// a card.
    private func fieldText(_ f: CustomField) -> String {
        guard let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == f.id }) else { return "" }
        let chip = customFieldChip(cfv)
        // A date says its year only when it is not this year ("15 Apr", "3 Mar 2025"), as on the web.
        if chip?.isDate == true, let day = cfParseDay(cfv.value ?? "") {
            return AppDateLocale.shortDate(day, timeZone: ProjDate.cal.timeZone)
        }
        return chip?.label ?? (cfv.value ?? "")
    }
}

/// A cell's box: fixed width, the row's height, the grid line on its left.
struct TableCell: ViewModifier {
    let width: CGFloat
    let height: CGFloat
    var inset: CGFloat = 12
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, inset)
            .frame(width: width, height: height, alignment: .leading)
            // A pill wider than its column stays in it (a status menu's chevron drew over the next cell).
            .clipped()
            .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1) }
    }
}

/// The Table's priority pill: the web's 13px pill with a dot.
struct TablePill: View {
    let text: String
    let tone: ChipTone
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(tone.fg).frame(width: 6, height: 6)
            Text(text).font(NXFont.text(13, .medium)).lineLimit(1)
        }
        .foregroundStyle(tone.fg)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(tone.bg, in: Capsule())
        .fixedSize()
    }
}
