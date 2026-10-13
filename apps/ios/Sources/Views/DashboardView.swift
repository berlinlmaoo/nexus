import SwiftUI
import UIKit   // UIDevice, to label a passkey with the device it was made on

struct DashboardView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var hSize
    /// What a tapped notification pushed into THIS stack — a task or a project, which are single
    /// records rather than screens and so cannot travel through AppRouter the way `.attendance`
    /// and `.messages` do.
    ///
    /// One binding carrying one type, rather than two `String?` ones: a NavigationStack keys a
    /// destination by the type of its value, and ProjectDetailView — pushed from right here —
    /// declares a `String?` destination of its own for the tasks on its board.
    @State private var openTarget: NotificationTarget?
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
    /// `tasksList` re-bucketed by due day for the agenda card. Written wherever `tasksList` is.
    @State private var tasksByDay: [Date: [MyTask]] = [:]
    @State private var notifs: [NexusNotification] = []
    /// The bell panel's filter, and the chips for it. The chips are rebuilt where `notifs` is
    /// written rather than in the panel's body — the dashboard is the screen that got the
    /// performance pass, and counting 50 notifications belongs nowhere near a redraw.
    @State private var bellGroup: NotificationGroup = .all
    @State private var bellTabs: [NotificationFilterTab] = []
    /// The submission a notification points at, opened over the dashboard.
    @State private var openSubmission: SubmissionRef?
    @State private var activeStat: Int?
    @State private var activeLevel = false
    @State private var activeBell = false
    @State private var morphReady = false   // detail body fades in AFTER the card morphs (web: delay ~0.15)
    /// Passkey nudge. Only shown to someone who has none, and only until they dismiss it once —
    /// a prompt that keeps coming back after being answered stops being a prompt and becomes noise.
    @State private var showPasskeyNudge = false
    @State private var xpRulesOpen = false
    /// The quest whose claim is in flight. One at a time, as on the web: every Claim button is
    /// disabled while any claim runs, so a double tap cannot send the same claim twice.
    @State private var claimingQuest: String?
    /// The server's reason for the last refused claim, shown inside the Quest panel itself —
    /// the panel is an overlay, and an alert on top of a morphing card would fight it.
    @State private var questClaimError: String?
    @State private var passkeyBusy = false
    @State private var passkeyNote: String?
    @AppStorage("passkeyNudgeDismissed") private var passkeyNudgeDismissed = false
    // FLIP morph (ports framer-motion shared layoutId): measured source rects + the live transform state.
    /// A box, not `@State`: the source rects change on every scroll frame and are only read on a tap.
    /// See MorphFrameStore — as state this single line re-rendered the whole home screen at 120Hz.
    @State private var morphFrames = MorphFrameStore()
    @State private var morphSourceRect: CGRect = .zero
    @State private var morphExpanded = false
    @State private var morphTarget: CGRect = .zero
    @State private var shortcuts = ProjectShortcuts.shared
    /// Z Vault's tile is for company members, as in More.
    @State private var viewer = Viewer.shared
    /// The whole Inbox, pushed from the bell panel's "Open Inbox" (owner, 9 Oct 2026).
    @State private var showInbox = false
    /// A morph modal holds one column of content, so its width is set by reading comfort rather
    /// than by the screen. Uncapped it spanned a full iPad in landscape - a quests panel with one
    /// line in it stretched a metre wide. Never binds on a phone, which is narrower than this.
    private static let morphMaxWidth: CGFloat = 560
    /// The notification panel is a list, not a summary tile. Sized to the same 560pt as the stat
    /// cards it came out the same shape as them, which read as one component doing two jobs — and
    /// a list of five notifications squeezed into a tile is the wrong shape for reading anyway.
    private static let bellMaxWidth: CGFloat = 640
    @State private var morphShowModal = true   // open: modal solid (FLIP scale). close: fades out as the card fades in.

    private var name: String { profile?.name ?? auth.session?.userName ?? "" }

    private struct StatDatum {
        let value: Int; let total: Int?; let label: String; let icon: String
        let from: String; let to: String; let glow: String
    }
    private var statData: [StatDatum] {
        [
            .init(value: projectCount, total: nil, label: T("Projects"), icon: "rectangle.stack.fill", from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa"),
            .init(value: mission.done, total: mission.total, label: T("Tasks"), icon: "checklist", from: "#6ee7b7", to: "#059669", glow: "#34d399"),
            .init(value: game?.questsDone ?? 0, total: game?.questList.count ?? 0, label: T("Quests"), icon: "sparkles", from: "#fcd34d", to: "#ea580c", glow: "#fbbf24"),
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
        if let i { openMorph(morphFrames["stat-\(i)"]); activeStat = i } else { closeMorph { activeStat = nil } }
    }
    private func toggleLevel(_ on: Bool) {
        if on { openMorph(morphFrames["level"]); activeLevel = true } else { closeMorph { activeLevel = false } }
    }
    /// `then` runs once the panel has finished shrinking away.
    private func toggleBell(_ on: Bool, then: (() -> Void)? = nil) {
        // Opened fresh every time: a filter left on from a week ago would hide the very signal the
        // badge is counting, and there is nothing on the closed bell that says a filter is set.
        if on { bellGroup = .all; openMorph(morphFrames["bell"]); activeBell = true }
        else { closeMorph { activeBell = false; then?() } }
    }

    /// Tap a notification: strike it off, close the panel, then go where the web's inbox goes.
    private func openNotification(_ n: NexusNotification) {
        Haptics.tap()
        markNotificationRead(n)
        guard let target = n.tapTarget else { toggleBell(false); return }
        // A tab change is answered immediately: the panel belongs to THIS tab, so it is already off
        // screen while it shrinks. A push is not — it lands in this same stack, and arriving under
        // a card that is still visible reads as the tap having opened the wrong thing.
        if case .screen(let screen) = target {
            router.go(screen)
            toggleBell(false)
            return
        }
        // The web goes to the board with `?id=` and pops the drawer there; here the sheet is the
        // whole destination, presented once the panel has finished shrinking away so it does not
        // slide up through a card that is still on screen.
        if case .submission(let id) = target {
            toggleBell(false) { openSubmission = SubmissionRef(id: id) }
            return
        }
        switch target {
        case .task, .project: toggleBell(false) { openTarget = target }
        // A record on another screen: the router walks there and hands the id over, as a push does.
        default: router.open(target); toggleBell(false)
        }
    }

    /// Struck off here as well as on the server: `load()` refetches the entire dashboard, which is
    /// a lot of network for one dot whose new value is not in doubt.
    private func markNotificationRead(_ n: NexusNotification) {
        guard !n.isRead else { return }
        if let i = notifs.firstIndex(where: { $0.id == n.id }) { notifs[i].read = true }
        unread = max(0, unread - 1)
        Task { try? await APIClient.shared.markNotificationRead(id: n.id) }
    }

    /// Same trade as marking one read: the rows and the badge are struck off here, and the whole
    /// dashboard is not refetched to learn something already known. The endpoint is scoped to the
    /// caller server-side, so this can only ever clear the reader's own signals.
    @Environment(\.scenePhase) private var scenePhase
    /// GET /api/attendance/today, for the attendance bar above the XP card.
    @State private var attToday: AttendanceToday?

    private func markAllRead() {
        guard unread > 0 else { return }
        for i in notifs.indices { notifs[i].read = true }
        unread = 0
        Task { try? await APIClient.shared.markAllNotificationsRead() }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if hSize == .regular {
                    // A full-screen Mac left most of the window as empty margins either side of one
                    // phone-width column (owner, 29 Sep 2026). Two columns once there is room; a narrow
                    // window still gets the single column. The explicit idealWidth is what ViewThatFits
                    // measures, so long text inside cannot push the wide layout out.
                    // 860, not 980: a default-size Mac window with the sidebar open has about 950 pt
                    // here, so the Mac never left the phone column while the web, at the same window,
                    // shows its work column beside the profile rail (UI tour run 4). An iPad in
                    // landscape gets the two columns too; in portrait it keeps one.
                    ViewThatFits(in: .horizontal) {
                        threeColumns.frame(minWidth: 1500, idealWidth: 1500, maxWidth: .infinity)
                        wideColumns.frame(minWidth: 860, idealWidth: 860, maxWidth: .infinity)
                        singleColumn
                    }
                    .padding(.horizontal, 28).padding(.vertical, 16)
                } else {
                    singleColumn.padding(16)
                }
            }
            .background(NX.background.ignoresSafeArea())
            .overlay { statModal }
            .overlay { levelModal }
            .overlay { bellModal }
            .navigationBarHidden(true)
            .navigationDestination(item: $openTarget) { target in
                switch target {
                case .task(let id):    TaskDetailView(taskId: id)
                // A notification carries the project's id and no name; the board fills its own
                // header in once it loads.
                case .project(let id): ProjectDetailView(projectId: id, projectName: "")
                // Never stored: a whole screen goes through the router, and a submission opens as a
                // sheet over this one — neither travels through this stack.
                default: EmptyView()
                }
            }
            .navigationDestination(isPresented: $showInbox) { InboxView(providesOwnStack: false) }
            .sheet(item: $openSubmission) { SubmissionDetailSheet(submissionId: $0.id, preview: $0.preview) }
            .coordinateSpace(.named(morphSpace))
            .onChange(of: morphTarget) { _, t in
                guard t.width > 1, activeStat != nil || activeLevel || activeBell, !morphExpanded else { return }
                withAnimation(morphSpring) { morphExpanded = true }                          // FLIP: card rect → full
                withAnimation(.easeOut(duration: 0.2).delay(0.12)) { morphReady = true }       // detail fades in after
            }
            .task {
                if !loaded { await load() }
                await refreshPasskeyNudge()
            }
            .task { await viewer.loadIfNeeded() }
            .refreshable { await load() }
            // Home telling the app it is the thing on screen, so the floating GIDEON launcher —
            // drawn above the whole app, outside this stack — can be Home-only rather than
            // Home-tab-only. On the ScrollView and not on the NavigationStack: the stack stays
            // mounted through a push and would never report one. Two writes per push, and none
            // while scrolling.
            .onAppear { router.homeIsRoot = true }
            // The attendance bar re-reads today whenever Home comes back (after checking in from it).
            .onAppear { if loaded { Task { attToday = try? await APIClient.shared.attendanceToday() } } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { attToday = try? await APIClient.shared.attendanceToday() } }
            }
            // The bell's count, read with the dashboard and struck off by its mark-read buttons, is
            // the tab bar's too (More since the Calendar took Inbox's tab): no second fetch.
            .onChange(of: unread) { _, n in InboxBadge.shared.set(n) }
            .onDisappear { router.homeIsRoot = false }
        }
    }

    private var singleColumn: some View {
        LazyVStack(alignment: .leading, spacing: 18) {
            greeting
            attendanceBar
            levelCard
            searchRow
            statCards
            // No "Your Quests" card here: the owner dropped it. It only repeated the Monthly
            // Quests stat tile above, whose modal still lists every quest with its progress.
            xpRulesCard
            if showPasskeyNudge { passkeyNudge }
            quickActions
            projectShortcuts
            dailyCalendarCard
            profileCard
            Color.clear.frame(height: 8)
        }
    }

    /// Mac, wide window: the day's work on the left, the person (level, profile, XP rules) on the right.
    private var wideColumns: some View {
        VStack(alignment: .leading, spacing: 18) {
            greeting
            HStack(alignment: .top, spacing: 18) {
                // The web dashboard's order: the stat tiles, XP rules right under them, then the
                // calendar; the person (level, profile) in the rail on the right.
                VStack(alignment: .leading, spacing: 18) {
                    attendanceBar
                    searchRow
                    statCards
                    xpRulesCard
                    dailyCalendarCard
                    quickActions
                    projectShortcuts
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 18) {
                    levelCard
                    profileCard
                    if showPasskeyNudge { passkeyNudge }
                }
                .frame(width: 340)
            }
            Color.clear.frame(height: 8)
        }
    }

    /// Mac, very wide (full screen, sidebar hidden): the day's work, then projects and agenda, then
    /// the person.
    private var threeColumns: some View {
        VStack(alignment: .leading, spacing: 18) {
            greeting
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 18) {
                    attendanceBar
                    searchRow
                    statCards
                    quickActions
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 18) {
                    dailyCalendarCard
                    projectShortcuts
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 18) {
                    levelCard
                    profileCard
                    if showPasskeyNudge { passkeyNudge }
                    xpRulesCard
                }
                .frame(width: 380)
            }
            Color.clear.frame(height: 8)
        }
    }

    // MARK: greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(greetingText).font(NXFont.text(20, .medium)).foregroundStyle(NX.foreground.opacity(0.8))
            // No made-up name when the profile has none (copy sweep: "Commander" is gone).
            if !name.isEmpty { Text("\(name)!").font(NXFont.display(32, .bold)).foregroundStyle(NX.foreground) }
        }
        .padding(.top, 8)
    }

    /// Time-of-day greeting in Asia/Jakarta (this was hard-coded to "Good Morning," at any hour).
    private var greetingText: String {
        switch ProjDate.cal.component(.hour, from: Date()) {
        // Sentence case, as the web dashboard writes it (UI tour 13 Oct 2026).
        case 4..<11:  return T("Good morning,")
        case 11..<18: return T("Good afternoon,")
        default:      return T("Good evening,")
        }
    }

    // MARK: attendance bar

    /// Today's attendance at a glance, above the XP card (owner, 29 Sep 2026, as Android): tap to open
    /// Attendance; once checked in it says when and how much of the working day is left — Flexi ends
    /// nine hours after check-in, a fixed shift at its end time.
    private var attendanceBar: some View {
        NavigationLink { AttendanceView() } label: {
            TimelineView(.everyMinute) { ctx in
                let line = attendanceLine(now: ctx.date)
                HStack(spacing: 12) {
                    Image(systemName: "clock.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(NX.success)
                        .frame(width: 44, height: 44)
                        .background(NX.success.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(T("Attendance")).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground)
                        Text(line.text).font(NXFont.text(12, .semibold)).foregroundStyle(line.tint).lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    // "Open" is a chevron: its Indonesian key reads "Terbuka" (the adjective).
                    if line.action.isEmpty {
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
                    } else {
                        Text(line.action).font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                    }
                }
            }
            .nexusCard(padding: 12, radius: 18)
        }
        .buttonStyle(PressableCardStyle())
    }

    private func attendanceLine(now: Date) -> (text: String, tint: Color, action: String) {
        guard let t = attToday else { return (T("Check in, check out and requests"), NX.mutedFg, "") }
        let rec = t.today
        let inAt = Self.isoDate(rec?.checkInAt)
        let outAt = Self.isoDate(rec?.checkOutAt)
        if let inAt, let outAt {
            let mins = max(0, Int(outAt.timeIntervalSince(inAt) / 60))
            return (String(format: T("Done for today · worked %@"), Self.hm(mins)), NX.success, "")
        }
        if let inAt {
            let clock = Self.hhmm(inAt)
            if let end = Self.expectedEnd(from: inAt, shift: t.myShift) {
                let left = Int(end.timeIntervalSince(now) / 60)
                if left > 0 {
                    return (String(format: T("Checked in at %@ · %@ left"), clock, Self.hm(left)), NX.success, "")
                }
                return (String(format: T("Checked in at %@ · work hours are over — check out"), clock), NX.warning, T("Check out"))
            }
            return (String(format: T("Checked in at %@"), clock), NX.success, "")
        }
        if let req = t.todayRequest, req.status == "APPROVED" {
            return (T("Your approved request covers today"), NX.mutedFg, "")
        }
        if let s = t.myShift {
            let window = s.flexi == true ? "Flexi \(s.startTime)–\(s.endTime)" : "\(s.startTime)–\(s.endTime)"
            return (String(format: T("Not checked in yet · %@"), window), NX.warning, T("Check in"))
        }
        return (T("Not checked in yet"), NX.warning, T("Check in"))
    }

    private static func expectedEnd(from start: Date, shift: AttendanceToday.Shift?) -> Date? {
        guard let shift else { return nil }
        if shift.flexi == true { return start.addingTimeInterval(9 * 3600) }
        let parts = shift.endTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Jakarta") ?? .current
        var comps = cal.dateComponents([.year, .month, .day], from: start)
        comps.hour = parts[0]; comps.minute = parts[1]
        guard let end = cal.date(from: comps) else { return nil }
        return end > start ? end : end.addingTimeInterval(24 * 3600)
    }
    private static func isoDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
    private static func hhmm(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        return f.string(from: d)
    }
    private static func hm(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        return h > 0 ? String(format: T("%dh %dm"), h, m) : String(format: T("%dm"), m)
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
                        // "…" until the numbers are in. "Lv.0 / 0 XP" looked like a fact.
                        Text(game.map { "Lv.\($0.xp.level)" } ?? "…").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
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
        .morphSource("level", in: morphSpace, store: morphFrames)
        .opacity(activeLevel && morphShowModal ? 0 : 1)
    }

    private var xpLabel: String {
        guard let game else { return "… XP" }
        return game.xp.totalXp.formatted(.number.grouping(.automatic)) + " XP"
    }

    // MARK: search + bell

    private var searchRow: some View {
        HStack(spacing: 12) {
            NavigationLink { SearchView() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                    Text(T("Search…")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
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
            .morphSource("bell", in: morphSpace, store: morphFrames)
            .opacity(activeBell && morphShowModal ? 0 : 1)
        }
    }

    // MARK: stat cards

    private var statCards: some View {
        HStack(spacing: 12) {
            ForEach(Array(statData.enumerated()), id: \.offset) { i, d in
                Button { toggleStat(i) } label: {
                    StatCardView(value: d.value, total: d.total, label: d.label, icon: d.icon, from: d.from, to: d.to, glow: d.glow)
                        .morphSource("stat-\(i)", in: morphSpace, store: morphFrames)
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
                // No scrim. Dimming the whole screen to open a card that is itself a panel of the
                // same screen reads as a modal interruption, which this is not — it is one card
                // growing. Still a full-size layer so a tap outside closes it; clear needs an
                // explicit contentShape or it lets touches straight through.
                Color.clear.ignoresSafeArea()
                    .contentShape(Rectangle())
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
                        .touchTarget44(drawn: 32)
                }.buttonStyle(.plain)
            }
            // Header is part of the morphing card (scales with it via the FLIP) like the web's layoutId.
            // The detail is a separate element that fades in just after the card lands (web: delay 0.15).
            ScrollView { statDetail(a).padding(2) }.frame(maxHeight: 320)
                .opacity(morphReady ? 1 : 0)
        }
        .padding(18)
        .frame(maxWidth: Self.morphMaxWidth)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: d.from), Color(hex: d.to)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: Color(hex: d.glow).opacity(0.5), radius: 24, y: 12)
        }
        .modifier(MorphFlip(source: morphSourceRect, expanded: morphExpanded, space: morphSpace, target: $morphTarget))
        .opacity(morphShowModal ? 1 : 0)   // solid on open; crossfades out on close
    }

    /// The Task card's rows: every open task, plus tasks finished within the last 30 days. Older
    /// finished ones are dropped from the card only — the agenda and widgets still get `tasksList`.
    private static func taskCardRows(_ tasks: [MyTask]) -> [MyTask] {
        let now = Date()
        return tasks.filter { !$0.isLongDone(now: now) }
    }
    private var cardTasks: [MyTask] { Self.taskCardRows(tasksList) }

    @ViewBuilder private func statDetail(_ a: Int) -> some View {
        switch a {
        case 0: detailList(projectsList.map { ($0.name, $0.statusLabel) }, empty: T("No projects yet."))
        case 1: detailList(cardTasks.map { (UntitledText.task($0.title), $0.isDone ? T("Done") : T("Open")) }, empty: T("No open tasks."))
        default: questDetailList
        }
    }

    /// The Quest panel's list: `detailList`'s rows, plus a Claim button on every quest the
    /// server marks claimable. This is the only place on iOS where quest XP can be claimed.
    private var questDetailList: some View {
        let quests = game?.questList ?? []
        return VStack(spacing: 8) {
            if let questClaimError {
                Text(questClaimError).font(NXFont.text(12, .semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            if quests.isEmpty {
                Text(T("No quests right now.")).font(NXFont.text(13)).foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            } else {
                ForEach(quests.prefix(40)) { q in
                    HStack(spacing: 8) {
                        Text(q.title).font(NXFont.text(13, .semibold)).foregroundStyle(.white).lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(q.progress)/\(q.target) · +\(q.xpReward) XP").font(NXFont.text(11, .semibold))
                            .foregroundStyle(.white.opacity(0.8)).fixedSize()
                        questClaimControl(q)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    /// Claimed wins over claimable, the same order the web checks them in.
    @ViewBuilder private func questClaimControl(_ q: Gamification.Quest) -> some View {
        if q.claimed == true {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white).accessibilityLabel(T("Claimed"))
        } else if q.claimable == true {
            let busy = claimingQuest == q.key
            Button { claimQuest(q) } label: {
                Group {
                    if busy { ProgressView().controlSize(.mini).tint(Color(hex: "#ea580c")) }
                    else { Text(T("Claim")).font(NXFont.text(11, .bold)).foregroundStyle(Color(hex: "#ea580c")) }
                }
                .frame(minWidth: 44).padding(.horizontal, 10).padding(.vertical, 5)
                .background(.white, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(claimingQuest != nil)
            .opacity(claimingQuest != nil && !busy ? 0.5 : 1)
            .accessibilityLabel(busy ? T("Claiming…") : "\(T("Claim")) +\(q.xpReward) XP")
        }
    }

    private func claimQuest(_ q: Gamification.Quest) {
        guard claimingQuest == nil else { return }
        Haptics.tap()
        claimingQuest = q.key
        questClaimError = nil
        Task {
            defer { claimingQuest = nil }
            do {
                let result = try await APIClient.shared.claimQuest(q.key)
                Haptics.success()
                // Refetch rather than patch: the award can move the level, and the stat tile, the
                // level card and the Home Screen glance all read from `game`. If the refetch fails
                // the claim still happened, so mark it locally instead of leaving a Claim button
                // that would only earn "Already claimed this period".
                if let fresh = try? await APIClient.shared.gamification() {
                    game = fresh
                } else if let g = game {
                    game = Gamification(
                        xp: result.xp ?? g.xp, streak: g.streak,
                        quests: g.questList.map { $0.key == q.key
                            ? .init(key: $0.key, title: $0.title, progress: $0.progress, target: $0.target,
                                    xpReward: $0.xpReward, claimed: true, claimable: false)
                            : $0 })
                }
                GlancePresence.refresh(tasks: tasksList, unread: unread, game: game)
            } catch {
                Haptics.warning()
                questClaimError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't claim the quest.")
            }
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
                // No scrim. Dimming the whole screen to open a card that is itself a panel of the
                // same screen reads as a modal interruption, which this is not — it is one card
                // growing. Still a full-size layer so a tap outside closes it; clear needs an
                // explicit contentShape or it lets touches straight through.
                Color.clear.ignoresSafeArea().contentShape(Rectangle()).onTapGesture { toggleLevel(false) }
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
                        .touchTarget44(drawn: 32)
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
                levelStat(T("Streak"), "\(g?.streakCurrent ?? 0) 🔥")
                levelStat(T("Quests claimed"), "\(g?.questsDone ?? 0)")
                levelStat(T("Total XP"), "\(g?.xp.totalXp ?? 0)")
            }
            .opacity(morphReady ? 1 : 0)
        }
        .padding(18).frame(maxWidth: Self.morphMaxWidth)
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
                // No scrim. Dimming the whole screen to open a card that is itself a panel of the
                // same screen reads as a modal interruption, which this is not — it is one card
                // growing. Still a full-size layer so a tap outside closes it; clear needs an
                // explicit contentShape or it lets touches straight through.
                Color.clear.ignoresSafeArea().contentShape(Rectangle()).onTapGesture { toggleBell(false) }
                bellModalCard.padding(.horizontal, 18)
            }
            .zIndex(20)
        }
    }

    /// The panel shows the newest eight, so the filter has to be applied BEFORE the cut — filtering
    /// the eight would show "Attendance 12" and then two rows.
    private var bellShown: [NexusNotification] {
        bellGroup == .all ? notifs : notifs.filter { $0.group == bellGroup }
    }

    private var bellModalCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Circle().fill(NX.violet.opacity(0.12)).frame(width: 44, height: 44)
                    .overlay(Image(systemName: "bell.fill").font(.system(size: 18)).foregroundStyle(NX.violetText))
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Notifications")).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                    Text(unread > 0 ? "\(unread) \(T("unread"))" : T("All read")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                if unread > 0 {
                    Button { Haptics.tap(); markAllRead() } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "checkmark.circle").font(.system(size: 12, weight: .bold))
                            Text(T("Mark all")).font(NXFont.text(12, .semibold))
                        }
                        .foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(NX.muted, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Button { toggleBell(false) } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).background(NX.muted, in: Circle())
                        .touchTarget44(drawn: 32)
                }.buttonStyle(.plain)
            }
            Group {
                if notifs.isEmpty {
                    Text(T("Nothing needs you yet. Requests, replies and mentions land here the moment they happen."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(.vertical, 8).fixedSize(horizontal: false, vertical: true)
                } else {
                    NotificationFilterBar(tabs: bellTabs, group: $bellGroup, compact: true)
                    if bellShown.isEmpty {
                        Text(T("No notifications of this kind.")).font(NXFont.text(13))
                            .foregroundStyle(NX.mutedFg).padding(.vertical, 8)
                    }
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(bellShown.prefix(8)) { n in
                                Button { openNotification(n) } label: {
                                    HStack(alignment: .top, spacing: 10) {
                                        if let a = n.actor {
                                            AvatarView(url: a.avatar, initial: a.initial, size: 28)
                                        } else {
                                            Circle().fill(n.isRead ? NX.mutedFg.opacity(0.3) : NX.violet).frame(width: 7, height: 7).padding(.top, 5)
                                        }
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(n.title ?? n.typeLabel).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                            if let m = n.message { Text(m).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2) }
                                        }
                                        Spacer(minLength: 4)
                                        // Only where the tap leads somewhere: a chevron on a row
                                        // that goes nowhere is a promise the app cannot keep.
                                        if n.tapTarget != nil {
                                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                                                .foregroundStyle(NX.mutedFg).padding(.top, 2)
                                        }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }.frame(maxHeight: 460)
                }
            }
            .opacity(morphReady ? 1 : 0)   // detail fades in just after the card lands (web: delay 0.15)
            // The bell and the Inbox are the same notifications: the panel is the newest few, the
            // Inbox all of them with its filters. The bell stays a quick look and leads on to the
            // full screen (owner, 9 Oct 2026; the web panel has the same button).
            Button { Haptics.tap(); toggleBell(false) { showInbox = true } } label: {
                HStack(spacing: 6) {
                    Text(T("Open Inbox")).font(NXFont.text(14, .semibold))
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(Color.white)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(NX.violet, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .opacity(morphReady ? 1 : 0)
        }
        .padding(18).frame(maxWidth: Self.bellMaxWidth)
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

    // Mirror of the web's XpRulesCard: the same header, and the same three tables underneath once it
    // is opened. The card shipped as a plain HStack with a chevron drawn on it — a button that was not
    // a button, which is exactly what the BoD tapped on 16 Sep 2026 and reported. The tables are
    // literals here, as on the web; the rules live in policy, not in an endpoint.
    private var xpRulesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { xpRulesOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "gift.fill").font(.system(size: 16)).foregroundStyle(NX.foreground)
                        .frame(width: 40, height: 40).background(NX.muted, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        // The web card's title and line (UI tour 13 Oct 2026).
                        Text(T("XP rules")).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                        Text(T("What takes XP away and what adds it")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(xpRulesOpen ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("XP rules"))
            .accessibilityValue(xpRulesOpen ? T("Expanded") : T("Collapsed"))

            if xpRulesOpen {
                VStack(alignment: .leading, spacing: 18) {
                    Divider().overlay(NX.border)
                    xpRulesSection(title: T("XP Penalties"), icon: "arrow.down.right", tone: NX.danger, rows: XpRules.penalties)
                    xpRulesSection(title: T("XP Bonuses"), icon: "arrow.up.right", tone: NX.success, rows: XpRules.bonuses)
if !XpRules.tiers.isEmpty {
                                        VStack(alignment: .leading, spacing: 6) {
                        Text(T("Tier rewards (end of period)").uppercased())
                            .font(NXFont.text(11, .bold)).tracking(0.6).foregroundStyle(NX.mutedFg)
                        ForEach(XpRules.tiers, id: \.label) { t in
                            HStack(spacing: 10) {
                                Text(t.range).font(NXFont.text(14, .black)).monospacedDigit()
                                Text(t.label.uppercased()).font(NXFont.text(11, .bold)).tracking(0.5)
                                Text(t.reward).font(NXFont.text(13, .semibold)).lineLimit(2)
                                Spacer(minLength: 0)
                            }
                            .foregroundStyle(t.tone)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(t.tone.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(t.tone.opacity(0.25)))
                        }
                    }
                    }
                    Text(T("\"Automatic\" is calculated by the system from attendance & end of period. \"Manual\" is awarded by Head/HR/management based on their judgment."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 14)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .nexusCard(padding: 14)
        .clipped()
    }

    private func xpRulesSection(title: String, icon: String, tone: Color, rows: [XpRules.Row]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10, weight: .bold))
                Text(title.uppercased()).font(NXFont.text(11, .bold)).tracking(0.6)
            }
            .foregroundStyle(tone)
            ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                if i > 0 { Divider().overlay(NX.border.opacity(0.6)) }
                HStack(alignment: .top, spacing: 10) {
                    Text(r.xp).font(NXFont.text(14, .black)).monospacedDigit().foregroundStyle(tone)
                        .frame(width: 84, alignment: .leading)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(T(r.rule)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        Text(T(r.note)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Text(r.auto ? T("Automatic") : T("Manual"))
                        .font(NXFont.text(10, .bold))
                        .foregroundStyle(r.auto ? NX.violetText : NX.mutedFg)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(r.auto ? NX.accentBg : NX.muted, in: Capsule())
                }
                .padding(.vertical, 5)
            }
        }
    }

    // MARK: passkey nudge

    private var passkeyNudge: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "person.badge.key.fill")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                Text(T("Sign in with Face ID")).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 0)
                Button { dismissPasskeyNudge() } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .touchTarget44(drawn: 13)
                }.buttonStyle(.plain)
            }
            Text(T("Add a passkey and you can skip typing your password. It stays on this device, and your password keeps working."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            if let passkeyNote {
                Text(passkeyNote).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            }
            Button { Task { await addPasskey() } } label: {
                HStack(spacing: 8) {
                    if passkeyBusy { ProgressView().tint(.white).scaleEffect(0.8) }
                    Text(T("Add a passkey")).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain).disabled(passkeyBusy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14)
    }

    private func dismissPasskeyNudge() {
        passkeyNudgeDismissed = true
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { showPasskeyNudge = false }
    }

    /// Asked once per launch, and only when nothing has been dismissed: a network round trip on a
    /// screen this hot is only worth it while the answer can still change what is drawn.
    private func refreshPasskeyNudge() async {
        guard !passkeyNudgeDismissed, !showPasskeyNudge else { return }
        guard let list = try? await APIClient.shared.passkeyList() else { return }
        if list.isEmpty { withAnimation { showPasskeyNudge = true } }
    }

    private func addPasskey() async {
        passkeyBusy = true
        defer { passkeyBusy = false }
        do {
            try await PasskeyManager.register(label: UIDevice.current.name)
            passkeyNote = nil
            dismissPasskeyNudge()
        } catch PasskeyError.canceled {
            // Closing Face ID is a normal thing to do; the card simply stays.
        } catch {
            passkeyNote = (error as? LocalizedError)?.errorDescription ?? T("Couldn't add that passkey.")
        }
    }

    // MARK: quick actions

    /// Three across rather than two, because six tiles stacked two-wide push the agenda a whole
    /// screen further down — and the point of a shortcut is to be reachable without scrolling.
    private let quickColumns = [GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)]

    private var quickActions: some View {
        LazyVGrid(columns: quickColumns, spacing: 12) {
            // Chat and the Calendar each have a tab, so their tiles went to Z Vault and Ticket (owner,
            // 9 Oct 2026), in the same places.
            if viewer.isCompanyMember {
                quickTile(T("Z Vault"), "externaldrive.fill", NX.violetText) { VaultView() }
            }
            quickTile(T("Attendance"), "clock.badge.checkmark.fill", NX.success) { AttendanceView() }
            quickTile(T("Leaderboard"), "trophy.fill", NX.warning) { LeaderboardView() }
            quickTile(T("Room Booking"), "door.left.hand.open", NX.coral) { RoomBookingView() }
            quickTile(T("Threads"), "text.bubble.fill", NX.violetText) { ThreadsView() }
            quickTile(T("Ticket"), "ticket.fill", NX.blue) { TicketsView() }
        }
    }

    // MARK: pinned + recently opened projects
    //
    // The same shortcuts the iPad sidebar carries, on the screen a phone actually starts from. They
    // are stored on the device by ProjectShortcuts and recorded by ProjectDetailView itself, so a
    // project counts as visited whichever route led in — and opening one here feeds the sidebar on
    // the iPad in exactly the same way.

    @ViewBuilder private var projectShortcuts: some View {
        let pinned = shortcuts.pinned
        // Anything pinned is skipped below: a project in both lists reads as a duplicate rather
        // than as two kinds of shortcut.
        let recents = shortcuts.recent.filter { !shortcuts.isPinned($0.id) }
        if !pinned.isEmpty || !recents.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(T("Projects")).padding(.leading, 4)
                VStack(spacing: 0) {
                    ForEach(Array((pinned + recents).enumerated()), id: \.element.id) { idx, ref in
                        if idx > 0 { Divider().overlay(NX.border) }
                        projectShortcutRow(ref)
                    }
                }
                .nexusCard(padding: 0, radius: 18)
            }
        }
    }

    private func projectShortcutRow(_ ref: ProjectRef) -> some View {
        HStack(spacing: 10) {
            NavigationLink {
                ProjectDetailView(projectId: ref.id, projectName: ref.name)
            } label: {
                HStack(spacing: 10) {
                    ProjectRefIcon(ref: ref, size: 32)
                    Text(ref.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Its own button, outside the link: tapping a pin should pin, not open the project.
            Button {
                shortcuts.togglePin(ref)
            } label: {
                Image(systemName: shortcuts.isPinned(ref.id) ? "pin.fill" : "pin")
                    .font(.system(size: 13))
                    .foregroundStyle(shortcuts.isPinned(ref.id) ? NX.violetText : NX.mutedFg)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(shortcuts.isPinned(ref.id) ? T("Unpin") : T("Pin"))
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func quickTile<D: View>(_ title: String, _ icon: String, _ tint: Color,
                                    @ViewBuilder dest: @escaping () -> D) -> some View {
        NavigationLink { dest() } label: {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                // Two lines and a fixed height: "Room Booking" wraps at this width, and a row of
                // tiles where one is taller than its neighbours reads as a mistake rather than as a
                // longer word.
                Text(title).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 96)
            .nexusCard(padding: 12, radius: 18)
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
    /// Due dates parsed ONCE per load instead of once per lookup. `tasksDue(on:)` is asked fifteen
    /// times a body pass — the picked day plus each of the fourteen chips — and it used to ISO-parse
    /// every assigned task on every one of them, so 50 tasks meant 750 date parses just to draw the
    /// card. Keyed by start-of-day in the same Jakarta calendar the old `isSameDayAs` compared in.
    private static func bucketByDay(_ tasks: [MyTask]) -> [Date: [MyTask]] {
        var out: [Date: [MyTask]] = [:]
        for t in tasks {
            guard let d = ProjDate.parse(t.dueDate) else { continue }
            out[ProjDate.cal.startOfDay(for: d), default: []].append(t)
        }
        return out
    }
    private func tasksDue(on day: Date) -> [MyTask] {
        tasksByDay[ProjDate.cal.startOfDay(for: day)] ?? []
    }

    private var dailyCalendarCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(T("Daily agenda")).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
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
                Text(T("Nothing due on this date."))
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
                    Text(UntitledText.task(t.title)).font(NXFont.text(13, .semibold))
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
                    row(T("POINTS THIS PERIOD"), (game?.xp.totalXp ?? 0).formatted(.number.grouping(.automatic)))
                }
                Spacer()
            }
            // Tuning Room is where name/password/members actually live — this used to be a no-op button.
            NavigationLink { SettingsView() } label: {
                HStack(spacing: 6) { Image(systemName: "pencil"); Text(T("Edit Profile")) }
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
        async let att = try? APIClient.shared.attendanceToday()

        let prof = await p
        profile = prof?.user
        attToday = await att
        game = await g
        projectsList = (await projs) ?? []
        projectCount = projectsList.count
        let nres = await notifsN
        notifs = nres?.notifications ?? []
        unread = nres?.unreadCount ?? notifs.filter { !$0.isRead }.count
        bellTabs = notificationFilterTabs(notifs)

        if let myId = prof?.user.id, let tasks = try? await APIClient.shared.myTasks(assigneeId: myId) {
            tasksList = tasks
            tasksByDay = Self.bucketByDay(tasks)
            // Count from the same list the card opens, so "3/5" always matches the rows it shows.
            let shown = Self.taskCardRows(tasks)
            mission = (shown.filter(\.isDone).count, shown.count)
        }
        loaded = true

        // The one moment all three numbers are known together, which is why the Home Screen is fed
        // from here and not from three screens each publishing its own idea of "due today".
        GlancePresence.refresh(tasks: tasksList, unread: unread, game: game)
    }
}

/// One gradient stat tile (Projects / Task / Quest).
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

/// The XP policy as shown on the web dashboard (apps/nexus-lovable-ui/src/components/XpRulesCard.tsx).
/// Keep the two in step by hand: there is no rules endpoint, and the numbers are policy, not config.
enum XpRules {
    struct Row { let xp: String; let rule: String; let note: String; let auto: Bool }
    struct Tier { let range: String; let label: String; let reward: String; let tone: Color }

    static let penalties: [Row] = [
        Row(xp: "-1 XP/min", rule: "Late check-in", note: "Max 120 min. >120 → docks a day off", auto: true),
        Row(xp: "-25 XP", rule: "No check-out (forgot to log out)", note: "Per incident", auto: true),
        // The server's rule (offsite-checkouts/[recordId]: awardXpOnce −25 on reject). The card said
        // "−30, left without approval" — a number that existed nowhere but here.
        Row(xp: "-25 XP", rule: "Offsite check-out rejected by your approver", note: "Per incident", auto: true),
        Row(xp: "-150 XP", rule: "No-show, no heads-up (absent)", note: "Per day", auto: true),
    ]
    // No automatic bonus. The "+50 for a month without absence" and the Excellent/Good/Review tiers
    // were retired on the server (src/lib/period-rewards.ts: "XP is now 100% quest-only, assigned
    // by BoD"); the card kept promising them for months.
    static let bonuses: [Row] = [
        Row(xp: "+30 XP", rule: "Finish a side quest from your Head", note: "Head's call", auto: false),
        Row(xp: "+50 XP", rule: "Performance beyond target", note: "Management's call", auto: false),
        Row(xp: "+20 XP", rule: "Feedback the company adopts", note: "HR's call", auto: false),
    ]
    /// Empty on purpose — see `bonuses`. The section that draws these hides itself when there are none.
    static let tiers: [Tier] = []
}
