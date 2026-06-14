import SwiftUI

// MARK: - Tab model

enum ProjectTab: String, CaseIterable, Identifiable {
    case overview = "Overview", board = "Board", list = "List", calendar = "Calendar"
    case timeline = "Timeline", pages = "Pages", forms = "Forms", files = "Files", chat = "Chat"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .overview: return "square.grid.2x2.fill"
        case .board:    return "rectangle.split.3x1.fill"
        case .list:     return "list.bullet"
        case .calendar: return "calendar"
        case .timeline: return "chart.bar.xaxis"
        case .pages:    return "doc.text.fill"
        case .forms:    return "list.clipboard.fill"
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
    static func parse(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
    }
    static var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Jakarta")!; return c }
    static func dayLabel(_ d: Date) -> String { fmt("d MMM").string(from: d) }
    static func longLabel(_ d: Date) -> String { fmt("EEEE, d MMM yyyy").string(from: d) }
    static func fmt(_ p: String) -> DateFormatter { let f = DateFormatter(); f.dateFormat = p; f.locale = Locale(identifier: "id_ID"); f.timeZone = cal.timeZone; return f }
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
                    Text(task.title).font(NXFont.text(14, .semibold)).foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                        .strikethrough(task.isDone).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 8) {
                        if let due = ProjDate.parse(task.dueDate) {
                            Label(ProjDate.dayLabel(due), systemImage: "clock").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        if task.totalSubs > 0 {
                            Label("\(task.doneSubs)/\(task.totalSubs)", systemImage: "checklist").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        if task.commentCount > 0 {
                            Label("\(task.commentCount)", systemImage: "bubble.left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
                Spacer(minLength: 4)
                if let p = task.priority, p.uppercased() != "NONE" { NexusChip(text: p.capitalized, tone: prioTone(p)) }
                if let ini = task.assigneeInitial {
                    Text(ini).font(NXFont.text(10, .black)).foregroundStyle(NX.violet)
                        .frame(width: 22, height: 22).background(NX.accentBg, in: Circle())
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
                    Text("MISSION ENERGY").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violet)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.success).frame(width: geo.size.width * Double(pct) / 100)
                        }
                    }.frame(height: 8)
                }.nexusCard()
                // status loot
                VStack(alignment: .leading, spacing: 10) {
                    Text("STATUS LOOT").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violet)
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
                        Text("CREW").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violet)
                        ForEach(members) { m in
                            HStack(spacing: 10) {
                                Text(m.initial).font(NXFont.text(11, .bold)).foregroundStyle(NX.violet)
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
    let detail: ProjectDetail
    let onOpen: (String) -> Void
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                ForEach(detail.taskLists ?? []) { lane in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Text(lane.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                            Text("\(lane.tasks?.count ?? 0)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                                .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                            Spacer()
                        }
                        if (lane.tasks ?? []).isEmpty {
                            Text("Kosong").font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.7)).padding(.vertical, 4)
                        } else {
                            ForEach(lane.tasks ?? []) { ProjectTaskRow(task: $0, onOpen: onOpen) }
                        }
                    }
                }
            }.padding(16)
        }
    }
}

// MARK: - Timeline (chronological by due date)

struct TimelineTab: View {
    let detail: ProjectDetail
    let onOpen: (String) -> Void
    private var scheduled: [(date: Date, task: BoardTask)] {
        detail.allTasks.compactMap { t in ProjDate.parse(t.dueDate).map { ($0, t) } }.sorted { $0.date < $1.date }
    }
    private var unscheduled: [BoardTask] { detail.allTasks.filter { ProjDate.parse($0.dueDate) == nil } }
    private var byDay: [(key: String, date: Date, items: [BoardTask])] {
        let groups = Dictionary(grouping: scheduled) { ProjDate.fmt("yyyy-MM-dd").string(from: $0.date) }
        return groups.map { (k, v) in (k, v.first!.date, v.map(\.task)) }.sorted { $0.key < $1.key }
    }
    var body: some View {
        if scheduled.isEmpty && unscheduled.isEmpty {
            TabEmpty(icon: "chart.bar.xaxis", text: "Belum ada task buat di-timeline.")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(byDay, id: \.key) { day in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 2) {
                                Text(ProjDate.fmt("d").string(from: day.date)).font(NXFont.display(18, .bold)).foregroundStyle(NX.violet)
                                Text(ProjDate.fmt("MMM").string(from: day.date)).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                            }
                            .frame(width: 44)
                            VStack(spacing: 8) { ForEach(day.items) { ProjectTaskRow(task: $0, onOpen: onOpen) } }
                        }
                    }
                    if !unscheduled.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("UNSCHEDULED").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg).padding(.leading, 4)
                            ForEach(unscheduled) { ProjectTaskRow(task: $0, onOpen: onOpen) }
                        }
                    }
                }.padding(16)
            }
        }
    }
}

