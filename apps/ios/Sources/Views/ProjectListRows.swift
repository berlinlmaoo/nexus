import SwiftUI

// The project List as on the dev web (routes/_app/projects/$projectId.tsx ListRow + views/view-layouts.tsx):
// flat rows on hairlines, the task's properties on the right (custom fields, due, priority, status,
// people), group headers with a chevron, the option's coloured pill and "done/total". Small typed views,
// each one plain, so the type checker never sees a long expression.
//
// Mac parity (owner screenshot 275, 13 Oct 2026): on a wide screen the properties are COLUMNS — the same
// order and the same width on every row, an empty slot where a task has no value — so a date never swaps
// places with an amount from one row to the next; text is 15pt, the properties 13–14pt.

/// A task's status as its row shows it: the status option (section) when the project has options,
/// else the plain status in its default colour.
struct RowStatus: Equatable {
    let name: String
    let colorKey: String

    static func plain(_ task: BoardTask) -> RowStatus {
        let s = (task.status ?? "TODO").uppercased()
        return RowStatus(name: TaskStatusName.label(s), colorKey: StatusColor.forStatus[s] ?? "gray")
    }
}

/// A group's header: chevron, the label (a coloured pill for status options), done / total.
struct ListGroupHeader: View {
    let lane: ProjectDetail.Lane
    let statusStyle: Bool
    let collapsed: Bool
    let onToggle: () -> Void

