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
/// column minmax(140px, 1fr)). Wider than the window = it scrolls sideways. No trailing open column: every
/// cell opens the task, and the web table ends on Status (UI tour run 20, Mac R20-M-02: a column of "›").
///
/// Every column after Name has its own width (`widths`, in order: Assignee, Due date, the project's fields,
/// Priority, Status), so a field column is at least as wide as its header: "Tanggal Penggunaan" wrapped
/// onto two lines in a 150 pt column (UI tour run 14, P-I12 / P-M9).
struct TableColumns: Equatable {
    var name: CGFloat
    var widths: [CGFloat]
    /// Assignee, Due date, Priority, Status.
    static let fixedCount = 4

    var assignee: CGFloat { widths[0] }
    var due: CGFloat { widths[1] }
    func field(_ i: Int) -> CGFloat { widths[2 + i] }
    var priority: CGFloat { widths[widths.count - 2] }
    var status: CGFloat { widths[widths.count - 1] }
    var total: CGFloat { name + widths.reduce(0, +) }

    /// The sideways offsets at which a column starts right after the frozen Name column: the only places
    /// the scroll comes to rest, so no column is ever half under it (see TableColumnSnap).
    var columnStarts: [CGFloat] {
        var out: [CGFloat] = [0]
        var x: CGFloat = 0
        for w in widths { x += w; out.append(x) }
        return out
    }

    /// Room after the last column so the scroll's end is also a column start (the last resting place
    /// would otherwise leave the column beside Name half hidden under it).
    func trailingRoom(visibleWidth: CGFloat) -> CGFloat {
        let maxX = total - visibleWidth
        guard maxX > 0 else { return 0 }
        guard let next = columnStarts.first(where: { $0 >= maxX - 0.5 }) else { return 0 }
        return max(0, next - maxX)
    }

    /// A header's natural width: its icon, the name on one line, the cell's padding.
    static func headerWidth(_ title: String) -> CGFloat {
        let font = UIFont(name: "Inter", size: 13) ?? .systemFont(ofSize: 13)
        let text = (title as NSString).size(withAttributes: [.font: font]).width
        return ceil(text) + 12 + 6 + 24 + 4
    }

    static func fit(width: CGFloat, fieldNames: [String], compact: Bool) -> TableColumns {
        // Name wraps to two lines, so it needs less width; on a 13" iPad beside the sidebar three columns now
        // fit next to it and Harga shows on the first screen, as on the web (UI tour run 15, Q-IA5 / Q-M14).
        let minName: CGFloat = compact ? 120 : 220
        let minCol: CGFloat = compact ? 120 : 140
        let fieldMins = fieldNames.map { min(compact ? 220 : 280, max(minCol, headerWidth($0))) }
        let mins = [minCol, minCol] + fieldMins + [minCol, minCol]
        let minTotal = minName + mins.reduce(0, +) + 40
        if width >= minTotal {
            // Everything fits: the spare room is shared, Name taking two shares (web 2fr / 1fr).
            let share = (width - minTotal) / CGFloat(mins.count + 2)
            return TableColumns(name: minName + 2 * share, widths: mins.map { $0 + share })
        }
        if compact {
            // A phone never fits the table: Name and ONE whole column beside it, every column as wide as that
            // room, so each swipe lands on a whole column and the screen's edge never cuts one. A peeking money
            // column read "Rp 3", "Rp 6.8" or a bare "Rp" (UI tour run 17, iPhone R17-I-02; decision 17). More
            // columns are cued by the "›" in the header and the scroll bar, not by a cut column.
            let room = max(minCol, width - minName)
            let visible = max(1, Int(room / minCol))
            let column = room / CGFloat(visible)
            return TableColumns(name: minName, widths: mins.map { _ in column })
        }
        // Wider than the window on an iPad / Mac: Name keeps its minimum (it took half the window before,
        // UI tour run 14, P-I12 / P-M9), and EVERY column gets one width, the room beside Name shared by the k
        // widest-header columns that fit. Each resting place (a column start, TableColumnSnap) then shows k whole
        // columns, on the first page and after every swipe: with columns of their own widths a later page ended
        // mid-column, and the strip covering the cut left a ~180 pt empty band before "›" (UI tour run 20, iPad
        // R20-I-10; the cover itself came from Mac R19-M-02). The 22 pt of the header's "›" stay free (R18-M-04).
        let peek: CGFloat = 22
        let widest = mins.max() ?? minCol
        let k = max(1, min(mins.count - 1, Int((width - minName - peek) / widest)))
        let nameExtra = min(80, max(0, width - minName - peek - CGFloat(k) * widest))
        let column = max(minCol, (width - minName - nameExtra - peek) / CGFloat(k))
        return TableColumns(name: minName + nameExtra, widths: mins.map { _ in column })
    }
}

