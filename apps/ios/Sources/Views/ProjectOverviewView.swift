import SwiftUI

// MARK: - Project Overview (owner, 11 Oct 2026)
//
// A task project's Overview tab, matching the web's ProjectOverview.tsx: how far along the project is,
// what is late or due soon, who carries what, and what just got finished. Everything is computed from
// the project payload the screen already has (GET /api/projects/:id: top-level tasks with status,
// priority, dueDate, completedAt, completedById and assignees). The board's search and filters never
// change these numbers, and subtasks are not counted.
//
// Dates are compared as local calendar days: "overdue" = due before today, "due in 7 days" = today and
// the six days after it, "done this month" = completedAt in the current month. Open = not Done and not
// Cancelled. A count opens the Board (or the List when Board is hidden) filtered by an OverviewDrill.

/// A filter the Overview hands to the Board / List. Only open, top-level tasks match, as on the web.
struct OverviewDrill: Equatable {
    enum Due: Equatable { case overdue, next7, none }
    var due: Due? = nil
    /// A user id, or `OverviewDrill.unassigned` for tasks nobody is on.
    var assigneeId: String? = nil
    /// "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE".
    var priority: String? = nil
    var sectionId: String? = nil
    /// What the filter chip above the board says.
    var title: String

    static let unassigned = "NONE"

    func matches(_ task: BoardTask, laneId: String, today: Date = Date()) -> Bool {
        if task.isSubtask || !OverviewMath.isOpen(task) { return false }
        if let sectionId, sectionId != laneId { return false }
        if let priority, OverviewMath.priority(task) != priority { return false }
        if let assigneeId {
            let ids = OverviewMath.assigneeIds(task)
            if assigneeId == Self.unassigned { if !ids.isEmpty { return false } }
            else if !ids.contains(assigneeId) { return false }
        }
        if let due {
            let d = OverviewMath.dueIn(task, today: OverviewMath.startOfDay(today))
            switch due {
            case .overdue: if !(d.map { $0 < 0 } ?? false) { return false }
            case .next7: if !(d.map { $0 >= 0 && $0 <= 6 } ?? false) { return false }
            case .none: if d != nil { return false }
            }
        }
        return true
    }
}

/// The shared arithmetic of the Overview and its drill filter.
enum OverviewMath {
    static var cal: Calendar { Calendar.current }
    static func startOfDay(_ d: Date) -> Date { cal.startOfDay(for: d) }

    static func status(_ t: BoardTask) -> String { (t.status ?? "TODO").uppercased() }
    static func isDoneStatus(_ s: String) -> Bool { s == "DONE" || s == "COMPLETED" || s == "COMPLETE" }
    static func isClosed(_ s: String) -> Bool { isDoneStatus(s) || s == "CANCELLED" }
    static func isOpen(_ t: BoardTask) -> Bool { !isClosed(status(t)) }
    static func priority(_ t: BoardTask) -> String {
        let p = (t.priority ?? "").uppercased()
        return p.isEmpty ? "NONE" : p
    }
    static func assigneeIds(_ t: BoardTask) -> [String] {
        (t.assignees ?? []).compactMap { $0.user?.id }.filter { !$0.isEmpty }
    }
    /// Days from today to the task's due day (negative = late); nil without a due date.
    static func dueIn(_ t: BoardTask, today: Date) -> Int? {
        guard let d = ProjDate.parse(t.dueDate) else { return nil }
        return cal.dateComponents([.day], from: today, to: startOfDay(d)).day
    }

    static var locale: Locale { Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_US") }

    /// One of two phrasings by count: "1 day late" / "%d days late".
    static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        n == 1 ? T(one) : String(format: T(many), n)
    }
}

/// One row of "Who's working on what".
private struct OverviewPerson: Identifiable {
    let id: String
    let name: String
    let avatar: String?
    let isLead: Bool
    var open = 0
    var overdue = 0
    var doneMonth = 0
}

/// One row of the Sections card.
private struct OverviewSection: Identifiable {
    let id: String
    let name: String
    let total: Int
    let open: Int
    let done: Int
}

/// One part of the progress bar and its legend entry.
private struct OverviewSegment: Identifiable {
    let id: String
    let label: String
    let color: Color
    let n: Int
    /// Listed in the legend even at zero (To do and Done of the fixed statuses).
    let always: Bool
}

/// Everything the Overview shows, computed once per payload.
private struct OverviewStats {
    var total = 0
    /// The progress bar's parts: one per status option in its own name and colour when the project
    /// uses status options (web ProjectOverview `segs`, owner 12 Oct 2026); else the five fixed statuses.
    var segments: [OverviewSegment] = []
    var done = 0
    var doneLast7 = 0
    var byStatus: [String: Int] = [:]
    var byPriority: [String: Int] = [:]
    var open: [BoardTask] = []
    var overdue: [BoardTask] = []
    var upcoming: [BoardTask] = []
    var next7 = 0
    var noDue = 0
    var unassigned = 0
    var completed: [BoardTask] = []
    var people: [OverviewPerson] = []
    var sections: [OverviewSection] = []
    var laneName: [String: String] = [:]
    var names: [String: (name: String, avatar: String?)] = [:]

