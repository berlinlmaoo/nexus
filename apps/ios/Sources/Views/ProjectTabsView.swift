import SwiftUI

// MARK: - Tab model

enum ProjectTab: String, CaseIterable, Identifiable {
    // First, so a Pipeline Dashboard opens on it (owner, 9 Oct 2026); no other project shows it.
    case pipeline = "Pipeline"
    // "Table" is the grid of every task with the project's fields as columns; "Spreadsheet" is the
    // project's real spreadsheet (ProjectSheet, native since 13 Oct 2026). Same keys as the web.
    case overview = "Overview", board = "Board", list = "List", table = "Table", sheet = "Spreadsheet", calendar = "Calendar"
    // Sprints was removed (owner, 11 Oct 2026); an old "sprints" key in hiddenTabs is just ignored.
    case timeline = "Timeline", automations = "Automations"
    case pages = "Pages", forms = "Forms", chat = "Chat"
    // Only an Outlet Sales Dashboard shows it (owner, 10 Oct 2026, for the outlet team): the night's report form.
    case reportForm = "Report form"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .pipeline: return "chart.bar.doc.horizontal"
        case .overview: return "square.grid.2x2.fill"
        case .board:    return "rectangle.split.3x1.fill"
        case .list:     return "list.bullet"
        case .table:    return "tablecells"
        case .sheet:    return "tablecells.badge.ellipsis"
        case .calendar: return "calendar"
        // The web's GanttChart lines, as the iPad / Mac tab row draws it (UI tour run 12, IP6: a bar chart).
        case .timeline: return "text.alignleft"
        case .automations: return "bolt.fill"
        case .pages:    return "doc.text.fill"
        case .forms:    return "list.clipboard.fill"
        case .chat:     return "bubble.left.and.bubble.right.fill"
        case .reportForm: return "list.clipboard"
        }
    }
}

extension ProjectDetail {
    var allTasks: [BoardTask] { (taskLists ?? []).flatMap { $0.tasks ?? [] } }
}

// MARK: - shared helpers

enum ProjDate {
    // All cached: building a DateFormatter/Calendar is expensive and these run per card per scroll
    // frame (due labels, day chips). ISO8601DateFormatter + DateFormatter are thread-safe to read.
    static let cal: Calendar = {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Jakarta")!; return c
    }()
    private static let isoFractional: ISO8601DateFormatter = {
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return p
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q
    }()

    static func parse(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return isoFractional.date(from: iso) ?? isoPlain.date(from: iso)
    }
    static func dayLabel(_ d: Date) -> String { fmt("d MMM").string(from: d) }
    static func longLabel(_ d: Date) -> String { fmt("EEEE d MMM yyyy").string(from: d) }

    /// In the UI language (AppDateLocale): this was always id_ID, so an English app read "13 Okt" in
    /// Notifications, Threads and the project screens (UI tour 13 Oct 2026).
    static func fmt(_ p: String) -> DateFormatter { AppDateLocale.formatter(p, timeZone: cal.timeZone) }
}

func humanizeEnum(_ raw: String) -> String {
    raw.split(whereSeparator: { $0 == "_" || $0 == " " })
        .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
        .joined(separator: " ")
}

func prioTone(_ p: String) -> ChipTone {
    TaskPriorityName.tone(p)
}

/// A task's priority as a compact pill (owner, 10 Oct 2026: the NexusChip was too big beside the card
/// title). One size on the board, List, folder and My Tasks rows, like the web's text-[10px] pill.
struct PriorityPill: View {
    let priority: String
    var body: some View {
        let tone = prioTone(priority)
        Text(TaskPriorityName.label(priority))
            .font(NXFont.text(10, .bold)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(tone.fg)
            .background(tone.bg, in: Capsule())
            .fixedSize()
    }
}

/// Compact task row used by List / Calendar / Timeline.
struct ProjectTaskRow: View {
    let task: BoardTask
    let onOpen: (String) -> Void
    /// The List tab passes its project's selection (multi-select + Duplicate); other callers do not.
    var selection: TaskSelection? = nil
    /// The ids of this row's section, top to bottom, for a ⇧-click range (List tab only).
    var order: () -> [String] = { [] }

    private var selecting: Bool { selection?.active ?? false }
    private var selected: Bool { selection?.contains(task.id) ?? false }

    var body: some View {
        if let selection {
            row.contextMenu { TaskSelectionMenuItems(taskId: task.id, selection: selection) }
        } else {
            row
        }
    }

