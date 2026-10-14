import SwiftUI
import Charts

// "Reports per crew": one person's report for one attendance period.
//
// `PersonReportPane` does the loading and draws the cards; it is used twice — as the "Me" pane of
// ReportsView and inside `PersonReportView`, the screen a roster row pushes — so the two can never
// drift apart in what they show or how they fail.

// MARK: - Formatting

/// Formatting shared by the report screens. Formatters are statics because building a
/// DateFormatter is expensive and a roster redraws dozens of rows per scroll.
enum ReportFormat {
    /// Counts can be fractional (a task split between two assignees is 0.5 each), so one decimal
    /// is kept when there is one and dropped when it is ".0": "2.5", "3".
    static func number(_ v: Double?) -> String {
        guard let v, v.isFinite, abs(v) < 1e12 else { return "—" }
        let r = (v * 10).rounded() / 10
        if r == r.rounded() { return AppNumber.int(Int(r)) }
        return AppNumber.decimal(r)
    }

    /// A whole percent, or "—" when the ratio had nothing to measure (0 of 0 is not 0%).
    static func percent(_ ratio: ReportRatio?) -> String {
        guard let p = ratio?.percent else { return "—" }
        return "\(Int(p.rounded()))%"
    }

    static func hours(fromMinutes minutes: Double?) -> String {
        guard let minutes else { return "—" }
        return String(format: T("%@ h"), number(minutes / 60))
    }

    // The contract types `from`/`to` only as strings. Both a plain "YYYY-MM-DD" and a full ISO
    // instant are accepted so the label survives either choice on the server.
    private static let dayParser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = JakartaDay.calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    private static func dayFormatter(_ localeId: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: localeId)
        f.timeZone = JakartaDay.calendar.timeZone
        f.dateFormat = "d MMM"
        return f
    }
    private static let dayEN = dayFormatter("en_US_POSIX")
    private static let dayID = dayFormatter("id_ID")

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        if s.count == 10 { return dayParser.date(from: s) }
        return isoFractional.date(from: s) ?? isoPlain.date(from: s)
    }

    /// "28 Aug", in the app's language rather than the phone's.
    static func day(_ d: Date) -> String {
        (AppLanguage.shared.lang == .id ? dayID : dayEN).string(from: d)
    }

    static func day(_ s: String?) -> String? { date(s).map { day($0) } }

    /// "28 Aug – 27 Sep" for `period`, or for the period `monthsBack` before it.
    ///
    /// The last day is `from` + (days − 1) rather than `to`, because whether `to` is the last day
    /// or the instant after it is not pinned down by the contract; `days` is. Shifting by whole
    /// months is safe for a 28→27 period because every month has a 27th and a 28th.
    static func range(_ period: ReportPeriod?, monthsBack n: Int = 0) -> String? {
        guard let period, let start = date(period.from) else { return nil }
        let cal = JakartaDay.calendar
        let end: Date?
        if let days = period.days, days >= 1 {
            end = cal.date(byAdding: .day, value: Int(days) - 1, to: start)
        } else {
            end = date(period.to)
        }
        guard let end,
              let s = cal.date(byAdding: .month, value: -n, to: start),
              let e = cal.date(byAdding: .month, value: -n, to: end) else { return nil }
        return "\(day(s)) – \(day(e))"
    }

    /// "2026-09" → "2026-07" for n = 2. Nil for anything that is not a "YYYY-MM" key.
    static func shiftKey(_ key: String, monthsBack n: Int) -> String? {
        let parts = key.split(separator: "-")
        guard parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m) else { return nil }
        let index = y * 12 + (m - 1) - n
        guard index >= 0 else { return nil }
        return String(format: "%04d-%02d", index / 12, index % 12 + 1)
    }
}

// MARK: - Period picker