/// Sideways, the Table comes to rest only where a column starts right after the frozen Name column. A
/// free stop left the column beside Name partly under it: its header said "Tanggal Penggunaan" while its
/// cells read "ul", "Aug" (UI tour run 14, N-03 / P-I2 / P-M2).
struct TableColumnSnap: ScrollTargetBehavior {
    let starts: [CGFloat]
    /// The columns' visible width beside the frozen Name column (nil: no limit). One swipe then moves at
    /// most a page: the first column the edge cut becomes the first beside Name, so no column is ever
    /// skipped (UI tour run 16, R16-I-06 iPad: Request by and Tanggal Penggunaan were never on screen).
    var pageWidth: CGFloat? = nil
    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        let maxX = max(0, context.contentSize.width - context.containerSize.width)
        guard maxX > 0 else { return }
        var x = min(max(0, target.rect.origin.x), maxX)
        let stops = starts.filter { $0 <= maxX + 0.5 }
        if let pageWidth, pageWidth > 0 {
            let from = context.originalTarget.rect.origin.x
            let forward = stops.last { $0 <= from + pageWidth + 0.5 } ?? from
            let back = stops.first { $0 >= from - pageWidth - 0.5 } ?? from
            x = min(max(x, back), max(forward, from))
        }
        guard let best = stops.min(by: { abs($0 - x) < abs($1 - x) }) else { return }
        target.rect.origin.x = min(best, maxX)
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
    /// Each task's status option when the rows are grouped by something else than the section (the Table's
    /// view groups by a property, web Group); nil = the group's own section.
    var statusOf: ((BoardTask) -> RowStatus?)? = nil

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var fields: [CustomField] = []
    @State private var collapsed: Set<String> = []
    /// How many rows each group draws (web Incremental: 40, then 25 more).
    @State private var shown: [String: Int] = [:]
    @State private var draftLane: String?
    @State private var draftTitle = ""
    @FocusState private var draftFocused: Bool
    /// How far the columns are scrolled sideways: the Name column and the group titles move back by it,
    /// so they stay at the leading edge (UI tour run 13, F-05 / I-7 / M-6: scrolled right, the rows had no
    /// name and the group headers were blank bands). iOS 18+; earlier systems scroll the column away.
    @State private var stickyX: CGFloat = 0
    /// Where every resting place of the vertical scroll starts (group headers, rows, "Show more", "+ New task"),
    /// the rows' height and the scroll's own: for `endRoom`.
    @State private var rowTops: [String: CGFloat] = [:]
    @State private var rowsHeight: CGFloat = 0
    @State private var rowsViewport: CGFloat = 0

    /// The room after the last row: 24 pt, plus what makes the scroll's END a row start too. At the end the scroll
    /// cannot snap, so the last pages began with the bottom of the row before (its hairline ~3 pt under the
    /// header: a doubled rule; UI tour run 20, R20-I-06). With the end on a row start every resting offset is a row
    /// boundary, and the header's own rule is the only line at the top.
    private var endRoom: CGFloat {
        let base: CGFloat = 24
        let maxOff = rowsHeight + base - rowsViewport
        guard rowsViewport > 0, maxOff > 0, let next = rowTops.values.filter({ $0 >= maxOff - 0.5 }).min() else { return base }
        return base + (next - maxOff)
    }