    private var row: some View {
        Button {
            if selecting, let selection { selection.toggle(task.id) } else { onOpen(task.id) }
        } label: {
            HStack(spacing: 10) {
                if selecting { TaskSelectionMark(selected: selected) }
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16)).foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                VStack(alignment: .leading, spacing: 3) {
                    if task.isSubtask { SubtaskBadge(parentTitle: task.parent?.title) }
                    Text(task.title).font(NXFont.text(14, .semibold)).foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                        .strikethrough(task.isDone).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 8) {
                        if let due = ProjDate.parse(task.dueDate) {
                            Label(ProjDate.dayLabel(due), systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        if task.totalSubs > 0 {
                            Label("\(task.doneSubs)/\(task.totalSubs)", systemImage: "checklist").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        if task.hasQuest { QuestXPChip(xp: task.questXP) }
                        if task.commentCount > 0 {
                            Label("\(task.commentCount)", systemImage: "bubble.left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    CFChipRow(values: task.customFieldValues)
                }
                Spacer(minLength: 4)
                if let p = task.priority, p.uppercased() != "NONE" { PriorityPill(priority: p) }
                HStack(spacing: -7) {
                    ForEach(task.assigneeAvatars, id: \.id) { a in
                        AvatarView(url: a.url, initial: a.initial, size: 22, userId: a.userId, name: a.name)
                            .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(selecting && selected ? NX.violet : NX.border, lineWidth: selecting && selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selecting && selected ? .isSelected : [])
        // ⌘-click ticks, ⇧-click ticks the range in this section (iPad keyboard, Mac).
        .taskModifierClicks(task.id, selection: selection, order: order)
    }
}

/// The web's muted hint above a project Calendar or Timeline that shows nothing while its tasks sit
/// elsewhere: "84 tasks have no date — Show them", "22 tasks outside this range — Jump to first"
/// (UI tour run 12, IP5 / IP7 / PD4).
struct ProjectRangeHint: View {
    let icon: String
    let text: String
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                .accessibilityHidden(true)
            // One line of text with the action inline and bold, as the web's "84 tasks have no date — Show
            // them": as two pieces the action wrapped onto a line of its own (UI tour run 16, R16-B-10).
            Button(action: action) {
                (Text(text + " — ").foregroundColor(NX.mutedFg)
                 + Text(actionTitle).fontWeight(.semibold).foregroundColor(NX.foreground))
                    .font(NXFont.text(14))
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(text)
            .accessibilityHint(actionTitle)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct TabEmpty: View {
    let icon: String
    let text: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(NX.mutedFg.opacity(0.5))
            Text(text).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }
}

// The Overview tab lives in ProjectOverviewView.swift (redesigned 11 Oct 2026).

// MARK: - List

struct ListTab: View {
    let lanes: [ProjectDetail.Lane]   // subtasks already merged in (nested under their parent)
    /// The project's custom fields (their order decides the wide List's columns).
    var fields: [CustomField] = []
    let onOpen: (String) -> Void
    var selection: TaskSelection? = nil
    /// Status options (or a grouped view): each group's header is its coloured pill.
    var statusStyle = false
    /// Rows dropped on a group (ids, group id, the row they were dropped on — nil = the group's end).
    /// nil = rows are not draggable.
    var onDrop: (([String], String, String?) -> Void)? = nil
    /// The status option a task sits in (its section), when the project has options; nil = plain status.
    var statusOf: (BoardTask) -> RowStatus? = { _ in nil }
    /// "+ New task" under each group (group id, title → the new task's id); nil below Can edit.
    var onAddTask: ((String, String) async -> String?)? = nil

    var composeLaneId: String? = nil
    var composeRequest: UUID? = nil
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var collapsed: Set<String> = []
    /// iPad / Mac two-line rows: each value column as wide as its widest value, shared by every row.
    @State private var slotWidths = ListSlotWidths()
    /// The List's width: from 760 pt (less the 64 pt of side padding) the rows keep one line (decision 6 of run 20).
    @State private var listWidth: CGFloat = 0

    var body: some View {
        // Computed once per render: every row of the List draws the same columns.
        let columns = hSize == .regular ? columnLayout : ListColumns.Layout()
        return ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(lanes) { lane in
                        group(lane, columns: columns).id(lane.id)
                    }
                }
                .padding(.horizontal, hSize == .regular ? 32 : 14)
                .padding(.vertical, 12)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { listWidth = $0 }
            .onChange(of: composeRequest) { _, request in
                if request != nil, let id = composeLaneId {
                    collapsed.remove(id)
                    withAnimation(.snappy) { scroll.scrollTo(id, anchor: .top) }
                }
            }
            // No view-aligned snapping here: inside a LazyVStack its targets (the rows of groups not laid out yet)
            // were guessed, so a slow drag came to rest ABOVE where it started; the tour's List pages went back up,
            // repeated byte for byte, and never reached the Done rows (UI tour run 18, iPhone R18-I-01, iPad T-2).
            .environment(slotWidths)
        }
    }

    /// Grouped by status (or priority), the group header already says it: the row leaves that chip out
    /// instead of repeating it on every row (UI tour run 11, IP-8).
    private func groupedBy(_ laneId: String) -> (status: Bool, priority: Bool) {
        let groupProp = ViewEngine.groupTarget(laneId)?.prop
        return (groupProp == "status" || (groupProp == nil && statusStyle), groupProp == "priority")
    }

    /// The wide List's columns, the same for every row.
    private var columnLayout: ListColumns.Layout {
        ListColumns.layout(fields: fields, lanes: lanes,
                           // iPad / Mac: every row carries its status pill, as the web List does even inside a
                           // status group (UI tour run 15, Q-IA24).
                           statusShown: hSize == .regular || lanes.contains { !groupedBy($0.id).status },
                           priorityShown: lanes.contains { !groupedBy($0.id).priority })
    }

    private func group(_ lane: ProjectDetail.Lane, columns: ListColumns.Layout) -> some View {
        let isCollapsed = collapsed.contains(lane.id)
        return VStack(alignment: .leading, spacing: 0) {
            ListGroupHeader(lane: lane, statusStyle: statusStyle, collapsed: isCollapsed) {
                withAnimation(.snappy(duration: 0.2)) {
                    if isCollapsed { collapsed.remove(lane.id) } else { collapsed.insert(lane.id) }
                }
            }
            .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.7)).frame(height: 0.5) }
            if !isCollapsed {
                // "+ New task" right under the group's header, as the web List; an empty group shows only that
                // row, no "No tasks" line (UI tour run 19, R19-I-17). Without Add it still says it is empty.
                if let onAddTask {
                    ListNewTaskRow(composeRequest: composeLaneId == lane.id ? composeRequest : nil) { title in await onAddTask(lane.id, title) }
                }
                if (lane.tasks ?? []).isEmpty {
                    if onAddTask == nil {
                        Text(T("No tasks")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg.opacity(0.7))
                            .padding(.horizontal, 8).padding(.vertical, 8)
                    }
                } else {
                    let order = { (lane.tasks ?? []).map(\.id) }
                    ForEach(lane.tasks ?? []) { t in
                        row(t, laneId: lane.id, columns: columns, order: order)
                    }
                }
            }
        }
        .contentShape(Rectangle())
        // A whole group takes a drop (web: drag a row's grip onto another group).
        .dropDestination(for: String.self) { ids, _ in
            guard let onDrop, !ids.isEmpty else { return false }
            onDrop(ids, lane.id, nil)
            return true
        }
    }

    @ViewBuilder private func row(_ t: BoardTask, laneId: String, columns: ListColumns.Layout, order: @escaping () -> [String]) -> some View {
        let by = groupedBy(laneId)
        let base = ListTaskRow(task: t, status: by.status && hSize != .regular ? nil : (statusOf(t) ?? RowStatus.plain(t)), wide: hSize == .regular,
                               columnLayout: columns, hidePriority: by.priority,
                               onOpen: onOpen, selection: selection, order: order)
        if onDrop == nil {
            // Read-only (Can view / Can comment): rows open, nothing drags.
            base
        } else {
            draggableRow(base, t, laneId: laneId)
        }
    }

    private func draggableRow(_ base: ListTaskRow, _ t: BoardTask, laneId: String) -> some View {
        base
            .draggable(t.id)
            // Dropped on a row: just before it (manual order inside the group, or a move to that place).
            .dropDestination(for: String.self) { ids, _ in
                guard let onDrop, !ids.isEmpty, !ids.contains(t.id) else { return false }
                onDrop(ids, laneId, t.id)
                return true
            }
    }
}

// MARK: - Timeline (Gantt: start→due windows per section)
//
// The dev web's TimelineView ($projectId.tsx, owner screenshot 271, Mac parity 13 Oct 2026): a bordered
// card; on the left a frozen table Name | Duration | Progress (bar + %), collapsible group rows with the
// group's duration and progress; on the right a two-level header (months, then weekday letter + date) with
// today in a filled circle and a line down the chart, opening scrolled to around today and filling the
// width. A task without dates has no bar ("No date" in its Duration). Tap a bar or a name to open the task.
//
// Structure: ONE vertical ScrollView holding the frozen left column and a horizontal ScrollView beside it
// (one axis each, non-lazy rows, at most 40 + 25·n per group like the web's Incremental). The first
// position comes from a ScrollViewReader, not from offsets.

struct TimelineTab: View {
    let lanes: [ProjectDetail.Lane]   // merged (incl. subtasks)
    let onOpen: (String) -> Void
    /// The project's DATE fields in field order: where an undated task's marker comes from (decision 5).
    var dateFieldIds: [String] = []

    @Environment(\.horizontalSizeClass) private var hSize
    /// Phone: names shown by default — a task without dates has no bar and is invisible without its name (R-7).
    @State private var showNames = true
    @State private var collapsed: Set<String> = []
    @State private var shown: [String: Int] = [:]
    /// The chart's horizontal scroll (iOS 18): drives the sticky day header above it.
    @State private var offsetX: CGFloat = 0
    /// Bumped by "Jump to first": the chart scrolls to the first bar.
    @State private var jumpToFirst = 0

    /// Taller with Duration / Progress, so a long name wraps to three lines instead of being cut (UI tour run
    /// 15, Q-M17).
    private var rowH: CGFloat { 60 }
    /// A task row as tall as its whole name (decision 7 of run 20, R20-I-20 / R20-B-28: the name wraps, no "…"):
    /// measured on the frozen name column, the chart row beside it follows.
    @State private var lineHeights: [String: CGFloat] = [:]
    private func height(_ line: Line) -> CGFloat { max(rowH, lineHeights[line.id] ?? rowH) }
    private let monthH: CGFloat = 32
    private let dayH: CGFloat = 42
    /// Narrower Duration / Progress on a portrait iPad, so the chart still shows ten days or more (Q-IA27).
    /// 84 on a portrait iPad: at 64 the header read "Durati…" and every undated row "No da…" (UI tour run 16,
    /// R16-I-07 iPad).
    private var durationW: CGFloat { metaCompact ? 84 : 90 }
    private var progressW: CGFloat { metaCompact ? 84 : 150 }
    private static let DAY: TimeInterval = 86400

    private var compact: Bool { hSize != .regular }
    /// The chart's width, for `showMeta`.
    @State private var chartWidth: CGFloat = 0
    /// Duration and Progress columns: a wide screen with room for them beside the chart.
    /// From 600 pt: a portrait iPad gets them too, in narrow columns with 28 pt days (UI tour run 15, Q-IA27:
    /// the iPad Timeline had no Duration or Progress while the web does).
    private var showMeta: Bool { !compact && chartWidth >= 600 }
    private var metaCompact: Bool { showMeta && chartWidth < 900 }
    /// A day's column: about 40 pt, sized so the chart shows whole days. With the scroll resting on day
    /// boundaries (TableColumnSnap), no day is cut at either edge ("2" half cut at the right, bars on
    /// 14 May cut; UI tour run 14, P-I15 / P-M5).
    private var dayW: CGFloat {
        let pad: CGFloat = compact ? 12 : 24
        let w = chartWidth - pad * 2
        let viewport = w - leftWidth(w)
        guard viewport > 80 else { return 40 }
        let target: CGFloat = metaCompact ? 28 : 40
        return viewport / max(1, (viewport / target).rounded())
    }
    private var cal: Calendar { ProjDate.cal }
    private func sod(_ d: Date) -> Date { cal.startOfDay(for: d) }
    private func days(_ a: Date, _ b: Date) -> Int { cal.dateComponents([.day], from: sod(a), to: sod(b)).day ?? 0 }
    private func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d) ?? d.addingTimeInterval(Double(n) * Self.DAY) }

    struct Win { let start: Date; let end: Date }
    /// Port of the web's taskWindow: start → due; one date = a one-day bar on it; no date = no bar
    /// (bughunt C-BUG-17: an undated task drawn from today looked scheduled).
    private func window(_ t: BoardTask) -> Win? {
        var s = ProjDate.parse(t.startDate)
        var e = ProjDate.parse(t.dueDate)
        if s == nil && e == nil { return marker(t) }
        if s == nil { s = e }
        if e == nil { e = s }
        let ss = sod(s!), ee = sod(e!)
        return Win(start: ss, end: ee < ss ? ss : ee)
    }

    /// A task with neither date but a value in a date field (a request's usage date, which List and Board
    /// show) is a one-day marker on that day, not "No date" (web R16-WB-2; UI tour run 16, decision 9).
    /// Date fields that hold names ("Request by") never parse as a date, so they are passed over.
    /// The fields in the project's order, as the web and the Calendar's fallback (UI tour run 17, decision 5).
    private func marker(_ t: BoardTask) -> Win? {
        let values = t.customFieldValues ?? []
        let ordered = dateFieldIds.isEmpty
            ? values.filter { ($0.customField?.type ?? "").uppercased() == "DATE" }
            : dateFieldIds.compactMap { id in values.first { $0.customFieldId == id } }
        for v in ordered {
            guard let d = TaskDates.parse(v.value) else { continue }
            let day = sod(d)
            return Win(start: day, end: day)
        }
        return nil
    }

    struct Row: Identifiable { let id: String; let task: BoardTask; let win: Win? }
    struct Group: Identifiable { let id: String; let name: String; let rows: [Row] }

    /// One line of the chart, the same on both sides so the frozen column and the bars line up.
    enum Line: Identifiable {
        case group(Group)
        case task(Row)
        case more(groupId: String, count: Int)
        /// "No tasks" under an empty, open group (as the List says; UI tour run 14, N-20).
        case empty(groupId: String)
        var id: String {
            switch self {
            case .group(let g): return "g:\(g.id)"
            case .task(let r): return "t:\(r.id)"
            case .more(let g, _): return "m:\(g)"
            case .empty(let g): return "e:\(g)"
            }
        }
    }

    private var groups: [Group] {
        lanes.map { lane in
            let all = (lane.tasks ?? []).map { Row(id: $0.id, task: $0, win: window($0)) }
            // Bars by start date, undated tasks after them (web).
            let dated = all.filter { $0.win != nil }.sorted { $0.win!.start < $1.win!.start }
            return Group(id: lane.id, name: lane.name, rows: dated + all.filter { $0.win == nil })
        }
    }

    private func lines(_ gs: [Group]) -> [Line] {
        var out: [Line] = []
        for g in gs {
            out.append(.group(g))
            guard !collapsed.contains(g.id) else { continue }
            if g.rows.isEmpty { out.append(.empty(groupId: g.id)); continue }
            let limit = shown[g.id] ?? 40
            out.append(contentsOf: g.rows.prefix(limit).map { Line.task($0) })
            if g.rows.count > limit { out.append(.more(groupId: g.id, count: min(25, g.rows.count - limit))) }
        }
        return out
    }

    var body: some View {
        let gs = groups
        if gs.allSatisfy({ $0.rows.isEmpty }) {
            EmptyState(icon: "text.alignleft", title: T("Nothing on the timeline"),
                       subtitle: T("Tasks show here as bars from their start date to their due date."))
        } else {
            GeometryReader { geo in
                let pad: CGFloat = compact ? 12 : 24
                chart(gs, width: geo.size.width - pad * 2)
                    .padding(.horizontal, pad).padding(.vertical, 12)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { chartWidth = $0 }
        }
    }

    // MARK: the chart

    private struct Axis {
        let start: Date
        let days: [Date]
        let todayIndex: Int?
        let months: [(label: String, span: Int)]
    }

    private func axis(_ gs: [Group], chartWidth: CGFloat) -> Axis {
        let today = sod(Date())
        let wins = gs.flatMap { $0.rows.compactMap(\.win) }
        var lo = wins.map(\.start).min() ?? today
        var hi = wins.map(\.end).max() ?? addDays(today, 14)
        if today < lo { lo = today }
        // Two weeks after today (web), so the chart can open with today near its leading edge.
        if addDays(today, 14) > hi { hi = addDays(today, 14) }
        let start = addDays(lo, -2)
        var count = days(start, addDays(hi, 3)) + 1
        // Full width: a short project still fills the card (more days after the last bar).
        count = max(count, Int((chartWidth / dayW).rounded(.up)))
        let list = (0..<count).map { addDays(start, $0) }
        var months: [(label: String, span: Int)] = []
        for d in list {
            let label = AppDateLocale.monthTitle(d)
            if months.last?.label == label { months[months.count - 1].span += 1 } else { months.append((label, 1)) }
        }
        let ti = days(start, today)
        return Axis(start: start, days: list, todayIndex: (0..<count).contains(ti) ? ti : nil, months: months)
    }

    /// The frozen Name (| Duration | Progress) column. Wider than before: the phone's ~150 pt showed about
    /// ten characters of a name (UI tour run 11, IP-14).
    private func leftWidth(_ width: CGFloat) -> CGFloat {
        if compact { return showNames ? 120 : 0 }
        // A regular width too narrow for Duration and Progress (portrait iPad): the name alone, so the chart
        // keeps more than five days (UI tour run 13, I-19).
        // With Duration and Progress the column took 45% and the Mac chart showed 13 days (UI tour run 14, P-M5).
        if metaCompact { return 190 + durationW + progressW }
        return showMeta ? min(520, max(440, width * 0.38)) : min(320, max(220, width * 0.38))
    }

    /// iOS 18 knows the chart's scroll offset, so the day header can sit above the rows and stay put while
    /// they scroll (UI tour run 11, PD-18); iOS 17 keeps the header inside the scroll, as before.
    private var stickyHeader: Bool {
        if #available(iOS 18.0, *) { return true } else { return false }
    }

    /// The day index of the first bar, where "Jump to first" lands.
    private func firstBarIndex(_ gs: [Group], ax: Axis) -> Int? {
        gs.flatMap { $0.rows.compactMap(\.win) }.map(\.start).min().map { days(ax.start, $0) }
    }

    /// How many bars sit outside the days in view, when none is in it (web: "N tasks outside this range").
    /// Only where the chart's scroll offset is known (iOS 18); iOS 17 opens on today and says nothing.
    private func barsOutOfView(_ gs: [Group], ax: Axis, viewport: CGFloat) -> Int? {
        guard stickyHeader, viewport > 0 else { return nil }
        let wins = gs.flatMap { $0.rows.compactMap(\.win) }
        guard !wins.isEmpty else { return nil }
        let inView = wins.contains { w in
            let x0 = CGFloat(days(ax.start, w.start)) * dayW
            let x1 = CGFloat(days(ax.start, w.end)) * dayW + dayW
            return x1 > offsetX && x0 < offsetX + viewport
        }
        return inView ? nil : wins.count
    }

    private func chart(_ gs: [Group], width: CGFloat) -> some View {
        let leftW = leftWidth(width)
        let ax = axis(gs, chartWidth: max(0, width - leftW))
        let outside = barsOutOfView(gs, ax: ax, viewport: width - leftW)
        return VStack(spacing: 8) {
            if compact {
                Toggle(T("Names"), isOn: $showNames).toggleStyle(.button)
                    .font(NXFont.text(12)).frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("timeline.names")
            }
            if let outside {
                ProjectRangeHint(icon: "text.alignleft",
                                 text: outside == 1 ? T("1 task outside this range") : String(format: T("%d tasks outside this range"), outside),
                                 actionTitle: T("Jump to first")) { jumpToFirst += 1 }
            }
            chartCard(gs, ax: ax, leftW: leftW, viewport: width - leftW)
            legend(gs)
        }
    }

    /// What the bar colours mean (the bars are coloured by priority; a lone red bar among blue ones read as
    /// an error; UI tour run 14, P-I15 / P-M13). Only the priorities that have a bar.
    @ViewBuilder private func legend(_ gs: [Group]) -> some View {
        // All four priorities, whichever have a bar in view (decision 8 of run 19: "Low" was missing, R19-I-20).
        let shown = ["URGENT", "HIGH", "MEDIUM", "LOW"]
        if gs.contains(where: { $0.rows.contains { $0.win != nil } }) {
            FlowLayout(spacing: 12) {
                Text(T("Bar color by priority:")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(shown, id: \.self) { p in
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous).fill(Self.barColor(p)).frame(width: 14, height: 8)
                        Text(TaskPriorityName.label(p)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Where the chart opens: on today (web, Notion: today minus three days at the leading edge). When no
    /// bar falls in those days the hint above says "N tasks outside this range — Jump to first". Run 13
    /// (M-24) opened on the first bar instead, so the chart landed months back with no today line and the
    /// hint never showed (UI tour run 14, N-02 / P-I6 / P-M5).
    private func openingDay(ax: Axis) -> Int {
        max(0, (ax.todayIndex ?? 0) - (compact ? 1 : 3))
    }

    private func chartCard(_ gs: [Group], ax: Axis, leftW: CGFloat, viewport: CGFloat) -> some View {
        let ls = lines(gs)
        let sticky = stickyHeader
        return VStack(spacing: 0) {
            if #available(iOS 18.0, *) {
                HStack(alignment: .top, spacing: 0) {
                    if leftW > 0 {
                        leftHeader.frame(width: leftW).accessibilityIdentifier("timeline.name.column")
                            .overlay(alignment: .trailing) { Rectangle().fill(NX.border).frame(width: 1) }
                    }
                    TimelineAxisHeader(offsetX: offsetX, monthLabel: visibleMonth(ax), monthH: monthH) {
                        VStack(alignment: .leading, spacing: 0) {
                            monthRow(ax)
                            dayRow(ax)
                        }
                        .frame(width: CGFloat(ax.days.count) * dayW, alignment: .leading)
                    }
                }
                .frame(height: monthH + dayH)
            }
            ScrollView(.vertical, showsIndicators: true) {
                HStack(alignment: .top, spacing: 0) {
                    if leftW > 0 {
                        leftColumn(ls, width: leftW, header: !sticky).frame(width: leftW)
                            .overlay(alignment: .trailing) { Rectangle().fill(NX.border).frame(width: 1) }
                    }
                    rightPane(ls, ax: ax, header: !sticky, firstBar: firstBarIndex(gs, ax: ax),
                              landing: openingDay(ax: ax), viewport: viewport)
                }
            }
            // Rows come to rest whole under the sticky day header, never half cut under it (UI tour run 16,
            // R16-I-19).
            .scrollTargetBehavior(.viewAligned(limitBehavior: .never))
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }

    /// The month of the first day in view, while that month's own label has scrolled off to the left, and the
    /// room it has before the next month's label. The sticky label stays inside that room (full name, else the
    /// short one, else none), so it hands over to the next month instead of lying on it: "September 2026" sat
    /// on "October 2026" and left a stray "26" (UI tour run 17, R17-M-02).
    private func visibleMonth(_ ax: Axis) -> (label: String, room: CGFloat)? {
        guard !ax.days.isEmpty else { return nil }
        let i = min(ax.days.count - 1, max(0, Int((offsetX + 1) / dayW)))
        let first = ax.days[i]
        guard let monthStart = ax.days.firstIndex(where: { cal.isDate($0, equalTo: first, toGranularity: .month) }),
              CGFloat(monthStart) * dayW < offsetX - 1 else { return nil }
        let next = ax.days[i...].firstIndex { !cal.isDate($0, equalTo: first, toGranularity: .month) } ?? ax.days.count
        let room = CGFloat(next) * dayW - offsetX
        guard room >= 24 else { return nil }
        return (AppDateLocale.monthTitle(first), room)
    }

    // MARK: left: Name | Duration | Progress

    private var leftHeader: some View {
        HStack(spacing: 0) {
            headLabel(T("Name")).padding(.leading, compact ? 12 : 16).frame(maxWidth: .infinity, alignment: .bottomLeading)
            if showMeta {
                headLabel(T("Duration")).padding(.horizontal, 8).frame(width: durationW, alignment: .bottomLeading)
                headLabel(T("Progress")).padding(.horizontal, 12).frame(width: progressW, alignment: .bottomLeading)
                    .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1) }
            }
        }
        .frame(height: monthH + dayH)
        .overlay(alignment: .bottom) { TableHairline() }
    }

    private func leftColumn(_ ls: [Line], width: CGFloat, header: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if header { leftHeader }
            ForEach(ls) { line in leftLine(line) }
        }
        // Every line is a resting place for the vertical scroll (chartCard).
        .scrollTargetLayout()
    }

    private func headLabel(_ s: String) -> some View {
        Text(s).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1).padding(.bottom, 9)
            .frame(maxHeight: .infinity, alignment: .bottom)
    }

    @ViewBuilder private func leftLine(_ line: Line) -> some View {
        switch line {
        case .group(let g): leftGroup(g)
        case .task(let r): leftTask(r)
        case .more(let gid, let n): moreButton(gid, n)
        case .empty:
            Text(T("No tasks")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                .padding(.leading, compact ? 12 : 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: rowH)
                .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
        }
    }

    private func leftGroup(_ g: Group) -> some View {
        let isCollapsed = collapsed.contains(g.id)
        let wins = g.rows.compactMap(\.win)
        let gDur: Int = {
            guard let s = wins.map(\.start).min(), let e = wins.map(\.end).max() else { return 0 }
            return days(s, e) + 1
        }()
        // The mean over the tasks whose progress is measured (web tlProgress); none = "—". A task in progress
        // has no measured progress: no status-derived 50% (UI tour run 19, R19-B-01, decision 8).
        let measured = g.rows.compactMap { progress(of: $0.task) }
        let pct: Int? = measured.isEmpty ? nil : Int((Double(measured.reduce(0, +)) / Double(measured.count)).rounded())
        return HStack(spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.2)) {
                    if isCollapsed { collapsed.remove(g.id) } else { collapsed.insert(g.id) }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(g.name).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        // Without the Duration and Progress columns the group still says its span and
                        // progress, "23 days · 100%" (web; UI tour run 14, P-I6 / N-02).
                        if !showMeta, gDur > 0, let pct {
                            Text("\(Self.dayCount(gDur)) · \(pct)%").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                .monospacedDigit().lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isCollapsed ? T("Collapsed") : T("Expanded"))
            if showMeta {
                Text(gDur > 0 ? Self.dayCount(gDur) : "—").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.85)
                    .padding(.horizontal, 8).frame(width: durationW, alignment: .leading)
                // The rows' status colours (amber in progress, green done), as web — not a fixed blue; the
                // track is the card colour, since the group row itself is muted (UI tour run 9, P10/M4).
                progressCell(pct, tint: pct.map(Self.progressTint) ?? NX.muted, track: NX.card)
            }
        }
        .frame(height: rowH)
        .background(NX.muted)
        .overlay(alignment: .bottom) { TableHairline() }
    }

    private func leftTask(_ r: Row) -> some View {
        let t = r.task
        let pct = progress(of: t)
        return HStack(spacing: 0) {
            Button { onOpen(t.id) } label: {
                HStack(spacing: 8) {
                    Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 16)).foregroundStyle(t.isDone ? NX.success : NX.mutedFg.opacity(0.45))   // green like List and Board (run 15, Q-M17)
                    if t.isSubtask {
                        Image(systemName: "arrow.turn.down.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        // With Duration / Progress beside it (no dates line under the name) a long name takes
                        // two lines before an ellipsis ("reimburse transport t…", UI tour run 14, P-M13).
                        // Two lines then "…" on every width, the dash kept with the word before it (decision 14 of
                        // run 17): one line on a phone cut nearly every name ("reimburse transport…", iPhone
                        // R17-I-08), and "Gaji Clippers / –Cymenggs" broke before its dash (iPad R17-I-12).
                        // The whole name, wrapped, as the web (decision 7 of run 20, R20-I-20 / R20-B-28): two lines and
                        // "…" cut "FEE HOSTING PR NADIA RAHMA - 22 A…"; the row grows instead.
                        // The phone's ~120 pt column (Q-1, Berlin 20 Oct: not wider): a smaller name, two lines,
                        // and a size its longest word fits, so "REIMBURSE" never breaks into "REIMBURS / E".
                        Text(UntitledText.wrapped(t.title))
                            .font(NXFont.text(compact ? Self.phoneNameSize(t.title, subtask: t.isSubtask) : showMeta ? 13 : 14, .medium))
                            .foregroundStyle(t.isDone ? NX.mutedFg : NX.foreground)
                            .strikethrough(t.isDone)
                            .lineLimit(compact ? 2 : nil).truncationMode(.tail)
                            .fixedSize(horizontal: false, vertical: true)
                        // The phone has no Duration column: the dates under the name, so a row whose bar
                        // is out of view still says when it is (UI tour run 13, F-09).
                        if !compact && !showMeta {
                            Text(r.win.map(Self.spanLabel) ?? T("No date"))
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, compact ? 12 : 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            if showMeta {
                Text(r.win.map { Self.dayCount(days($0.start, $0.end) + 1) } ?? T("No date"))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    .padding(.horizontal, 8).frame(width: durationW, alignment: .leading)
                progressCell(pct, tint: pct.map(Self.progressTint) ?? NX.muted)
            }
        }
        .frame(minHeight: rowH)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { h in
            let id = Line.task(r).id
            if abs((lineHeights[id] ?? 0) - h) > 0.5 { lineHeights[id] = h }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
    }

    /// nil = no bar, no progress: "—" (web).
    private func progressCell(_ pct: Int?, tint: Color, track: Color = NX.muted) -> some View {
        // The bar only where it has room to read as one: on a portrait iPad's narrow column it was a ~12 pt stub
        // that looked like a dot (UI tour run 17, iPad R17-I-12); the percentage alone then.
        let barRoom = progressW - 24 - 8 - 40
        return HStack(spacing: 8) {
            if let pct, barRoom < 28 {
                Text("\(pct)%").font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                Spacer(minLength: 0)
            } else if let pct {
                Capsule().fill(track)
                    .frame(height: 6)
                    .overlay(alignment: .leading) {
                        // A fraction of the track, by layout (no measured offsets).
                        GeometryReader { g in Capsule().fill(tint).frame(width: g.size.width * CGFloat(pct) / 100) }
                    }
                Text("\(pct)%").font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                    .frame(width: 40, alignment: .trailing)
            } else {
                Text("—").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 12)
        .frame(width: progressW)
        .frame(maxHeight: .infinity)
        .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1) }
    }

    private func moreButton(_ gid: String, _ n: Int) -> some View {
        Button { shown[gid] = (shown[gid] ?? 40) + 25 } label: {
            Text(String(format: T("Show %d more"), n)).font(NXFont.text(14, .medium)).foregroundStyle(NX.mutedFg)
                .padding(.leading, 14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(height: 40)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
    }

    // MARK: right: the axis and the bars

    private func rightPane(_ ls: [Line], ax: Axis, header: Bool, firstBar: Int?, landing: Int, viewport: CGFloat) -> some View {
        let timelineW = CGFloat(ax.days.count) * dayW
        let todayX: CGFloat? = ax.todayIndex.map { CGFloat($0) * dayW + dayW / 2 }
        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    if header {
                        monthRow(ax)
                        dayRow(ax)
                    } else {
                        // The day header sits above the scroll (sticky); these zero-height markers keep the
                        // "day-i" ids the landing scroll aims at.
                        HStack(spacing: 0) {
                            ForEach(ax.days.indices, id: \.self) { i in
                                Color.clear.frame(width: dayW, height: 0).id("day-\(i)")
                            }
                        }
                    }
                    ForEach(ls) { line in rightLine(line, ax: ax, todayX: todayX) }
                }
                .frame(width: timelineW, alignment: .leading)
                .overlay(alignment: .topLeading) {
                    if let todayX {
                        Rectangle().fill(NX.violet.opacity(0.65)).frame(width: 1)
                            .frame(maxHeight: .infinity)
                            .padding(.top, header ? monthH + dayH : 0)
                            .padding(.leading, todayX)
                            .allowsHitTesting(false)
                    }
                }
            }
            // Comes to rest on a day's edge, so the first and last days in view are whole.
            .scrollTargetBehavior(TableColumnSnap(starts: ax.days.indices.map { CGFloat($0) * dayW }))
            .modifier(TimelineOffsetTracker(offsetX: $offsetX))
            // A row whose bar lies outside the days in view points to it (Notion's arrows; UI tour run 14,
            // P-M5: those rows were blank). Only where the scroll offset is known (iOS 18).
            .overlay(alignment: .topLeading) {
                if stickyHeader && viewport > 0 {
                    VStack(spacing: 0) {
                        if header { Color.clear.frame(height: monthH + dayH).allowsHitTesting(false) }
                        ForEach(ls) { line in
                            offRangeArrow(line, ax: ax, viewport: viewport) { day in
                                withAnimation(.snappy) { proxy.scrollTo("day-\(max(0, day - 2))", anchor: .leading) }
                            }
                        }
                    }
                }
            }
            // Opens around today (web: today minus three days at the left edge), or at the first bar.
            .onAppear { DispatchQueue.main.async { proxy.scrollTo("day-\(landing)", anchor: .leading) } }
            // "Jump to first": two days before the first bar at the leading edge (web jumpToFirst).
            .onChange(of: jumpToFirst) { _, _ in
                guard let firstBar else { return }
                withAnimation(.snappy) { proxy.scrollTo("day-\(max(0, firstBar - 2))", anchor: .leading) }
            }
        }
    }

    /// The arrow at the edge of a row whose bar is out of view; a tap scrolls to the bar.
    @ViewBuilder private func offRangeArrow(_ line: Line, ax: Axis, viewport: CGFloat, go: @escaping (Int) -> Void) -> some View {
        switch line {
        case .task(let r):
            if let w = r.win {
                let a = days(ax.start, w.start)
                let x0 = CGFloat(a) * dayW
                let x1 = CGFloat(days(ax.start, w.end) + 1) * dayW
                let before = x1 <= offsetX + 1
                let after = x0 >= offsetX + viewport - 1
                HStack(spacing: 0) {
                    if before { arrowButton(before: true, r, w) { go(a) } }
                    Spacer(minLength: 0).allowsHitTesting(false)
                    if after { arrowButton(before: false, r, w) { go(a) } }
                }
                .padding(.horizontal, 6)
                .frame(height: height(line))
            } else {
                Color.clear.frame(height: height(line)).allowsHitTesting(false)
            }
        case .group, .empty:
            Color.clear.frame(height: rowH).allowsHitTesting(false)
        case .more:
            Color.clear.frame(height: 40).allowsHitTesting(false)
        }
    }

    /// The web's dated pill, "‹ 4 Jul" before the range and "12 Nov ›" after it, not a bare arrow that said
    /// nothing about when (UI tour run 19, R19-I-20 / R19-B-01, decision 8).
    private func arrowButton(before: Bool, _ r: Row, _ w: Win, action: @escaping () -> Void) -> some View {
        let tz = ProjDate.cal.timeZone
        let day = AppDateLocale.shortDate(before ? w.end : w.start, timeZone: tz)
        return Button(action: action) {
            HStack(spacing: 4) {
                if before { Image(systemName: "chevron.left").font(.system(size: 9, weight: .bold)) }
                Text(day).font(NXFont.text(11, .medium)).lineLimit(1).fixedSize()
                if !before { Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)) }
            }
            .foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 7).frame(height: 22)
            // Opaque, so the today line passes under the pill, not through it (UI tour run 20, R20-I-09).
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(NX.card)
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(NX.muted)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .help("\(r.task.title) · \(Self.spanLabel(w))")
        .accessibilityLabel("\(r.task.title), \(Self.spanLabel(w))")
    }

    private func monthRow(_ ax: Axis) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(ax.months.enumerated()), id: \.offset) { _, m in
                // The month, else its short name, else nothing: a two-day segment at the edge read "No…"
                // (UI tour run 15, Q-IA30 / Q-M17).
                // A one-day segment at the chart's end still names its month, a size smaller ("Nov" above
                // "S 1" was missing on a portrait iPad's 28 pt days; UI tour run 16, R16-I-23).
                ViewThatFits(in: .horizontal) {
                    Text(m.label).fixedSize()
                    Text(String(m.label.prefix(3))).fixedSize()
                    Text(String(m.label.prefix(3))).lineLimit(1).minimumScaleFactor(0.6)
                }
                .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground.opacity(0.75))
                    .padding(.leading, m.span <= 1 ? 3 : 8)
                    .frame(width: CGFloat(m.span) * dayW, height: monthH, alignment: .leading)
                    .clipped()
                    .overlay(alignment: .leading) { Rectangle().fill(NX.border.opacity(0.6)).frame(width: 1) }
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
    }