// MARK: - Calendar

struct CalendarTab: View {
    let detail: ProjectDetail
    let onOpen: (String) -> Void
    @State private var monthOffset = 0
    @State private var selected: Int?

    private var cal: Calendar { ProjDate.cal }
    private var monthDate: Date { cal.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date() }
    private var comps: DateComponents { cal.dateComponents([.year, .month], from: monthDate) }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthDate)?.count ?? 30 }
    private var leadingBlanks: Int {
        let first = cal.date(from: comps) ?? monthDate
        return (cal.component(.weekday, from: first) + 5) % 7   // Monday = 0
    }
    private var tasksByDay: [Int: [BoardTask]] {
        var map: [Int: [BoardTask]] = [:]
        for t in detail.allTasks {
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
                if let sel = selected, let items = tasksByDay[sel], !items.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tanggal \(sel)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ForEach(items) { ProjectTaskRow(task: $0, onOpen: onOpen) }
                    }
                } else {
                    Text(selected == nil ? "Pilih tanggal buat lihat task-nya." : "Gak ada task di tanggal ini.")
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
        return LazyVGrid(columns: cols, spacing: 4) {
            ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 42) }
            ForEach(1...daysInMonth, id: \.self) { day in
                let has = !(tasksByDay[day]?.isEmpty ?? true)
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
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if docs.isEmpty { TabEmpty(icon: "doc.text", text: "Belum ada page di project ini.") }
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
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if forms.isEmpty { TabEmpty(icon: "list.clipboard", text: "Belum ada form di project ini.") }
            else {
                ScrollView {
                    LazyVStack(spacing: 12) { ForEach(forms) { FormCard(form: $0, projectName: projectName) } }.padding(16)
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

// MARK: - Files (read-only browser)

struct ProjectFilesTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var stack: [String] = [""]       // path breadcrumb
    @State private var files: [ProjectFile] = []
    @State private var loading = true

    private var path: String { stack.last ?? "" }

    var body: some View {
        VStack(spacing: 0) {
            if stack.count > 1 {
                Button { stack.removeLast(); Task { await load() } } label: {
                    Label("Kembali", systemImage: "chevron.left").font(NXFont.text(13, .semibold)).foregroundStyle(NX.violet)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.top, 10)
            }
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if files.isEmpty { TabEmpty(icon: "folder", text: "Folder ini kosong.") }
            else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(files) { f in fileRow(f) }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder private func fileRow(_ f: ProjectFile) -> some View {
        let row = HStack(spacing: 12) {
            Image(systemName: f.isdir ? "folder.fill" : "doc.fill").font(.system(size: 16))
                .foregroundStyle(f.isdir ? NX.violet : NX.mutedFg)
                .frame(width: 34, height: 34).background((f.isdir ? NX.violet : NX.mutedFg).opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(subtitle(f)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer()
            if f.isdir { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))

        if f.isdir {
            Button { stack.append(f.relPath ?? f.path); Task { await load() } } label: { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    private func subtitle(_ f: ProjectFile) -> String {
        if f.isdir { return "Folder" }
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
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let room { ChatThreadView(conversationId: room.id, title: room.name ?? projectName) }
            else { TabEmpty(icon: "bubble.left.and.bubble.right", text: "Project chat room belum aktif (perlu backend Messages).") }
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