struct ReportPeriodOption: Identifiable, Hashable {
    /// nil = the current period, asked for with no parameter so the server decides which it is.
    let key: String?
    let title: String
    let range: String?
    var id: String { key ?? "current" }
    var menuText: String {
        guard let range, range != title else { return title }
        return "\(title) · \(range)"
    }

    /// This period, last period and the four before that, counted back from the CURRENT period the
    /// server reported. Keys are derived by month arithmetic on its key; without a key (a custom
    /// range, or nothing loaded yet) only "this period" is offered rather than a guessed list.
    static func options(anchor: ReportPeriod?) -> [ReportPeriodOption] {
        var out = [ReportPeriodOption(key: nil, title: T("This period"), range: ReportFormat.range(anchor))]
        guard let key = anchor?.key else { return out }
        for n in 1...5 {
            guard let shifted = ReportFormat.shiftKey(key, monthsBack: n) else { break }
            let range = ReportFormat.range(anchor, monthsBack: n)
            out.append(ReportPeriodOption(key: shifted, title: n == 1 ? T("Last period") : (range ?? shifted), range: range))
        }
        return out
    }
}

struct ReportPeriodMenu: View {
    let options: [ReportPeriodOption]
    @Binding var selection: String?

    private var current: ReportPeriodOption? { options.first { $0.key == selection } }

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button { selection = option.key } label: {
                    if option.key == selection { Label(option.menuText, systemImage: "checkmark") } else { Text(option.menuText) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(current?.range ?? current?.title ?? selection ?? T("This period"))
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
            }
            .font(NXFont.text(13, .bold))
        }
        .accessibilityLabel(T("Period"))
    }
}

// MARK: - Loading pane

/// Loads one person's report for one period and draws it, including its own spinner, error and
/// saved-copy states. `onLoaded` hands the report up (live or saved) together with the period key
/// it was asked for, so ReportsView can learn the viewer's scope and the current period from it.
struct PersonReportPane: View {
    let userId: String
    let periodKey: String?
    var showsIdentity: Bool = false
    var onLoaded: ((PersonReport, String?) -> Void)? = nil

    @Environment(AuthStore.self) private var auth
    @State private var report: PersonReport?
    /// Which period `report` belongs to, so switching period never leaves last period's numbers
    /// on screen under this period's label while the new ones load.
    @State private var loadedKey: String??
    @State private var loading = true
    @State private var error: String?
    @State private var savedAt: Date?

    var body: some View {
        Group {
            if let report, loadedKey == .some(periodKey) {
                ScrollView {
                    VStack(spacing: 12) {
                        if let savedAt { OfflineNotice(savedAt: savedAt) }
                        PersonReportSections(report: report, showsIdentity: showsIdentity)
                    }
                    .padding(16)
                }
                .refreshable { await load() }
            } else if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ErrorState(message: error ?? T("Couldn't load this"), icon: "chart.bar.xaxis") { Task { await load() } }
            }
        }
        .task(id: "\(userId)|\(periodKey ?? "current")") { await load() }
    }

    private func load() async {
        let key = periodKey
        loading = true
        error = nil
        let fresh: PersonReport
        do {
            fresh = try await APIClient.shared.personReport(userId: userId, period: key)
        } catch {
            // A cancelled load belongs to a period (or person) nobody is looking at any more; the
            // task for the new one owns the screen, so this one must not paint an error over it.
            if Task.isCancelled { return }
            fail(error, key: key)
            loading = false
            return
        }
        show(fresh, for: key, savedAt: nil)
        loading = false
    }

    private func fail(_ error: Error, key: String?) {
        do { throw error }
        catch APIError.unauthorized { auth.logout() }
        catch let failure as APIError where failure.nobodyAnswered {
            // Only when NEXUS never answered: a saved copy of THIS person and THIS period beats an
            // error. A refusal the server did make is shown as it is, never covered with old numbers.
            if let hit = ResponseCache.decoded(PersonReport.cacheKey(userId: userId, period: key), as: PersonReport.self) {
                show(hit.value, for: key, savedAt: hit.savedAt)
            } else {
                drop(failure.errorDescription ?? APIError.unreachableText)
            }
        }
        catch let refusal as ReportAccessError {
            drop(refusal.errorDescription ?? T("You can't see this person's report."))
        }
        catch {
            // Never the server's raw text ("Internal server error"): the shared wording (web QA B19).
            drop(FailureText.text(error))
        }
    }

    private func show(_ value: PersonReport, for key: String?, savedAt stamp: Date?) {
        report = value
        loadedKey = .some(key)
        savedAt = stamp
        onLoaded?(value, key)
    }

    private func drop(_ message: String) {
        report = nil
        loadedKey = nil
        savedAt = nil
        error = message
    }
}