    private func dayRow(_ ax: Axis) -> some View {
        let wf = ProjLocaleDate.fmt(AppLanguage.shared.lang == .id ? "EEE" : "EEEEE")
        return HStack(spacing: 0) {
            ForEach(Array(ax.days.enumerated()), id: \.offset) { i, d in
                let isToday = i == ax.todayIndex
                let wd = cal.component(.weekday, from: d)
                VStack(spacing: 3) {
                    Text(wf.string(from: d)).font(NXFont.text(10, .semibold))
                        .foregroundStyle(isToday ? NX.foreground : NX.mutedFg.opacity(0.8)).lineLimit(1)
                    Text("\(cal.component(.day, from: d))").font(NXFont.text(isToday ? 11 : 12, .bold))
                        .foregroundStyle(isToday ? NX.background : NX.foreground.opacity(0.8))
                        .frame(width: 22, height: 22)
                        .background(isToday ? NX.violet : Color.clear, in: Circle())
                }
                .frame(width: dayW, height: dayH)
                .background((wd == 1 || wd == 7) ? NX.muted.opacity(0.5) : Color.clear)
                .overlay(alignment: .leading) { Rectangle().fill(NX.border.opacity(0.5)).frame(width: 1) }
                .id("day-\(i)")
            }
        }
        .overlay(alignment: .bottom) { TableHairline() }
    }

