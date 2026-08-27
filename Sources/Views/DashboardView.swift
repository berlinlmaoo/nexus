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
    @State private var selectedDay = Date()

    // stat-card morph (web StatCardButton/StatCardModal — shared-id hero)
    @State private var projectsList: [Project] = []
    @State private var tasksList: [MyTask] = []
    @State private var notifs: [NexusNotification] = []
    @State private var activeStat: Int?
    @State private var activeLevel = false
    @State private var activeBell = false
    @State private var morphReady = false   // detail body fades in AFTER the card morphs (web: delay ~0.15)
    // FLIP morph (ports framer-motion shared layoutId): published source rects + the live transform state.
    @State private var morphFrames: [String: CGRect] = [:]
    @State private var morphSourceRect: CGRect = .zero
    @State private var morphExpanded = false
    @State private var morphTarget: CGRect = .zero
    @State private var morphShowModal = true   // open: modal solid (FLIP scale). close: fades out as the card fades in.

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
    // Crisp transform-FLIP morph ported from the web's framer layout-spring — smoothness comes from the
    // transform (no reflow), not from being slow. Open: mount the modal, then once it measures itself the
    // .onChange(morphTarget) springs it from the card's rect to full + fades the detail in 0.12s later.
    private let morphSpace = "morph"
    private var morphSpring: Animation { reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.4, dampingFraction: 0.84) }
    private func openMorph(_ source: CGRect) { morphSourceRect = source; morphTarget = .zero; morphExpanded = false; morphReady = false; morphShowModal = true }
    private func closeMorph(_ clear: @escaping () -> Void) {
        // The card stays SOLID and visibly shrinks back (the morph-out) for a beat, THEN crossfades to the
        // real card at the end. The .delay is what makes the shrink readable — fading immediately (no delay)
        // looked like "no morph on close". morphShowModal holds true through the shrink, drops at the end.
        withAnimation(morphSpring) { morphExpanded = false } completion: {
            clear(); morphTarget = .zero; morphReady = false; morphShowModal = true
        }
        withAnimation(.easeInOut(duration: 0.22).delay(0.24)) { morphShowModal = false }
    }
    private func toggleStat(_ i: Int?) {
        if let i { openMorph(morphFrames["stat-\(i)"] ?? .zero); activeStat = i } else { closeMorph { activeStat = nil } }
    }
    private func toggleLevel(_ on: Bool) {
        if on { openMorph(morphFrames["level"] ?? .zero); activeLevel = true } else { closeMorph { activeLevel = false } }
    }
    private func toggleBell(_ on: Bool) {
        if on { openMorph(morphFrames["bell"] ?? .zero); activeBell = true } else { closeMorph { activeBell = false } }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    greeting
                    levelCard
                    searchRow
                    statCards
                    questsCard
                    xpRulesCard
                    quickActions
                    dailyCalendarCard
                    profileCard
                    Color.clear.frame(height: 8)
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .overlay { statModal }
            .overlay { levelModal }
            .overlay { bellModal }
            .navigationBarHidden(true)
            .coordinateSpace(.named(morphSpace))
            .onPreferenceChange(MorphFrameKey.self) { morphFrames = $0 }
            .onChange(of: morphTarget) { _, t in
                guard t.width > 1, activeStat != nil || activeLevel || activeBell, !morphExpanded else { return }
                withAnimation(morphSpring) { morphExpanded = true }                          // FLIP: card rect → full
                withAnimation(.easeOut(duration: 0.2).delay(0.12)) { morphReady = true }       // detail fades in after
            }
            .task { if !loaded { await load() } }
            .refreshable { await load() }
        }
    }

    // MARK: greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(greetingText).font(NXFont.text(20, .medium)).foregroundStyle(NX.foreground.opacity(0.8))
            Text("\(name)!").font(NXFont.display(32, .bold)).foregroundStyle(NX.foreground)
        }
        .padding(.top, 8)
    }

    /// Time-of-day greeting in Asia/Jakarta (this was hard-coded to "Good Morning," at any hour).
    private var greetingText: String {
        switch ProjDate.cal.component(.hour, from: Date()) {
        case 4..<11:  return "Good Morning,"
        case 11..<18: return "Good Afternoon,"
        default:      return "Good Evening,"
        }
    }

    // MARK: level/XP card

    private var levelCard: some View {
        Button { Haptics.tap(); toggleLevel(true) } label: {
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
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
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
        .buttonStyle(PressableCardStyle())
        .morphSource("level", in: morphSpace)
        .opacity(activeLevel && morphShowModal ? 0 : 1)
    }

    private var xpLabel: String {
        (game?.xp.totalXp ?? 0).formatted(.number.grouping(.automatic)) + " XP"
    }

    // MARK: search + bell

    private var searchRow: some View {
        HStack(spacing: 12) {
            NavigationLink { SearchView() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                    Text("Search..").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    Spacer()
                }
                .padding(.horizontal, 18).frame(height: 48)
                .background(NX.card, in: Capsule())
                .overlay(Capsule().strokeBorder(NX.border, lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button { Haptics.tap(); toggleBell(true) } label: {
                ZStack(alignment: .topTrailing) {
                    Circle().fill(NX.card).frame(width: 48, height: 48).overlay(Circle().strokeBorder(NX.border))
                        .overlay(Image(systemName: "bell.fill").font(.system(size: 17)).foregroundStyle(NX.foreground))
                    if unread > 0 {
                        Text("\(unread)").font(NXFont.text(9, .bold)).foregroundStyle(.white)
                            .padding(4).background(NX.danger, in: Circle()).offset(x: 3, y: -3)
                    }
                }
            }
            .buttonStyle(.plain)
            .morphSource("bell", in: morphSpace)
            .opacity(activeBell && morphShowModal ? 0 : 1)
        }
    }

    // MARK: stat cards

    private var statCards: some View {
        HStack(spacing: 12) {
            ForEach(Array(statData.enumerated()), id: \.offset) { i, d in
                Button { toggleStat(i) } label: {
                    StatCardView(value: d.value, total: d.total, label: d.label, icon: d.icon, from: d.from, to: d.to, glow: d.glow)
                        .morphSource("stat-\(i)", in: morphSpace)
                }
                .buttonStyle(PressableCardStyle())
                .opacity(activeStat == i && morphShowModal ? 0 : 1)
            }
        }
    }

    // MARK: stat-card morph modal

    @ViewBuilder private var statModal: some View {
        if let a = activeStat, a < statData.count {
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea()
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
            // Header is part of the morphing card (scales with it via the FLIP) like the web's layoutId.
            // The detail is a separate element that fades in just after the card lands (web: delay 0.15).
            ScrollView { statDetail(a).padding(2) }.frame(maxHeight: 320)
                .opacity(morphReady ? 1 : 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: d.from), Color(hex: d.to)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: Color(hex: d.glow).opacity(0.5), radius: 24, y: 12)
        }
        .modifier(MorphFlip(source: morphSourceRect, expanded: morphExpanded, space: morphSpace, target: $morphTarget))
        .opacity(morphShowModal ? 1 : 0)   // solid on open; crossfades out on close
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

    // MARK: level-card morph

    @ViewBuilder private var levelModal: some View {
        if activeLevel {
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea().transition(.opacity).onTapGesture { toggleLevel(false) }
                levelModalCard.padding(.horizontal, 18)
            }
            .zIndex(20)
        }
    }

    private var levelModalCard: some View {
        let g = game
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(LinearGradient(colors: [Color(hex: "#fb923c"), Color(hex: "#ea580c")], startPoint: .top, endPoint: .bottom))
                    Image(systemName: "sparkles").font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                }.frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text(g?.xp.levelName ?? "—").font(NXFont.display(22, .bold)).foregroundStyle(NX.foreground)
                    Text("Level \(g?.xp.level ?? 0)").font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { toggleLevel(false) } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).background(NX.muted, in: Circle())
                }.buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 6) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(NX.muted)
                        Capsule().fill(NX.onyx).frame(width: geo.size.width * (g?.levelPct ?? 0))
                    }
                }.frame(height: 10)
                HStack {
                    Text("\(g?.xp.totalXp ?? 0) XP").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                    Spacer()
                    if let next = g?.xp.nextFloor { Text("Next: \(next) XP").font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                }
            }
            .opacity(morphReady ? 1 : 0)
            HStack(spacing: 10) {
                levelStat("Streak", "\(g?.streakCurrent ?? 0) 🔥")
                levelStat("Quest klaim", "\(g?.questsDone ?? 0)")
                levelStat("Total XP", "\(g?.xp.totalXp ?? 0)")
            }
            .opacity(morphReady ? 1 : 0)
        }
        .padding(18).frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(NX.card)
                .shadow(color: .black.opacity(0.18), radius: 24, y: 12)
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border))
        }
        .modifier(MorphFlip(source: morphSourceRect, expanded: morphExpanded, space: morphSpace, target: $morphTarget))
        .opacity(morphShowModal ? 1 : 0)   // solid on open; crossfades out on close
    }

    private func levelStat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 3) {
            Text(value).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: bell morph (notifications preview)

    @ViewBuilder private var bellModal: some View {
        if activeBell {
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea().transition(.opacity).onTapGesture { toggleBell(false) }
                bellModalCard.padding(.horizontal, 18)
            }
            .zIndex(20)
        }
    }

    private var bellModalCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Circle().fill(NX.violet.opacity(0.12)).frame(width: 44, height: 44)
                    .overlay(Image(systemName: "bell.fill").font(.system(size: 18)).foregroundStyle(NX.violet))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notifikasi").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                    Text(unread > 0 ? "\(unread) belum dibaca" : "Semua kebaca").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { toggleBell(false) } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).background(NX.muted, in: Circle())
                }.buttonStyle(.plain)
            }
            Group {
                if notifs.isEmpty {
                    Text("Belum ada notifikasi.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(.vertical, 8)
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(notifs.prefix(8)) { n in
                                HStack(alignment: .top, spacing: 10) {
                                    Circle().fill(n.isRead ? NX.mutedFg.opacity(0.3) : NX.violet).frame(width: 7, height: 7).padding(.top, 5)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(n.title ?? n.typeLabel).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                        if let m = n.message { Text(m).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2) }
                                    }
                                    Spacer(minLength: 4)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }.frame(maxHeight: 300)
                }
            }
            .opacity(morphReady ? 1 : 0)   // detail fades in just after the card lands (web: delay 0.15)
        }
        .padding(18).frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(NX.card)
                .shadow(color: .black.opacity(0.18), radius: 24, y: 12)
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border))
        }
        .modifier(MorphFlip(source: morphSourceRect, expanded: morphExpanded, space: morphSpace, target: $morphTarget))
        .opacity(morphShowModal ? 1 : 0)   // solid on open; crossfades out on close
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

    // MARK: quick actions (Chat · Absensi)

    private var quickActions: some View {
        HStack(spacing: 12) {
            quickTile("Chat", "bubble.left.and.bubble.right.fill", NX.blue) { MessagesView() }
            quickTile("Absensi", "clock.badge.checkmark.fill", NX.success) { AttendanceView() }
        }
    }

    private func quickTile<D: View>(_ title: String, _ icon: String, _ tint: Color,
                                    @ViewBuilder dest: @escaping () -> D) -> some View {
        NavigationLink { dest() } label: {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
            }
            .frame(maxWidth: .infinity)
            .nexusCard(padding: 14, radius: 18)
        }
        .buttonStyle(PressableCardStyle())
    }

    // MARK: personal daily calendar
    //
    // Built from the caller's own assigned tasks (already loaded for the Mission stat), so it costs
    // no extra request: a 14-day strip with a dot on days that have something due + the picked day's list.

    private var calDays: [Date] {
        let start = ProjDate.cal.startOfDay(for: Date())
        return (0..<14).compactMap { ProjDate.cal.date(byAdding: .day, value: $0, to: start) }
    }
    private func tasksDue(on day: Date) -> [MyTask] {
        tasksList.filter {
            guard let d = ProjDate.parse($0.dueDate) else { return false }
            return ProjDate.cal.isDate(d, inSameDayAs: day)
        }
    }

    private var dailyCalendarCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Agenda harian").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Text(ProjDate.fmt("MMMM yyyy").string(from: selectedDay).capitalized)
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(calDays, id: \.self) { d in dayChip(d) }
                }
            }
            let items = tasksDue(on: selectedDay)
            if items.isEmpty {
                Text("Nggak ada task jatuh tempo di tanggal ini.")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.vertical, 4)
            } else {
                ForEach(items) { t in dayRow(t) }
            }
        }
        .nexusCard()
    }

    private func dayChip(_ d: Date) -> some View {
        let on = ProjDate.cal.isDate(d, inSameDayAs: selectedDay)
        let count = tasksDue(on: d).count
        return Button { selectedDay = d } label: {
            VStack(spacing: 3) {
                Text(ProjDate.fmt("EEE").string(from: d)).font(NXFont.text(10, .semibold))
                    .foregroundStyle(on ? Color.white.opacity(0.85) : NX.mutedFg)
                Text("\(ProjDate.cal.component(.day, from: d))").font(NXFont.display(16, .bold))
                    .foregroundStyle(on ? Color.white : NX.foreground)
                Circle().fill(count > 0 ? (on ? Color.white : NX.violet) : Color.clear)
                    .frame(width: 5, height: 5)
            }
            .frame(width: 46).padding(.vertical, 9)
            .background(on ? NX.violet : NX.muted.opacity(0.5),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func dayRow(_ t: MyTask) -> some View {
        NavigationLink { TaskDetailView(taskId: t.id) } label: {
            HStack(spacing: 10) {
                Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 15)).foregroundStyle(t.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title ?? "Untitled").font(NXFont.text(13, .semibold))
                        .foregroundStyle(t.isDone ? NX.mutedFg : NX.foreground)
                        .strikethrough(t.isDone).lineLimit(1)
                    Text(t.laneName).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
                if let p = t.priority, p.uppercased() != "NONE" { NexusChip(text: p.capitalized, tone: prioTone(p)) }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    private var profileCard: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                AvatarView(url: profile?.avatar, initial: String(name.first ?? "?").uppercased(), size: 64)
                VStack(alignment: .leading, spacing: 8) {
                    row("LEVEL", "\(game?.xp.level ?? 0) · \(game?.xp.levelName ?? "—")")
                    row("POIN PERIODE", (game?.xp.totalXp ?? 0).formatted(.number.grouping(.automatic)))
                }
                Spacer()
            }
            // Tuning Room is where name/password/members actually live — this used to be a no-op button.
            NavigationLink { SettingsView() } label: {
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
            SectionLabel(label).frame(width: 96, alignment: .leading)
            Text(value).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
    }

    // MARK: data

    private func load() async {
        async let p = try? APIClient.shared.profile()
        async let g = try? APIClient.shared.gamification()
        async let projs = try? APIClient.shared.projects()
        async let notifsN = try? APIClient.shared.notifications()

        let prof = await p
        profile = prof?.user
        game = await g
        projectsList = (await projs) ?? []
        projectCount = projectsList.count
        let nres = await notifsN
        notifs = nres?.notifications ?? []
        unread = nres?.unreadCount ?? notifs.filter { !$0.isRead }.count

        if let myId = prof?.user.id, let tasks = try? await APIClient.shared.myTasks(assigneeId: myId) {
            tasksList = tasks
            mission = (tasks.filter(\.isDone).count, tasks.count)
        }
        loaded = true
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
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: from), Color(hex: to)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: Color(hex: glow).opacity(0.45), radius: 14, y: 8)
        }
        .overlay(alignment: .topTrailing) {
            Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white.opacity(0.5)).padding(10)
        }
    }
}
