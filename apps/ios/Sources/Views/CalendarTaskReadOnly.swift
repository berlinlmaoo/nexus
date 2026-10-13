import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Calendar: a task read-only for someone outside its project (web 80a286c, owner decision 13 Oct 2026).
//
// The Master Calendar shows every project's tasks to everyone (a private project's stay masked). The task
// routes (/api/tasks/:id and the rest) stay members-only, so a non-member opens the task through the
// calendar's own GET /api/calendar/task?id=<id>&detail=1: title, status, dates, priority, project, people,
// the description as text, subtasks, comments and attachment names/sizes — never a file URL. Nothing here
// changes anything: no buttons, no links, no menus. Members keep the full TaskDetailView (CalendarView
// decides, from the item's canEdit + editProjectId, the way the web's CalendarPage does).
//
// A masked task (a private project the viewer is not in) is never fetched: "Internal task" and who may
// open it. The server never answers `task` for one either.
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/calendar/task?id=…&detail=1. `task` is there only when the task is on the calendar and not
/// masked; otherwise `found` / `masked` say why.
struct CalTaskDetailResponse: Decodable {
    let found: Bool?
    let masked: Bool?
    let task: CalReadOnlyTask?
}

/// What a non-member may read of a task (the route's Prisma select). Every field is optional except the
/// ids, so a column the server drops later does not turn the whole sheet into an error.
struct CalReadOnlyTask: Decodable {
    struct ProjectRef: Decodable { let id: String?; let name: String? }
    struct ParentRef: Decodable { let id: String?; let title: String? }
    struct ListRef: Decodable { let name: String?; let project: ProjectRef? }
    struct LinkRef: Decodable { let project: ProjectRef? }
    struct Person: Decodable { let id: String?; let name: String?; let email: String?; let avatar: String? }
    struct Assignee: Decodable { let user: Person? }
    struct Subtask: Decodable, Identifiable { let id: String; let title: String?; let status: String? }
    struct Comment: Decodable, Identifiable { let id: String; let content: String?; let createdAt: String?; let user: Person? }
    struct Attachment: Decodable, Identifiable { let id: String; let filename: String?; let size: Double?; let createdAt: String? }

    let id: String
    let title: String?
    let status: String?
    let priority: String?
    let dueDate: String?
    let startDate: String?
    let description: String?
    let parent: ParentRef?
    let taskList: ListRef?
    let taskProjects: [LinkRef]?
    let assignees: [Assignee]?
    let subtasks: [Subtask]?
    let comments: [Comment]?
    let attachments: [Attachment]?
}

/// The Calendar's read-only task: the sheet over a masked row ("Internal task"), and the page pushed for
/// a task the viewer is not a member of. Replaces CalTaskPreview, which read /api/tasks/:id — refused
/// (403) to a non-member since the calendar opened every project's tasks to everyone.
struct CalTaskReadOnly: View {
    let taskId: String
    /// The project's name from the calendar row, until the task itself has arrived.
    let projectName: String?
    let notMember: Bool
    let masked: Bool
    /// Pushed onto the Calendar's own stack, like the full task screen (its bar and Back), rather than
    /// shown as a sheet with a bar and Close of its own.
    var pushed = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var labelWidth: CGFloat = 90
    @State private var task: CalReadOnlyTask?
    @State private var failure: Error?
    /// The server answered, but the task is not on the calendar any more (deleted, cancelled, no PIC).
    @State private var gone = false

    var body: some View {
        if pushed {
            page
        } else {
            NavigationStack {
                page.toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            }
        }
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Only above a task there is to read: not over a private project's task, nor over one
                // that is gone or no longer allowed (the state below says what happened).
                if !masked && failure == nil && !gone {
                    Label(notMember ? T("You're not in this project — view only") : T("Read only"), systemImage: "eye")
                        .font(NXFont.text(CalType.size(12.5))).foregroundStyle(ChipTone.warning.fg)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(ChipTone.warning.bg, in: RoundedRectangle(cornerRadius: 12))
                }
                if masked {
                    EmptyState(icon: "lock", title: T("Members only"),
                               subtitle: T("This is an internal task of a private project. Only its members can open it."),
                               tint: CalTone.accentFill, compact: true)
                } else if let task {
                    CalReadOnlyTaskContent(task: task, fallbackProject: projectName, labelWidth: labelWidth,
                                           stacked: typeSize.isAccessibilitySize)
                } else if gone {
                    EmptyState(icon: "trash", title: T("This task no longer exists"),
                               subtitle: T("It may have been deleted. The calendar drops it on its next refresh."),
                               tint: CalTone.accentFill, compact: true)
                } else if let failure {
                    LoadErrorView(error: failure, what: T("this task"),
                                  notFoundTitle: T("This task no longer exists"),
                                  notFoundMessage: T("It may have been deleted. The calendar drops it on its next refresh."),
                                  forbiddenTitle: T("You can't open this task anymore"),
                                  forbiddenMessage: T("You no longer have access to its project. Ask one of its members if you need it."),
                                  retry: { Task { await load() } }, compact: true)
                } else {
                    SkeletonList(count: 3)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(T("Loading…"))
                }
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(masked ? T("Internal task") : T("Task details"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !masked, task == nil else { return }
            await load()
        }
    }

    private func load() async {
        failure = nil
        gone = false
        do {
            let answer = try await APIClient.shared.calendarTaskDetail(id: taskId)
            if let t = answer.task {
                task = t
            } else {
                // found:false, or masked after all (made private since the row loaded): nothing to read.
                gone = true
            }
        } catch _ where Task.isCancelled {
            return
        } catch {
            failure = error
        }
    }
}

/// The task itself, read-only. Mirrors the web's TaskPreview: details first, then Description, Subtasks,
/// Attachments, Comments — each only when it has something.
private struct CalReadOnlyTaskContent: View {
    let task: CalReadOnlyTask
    let fallbackProject: String?
    let labelWidth: CGFloat
    /// Accessibility text sizes: the label goes above its value instead of in a fixed column.
    let stacked: Bool