    @ViewBuilder private func rightLine(_ line: Line, ax: Axis, todayX: CGFloat?) -> some View {
        switch line {
        case .group:
            // A band only: the group's name sat inside the chart as a stray "Done" (UI tour run 14, P-I15 /
            // P-M13); the frozen column names it.
            NX.muted.opacity(0.5)
                .frame(height: rowH)
                .overlay(alignment: .bottom) { TableHairline() }
        case .task(let r):
            ZStack(alignment: .leading) {
                Color.clear
                if let w = r.win {
                    bar(r, w, ax: ax)
                }
            }
            .frame(height: height(line))
            .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
        case .more:
            Color.clear.frame(height: 40)
                .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
        case .empty:
            Color.clear.frame(height: rowH)
                .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 0.5) }
        }
    }

    private func bar(_ r: Row, _ w: Win, ax: Axis) -> some View {
        let x = CGFloat(days(ax.start, w.start)) * dayW
        let span = CGFloat(days(w.start, w.end) + 1) * dayW
        let fmt = ProjLocaleDate.fmt("d MMM")
        // A bar of one or two days has no room for its title: the title follows it, outside (Notion; the
        // phone showed bare check squares; UI tour run 14, N-20).
        let inside = span >= dayW * 3
        return Button { onOpen(r.task.id) } label: {
            HStack(spacing: 6) {
                HStack(spacing: 5) {
                    if r.task.isDone { Image(systemName: "checkmark").font(.system(size: 10, weight: .black)) }
                    if inside { Text(r.task.title).font(NXFont.text(12, .semibold)).lineLimit(1) }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .frame(width: max(span - 4, dayW * 0.8), height: 32, alignment: .leading)
                .background(Self.barColor(r.task.priority), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                if !inside {
                    Text(r.task.title).font(NXFont.text(12, .medium)).foregroundStyle(NX.foreground.opacity(0.85))
                        .lineLimit(1).fixedSize()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .help("\(r.task.title) · \(fmt.string(from: w.start)) → \(fmt.string(from: w.end))")
        .padding(.leading, x + 2)
    }

    // MARK: web rules

    /// The web's tlProgress: the share of a task's subtasks that are done, else nil ("—": not measured). The app
    /// used to derive 50% from In Progress and 75% from In Review, numbers nobody entered (UI tour run 19,
    /// R19-B-01, decision 8), and still 100% from Done, where web shows "—" too (run 20, R20-B-01).
    private func progress(of t: BoardTask) -> Int? {
        if let c = subtaskTally[t.id], c.total > 0 { return Int((Double(c.done) * 100 / Double(c.total)).rounded()) }
        return nil
    }

    /// Done / all subtasks per parent task id, over every lane (the lanes include the subtasks).
    private var subtaskTally: [String: (done: Int, total: Int)] {
        var out: [String: (done: Int, total: Int)] = [:]
        for t in lanes.flatMap({ $0.tasks ?? [] }) {
            guard let p = t.parentId, !p.isEmpty else { continue }
            var c = out[p] ?? (0, 0)
            c.total += 1
            if t.isDone { c.done += 1 }
            out[p] = c
        }
        return out
    }

    /// pctTone.
    static func progressTint(_ pct: Int) -> Color {
        if pct >= 100 { return Color(hex: "#10b981") }
        if pct >= 70 { return Color(hex: "#14b8a6") }
        if pct >= 40 { return Color(hex: "#f59e0b") }
        if pct > 0 { return Color(hex: "#f43f5e") }
        return NX.mutedFg.opacity(0.3)
    }

    /// GANTT_BAR: the bar's colour by priority.
    static func barColor(_ p: String?) -> Color { TaskPriorityName.color(p) }

    /// "3 Sep", or "3 Sep → 5 Sep" (the year only outside the current one).
    static func spanLabel(_ w: Win) -> String {
        let tz = ProjDate.cal.timeZone
        let a = AppDateLocale.shortDate(w.start, timeZone: tz), b = AppDateLocale.shortDate(w.end, timeZone: tz)
        return a == b ? a : "\(a) → \(b)"
    }

    static func dayCount(_ n: Int) -> String { n == 1 ? T("1 day") : String(format: T("%d days"), n) }

    /// The phone name's size: 12 pt, smaller (down to 9 pt) only while its longest word is wider than the
    /// text's room in the 120 pt column (the check circle, the subtask arrow and the paddings taken off).
    static func phoneNameSize(_ title: String, subtask: Bool) -> CGFloat {
        let room: CGFloat = 120 - 12 - 18 - 8 - 4 - (subtask ? 19 : 0)
        let words = UntitledText.wrapped(title).split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
        var size: CGFloat = 12
        while size > 9 {
            let desc = UIFontDescriptor(name: "Inter", size: size)
                .addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.medium]])
            let font = UIFont(descriptor: desc, size: size)
            let widest = words.map { (String($0) as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
            if widest <= room { break }
            size -= 0.5
        }
        return size
    }
}

/// Reports a horizontal ScrollView's offset (iOS 18; a no-op before).
private struct TimelineOffsetTracker: ViewModifier {
    @Binding var offsetX: CGFloat
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in
                if abs(x - offsetX) > 0.5 { offsetX = x }
            }
        } else {
            content
        }
    }
}

