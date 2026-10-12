import SwiftUI

// MARK: - Tab model

enum ProjectTab: String, CaseIterable, Identifiable {
    // First, so a Pipeline Dashboard opens on it (owner, 9 Oct 2026); no other project shows it.
    case pipeline = "Pipeline"
    case overview = "Overview", board = "Board", list = "List", sheet = "Spreadsheet", calendar = "Calendar"
    // Sprints was removed (owner, 11 Oct 2026); an old "sprints" key in hiddenTabs is just ignored.
    case timeline = "Timeline", automations = "Automations"
    case pages = "Pages", forms = "Forms", chat = "Chat"
    // Only an Outlet Sales Dashboard shows it (owner, 10 Oct 2026, for Ryan): the night's report form.
    case reportForm = "Report form"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .pipeline: return "chart.bar.doc.horizontal"
        case .overview: return "square.grid.2x2.fill"
        case .board:    return "rectangle.split.3x1.fill"
        case .list:     return "list.bullet"
        case .sheet:    return "tablecells"
        case .calendar: return "calendar"
        case .timeline: return "chart.bar.xaxis"
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
    static func longLabel(_ d: Date) -> String { fmt("EEEE, d MMM yyyy").string(from: d) }

    private static let fmtLock = NSLock()
    private static var fmtCache: [String: DateFormatter] = [:]
    static func fmt(_ p: String) -> DateFormatter {
        fmtLock.lock(); defer { fmtLock.unlock() }
        if let f = fmtCache[p] { return f }
        let f = DateFormatter(); f.dateFormat = p; f.locale = Locale(identifier: "id_ID"); f.timeZone = cal.timeZone
        fmtCache[p] = f
        return f
    }
}

func humanizeEnum(_ raw: String) -> String {
    raw.split(whereSeparator: { $0 == "_" || $0 == " " })
        .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
        .joined(separator: " ")
}

func prioTone(_ p: String) -> ChipTone {
    switch p.uppercased() { case "URGENT": return .danger; case "HIGH": return .danger; case "MEDIUM": return .info; default: return .neutral }
}

/// A task's priority as a compact pill (owner, 10 Oct 2026: the NexusChip was too big beside the card
/// title). One size on the board, List, folder and My Tasks rows, like the web's text-[10px] pill.
struct PriorityPill: View {
    let priority: String
    var body: some View {
        let tone = prioTone(priority)
        Text(priority.capitalized)
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
                        AvatarView(url: a.url, initial: a.initial, size: 22)
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
    let onOpen: (String) -> Void
    var selection: TaskSelection? = nil
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                ForEach(lanes) { lane in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Text(lane.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                            Text("\(lane.tasks?.count ?? 0)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                                .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                            Spacer()
                        }
                        if (lane.tasks ?? []).isEmpty {
                            Text(T("Empty")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.7)).padding(.vertical, 4)
                        } else {
                            let order = { (lane.tasks ?? []).map(\.id) }
                            ForEach(lane.tasks ?? []) { t in
                                if t.isSubtask {
                                    ProjectTaskRow(task: t, onOpen: onOpen, selection: selection, order: order)
                                        .padding(.leading, 16)                       // nest under parent
                                        .overlay(alignment: .leading) { Rectangle().fill(Color(hex: "#7c3aed").opacity(0.35)).frame(width: 2).padding(.vertical, 6) }
                                } else {
                                    ProjectTaskRow(task: t, onOpen: onOpen, selection: selection, order: order)
                                }
                            }
                        }
                    }
                }
            }.padding(16)
        }
    }
}

// MARK: - Timeline (Gantt: start→due windows per section)

struct TimelineTab: View {
    let lanes: [ProjectDetail.Lane]   // merged (incl. subtasks)
    let onOpen: (String) -> Void

    private let dayW: CGFloat = 38
    private let leftW: CGFloat = 122
    private let rowH: CGFloat = 44
    private let groupH: CGFloat = 32
    private let headerH: CGFloat = 50
    private static let DAY: TimeInterval = 86400

    private var cal: Calendar { ProjDate.cal }
    private func sod(_ d: Date) -> Date { cal.startOfDay(for: d) }
    private func days(_ a: Date, _ b: Date) -> Int { cal.dateComponents([.day], from: sod(a), to: sod(b)).day ?? 0 }

