import SwiftUI

// The web Home's side widgets on an iPad or a Mac (UI tour run 15, Q-IA8 / Q-M6): "Your schedule", Messages
// and the Leaderboard's top five, beside the cards the app already had. The iPhone Home keeps its own layout
// (owner rule). Each card reads what it needs; nothing here changes data.

/// A card with the web Section's head: the title, and "See all" on the right.
private struct HomeWideCard<Content: View>: View {
    let title: String
    var onSeeAll: (() -> Void)? = nil
    @ViewBuilder let content: () -> Content
    @Environment(\.homeCardFillsRow) private var fillsRow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 8)
                if let onSeeAll {
                    Button(T("See all"), action: onSeeAll)
                        .font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
                        .buttonStyle(.plain).hoverEffect(.highlight)
                }
            }
            content()
        }
        // Fills the height its row gives it, so Calendar and Your schedule side by side end level, as on the
        // web (UI tour run 17, iPad R17-I-10). Only there: in the Mac's right rail Messages stretched into
        // ~700 pt of empty card and pushed the Leaderboard below the fold (UI tour run 18, R18-M-01).
        .frame(maxWidth: .infinity, maxHeight: fillsRow ? .infinity : nil, alignment: .topLeading)
        .nexusCard()
    }
}

private struct HomeCardFillsRowKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// A Home card in a row of cards that end level (Calendar beside Your schedule) fills the row's height.
    var homeCardFillsRow: Bool {
        get { self[HomeCardFillsRowKey.self] }
        set { self[HomeCardFillsRowKey.self] = newValue }
    }
}

/// The next six open tasks with a due date, soonest first (web dashboard "Your schedule").
struct HomeScheduleCard: View {
    let tasks: [MyTask]
    let onOpenTask: (String) -> Void
    let onOpenMyTasks: () -> Void

    private var items: [MyTask] {
        tasks.filter { t in
            let s = (t.status ?? "").uppercased()
            return t.dueDate != nil && s != "DONE" && s != "CANCELLED"
        }
        .sorted { (ProjDate.parse($0.dueDate) ?? .distantFuture) < (ProjDate.parse($1.dueDate) ?? .distantFuture) }
        .prefix(6).map { $0 }
    }

    var body: some View {
        HomeWideCard(title: T("Your schedule"), onSeeAll: onOpenMyTasks) {
            if items.isEmpty {
                EmptyState(icon: "calendar.badge.clock", title: T("No upcoming tasks with a due date."),
                           actionTitle: T("Open My Tasks"), actionIcon: nil, action: onOpenMyTasks, compact: true)
            } else {
                VStack(spacing: 4) {
                    ForEach(items) { t in
                        Button { onOpenTask(t.id) } label: {
                            HStack(spacing: 10) {
                                Capsule().fill(NX.violet).frame(width: 4, height: 30)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.title ?? T("Untitled")).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                                    Text(t.laneName).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                Text(ProjDate.parse(t.dueDate).map(ProjDate.dayLabel) ?? "")
                                    .font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
                            }
                            .padding(.horizontal, 6).padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).hoverEffect(.highlight)
                    }
                }
            }
        }
    }
}

/// How many conversations there are and how many wait unread, opening Messages (web dashboard Messages).
struct HomeMessagesCard: View {
    let onOpen: () -> Void
    @State private var count: Int?
    @State private var unread = 0

    var body: some View {
        HomeWideCard(title: T("Messages"), onSeeAll: onOpen) {
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 18))
                        .foregroundStyle(NX.violetText)
                        .frame(width: 40, height: 40).background(NX.accentBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(subtitle).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                        if unread > 0 {
                            Text(T("{n} unread").replacingOccurrences(of: "{n}", with: AppNumber.int(unread)))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .task {
            guard let rows = try? await APIClient.shared.conversations() else { return }
            count = rows.count
            unread = rows.reduce(0) { $0 + ($1.unreadCount ?? 0) }
        }
    }

    private var subtitle: String {
        guard let count else { return T("Loading…") }
        if count == 0 { return T("No conversations yet") }
        return count == 1 ? T("1 conversation") : T("{n} conversations").replacingOccurrences(of: "{n}", with: AppNumber.int(count))
    }
}

/// The top five, ties sharing a rank as on the Leaderboard page (web dashboard Leaderboard).
struct HomeLeaderboardCard: View {
    let onOpen: () -> Void
    @State private var rows: [LeaderboardRow] = []

    /// 1, 1, 1, 4: the same competition ranking as LeaderboardView.
    private var ranked: [(rank: Int, row: LeaderboardRow)] {
        let sorted = rows.sorted { $0.totalXp > $1.totalXp }
        var out: [(Int, LeaderboardRow)] = []
        for (i, r) in sorted.prefix(5).enumerated() {
            let rank = i > 0 && sorted[i - 1].totalXp == r.totalXp ? out[i - 1].0 : i + 1
            out.append((rank, r))
        }
        return out
    }