/// The timeline's month + day header, above the rows so it stays while they scroll vertically. It follows
/// the chart's horizontal scroll (it is not scrolled by hand), and when the first month's own label has
/// scrolled off to the left, that month is named at the leading edge (UI tour run 11, PD-18).
@available(iOS 18.0, *)
private struct TimelineAxisHeader<Content: View>: View {
    let offsetX: CGFloat
    let monthLabel: (label: String, room: CGFloat)?
    let monthH: CGFloat
    @ViewBuilder let content: Content
    @State private var position = ScrollPosition(edge: .leading)

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) { content }
            .scrollPosition($position)
            .scrollDisabled(true)
            .onChange(of: offsetX, initial: true) { _, x in position.scrollTo(x: x) }
            .overlay(alignment: .topLeading) {
                if let monthLabel {
                    ViewThatFits(in: .horizontal) {
                        Text(monthLabel.label).fixedSize()
                        Text(String(monthLabel.label.prefix(3))).fixedSize()
                        Color.clear.frame(width: 0)
                    }
                    .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground.opacity(0.75)).lineLimit(1)
                    .padding(.horizontal, 8)
                    .frame(maxWidth: monthLabel.room, alignment: .leading)
                    .frame(height: monthH - 1)
                    .background(NX.card)
                    .clipped()
                    .allowsHitTesting(false)
                }
            }
    }
}