    private var tasks: [BoardTask] { lane.tasks ?? [] }
    private var doneCount: Int { tasks.filter(\.isDone).count }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                label
                Text("\(doneCount)/\(tasks.count)")
                    .font(NXFont.text(13))
                    .foregroundStyle(statusStyle ? StatusColor.swatch(lane.colorKey).fg : NX.mutedFg)
                    .monospacedDigit()
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(lane.name), \(doneCount)/\(tasks.count)")
        .accessibilityValue(collapsed ? T("Collapsed") : T("Expanded"))
    }

    @ViewBuilder private var label: some View {
        if statusStyle {
            StatusPill(name: lane.name, colorKey: lane.colorKey, size: 14)
        } else {
            Text(lane.name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
    }
}

/// The properties on the right of a row (wide) or under its title (compact).
struct ListPropLine: View {
    let task: BoardTask
    let status: RowStatus?
    /// Compact width: the properties wrap under the title instead of running off the edge.
    var wrap = false
    /// Wide: the columns every row of this List draws (ListColumns.Layout). nil = chips as they come.
    var columnLayout: ListColumns.Layout? = nil
    /// The List is grouped by priority: its header says it, the row does not repeat it.
    var hidePriority = false
    /// The assignees' avatars at the end of the line; off where the row draws them beside the title.
    var showPeople = true
    /// Columns as wide as the List's widest value in each (ListSlotWidths), not the fixed column widths.
    var measured = false
    @Environment(ListSlotWidths.self) private var slotWidths: ListSlotWidths?

    /// The custom values a row shows (web: up to four), with every date apart from start and due folded
    /// out when it repeats one of them or another date (UI tour run 9, I7: "24 May 24 May ⏱ 26 May").
    private var customChips: [CFChip] {
        var seenDates = Set(dateKeys)
        var out: [CFChip] = []
        for chip in (task.customFieldValues ?? []).compactMap(customFieldChip) {
            if chip.isDate {
                if !seenDates.insert(chip.label).inserted { continue }
            }
            out.append(chip)
        }
        // Dates last, after the amount / person / category, so the date block reads start → due → others.
        return Array((out.filter { !$0.isDate } + out.filter(\.isDate)).prefix(4))
    }

    private var startDay: Date? { ProjDate.parse(task.startDate) }
    private var dueDay: Date? { ProjDate.parse(task.dueDate) }
    /// The labels start and due are drawn with, to fold out custom dates that say the same.
    private var dateKeys: [String] { [startDay, dueDay].compactMap { $0.map(ProjDate.dayLabel) } }

    /// Start → due in that fixed order, one clock: "24 May → 26 May", or just one of them; a start equal
    /// to the due day is said once.
    @ViewBuilder private var dateRange: some View {
        let start = startDay.map(ProjDate.dayLabel)
        let due = dueDay.map(ProjDate.dayLabel)
        if start != nil || due != nil {
            let text: String = {
                if let start, let due { return start == due ? due : "\(start) → \(due)" }
                if let start { return String(format: T("Starts %@"), start) }
                return due ?? ""
            }()
            let spoken: String = {
                var parts: [String] = []
                if let start, start != due { parts.append(String(format: T("Start %@"), start)) }
                if let due { parts.append(String(format: T("Due %@"), due)) }
                return parts.joined(separator: ", ")
            }()
            Label(text, systemImage: "clock")
                .labelStyle(.titleAndIcon)
                .font(NXFont.text(11, overdue ? .semibold : .regular))
                .foregroundStyle(overdue ? NX.danger : NX.mutedFg)
                .lineLimit(1).fixedSize()
                .accessibilityLabel(spoken)
        }
    }

    private var overdue: Bool {
        guard !task.isDone, let due = ProjDate.parse(task.dueDate) else { return false }
        return due < ProjDate.cal.startOfDay(for: Date())
    }

    var body: some View {
        Group {
            if let columnLayout {
                columns(columnLayout)
            } else {
                chips
            }
        }
    }

    /// Fixed slots, always in this order: the fields, due date, priority, status, people. A slot with no
    /// value stays as wide, blank: an empty `if` with a frame on it collapsed in the HStack, so a row
    /// without a due date or an assignee slid its other values over (UI tour run 11, MC-1 / PD-6).
    /// A slot no row of the List can fill (no task has a due date, the groups already say the status) is
    /// left out for every row alike: those blanks pushed the date and Kategori columns off the Mac row
    /// (UI tour run 12, MC2).
    private func columns(_ layout: ListColumns.Layout) -> some View {
        let repeated = repeatedDateFields(layout)
        let dueSaid = dueSaidByField(layout)
        if measured, let slotWidths {
            return AnyView(HStack(spacing: 10) {
                ForEach(layout.fields, id: \.id) { field in
                    MeasuredSlot(key: field.id, widths: slotWidths) { if !repeated.contains(field.id) { fieldSlot(field.id) } }
                }
                if layout.due { MeasuredSlot(key: "due", widths: slotWidths) { if !dueSaid { dueSlot } } }
                if layout.priority { MeasuredSlot(key: "priority", widths: slotWidths) { prioritySlot } }
                if layout.status { MeasuredSlot(key: "status", widths: slotWidths) { statusSlot } }
                if layout.people && showPeople { MeasuredSlot(key: "people", widths: slotWidths) { people } }
            }
            .fixedSize())
        }
        return AnyView(HStack(spacing: 12) {
            ForEach(layout.fields, id: \.id) { field in
                ListSlot(width: field.width) { if !repeated.contains(field.id) { fieldSlot(field.id) } }
            }
            if layout.due { ListSlot(width: ListColumns.dueW) { if !dueSaid { dueSlot } } }
            if layout.priority { ListSlot(width: ListColumns.priorityW) { prioritySlot } }
            if layout.status { ListSlot(width: ListColumns.statusW) { statusSlot } }
            if layout.people { ListSlot(width: ListColumns.peopleW, alignment: .trailing) { people } }
        })
    }

    /// Date columns that would repeat a day this row already shows (the due date, or an earlier date
    /// column): left blank, so "24 May 24 May ⏱ 26 May" reads "24 May ⏱ 26 May" (UI tour run 13, M-5).
    ///
    /// The due date that repeats a date column is the one left out instead, unless it is overdue (only the
    /// due slot says that): "4 May" stays in its own column on every row rather than jumping to the due
    /// column on some of them (UI tour run 14, P-M1).
    private func repeatedDateFields(_ layout: ListColumns.Layout) -> Set<String> {
        var seen = Set(overdue ? (dueDay.map { [ProjDate.dayLabel($0)] } ?? []) : [])
        var out = Set<String>()
        for field in layout.fields {
            guard let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == field.id }),
                  let chip = customFieldChip(cfv), chip.isDate else { continue }
            if !seen.insert(chip.label).inserted { out.insert(field.id) }
        }
        return out
    }

    /// A date column of this row already shows the due day (and it is not overdue): the due slot stays blank.
    private func dueSaidByField(_ layout: ListColumns.Layout) -> Bool {
        guard !overdue, let due = dueDay.map(ProjDate.dayLabel) else { return false }
        return layout.fields.contains { field in
            guard let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == field.id }),
                  let chip = customFieldChip(cfv), chip.isDate else { return false }
            return chip.label == due
        }
    }

    @ViewBuilder private func fieldSlot(_ id: String) -> some View {
        if let cfv = (task.customFieldValues ?? []).first(where: { $0.customFieldId == id }), let chip = customFieldChip(cfv) {
            // A date wears its field's name, as web WD-4 ("Request by 15 Apr"; UI tour run 20, R20-B-03).
            if chip.colorKey != nil || chip.isPerson || chip.isDate || chip.number?.isVisual == true {
                CFChipView(chip: chip).fixedSize()
            } else {
                Text(chip.label).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).monospacedDigit().lineLimit(1)
            }
        }
    }

    @ViewBuilder private var dueSlot: some View {
        if let due = ProjDate.parse(task.dueDate) {
            Label(ProjDate.dayLabel(due), systemImage: "clock")
                .labelStyle(.titleAndIcon)
                .font(NXFont.text(13, overdue ? .semibold : .regular))
                .foregroundStyle(overdue ? NX.danger : NX.mutedFg)
                .lineLimit(1)
        }
    }

    @ViewBuilder private var prioritySlot: some View {
        if !hidePriority, let p = task.priority, p.uppercased() != "NONE" { TablePill(text: TaskPriorityName.label(p), tone: prioTone(p)) }
    }

    @ViewBuilder private var statusSlot: some View {
        if let status { StatusPill(name: status.name, colorKey: status.colorKey, size: 13).fixedSize() }
    }

    private var chips: some View {
        let layout = wrap ? AnyLayout(FlowLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            let chips = customChips
            ForEach(chips.filter { !$0.isDate && !$0.isPerson }) { chip in customValue(chip) }
            // Two dates at most, then "+N", as the web row (R14 rule; UI tour run 15, Q-IA24: three dates).
            let dates = chips.filter(\.isDate)
            let room = max(0, 2 - (startDay != nil || dueDay != nil ? 1 : 0))
            dateRange
            ForEach(Array(dates.prefix(room))) { chip in customValue(chip) }
            if dates.count > room {
                Text("+\(dates.count - room)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).fixedSize()
                    .accessibilityLabel(String(format: T("%d more dates"), dates.count - room))
            }
            if !hidePriority, let p = task.priority, p.uppercased() != "NONE" { PriorityPill(priority: p) }
            if let status { StatusPill(name: status.name, colorKey: status.colorKey, size: 11).fixedSize() }
            // People last, always: a person field (a staff member's name) sat after the amount on some rows while
            // the assignees' avatars ended others, so "who" jumped between the start and the end of the
            // line (UI tour run 11, PD-6).
            ForEach(chips.filter(\.isPerson)) { chip in customValue(chip) }
            if showPeople { people }
        }
    }

    @ViewBuilder private func customValue(_ chip: CFChip) -> some View {
        // A coloured option, a date (clock) and a person (icon) keep their chip; only plain values are text.
        if chip.colorKey != nil || chip.isDate || chip.isPerson || chip.number?.isVisual == true {
            CFChipView(chip: chip).fixedSize()
        } else {
            Text(chip.label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                .monospacedDigit().lineLimit(1).fixedSize()
        }
    }

    @ViewBuilder var people: some View {
        let avatars = task.assigneeAvatars
        if !avatars.isEmpty {
            HStack(spacing: -6) {
                ForEach(avatars, id: \.id) { a in
                    AvatarView(url: a.url, initial: a.initial, size: 20)
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                }
            }
        }
    }
}

/// One fixed-width column of a wide List row. The clear base keeps the slot when its content is empty.
/// The widest value seen in each column of one List (two-line iPad / Mac rows), so every row's columns line up.
@Observable final class ListSlotWidths {
    var widths: [String: CGFloat] = [:]
    func report(_ key: String, _ width: CGFloat) {
        if width > (widths[key] ?? 0) + 0.5 { widths[key] = ceil(width) }
    }
}

/// A value in its column: as wide as the column's widest value (blank when the row has none).
private struct MeasuredSlot<Content: View>: View {
    let key: String
    let widths: ListSlotWidths
    @ViewBuilder let content: Content

    var body: some View {
        // A clear base keeps the column when the row has no value: an empty `if` with a frame on it collapsed,
        // so a Done row without an assignee drew its date in the assignee's place (UI tour run 18, R18-M-03).
        ZStack(alignment: .leading) {
            Color.clear.frame(width: widths.widths[key] ?? 0, height: 1)
            content
                .fixedSize()
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { widths.report(key, $0) }
        }
        .frame(width: widths.widths[key], alignment: .leading)
    }
}

private struct ListSlot<Content: View>: View {
    let width: CGFloat
    var alignment: Alignment = .leading
    @ViewBuilder let content: Content

    var body: some View {
        ZStack(alignment: alignment) {
            Color.clear.frame(width: width, height: 1)
            content
        }
        .frame(width: width, alignment: alignment)
    }
}

/// One flat List row: the done circle, the title, the properties, a hairline underneath.
struct ListTaskRow: View {
    let task: BoardTask
    let status: RowStatus?
    let wide: Bool
    /// Wide: the columns every row of this List draws (same order, same width).
    var columnLayout = ListColumns.Layout()
    /// Grouped by priority: the row leaves the priority pill out.
    var hidePriority = false
    let onOpen: (String) -> Void
    var selection: TaskSelection? = nil
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
            content
                .padding(.horizontal, 8).padding(.vertical, wide ? 10 : 8)
                .padding(.leading, task.isSubtask ? 20 : 0)
                .frame(maxWidth: .infinity, minHeight: wide ? 46 : 38, alignment: .leading)
                .background(selecting && selected ? NX.violet.opacity(0.10) : Color.clear)
                .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.7)).frame(height: 0.5) }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(selecting && selected ? .isSelected : [])
        .taskModifierClicks(task.id, selection: selection, order: order)
    }

    @ViewBuilder private var content: some View {
        if wide {
            // The property columns are fixed widths (up to ~830 pt with three fields). On a portrait iPad
            // with the sidebar open that left the title NO width at all (UI tour run 5). Every row sees the
            // same width and the title's ideal is fixed, so all rows of a List pick the same layout.
            // Every column or the two-line row, nothing in between: dropping field columns to fit a portrait
            // iPad left only Kategori, so the amount and the date vanished from the rows while the web and
            // the Mac show them (UI tour run 14, P-I1), and the title was cut short beside empty slots
            // (P-I10). The two-line row gives the title the whole width and lists every value under it.
            ViewThatFits(in: .horizontal) {
                wideRow(columnLayout)
                if columnLayout.withoutText != columnLayout { wideRow(columnLayout.withoutText) }
                compactRow
            }
        } else {
            compactRow
        }
    }

    private func wideRow(_ layout: ListColumns.Layout, measured: Bool = false, titleMin: CGFloat = 180) -> some View {
        HStack(spacing: 10) {
            leading
            titleLine.frame(minWidth: titleMin, idealWidth: titleMin, maxWidth: .infinity, alignment: .leading)
            ListPropLine(task: task, status: status, columnLayout: layout, hidePriority: hidePriority, measured: measured)
        }
    }

    /// The title on top, the values under it in one fixed order (amount, options, dates, priority,
    /// status, person fields); the assignees' avatars sit at the end of the title line, so they never
    /// wrap onto a line of their own (UI tour run 14, N-14).
    private var compactRow: some View {
        let line = ListPropLine(task: task, status: status, wrap: true, hidePriority: hidePriority, showPeople: false)
        return HStack(alignment: .top, spacing: 10) {
            leading.padding(.top, 1)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    titleLine.frame(maxWidth: .infinity, alignment: .leading)
                    line.people
                }
                // iPad / Mac: the values in the List's columns under the title, each column as wide as its
                // widest value, so they line up down the List; a row with no date keeps that column blank
                // instead of sliding the amount, Kategori and status left (UI tour run 17, R17-B-03, the kept
                // B-08 "aligned meta columns"). Too wide for the row: the values wrap as on a phone.
                if wide {
                    ViewThatFits(in: .horizontal) {
                        ListPropLine(task: task, status: status, columnLayout: columnLayout, hidePriority: hidePriority,
                                     showPeople: false, measured: true)
                        line
                    }
                } else {
                    line
                }
            }
        }
    }

    @ViewBuilder private var leading: some View {
        if selecting { TaskSelectionMark(selected: selected) }
        Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
            .font(.system(size: wide ? 17 : 15))
            .foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.55))
    }

    private var titleLine: some View {
        HStack(spacing: 6) {
            if task.isSubtask {
                Image(systemName: "arrow.turn.down.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
            }
            Text(UntitledText.wrapped(task.title))
                .font(NXFont.text(15))
                .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                .strikethrough(task.isDone)
                // Two lines on a wide row too: one line cut "FEE HOSTING PR NAZH…" beside empty slots
                // (UI tour run 15, Q-M13).
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            if task.isSubtask, wide, let parent = task.parent?.title, !parent.isEmpty {
                Text("· \(parent)").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            if task.hasQuest { QuestXPChip(xp: task.questXP) }
        }
    }
}

/// "+ New task" at the end of a List group (web ListView): tap, type a title, Return adds it and keeps the
/// field open for the next one (UI tour run 14, P-I10: the iPad List had no way to add in a group).
struct ListNewTaskRow: View {
    var composeRequest: UUID? = nil
    /// Creates the task; answers its id (nil = failed, the board says why and keeps the title).
    let onAdd: (String) async -> String?
    @State private var editing = false
    @State private var title = ""
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if editing {
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    TextField(T("Task title"), text: $title)
                        .focused($focused)
                        .font(NXFont.text(15))
                        .submitLabel(.done)
                        .onSubmit(submit)
                    Button(T("Cancel")) { editing = false; title = "" }
                        .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                        .buttonStyle(.plain)
                        .keyboardShortcut(.cancelAction)
                }
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            } else {
                Button {
                    title = ""
                    editing = true
                    focused = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus").font(.system(size: 13, weight: .semibold))
                        Text(T("New task")).font(NXFont.text(14))
                    }
                    .foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
            }
        }
        .onAppear { if composeRequest != nil { editing = true; focused = true } }
        .onChange(of: composeRequest) { _, request in
            if request != nil { editing = true; focused = true }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.7)).frame(height: 0.5) }
    }

    private func submit() {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        title = ""
        focused = true
        Task { _ = await onAdd(t) }
    }
}