    static let statusKeys = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]

    init(_ detail: ProjectDetail, now: Date = Date()) {
        let today = OverviewMath.startOfDay(now)
        let cal = OverviewMath.cal
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: today)) ?? today
        let weekAgo = cal.date(byAdding: .day, value: -6, to: today) ?? today

        var people: [String: OverviewPerson] = [:]
        var order: [String] = []
        var nameMap: [String: (name: String, avatar: String?)] = [:]
        for m in detail.members ?? [] where !m.uid.isEmpty {
            nameMap[m.uid] = (m.displayName, m.user?.avatar)
            if people[m.uid] == nil {
                people[m.uid] = OverviewPerson(id: m.uid, name: m.displayName, avatar: m.user?.avatar,
                                               isLead: (m.role ?? "").uppercased() == "LEAD")
                order.append(m.uid)
            }
        }
        func person(_ id: String, _ task: BoardTask) {
            if people[id] == nil {
                let u = (task.assignees ?? []).first { $0.user?.id == id }?.user
                people[id] = OverviewPerson(id: id, name: u?.name ?? "—", avatar: u?.avatar, isLead: false)
                if nameMap[id] == nil { nameMap[id] = (u?.name ?? "—", u?.avatar) }
                order.append(id)
            }
        }

        var tasks: [BoardTask] = []
        for lane in detail.taskLists ?? [] {
            for t in lane.tasks ?? [] where !t.isSubtask {
                tasks.append(t)
                laneName[t.id] = lane.name
            }
        }
        total = tasks.count

        for task in tasks {
            let s = OverviewMath.status(task)
            let key = Self.statusKeys.contains(s) ? s : (OverviewMath.isDoneStatus(s) ? "DONE" : "TODO")
            byStatus[key, default: 0] += 1
            let ids = OverviewMath.assigneeIds(task)
            for id in ids { person(id, task) }
            if OverviewMath.isDoneStatus(s) {
                done += 1
                completed.append(task)
                if let at = ProjDate.parse(task.completedAt) {
                    if at >= weekAgo { doneLast7 += 1 }
                    if at >= monthStart { for id in ids { people[id]?.doneMonth += 1 } }
                }
                continue
            }
            if OverviewMath.isClosed(s) { continue }
            open.append(task)
            byPriority[OverviewMath.priority(task), default: 0] += 1
            let d = OverviewMath.dueIn(task, today: today)
            if let d {
                if d < 0 { overdue.append(task) } else {
                    if d <= 6 { next7 += 1 }
                    if d <= 13 { upcoming.append(task) }
                }
            } else { noDue += 1 }
            if ids.isEmpty { unassigned += 1 }
            for id in ids {
                people[id]?.open += 1
                if let d, d < 0 { people[id]?.overdue += 1 }
            }
        }
        let dueKey: (BoardTask) -> Date = { ProjDate.parse($0.dueDate) ?? .distantPast }
        overdue.sort { dueKey($0) < dueKey($1) }
        upcoming.sort { dueKey($0) < dueKey($1) }
        completed.sort {
            (ProjDate.parse($0.completedAt) ?? .distantPast) > (ProjDate.parse($1.completedAt) ?? .distantPast)
        }
        self.people = order.compactMap { people[$0] }.sorted {
            if $0.open != $1.open { return $0.open > $1.open }
            if $0.overdue != $1.overdue { return $0.overdue > $1.overdue }
            if $0.doneMonth != $1.doneMonth { return $0.doneMonth > $1.doneMonth }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        names = nameMap
        let lanes = detail.taskLists ?? []
        if StatusOptions.inUse(lanes) {
            segments = StatusOptions.ordered(lanes).map { lane in
                OverviewSegment(id: lane.id, label: lane.name, color: lane.swatch.dot,
                                n: (lane.tasks ?? []).filter { !$0.isSubtask }.count, always: false)
            }
        } else {
            segments = Self.statusKeys.map { k in
                OverviewSegment(id: k, label: OverviewStyle.statusLabel(k), color: OverviewStyle.statusColor(k),
                                n: byStatus[k] ?? 0, always: k == "TODO" || k == "DONE")
            }
        }
        sections = (detail.taskLists ?? []).map { lane in
            let own = (lane.tasks ?? []).filter { !$0.isSubtask }
            let closed = own.filter { OverviewMath.isClosed(OverviewMath.status($0)) }.count
            let doneN = own.filter { OverviewMath.isDoneStatus(OverviewMath.status($0)) }.count
            return OverviewSection(id: lane.id, name: lane.name, total: own.count, open: own.count - closed, done: doneN)
        }
    }
}

// MARK: - The tab

