import SwiftUI
import UniformTypeIdentifiers

// MARK: - Tab model

enum ProjectTab: String, CaseIterable, Identifiable {
    case overview = "Overview", board = "Board", list = "List", sheet = "Spreadsheet", calendar = "Calendar"
    case timeline = "Timeline", sprints = "Sprints", automations = "Automations"
    case pages = "Pages", forms = "Forms", finance = "Finance", pnl = "P&L", files = "Files", chat = "Chat"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .overview: return "square.grid.2x2.fill"
        case .board:    return "rectangle.split.3x1.fill"
        case .list:     return "list.bullet"
        case .sheet:    return "tablecells"
        case .calendar: return "calendar"
        case .timeline: return "chart.bar.xaxis"
        case .sprints:  return "target"
        case .automations: return "bolt.fill"
        case .pages:    return "doc.text.fill"
        case .forms:    return "list.clipboard.fill"
        case .finance:  return "banknote.fill"
        case .pnl:      return "dollarsign.circle.fill"
        case .files:    return "folder.fill"
        case .chat:     return "bubble.left.and.bubble.right.fill"
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
    switch p.uppercased() { case "URGENT": return .danger; case "HIGH": return .warning; case "MEDIUM": return .info; default: return .neutral }
}

/// Compact task row used by List / Calendar / Timeline.
struct ProjectTaskRow: View {
    let task: BoardTask
    let onOpen: (String) -> Void
    var body: some View {
        Button { onOpen(task.id) } label: {
            HStack(spacing: 10) {
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
                if let p = task.priority, p.uppercased() != "NONE" { NexusChip(text: p.capitalized, tone: prioTone(p)) }
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
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        }
        .buttonStyle(.plain)
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

// MARK: - Overview

struct OverviewTab: View {
    let detail: ProjectDetail
    private var tasks: [BoardTask] { detail.allTasks }
    private var total: Int { tasks.count }
    private var done: Int { tasks.filter(\.isDone).count }
    private var pct: Int { total > 0 ? Int(Double(done) / Double(total) * 100) : 0 }
    private let order = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
    private func count(_ s: String) -> Int { tasks.filter { ($0.status ?? "").uppercased() == s }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // metric grid
                let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
                LazyVGrid(columns: cols, spacing: 10) {
                    metric("Total tasks", "\(total)")
                    metric("Completed", "\(done)")
                    metric("Completion", "\(pct)%")
                    metric("Sections", "\(detail.taskLists?.count ?? 0)")
                }
                // progress
                VStack(alignment: .leading, spacing: 6) {
                    Text("MISSION ENERGY").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.success).frame(width: geo.size.width * Double(pct) / 100)
                        }
                    }.frame(height: 8)
                }.nexusCard()
                // status loot
                VStack(alignment: .leading, spacing: 10) {
                    Text("STATUS LOOT").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
                    ForEach(order, id: \.self) { s in
                        HStack {
                            Text(humanizeEnum(s)).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                            Spacer()
                            Text("\(count(s))").font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                        }
                    }
                }.nexusCard()
                // members
                if let members = detail.members, !members.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("CREW").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
                        ForEach(members) { m in
                            HStack(spacing: 10) {
                                Text(m.initial).font(NXFont.text(11, .bold)).foregroundStyle(NX.violetText)
                                    .frame(width: 30, height: 30).background(NX.accentBg, in: Circle())
                                Text(m.displayName).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                                Spacer()
                            }
                        }
                    }.nexusCard()
                }
            }.padding(16)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(NXFont.display(24, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(NX.border))
    }
}

// MARK: - List

