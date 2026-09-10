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

/// Who somebody is — the screen every people-row in this app was drawn to open and never had.
///
/// There is no per-person endpoint an ordinary member may call: `/api/admin/users/<id>` sits behind
/// user management and answers 403 to everyone below BoD, so a profile built on it would be a door
/// most of the company could not open. This one is assembled from endpoints that scope themselves
/// to the CALLER instead — `/api/gamification/xp-log` (peer-scoped by the server, and written for
/// exactly this screen), `/api/workspaces/members`, `/api/gamification/leaderboard`, `/api/teams`
/// and `/api/projects`. That scoping is the feature rather than a limitation: a staff viewer sees
/// the teams and projects they share with this person, a BoD viewer sees more, and neither can ask
/// for something the server would refuse.
///
/// Editing lives in Tuning Room, including for your own profile. This screen only reads.
struct MemberProfileView: View {
    let target: ProfileTarget

    @Environment(AuthStore.self) private var auth
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

    private var isMe: Bool { target.userId == auth.session?.userId }
    /// Who may read the ledger under the score. `Viewer.isBoD` rather than a role string compared
    /// here, so this screen and the announcement composer can never disagree about what a BoD is.
    private var canSeeActivity: Bool { isMe || viewer.isBoD }
    private var displayName: String {
        target.name ?? serverName ?? member?.displayName ?? "—"
    }
    private var avatarURL: String? { target.avatar ?? serverAvatar ?? member?.avatarURL }
    private var initial: String { String(displayName.first ?? "?").uppercased() }

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
                        teamsCard
                        projectsCard
                        // A score is a number about somebody. The ledger under it is "late on the
                        // 4th, absent on the 11th, no check-out on the 12th" — a disciplinary
                        // record with dates on it, which is not a colleague's to read.
                        //
                        // The rows still ARRIVE for everyone, and deliberately so: the xp-log
                        // route is peer-scoped by design and answers any colleague in full. That
                        // same response is the only thing proving this person is a peer at all —
                        // its 403 is what sets `notAPeer` — and it carries the name and avatar the
                        // header falls back to, so not asking for it would cost this screen more
                        // than the drawing it saves. The line is drawn here instead: a
                        // presentation decision, and no kind of security.
                        if canSeeActivity { activityCard }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    // MARK: - sections

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                AvatarView(url: avatarURL, initial: initial, size: 68)
                VStack(alignment: .leading, spacing: 5) {
                    Text(displayName).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground).lineLimit(2)
                    HStack(spacing: 6) {
                        if let role = member?.role { RoleChip(role: role) }
                        if isMe { NexusChip(text: T("You"), tone: .accent) }
                    }
                }
                Spacer(minLength: 0)
            }
            if let email = member?.emailText, !email.isEmpty {
                Label(email, systemImage: "envelope.fill")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            if let joined = member?.joinedAt, !joined.isEmpty {
                Label("\(T("Joined")) \(AgendaRange.dayLabel(AgendaRange.dayKey(joined)))", systemImage: "calendar")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if !isMe {
                Button { Task { await startChat() } } label: {
                    Label(T("Message"), systemImage: "bubble.left.fill").font(NXFont.text(14, .bold))
                }
                .buttonStyle(NexusPrimaryButton(fullWidth: false))
                .disabled(startingChat)
                .opacity(startingChat ? 0.5 : 1)
            }
            if let chatError {
                Text(chatError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
            }
        }
        .nexusCard()
    }

    private var standingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("LEVEL"))
            if let xp = xpTotal, let level = levelNumber {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(xp.formatted(.number.grouping(.automatic)))
                        .font(NXFont.display(28, .bold)).foregroundStyle(NX.foreground)
                    Text("XP").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 8)
                    NexusChip(text: "\(T("Level")) \(level)\(levelName.map { " · \($0)" } ?? "")", tone: .accent)
                }
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
            if let streak = mine?.streakCurrent {
                Label("\(streak) \(T("days"))", systemImage: "flame.fill")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.warning)
                Text(T("Day streak")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
        .nexusCard()
    }

    /// Why there is no score to show. The leaderboard deliberately leaves management out of the
    /// ranking, which is a different thing from having earned nothing.
    private var unrankedNote: String {
        switch (member?.role ?? "").uppercased() {
        case "BOD", "ONE_ABOVE_ALL": return T("BoD and One Above All sit outside the ranking.")
        default:                     return T("No points this period yet.")
        }
    }

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
                        if leadsTeam(team) { NexusChip(text: T("Lead"), tone: .accent) }
                    }
                }
            }
        }
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
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color(hex: project.color ?? "#7b68ee"))
                            .frame(width: 10, height: 10)
                        Text(project.name).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(project.statusLabel).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
        .nexusCard()
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("THIS PERIOD"))
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
        .nexusCard()
    }

    // MARK: - work

    private func leadsTeam(_ team: Team) -> Bool {
        (team.members ?? []).first { $0.uid == target.userId }?.isLead ?? false
    }

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

        // Whether the ledger is drawn is a role question, and the role may still be unknown here:
        // Viewer fills itself from the More tab and the sidebar, while this screen opens from
        // Search, a team, a project board or the leaderboard. Started after the five calls above so
        // it overlaps them, and it is a no-op every time but the first.
        await viewer.loadIfNeeded()

        let roster = await rosterRes
        let board = await boardRes
        let allTeams = await teamsRes
        let allProjects = await projectsRes

        do {
            let page = try await log
            // Zero-amount rows are the server's own bookkeeping (an attendance waiver is written as
            // a 0 XP entry so the penalty job knows to skip that day) — a ledger line that moved
            // nothing has nothing to say on a profile.
            entries = (page.rows ?? []).filter { $0.amount != 0 }
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
        failed = activityFailed && roster == nil && allTeams == nil && allProjects == nil
        loading = false
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

/// The thread a "Message" tap opens. A separate value rather than the `Conversation` itself,
/// because `.navigationDestination(item:)` needs something Hashable and a decoded API payload is
/// not the right thing to make one.
private struct ChatDestination: Identifiable, Hashable {
    let id: String
    let title: String
}