    private var project: String? { task.taskList?.project?.name ?? fallbackProject }

    /// The other projects the task is linked into, after its home project.
    private var linked: [String] {
        let home = project
        return (task.taskProjects ?? []).compactMap { $0.project?.name }.filter { !$0.isEmpty && $0 != home }
    }

    private var people: [CalReadOnlyTask.Person] { (task.assignees ?? []).compactMap(\.user) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let parent = task.parent {
                Label(String(format: T("from %@"), UntitledText.task(parent.title)), systemImage: "arrow.turn.down.right")
                    .font(NXFont.text(CalType.size(12))).foregroundStyle(NX.mutedFg)
            }
            Text(UntitledText.task(task.title)).font(NXFont.display(CalType.size(20), .bold)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            details
            description
            subtasks
            attachments
            comments
        }
    }

    // MARK: Details

    private var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            field(T("Status"), CalReadOnlyText.status(task.status))
            if let start = CalReadOnlyText.day(task.startDate) { field(T("Start date"), start) }
            field(T("Due"), CalReadOnlyText.due(task.dueDate))
            field(T("Priority"), CalReadOnlyText.priority(task.priority))
            if let project {
                field(T("Project"), linked.isEmpty ? project : project + " · " + linked.joined(separator: ", "))
            }
            fieldRow(T("People")) { peopleList }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 16)
    }

    private var peopleList: some View {
        VStack(alignment: .leading, spacing: 4) {
            if people.isEmpty {
                Text(T("Nobody yet")).font(NXFont.text(CalType.size(13))).foregroundStyle(NX.mutedFg)
            }
            ForEach(Array(people.enumerated()), id: \.offset) { _, u in
                let name: String = u.name ?? u.email ?? "?"
                HStack(spacing: 6) {
                    CalAvatar(url: u.avatar, initial: calInitials(name), size: 20).accessibilityHidden(true)
                    Text(name).font(NXFont.text(CalType.size(13))).foregroundStyle(NX.foreground)
                }
            }
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        fieldRow(label) {
            Text(value).font(NXFont.text(CalType.size(13))).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// A label and its value side by side; at the accessibility text sizes the label goes above, so
    /// "Prioritas" is never broken in the middle of the word by a fixed column.
    @ViewBuilder private func fieldRow<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        if stacked {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(NXFont.text(CalType.size(13))).foregroundStyle(NX.mutedFg)
                value()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            HStack(alignment: .top, spacing: 10) {
                Text(label).font(NXFont.text(CalType.size(13))).foregroundStyle(NX.mutedFg).frame(width: labelWidth, alignment: .leading)
                value()
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        }
    }

    // MARK: Sections

    private func sectionTitle(_ title: String) -> some View {
        Text(title.uppercased()).calCaps().foregroundStyle(NX.mutedFg).accessibilityAddTraits(.isHeader)
    }

    /// The description as text, the way the web's preview shows it. The column holds the block document's
    /// light-Markdown text (blockdoc.ts docToText); an old description stored as block JSON is flattened
    /// by blockText. The full block document is read through the task routes, which are members-only.
    @ViewBuilder private var description: some View {
        let text = blockText(task.description).trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle(T("Description"))
                Text(text).font(NXFont.text(CalType.size(13.5))).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard(padding: 14, radius: 16)
            }
        }
    }

    @ViewBuilder private var subtasks: some View {
        let subs = task.subtasks ?? []
        if !subs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle(T("Subtasks"))
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(subs) { s in CalReadOnlySubtaskRow(subtask: s) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
    }

    /// Names and sizes only: the route sends no file URL, and nothing here opens a file.
    @ViewBuilder private var attachments: some View {
        let files = task.attachments ?? []
        if !files.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle(T("Attachments"))
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(files) { a in
                        HStack(spacing: 8) {
                            Image(systemName: "paperclip").font(.system(size: CalType.size(12))).foregroundStyle(NX.mutedFg)
                                .accessibilityHidden(true)
                            Text(a.filename ?? T("File")).font(NXFont.text(CalType.size(13.5))).foregroundStyle(NX.foreground)
                                .lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 8)
                            Text(CalReadOnlyText.size(a.size)).font(NXFont.text(CalType.size(12))).monospacedDigit()
                                .foregroundStyle(NX.mutedFg)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
    }

    @ViewBuilder private var comments: some View {
        let list = task.comments ?? []
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle(T("Comments"))
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(list) { c in CalReadOnlyCommentRow(comment: c) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
    }
}

private struct CalReadOnlySubtaskRow: View {
    let subtask: CalReadOnlyTask.Subtask

    var body: some View {
        let done = (subtask.status ?? "").uppercased() == "DONE"
        HStack(spacing: 8) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle").foregroundStyle(done ? NX.success : NX.mutedFg)
                .accessibilityLabel(done ? T("Done") : T("To do"))
            Text(UntitledText.task(subtask.title)).font(NXFont.text(CalType.size(13.5))).strikethrough(done, color: NX.mutedFg)
                .foregroundStyle(done ? NX.mutedFg : NX.foreground)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CalReadOnlyCommentRow: View {
    let comment: CalReadOnlyTask.Comment

    var body: some View {
        let name: String = comment.user?.name ?? "?"
        HStack(alignment: .top, spacing: 8) {
            CalAvatar(url: comment.user?.avatar, initial: calInitials(name), size: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 0) {
                    Text(name).font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(NX.foreground)
                    if let when = CalReadOnlyText.commentTime(comment.createdAt) {
                        Text(" · " + when).font(NXFont.text(CalType.size(12))).foregroundStyle(NX.mutedFg)
                    }
                }
                Text(blockText(comment.content)).font(NXFont.text(CalType.size(13.5))).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The read-only sheet's words for the server's values (the web TaskPreview's).
enum CalReadOnlyText {
    static func status(_ s: String?) -> String {
        switch (s ?? "").uppercased() {
        case "DONE": return T("Done")
        case "IN_PROGRESS": return T("In progress")
        case "IN_REVIEW": return T("In review")
        case "CANCELLED": return T("Cancelled")
        default: return T("To do")
        }
    }

    static func priority(_ p: String?) -> String {
        switch (p ?? "").uppercased() {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "LOW": return T("Low")
        case "NONE": return T("None")
        default: return T("Medium")
        }
    }

    /// The WIB day of an instant ("Monday 13 October 2026"), or nil when there is none.
    static func day(_ iso: String?) -> String? {
        guard let iso, let at = CalDays.instant(iso) else { return nil }
        return CalFormat.day(CalDays.key(at.addingTimeInterval(7 * 3600)), "EEEEdMMMMyyyy")
    }

    /// The WIB day of the due date, plus its time when it has one (not 00:00 UTC / 00:00 WIB).
    static func due(_ iso: String?) -> String {
        guard let iso, let due = CalDays.instant(iso) else { return T("No due date") }
        let wib = due.addingTimeInterval(7 * 3600)
        let comps = CalDays.utc.dateComponents([.hour, .minute], from: wib)
        let utcComps = CalDays.utc.dateComponents([.hour, .minute], from: due)
        let dateOnly = (utcComps.hour == 0 && utcComps.minute == 0) || (comps.hour == 0 && comps.minute == 0)
        let base = CalFormat.day(CalDays.key(wib), "EEEEdMMMMyyyy")
        guard !dateOnly, let h = comps.hour, let m = comps.minute else { return base }
        return "\(base) · \(CalFormat.time(String(format: "%02d:%02d", h, m))) WIB"
    }

    /// "1.5 MB" / "320 KB", as the web writes it.
    static func size(_ bytes: Double?) -> String {
        let b = max(0, bytes ?? 0)
        if b >= 1_048_576 { return AppNumber.bytes(b) }
        return "\(AppNumber.int(max(1, Int((b / 1024).rounded())))) KB"
    }

    /// "13 Oct, 14.05" in Jakarta time, in the app's language.
    static func commentTime(_ iso: String?) -> String? {
        guard let iso, let at = CalDays.instant(iso) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.setLocalizedDateFormatFromTemplate("dMMMHHmm")
        return f.string(from: at)
    }
}