/// The wide List's property columns: their widths, which custom fields get one (the project's fields in
/// their own order that hold a value on any task shown, at most four like the web row), and which fixed
/// slots the List draws at all.
enum ListColumns {
    static let fieldW: CGFloat = 108
    /// A date field's column: a day label ("25 Sep", "5 Jan 2027") is narrower than an amount or a name.
    static let dateFieldW: CGFloat = 76
    static let dueW: CGFloat = 84
    static let priorityW: CGFloat = 92
    static let statusW: CGFloat = 140
    static let peopleW: CGFloat = 64

    /// The columns of one List, the same for every row.
    struct Layout: Equatable {
        /// `keep`: an option field (Kategori), the column a narrow window gives up last.
        struct Field: Equatable { let id: String; let width: CGFloat; var keep = false; var textual = false }
        var fields: [Field] = []
        var due = true
        var priority = true
        var status = true
        var people = true

        /// The columns without the text-valued fields ("Request by"), which the web's List row does not show:
        /// one line on a window too narrow for every column, before the two-line row (UI tour run 19, R19-B-02).
        var withoutText: Layout {
            var l = self
            l.fields = fields.filter { !$0.textual }
            return l
        }
    }

    /// A date column: the calendar, the field's name and "28 Sep" (the date carries its name since run 20, R20-B-03).
    static func dateWidth(_ name: String?) -> CGFloat {
        guard let name, !name.isEmpty else { return dateFieldW }
        let font = UIFont(name: "Inter", size: 11) ?? .systemFont(ofSize: 11)
        return max(dateFieldW, ceil((name as NSString).size(withAttributes: [.font: font]).width) + 64)
    }