// MARK: - Calendar

/// One "Plot by" option: nil id = the due date, else a DATE custom field.
struct CalendarPlotChoice: Hashable, Identifiable {
    let id: String?
    let name: String
}

struct CalendarTab: View {
    let tasks: [BoardTask]   // full set incl. merged subtasks, so dated subtasks land on the calendar too
    let onOpen: (String) -> Void
    var onCreate: (Date?) -> Void = { _ in }
    /// False for Can view / Can comment (access levels round 2): no "Add task" on a date.
    var canCreate = true
    /// Plot by (12 Oct 2026): nil = the due date, else the id of a DATE custom field.
    var dateFieldId: String? = nil
    /// Empty = the project has no DATE field, so there is nothing to choose and no menu.
    var plotChoices: [CalendarPlotChoice] = []
    var onPlotBy: ((String?) -> Void)? = nil
    /// The project's DATE fields in field order: the last part of the fallback order (decision 5).
    var dateFieldIds: [String] = []
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var monthOffset = 0
    @State private var selected: Int?
    /// The "No date" box lists its first chips only until asked (UI tour run 13, I-20: 84 chips filled the page).
    @State private var allUndated = false
    /// An empty month: the one-line hint opens the "No date" box (UI tour run 15, Q-IA28 / Q-M16: a 12-chip
    /// cloud ~300 pt tall pushed the month below the fold; the web says it in one line).
    private static let undatedPreview = 12

