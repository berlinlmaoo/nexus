import SwiftUI

struct DashboardView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var profile: AppUser?
    @State private var game: Gamification?
    @State private var projectCount = 0
    @State private var mission: (done: Int, total: Int) = (0, 0)
    @State private var unread = 0
    @State private var loaded = false

    // stat-card morph (web StatCardButton/StatCardModal — shared-id hero)
    @State private var projectsList: [Project] = []
    @State private var tasksList: [MyTask] = []
    @State private var activeStat: Int?
    @Namespace private var statNS

    private var name: String { profile?.name ?? auth.session?.userName ?? "Commander" }

    private struct StatDatum {
        let value: Int; let total: Int?; let label: String; let icon: String
        let from: String; let to: String; let glow: String
    }
    private var statData: [StatDatum] {
        [
            .init(value: projectCount, total: nil, label: "Projects", icon: "rectangle.stack.fill", from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa"),
            .init(value: mission.done, total: mission.total, label: "Your Mission", icon: "checklist", from: "#6ee7b7", to: "#059669", glow: "#34d399"),
            .init(value: game?.questsDone ?? 0, total: game?.questList.count ?? 0, label: "Monthly Quests", icon: "sparkles", from: "#fcd34d", to: "#ea580c", glow: "#fbbf24"),
        ]
    }
    private var statSpring: Animation { reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.82) }
    private func toggleStat(_ i: Int?) { withAnimation(statSpring) { activeStat = i } }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        greeting
                        levelCard
                        searchRow
                        statCards
                        questsCard
                        xpRulesCard
                        profileCard
                        Color.clear.frame(height: 8)
                    }
                    .padding(16)
                }
                .overlay(alignment: .bottomTrailing) { oracleFab.padding(20) }
                .overlay { statModal }
            }
            .navigationBarHidden(true)
            .task { if !loaded { await load() } }
            .refreshable { await load() }
        }
    }

    // MARK: greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Good Morning,").font(NXFont.text(20, .medium)).foregroundStyle(NX.foreground.opacity(0.8))
            Text("\(name)!").font(NXFont.display(32, .bold)).foregroundStyle(NX.foreground)
        }
        .padding(.top, 8)
    }

    // MARK: level/XP card

    private var levelCard: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(LinearGradient(colors: [Color(hex: "#fb923c"), Color(hex: "#ea580c")], startPoint: .top, endPoint: .bottom))
                Image(systemName: "sparkles").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(game?.xp.levelName ?? "—").font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text("Lv.\(game?.xp.level ?? 0)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    if (game?.streakCurrent ?? 0) > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "flame.fill").font(.system(size: 10))
                            Text("\(game!.streakCurrent)").font(NXFont.text(11, .semibold))
                        }.foregroundStyle(NX.warning)
                    }
                }
                HStack(spacing: 8) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.onyx).frame(width: geo.size.width * (game?.levelPct ?? 0))
                        }
                    }
                    .frame(height: 6)
                    Text(xpLabel).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg).fixedSize()
                }
            }
        }
        .nexusCard(padding: 12, radius: 18)
    }

    private var xpLabel: String {
        let xp = game?.xp.totalXp ?? 0
        let s = xp.formatted(.number.grouping(.automatic))
        if let next = game?.xp.nextFloor, next > 0 { return "\(s) XP" }
        return "\(s) XP"
    }

    // MARK: search + bell

    private var searchRow: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                Text("Search..").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                Spacer()
            }
            .padding(.horizontal, 18).frame(height: 48)
            .background(NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border, lineWidth: 1))

            ZStack(alignment: .topTrailing) {
                Circle().fill(NX.card).frame(width: 48, height: 48).overlay(Circle().strokeBorder(NX.border))
                    .overlay(Image(systemName: "bell.fill").font(.system(size: 17)).foregroundStyle(NX.foreground))
                if unread > 0 {
                    Text("\(unread)").font(NXFont.text(9, .bold)).foregroundStyle(.white)
                        .padding(4).background(NX.danger, in: Circle()).offset(x: 3, y: -3)
                }
            }
        }
    }

    // MARK: stat cards

    private var statCards: some View {
        HStack(spacing: 12) {
            ForEach(Array(statData.enumerated()), id: \.offset) { i, d in
                Button { toggleStat(i) } label: {
                    StatCardView(value: d.value, total: d.total, label: d.label, icon: d.icon, from: d.from, to: d.to, glow: d.glow)
                        .modifier(MatchedCard(id: i, ns: statNS, isSource: activeStat != i, enabled: !reduceMotion))
                }
                .buttonStyle(PressableCardStyle())
                .opacity(activeStat == i ? 0 : 1)
            }
        }
    }

    // MARK: stat-card morph modal

    @ViewBuilder private var statModal: some View {
        if let a = activeStat, a < statData.count {
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea()
                    .background(.ultraThinMaterial.opacity(0.001))
                    .transition(.opacity)
                    .onTapGesture { toggleStat(nil) }
                statModalCard(a)
                    .padding(.horizontal, 18)
            }
            .zIndex(20)
        }
    }

    private func statModalCard(_ a: Int) -> some View {
        let d = statData[a]
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Image(systemName: d.icon).font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 56, height: 56).background(.white.opacity(0.25), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text("\(d.value)").font(NXFont.display(38, .bold)).foregroundStyle(.white)
                        if let t = d.total { Text("/\(t)").font(NXFont.display(24, .bold)).foregroundStyle(.white.opacity(0.7)) }
                    }
                    Text(d.label).font(NXFont.text(14, .medium)).foregroundStyle(.white.opacity(0.9))
                }
                Spacer()
                Button { toggleStat(nil) } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 32, height: 32).background(.white.opacity(0.22), in: Circle())
                }.buttonStyle(.plain)
            }
            ScrollView { statDetail(a).padding(2) }.frame(maxHeight: 320)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [Color(hex: d.from), Color(hex: d.to)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .modifier(MatchedCard(id: a, ns: statNS, isSource: true, enabled: !reduceMotion))
        .shadow(color: Color(hex: d.glow).opacity(0.5), radius: 24, y: 12)
        .transition(reduceMotion ? .opacity.combined(with: .scale(scale: 0.96)) : .identity)
    }

    @ViewBuilder private func statDetail(_ a: Int) -> some View {
        switch a {
        case 0: detailList(projectsList.map { ($0.name, $0.statusLabel) }, empty: "Belum ada project.")
        case 1: detailList(tasksList.map { ($0.title ?? "Untitled", $0.isDone ? "Done" : "Open") }, empty: "Belum ada task aktif.")
        default: detailList((game?.questList ?? []).map { ($0.title, "\($0.progress)/\($0.target) · +\($0.xpReward) XP") }, empty: "Belum ada quest.")
        }
    }

    private func detailList(_ items: [(String, String)], empty: String) -> some View {
        VStack(spacing: 8) {
            if items.isEmpty {
                Text(empty).font(NXFont.text(13)).foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            } else {
                ForEach(Array(items.prefix(40).enumerated()), id: \.offset) { _, it in
                    HStack(spacing: 8) {
                        Text(it.0).font(NXFont.text(13, .semibold)).foregroundStyle(.white).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(it.1).font(NXFont.text(11, .semibold)).foregroundStyle(.white.opacity(0.8)).fixedSize()
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    // MARK: lower cards

    private var questsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Your Quests").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Text("See All").font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
            }
            if (game?.questList.isEmpty ?? true) {
                Text("Belum ada quest aktif. XP kamu jalan dari task, streak, & absen — cek \"Aturan XP\" di bawah.")
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(game!.questList.prefix(3)) { q in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(q.title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                            Text("\(q.progress)/\(q.target) · +\(q.xpReward) XP").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer()
                    }
                }
            }
        }
        .nexusCard()
    }

    private var xpRulesCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "gift.fill").font(.system(size: 16)).foregroundStyle(NX.foreground)
                .frame(width: 40, height: 40).background(NX.muted, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Aturan XP / Poin").font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                Text("Potongan, bonus, & reward tier bulanan").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
        }
        .nexusCard(padding: 14)
    }

    private var profileCard: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NX.muted)
                    .frame(width: 64, height: 64)
                    .overlay(Image(systemName: "person.fill").font(.system(size: 24)).foregroundStyle(NX.mutedFg))
                VStack(alignment: .leading, spacing: 8) {
                    row("LEVEL", "\(game?.xp.level ?? 0) · \(game?.xp.levelName ?? "—")")
                    row("POIN PERIODE", (game?.xp.totalXp ?? 0).formatted(.number.grouping(.automatic)))
                }
                Spacer()
            }
            Button { } label: {
                HStack(spacing: 6) { Image(systemName: "pencil"); Text("Edit Profile") }
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            Text(name).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        }
        .nexusCard()
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(spacing: 12) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg).frame(width: 96, alignment: .leading)
            Text(value).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
    }

    private var oracleFab: some View {
        Circle().fill(NX.onyx).frame(width: 52, height: 52)
            .overlay(Image(systemName: "sparkles").font(.system(size: 20, weight: .bold)).foregroundStyle(.white))
            .nexusShadowPop()
    }

    // MARK: data

    private func load() async {
        async let p = try? APIClient.shared.profile()
        async let g = try? APIClient.shared.gamification()
        async let projs = try? APIClient.shared.projects()
        async let unreadN = try? APIClient.shared.unreadCount()

        let prof = await p
        profile = prof?.user
        game = await g
        projectsList = (await projs) ?? []
        projectCount = projectsList.count
        unread = (await unreadN) ?? 0

        if let myId = prof?.user.id, let tasks = try? await APIClient.shared.myTasks(assigneeId: myId) {
            tasksList = tasks
            mission = (tasks.filter(\.isDone).count, tasks.count)
        }
        loaded = true
    }
}