    var body: some View {
        HomeWideCard(title: T("Leaderboard"), onSeeAll: onOpen) {
            if rows.isEmpty {
                Text(T("Loading…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                // The web widget's rows: a crown on the first place (a rank number after it), the level under
                // the name, each row a bordered tile (UI tour run 16, R16-B-14).
                VStack(spacing: 8) {
                    ForEach(ranked, id: \.row.id) { item in
                        HStack(spacing: 10) {
                            Group {
                                if item.rank == 1 {
                                    Image(systemName: "crown.fill").font(.system(size: 11)).foregroundStyle(Color(hex: "#d97706"))
                                        .frame(width: 24, height: 24)
                                        .background(Color(hex: "#fef3c7"), in: Circle())
                                } else {
                                    Text("\(item.rank)").font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                                        .frame(width: 24, height: 24)
                                }
                            }
                            .accessibilityLabel(String(format: T("Rank %d"), item.rank))
                            AvatarView(url: item.row.avatar, initial: item.row.initial, size: 30, userId: item.row.userId, name: item.row.name)
                            VStack(alignment: .leading, spacing: 1) {
                                // Two lines between words, smaller before any "…", as the web (owner, QA final #2, 24 Oct 2026).
                                WordWrapText(text: item.row.name ?? "—", size: 14) { NXFont.text($0, .semibold) }
                                    .foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
                                // With the tier badge, as the web widget's rows (R20-B-05).
                                HStack(spacing: 4) {
                                    TierBadge(level: item.row.level, size: 14)
                                    Text(DashboardView.levelText(item.row.level, item.row.levelName))
                                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 6)
                            Text("\(AppNumber.int(item.row.totalXp)) XP").font(NXFont.text(13, .semibold))
                                .foregroundStyle(NX.foreground).monospacedDigit().fixedSize()
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    }
                }
            }
        }
        .task { rows = (try? await APIClient.shared.leaderboardResponse().rows) ?? [] }
    }
}

/// The web Home's Calendar widget (UI tour run 16, R16-B-14): this month in the app's one month-grid style
/// (NXMonthGrid), today on the navy disc; "See all" and a day open the Calendar.
struct HomeCalendarCard: View {
    let onOpen: () -> Void
    @State private var month = String(OutletFormat.wibToday().prefix(7))

    var body: some View {
        let today = OutletFormat.wibToday()
        HomeWideCard(title: T("Calendar"), onSeeAll: onOpen) {
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                Button { month = OutletFormat.shiftMonth(month, by: -1) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain).hoverEffect(.highlight)
                .accessibilityLabel(T("Previous month"))
                Text(OutletFormat.monthLabel(month)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(1)
                Button { month = OutletFormat.shiftMonth(month, by: 1) } label: {
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain).hoverEffect(.highlight)
                .accessibilityLabel(T("Next month"))
                Spacer(minLength: 0)
            }
            VStack(spacing: 0) {
                NXMonthWeekdayRow(names: OutletFormat.weekHeader)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                    ForEach(OutletFormat.gridDays(month), id: \.self) { d in
                        let inMonth = d.hasPrefix(month)
                        Button(action: onOpen) {
                            NXMonthDayNumber(day: OutletFormat.parts(d)?.d ?? 0, inMonth: inMonth, isToday: d == today)
                                .padding(3)
                                .frame(maxWidth: .infinity, minHeight: 38, alignment: .topLeading)
                                .nxMonthCell(inMonth: inMonth, selected: false)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(OutletFormat.dayLong(d))
                    }
                }
            }
            .nxMonthGridCard()
        }
    }
}

/// The web's TierBadge (components/gamification/TierBadge.tsx): each level's icon on its own gradient medallion.
struct TierBadge: View {
    let level: Int
    var size: CGFloat = 32

    private static let visuals: [(icon: String, from: String, to: String)] = [
        ("shield.fill", "#a8b1bd", "#5b6675"),       // 1 Iron
        ("medal.fill", "#e0a36b", "#9c5a28"),        // 2 Bronze
        ("medal.fill", "#eef1f5", "#9aa6b5"),        // 3 Silver
        ("medal.fill", "#ffe066", "#e0a200"),        // 4 Gold
        ("hexagon.fill", "#7df0dd", "#0d9488"),      // 5 Platinum
        ("diamond.fill", "#7dd3fc", "#2563eb"),      // 6 Diamond
        ("shield.lefthalf.filled", "#c4b5fd", "#7c3aed"), // 7 Master
        ("crown.fill", "#f5a8e8", "#c026d3"),        // 8 Elite
        ("trophy.fill", "#fdba74", "#ea580c"),       // 9 Supreme
        ("sparkles", "#fbbf24", "#f43f5e"),          // 10
    ]

    var body: some View {
        let v = Self.visuals[max(0, min(Self.visuals.count - 1, level - 1))]
        Image(systemName: v.icon).font(.system(size: size * 0.48, weight: .bold)).foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [Color(hex: v.from), Color(hex: v.to)], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}
