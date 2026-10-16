import SwiftUI

/// Port of leaderboard.tsx: period banner + top-3 podium (gold/silver/bronze) + rankings list.
struct LeaderboardView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var rows: [LeaderboardRow] = []
    /// The signed-in person is left out of the ranking (BoD / One-Above-All, W-B4); false from older servers.
    @State private var viewerLeftOut = false
    @State private var loading = true
    @State private var error: String?
    /// When what is on screen was fetched. Non-nil only while showing a cached copy that has not
    /// been refreshed yet — data that looks live but is a day old is worse than a spinner.
    @State private var showingCacheFrom: Date?
    /// The person a tapped rank opens. Held as a value because a NavigationLink(destination:) inside
    /// the ForEach would build every profile on the way past.
    @State private var openProfile: ProfileTarget?

    /// BoD+ (atBottom) sink below staff; then by XP desc, then name (case-insensitive, as the web).
    private var ranked: [LeaderboardRow] {
        rows.sorted {
            if ($0.atBottom ?? false) != ($1.atBottom ?? false) { return !($0.atBottom ?? false) }
            if $0.totalXp != $1.totalXp { return $0.totalXp > $1.totalXp }
            return ($0.name ?? "").localizedCaseInsensitiveCompare($1.name ?? "") == .orderedAscending
        }
    }
    /// Standard competition ranking (web lib/competition-rank.ts, QA 13 Oct 2026): equal XP shares a rank
    /// and the next one skips (1, 1, 1, 4). Before, seven people on 1,000 XP got ranks 1–7. A BoD row that
    /// sinks to the bottom never ties with the staff above it.
    private var ranks: [Int] {
        let list = ranked
        var out: [Int] = []
        for (i, r) in list.enumerated() {
            if i > 0, list[i - 1].totalXp == r.totalXp, (list[i - 1].atBottom ?? false) == (r.atBottom ?? false) {
                out.append(out[i - 1])
            } else {
                out.append(i + 1)
            }
        }
        return out
    }

    /// The sidebar's Leaderboard page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.leaderboard, hSize: hSize, router: router) }

    /// The period the board covers, in WIB: from the 28th to the 27th, the same period as attendance (owner,
    /// 16 Oct 2026; server period.resetDay 28), shown as its first and LAST day ("28 Sep – 27 Oct").
    private static var periodText: String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Jakarta") ?? .current
        let now = Date()
        guard let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: now)),
              let thisReset = cal.date(byAdding: .day, value: 27, to: monthStart) else { return "" }
        let start = now >= thisReset ? thisReset : (cal.date(byAdding: .month, value: -1, to: thisReset) ?? thisReset)
        guard let next = cal.date(byAdding: .month, value: 1, to: start),
              let last = cal.date(byAdding: .day, value: -1, to: next) else { return "" }
        // AppDateLocale: the app language, and "Sep" rather than en_GB's "Sept".
        let f = AppDateLocale.formatter("d MMM", timeZone: cal.timeZone)
        return "\(f.string(from: start)) – \(f.string(from: last))"
    }


    /// The period is part of the subtitle, as on the web (leaderboard.tsx): "Everyone's XP for 1 Oct – 31 Oct.
    /// It resets on the 1st." It floated top-right above the title's baseline on the iPad and Mac, and was a
    /// separate line on the phone (UI tour run 14, P-I34 / P-M29).
    private static var subtitle: String {
        T("Everyone's XP for {range}. It resets on the 28th.").replacingOccurrences(of: "{range}", with: periodText)
    }

    private var pageHeader: some View {
        NXPageHeader(title: T("Leaderboard"), subtitle: Self.subtitle) { EmptyView() }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: Self.subtitle) { pageHeader }
        .safeAreaInset(edge: .top) {
            if let at = showingCacheFrom {
                Text(T("Showing saved data") + " · " + Self.ago(at))
                    .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(NX.muted, in: Capsule())
                    .padding(.top, 4)
            }
        }
        .navigationTitle(T("Leaderboard"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
        .task {
            // Draw the last known board first so the screen opens with content instead of a
            // skeleton, then refresh underneath.
            if rows.isEmpty, let hit = ResponseCache.decoded("leaderboard", as: LeaderboardResponse.self) {
                rows = hit.value.rows ?? []
                viewerLeftOut = hit.value.viewer?.leftOutAsManagement ?? false
                showingCacheFrom = hit.savedAt
                loading = false
            }
            await load()
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            ErrorState(message: error, icon: "trophy") { Task { await load() } }
        } else {
            ScrollView {
                VStack(spacing: 16) {
                    // Why the viewer is missing from the list (UI tour run 13, W-B4), in the web's bordered
                    // info banner rather than plain text (run 14, P-I34 / P-M29).
                    if viewerLeftOut {
                        Label(T("You're not on this ranking: the board is left out, so management doesn't compete with staff."),
                              systemImage: "info.circle")
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }

                    // One card around the caption, the podium or tie band and the ranking, as the web's (UI tour run
                    // 20, R20-B-33: they sat on the page outside a card).
                    VStack(alignment: .leading, spacing: 16) {
                        // The web card's caption over the ranking (UI tour run 16, R16-I-25; web master over run 14 N-36).
                        if !ranked.isEmpty {
                            Text(T("XP ranking for everyone")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if ranked.count >= 1 {
                            // More people share 1st than the podium has steps: one gold band with everyone tied
                            // and "7-way tie for 1st · 1.000" on it, as on the web. Three "1" blocks left four of
                            // the seven out (UI tour run 15, Q-IB6).
                            let tiedFirst = ranks.filter { $0 == 1 }.count
                            if tiedFirst > 3 {
                                TieRibbon(rows: Array(ranked.prefix(tiedFirst)), caption: String(format: T("%d-way tie for 1st"), tiedFirst)) { row in
                                    openProfile = ProfileTarget(userId: row.userId, name: row.name, avatar: row.avatar)
                                }
                            } else {
                                Podium(rows: Array(ranked.prefix(3)), labels: Array(ranks.prefix(3))) { row in
                                    openProfile = ProfileTarget(userId: row.userId, name: row.name, avatar: row.avatar)
                                }
                            }
                        }

                        VStack(spacing: 0) {
                            let shared = ranks
                            ForEach(Array(ranked.enumerated()), id: \.element.id) { idx, r in
                                if idx > 0 { Divider().overlay(NX.border) }
                                RankRow(rank: idx < shared.count ? shared[idx] : idx + 1, row: r) {
                                    openProfile = ProfileTarget(userId: r.userId, name: r.name, avatar: r.avatar)
                                }
                            }
                        }
                        // Hairline card like the web's, no drop shadow.
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }
                    .padding(isRoot ? 20 : 12)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))

                    // The web's admin XP log under the ranking, BoD and up (UI tour run 18, iPhone R18-I-06).
                    if Viewer.shared.isBoD { XpAuditLogCard() }
                }
                .padding(.horizontal, NXSidebarPage.gutter(isRoot))
                .padding(.vertical, isRoot ? 24 : 16)
            }
            .refreshable { await load() }
        }
    }

    private static func ago(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: .now)
    }

    private func load() async {
        error = nil
        do {
            let response = try await APIClient.shared.leaderboardResponse()
            rows = response.rows ?? []
            viewerLeftOut = response.viewer?.leftOutAsManagement ?? false
            showingCacheFrom = nil
        }
        catch APIError.unauthorized { auth.logout() }
        catch {
            // With something already on screen from cache, an error is a stale badge, not an error
            // page: replacing a readable board with a failure message helps nobody.
            if rows.isEmpty {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the leaderboard.")
            }
        }
        loading = false
    }
}