    struct Win { let start: Date; let end: Date }
    /// Port of web taskWindow: start=startDate, end=dueDate, ±3-day fallback when one is missing.
    private func window(_ t: BoardTask) -> Win {
        var s = ProjDate.parse(t.startDate)
        var e = ProjDate.parse(t.dueDate)
        if let s0 = s, e == nil { e = s0.addingTimeInterval(3 * Self.DAY) }
        if s == nil, let e0 = e { s = e0.addingTimeInterval(-3 * Self.DAY) }
        if s == nil || e == nil { let t0 = sod(Date()); s = t0; e = t0.addingTimeInterval(3 * Self.DAY) }
        let ss = sod(s!); let ee = sod(e!)
        return Win(start: ss, end: ee < ss ? ss : ee)
    }

    struct Group: Identifiable { let id: String; let name: String; let rows: [Row] }
    struct Row: Identifiable { let id: String; let task: BoardTask; let win: Win }

    private var groups: [Group] {
        lanes.map { lane in
            let rows = (lane.tasks ?? []).map { Row(id: $0.id, task: $0, win: window($0)) }
                .sorted { $0.win.start < $1.win.start }
            return Group(id: lane.id, name: lane.name, rows: rows)
        }.filter { !$0.rows.isEmpty }
    }
    private var allWins: [Win] { groups.flatMap { $0.rows.map(\.win) } }

    var body: some View {
        if allWins.isEmpty {
            TabEmpty(icon: "chart.bar.xaxis", text: T("No tasks to put on the timeline yet."))
        } else {
            gantt
        }
    }

