import SwiftUI

/// Reports per crew.
///
/// Replaced the workspace-wide task report (total tasks, by status, project health): the owner's
/// rule is that staff see only themselves, a manager sees their direct reports and BoD/admin see
/// everyone, and a workspace total showed everybody everything. Who may see whom is decided by the
/// server on every request; this screen only learns it (`viewerScope` on the first "me" report)
/// to decide whether a team tab is worth drawing.
struct ReportsView: View {
    private enum Pane: String { case me, team }

    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var pane: Pane = .me
    /// nil = the current period, asked for with no parameter.
    @State private var periodKey: String?
    /// The current period as the server reported it: the anchor the older periods are counted
    /// back from.
    @State private var anchor: ReportPeriod?
    /// SELF until a report says otherwise, so a staff member never sees a tab flash in and out.
    @State private var scope: ReportScope = .selfOnly
    /// Set when the roster answered REPORT_SELF_ONLY: the server's word beats the scope we read.
    @State private var rosterRefused = false

    private var options: [ReportPeriodOption] { ReportPeriodOption.options(anchor: anchor) }
    private var offersTeam: Bool { scope != .selfOnly && !rosterRefused }

    /// The sidebar's Reports page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.reports, hSize: hSize, router: router) }
    private var teamLabel: String { scope == .all ? T("Team") : T("My team") }

    /// Web reports.tsx PageHeader: the subtitle follows the tab, the period picker sits at the right,
    /// Me / Team in the tabs row.
    private var pageHeader: some View {
        let showingTeam = pane == .team && offersTeam
        let subtitle = showingTeam
            ? (scope == .all ? T("How everyone is doing this period.") : T("How your direct reports are doing this period."))
            : T("Your work, attendance and XP for the period.")
        return VStack(spacing: 0) {
            NXPageHeader(title: T("Reports"), subtitle: subtitle) {
                ReportPeriodMenu(options: options, selection: $periodKey)
                    .foregroundStyle(NX.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(NX.border))
            }
            if offersTeam {
                NXPageTabsRow(items: [NXTabItem(id: Pane.me, label: T("Me")), NXTabItem(id: Pane.team, label: teamLabel)],
                              selection: $pane, accessibilityName: T("Report view"))
            }
        }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 0) {
                // On the iPad / Mac page Me / Team sit in the header's tabs row.
                if offersTeam && !isRoot {
                    Picker(T("Show"), selection: $pane) {
                        Text(T("Me")).tag(Pane.me)
                        // BoD/admin see everyone, so "My team" would undersell it.
                        Text(teamLabel).tag(Pane.team)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 4)
                }
                if pane == .team && offersTeam {
                    ReportRosterPane(periodKey: periodKey, scope: scope, options: options) {
                        rosterRefused = true
                        pane = .me
                    }
                } else {
                    PersonReportPane(userId: "me", periodKey: periodKey) { report, requestedKey in
                        scope = report.scope
                        if requestedKey == nil, let period = report.period { anchor = period }
                    }
                }
            }
        }
        .nxSidebarPageChrome(isRoot) { pageHeader }
        .navigationTitle(T("Reports"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { ReportPeriodMenu(options: options, selection: $periodKey) }
        }
    }
}

// MARK: - Roster

/// Everybody the viewer may see, one row each, in the order the server sends (it puts the people
/// who need attention first). Tapping a row opens that person's full report.
struct ReportRosterPane: View {
    let periodKey: String?
    let scope: ReportScope
    let options: [ReportPeriodOption]
    /// The server said this viewer may only see themselves (REPORT_SELF_ONLY).
    let onSelfOnly: () -> Void

    @Environment(AuthStore.self) private var auth
    @State private var roster: ReportRoster?
    @State private var loadedKey: String??
    @State private var loading = true
    @State private var error: String?
    @State private var savedAt: Date?
    @State private var search = ""