struct OverviewTab: View {
    let detail: ProjectDetail
    /// Opens the Board (or List) filtered. nil when neither is shown, so the counts are not tappable.
    var onDrill: ((OverviewDrill) -> Void)?
    let onOpenTask: (String) -> Void
    let onEditBrief: () -> Void
    /// nil when the project has no section to add a task to.
    var onAddTask: (() -> Void)?
    let onOpenMember: (ProfileTarget) -> Void

    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let stats = OverviewStats(detail)
        ScrollView {
            Group {
                if sizeClass == .regular {
                    // Two columns only when both fit. An iPad in portrait with the sidebar open leaves
                    // about 700 pt, less than the person table's columns plus the 340 pt side column:
                    // the row grew past the screen and the right column, and the header above it, were
                    // cut off at the edge (UI tour run 4). Narrower than that, one column.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 20) {
                            main(stats).frame(minWidth: 400, idealWidth: 400, maxWidth: .infinity)
                            side(stats).frame(width: 340)
                        }
                        VStack(spacing: 16) {
                            main(stats)
                            side(stats)
                        }
                    }
                } else {
                    VStack(spacing: 16) {
                        main(stats)
                        side(stats)
                    }
                }
            }
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
            .padding(16)
        }
    }

    @ViewBuilder private func main(_ s: OverviewStats) -> some View {
        VStack(spacing: 16) {
            if s.total == 0 {
                EmptyState(icon: "checklist", title: T("No tasks in this project yet"),
                           subtitle: T("Progress, deadlines and who's working on what show up here once the project has tasks. Add the first one, or open the Board to set up its columns."),
                           actionTitle: onAddTask == nil ? nil : T("Add task"),
                           action: onAddTask)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .nexusCard()
            } else {
                OverviewProgressCard(stats: s, onDrill: onDrill)
                OverviewDeadlinesCard(stats: s, onOpenTask: onOpenTask, onDrill: onDrill)
                OverviewTeamCard(stats: s, onDrill: onDrill)
            }
        }
    }

    @ViewBuilder private func side(_ s: OverviewStats) -> some View {
        VStack(spacing: 16) {
            OverviewBriefCard(detail: detail, onEdit: onEditBrief, onOpenMember: onOpenMember)
            if s.total > 0 {
                OverviewPriorityCard(stats: s, onDrill: onDrill)
                if s.sections.count > 1 { OverviewSectionsCard(stats: s, onDrill: onDrill) }
                OverviewRecentCard(stats: s, onOpenTask: onOpenTask)
            }
            OverviewStatusUpdatesCard(projectId: detail.id, canPost: detail.canEditProject)
        }
    }
}

// MARK: - Pieces

/// A card with a title row (icon, title, optional trailing action) and a hairline under it.
private struct OverviewCard<Content: View, Action: View>: View {
    let title: String
    let icon: String
    @ViewBuilder var action: () -> Action
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .accessibilityHidden(true)
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                action()
            }
            .padding(.horizontal, 16).frame(minHeight: 48)
            Divider().overlay(NX.border)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 0, radius: 18)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension OverviewCard where Action == EmptyView {
    init(title: String, icon: String, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, icon: icon, action: { EmptyView() }, content: content)
    }
}

private enum OverviewStyle {
    static let todo = Color(light: 0x94a3b8, dark: 0x64748b)
    static let sky = Color(light: 0x0ea5e9, dark: 0x38bdf8)
    static let rose = Color(light: 0xf43f5e, dark: 0xfb7185)
    static var late: Color { ChipTone.danger.fg }

    static func statusColor(_ key: String) -> Color {
        switch key {
        case "IN_PROGRESS": return sky
        case "IN_REVIEW": return NX.violet
        case "DONE": return NX.success
        case "CANCELLED": return NX.mutedFg.opacity(0.35)
        default: return todo
        }
    }
    static func statusLabel(_ key: String) -> String {
        switch key {
        case "IN_PROGRESS": return T("In progress")
        case "IN_REVIEW": return T("In review")
        case "DONE": return T("Done")
        case "CANCELLED": return T("Cancelled")
        default: return T("To do")
        }
    }
    static func priorityLabel(_ key: String) -> String {
        switch key {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "MEDIUM": return T("Medium")
        case "LOW": return T("Low")
        default: return T("No priority")
        }
    }
    static func priorityBar(_ key: String) -> Color {
        switch key {
        case "URGENT": return rose
        case "HIGH": return NX.danger
        case "MEDIUM": return sky
        case "LOW": return NX.mutedFg.opacity(0.4)
        default: return NX.mutedFg.opacity(0.25)
        }
    }

    static func initial(_ name: String) -> String { String(name.first ?? "?").uppercased() }

    /// A thin track with a filled share.
    static func bar(_ fraction: Double, color: Color, height: CGFloat = 6) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(NX.muted)
                Capsule().fill(color).frame(width: geo.size.width * max(0, min(1, fraction)))
            }
        }
        .frame(height: height)
    }
}

/// A small text button used for "Show N more", "Edit" and the like.
private struct OverviewLinkButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                .padding(.horizontal, 8).frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Progress

private struct OverviewProgressCard: View {
    let stats: OverviewStats
    let onDrill: ((OverviewDrill) -> Void)?

