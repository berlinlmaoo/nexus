import SwiftUI

/// The person a people-row hands to the profile screen.
///
/// Carries what the row already knew, so the header draws the moment the push lands and only the
/// detail underneath waits on the network. Hashable because `.navigationDestination(item:)` uses
/// the value itself as the path element.
struct ProfileTarget: Identifiable, Hashable {
    let userId: String
    let name: String?
    let avatar: String?
    var id: String { userId }
}

/// Who somebody is — and, for the people allowed to see it, their record: one attendance period
/// at a time, their row of the crew board, every XP change with its reason, and their requests.
///
/// The top half is assembled from endpoints that scope themselves to the CALLER —
/// `/api/gamification/xp-log` (peer-scoped, and the call whose 403 says "not a colleague"),
/// `/api/workspaces/members`, `/api/gamification/leaderboard`, `/api/teams` and `/api/projects` —
/// so a staff viewer sees the teams and projects they share with this person and nothing more.
///
/// The record (owner request, 28 Sep 2026) comes from `/api/members/<id>/record`, scoped like
/// Reports per crew: yourself, a manager's direct reports, the BoD everyone. Anybody else gets a
/// 403 and the record sections are simply not drawn; a server from before the record (404) falls
/// back to the old "This period" XP list. The BoD can set a day's status from the streak row (the
/// board's own sheet) and remove an XP deduction from the log. The web draws the same page at
/// /people/<id>.
struct MemberProfileView: View {
    let target: ProfileTarget

    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    /// The signed-in person's own role — read, never written, and only to decide what is drawn.
    @State private var viewer = Viewer.shared

    /// Workspace facts: org role, email, join date. Nil for a peer who shares a workspace with the
    /// viewer but not the one `/api/workspaces/members` answers for — the header still draws.
    @State private var member: WorkspaceRoster.Member?
    @State private var standing: LeaderboardRow?
    /// Self only. `/api/gamification/me` is the sole source of a streak and of the level floors the
    /// progress bar needs; there is no peer equivalent for either.
    @State private var mine: Gamification?
    @State private var entries: [XpLogEntry] = []
    /// The server sent only the public part of the log (gains; penalties and attendance rows are personal,
    /// owner 13 Oct 2026): everyone may see that, with a line saying why the rest isn't there.
    @State private var logRestricted = false
    @State private var teams: [Team] = []
    @State private var projects: [Project] = []
    @State private var serverName: String?
    @State private var serverAvatar: String?
    @State private var loading = true
    /// Set when the server says this person is not a peer. Distinct from a load failure: one is a
    /// boundary and the other is a retry.
    @State private var notAPeer = false
    /// Nothing at all came back. Kept apart from `activityFailed` so one dead call does not throw
    /// away the four that worked.
    @State private var failed = false
    @State private var activityFailed = false
    @State private var startingChat = false
    @State private var chatError: String?
    @State private var openThread: ChatDestination?

    // The record.
    @State private var record: MemberRecord?
    @State private var recordState: RecordState = .loading
    /// The board's own rows for this person and period: the cells' colours and the day sheet.
    @State private var recordRows: [String: AttendanceRow] = [:]
    /// nil = the current period (the server decides, with the 28th cut-off).
    @State private var periodKey: String?
    /// The day the streak row opened — the ONE presentation this view owns.
    @State private var selectedRow: AttendanceRow?

    private enum RecordState: Equatable { case loading, loaded, hidden, failed }

    private var isMe: Bool { target.userId == auth.session?.userId }
    /// Who may read the ledger under the score. `Viewer.isBoD` rather than a role string compared
    /// here, so this screen and the announcement composer can never disagree about what a BoD is.
    private var canSeeActivity: Bool { isMe || viewer.isBoD }
    private var canManage: Bool { record?.viewer?.canManageAttendance == true }
    private var displayName: String {
        target.name ?? serverName ?? member?.displayName ?? record?.person.name ?? "—"
    }
    private var avatarURL: String? { target.avatar ?? serverAvatar ?? member?.avatarURL ?? record?.person.avatar }
    private var initial: String { String(displayName.first ?? "?").uppercased() }
    private var roleText: String? { member?.role ?? record?.person.role }
    private var emailText: String? { member?.emailText ?? record?.person.email }
    private var joinedText: String? { member?.joinedAt ?? record?.person.joinedAt }