    private var compact: Bool { hSize != .regular }
    /// Date fields that hold names ("Request by" from a Notion import): the text glyph, not a calendar (and not a
    /// person: only real people get that, decision 5 of run 19; decision 2 of run 20).
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
                    let cols = TableColumns.fit(width: geo.size.width - pad * 2, fieldNames: fields.map(\.name), compact: compact)
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
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(lanes) { lane in group(lane, cols) }
                    }
                    .coordinateSpace(.named(TableRowTop.space))
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowsHeight = $0 }
                    .padding(.bottom, endRoom)
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowsViewport = $0 }
                // Rows come to rest whole under the header, never half cut under it (UI tour run 16,
                // R16-I-07; the web's WB-1). Each group's rows are the resting places (group(_:_:)).
                .scrollTargetBehavior(.viewAligned(limitBehavior: .never))
            }
            .frame(width: cols.total + cols.trailingRoom(visibleWidth: visibleWidth), alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .scrollTargetBehavior(TableColumnSnap(starts: cols.columnStarts, pageWidth: visibleWidth - cols.name))
        .modifier(HorizontalOffsetTracker(offsetX: $stickyX))
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        // More columns to the right: a "›" in the header row (UI tour run 9, I5; run 17, R17-I-02 / R17-B-09).
        .overlay(alignment: .topTrailing) {
            // Whole columns only, so the cue for more is a "›" in the header row.
            if cols.total + cols.trailingRoom(visibleWidth: visibleWidth) - visibleWidth > stickyX + 1 {
                // iPad / Mac: the "›" heads a plain strip as tall as the table that covers whatever part of the
                // next column the viewport cuts, so no sliver of digits ("4", "1(9)") or a cut "On F" status
                // shows at the right edge, on the first page or after a swipe (UI tour run 19, Mac R19-M-02).
                let cut = compact ? 22 : partialWidth(cols, visibleWidth: visibleWidth)
                VStack(spacing: 0) {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: max(22, cut), height: 40)
                    if !compact { Spacer(minLength: 0) }
                }
                .frame(width: max(22, cut))
                .frame(maxHeight: compact ? 40 : .infinity, alignment: .top)
                .background(NX.card.opacity(compact ? 0.9 : 1))
                .overlay(alignment: .leading) { if !compact { Rectangle().fill(NX.border).frame(width: 1) } }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }

    /// How much of the viewport's right edge shows a column only in part (at least the 22 pt of the "›").
    private func partialWidth(_ cols: TableColumns, visibleWidth: CGFloat) -> CGFloat {
        let right = stickyX + visibleWidth
        let ends = cols.columnStarts.map { cols.name + $0 }
        let lastWhole = ends.last { $0 <= right - 22 + 0.5 } ?? (right - 22)
        return max(22, right - lastWhole)
    }

    // MARK: groups

    private func group(_ lane: ProjectDetail.Lane, _ cols: TableColumns) -> some View {
        let isCollapsed = collapsed.contains(lane.id)
        let tasks = lane.tasks ?? []
        let limit = shown[lane.id] ?? 40
        return VStack(alignment: .leading, spacing: 0) {
            groupHeader(lane, count: tasks.count, collapsed: isCollapsed)
                .modifier(TableRowTop(key: "g:\(lane.id)", tops: $rowTops))
            if !isCollapsed {
                TableHeaderRow(cols: cols, fields: fields, nameFields: nameFields, stickyX: stickyX)
                let order: () -> [String] = { tasks.map(\.id) }
                ForEach(Array(tasks.prefix(limit))) { t in
                    row(t, laneId: lane.id, cols: cols, order: order)
                        .modifier(TableRowTop(key: "t:\(t.id)", tops: $rowTops))
                }
                if tasks.count > limit {
                    let more = min(25, tasks.count - limit)
                    Button { shown[lane.id] = limit + 25 } label: {
                        Text(String(format: T("Show %d more"), more))
                            .font(NXFont.text(14, .medium)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 14)
                            .offset(x: stickyX)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .overlay(alignment: .bottom) { TableHairline() }
                    .modifier(TableRowTop(key: "m:\(lane.id)", tops: $rowTops))
                }
                if onAddTask != nil { newTaskRow(lane.id).modifier(TableRowTop(key: "n:\(lane.id)", tops: $rowTops)) }
            }
        }
        // The header and every row are resting places for the vertical scroll (viewAligned above).
        .scrollTargetLayout()
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
                Image(systemName: "play.fill")
                    .font(.system(size: 9)).foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                    .frame(width: 18)
                if statusOptions && !lane.id.hasPrefix("grp:") {
                    StatusPill(name: lane.name, colorKey: lane.colorKey, size: 14)
                } else {
                    Text(lane.name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                Text(AppNumber.int(count)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).monospacedDigit()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .offset(x: stickyX)
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
            task: t, laneId: laneId, cols: cols, fields: fields, stickyX: stickyX,
            status: statusOf?(t) ?? laneStatus ?? RowStatus.plain(t), statusOptions: statusOptions,
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
            .offset(x: stickyX)
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
                .offset(x: stickyX)
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

/// Reports a horizontal ScrollView's offset, never below 0 (iOS 18; a no-op before).
struct HorizontalOffsetTracker: ViewModifier {
    @Binding var offsetX: CGFloat
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { max(0, $0.contentOffset.x) } action: { _, x in
                if abs(x - offsetX) > 0.5 { offsetX = x }
            }
        } else {
            content
        }
    }
}

/// The frozen Name column's edge while the other columns scroll under it.
struct StickyColumnEdge: View {
    let active: Bool
    var body: some View {
        Rectangle().fill(NX.border).frame(width: 1)
            .shadow(color: .black.opacity(active ? 0.08 : 0), radius: 3, x: 2)
    }
}

/// The Table's 1pt grid line under a row.
/// Reports a resting place's top in the table rows' coordinate space (ProjectTableTab.endRoom); a row that goes
/// away (a group folded) takes its entry with it.
struct TableRowTop: ViewModifier {
    static let space = "tableRows"
    let key: String
    @Binding var tops: [String: CGFloat]
    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(Self.space)).minY } action: { y in
                if abs((tops[key] ?? -1) - y) > 0.5 { tops[key] = y }
            }
            .onDisappear { tops[key] = nil }
    }
}