    private var gantt: some View {
        let minD = sod(allWins.map(\.start).min()!.addingTimeInterval(-2 * Self.DAY))
        let maxD = sod(allWins.map(\.end).max()!.addingTimeInterval(3 * Self.DAY))
        let dayCount = days(minD, maxD) + 1
        let timelineW = CGFloat(dayCount) * dayW
        let dayList = (0..<dayCount).map { minD.addingTimeInterval(Double($0) * Self.DAY) }
        let today = sod(Date())
        let todayX: CGFloat? = (today >= minD && today <= maxD) ? CGFloat(days(minD, today)) * dayW + dayW / 2 : nil

        var months: [(label: String, span: Int)] = []
        for d in dayList {
            let label = ProjDate.fmt("MMMM yyyy").string(from: d).capitalized
            if months.last?.label == label { months[months.count - 1].span += 1 } else { months.append((label, 1)) }
        }
        func xOf(_ d: Date) -> CGFloat { CGFloat(days(minD, d)) * dayW }
        func barW(_ w: Win) -> CGFloat { CGFloat(days(w.start, w.end) + 1) * dayW }

        return ScrollView {
            HStack(alignment: .top, spacing: 0) {
                // LEFT — fixed title column
                VStack(alignment: .leading, spacing: 0) {
                    Text("TITLE").font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                        .padding(.leading, 12).padding(.bottom, 8)
                        .frame(width: leftW, height: headerH, alignment: .bottomLeading)
                    ForEach(groups) { g in
                        Text(g.name).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                            .padding(.leading, 12).frame(width: leftW, height: groupH, alignment: .leading)
                            .background(NX.muted.opacity(0.4))
                        ForEach(g.rows) { r in
                            // The gantt bar opens the task; so should the name, which is what the
                            // finger reaches for when the bar is scrolled weeks off to the right.
                            Button { onOpen(r.task.id) } label: {
                                Text(r.task.isSubtask ? "↳ \(r.task.title)" : r.task.title).font(NXFont.text(12)).foregroundStyle(r.task.isDone ? NX.mutedFg : NX.foreground)
                                    .strikethrough(r.task.isDone).lineLimit(1)
                                    .padding(.leading, r.task.isSubtask ? 20 : 12).frame(width: leftW, height: rowH, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .background(NX.card)
                .overlay(alignment: .trailing) { Rectangle().fill(NX.border).frame(width: 1) }

                // RIGHT — horizontally-scrollable timeline
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        // axis header (months + days)
                        VStack(spacing: 0) {
                            HStack(spacing: 0) {
                                ForEach(Array(months.enumerated()), id: \.offset) { _, m in
                                    Text(m.label).font(NXFont.text(11, .bold)).foregroundStyle(NX.foreground.opacity(0.7))
                                        .padding(.leading, 6).frame(width: CGFloat(m.span) * dayW, height: 22, alignment: .leading)
                                        .overlay(alignment: .leading) { Rectangle().fill(NX.border.opacity(0.5)).frame(width: 1) }
                                }
                            }
                            HStack(spacing: 0) {
                                ForEach(Array(dayList.enumerated()), id: \.offset) { _, d in
                                    let wd = cal.component(.weekday, from: d)
                                    let isToday = d == today
                                    Text("\(cal.component(.day, from: d))").font(NXFont.text(10, isToday ? .bold : .regular))
                                        .foregroundStyle(isToday ? .white : NX.mutedFg)
                                        .frame(width: dayW, height: 28)
                                        .background(isToday ? NX.violet : ((wd == 1 || wd == 7) ? NX.muted.opacity(0.4) : Color.clear))
                                        .overlay(alignment: .leading) { Rectangle().fill(NX.border.opacity(0.4)).frame(width: 1) }
                                }
                            }
                        }
                        // body rows
                        ForEach(groups) { g in
                            let gStart = g.rows.map(\.win.start).min()!
                            let gEnd = g.rows.map(\.win.end).max()!
                            ZStack(alignment: .leading) {
                                Rectangle().fill(NX.muted.opacity(0.4))
                                Capsule().fill(NX.mutedFg.opacity(0.3))
                                    .frame(width: max(barW(Win(start: gStart, end: gEnd)) - 6, 4), height: 6)
                                    .offset(x: xOf(gStart) + 3)
                            }
                            .frame(width: timelineW, height: groupH)
                            ForEach(g.rows) { r in
                                ZStack(alignment: .leading) {
                                    Color.clear
                                    Button { onOpen(r.task.id) } label: {
                                        ganttBar(r).frame(width: max(barW(r.win) - 6, 16), height: 22).offset(x: xOf(r.win.start) + 3)
                                    }.buttonStyle(.plain)
                                }
                                .frame(width: timelineW, height: rowH)
                            }
                        }
                    }
                    .frame(width: timelineW, alignment: .leading)
                    .overlay(alignment: .topLeading) {
                        if let tx = todayX {
                            Rectangle().fill(NX.violet.opacity(0.55)).frame(width: 1).padding(.top, headerH).offset(x: tx)
                        }
                    }
                }
            }
        }
    }

    private func ganttBar(_ r: Row) -> some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ganttColor(r.task.priority).gradient)
            .overlay(alignment: .leading) {
                if r.task.isDone {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .black)).foregroundStyle(.white).padding(.leading, 5)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.25)))
    }
    private func ganttColor(_ p: String?) -> Color {
        switch (p ?? "NONE").uppercased() {
        case "URGENT": return Color(hex: "#fb7185")
        case "HIGH":   return Color(hex: "#f59e0b")
        case "MEDIUM": return Color(hex: "#38bdf8")
        case "LOW":    return Color(hex: "#a78bfa")
        default:       return Color(hex: "#2dd4bf")
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
    /// Plot by (12 Oct 2026): nil = the due date, else the id of a DATE custom field.
    var dateFieldId: String? = nil
    /// Empty = the project has no DATE field, so there is nothing to choose and no menu.
    var plotChoices: [CalendarPlotChoice] = []
    var onPlotBy: ((String?) -> Void)? = nil
    @State private var monthOffset = 0
    @State private var selected: Int?

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
    private func plotDate(_ t: BoardTask) -> Date? {
        guard let fid = dateFieldId else { return ProjDate.parse(t.dueDate) }
        guard let raw = t.customFieldValues?.first(where: { $0.customFieldId == fid })?.value,
              !raw.isEmpty else { return nil }
        let v = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        return ProjDate.parse(v) ?? ProjDate.fmt("yyyy-MM-dd").date(from: String(v.prefix(10)))
    }

    private var plotName: String {
        plotChoices.first { $0.id == dateFieldId }?.name ?? T("Due date")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if !plotChoices.isEmpty, let onPlotBy {
                    HStack {
                        Menu {
                            ForEach(plotChoices) { c in
                                Button { onPlotBy(c.id) } label: {
                                    if c.id == dateFieldId { Label(c.name, systemImage: "checkmark") } else { Text(c.name) }
                                }
                            }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "calendar.badge.clock").font(.system(size: 12, weight: .semibold))
                                Text("\(T("Plot by")): \(plotName)").font(NXFont.text(12, .semibold)).lineLimit(1)
                                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                            }
                            .foregroundStyle(NX.violetText)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(NX.violet.opacity(0.10), in: Capsule())
                        }
                        Spacer(minLength: 0)
                    }
                }
                header
                weekdayRow
                grid
                if let sel = selected {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("\(T("Date")) \(sel)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                            Spacer()
                            Button { onCreate(dateFor(sel)) } label: {
                                Label(T("Add task"), systemImage: "plus").font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                            }
                        }
                        if let items = tasksByDay[sel], !items.isEmpty {
                            ForEach(items) { ProjectTaskRow(task: $0, onOpen: onOpen) }
                        } else {
                            Text(T("No tasks on this date.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                    }
                } else {
                    Text(T("Pick a date to see its tasks, or tap + to create one."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.top, 4)
                }
            }.padding(16)
        }
    }

    private var header: some View {
        HStack {
            Button { monthOffset -= 1; selected = nil } label: { Image(systemName: "chevron.left").foregroundStyle(NX.foreground) }
            Spacer()
            Text(ProjDate.fmt("MMMM yyyy").string(from: monthDate).capitalized).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            Button { monthOffset += 1; selected = nil } label: { Image(systemName: "chevron.right").foregroundStyle(NX.foreground) }
        }
    }
    private var weekdayRow: some View {
        HStack(spacing: 4) {
            ForEach(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"], id: \.self) { d in
                Text(d).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity)
            }
        }
    }
    private var grid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let map = tasksByDay   // build the day→tasks map ONCE, not once per day cell (was a full task-scan ×31)
        return LazyVGrid(columns: cols, spacing: 4) {
            ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 42) }
            ForEach(1...daysInMonth, id: \.self) { day in
                let has = !(map[day]?.isEmpty ?? true)
                Button { selected = day } label: {
                    VStack(spacing: 3) {
                        Text("\(day)").font(NXFont.text(13, selected == day ? .bold : .regular))
                            .foregroundStyle(selected == day ? .white : NX.foreground)
                        Circle().fill(has ? (selected == day ? Color.white : NX.violet) : .clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .background(selected == day ? NX.violet : (has ? NX.violet.opacity(0.08) : Color.clear), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
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
                            NavigationLink { DocReaderView(docId: doc.id, title: doc.title) } label: { DocCard(doc: doc) }.buttonStyle(.plain)
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

    init(projectId: String, lanes: [ProjectDetail.Lane], prefillDue: Date? = nil, onCreated: @escaping () async -> Void) {
        self.projectId = projectId; self.lanes = lanes; self.onCreated = onCreated
        _laneId = State(initialValue: lanes.first?.id ?? "")
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
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field(T("SECTION")) {
                            Menu {
                                ForEach(lanes) { l in Button(l.name) { laneId = l.id } }
                            } label: {
                                HStack {
                                    Text(laneName).font(NXFont.text(15)).foregroundStyle(NX.foreground)
                                    Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                                }
                                .padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                            }
                        }
                        field(T("PRIORITY")) {
                            HStack(spacing: 8) {
                                ForEach(priorities, id: \.self) { p in
                                    Button { priority = p } label: {
                                        Text(p == "NONE" ? "None" : p.capitalized).font(NXFont.text(12, .semibold))
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
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
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
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
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
        switch p { case "URGENT": return NX.danger; case "HIGH": return NX.danger; case "MEDIUM": return NX.blue; case "LOW": return NX.violet; default: return NX.mutedFg }
    }

    // MARK: custom field rendering (port of web TaskComposer)

    @ViewBuilder private func cfField(_ f: CustomField) -> some View {
        let type = f.type.uppercased()
        let choices = f.choices
        VStack(alignment: .leading, spacing: 6) {
            Text(f.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            if type == "NUMBER" {
                NumberFieldInput(text: cfText(f.id), idr: CustomFieldNumber.isIDR(f.options?.format))
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
                    .padding(10).background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
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
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
                    TextField(T("Google Maps link"), text: placeMap(f.id)).font(NXFont.text(15)).keyboardType(.URL).autocorrectionDisabled().padding(10)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
                }
            } else {
                TextField("…", text: cfText(f.id)).font(NXFont.text(15)).padding(10)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
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
                    let v = f.type.uppercased() == "NUMBER" ? CustomFieldNumber.normalize(s, idr: CustomFieldNumber.isIDR(f.options?.format)) : s
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
    @Environment(AuthStore.self) private var auth
    @State private var room: Conversation?
    @State private var loading = true
    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let room {
                ChatThreadView(conversationId: room.id, title: room.name ?? projectName,
                               members: room.members ?? [], projectId: projectId)
            }
            else { TabEmpty(icon: "bubble.left.and.bubble.right", text: T("Project chat room isn't active yet (needs the Messages backend).")) }
        }
        .task {
            do {
                let convos = try await APIClient.shared.conversations()
                room = convos.first { $0.type == "PROJECT" && $0.projectId == projectId }
            } catch APIError.unauthorized { auth.logout() } catch { room = nil }
            loading = false
        }
    }
}
