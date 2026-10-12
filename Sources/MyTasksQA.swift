import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// My Tasks grouping (web lib/my-tasks.ts, QA S-04 / B01, 13 Oct 2026) and the "New task" composer that
// assigns the task to you (QA S-03: a task made from My Tasks must show up in My Tasks).
//
//   Overdue   open, past due: a date-only task once its WIB day is over, a timed task from its time.
//   Due soon  open, due from now up to the end of the WIB day 3 days ahead.
//   Later     open, due later, then open without a due date.
//   Done      done in the last 7 days (completedAt, else updatedAt).
//
// Order inside a group = most urgent first: by due day (oldest overdue first), then priority, then time,
// then title. Undated tasks (end of "Later") go by priority. Nothing is cut here: the screen shows the
// first N of each group and "Show all".
// ─────────────────────────────────────────────────────────────────────────────

enum MyTaskGroupKey: String, Identifiable, Sendable {
    case overdue, soon, later, done
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overdue: return T("Overdue")
        case .soon: return T("Due soon")
        case .later: return T("Later")
        case .done: return T("Done recently")
        }
    }
    /// How many rows a group shows before "Show all" (web MY_TASKS_FIRST).
    var firstRows: Int {
        switch self { case .overdue: return 20; case .soon: return 12; case .later: return 12; case .done: return 8 }
    }
}

struct MyTaskGroup: Identifiable {
    let key: MyTaskGroupKey
    let items: [MyTask]
    var id: String { key.rawValue }
}

enum MyTaskGrouping {
    private static let wib: TimeInterval = 7 * 3600
    private static let day: TimeInterval = 86_400
    private static let priorityRank: [String: Int] = ["URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "NONE": 4]

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return isoFractional.date(from: s) ?? isoPlain.date(from: s)
    }

    /// Whole WIB day number (days since 1970 in UTC+7) of an instant.
    static func wibDayNumber(_ d: Date) -> Int { Int(floor((d.timeIntervalSince1970 + wib) / day)) }

    /// A due without a time: stored at 00:00 UTC (web / API date picks) or at 00:00 WIB (older clients).
    static func isDateOnly(_ d: Date) -> Bool {
        let t = d.timeIntervalSince1970
        if t.truncatingRemainder(dividingBy: day) == 0 { return true }
        return (t + wib).truncatingRemainder(dividingBy: day) == 0
    }

    /// Past due at `now`: a date-only task once its WIB day is over, a timed task from its time.
    static func isOverdue(_ due: String?, now: Date) -> Bool {
        guard let d = parse(due) else { return false }
        return isDateOnly(d) ? wibDayNumber(d) < wibDayNumber(now) : d < now
    }

    /// Whole WIB days late (0 = due today and already past).
    static func daysLate(_ due: Date, now: Date) -> Int { wibDayNumber(now) - wibDayNumber(due) }

    static func daysLateIfOverdue(_ t: MyTask, now: Date) -> Int? {
        guard !t.isDone, isOverdue(t.dueDate, now: now), let d = parse(t.dueDate) else { return nil }
        return daysLate(d, now: now)
    }

    private static func rank(_ p: String?) -> Int { priorityRank[(p ?? "NONE").uppercased()] ?? 4 }

    /// Most urgent first (web byUrgency).
    static func urgentFirst(_ a: MyTask, _ b: MyTask) -> Bool {
        let da = parse(a.dueDate), db = parse(b.dueDate)
        switch (da, db) {
        case (.some, .none): return true
        case (.none, .some): return false
        case let (.some(x), .some(y)):
            let sa = wibDayNumber(x), sb = wibDayNumber(y)
            if sa != sb { return sa < sb }
            if rank(a.priority) != rank(b.priority) { return rank(a.priority) < rank(b.priority) }
            if x != y { return x < y }
        case (.none, .none):
            if rank(a.priority) != rank(b.priority) { return rank(a.priority) < rank(b.priority) }
        }
        return (a.title ?? "").localizedCaseInsensitiveCompare(b.title ?? "") == .orderedAscending
    }

    static func group(_ rows: [MyTask], now: Date, soonDays: Int = 3) -> [MyTaskGroup] {
        // End of the WIB day `soonDays` ahead.
        let soonEnd = Date(timeIntervalSince1970: Double(wibDayNumber(now) + soonDays + 1) * day - wib)
        var overdue: [MyTask] = [], soon: [MyTask] = [], later: [MyTask] = [], done: [MyTask] = []
        for x in rows {
            let status = (x.status ?? "").uppercased()
            if ["DONE", "COMPLETED", "COMPLETE"].contains(status) {
                if let at = parse(x.completedAt) ?? parse(x.updatedAt), now.timeIntervalSince(at) <= 7 * day { done.append(x) }
                continue
            }
            if status == "CANCELLED" { continue }
            guard let d = parse(x.dueDate) else { later.append(x); continue }
            if isOverdue(x.dueDate, now: now) { overdue.append(x) }
            else if d < soonEnd { soon.append(x) }
            else { later.append(x) }
        }
        overdue.sort(by: urgentFirst); soon.sort(by: urgentFirst); later.sort(by: urgentFirst)
        done.sort { (parse($0.completedAt) ?? parse($0.updatedAt) ?? .distantPast) > (parse($1.completedAt) ?? parse($1.updatedAt) ?? .distantPast) }
        return [MyTaskGroup(key: .overdue, items: overdue), MyTaskGroup(key: .soon, items: soon),
                MyTaskGroup(key: .later, items: later), MyTaskGroup(key: .done, items: done)]
            .filter { !$0.items.isEmpty }
    }