struct Podium: View {
    let rows: [LeaderboardRow]   // already ranked 1..3
    /// The rank to print on each place when it differs from the place (a tie: two people on rank 1).
    var labels: [Int] = []
    let onOpen: (LeaderboardRow) -> Void
    // Visual order: 2nd · 1st · 3rd. With a tie at the top every step reads "1", and 2-1-3 then looked like a
    // different order from the list below it: tied, the steps run left to right in the list's order (web
    // leaderboard-podium, UI tour run 9, I11).
    private var slots: [(rank: Int, row: LeaderboardRow?)] {
        let all: [(rank: Int, row: LeaderboardRow?)] = [(1, rows.first), (2, rows.count > 1 ? rows[1] : nil), (3, rows.count > 2 ? rows[2] : nil)]
        let tiedTop = rows.count > 1 && label(1) == label(2)
        return tiedTop ? all : [all[1], all[0], all[2]]
    }
    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(slots, id: \.rank) { slot in podium(slot.rank, slot.row) }
        }
        // The web's podium is a centred block about 440 wide; on a Mac or iPad page the three steps
        // stretched into wide yellow slabs across the whole page (UI tour run 4). A phone is narrower.
        .frame(maxWidth: 440)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
    private func podium(_ rank: Int, _ row: LeaderboardRow?) -> some View {
        // Tied people share a rank, so they share its step too: 1 / 1 / 1 are three gold steps of one
        // height (web leaderboard-podium, QA BoD R2 N05). The place only decides left / middle / right.
        let step: Int = min(3, max(1, label(rank)))
        let (barColor, ring, crown, avatar, height): (Color, Color, Color, CGFloat, CGFloat) = {
            switch step {
            case 1: return (Color(hex: "#fcd34d"), Color(hex: "#f59e0b"), Color(hex: "#f59e0b"), 70, 96)
            case 2: return (Color(hex: "#e2e8f0"), Color(hex: "#94a3b8"), Color(hex: "#94a3b8"), 56, 72)
            default: return (Color(hex: "#fdba74"), Color(hex: "#f97316"), Color(hex: "#f97316"), 56, 60)
            }
        }()
        return VStack(spacing: 6) {
            if let row {
                // Only the person half of the tile opens a profile. The numbered bar below stays
                // scenery, so a tap on the podium's base does not fire.
                Button { onOpen(row) } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            AvatarView(url: row.avatar, initial: row.initial, size: avatar)
                                .overlay(Circle().strokeBorder(ring, lineWidth: 3))
                            if label(rank) == 1 { Image(systemName: "crown.fill").font(.system(size: 18)).foregroundStyle(crown).offset(y: -avatar/2 - 6) }
                        }
                        Text(row.name ?? "—").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text("\(AppNumber.int(row.totalXp)) XP").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(barColor).frame(height: height)
                // Dark on the coloured step, as the web's podium (white was hard to read on gold).
                Text("\(label(rank))").font(NXFont.display(22, .black)).foregroundStyle(Color(hex: "#78350f").opacity(0.9)).padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(row == nil ? 0 : 1)
    }
    /// The shared rank for a podium place (1-based), else the place itself.
    private func label(_ place: Int) -> Int {
        place - 1 < labels.count ? labels[place - 1] : place
    }
}

