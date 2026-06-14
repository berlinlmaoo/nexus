import SwiftUI

/// Port of leaderboard.tsx: period banner + top-3 podium (gold/silver/bronze) + rankings list.
struct LeaderboardView: View {
    @Environment(AuthStore.self) private var auth
    @State private var rows: [LeaderboardRow] = []
    @State private var loading = true
    @State private var error: String?

    /// BoD+ (atBottom) sink below staff; then by XP desc, then name.
    private var ranked: [LeaderboardRow] {
        rows.sorted {
            if ($0.atBottom ?? false) != ($1.atBottom ?? false) { return !($0.atBottom ?? false) }
            if $0.totalXp != $1.totalXp { return $0.totalXp > $1.totalXp }
            return ($0.name ?? "") < ($1.name ?? "")
        }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "trophy").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(spacing: 16) {
                    Text("Periode berjalan · poin reset tiap tgl 1, jam 00:00 WIB")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(12)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(NX.border))

                    if ranked.count >= 1 { Podium(rows: Array(ranked.prefix(3))) }

                    VStack(spacing: 0) {
                        ForEach(Array(ranked.enumerated()), id: \.element.id) { idx, r in
                            if idx > 0 { Divider().overlay(NX.border) }
                            RankRow(rank: idx + 1, row: r)
                        }
                    }
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                    .nexusShadowSoft()
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        error = nil
        do { rows = try await APIClient.shared.leaderboard() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat leaderboard." }
        loading = false
    }
}

struct Podium: View {
    let rows: [LeaderboardRow]   // already ranked 1..3
    // Visual order: 2nd · 1st · 3rd
    private var slots: [(rank: Int, row: LeaderboardRow?)] {
        [(2, rows.count > 1 ? rows[1] : nil), (1, rows.first), (3, rows.count > 2 ? rows[2] : nil)]
    }
    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(slots, id: \.rank) { slot in podium(slot.rank, slot.row) }
        }
        .padding(.vertical, 8)
    }
    private func podium(_ rank: Int, _ row: LeaderboardRow?) -> some View {
        let (barColor, ring, crown, avatar, height): (Color, Color, Color, CGFloat, CGFloat) = {
            switch rank {
            case 1: return (Color(hex: "#fcd34d"), Color(hex: "#f59e0b"), Color(hex: "#f59e0b"), 70, 96)
            case 2: return (Color(hex: "#e2e8f0"), Color(hex: "#94a3b8"), Color(hex: "#94a3b8"), 56, 72)
            default: return (Color(hex: "#fdba74"), Color(hex: "#f97316"), Color(hex: "#f97316"), 56, 60)
            }
        }()
        return VStack(spacing: 6) {
            if let row {
                ZStack {
                    AvatarView(url: row.avatar, initial: row.initial, size: avatar)
                        .overlay(Circle().strokeBorder(ring, lineWidth: 3))
                    if rank == 1 { Image(systemName: "crown.fill").font(.system(size: 18)).foregroundStyle(crown).offset(y: -avatar/2 - 6) }
                }
                Text(row.name ?? "—").font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text("\(row.totalXp.formatted(.number.grouping(.automatic))) XP").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
            }
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(barColor).frame(height: height)
                Text("\(rank)").font(NXFont.display(22, .black)).foregroundStyle(.white.opacity(0.9)).padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(row == nil ? 0 : 1)
    }
}

struct RankRow: View {
    let rank: Int
    let row: LeaderboardRow
    var body: some View {
        HStack(spacing: 12) {
            Text("\(rank)").font(NXFont.display(15, .black)).foregroundStyle(rank <= 3 ? NX.violet : NX.mutedFg)
                .frame(width: 28)
            AvatarView(url: row.avatar, initial: row.initial, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name ?? "—").font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text("Level \(row.level)\(row.levelName.map { " – \($0)" } ?? "")").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer()
            Text("\(row.totalXp.formatted(.number.grouping(.automatic)))")
                .font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            Text("XP").font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }
}