/// The screen a roster row opens: somebody else's report, with its own period menu.
struct PersonReportView: View {
    let userId: String
    let options: [ReportPeriodOption]
    @State private var periodKey: String?
    @State private var name: String?

    init(userId: String, name: String? = nil, options: [ReportPeriodOption], periodKey: String?) {
        self.userId = userId
        self.options = options
        _periodKey = State(initialValue: periodKey)
        _name = State(initialValue: name)
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            PersonReportPane(userId: userId, periodKey: periodKey, showsIdentity: true) { report, _ in
                if let n = report.person?.name { name = n }
            }
        }
        .navigationTitle(name ?? T("Report"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { ReportPeriodMenu(options: options, selection: $periodKey) }
        }
    }
}

// MARK: - Cards

struct PersonReportSections: View {
    let report: PersonReport
    var showsIdentity: Bool = false

    private var isCurrent: Bool { report.period?.isCurrent ?? true }

    var body: some View {
        LazyVStack(spacing: 16) {
            if showsIdentity, let person = report.person { identity(person) }
            kpis
            weekly
            overdue
            projects
            attendance
            xp
        }
    }

    // MARK: Identity

    private func identity(_ p: PersonReport.Person) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: p.avatar, initial: String(p.displayName.first ?? "?").uppercased(), size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(p.displayName).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let left = p.leftAt { LeftTag(leftAt: left) }
                }
                let teams = p.teams.map(\.name).joined(separator: ", ")
                if !teams.isEmpty {
                    Text(teams).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 20)
    }

    // MARK: KPIs

    private var kpis: some View {
        let now = report.headline
        let before = report.previous
        return VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                ReportKPITile(label: T("Completed"), value: ReportFormat.number(now?.completed ?? 0),
                              delta: .between(now?.completed, before?.completed, higherIsBetter: true))
                ReportKPITile(label: T("On time"), value: ReportFormat.percent(now?.onTime),
                              sub: now?.onTime.map { "\(ReportFormat.number($0.num))/\(ReportFormat.number($0.den))" },
                              delta: .between(now?.onTime?.percent, before?.onTime?.percent, higherIsBetter: true, percentPoints: true))
                ReportKPITile(label: isCurrent ? T("Overdue now") : T("Overdue"), value: ReportFormat.number(now?.overdue ?? 0),
                              delta: .between(now?.overdue, before?.overdue, higherIsBetter: false),
                              valueColor: (now?.overdue ?? 0) > 0 ? NX.danger : NX.foreground)
                ReportKPITile(label: T("Attendance"), value: ReportFormat.percent(now?.attendanceRate),
                              delta: .between(now?.attendanceRate?.percent, before?.attendanceRate?.percent,
                                              higherIsBetter: true, percentPoints: true))
                ReportKPITile(label: T("Late"), value: ReportFormat.number(now?.late ?? 0),
                              sub: now?.lateMinutes.map { String(format: T("%@ min in total"), ReportFormat.number($0)) },
                              delta: .between(now?.late, before?.late, higherIsBetter: false))
                ReportKPITile(label: T("XP this period"), value: ReportFormat.number(now?.xpScore ?? 0),
                              sub: (now?.xpPenalty).flatMap { $0 != 0 ? String(format: T("%@ XP penalties"), ReportFormat.number(-abs($0))) : nil },
                              delta: .between(now?.xpScore, before?.xpScore, higherIsBetter: true))
            }
            if let prior = ReportFormat.range(report.previousPeriod) {
                Text(String(format: T("Arrows compare with %@."), prior))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    // MARK: Weekly

    private var weekly: some View {
        let weeks = report.work?.weekly ?? []
        let onTimeName = T("On time")
        let otherName = T("Late or no due date")
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel(T("Completed per week"))
            if weeks.isEmpty || weeks.allSatisfy({ $0.completed <= 0 }) {
                EmptyState(icon: "chart.bar", title: T("Nothing completed yet"),
                           subtitle: T("Tasks marked done in this period are counted here, week by week."),
                           compact: true)
            } else {
                Chart {
                    ForEach(Array(weeks.enumerated()), id: \.offset) { item in
                        let label = ReportFormat.day(item.element.from) ?? "W\(item.offset + 1)"
                        BarMark(x: .value("Week", label), y: .value("Tasks", min(item.element.onTime, item.element.completed)))
                            .foregroundStyle(by: .value("Kind", onTimeName))
                        BarMark(x: .value("Week", label), y: .value("Tasks", max(0, item.element.completed - item.element.onTime)))
                            .foregroundStyle(by: .value("Kind", otherName))
                    }
                }
                .chartForegroundStyleScale(domain: [onTimeName, otherName], range: [NX.success, NX.violet.opacity(0.45)])
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: 170)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    // MARK: Overdue

    private var overdue: some View {
        let list = report.work?.overdueList ?? []
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(T("Overdue tasks"))
                Spacer()
                if !list.isEmpty { NexusChip(text: ReportFormat.number(report.work?.overdueNow ?? Double(list.count)), tone: .danger) }
            }
            asOfNote
            if list.isEmpty {
                EmptyState(icon: "checkmark.seal", title: T("Nothing overdue"),
                           subtitle: report.work?.pastAsOf != nil ? T("Nothing was overdue at the end of this period.")
                                                                  : T("Every open task with a due date is still on schedule."),
                           tint: NX.success, compact: true)
            } else {
                // By position: rows from projects the viewer isn't in share an empty id.
                ForEach(Array(list.enumerated()), id: \.offset) { idx, task in
                    if task.isHiddenProject {
                        overdueRow(task)
                    } else {
                        NavigationLink { TaskDetailView(taskId: task.id) } label: { overdueRow(task) }
                            .buttonStyle(.plain)
                    }
                    if idx < list.count - 1 { Divider().overlay(NX.border) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    /// "At the end of the period (27 Sep)" over the open / overdue cards of a past period (web AsOfNote).
    @ViewBuilder private var asOfNote: some View {
        if let day = report.work?.pastAsOf {
            Text(String(format: T("At the end of the period (%@)"), AgendaRange.dayLabel(day)))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private func overdueRow(_ task: ReportOverdueTask) -> some View {
        let hidden = task.isHiddenProject
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(hidden ? NX.border : Self.priorityColor(task.priority)).frame(width: 8, height: 8).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(hidden ? T("Task in a project you're not in") : UntitledText.task(task.title))
                    .font(NXFont.text(14, .semibold)).foregroundStyle(hidden ? NX.mutedFg : NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    if !hidden, let project = task.projectName {
                        Text(project).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    if let count = task.assigneeCount, count > 1 {
                        // Split tasks count as a share, so say so — otherwise "0.5 overdue" reads as a bug.
                        Text(String(format: T("Shared by %@"), ReportFormat.number(count)))
                            .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
            Spacer(minLength: 6)
            NexusChip(text: String(format: T("%@d late"), ReportFormat.number(task.daysOverdue ?? 0)), tone: .danger)
            if !hidden {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    static func priorityColor(_ p: String?) -> Color {
        switch p {
        case "URGENT": return NX.danger
        case "HIGH": return NX.danger
        case "MEDIUM": return NX.blue
        case "LOW": return NX.mutedFg
        default: return NX.border
        }
    }

    // MARK: Projects

    private var projects: some View {
        let lines = report.work?.perProject ?? []
        return VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("By project"))
            asOfNote
            if lines.isEmpty {
                EmptyState(icon: "folder", title: T("No project activity"),
                           subtitle: T("Tasks assigned in this period show up here, grouped by project."),
                           compact: true)
            } else {
                ForEach(lines) { line in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.isOtherProjects ? T("Other projects") : UntitledText.project(line.projectName))
                                .font(NXFont.text(14, .semibold))
                                .foregroundStyle(line.isOtherProjects ? NX.mutedFg : NX.foreground).lineLimit(1)
                                .accessibilityHint(line.isOtherProjects ? T("Projects you're not a member of") : "")
                            Text(String(format: T("%@ done · %@ open"), ReportFormat.number(line.completed), ReportFormat.number(line.open)))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer(minLength: 6)
                        if line.overdue > 0 {
                            NexusChip(text: String(format: T("%@ overdue"), ReportFormat.number(line.overdue)), tone: .danger)
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    // MARK: Attendance

    private var attendance: some View {
        let a = report.attendance
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel(T("Attendance"))
            if let a {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], alignment: .leading, spacing: 10) {
                    stat(T("Present"), ReportFormat.number(a.present ?? 0))
                    stat(T("Late"), ReportFormat.number(a.late ?? 0), tone: (a.late ?? 0) > 0 ? NX.warning : nil)
                    stat(T("Late minutes"), ReportFormat.number(a.lateMinutes ?? 0))
                    stat(T("Left early"), ReportFormat.number(a.earlyLeave ?? 0))
                    stat(T("Absent"), ReportFormat.number(a.absent ?? 0), tone: (a.absent ?? 0) > 0 ? NX.danger : nil)
                    stat(T("Leave"), ReportFormat.number(a.leave ?? 0))
                    stat(T("Sick"), ReportFormat.number(a.sick ?? 0))
                    stat(T("Permit"), ReportFormat.number(a.permit ?? 0))
                    stat(T("Day off"), ReportFormat.number(a.dayOff ?? 0))
                    stat(T("Avg worked"), ReportFormat.hours(fromMinutes: a.avgWorkedMinutes))
                    stat(T("Reflections"), reflectionText(a.reflectionRate))
                    stat(T("Attendance rate"), ReportFormat.percent(a.attendanceRate))
                }
            } else {
                EmptyState(icon: "calendar.badge.clock", title: T("No attendance data"),
                           subtitle: T("Check-ins, leave and permits in this period are counted here."),
                           compact: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func reflectionText(_ r: ReportRatio?) -> String {
        guard let r, r.den > 0 else { return "—" }
        return "\(ReportFormat.number(r.num))/\(ReportFormat.number(r.den)) · \(ReportFormat.percent(r))"
    }

    private func stat(_ label: String, _ value: String, tone: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Text(value).font(NXFont.display(17, .bold)).foregroundStyle(tone ?? NX.foreground).lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: XP

    private var xp: some View {
        let x = report.xp
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel(T("XP this period"))
            if let x {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ReportFormat.number(x.periodScore ?? 0)).font(NXFont.display(30, .black)).foregroundStyle(NX.foreground)
                    Text("XP").font(NXFont.text(13, .bold)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    if let streak = x.streak, let current = streak.current {
                        Label(String(format: T("%@-day streak"), ReportFormat.number(current)), systemImage: "flame.fill")
                            .font(NXFont.text(12, .bold)).foregroundStyle(NX.coral)
                    }
                }
                if let level = x.level { levelBar(level) }
                if let longest = x.streak?.longest {
                    Text(String(format: T("Longest streak: %@ days"), ReportFormat.number(longest)))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Divider().overlay(NX.border)
                if x.penalties.isEmpty {
                    Text(T("No penalties this period.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(x.penalties) { p in
                        HStack {
                            Text(Self.penaltyName(p.kind)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                            Text("×\(ReportFormat.number(p.count))").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            Spacer()
                            Text("\(ReportFormat.number(-abs(p.xp))) XP").font(NXFont.text(13, .bold)).foregroundStyle(NX.danger)
                        }
                    }
                }
            } else {
                EmptyState(icon: "star", title: T("No XP data"),
                           subtitle: T("XP earned and lost in this period shows up here."), compact: true)
            }
            // The report counts XP over the attendance period (28th–27th); the leaderboard counts a
            // calendar month. Saying so up front saves a "why don't these match" message.
            Text(T("Counted over the attendance period, so it can differ from the leaderboard's month."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func levelBar(_ level: PersonXp.Level) -> some View {
        let fraction = (level.isMax ?? false) ? 1 : min(1, max(0, (level.pct ?? 0) / 100))
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(String(format: T("Level %@"), "\(level.level ?? 0)")).font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                if let name = level.name { Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground) }
                Spacer()
                Text((level.isMax ?? false) ? T("Max level") : "\(Int((fraction * 100).rounded()))%")
                    .font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(NX.muted)
                    Capsule().fill(NX.violet).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 7)
        }
    }

    static func penaltyName(_ kind: String) -> String {
        switch kind {
        case "late": return T("Late check-in")
        case "nocheckout": return T("No check-out")
        case "alpha": return T("Absent without notice")
        case "peer": return T("Peer report")
        case "penalty": return T("Penalty")
        case "admin": return T("Admin adjustment")
        case "other": return T("Other")
        default: return kind
        }
    }
}

// MARK: - KPI tile

/// The change against the previous period, and whether that change is good news.
struct ReportDelta {
    enum Mood { case better, worse, flat, unknown }
    let text: String
    let mood: Mood
    let up: Bool

    /// "—" when either side is missing (no previous period, or a ratio with nothing to measure).
    /// Percentages compare whole percents, in points, so 80% → 85% reads "5 pt", not "6.25".
    static func between(_ now: Double?, _ before: Double?, higherIsBetter: Bool, percentPoints: Bool = false) -> ReportDelta {
        guard var now, var before else { return ReportDelta(text: "—", mood: .unknown, up: false) }
        if percentPoints { now = now.rounded(); before = before.rounded() }
        let diff = now - before
        if abs(diff) < 0.05 { return ReportDelta(text: "0", mood: .flat, up: false) }
        let amount = ReportFormat.number(abs(diff))
        return ReportDelta(text: percentPoints ? String(format: T("%@ pt"), amount) : amount,
                           mood: (diff > 0) == higherIsBetter ? .better : .worse, up: diff > 0)
    }
}

struct ReportKPITile: View {
    let label: String
    let value: String
    var sub: String? = nil
    let delta: ReportDelta
    var valueColor: Color = NX.foreground

    private var deltaColor: Color {
        switch delta.mood {
        case .better: return NX.success
        case .worse: return NX.danger
        case .flat, .unknown: return NX.mutedFg
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg).lineLimit(1)
            Text(value).font(NXFont.display(26, .black)).foregroundStyle(valueColor).lineLimit(1).minimumScaleFactor(0.6)
            HStack(spacing: 3) {
                if delta.mood == .better || delta.mood == .worse {
                    Image(systemName: delta.up ? "arrow.up.right" : "arrow.down.right").font(.system(size: 9, weight: .heavy))
                }
                Text(delta.text).font(NXFont.text(11, .bold))
            }
            .foregroundStyle(deltaColor)
            if let sub { Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 18)
        .accessibilityElement(children: .combine)
    }
}