/// Everyone who shares 1st on one gold band, in the list's order (the web's LeaderboardTie). Names wrap to
/// two lines rather than truncate (run 15, R15-WB-6).
struct TieRibbon: View {
    let rows: [LeaderboardRow]
    let caption: String
    let onOpen: (LeaderboardRow) -> Void
    @Environment(\.colorScheme) private var scheme

    private var band: Color { scheme == .dark ? Color(hex: "#fbbf24").opacity(0.25) : Color(hex: "#fcd34d") }
    private var ink: Color { scheme == .dark ? Color(hex: "#fde68a") : Color(hex: "#78350f") }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "crown.fill").font(.system(size: 14))
                Text(caption)
                if let top = rows.first { Text("· \(AppNumber.int(top.totalXp)) XP").monospacedDigit() }
            }
            .font(NXFont.text(14, .semibold)).foregroundStyle(ink)
            .multilineTextAlignment(.center)
            // Down to 70 pt a person, so seven tied fit one row on an iPad as on the web (UI tour run 16, R16-I-25:
            // "Zaki Mahmuda" alone on a second row).
            // One line per name, as the web's band (UI tour run 20, R20-B-24: "Zainal / Mahdi" took two lines while
            // the other names took one): up to 120 pt a person, a long name steps down a little before it is cut.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 70, maximum: 120), spacing: 10, alignment: .top)], alignment: .center, spacing: 12) {
                ForEach(rows) { row in
                    Button { onOpen(row) } label: {
                        VStack(spacing: 5) {
                            AvatarView(url: row.avatar, initial: row.initial, size: 44)
                                .overlay(Circle().strokeBorder(Color(hex: "#f59e0b"), lineWidth: 2))
                            Text(row.name ?? "—").font(NXFont.text(12, .semibold)).foregroundStyle(ink)
                                .multilineTextAlignment(.center).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(band, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

struct RankRow: View {
    let rank: Int
    let row: LeaderboardRow
    let onOpen: () -> Void
    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                Text("\(rank)").font(NXFont.text(15, .semibold)).foregroundStyle(rank <= 3 ? NX.foreground : NX.mutedFg)
                    .frame(width: 28)
                // The web marks first place with a crown in every row that holds it.
                Image(systemName: "crown")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(hex: "#f59e0b"))
                    .frame(width: 18)
                    .opacity(rank == 1 ? 1 : 0)
                    .accessibilityHidden(true)
                AvatarView(url: row.avatar, initial: row.initial, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name ?? "—").font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text("Level \(row.level)\(row.levelName.map { " · \($0)" } ?? "")").font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer()
                // The unit on every value, "1.000 XP" / "−142 XP", as the web (UI tour run 16, decision 5).
                Text("\(AppNumber.int(row.totalXp)) XP")
                    .font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