/// Conditionally applies a shared-id hero `matchedGeometryEffect` (skipped under Reduce Motion).
struct MatchedCard: ViewModifier {
    let id: Int
    let ns: Namespace.ID
    let isSource: Bool
    let enabled: Bool
    func body(content: Content) -> some View {
        if enabled {
            content.matchedGeometryEffect(id: "stat-\(id)", in: ns, isSource: isSource)
        } else {
            content
        }
    }
}

/// One gradient stat tile (Projects / Your Mission / Monthly Quests).
struct StatCardView: View {
    let value: Int
    let total: Int?
    let label: String
    let icon: String
    let from: String
    let to: String
    let glow: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(.white.opacity(0.25), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("\(value)").font(NXFont.display(30, .bold)).foregroundStyle(.white)
                if let total { Text("/\(total)").font(NXFont.display(20, .bold)).foregroundStyle(.white.opacity(0.7)) }
            }
            Text(label).font(NXFont.text(13, .medium)).foregroundStyle(.white.opacity(0.9))
                .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18).padding(.horizontal, 8)
        .background(
            LinearGradient(colors: [Color(hex: from), Color(hex: to)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white.opacity(0.5)).padding(10)
        }
        .shadow(color: Color(hex: glow).opacity(0.45), radius: 14, y: 8)
    }
}