    private var pct: Int { stats.total > 0 ? Int((Double(stats.done) / Double(stats.total) * 100).rounded()) : 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text(T("Progress")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .accessibilityAddTraits(.isHeader)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(pct)%").font(NXFont.display(32, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
                    Text(String(format: T("%d of %d tasks done"), stats.done, stats.total))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).monospacedDigit()
                }
                Text(stats.doneLast7 > 0
                     ? OverviewMath.plural(stats.doneLast7, "1 finished in the last 7 days", "%d finished in the last 7 days")
                     : T("Nothing finished in the last 7 days"))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                statusBar
                legend
            }
            .padding(16)
            Divider().overlay(NX.border)
            counters
        }
        .nexusCard(padding: 0, radius: 18)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var shownSegments: [OverviewSegment] { stats.segments.filter { $0.n > 0 || $0.always } }

    private var statusBar: some View {
        GeometryReader { geo in
            let parts = stats.segments.filter { $0.n > 0 }
            let gaps = CGFloat(max(0, parts.count - 1)) * 2
            HStack(spacing: 2) {
                ForEach(parts) { seg in
                    Rectangle().fill(seg.color)
                        .frame(width: max(0, (geo.size.width - gaps) * CGFloat(seg.n) / CGFloat(max(1, stats.total))))
                }
            }
        }
        .frame(height: 12)
        .background(NX.muted)
        .clipShape(Capsule())
        .accessibilityElement()
        .accessibilityLabel(stats.segments.filter { $0.n > 0 }.map { "\($0.label) \($0.n)" }.joined(separator: ", "))
    }

    private var legend: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(shownSegments) { seg in
                HStack(spacing: 6) {
                    Circle().fill(seg.color).frame(width: 8, height: 8)
                    Text(seg.label).foregroundStyle(NX.mutedFg).lineLimit(1)
                    Text("\(seg.n)").fontWeight(.semibold).foregroundStyle(NX.foreground)
                    Text("\(stats.total > 0 ? Int((Double(seg.n) / Double(stats.total) * 100).rounded()) : 0)%").foregroundStyle(NX.mutedFg)
                }
                .font(NXFont.text(12)).monospacedDigit()
                .accessibilityElement(children: .combine)
            }
        }
    }

    private struct Counter: Identifiable {
        let id: String
        let label: String
        let value: Int
        let hint: String
        let drill: OverviewDrill
        var late = false
    }

    private var counterItems: [Counter] {
        [
            Counter(id: "open", label: T("Open"), value: stats.open.count,
                    hint: OverviewMath.plural(stats.open.count, "Show 1 open task", "Show %d open tasks"),
                    drill: OverviewDrill(title: T("Open"))),
            Counter(id: "overdue", label: T("Overdue"), value: stats.overdue.count,
                    hint: OverviewMath.plural(stats.overdue.count, "Show 1 overdue task", "Show %d overdue tasks"),
                    drill: OverviewDrill(due: .overdue, title: T("Overdue")), late: true),
            Counter(id: "next7", label: T("Due in 7 days"), value: stats.next7,
                    hint: OverviewMath.plural(stats.next7, "Show 1 task due in 7 days", "Show %d tasks due in 7 days"),
                    drill: OverviewDrill(due: .next7, title: T("Due in 7 days"))),
            Counter(id: "nodue", label: T("No due date"), value: stats.noDue,
                    hint: OverviewMath.plural(stats.noDue, "Show 1 open task without a due date", "Show %d open tasks without a due date"),
                    drill: OverviewDrill(due: OverviewDrill.Due.none, title: T("No due date"))),
            Counter(id: "unassigned", label: T("Unassigned"), value: stats.unassigned,
                    hint: OverviewMath.plural(stats.unassigned, "Show 1 open task nobody is on", "Show %d open tasks nobody is on"),
                    drill: OverviewDrill(assigneeId: OverviewDrill.unassigned, title: T("Unassigned"))),
        ]
    }

    @Environment(\.horizontalSizeClass) private var counterSize

    /// iPad / Mac: tiles wide enough for every label on one line ("No due / date" broke in a 110 pt tile
    /// next to one-line labels, UI tour run 14, P-I22). The phone keeps narrow tiles with two-line labels.
    private var wideCounters: Bool { counterSize == .regular }

    private var counters: some View {
        LazyVGrid(columns: wideCounters ? Array(repeating: GridItem(.flexible(), spacing: 0), count: counterItems.count)
                                     : [GridItem(.adaptive(minimum: 110), spacing: 0)], spacing: 0) {
            ForEach(counterItems) { c in
                Button { onDrill?(c.drill) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .top, spacing: 4) {
                            // Two lines rather than "No due d…" in a narrow tile (UI tour run 9, P4). A one-word
                            // label stays on one line and shrinks a little instead of breaking mid-word
                            // ("Unassigne / d", UI tour run 11, PD-4). Every label reserves two lines, so the
                            // numbers under them sit on one baseline across the row (PD-7).
                            ZStack(alignment: .topLeading) {
                                if !wideCounters {
                                    Text(verbatim: "A\nA").font(NXFont.text(12, .medium)).hidden().accessibilityHidden(true)
                                }
                                Text(c.label).font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
                                    .lineLimit(c.label.contains(" ") && !wideCounters ? 2 : 1)
                                    .minimumScaleFactor(c.label.contains(" ") ? 1 : 0.75)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                            if c.value > 0 && onDrill != nil {
                                Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(NX.mutedFg.opacity(0.6)).accessibilityHidden(true)
                            }
                        }
                        Text("\(c.value)").font(NXFont.display(20, .bold)).monospacedDigit()
                            .foregroundStyle(c.value == 0 ? NX.mutedFg.opacity(0.6) : (c.late ? OverviewStyle.late : NX.foreground))
                    }
                    .padding(.horizontal, wideCounters ? 12 : 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .allowsHitTesting(!(c.value == 0 || onDrill == nil))
                .accessibilityHint(c.value > 0 && onDrill != nil ? c.hint : "")
            }
        }
    }
}

// MARK: Deadlines

private struct OverviewTaskRow: View {
    let task: BoardTask
    let section: String?
    let due: String
    var late = false
    let onOpen: () -> Void