    static func fieldIds(fields: [CustomField], lanes: [ProjectDetail.Lane], max: Int = 4) -> [String] {
        var used = Set<String>()
        var seen: [String] = []
        for lane in lanes {
            for t in lane.tasks ?? [] {
                for v in t.customFieldValues ?? [] where customFieldChip(v) != nil {
                    if used.insert(v.customFieldId).inserted { seen.append(v.customFieldId) }
                }
            }
        }
        // The project's order when the fields are known; else the order they first appear in.
        let ordered = fields.isEmpty ? seen : fields.map(\.id).filter { used.contains($0) }
        guard ordered.count > max else { return ordered }
        // More than fit: option fields (Kategori) first in line, still drawn in the project's order.
        let options = Set(fields.filter { ["SELECT", "MULTI_SELECT", "STATUS"].contains($0.type.uppercased()) }.map(\.id))
        let picked = Set((ordered.filter { options.contains($0) } + ordered.filter { !options.contains($0) }).prefix(max))
        return ordered.filter { picked.contains($0) }
    }

    /// The layout a List draws. `statusShown` / `priorityShown`: whether any row carries that chip (a List
    /// grouped by status or priority says it in the group headers, so no row does).
    static func layout(fields: [CustomField], lanes: [ProjectDetail.Lane],
                       statusShown: Bool, priorityShown: Bool) -> Layout {
        let tasks = lanes.flatMap { $0.tasks ?? [] }
        let types = Dictionary(fields.map { ($0.id, $0.type.uppercased()) }, uniquingKeysWith: { a, _ in a })
        let names = Dictionary(fields.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let cols = fieldIds(fields: fields, lanes: lanes).map { id in
            Layout.Field(id: id, width: types[id] == "DATE" ? dateWidth(names[id]) : fieldW,
                         keep: ["SELECT", "MULTI_SELECT", "STATUS"].contains(types[id] ?? ""),
                         textual: ["TEXT", "CREATED", "URL", "EMAIL", "PHONE"].contains(types[id] ?? ""))
        }
        return Layout(
            fields: cols,
            due: tasks.contains { ProjDate.parse($0.dueDate) != nil },
            priority: priorityShown && tasks.contains { ($0.priority ?? "NONE").uppercased() != "NONE" },
            status: statusShown,
            people: tasks.contains { !$0.assigneeAvatars.isEmpty }
        )
    }
}

// MARK: - Project page chrome

/// A header action: an icon on the phone, icon + words on iPad / Mac (web "Project settings", "Add task").
/// `prominent` is the web's dark filled button.
struct ProjectHeaderButton: View {
    let title: String
    let icon: String
    var labelled = false
    var prominent = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            face
                .foregroundStyle(prominent ? NX.background : NX.foreground)
                .background(prominent ? NX.foreground : NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(prominent ? Color.clear : NX.border))
                .opacity(enabled ? 1 : 0.45)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .disabled(!enabled)
        .accessibilityLabel(title)
    }

    @ViewBuilder private var face: some View {
        if labelled {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(title).font(NXFont.text(14, .semibold)).lineLimit(1).fixedSize()
            }
            .padding(.horizontal, 12).frame(height: 36)
        } else {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).frame(width: 36, height: 36)
        }
    }
}

/// One tab of the project's tab row: icon + label, a soft fill when it is the one on screen.
struct ProjectTabChip: View {
    let title: String
    let icon: String
    let on: Bool
    var filtered = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .medium))
                Text(title).font(NXFont.text(14, on ? .semibold : .regular)).lineLimit(1)
                if filtered {
                    Circle().fill(NX.violet).frame(width: 5, height: 5)
                }
            }
            .foregroundStyle(on ? NX.foreground : NX.mutedFg)
            .padding(.horizontal, 10).frame(height: 32)
            .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
