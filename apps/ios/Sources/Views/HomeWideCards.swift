import SwiftUI

// The web Home's side widgets on an iPad or a Mac (UI tour run 15, Q-IA8 / Q-M6): "Your schedule", Messages
// and the Leaderboard's top five, beside the cards the app already had. The iPhone Home keeps its own layout
// (owner rule). Each card reads what it needs; nothing here changes data.

/// A card with the web Section's head: the title, and "See all" on the right.
private struct HomeWideCard<Content: View>: View {
    let title: String
    var onSeeAll: (() -> Void)? = nil
    @ViewBuilder let content: () -> Content

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
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
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
                VStack(spacing: 6) {
                    ForEach(ranked, id: \.row.id) { item in
                        HStack(spacing: 10) {
                            Text("\(item.rank)").font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 18, alignment: .leading)
                            AvatarView(url: item.row.avatar, initial: item.row.initial, size: 26)
                            Text(item.row.name ?? "—").font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                            Spacer(minLength: 6)
                            Text("\(AppNumber.int(item.row.totalXp)) XP").font(NXFont.text(13, .semibold))
                                .foregroundStyle(NX.foreground).monospacedDigit()
                        }
                    }
                }
            }
        }
        .task { rows = (try? await APIClient.shared.leaderboardResponse().rows) ?? [] }
    }
}