    // Your own score comes from /api/gamification/me, which is authoritative even for the BoD and
    // One Above All the leaderboard leaves out entirely.
    private var xpTotal: Int? { mine?.xp.totalXp ?? standing?.totalXp }
    private var levelNumber: Int? { mine?.xp.level ?? standing?.level }
    private var levelName: String? { mine?.xp.levelName ?? standing?.levelName }
    private var levelProgress: Double? { mine.map { $0.levelPct } }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle(displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $openThread) { thread in
            ChatThreadView(conversationId: thread.id, title: thread.title, type: "DM")
        }
        // The board's own day sheet: details, and for the BoD "Change status" (Present · Permit ·
        // Leave · Sick · Day off · Clear penalty). A change reloads the whole record.
        .sheet(item: $selectedRow) { row in
            RecordActionsSheet(row: row, canDelete: canManage, canChangeStatus: canManage) { await loadRecord() }
        }
    }

    @ViewBuilder private var content: some View {
        if notAPeer {
            EmptyState(icon: "person.fill.questionmark",
                       title: T("Profile unavailable"),
                       subtitle: T("That person isn't in a workspace you share."))
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    headerCard
                    if loading {
                        ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 24)
                    } else if failed {
                        Text(T("Couldn't load this profile."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        // Back to the spinner first: `load` deliberately does not raise `loading`
                        // itself, or a pull-to-refresh would blank a screen that already has content.
                        Button(T("Try again")) { Task { loading = true; await load() } }
                            .buttonStyle(NexusPrimaryButton(fullWidth: false))
                    } else {
                        standingCard
                        recordSections
                        teamsCard
                        projectsCard
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    // MARK: - header & standing

    /// Who this is, in one card: the face (tap it for the photo), the name with its role, the two
    /// facts the workspace knows, and the one thing to do from here.
    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                // The full-screen viewer belongs to the avatar itself, so this screen keeps its one
                // sheet (the streak day). Initials open nothing.
                ZoomableAvatar(url: avatarURL, initial: initial, size: 72, name: displayName)
                VStack(alignment: .leading, spacing: 6) {
                    Text(displayName).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        if let role = roleText { RoleChip(role: role) }
                        if isMe { NexusChip(text: T("You"), tone: .accent) }
                        if let left = record?.person.leftAt { LeftTag(leftAt: left) }
                    }
                }
                Spacer(minLength: 0)
            }
            let email = (emailText ?? "").isEmpty ? nil : emailText
            let joined = (joinedText ?? "").isEmpty ? nil : joinedText
            if email != nil || joined != nil {
                VStack(alignment: .leading, spacing: 8) {
                    if let email {
                        headerFact("envelope", email).truncationMode(.middle)
                    }
                    if let joined {
                        headerFact("calendar", "\(T("Joined")) \(AgendaRange.dayLabel(AgendaRange.dayKey(joined)))")
                    }
                }
            }
            // Someone who left can't sign in any more: there is no one to message (the web hides it too).
            if !isMe && record?.person.leftAt == nil {
                messageButton
            }
            if let chatError {
                Text(chatError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func headerFact(_ icon: String, _ text: String) -> some View {
        Label {
            Text(text).foregroundStyle(NX.foreground).lineLimit(1)
        } icon: {
            Image(systemName: icon).foregroundStyle(NX.mutedFg)
        }
        .font(NXFont.text(13))
    }

    /// A tonal button the size of the app's other in-card actions. It used to be the primary style
    /// without full width, which has no side padding: a 50 pt violet slab with the bubble against
    /// its left edge and the word against its right (owner, 9 Oct 2026). The visible pill is about
    /// 38 pt; the tappable area is the full 44.
    private var messageButton: some View {
        Button { Task { await startChat() } } label: {
            HStack(spacing: 8) {
                if startingChat {
                    ProgressView().controlSize(.small).tint(NX.violetText)
                } else {
                    Image(systemName: "bubble.left.fill")
                }
                Text(T("Message"))
            }
            .font(NXFont.text(14, .semibold))
            .foregroundStyle(NX.violetText)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(NX.accentBg, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(startingChat)
    }

    private var standingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Named for the number under it. It said LEVEL above "1,000 XP" and a "Level 6" chip,
            // the word twice and neither time about the big number.
            SectionLabel(T("Total XP"))
            if let xp = xpTotal, let level = levelNumber {
                HStack(alignment: .center, spacing: 8) {
                    Text(AppNumber.int(xp))
                        .font(NXFont.display(28, .bold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 8)
                    NexusChip(text: "\(T("Level")) \(level)\(levelName.map { " · \($0)" } ?? "")", tone: .accent)
                }
                .accessibilityElement(children: .combine)
                // Only your own score arrives with the level floors around it, so the bar is drawn
                // for you and a bare number for everybody else — an invented denominator would be
                // worse than none.
                if let pct = levelProgress {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.violet).frame(width: geo.size.width * pct)
                        }
                    }
                    .frame(height: 8)
                }
            } else {
                Text(unrankedNote).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            // The streak has no peer endpoint at all — /api/gamification/me answers for the caller
            // and nobody else — so it is a fact this screen can only ever show about you.
            // One row, name then value, like the period's facts. The count is no longer amber text,
            // which read at about 2:1 on the white card; the flame keeps the colour.
            if let streak = mine?.streakCurrent {
                factRow("flame.fill", iconTint: NX.warning, T("Day streak"), "\(streak) \(T("days"))")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    /// Why there is no score to show. The leaderboard deliberately leaves management out of the
    /// ranking, which is a different thing from having earned nothing.
    private var unrankedNote: String {
        switch (roleText ?? "").uppercased() {
        case "BOD", "ONE_ABOVE_ALL": return T("BoD and One Above All sit outside the ranking.")
        default:                     return T("No points this period yet.")
        }
    }

    // MARK: - record

    @ViewBuilder private var recordSections: some View {
        switch recordState {
        case .loading:
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 12)
        case .failed:
            VStack(alignment: .leading, spacing: 10) {
                Text(T("Couldn't load the attendance record.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                Button(T("Try again")) { Task { recordState = .loading; await loadRecord() } }
                    .buttonStyle(NexusPrimaryButton(fullWidth: false))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .nexusCard()
        case .hidden:
            // Not this viewer's to see, or a server from before the record: the old ledger, for
            // the people who could always read it.
            if canSeeActivity || logRestricted { activityCard }
        case .loaded:
            if let record {
                // A little more air above the period than between its cards: everything from here
                // down is the record for the period this bar names.
                periodBar(record).padding(.top, 8)
                summaryCard(record)
                streakCard(record)
                RecordXpCard(record: record, onChanged: { await loadRecord() })
                    .id("\(record.person.id)-\(record.period.key)")
                requestsCard(record)
            }
        }
    }

    /// The period the record below is about. The arrows are 44 pt to tap (they were 34), and the
    /// left one now fades when there is nothing earlier, like the right one always did.
    private func periodBar(_ r: MemberRecord) -> some View {
        HStack(spacing: 8) {
            periodArrow("chevron.left", label: T("Previous period"), key: r.period.previousKey)
            VStack(spacing: 2) {
                Text(Self.periodLabel(r.period.label ?? r.period.key)).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                    .multilineTextAlignment(.center)
                Text(T("Attendance period · 28th to 27th")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            periodArrow("chevron.right", label: T("Next period"), key: r.period.nextKey)
        }
        .foregroundStyle(NX.foreground)
    }

    /// The server's "28 Sep – 27 Oct 2026" without the current year, as every other date in the app
    /// (UI tour run 13, F-14); another year stays ("28 Dec 2026 – 27 Jan 2027").
    static func periodLabel(_ label: String) -> String {
        let year = String(Calendar(identifier: .gregorian).component(.year, from: Date()))
        guard label.hasSuffix(" " + year) else { return label }
        let trimmed = String(label.dropLast(year.count + 1))
        // Any other four-digit year left means the period spans two years: keep the label whole.
        return trimmed.range(of: #"\b\d{4}\b"#, options: .regularExpression) == nil ? trimmed : label
    }

    private func periodArrow(_ icon: String, label: String, key: String?) -> some View {
        Button { Task { await switchPeriod(key) } } label: {
            Image(systemName: icon).font(.system(size: 15, weight: .bold))
                .frame(width: 44, height: 44)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        }
        .buttonStyle(.plain)
        .disabled(key == nil)
        .opacity(key == nil ? 0.35 : 1)
        .accessibilityLabel(label)
    }

    /// One period at a glance, read top to bottom: the score, the six day counts, three facts as
    /// name and value, and last the line that explains how the score is counted. That line used to
    /// sit between the score and the counts, the longest text in the card in the way of the numbers.
    private func summaryCard(_ r: MemberRecord) -> some View {
        let score = r.summary?.score
        let c = r.summary?.counts
        let d = r.summary?.dayOff
        let xp = r.summary?.xp
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SectionLabel(r.period.isCurrent == true ? T("THIS PERIOD") : T("PERIOD"))
                Spacer(minLength: 8)
                if r.period.isCurrent == true, let el = r.period.daysElapsed, let all = r.period.days {
                    Text(String(format: T("Day %d of %d"), el, all)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                }
            }
            if let score {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    (StreakBoardCard.scoreText(worked: score.totalWorked ?? score.worked, target: score.working))
                        .font(NXFont.display(30, .bold)).foregroundStyle(NX.foreground)
                    Text(T("Score")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                }
                .accessibilityElement(children: .combine)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                countTile(T("Present"), c?.present, AttTone.present)
                countTile(T("Permit"), c?.permit, AttTone.permit)
                countTile(T("Leave"), c?.leave, AttTone.leave)
                countTile(T("Sick"), c?.sick, AttTone.sick)
                // One wording on every screen (UI tour run 13, F-12 / F-13): "Days off", "Absent" (TK stays Indonesian).
                countTile(T("Days off"), c?.dayOff, AttTone.dayoff)
                countTile(T("Absent"), c?.absent, AttTone.absent)
            }
            Divider().overlay(NX.border)
            // Name on the left, value on the right; the card already says which period, so the
            // rows no longer repeat "this period" after it.
            VStack(alignment: .leading, spacing: 10) {
                let lateMinutes = c?.lateMinutes ?? 0
                let lateDays = c?.lateDays ?? 0
                factRow("clock", T("Late"), lateMinutes > 0
                        ? (lateDays == 1 ? String(format: T("%d min · 1 day"), lateMinutes)
                                         : String(format: T("%d min · %d days"), lateMinutes, lateDays))
                        : T("Never"))
                if let d {
                    // "Allowance", not "Day off": the tile above already counts the days off taken.
                    factRow("calendar.badge.minus", T("Days off allowance"),
                            String(format: T("%d of %d used · %d left"), d.usedRaw ?? d.used ?? 0, d.quota ?? 4, d.remaining ?? 0)
                            + ((d.bonusDays ?? 0) > 0 ? " · " + String(format: T("incl. %d extra"), d.bonusDays ?? 0) : ""))
                }
                if let xp {
                    factRow("sparkles", "XP",
                            String(format: T("+%d gained · %d lost"), xp.gained ?? 0, xp.lost ?? 0)
                            + ((xp.removed ?? 0) > 0 ? " · " + String(format: T("%d removed by the BoD"), xp.removed ?? 0) : ""))
                    // Absences on the tiles and nothing lost read as a contradiction (UI tour run 14, N-32):
                    // say when an absence costs XP and when it does not.
                    if (c?.absent ?? 0) > 0 && (xp.lost ?? 0) == 0 {
                        Text(T("No XP was taken for these absences. An absence costs XP once the nightly check has run; a day excused by a permit, or lost to an outage, costs nothing."))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let score, let days = r.period.days {
                Label {
                    // Joined during the period: the score counts from their first day, with a prorated
                    // allowance (QA S-20, the board's rule too).
                    if let owedDays = score.days, owedDays < days, let from = score.from, !from.isEmpty {
                        Text(String(format: T("Days worked (present or permit) out of %d working days, from %@: %d days minus %d days-off allowance."),
                                    score.working, AgendaRange.dayLabel(from), owedDays, score.allowance ?? 0))
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(String(format: T("Days worked (present or permit) out of %d working days: %d days minus %d days-off allowance."), score.working, days, d?.quota ?? 4))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: {
                    Image(systemName: "info.circle")
                }
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    /// A zero reads quieter than a count, so the days that did happen stand out when scanning.
    private func countTile(_ label: String, _ value: Int?, _ tone: AttTone) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(tone.color).frame(width: 10, height: 10)
                Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
            }
            Text("\(value ?? 0)").font(NXFont.display(20, .bold))
                .foregroundStyle((value ?? 0) == 0 ? NX.mutedFg : NX.foreground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .accessibilityElement(children: .combine)
    }

    /// "Name ........ value". When both no longer fit on one line (a long value, or large text),
    /// the value moves under its name instead of squeezing it.
    private func factRow(_ icon: String, iconTint: Color = NX.mutedFg, _ title: String, _ value: String) -> some View {
        let name = Label {
            Text(title).foregroundStyle(NX.mutedFg)
        } icon: {
            Image(systemName: icon).foregroundStyle(iconTint)
        }
        .font(NXFont.text(13))
        let shown = Text(value).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                name
                Spacer(minLength: 12)
                shown.lineLimit(1)
            }
            VStack(alignment: .leading, spacing: 3) {
                name
                shown.fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The server's day letter → the board's tone, for a day with no history row in hand.
    private static func tone(letter: String?) -> AttTone {
        switch letter ?? "" {
        case "P", "L": return .present
        case "I":      return .permit
        case "C":      return .leave
        case "S":      return .sick
        case "D":      return .dayoff
        case "A":      return .absent
        default:       return .none
        }
    }

    private func streakCard(_ r: MemberRecord) -> some View {
        let days = r.days ?? []
        return VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Attendance board"))
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(days) { day in dayCell(day, r) .id(day.date) }
                    }
                    .padding(.vertical, 2)
                }
                .onAppear {
                    if let today = days.first(where: { $0.isToday == true }) { proxy.scrollTo(today.date, anchor: .center) }
                }
            }
            // The tiles are coloured by the day's status (red = absent); the small dot on a tile is the XP
            // deduction. The old line only named the dot, so red tiles read as deductions (F-11).
            Text(PlatformWording.tapOrClick(tap: "Tap a day for its detail. The colour is the day's status; a small red dot means XP was deducted for that day.", click: "Click a day for its detail. The colour is the day's status; a small red dot means XP was deducted for that day."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    @ViewBuilder private func dayCell(_ day: MemberRecord.Day, _ r: MemberRecord) -> some View {
        let row = recordRows[day.date]
        let tone = row.map { AttTone.of($0) } ?? Self.tone(letter: day.tone)
        let future = day.isFuture == true
        // Everybody opens a real record; the BoD also opens the server's id-less rows (ABSENT,
        // request-covered) and an empty past day, to set a status. Never a future day — the
        // server refuses to override one.
        let openable: Bool = {
            if future { return false }
            if let row { return row.id != nil || canManage }
            return canManage
        }()
        Button {
            selectedRow = row ?? AttendanceRow.emptyDay(userId: r.person.id, name: r.person.name ?? displayName, dateKey: day.date)
        } label: {
            VStack(spacing: 3) {
                Text(T(day.weekday ?? "").uppercased()).font(NXFont.text(8, .semibold)).foregroundStyle(NX.mutedFg)
                Text("\(day.day ?? 0)").font(NXFont.text(10, .bold)).foregroundStyle(day.isToday == true ? NX.violetText : NX.mutedFg)
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(tone.color)
                        .frame(width: 24, height: 24)
                        .overlay {
                            if day.isToday == true {
                                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.violet, lineWidth: 2).padding(-3)
                            }
                        }
                    if (day.penaltyXp ?? 0) < 0 {
                        Circle().fill(NX.danger).frame(width: 7, height: 7).offset(x: 2, y: -2)
                    }
                }
                .opacity(future ? 0.4 : 1)
            }
            .frame(width: 30)
        }
        .buttonStyle(.plain)
        .disabled(!openable)
        .accessibilityLabel("\(day.date) · \(tone.label)")
    }

    private func requestsCard(_ r: MemberRecord) -> some View {
        let list = r.requests ?? []
        let mine = r.person.isSelf == true
        let fileOne: (() -> Void)? = mine ? { router.go(.attendance) } : nil
        return VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Requests"))
            if list.isEmpty {
                EmptyState(icon: "tray",
                           title: T("No requests this period"),
                           subtitle: mine ? T("Leave, sick notes, permits and days off you file show up here with their status.")
                                          : T("Nothing was filed for these dates. What they file shows up here with its status."),
                           actionTitle: mine ? T("File a request") : nil,
                           action: fileOne,
                           compact: true)
                    .frame(maxWidth: .infinity)
            } else {
                ForEach(list) { req in
                    if req.isAuto == true {
                        requestRow(req)
                    } else {
                        // The request itself, with Approve / Reject for whoever reviews it.
                        Button { router.open(.attendanceRequest(req.id)) } label: { requestRow(req) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func requestRow(_ req: MemberRecord.Request) -> some View {
        let from = req.startDate ?? "", to = req.endDate ?? ""
        let dates = from == to ? AgendaRange.dayLabel(from) : "\(AgendaRange.dayLabel(from)) – \(AgendaRange.dayLabel(to))"
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(req.isAuto == true ? T("Day off cut automatically") : Self.requestLabel(req.type))
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                Text(dates + ((req.days ?? 1) > 1 ? " · \(req.days ?? 1) \(T("days"))" : ""))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if let reason = req.reason, !reason.isEmpty {
                    Text(reason).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(2)
                }
                if let who = req.reviewedBy?.name {
                    Text(String(format: T("Reviewed by %@"), who) + ((req.reviewNote ?? "").isEmpty ? "" : " — \(req.reviewNote ?? "")"))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            NexusChip(text: Self.statusLabel(req.status), tone: Self.statusTone(req.status))
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private static func requestLabel(_ type: String?) -> String {
        switch (type ?? "").uppercased() {
        case "LEAVE":    return T("Leave")
        case "SICK":     return T("Sick")
        case "PERMIT":   return T("Permit")
        case "DAY_OFF":  return T("Day off")
        case "RED_DATE": return T("Public holiday")
        default:         return type ?? "—"
        }
    }
    private static func statusLabel(_ s: String?) -> String {
        switch (s ?? "").uppercased() {
        case "APPROVED":              return T("Approved")
        case "PENDING":               return T("Pending")
        case "REJECTED":              return T("Rejected")
        case "CANCELED", "CANCELLED": return T("Canceled")
        default:                      return s ?? ""
        }
    }
    private static func statusTone(_ s: String?) -> ChipTone {
        switch (s ?? "").uppercased() {
        case "APPROVED": return .success
        case "PENDING":  return .warning
        case "REJECTED": return .danger
        default:         return .neutral
        }
    }

    // MARK: - teams, projects, legacy ledger

    private var teamsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Teams"))
            if teams.isEmpty {
                Text(isMe ? T("Not on a team yet.") : T("No team you can both see."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(teams) { team in
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color(hex: team.color ?? "#7b68ee"))
                            .frame(width: 10, height: 10)
                        Text(team.name).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer(minLength: 6)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private var projectsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Projects"))
            if projects.isEmpty {
                Text(isMe ? T("No projects yet.") : T("No project you can both see."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(projects) { project in
                    // The project's own mark (photo or the grey page), not a colour dot; the status only when it
                    // is something other than Active, so it isn't repeated on every row (UI tour run 7).
                    HStack(spacing: 10) {
                        ProjectMark(icon: project.icon, color: project.color, size: 18, projectId: project.id)
                        Text(project.name).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer(minLength: 6)
                        if (project.status ?? "ACTIVE").uppercased() != "ACTIVE" {
                            Text(project.statusLabel).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    /// The pre-record ledger, kept for a server without /api/members/<id>/record.
    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(logRestricted ? T("XP gained this period") : T("THIS PERIOD"))
            if logRestricted {
                Text(T("Penalties and attendance details are private: only this person and the people above them can see them."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            if activityFailed {
                Text(T("Couldn't load.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else if entries.isEmpty {
                Text(T("No points moved this period.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(entries) { entry in
                    HStack(spacing: 10) {
                        Text(entry.signedAmount)
                            .font(NXFont.display(14, .bold))
                            .foregroundStyle(entry.amount < 0 ? NX.danger : NX.success)
                            .frame(width: 52, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.label).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(2)
                            if !entry.dayLabel.isEmpty {
                                Text(entry.dayLabel).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    // MARK: - work

    private func load() async {
        failed = false
        activityFailed = false
        notAPeer = false
        // The XP log is the one call that answers "may I look at this person at all" — it is
        // peer-scoped server-side and 403s for somebody outside every workspace we share. The rest
        // run alongside it because they are all list endpoints that scope themselves to the caller.
        async let log = APIClient.shared.xpLog(userId: target.userId)
        async let rosterRes = try? APIClient.shared.roster()
        async let boardRes = try? APIClient.shared.leaderboard()
        async let teamsRes = try? APIClient.shared.teams()
        async let projectsRes = try? APIClient.shared.projects()
        async let recordLoad: Void = loadRecord()

        // Whether the ledger is drawn is a role question, and the role may still be unknown here:
        // Viewer fills itself from the More tab and the sidebar, while this screen opens from
        // Search, a team, a project board or the leaderboard. Started after the calls above so
        // it overlaps them, and it is a no-op every time but the first.
        await viewer.loadIfNeeded()

        let roster = await rosterRes
        let board = await boardRes
        let allTeams = await teamsRes
        let allProjects = await projectsRes
        _ = await recordLoad

        do {
            let page = try await log
            // Zero-amount rows are the server's own bookkeeping (an attendance waiver is written as
            // a 0 XP entry so the penalty job knows to skip that day, and a deduction the BoD
            // removed reads 0) — a ledger line that moved nothing has nothing to say here.
            entries = (page.rows ?? []).filter { $0.amount != 0 }
            logRestricted = page.restricted == true
            serverName = page.user?.name
            serverAvatar = page.user?.avatar
        } catch APIError.unauthorized {
            auth.logout()
            return
        } catch APIError.http(let code, _) where code == 403 {
            notAPeer = true
            loading = false
            return
        } catch {
            activityFailed = true
        }

        member = (roster?.members ?? []).first { $0.userId == target.userId }
        standing = (board ?? []).first { $0.userId == target.userId }
        teams = (allTeams ?? []).filter { team in
            (team.members ?? []).contains { $0.uid == target.userId }
        }
        projects = (allProjects ?? []).filter { project in
            (project.members ?? []).contains { $0.user?.id == target.userId }
        }
        if isMe { mine = try? await APIClient.shared.gamification() }
        failed = activityFailed && roster == nil && allTeams == nil && allProjects == nil && record == nil
        loading = false
    }

    /// The record for `periodKey`, then the board's rows for that same period (the cells and the
    /// day sheet). Re-run after every change made from this screen.
    private func loadRecord() async {
        do {
            let r = try await APIClient.shared.memberRecord(userId: target.userId, period: periodKey)
            let scope = r.person.isSelf == true ? "me" : "workspace"
            let rows = (try? await APIClient.shared.attendanceHistory(scope: scope, month: r.period.key, userId: r.person.id)) ?? []
            var byDay: [String: AttendanceRow] = [:]
            for row in rows where row.user?.id == nil || row.user?.id == r.person.id {
                if let d = row.attendanceDate, d.count >= 10 { byDay[String(d.prefix(10))] = row }
            }
            record = r
            recordRows = byDay
            recordState = .loaded
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(let code, _) where code == 403 || code == 404 {
            // 403: not this viewer's to see. 404: a server from before the record.
            record = nil
            recordState = .hidden
        } catch {
            recordState = record == nil ? .failed : .loaded
        }
    }

    private func switchPeriod(_ key: String?) async {
        guard let key else { return }
        periodKey = key
        await loadRecord()
    }

    private func startChat() async {
        guard !startingChat else { return }
        startingChat = true
        defer { startingChat = false }
        chatError = nil
        do {
            let convo = try await APIClient.shared.createConversation(type: "DM", userIds: [target.userId], name: nil)
            openThread = ChatDestination(id: convo.id, title: displayName)
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            chatError = T("Couldn't start that chat. Try again.")
        }
    }
}

/// The record's XP log: every change in the period with its reason, older periods on demand, and
/// the BoD's "Remove this deduction". Its own view so the removal confirmation is its own
/// presentation — the profile screen above already owns the day sheet.
private struct RecordXpCard: View {
    let record: MemberRecord
    let onChanged: () async -> Void

    @Environment(AuthStore.self) private var auth
    /// Earlier periods loaded by "Load older", oldest last.
    @State private var older: [OlderChunk] = []
    @State private var loadingOlder = false
    @State private var confirm: RecordXpEntry?
    @State private var note = ""
    @State private var busy = false
    @State private var message: String?
    @State private var errorText: String?

    private var last: RecordXp? { older.last?.xp ?? record.xp }
    private var name: String { record.person.name ?? T("this staff member") }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(T("XP log"))
                Spacer()
                if let t = record.summary?.xp {
                    // Said with its unit, not "+0 · 0" (UI tour run 15, R15-I-21).
                    Text(String(format: T("+%@ XP gained · %@ XP lost"), AppNumber.int(t.gained ?? 0), AppNumber.int(t.lost ?? 0)))
                        .font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                }
            }
            let current = record.xp?.entries ?? []
            // The empty state's own button walks back a period, while there is anything older.
            let canWalkBack = last?.hasOlder == true && older.isEmpty
            let walkBack: (() -> Void)? = canWalkBack ? { Task { await loadOlder() } } : nil
            if current.isEmpty {
                EmptyState(icon: "sparkles",
                           title: T("No XP moved this period"),
                           subtitle: T("XP comes from quests and goes on attendance penalties — late, no check-out, absent."),
                           actionTitle: canWalkBack ? T("Load older") : nil,
                           actionIcon: "clock.arrow.circlepath",
                           action: walkBack,
                           compact: true)
                    .frame(maxWidth: .infinity)
            } else {
                ForEach(current) { entry in row(entry) }
            }
            ForEach(older) { chunk in
                Text(String(format: T("Period ending %@"), chunk.period)).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                    .padding(.top, 6)
                if (chunk.xp.entries ?? []).isEmpty {
                    Text(T("No XP moved in that period.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(chunk.xp.entries ?? []) { entry in row(entry) }
                }
            }
            if let message { Text(message).font(NXFont.text(12, .semibold)).foregroundStyle(NX.success) }
            if let errorText { Text(errorText).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }
            if last?.hasOlder == true, !(current.isEmpty && older.isEmpty) {
                Button { Task { await loadOlder() } } label: {
                    HStack(spacing: 6) {
                        if loadingOlder { ProgressView().controlSize(.small) }
                        Text(T("Load older")).font(NXFont.text(13, .bold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .foregroundStyle(NX.foreground)
                .disabled(loadingOlder)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
        .alert(T("Remove this deduction?"), isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { entry in
            TextField(T("Why? (optional)"), text: $note)
            Button(T("Remove deduction"), role: .destructive) { Task { await remove(entry) } }
            Button(T("Cancel"), role: .cancel) { confirm = nil }
        } message: { entry in
            Text(String(format: T("%@ · %d XP\n\nThe XP goes back to %@ and the nightly jobs won't take it again. They get a notification, and it is recorded in the audit log."),
                        entry.title + (entry.dateKey.map { " (\(AgendaRange.dayLabel($0)))" } ?? ""), entry.shownAmount, name))
        }
    }

    private func row(_ e: RecordXpEntry) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(e.signedAmount)
                .font(NXFont.display(14, .bold))
                .strikethrough(e.isRemoved)
                .foregroundStyle(e.isRemoved ? NX.mutedFg : e.shownAmount < 0 ? NX.danger : NX.success)
                .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.title).font(NXFont.text(13, .semibold)).strikethrough(e.isRemoved)
                    .foregroundStyle(e.isRemoved ? NX.mutedFg : NX.foreground).lineLimit(2)
                Text(subtitle(e)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                if let r = e.removed {
                    Text(String(format: T("Removed by %@"), r.by?.name ?? "BoD") + ((r.note ?? "").isEmpty ? "" : " — \(r.note ?? "")"))
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.success).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            if e.canRemove == true {
                Button { note = ""; message = nil; errorText = nil; confirm = e } label: {
                    Label(T("Remove deduction"), systemImage: "arrow.uturn.backward").font(NXFont.text(11, .bold)).labelStyle(.titleAndIcon)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(NX.muted, in: Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(NX.violetText)
                .disabled(busy)
            }
        }
        .padding(.vertical, 3)
    }

    /// "for Mon, 14 Sep · written 15 Sep" — an attendance penalty names the day it is about.
    private func subtitle(_ e: RecordXpEntry) -> String {
        let written = e.createdAt.map { AgendaRange.dayLabel(AgendaRange.dayKey($0)) } ?? ""
        guard let day = e.dateKey else { return written }
        return String(format: T("for %@"), AgendaRange.dayLabel(day)) + (written.isEmpty ? "" : " · \(written)")
    }

    private func loadOlder() async {
        guard !loadingOlder, let key = last?.olderPeriod else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await APIClient.shared.memberRecordXp(userId: record.person.id, period: key)
            older.append(OlderChunk(period: page.period ?? key, xp: page.xp))
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            errorText = T("Couldn't load older entries.")
        }
    }

    private func remove(_ e: RecordXpEntry) async {
        confirm = nil
        busy = true
        defer { busy = false }
        do {
            let r = try await APIClient.shared.removeXpDeduction(transactionId: e.id, note: note)
            message = String(format: T("Deduction removed — +%d XP back to %@."), r.refund?.refunded ?? -e.shownAmount, name)
            await onChanged()
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(_, let reason) {
            errorText = reason ?? T("Couldn't remove that deduction.")
            await onChanged()
        } catch {
            errorText = T("Couldn't remove that deduction.")
        }
    }
}

/// One earlier period's XP rows, appended by "Load older".
private struct OlderChunk: Identifiable {
    let period: String
    let xp: RecordXp
    var id: String { period }
}

/// The thread a "Message" tap opens. A separate value rather than the `Conversation` itself,
/// because `.navigationDestination(item:)` needs something Hashable and a decoded API payload is
/// not the right thing to make one.
private struct ChatDestination: Identifiable, Hashable {
    let id: String
    let title: String
}