    var body: some View {
        let pr = OverviewMath.priority(task)
        let s = OverviewMath.status(task)
        let started = s == "IN_PROGRESS" || s == "IN_REVIEW"
        Button(action: onOpen) {
            HStack(spacing: 10) {
                Circle().strokeBorder(started ? OverviewStyle.sky : OverviewStyle.todo, lineWidth: 2)
                    .frame(width: 14, height: 14).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(UntitledText.task(task.title)).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let section, !section.isEmpty {
                        Text(section).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if pr == "URGENT" || pr == "HIGH" {
                    Text(OverviewStyle.priorityLabel(pr)).font(NXFont.text(10, .bold)).lineLimit(1)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .foregroundStyle(prioTone(pr).fg).background(prioTone(pr).bg, in: Capsule())
                        .fixedSize()
                }
                avatars
                Text(due).font(NXFont.text(12, late ? .semibold : .regular)).monospacedDigit()
                    .foregroundStyle(late ? OverviewStyle.late : NX.mutedFg)
                    .lineLimit(1).frame(minWidth: 64, alignment: .trailing)
            }
            .padding(.horizontal, 16).frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var avatars: some View {
        let list = Array(task.assigneeAvatars.prefix(2))
        if !list.isEmpty {
            HStack(spacing: -6) {
                ForEach(list, id: \.id) { a in
                    AvatarView(url: a.url, initial: a.initial, size: 22)
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                }
            }
            .accessibilityHidden(true)
        }
    }
}

private struct OverviewDeadlinesCard: View {
    let stats: OverviewStats
    let onOpenTask: (String) -> Void
    let onDrill: ((OverviewDrill) -> Void)?
    @State private var allLate = false
    @State private var allSoon = false
    private let limit = 5

    private func dueLabel(_ t: BoardTask) -> String {
        guard let d = OverviewMath.dueIn(t, today: OverviewMath.startOfDay(Date())) else { return "" }
        if d < 0 { return OverviewMath.plural(-d, "1 day late", "%d days late") }
        if d == 0 { return T("Today") }
        if d == 1 { return T("Tomorrow") }
        guard let date = ProjDate.parse(t.dueDate) else { return "" }
        // "Thu 15 Oct": no comma, day before month in both languages (UI tour run 14, N-35).
        return AppDateLocale.formatter("EEE d MMM", timeZone: ProjDate.cal.timeZone).string(from: date)
    }

    var body: some View {
        OverviewCard(title: T("Deadlines"), icon: "calendar.badge.clock") {
            if stats.overdue.isEmpty && stats.upcoming.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(stats.open.isEmpty ? T("No open tasks, so nothing is due.") : T("Nothing overdue and nothing due in the next 14 days."))
                        .font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    if stats.noDue > 0 {
                        Text(OverviewMath.plural(stats.noDue, "1 open task has no due date. Give it one so it shows up here.", "%d open tasks have no due date. Give them one so they show up here."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                        if let onDrill {
                            OverviewLinkButton(title: T("Show them")) { onDrill(OverviewDrill(due: OverviewDrill.Due.none, title: T("No due date"))) }
                                .padding(.leading, -8)
                        }
                    }
                }
                .padding(16)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    if !stats.overdue.isEmpty {
                        groupHead(T("Overdue"), stats.overdue.count, color: OverviewStyle.late)
                        ForEach(allLate ? stats.overdue : Array(stats.overdue.prefix(limit))) { t in
                            OverviewTaskRow(task: t, section: stats.laneName[t.id], due: dueLabel(t), late: true) { onOpenTask(t.id) }
                        }
                        moreButton(count: stats.overdue.count, all: $allLate)
                        Divider().overlay(NX.border).padding(.top, 4)
                    }
                    groupHead(T("Next 14 days"), stats.upcoming.count, color: NX.mutedFg)
                    if stats.upcoming.isEmpty {
                        Text(T("Nothing due in the next 14 days.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 16).padding(.bottom, 12)
                    } else {
                        ForEach(allSoon ? stats.upcoming : Array(stats.upcoming.prefix(limit))) { t in
                            OverviewTaskRow(task: t, section: stats.laneName[t.id], due: dueLabel(t)) { onOpenTask(t.id) }
                        }
                        moreButton(count: stats.upcoming.count, all: $allSoon)
                    }
                }
                .padding(.bottom, 4)
            }
        }
    }

    private func groupHead(_ title: String, _ n: Int, color: Color) -> some View {
        HStack(spacing: 6) {
            Text(title)
            Text("\(n)").monospacedDigit()
        }
        .font(NXFont.text(12, .semibold)).foregroundStyle(color)
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func moreButton(count: Int, all: Binding<Bool>) -> some View {
        if count > limit {
            OverviewLinkButton(title: all.wrappedValue ? T("Show fewer") : OverviewMath.plural(count - limit, "Show 1 more", "Show %d more")) {
                all.wrappedValue.toggle()
            }
            .padding(.leading, 8)
        }
    }
}

// MARK: Who's working on what

private struct OverviewTeamCard: View {
    let stats: OverviewStats
    let onDrill: ((OverviewDrill) -> Void)?
    @State private var all = false
    private let limit = 8

    var body: some View {
        OverviewCard(title: T("Who's working on what"), icon: "person.2") {
            if stats.people.isEmpty {
                Text(T("No members or assignees yet. Add people to the project, then assign tasks to see the workload here."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
            } else {
                let maxOpen = max(1, max(stats.people.map(\.open).max() ?? 0, stats.unassigned))
                VStack(alignment: .leading, spacing: 0) {
                    header
                    ForEach(all ? stats.people : Array(stats.people.prefix(limit))) { p in
                        row(p, maxOpen: maxOpen)
                    }
                    if stats.unassigned > 0 { unassignedRow(maxOpen: maxOpen) }
                    if stats.people.count > limit {
                        OverviewLinkButton(title: all ? T("Show fewer") : OverviewMath.plural(stats.people.count - limit, "Show 1 more", "Show %d more")) {
                            all.toggle()
                        }
                        .padding(.leading, 8)
                    }
                }
                .padding(.bottom, 4)
            }
        }
    }

    private func numbers<A: View, B: View, C: View>(_ a: A, _ b: B, _ c: C) -> some View {
        HStack(spacing: 6) {
            a.frame(width: 44, alignment: .trailing)
            b.frame(width: 52, alignment: .trailing)
            c.frame(width: 92, alignment: .trailing)
        }
    }

    private var header: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Text(T("Person")).frame(maxWidth: .infinity, alignment: .leading)
            // "Done" over a column of this month's counts, on one line like "Open" / "Overdue": "Done this
            // month" broke onto two (UI tour run 14, N-17 / P-I22 / P-M23); the card says the month below.
            numbers(Text(T("Open")), Text(T("Overdue")), Text(T("Done (month)")))
        }
        .font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
        .accessibilityHidden(true)
    }

    private func num(_ n: Int, late: Bool = false) -> some View {
        Text("\(n)").font(NXFont.text(14, n == 0 ? .regular : .semibold)).monospacedDigit()
            .foregroundStyle(n == 0 ? NX.mutedFg.opacity(0.6) : (late ? OverviewStyle.late : NX.foreground))
    }

    private func row(_ p: OverviewPerson, maxOpen: Int) -> some View {
        Button {
            onDrill?(OverviewDrill(assigneeId: p.id, title: p.name))
        } label: {
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    AvatarView(url: p.avatar, initial: OverviewStyle.initial(p.name), size: 28)
                    VStack(alignment: .leading, spacing: 4) {
                        // Name and Owner chip side by side when both fit whole; on a phone the chip goes under
                        // the name instead of cutting it to "Budi P…" (UI tour run 7).
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 6) {
                                Text(p.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1).fixedSize()
                                if p.isLead { ownerChip }
                            }
                            VStack(alignment: .leading, spacing: 3) {
                                Text(p.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                                if p.isLead { ownerChip }
                            }
                        }
                        OverviewStyle.bar(Double(p.open) / Double(maxOpen), color: NX.violet.opacity(0.7), height: 4)
                            .frame(maxWidth: 160)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                numbers(num(p.open), num(p.overdue, late: true), num(p.doneMonth))
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Not .disabled: a disabled Button greys its whole label, so every member with nothing open
        // read as switched off (UI tour run 5). A row with nothing to drill into just doesn't take the tap.
        .allowsHitTesting(!(p.open == 0 || onDrill == nil))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(p.name)\(p.isLead ? ", " + T("Project Owner") : ""). \(T("Open")) \(p.open), \(T("Overdue")) \(p.overdue), \(T("Done this month")) \(p.doneMonth)")
        .accessibilityAddTraits(.isButton)
    }

    private var ownerChip: some View {
        Text(T("Project Owner")).font(NXFont.text(10, .bold)).foregroundStyle(NX.violetText)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(NX.accentBg, in: Capsule()).fixedSize()
    }

    private func unassignedRow(maxOpen: Int) -> some View {
        Button {
            onDrill?(OverviewDrill(assigneeId: OverviewDrill.unassigned, title: T("Unassigned")))
        } label: {
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    Circle().strokeBorder(NX.border, style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                        .frame(width: 28, height: 28)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(T("Unassigned")).font(NXFont.text(14, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        OverviewStyle.bar(Double(stats.unassigned) / Double(maxOpen), color: NX.mutedFg.opacity(0.4), height: 4)
                            .frame(maxWidth: 160)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                numbers(num(stats.unassigned), Color.clear.frame(height: 1), Color.clear.frame(height: 1))
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .allowsHitTesting(onDrill != nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(T("Unassigned")). \(T("Open")) \(stats.unassigned)")
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: Brief

private struct OverviewBriefCard: View {
    let detail: ProjectDetail
    let onEdit: () -> Void
    let onOpenMember: (ProfileTarget) -> Void
    @State private var expanded = false
    /// The brief is written in Project settings (Full access); below it there is nothing to edit here.
    private var canEdit: Bool { detail.canManageProject }

    private var brief: String { (detail.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var members: [ProjectDetail.ProjectMember] { (detail.members ?? []).filter { !$0.uid.isEmpty } }
    private var leads: [String] { members.filter { ($0.role ?? "").uppercased() == "LEAD" }.map(\.displayName) }

    var body: some View {
        OverviewCard(title: T("Brief"), icon: "doc.text", action: {
            if !brief.isEmpty && canEdit { OverviewLinkButton(title: T("Edit"), action: onEdit) }
        }) {
            VStack(alignment: .leading, spacing: 12) {
                if brief.isEmpty {
                    Text(T("No brief yet. Write what this project is for and what done looks like, so anyone who joins gets it at a glance."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                    if canEdit {
                        Button(action: onEdit) {
                            Label(T("Write a brief"), systemImage: "pencil")
                                .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                                .padding(.horizontal, 12).frame(minHeight: 44)
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    let long = brief.count > 280
                    Text(brief).font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.9))
                        .lineLimit(long && !expanded ? 6 : nil)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    if long {
                        OverviewLinkButton(title: expanded ? T("Show less") : T("Read more")) { expanded.toggle() }
                            .padding(.leading, -8).padding(.vertical, -10)
                    }
                }
                Divider().overlay(NX.border)
                HStack(spacing: 10) {
                    if members.isEmpty {
                        Image(systemName: "person.2").foregroundStyle(NX.mutedFg)
                    } else {
                        HStack(spacing: -6) {
                            ForEach(Array(members.prefix(6))) { m in
                                Button {
                                    onOpenMember(ProfileTarget(userId: m.uid, name: m.user?.name, avatar: m.user?.avatar))
                                } label: {
                                    AvatarView(url: m.user?.avatar, initial: m.initial, size: 28)
                                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(m.displayName)
                            }
                            // The rest as a count, like web's "+4" (UI tour run 7).
                            if members.count > 6 {
                                Text("+\(members.count - 6)").font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                                    .frame(width: 28, height: 28).background(NX.muted, in: Circle())
                                    .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(OverviewMath.plural(members.count, "1 member", "%d members"))
                            .font(NXFont.text(12, .medium)).foregroundStyle(NX.foreground)
                        if !leads.isEmpty {
                            Text(String(format: T("Led by %@"), leads.joined(separator: ", ")))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(16)
        }
    }
}

// MARK: Open tasks by priority

private struct OverviewPriorityCard: View {
    let stats: OverviewStats
    let onDrill: ((OverviewDrill) -> Void)?
    private let keys = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]

    var body: some View {
        OverviewCard(title: T("Open tasks by priority"), icon: "exclamationmark.triangle") {
            if stats.open.isEmpty {
                Text(T("Every task is done or cancelled.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(16)
            } else {
                VStack(spacing: 0) {
                    ForEach(keys.filter { $0 != "NONE" || (stats.byPriority["NONE"] ?? 0) > 0 }, id: \.self) { k in
                        let n = stats.byPriority[k] ?? 0
                        Button {
                            onDrill?(OverviewDrill(priority: k, title: OverviewStyle.priorityLabel(k)))
                        } label: {
                            HStack(spacing: 12) {
                                Text(OverviewStyle.priorityLabel(k)).font(NXFont.text(11, .semibold)).lineLimit(1)
                                    .padding(.horizontal, 8).padding(.vertical, 2)
                                    .foregroundStyle(k == "NONE" ? NX.mutedFg : prioTone(k).fg)
                                    .background(k == "NONE" ? NX.muted : prioTone(k).bg, in: Capsule())
                                    .frame(width: 104, alignment: .leading)
                                OverviewStyle.bar(Double(n) / Double(max(1, stats.open.count)), color: OverviewStyle.priorityBar(k))
                                Text("\(n)").font(NXFont.text(14, .semibold)).monospacedDigit()
                                    .foregroundStyle(n == 0 ? NX.mutedFg.opacity(0.6) : NX.foreground)
                                    .frame(width: 32, alignment: .trailing)
                            }
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .allowsHitTesting(!(n == 0 || onDrill == nil))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(OverviewStyle.priorityLabel(k)) \(n)")
                        .accessibilityAddTraits(.isButton)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}

// MARK: Sections

private struct OverviewSectionsCard: View {
    let stats: OverviewStats
    let onDrill: ((OverviewDrill) -> Void)?

    var body: some View {
        OverviewCard(title: T("Sections"), icon: "list.bullet") {
            VStack(spacing: 0) {
                ForEach(stats.sections) { s in
                    Button {
                        onDrill?(OverviewDrill(sectionId: s.id, title: s.name))
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(s.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer(minLength: 4)
                                Text(s.total > 0 ? String(format: T("%d open · %d done"), s.open, s.done) : T("Empty"))
                                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                            }
                            OverviewStyle.bar(s.total > 0 ? Double(s.done) / Double(s.total) : 0, color: NX.success, height: 4)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .allowsHitTesting(!(s.open == 0 || onDrill == nil))
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.vertical, 4)
        }
    }
}

// MARK: Recently completed

private struct OverviewRecentCard: View {
    let stats: OverviewStats
    let onOpenTask: (String) -> Void

    private func ago(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        let cal = OverviewMath.cal
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
        // A week back at most, then the day ("24 Sep"), as Threads and the notifications do: "20 days ago"
        // next to dated rows elsewhere read inconsistently (UI tour run 14, N-18).
        if days < 7 {
            // In whole days, like web's Intl.RelativeTimeFormat(…, "day"): "5 days ago", not the
            // formatter's own rounding (UI tour run 7). Today: minutes, then hours.
            let f = RelativeDateTimeFormatter()
            f.locale = OverviewMath.locale
            f.dateTimeStyle = .named
            if days <= 0 {
                let mins = Int((min(d, Date()).timeIntervalSinceNow / 60).rounded())
                return abs(mins) < 60
                    ? f.localizedString(from: DateComponents(minute: min(0, mins)))
                    : f.localizedString(from: DateComponents(hour: Int((Double(mins) / 60).rounded())))
            }
            return f.localizedString(from: DateComponents(day: -days))
        }
        // "24 Sep" (the year only outside this one), the app's day format.
        return AppDateLocale.shortDate(d, timeZone: OverviewMath.cal.timeZone)
    }

    var body: some View {
        OverviewCard(title: T("Recently completed"), icon: "checkmark.circle") {
            let rows = Array(stats.completed.prefix(6))
            if rows.isEmpty {
                Text(T("Nothing finished yet. Tasks show up here as they're marked done."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { t in
                        let by = t.completedById.flatMap { stats.names[$0] }
                        let meta = [by.map { String(format: T("by %@"), $0.name) }, ago(t.completedAt)]
                            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                        Button { onOpenTask(t.id) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 15))
                                    .foregroundStyle(NX.success).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 1) {
                                    // Two lines before an ellipsis ("Reimburse Bonus Hosting PR PA…", P-M23).
                                    Text(UntitledText.task(t.title)).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                        .lineLimit(2).multilineTextAlignment(.leading)
                                    if !meta.isEmpty {
                                        Text(meta).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 6)
                                if let by {
                                    AvatarView(url: by.avatar, initial: OverviewStyle.initial(by.name), size: 22)
                                        .accessibilityHidden(true)
                                }
                            }
                            .padding(.horizontal, 16).frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}

// MARK: Status updates

private struct OverviewStatusUpdatesCard: View {
    let projectId: String
    /// Posting (and drafting) an update needs Can edit (server: project write). Below it: read only.
    var canPost = true
    @State private var updates: [ProjectStatusUpdate] = []
    @State private var loading = true
    @State private var text = ""
    @State private var posting = false
    @State private var drafting = false
    @State private var error: String?
    @State private var all = false

    private func when(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        let f = DateFormatter()
        f.locale = OverviewMath.locale
        let sameYear = OverviewMath.cal.component(.year, from: d) == OverviewMath.cal.component(.year, from: Date())
        f.setLocalizedDateFormatFromTemplate(sameYear ? "dMMM" : "dMMMyyyy")
        return f.string(from: d)
    }

    private func statusLabel(_ s: String) -> String {
        switch s.uppercased() {
        case "ON_TRACK": return T("On Track")
        case "AT_RISK": return T("At Risk")
        case "OFF_TRACK": return T("Off Track")
        default: return humanizeEnum(s)
        }
    }

    var body: some View {
        OverviewCard(title: T("Status updates"), icon: "text.bubble", action: {
            if canPost {
            Button { Task { await draft() } } label: {
                HStack(spacing: 4) {
                    if drafting { ProgressView().controlSize(.mini) } else { Image(systemName: "sparkles").font(.system(size: 11, weight: .semibold)) }
                    Text(T("Draft with AI")).font(NXFont.text(12, .semibold))
                }
                .foregroundStyle(NX.violetText)
                .padding(.horizontal, 8).frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(drafting)
            .accessibilityHint(T("Draft an update from this project's tasks"))
            }
        }) {
            VStack(alignment: .leading, spacing: 10) {
                if canPost {
                TextField(T("How is the project going? Wins, blockers, what's next."), text: $text, axis: .vertical)
                    .lineLimit(2...10)
                    .font(NXFont.text(14))
                    .padding(10)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    .accessibilityLabel(T("Status update"))
                if let error {
                    Text(error).font(NXFont.text(12)).foregroundStyle(NX.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Spacer()
                    // The app's primary button (web: the same button at half strength while it can't post). The
                    // plain style's own dimming on top of muted text on a muted fill all but hid the label on
                    // the Mac (UI tour run 13 M-20, run 14 P-M23); NXButtonStyle draws its disabled state
                    // itself, once.
                    Button { Task { await post() } } label: {
                        HStack(spacing: 6) {
                            if posting { ProgressView().tint(NX.background).controlSize(.small) }
                            Text(T("Post update")).font(NXFont.text(14, .semibold))
                        }
                        .padding(.horizontal, 2).frame(minHeight: 40)
                    }
                    .buttonStyle(.nxPrimary)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || posting)
                }
                }
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 8)
                } else if updates.isEmpty {
                    Text(canPost ? T("No updates yet. Post one so the team and BoD can follow along without asking.") : T("No updates yet."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(all ? updates : Array(updates.prefix(3))) { u in
                            Divider().overlay(NX.border)
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) {
                                    let name = u.author?.name ?? T("Someone")
                                    AvatarView(url: u.author?.avatar, initial: OverviewStyle.initial(name), size: 22)
                                        .accessibilityHidden(true)
                                    Text(name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                    if let s = u.status, !s.isEmpty {
                                        Text(statusLabel(s)).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                                            .padding(.horizontal, 6).padding(.vertical, 1)
                                            .background(NX.muted, in: Capsule()).fixedSize()
                                    }
                                    Spacer(minLength: 4)
                                    Text(when(u.createdAt)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                                }
                                Text(u.text).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .textSelection(.enabled)
                            }
                            .padding(.vertical, 10)
                        }
                        if updates.count > 3 {
                            OverviewLinkButton(title: all ? T("Show fewer") : String(format: T("Show all %d updates"), updates.count)) { all.toggle() }
                                .padding(.leading, -8)
                        }
                    }
                }
            }
            .padding(16)
        }
        .task(id: projectId) { await load() }
    }

    private func load() async {
        if let rows = try? await APIClient.shared.statusUpdates(projectId) { updates = rows }
        loading = false
    }

    private func post() async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        posting = true; error = nil
        defer { posting = false }
        do {
            try await APIClient.shared.postStatusUpdate(projectId: projectId, text: body)
            text = ""
            await load()
        } catch {
            self.error = T("Couldn't post the update. Check your connection and try again.")
        }
    }

    private func draft() async {
        drafting = true; error = nil
        defer { drafting = false }
        do {
            let content = try await APIClient.shared.draftStatusUpdate(projectId: projectId)
            if !content.isEmpty { text = content }
        } catch APIError.http(503, let message) where (message ?? "").lowercased().contains("not connected") {
            self.error = T("GIDEON isn't connected on this server.")
        } catch {
            self.error = T("Couldn't draft an update. Try again, or write it yourself.")
        }
    }
}