struct TableHairline: View {
    var body: some View { Rectangle().fill(NX.border).frame(height: 1) }
}

/// The column headers: each property's type icon and name (web PropIcon + label).
struct TableHeaderRow: View {
    let cols: TableColumns
    let fields: [CustomField]
    /// Date fields holding names (cfFieldHoldsNames).
    var nameFields: Set<String> = []
    /// The horizontal scroll: the Name header stays at the leading edge.
    var stickyX: CGFloat = 0

    var body: some View {
        HStack(spacing: 0) {
            // The web's "T" text-field icon, not Notion's "Aa" (parity outranks Notion; UI tour run 19, R19-I-18).
            // The web's "T" text glyph (UI tour run 20, R20-I-04 / R20-B-11; it was "Aa", then "A").
            cell(T("Name"), icon: TextPropertyGlyph.symbol, width: cols.name, first: true)
                .accessibilityElement(children: .combine).accessibilityIdentifier("table.name.header")
                .background(NX.card)
                .overlay(alignment: .trailing) { StickyColumnEdge(active: stickyX > 0) }
                .offset(x: stickyX)
                .zIndex(1)
            cell(T("Assignee"), icon: "person", width: cols.assignee)
            cell(T("Due date"), icon: "calendar", width: cols.due)
            // The project's fields come right after the dates, as on the web's table (Harga, Request by,
            // Tanggal Penggunaan…, then Priority and Status): an iPad beside the sidebar showed the four
            // built-in columns and never a field (UI tour run 10, IPD-4).
            ForEach(Array(fields.enumerated()), id: \.element.id) { i, f in
                cell(f.name, icon: nameFields.contains(f.id) ? TextPropertyGlyph.symbol : Self.icon(f.type), width: cols.field(i))
            }
            cell(T("Priority"), icon: "flag", width: cols.priority)
            cell(T("Status"), icon: "rectangle.split.3x1", width: cols.status)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card)
        .overlay(alignment: .bottom) { TableHairline() }
    }