struct ListTab: View {
    let lanes: [ProjectDetail.Lane]   // subtasks already merged in (nested under their parent)
    let onOpen: (String) -> Void
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
                            ForEach(lane.tasks ?? []) { t in
                                if t.isSubtask {
                                    ProjectTaskRow(task: t, onOpen: onOpen)
                                        .padding(.leading, 16)                       // nest under parent
                                        .overlay(alignment: .leading) { Rectangle().fill(Color(hex: "#7c3aed").opacity(0.35)).frame(width: 2).padding(.vertical, 6) }
                                } else {
                                    ProjectTaskRow(task: t, onOpen: onOpen)
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

struct CalendarTab: View {
    let tasks: [BoardTask]   // full set incl. merged subtasks, so dated subtasks land on the calendar too
    let onOpen: (String) -> Void
    var onCreate: (Date?) -> Void = { _ in }
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
            guard let d = ProjDate.parse(t.dueDate) else { continue }
            let c = cal.dateComponents([.year, .month, .day], from: d)
            if c.year == comps.year, c.month == comps.month, let day = c.day { map[day, default: []].append(t) }
        }
        return map
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
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

// MARK: - Files (browse · upload · download · delete · new folder)

struct ShareItem: Identifiable { let id = UUID(); let url: URL }

struct ProjectFilesTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var stack: [String] = [""]       // path breadcrumb
    @State private var files: [ProjectFile] = []
    @State private var loading = true
    @State private var busy = false
    @State private var downloading: String?
    @State private var showImporter = false
    @State private var showNewFolder = false
    @State private var newFolderName = ""
    @State private var deleteTarget: ProjectFile?
    @State private var shareItem: ShareItem?
    @State private var uploadProgress = UploadProgress()

    private var path: String { stack.last ?? "" }
    private var folderName: String { path.isEmpty ? "Files" : (path.split(separator: "/").last.map(String.init) ?? "Files") }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            if uploadProgress.isActive {
                UploadProgressBar(progress: uploadProgress).padding(.horizontal, 16).padding(.bottom, 10)
            }
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if files.isEmpty { TabEmpty(icon: "folder", text: T("This folder is empty. Upload a file or create a folder with the + button.")) }
            else {
                ScrollView {
                    LazyVStack(spacing: 8) { ForEach(files) { f in fileRow(f) } }.padding(16)
                }
            }
        }
        .task { await load() }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            if case let .success(urls) = result, let url = urls.first { Task { await upload(url) } }
        }
        .alert(T("New folder"), isPresented: $showNewFolder) {
            TextField(T("Folder name"), text: $newFolderName)
            Button(T("Create")) { Task { await createFolder() } }
            Button(T("Cancel"), role: .cancel) { newFolderName = "" }
        }
        .confirmationDialog("\(T("Delete")) \"\(deleteTarget?.name ?? "")\"?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button(T("Delete"), role: .destructive) { if let t = deleteTarget { deleteTarget = nil; Task { await delete(t) } } }
            Button(T("Cancel"), role: .cancel) { deleteTarget = nil }
        }
        .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            if stack.count > 1 {
                Button { stack.removeLast(); Task { await load() } } label: {
                    Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.violetText)
                }
            }
            Text(folderName).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
            Spacer()
            if busy { ProgressView().scaleEffect(0.8) }
            Menu {
                Button { showImporter = true } label: { Label(T("Upload file"), systemImage: "arrow.up.doc") }
                Button { newFolderName = ""; showNewFolder = true } label: { Label(T("New folder"), systemImage: "folder.badge.plus") }
            } label: {
                Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(NX.violetText)
            }
            .disabled(busy)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    @ViewBuilder private func fileRow(_ f: ProjectFile) -> some View {
        let isDownloading = downloading == f.path
        let row = HStack(spacing: 12) {
            Image(systemName: f.isdir ? "folder.fill" : "doc.fill").font(.system(size: 16))
                .foregroundStyle(f.isdir ? NX.violetText : NX.mutedFg)
                .frame(width: 34, height: 34).background((f.isdir ? NX.violet : NX.mutedFg).opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(subtitle(f)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer()
            if isDownloading { ProgressView().scaleEffect(0.8) }
            else if f.isdir { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg) }
            else { Image(systemName: "square.and.arrow.down").font(.system(size: 14)).foregroundStyle(NX.mutedFg) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))

        Button {
            if f.isdir { stack.append(f.relPath ?? f.path); Task { await load() } }
            else { Task { await download(f) } }
        } label: { row }
        .buttonStyle(.plain)
        .contextMenu {
            if !f.isdir { Button { Task { await download(f) } } label: { Label(T("Download"), systemImage: "square.and.arrow.down") } }
            Button(role: .destructive) { deleteTarget = f } label: { Label(T("Delete"), systemImage: "trash") }
        }
    }

    private func subtitle(_ f: ProjectFile) -> String {
        if f.isdir { return T("Folder") }
        var parts: [String] = []
        if let s = f.size { parts.append(byteLabel(s)) }
        if let m = ProjDate.parse(f.modified) { parts.append(ProjDate.dayLabel(m)) }
        return parts.joined(separator: " · ")
    }
    private func byteLabel(_ b: Int) -> String {
        let units = ["B", "KB", "MB", "GB"]; var v = Double(b); var i = 0
        while v >= 1024 && i < units.count - 1 { v /= 1024; i += 1 }
        return String(format: i == 0 ? "%.0f %@" : "%.1f %@", v, units[i])
    }

    private func load() async {
        loading = true
        do { files = (try await APIClient.shared.projectFiles(projectId, path: path)).files ?? [] }
        catch APIError.unauthorized { auth.logout() } catch { files = [] }
        loading = false
    }
    private func upload(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        busy = true; defer { busy = false }
        try? await APIClient.shared.uploadProjectFile(projectId, path: path, fileName: url.lastPathComponent,
                                                      data: data, progress: uploadProgress)
        await load()
    }
    private func download(_ f: ProjectFile) async {
        downloading = f.path; defer { downloading = nil }
        if let url = try? await APIClient.shared.downloadProjectFile(projectId, path: f.relPath ?? f.path, fileName: f.name) {
            shareItem = ShareItem(url: url)
        }
    }
    private func delete(_ f: ProjectFile) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.deleteProjectFile(projectId, path: f.relPath ?? f.path)
        await load()
    }
    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces); newFolderName = ""
        guard !name.isEmpty else { return }
        busy = true; defer { busy = false }
        try? await APIClient.shared.createProjectFolder(projectId, name: name, path: path)
        await load()
    }
}

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
        switch p { case "URGENT": return NX.danger; case "HIGH": return NX.warning; case "MEDIUM": return NX.blue; case "LOW": return NX.violet; default: return NX.mutedFg }
    }

    // MARK: custom field rendering (port of web TaskComposer)

    @ViewBuilder private func cfField(_ f: CustomField) -> some View {
        let type = f.type.uppercased()
        let choices = f.choices
        VStack(alignment: .leading, spacing: 6) {
            Text(f.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            if type == "NUMBER" {
                TextField("0", text: cfText(f.id)).keyboardType(.decimalPad).font(NXFont.text(15)).padding(10)
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
                    if !s.isEmpty { try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: s) }
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