    private var cal: Calendar { ProjDate.cal }
    private var monthDate: Date { cal.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date() }
    private var comps: DateComponents { cal.dateComponents([.year, .month], from: monthDate) }
    private func dateFor(_ day: Int) -> Date? { var c = comps; c.day = day; return cal.date(from: c) }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthDate)?.count ?? 30 }
    private var leadingBlanks: Int {
        let first = cal.date(from: comps) ?? monthDate
        return (cal.component(.weekday, from: first) + 5) % 7   // Monday = 0
    }
    private var tasksByDay: [Int: [BoardTask]] {
        var map: [Int: [BoardTask]] = [:]
        for t in tasks {
            guard let d = plotDate(t) else { continue }
            let c = cal.dateComponents([.year, .month, .day], from: d)
            if c.year == comps.year, c.month == comps.month, let day = c.day { map[day, default: []].append(t) }
        }
        return map
    }

    /// The day a task lands on: its due date, or the picked DATE field's value ("2026-10-12" or ISO).
    ///
    /// A task without that date lands on the first date it does have, in the order the Timeline uses: due, start,
    /// then the project's DATE fields in field order (never a CREATED field such as "Request by"). So the Calendar
    /// and the Timeline agree on which tasks are dated, and "n tasks have no date" counts only tasks with no date
    /// at all (UI tour run 17, web R17-WB-2, decision 5).
    private func plotDate(_ t: BoardTask) -> Date? {
        if let own = ownDate(t) { return own }
        if dateFieldId != nil, let d = ProjDate.parse(t.dueDate) { return d }
        if let d = ProjDate.parse(t.startDate) { return d }
        for id in dateFieldIds where id != dateFieldId {
            if let d = TaskDates.parse(t.customFieldValues?.first(where: { $0.customFieldId == id })?.value) { return d }
        }
        return nil
    }

    /// The view's own date: the due date, or the picked DATE field's value ("2026-10-12" or ISO).
    private func ownDate(_ t: BoardTask) -> Date? {
        guard let fid = dateFieldId else { return ProjDate.parse(t.dueDate) }
        return TaskDates.parse(t.customFieldValues?.first(where: { $0.customFieldId == fid })?.value)
    }

    private var plotName: String {
        plotChoices.first { $0.id == dateFieldId }?.name ?? T("Due date")
    }

    /// Tasks with no date to plot by: listed under the month, as the web's "No date · n" box.
    private var undated: [BoardTask] { tasks.filter { plotDate($0) == nil } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
                    header
                    // An empty month says why when the tasks are waiting for a date (UI tour run 12, IP5): the
                    // "No date" box itself comes up here, titled "84 tasks have no date". A banner saying so
                    // above the month AND the box under it said the same thing twice (UI tour run 14,
                    // P-I14 / P-M12).
                    let rest = undated
                    let emptyMonth = tasksByDay.isEmpty && !rest.isEmpty
                    if emptyMonth {
                        HStack {
                            Text(rest.count == 1 ? T("1 task has no date") : String(format: T("%d tasks have no date"), rest.count))
                                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            Spacer(minLength: 8)
                            Button(T("Show them")) { withAnimation { proxy.scrollTo("undated", anchor: .top) } }
                                .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        }
                    }
                    // One month-grid style everywhere (NXMonthGrid.swift; UI tour run 16, R16-I-06). On iPad / Mac
                    // the picked day's panel sits beside the month, as the web's: under it, the Mac's panel
                    // was below the fold (UI tour run 16, R16-M-08).
                    if wideGrid {
                        HStack(alignment: .top, spacing: 16) {
                            monthCard
                            dayPanel.frame(width: 260)
                        }
                    } else {
                        monthCard
                        dayPanel
                    }
                    if !rest.isEmpty { undatedBox(rest, leading: false).id("undated") }
                }
                // iPad / Mac: the page's 24 pt gutter, the header's and the tabs', not 16 (UI tour run 19, Mac R19-M-09).
                .padding(.vertical, 16).padding(.horizontal, hSize == .regular ? 24 : 16)
            }
        }
        // Today's day is picked on the current month, so the panel under the grid says what today holds,
        // as the web's (UI tour run 15, Q-IA26).
        .onAppear { if selected == nil, monthOffset == 0 { selected = todayDay } }
        .onChange(of: monthOffset) { _, offset in if offset == 0 { selected = todayDay } }
    }

    private var monthCard: some View {
        VStack(spacing: 0) {
            weekdayRow
            grid
        }
        .nxMonthGridCard()
    }

    /// The picked day: its tasks, or the web's words for an empty day in a dashed box, and "+ New task".
    @ViewBuilder private var dayPanel: some View {
        if let sel = selected {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    // "Thursday 15 Oct", as the web's day panel (UI tour run 15, Q-IA26).
                    Text(dateFor(sel).map { AppDateLocale.weekdayDate($0, timeZone: cal.timeZone) } ?? "\(sel)")
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Spacer()
                    if canCreate {
                        Button { onCreate(dateFor(sel)) } label: {
                            Label(T("New task"), systemImage: "plus").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if let items = tasksByDay[sel], !items.isEmpty {
                    ForEach(items) { ProjectTaskRow(task: $0, onOpen: onOpen) }
                } else {
                    // The web's sentences (UI tour run 16, R16-B-09).
                    Text(tasksByDay.isEmpty ? T("Nothing on this day, nor anywhere else this month.")
                         : wideGrid ? PlatformWording.tapOrClick(tap: "Nothing on this day. Tap another day to see its tasks.",
                                                                 click: "Nothing on this day. Click another day to see its tasks.")
                         : T("Nothing on this day. Days with a dot have tasks."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 14).padding(.vertical, 18)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
            }
        } else {
            // No "+" is on screen until a date is picked (its "New task" comes with it): the hint said
            // "click + to create one" with no + in sight (UI tour run 14, P-M12).
            Text(canCreate ? T("Pick a date to see its tasks and add one there.") : T("Pick a date to see its tasks."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.top, 4)
        }
    }

    /// Web: a dashed box under the month, "No date · 3", the tasks as small chips that open them.
    /// `leading`: the month has nothing dated, so the box opens the page and says why.
    private func undatedBox(_ items: [BoardTask], leading: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if leading {
                Label(items.count == 1 ? T("1 task has no date") : String(format: T("%d tasks have no date"), items.count),
                      systemImage: "calendar.badge.exclamationmark")
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else {
                Text(String(format: T("No date · %d"), items.count))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            let shown = allUndated ? items : Array(items.prefix(Self.undatedPreview))
            FlowLayout(spacing: 6) {
                ForEach(shown) { t in
                    Button { onOpen(t.id) } label: {
                        Text(t.title).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                            .frame(maxWidth: 220, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(NX.border))
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            if items.count > Self.undatedPreview {
                Button { withAnimation(.snappy) { allUndated.toggle() } } label: {
                    Text(allUndated ? T("Show fewer") : String(format: T("Show all %d"), items.count))
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        .frame(minHeight: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    /// Web: the month on the left, then Today · ‹ · ›.
    private var header: some View {
        HStack(spacing: 2) {
            Text(AppDateLocale.monthTitle(monthDate)).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                .lineLimit(1)
            // "Plot by" rides in the month's row, a quiet menu: a purple chip on a row of its own added a
            // ~60 pt band (UI tour run 16, R16-B-09).
            plotByMenu.padding(.leading, 10)
            Spacer(minLength: 8)
            Button { monthOffset = 0; selected = todayDay } label: {
                Text(T("Today")).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                    .padding(.horizontal, 10).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            Button { monthOffset -= 1; selected = nil } label: {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(T("Previous month"))
            Button { monthOffset += 1; selected = nil } label: {
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(T("Next month"))
        }
    }
    @ViewBuilder private var plotByMenu: some View {
        if !plotChoices.isEmpty, let onPlotBy {
            Menu {
                ForEach(plotChoices) { c in
                    Button { onPlotBy(c.id) } label: {
                        if c.id == dateFieldId { Label(c.name, systemImage: "checkmark") } else { Text(c.name) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text("\(T("Plot by")): \(plotName)").font(NXFont.text(13)).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                }
                // Its whole label: a menu label is laid out small and was cut to "Plot by: Due…" beside empty
                // room (UI tour run 17, iPhone R17-I-09).
                .fixedSize()
                .foregroundStyle(NX.mutedFg)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
        }
    }

    /// Monday first, in the app's language (it was "Sen Sel Rab…" hard-coded, so an English app read
    /// Indonesian day names — UI tour run 5).
    private var weekdayNames: [String] {
        let names = ProjDate.fmt("EEE").shortWeekdaySymbols ?? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return Array(names[1...]) + [names[0]]
    }
    /// "MON … SUN", left-aligned over the day numbers: one month-grid style on every calendar and platform
    /// (UI tour run 15, R15-WB-3 / Q-IA26 / Q-M16).
    private var weekdayRow: some View {
        NXMonthWeekdayRow(names: weekdayNames, wide: wideGrid)
    }
    /// The days of the next month that fill the grid to six weeks, as the web's (UI tour run 19, R19-I-19: five
    /// rows here, six on the web).
    private var trailingDays: Int { max(0, 42 - leadingBlanks - daysInMonth) }
    /// The day number of the previous month for a leading blank (-n … -1).
    private func previousMonthDay(_ blank: Int) -> Int {
        let prev = cal.date(byAdding: .month, value: -1, to: cal.date(from: comps) ?? monthDate) ?? monthDate
        let n = cal.range(of: .day, in: .month, for: prev)?.count ?? 30
        return n + blank + 1
    }
    /// Today's day of the month while the shown month is the current one.
    private var todayDay: Int? {
        let now = cal.dateComponents([.year, .month, .day], from: Date())
        return now.year == comps.year && now.month == comps.month ? now.day : nil
    }
    private var grid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
        let map = tasksByDay   // build the day→tasks map ONCE, not once per day cell (was a full task-scan ×31)
        let today = todayDay
        // One ForEach over every cell. The blanks and the days used to be two ForEach with Int ids 0…n-1
        // and 1…31 in one grid: the ids collided and the grid dropped days — October 2026 (three blanks)
        // showed no 1st or 2nd (UI tour run 5). Blanks are negative now.
        // Days of the months around it fill the first and last week, greyed, as on the web. Their ids sit
        // outside 1…31 (negative before, 100+ after) so they never collide with this month's.
        let cells = Array(-leadingBlanks..<0) + Array(1...daysInMonth) + Array(stride(from: 101, through: 100 + trailingDays, by: 1))
        return LazyVGrid(columns: cols, spacing: 0) {
            ForEach(cells, id: \.self) { day in
                if day < 0 || day > 100 {
                    // Joined like the rest, greyed, the number muted and not a button.
                    NXMonthDayNumber(day: day < 0 ? previousMonthDay(day) : day - 100, inMonth: false, wide: wideGrid)
                        .padding(wideGrid ? 6 : 4)
                        .frame(maxWidth: .infinity, minHeight: wideGrid ? Self.wideCellH : 50, alignment: .topLeading)
                        .nxMonthCell(inMonth: false, selected: false)
                        .accessibilityHidden(true)
                } else {
                    if wideGrid {
                        wideCell(day, items: map[day] ?? [], today: today)
                    } else {
                        // A bordered cell with the number top-left, as the outlet and socmed calendars (UI tour
                        // run 15, R15-I-16 / R15-I-18).
                        let has = !(map[day]?.isEmpty ?? true)
                        let on = selected == day
                        Button { selected = day } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                dayNumber(day, today: today, onFill: on)
                                Circle().fill(has ? NX.foreground.opacity(0.7) : .clear).frame(width: 5, height: 5)
                                    .padding(.leading, 2)
                            }
                            .padding(4)
                            .frame(maxWidth: .infinity, minHeight: 50, alignment: .topLeading)
                            .nxMonthCell(inMonth: true, selected: on)
                            .overlay { if !on, let date = dateFor(day), cal.isDateInWeekend(date) { RoundedRectangle(cornerRadius: 8).fill(NX.muted.opacity(0.25)).allowsHitTesting(false) } }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
        }
    }
}

extension CalendarTab {
    /// iPad / Mac: a full month grid with the tasks in the cells, as the web's (UI tour run 14, P-I14 /
    /// P-M12: the regular width showed the phone's compact picker).
    var wideGrid: Bool { hSize == .regular }
    static let wideCellH: CGFloat = 104
    private static let cellTasks = 3

    /// Today = the number on the app's violet disc, as on the main Calendar and the outlet calendar (it was
    /// rose here alone; UI tour run 14, N-19). On a selected (violet) cell the disc turns white.
    func dayNumber(_ day: Int, today: Int?, onFill: Bool) -> some View {
        // Today on the navy disc of every month grid (NXMonthGrid; UI tour run 16, R16-I-06 / R16-B-09).
        HStack(spacing: 2) {
            NXMonthDayNumber(day: day, isToday: day == today, wide: wideGrid)
            if day == 1 { Text(ProjLocaleDate.fmt("MMM").string(from: monthDate)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
        }
    }

    func wideCell(_ day: Int, items: [BoardTask], today: Int?) -> some View {
        let isSelected = selected == day
        return VStack(alignment: .leading, spacing: 3) {
            Button { selected = day } label: {
                HStack {
                    dayNumber(day, today: today, onFill: false)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            ForEach(items.prefix(Self.cellTasks)) { t in
                Button { onOpen(t.id) } label: {
                    Text(t.title).font(NXFont.text(11, .medium)).lineLimit(1)
                        .foregroundStyle(t.isDone ? NX.mutedFg : NX.foreground)
                        .strikethrough(t.isDone)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.violet.opacity(0.10), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .help(t.title)
            }
            if items.count > Self.cellTasks {
                Button { selected = day } label: {
                    Text(String(format: T("+%d more"), items.count - Self.cellTasks))
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(6)
        .frame(maxWidth: .infinity, minHeight: Self.wideCellH, alignment: .topLeading)
        .nxMonthCell(inMonth: true, selected: isSelected)
        .overlay { if !isSelected, let date = dateFor(day), cal.isDateInWeekend(date) { RoundedRectangle(cornerRadius: 8).fill(NX.muted.opacity(0.25)).allowsHitTesting(false) } }
        .contentShape(Rectangle())
        .onTapGesture { selected = day }
    }
}

// MARK: - Pages (project docs)

struct ProjectPagesTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var docs: [Doc] = []
    @State private var loading = true
    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if docs.isEmpty { TabEmpty(icon: "doc.text", text: T("No pages in this project yet.")) }
            else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(docs) { doc in
                            NavigationLink { DocReaderView(docId: doc.id, title: DocTitle.display(doc.title)) } label: { DocCard(doc: doc) }.buttonStyle(.plain)
                        }
                    }.padding(16)
                }
            }
        }
        .task {
            do { docs = try await APIClient.shared.projectDocs(projectId) }
            catch APIError.unauthorized { auth.logout() } catch { docs = [] }
            loading = false
        }
    }
}

// MARK: - Forms (project)

struct ProjectFormsTab: View {
    let projectId: String
    let projectName: String
    @Environment(AuthStore.self) private var auth
    @State private var forms: [NexusForm] = []
    @State private var loading = true
    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if forms.isEmpty { TabEmpty(icon: "list.clipboard", text: T("No forms in this project yet.")) }
            else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(forms) { f in
                            NavigationLink { FormFillView(formId: f.id, title: f.name) } label: {
                                FormCard(form: f, projectName: projectName)
                            }.buttonStyle(.plain)
                        }
                    }.padding(16)
                }
            }
        }
        .task {
            do { forms = try await APIClient.shared.forms(projectId: projectId) }
            catch APIError.unauthorized { auth.logout() } catch { forms = [] }
            loading = false
        }
    }
}

// MARK: - Share sheet (task attachments)

struct ShareItem: Identifiable { let id = UUID(); let url: URL }

/// UIActivityViewController bridge for the share/save sheet.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Create task (shared composer, reachable from every tab)

/// One custom-field value being composed: a single string, a multi-select set, or a PLACE.
enum CFVal: Equatable { case text(String); case multi([String]); case place(label: String, mapUrl: String) }

struct CreateTaskSheet: View {
    let projectId: String
    let lanes: [ProjectDetail.Lane]
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var laneId: String
    @State private var priority = "NONE"
    @State private var hasDue: Bool
    @State private var due: Date
    @State private var busy = false
    @State private var err: String?
    @State private var customFields: [CustomField] = []
    @State private var cfValues: [String: CFVal] = [:]

    private let priorities = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]

    /// `initialLaneId`: the section the composer starts in ("Add task ▾" → a section; the first to-do
    /// section for plain Add task, web addTask()). nil or unknown = the first section.
    init(projectId: String, lanes: [ProjectDetail.Lane], prefillDue: Date? = nil, initialLaneId: String? = nil,
         onCreated: @escaping () async -> Void) {
        self.projectId = projectId; self.lanes = lanes; self.onCreated = onCreated
        let start = initialLaneId.flatMap { id in lanes.first { $0.id == id }?.id } ?? lanes.first?.id ?? ""
        _laneId = State(initialValue: start)
        _hasDue = State(initialValue: prefillDue != nil)
        _due = State(initialValue: prefillDue ?? Date())
    }

    private var laneName: String { lanes.first(where: { $0.id == laneId })?.name ?? T("Pick a section") }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field(T("TASK TITLE")) {
                            TextField("mis. Shooting EPS 2", text: $title, axis: .vertical)
                                .font(NXFont.text(16)).lineLimit(3).padding(12)
                                .nxSoftField(radius: 12)
                        }
                        field(T("SECTION")) {
                            Menu {
                                ForEach(lanes) { l in Button(l.name) { laneId = l.id } }
                            } label: {
                                HStack {
                                    Text(laneName).font(NXFont.text(15)).foregroundStyle(NX.foreground)
                                    Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                                }
                                .padding(12).nxSoftField(radius: 12)
                            }
                        }
                        field(T("PRIORITY")) {
                            HStack(spacing: 8) {
                                ForEach(priorities, id: \.self) { p in
                                    Button { priority = p } label: {
                                        Text(TaskPriorityName.label(p)).font(NXFont.text(12, .semibold))
                                            .padding(.horizontal, 12).padding(.vertical, 8)
                                            .foregroundStyle(priority == p ? .white : NX.mutedFg)
                                            .background(priority == p ? prioColor(p) : NX.card, in: Capsule())
                                            .overlay(Capsule().strokeBorder(priority == p ? .clear : NX.border))
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                        field(T("DEADLINE")) {
                            Toggle(isOn: $hasDue.animation()) { Text(T("Use a deadline")).font(NXFont.text(14)).foregroundStyle(NX.foreground) }
                                .tint(NX.violetText)
                            if hasDue {
                                DatePicker("", selection: $due, displayedComponents: .date).datePickerStyle(.graphical).tint(NX.violetText)
                            }
                        }
                        if !customFields.isEmpty {
                            VStack(alignment: .leading, spacing: 14) {
                                Text(T("CUSTOM FIELDS")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
                                ForEach(customFields) { f in cfField(f) }
                            }
                            .padding(14)
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border, lineWidth: 1))
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Create task")) }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty || laneId.isEmpty)
                    }
                    .padding(20)
                }
            }
            .navigationTitle(T("New task"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) } }
            .task { customFields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? [] }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
    }
    private func prioColor(_ p: String) -> Color {
        TaskPriorityName.color(p)
    }

    // MARK: custom field rendering (port of web TaskComposer)

    @ViewBuilder private func cfField(_ f: CustomField) -> some View {
        let type = f.type.uppercased()
        let choices = f.choices
        VStack(alignment: .leading, spacing: 6) {
            Text(f.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            if type == "NUMBER" {
                NumberFieldInput(text: cfText(f.id), style: f.options?.numberStyle ?? .plain)
                    .padding(10)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
            } else if type == "DATE" {
                DatePicker("", selection: cfDate(f.id), displayedComponents: .date)
                    .datePickerStyle(.compact).labelsHidden().tint(NX.violetText).frame(maxWidth: .infinity, alignment: .leading)
            } else if (type == "SELECT" || type == "STATUS"), !choices.isEmpty {
                Menu {
                    Button("—") { cfValues[f.id] = .text("") }
                    ForEach(choices, id: \.self) { c in Button(c) { cfValues[f.id] = .text(c) } }
                } label: {
                    let v = cfTextValue(f.id)
                    HStack {
                        Text(v.isEmpty ? "—" : v).font(NXFont.text(15)).foregroundStyle(v.isEmpty ? NX.mutedFg : NX.foreground)
                        Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                    }
                    .padding(10).nxSoftField(radius: 10)
                }
            } else if type == "MULTI_SELECT", !choices.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(choices, id: \.self) { c in
                            let on = cfMultiHas(f.id, c)
                            Button { toggleMulti(f.id, c) } label: {
                                Text(c).font(NXFont.text(12, .semibold)).padding(.horizontal, 12).padding(.vertical, 7)
                                    .foregroundStyle(on ? NX.violetText : NX.mutedFg)
                                    .background(on ? NX.violet.opacity(0.12) : NX.card, in: Capsule())
                                    .overlay(Capsule().strokeBorder(on ? NX.violet : NX.border))
                            }.buttonStyle(.plain)
                        }
                    }
                }
            } else if type == "PLACE" {
                VStack(spacing: 6) {
                    TextField(T("Place / location name"), text: placeLabel(f.id)).font(NXFont.text(15)).padding(10)
                        .nxSoftField(radius: 10)
                    TextField(T("Google Maps link"), text: placeMap(f.id)).font(NXFont.text(15)).keyboardType(.URL).autocorrectionDisabled().padding(10)
                        .nxSoftField(radius: 10)
                }
            } else {
                TextField("…", text: cfText(f.id)).font(NXFont.text(15)).padding(10)
                    .nxSoftField(radius: 10)
            }
        }
    }

    private func placeVal(_ id: String) -> (String, String) { if case let .place(l, m) = cfValues[id] { return (l, m) }; return ("", "") }
    private func placeLabel(_ id: String) -> Binding<String> { Binding(get: { placeVal(id).0 }, set: { cfValues[id] = .place(label: $0, mapUrl: placeVal(id).1) }) }
    private func placeMap(_ id: String) -> Binding<String> { Binding(get: { placeVal(id).1 }, set: { cfValues[id] = .place(label: placeVal(id).0, mapUrl: $0) }) }
    private func cfTextValue(_ id: String) -> String { if case let .text(s) = cfValues[id] { return s }; return "" }
    private func cfText(_ id: String) -> Binding<String> { Binding(get: { cfTextValue(id) }, set: { cfValues[id] = .text($0) }) }
    private func cfDate(_ id: String) -> Binding<Date> {
        Binding(get: { Self.ymdParse(cfTextValue(id)) ?? Date() }, set: { cfValues[id] = .text(Self.ymd($0)) })
    }
    private func cfMultiHas(_ id: String, _ c: String) -> Bool { if case let .multi(a) = cfValues[id] { return a.contains(c) }; return false }
    private func toggleMulti(_ id: String, _ c: String) {
        var arr: [String] = { if case let .multi(a) = cfValues[id] { return a }; return [] }()
        if let i = arr.firstIndex(of: c) { arr.remove(at: i) } else { arr.append(c) }
        cfValues[id] = .multi(arr)
    }
    private static func ymd(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.string(from: d) }
    private static func ymdParse(_ s: String) -> Date? { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.date(from: s) }

    private func create() async {
        // A second tap before the first answer would make a second task (bughunt double-submit family).
        guard !busy else { return }
        busy = true; err = nil; defer { busy = false }
        let iso = ISO8601DateFormatter().string(from: ProjDate.cal.startOfDay(for: due))
        do {
            let taskId = try await APIClient.shared.createTask(projectId: projectId, taskListId: laneId,
                                                               title: title.trimmingCharacters(in: .whitespaces),
                                                               priority: priority, dueDate: hasDue ? iso : nil)
            // Set custom-field values after the task exists (mirrors the web composer).
            for f in customFields {
                guard let v = cfValues[f.id] else { continue }
                switch v {
                case .text(let s):
                    // A number is stored as a plain machine number ("369.000" Rupiah → "369000").
                    let v = f.type.uppercased() == "NUMBER" ? CustomFieldNumber.normalize(s, style: f.options?.numberStyle ?? .plain) : s
                    if !v.isEmpty { try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: v) }
                case .multi(let a):
                    if !a.isEmpty { try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: a) }
                case .place(let l, let m):
                    if !l.isEmpty || !m.isEmpty { try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: ["label": l, "mapUrl": m]) }
                }
            }
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't create task.")
        }
    }
}

// MARK: - Chat (project room)

struct ProjectChatTab: View {
    let projectId: String
    let projectName: String
    /// Posting needs Can comment (project access levels); reading is open to Can view.
    var canPost: Bool = true
    @Environment(AuthStore.self) private var auth
    @State private var room: Conversation?
    @State private var loading = true
    @State private var roomFailure: Error?
    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let room {
                ChatThreadView(conversationId: room.id, title: room.name ?? projectName,
                               members: room.members ?? [], projectId: projectId,
                               canPost: canPost && room.canPost != false)
            }
            else if let roomFailure {
                LoadErrorView(error: roomFailure, what: T("Messages"), retry: { Task { await loadRoom() } }, compact: true)
            } else {
                EmptyState(icon: "bubble.left.and.bubble.right", title: T("This project's chat room isn't active yet."),
                           subtitle: T("No chat room is linked to this project for your account. Ask someone with Full access to check project membership, then refresh."),
                           actionTitle: T("Refresh"), action: { Task { await loadRoom() } })
            }
        }
        .task { await loadRoom() }
        .onReceive(NotificationCenter.default.publisher(for: .nexusWorkspaceChanged)) { _ in Task { await loadRoom() } }
    }
    private func loadRoom() async {
            loading = room == nil; roomFailure = nil
            do {
                let convos = try await APIClient.shared.conversations()
                room = convos.first { $0.type == "PROJECT" && $0.projectId == projectId }
            } catch APIError.unauthorized { auth.logout() } catch { roomFailure = error }
            loading = false
    }
}

/// A DATE custom field's stored value as a date: ISO, or a bare "2026-10-12", possibly quoted.
enum TaskDates {
    static func parse(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let v = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        guard !v.isEmpty else { return nil }
        return ProjDate.parse(v) ?? ProjDate.fmt("yyyy-MM-dd").date(from: String(v.prefix(10)))
    }
}