    /// "13 Okt" (a date-only due) or "13 Okt 14:00" (a timed one), in WIB.
    static func dueLabel(_ due: String?) -> String? {
        guard let d = parse(due) else { return nil }
        return (isDateOnly(d) ? dayFmt : timeFmt).string(from: d)
    }
    private static let dayFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "d MMM"; f.locale = Locale(identifier: "id_ID")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }()
    private static let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "d MMM HH:mm"; f.locale = Locale(identifier: "id_ID")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }()
}

/// My Tasks → "+": pick the project and the section it goes in; the task is assigned to you (web
/// TaskComposer, QA S-03). A failed save keeps everything typed and says why.
struct MyTaskComposer: View {
    let myId: String?
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var projects: [Project] = []
    @State private var projectId: String = ""
    @State private var sections: [ProjectDetail.Lane] = []
    @State private var sectionId: String = ""
    @State private var title = ""
    @State private var priority = "NONE"
    @State private var hasDue = false
    @State private var due = Date()
    @State private var loadingProjects = true
    @State private var loadingSections = false
    @State private var loadFailed: String?
    @State private var saving = false
    @State private var saveError: String?

    private let priorities = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !projectId.isEmpty && !sectionId.isEmpty && !saving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(T("Task title"), text: $title, axis: .vertical).lineLimit(1...3)
                } footer: {
                    Text(T("Pick the project and the section it goes in. It's assigned to you."))
                }
                Section {
                    if loadingProjects {
                        HStack { ProgressView(); Text(T("Loading…")).foregroundStyle(NX.mutedFg) }
                    } else if let loadFailed {
                        Text(loadFailed).foregroundStyle(NX.danger)
                        Button(T("Try again")) { Task { await loadProjects() } }
                    } else {
                        Picker(T("Project"), selection: $projectId) {
                            Text(T("Pick a project")).tag("")
                            ForEach(projects) { p in Text(UntitledText.project(p.name)).tag(p.id) }
                        }
                        Picker(T("Section"), selection: $sectionId) {
                            if sections.isEmpty { Text(loadingSections ? T("Loading…") : "—").tag("") }
                            ForEach(sections) { l in Text(l.name).tag(l.id) }
                        }
                        .disabled(sections.isEmpty)
                    }
                }
                Section {
                    Picker(T("Priority"), selection: $priority) {
                        ForEach(priorities, id: \.self) { p in Text(p == "NONE" ? T("None") : TaskPriorityName.label(p)).tag(p) }
                    }
                    Toggle(T("Due date"), isOn: $hasDue).tint(NX.violetText)
                    if hasDue {
                        DatePicker(T("Due date"), selection: $due, displayedComponents: .date)
                            .environment(\.timeZone, TimeZone(identifier: "Asia/Jakarta") ?? .current)
                    }
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(NX.danger) }
                }
            }
            .navigationTitle(T("New task"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(T("Create")) }
                    }
                    .disabled(!canSave)
                }
            }
            .interactiveDismissDisabled(saving)
            .task { await loadProjects() }
            .onChange(of: projectId) { _, id in Task { await loadSections(id) } }
        }
    }

    private func loadProjects() async {
        loadingProjects = true
        loadFailed = nil
        do {
            let all = try await APIClient.shared.projects()
            projects = all.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        } catch {
            loadFailed = FailureText.text(error)
        }
        loadingProjects = false
    }

    private func loadSections(_ id: String) async {
        sections = []
        sectionId = ""
        guard !id.isEmpty else { return }
        loadingSections = true
        defer { loadingSections = false }
        guard let d = try? await APIClient.shared.project(id), id == projectId else { return }
        // Only where this person can add tasks (Can edit or more); a read-only project offers no section.
        if !d.canEditProject {
            saveError = T("You can only view this project. Ask the Project Owner if you need more access.")
            return
        }
        saveError = nil
        sections = StatusOptions.ordered(d.taskLists ?? [])
        sectionId = sections.first?.id ?? ""
    }

    private func save() async {
        guard canSave else { return }
        saving = true
        saveError = nil
        let dueText: String? = hasDue ? Self.dayKey(due) : nil
        do {
            _ = try await APIClient.shared.createTask(
                projectId: projectId, taskListId: sectionId,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                status: "TODO", priority: priority, dueDate: dueText,
                assigneeIds: myId.map { [$0] })
            saving = false
            await onCreated()
            dismiss()
        } catch {
            // Everything typed stays; the line says why it didn't go through.
            saving = false
            saveError = FailureText.text(error)
        }
    }

    /// The picked WIB day as "yyyy-MM-dd" (stored date-only, as the web's DateField sends it).
    private static func dayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        return f.string(from: d)
    }
}