    private var rows: [ReportRoster.Row] {
        let all = roster?.rows ?? []
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return all }
        return all.filter {
            $0.displayName.localizedStandardContains(q) || ($0.email?.localizedStandardContains(q) ?? false)
                || $0.teams.contains { $0.name.localizedStandardContains(q) }
        }
    }

    var body: some View {
        Group {
            if let roster, loadedKey == .some(periodKey) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let savedAt { OfflineNotice(savedAt: savedAt) }
                        searchField
                        summary(roster)
                        if roster.rows.isEmpty {
                            EmptyState(icon: "person.3",
                                       title: T("No one to show yet"),
                                       subtitle: scope == .all
                                           ? T("People join this list once they are members of the workspace.")
                                           : T("People appear here once the approval chart lists you as their manager."),
                                       compact: true)
                        } else if rows.isEmpty {
                            EmptyState(icon: "magnifyingglass",
                                       title: String(format: T("No one matches “%@”"), search),
                                       subtitle: T("Search by name, email or team."),
                                       compact: true)
                        } else {
                            ForEach(rows) { row in
                                NavigationLink {
                                    PersonReportView(userId: row.userId, name: row.name, options: options, periodKey: periodKey)
                                } label: {
                                    ReportRosterRow(row: row)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await load() }
            } else if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ErrorState(message: error ?? T("Couldn't load this"), icon: "person.3") { Task { await load() } }
            }
        }
        .task(id: periodKey ?? "current") { await load() }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
            TextField(T("Search people"), text: $search)
                .font(NXFont.text(14)).foregroundStyle(NX.foreground)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).touchTarget44(drawn: 20)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear"))
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
    }

    private func summary(_ roster: ReportRoster) -> some View {
        HStack {
            SectionLabel(roster.team?.name ?? (scope == .all ? T("Everyone") : T("Your direct reports")))
            Spacer()
            Text(String(format: T("%d people"), roster.rows.count)).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
        }
        .padding(.top, 2)
    }

    private func load() async {
        let key = periodKey
        loading = true
        error = nil
        let fresh: ReportRoster
        do {
            fresh = try await APIClient.shared.reportRoster(period: key)
        } catch {
            if Task.isCancelled { return }
            fail(error, key: key)
            loading = false
            return
        }
        roster = fresh
        loadedKey = .some(key)
        savedAt = nil
        loading = false
    }

    private func fail(_ error: Error, key: String?) {
        do { throw error }
        catch APIError.unauthorized { auth.logout() }
        catch ReportAccessError.selfOnly(_) { onSelfOnly() }
        catch let failure as APIError where failure.nobodyAnswered {
            // Nothing answered: the saved roster for THIS period, or an error — never another
            // period's numbers under this period's label.
            if let hit = ResponseCache.decoded(ReportRoster.cacheKey(period: key, teamId: nil), as: ReportRoster.self) {
                roster = hit.value
                loadedKey = .some(key)
                savedAt = hit.savedAt
            } else {
                drop(failure.errorDescription ?? APIError.unreachableText)
            }
        }
        catch {
            // Never the server's raw text ("Internal server error"): the shared wording (web QA B19).
            drop(FailureText.text(error))
        }
    }

    private func drop(_ message: String) {
        roster = nil
        loadedKey = nil
        savedAt = nil
        error = message
    }
}

/// One person in the roster: who, four numbers, and what needs attention.
/// No formatter is built here — everything goes through `ReportFormat`'s cached ones.
struct ReportRosterRow: View {
    let row: ReportRoster.Row

    var body: some View {
        let h = row.headline
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                AvatarView(url: row.avatar, initial: String(row.displayName.first ?? "?").uppercased(), size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(row.displayName).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if let left = row.leftAt { LeftTag(leftAt: left) }
                    }
                    if let team = row.teams.first?.name {
                        Text(row.teams.count > 1 ? "\(team) +\(row.teams.count - 1)" : team)
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            HStack(spacing: 0) {
                figure(T("Done"), ReportFormat.number(h?.completed ?? 0))
                figure(T("On time"), ReportFormat.percent(h?.onTime))
                figure(T("Overdue"), ReportFormat.number(h?.overdue ?? 0), color: (h?.overdue ?? 0) > 0 ? NX.danger : nil)
                figure(T("Late"), ReportFormat.number(h?.late ?? 0), color: (h?.late ?? 0) > 0 ? NX.warning : nil)
            }
            if let flags = row.flags, flags.overdue3 || flags.late3 || flags.lowReflections {
                HStack(spacing: 6) {
                    if flags.overdue3 { NexusChip(text: T("3+ overdue"), tone: .danger, systemImage: "exclamationmark.circle") }
                    if flags.late3 { NexusChip(text: T("Late 3+ times"), tone: .warning, systemImage: "clock") }
                    if flags.lowReflections { NexusChip(text: T("Few reflections"), tone: .info, systemImage: "text.bubble") }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 20)
        .contentShape(Rectangle())
    }

    private func figure(_ label: String, _ value: String, color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(NXFont.display(16, .bold)).foregroundStyle(color ?? NX.foreground).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