    private func cell(_ title: String, icon: String, width: CGFloat, first: Bool = false) -> some View {
        HStack(spacing: 6) {
            TextPropertyGlyph.icon(icon, size: 12)
            // One line: a field's column is as wide as its header (TableColumns.headerWidth), so
            // "Tanggal Penggunaan" neither wraps (UI tour run 14, P-I12) nor cuts (F-06).
            Text(title).font(NXFont.text(13)).lineLimit(1).truncationMode(.tail)
        }
        .foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 12)
        .frame(width: width, height: 44, alignment: .leading)
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
        default: return TextPropertyGlyph.symbol
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
    /// The horizontal scroll: the name cell stays at the leading edge (F-05).
    var stickyX: CGFloat = 0
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
                .background {
                    ZStack {
                        NX.card
                        if selecting && selected { NX.violet.opacity(0.10) }
                    }
                }
                .overlay(alignment: .trailing) { StickyColumnEdge(active: stickyX > 0) }
                .offset(x: stickyX)
                .zIndex(1)
            assigneeCell.modifier(TableCell(width: cols.assignee, height: rowH))
            dueCell.modifier(TableCell(width: cols.due, height: rowH))
            ForEach(Array(fields.enumerated()), id: \.element.id) { i, f in
                fieldCell(f).modifier(TableCell(width: cols.field(i), height: rowH))
            }
            priorityCell.modifier(TableCell(width: cols.priority, height: rowH))
            statusCell.modifier(TableCell(width: cols.status, height: rowH))
        }
        // Every cell as tall as the row's tallest (a wrapped name).
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
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
                // The whole name, wrapped, as the web's Table: two lines and "…" cut "FEE HOSTING PR NADIA RAHMA
                // - 22…" (UI tour run 19, R19-I-18). The row grows with it.
                Text(UntitledText.wrapped(task.title))
                    .font(NXFont.text(15, .medium))
                    .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(task.isDone)
                    .lineLimit(cols.name <= 120 ? 2 : nil).truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if task.hasQuest { QuestXPChip(xp: task.questXP) }
                // No "›" in the name: the row's own open column at the end is the one open affordance, as the
                // web's (UI tour run 19, Mac R19-M-06).
                Spacer(minLength: 4)
            }
            .padding(.leading, task.isSubtask ? 26 : 14).padding(.trailing, 10).padding(.vertical, 8)
            .frame(width: cols.name, alignment: .leading)
            .frame(minHeight: rowH, maxHeight: .infinity)
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
                AvatarView(url: a.url, initial: a.initial, size: 26, userId: a.userId, name: a.name)
                    .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
            }
            if task.assigneeAvatars.isEmpty { TableEmptyMark() }
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
            } else {
                // Every empty cell says so the same way, as Assignee does (UI tour run 14, N-15 / P-M9).
                TableEmptyMark()
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
            // No ⌄ beside the pill: the web's cell is the pill alone, and the whole cell is still the menu
            // (UI tour run 16, R16-B-11).
            StatusPill(name: status.name, colorKey: status.colorKey, size: 13).fixedSize()
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

    /// A field's cell. A number is drawn in its field's format, with its bar or ring; money sits on the
    /// right edge of the cell (Notion's number columns), everything else on the left.
    @ViewBuilder private func fieldCell(_ f: CustomField) -> some View {
        let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == f.id })
        if f.type.uppercased() == "NUMBER", let cfv, let chip = customFieldChip(cfv), let num = chip.number {
            Button {
                if selecting, let selection { selection.toggle(task.id) } else { onOpen(task.id) }
            } label: {
                CFNumberValue(text: chip.label, style: num.style, fill: num.fill, font: NXFont.text(14),
                              color: NX.foreground.opacity(0.9), barWidth: nil)
                    .frame(maxWidth: .infinity, maxHeight: .infinity,
                           alignment: num.style.alignsTrailing && num.style.showAs != .bar ? .trailing : .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            openButton { fieldFace(f) }
        }
    }

    /// A field's cell: a select option in its colour (web: the coloured pill, UI tour run 14, P-I12), any
    /// other value as text, and "—" when the task has none.
    @ViewBuilder private func fieldFace(_ f: CustomField) -> some View {
        let text = fieldText(f)
        if text.isEmpty {
            TableEmptyMark()
        } else if let key = fieldColorKey(f) {
            let sw = StatusColor.swatch(key)
            Text(text).font(NXFont.text(13, .medium)).lineLimit(1)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .foregroundStyle(sw.fg).background(sw.bg, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        } else {
            Text(text).font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.9)).lineLimit(1)
        }
    }

    private func fieldColorKey(_ f: CustomField) -> String? {
        guard let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == f.id }) else { return nil }
        return customFieldChip(cfv)?.colorKey
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

/// An empty Table cell: blank, as the web table (decision 21 of run 20, R20-I-26 / WD-7; it was a "—"). VoiceOver
/// still says "Empty".
struct TableEmptyMark: View {
    var body: some View {
        Color.clear.frame(width: 1, height: 14).accessibilityElement().accessibilityLabel(T("Empty"))
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
            // At least the row's height, and as tall as its row: a name may wrap to more lines (R19-I-18).
            .frame(width: width, alignment: .leading)
            .frame(minHeight: height, maxHeight: .infinity)
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
