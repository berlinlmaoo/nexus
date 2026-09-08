import SwiftUI
import MapKit

/// Native port of the web MobileCheckInHero: map hero + violet gradient time card (live clock,
/// schedule, IN/OUT) + green "Presence In" / red "Presence Out" + offsite-reason flow.
struct AttendanceView: View {
    @Environment(AuthStore.self) private var auth
    @State private var today: AttendanceToday?
    @State private var loading = true
    @State private var error: String?

    @State private var loc = LocationManager()
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var showCamera = false
    @State private var pendingAction: Action?
    @State private var busy = false
    @State private var banner: Banner?

    @State private var pendingSelfie: Data?
    @State private var pendingCoords: (lat: Double, lng: Double)?
    /// Kept whole so the offsite retry and the offline queue carry the same integrity signals as
    /// the first attempt — an offline tap is the easiest place to fake a position, so it is the
    /// last place that should travel without evidence.
    @State private var pendingFix: LocationManager.Fix?
    private var queue: AttendanceQueue { AttendanceQueue.shared }
    @State private var showOffsite = false
    @State private var offsiteReason = ""
    @State private var reflection = ""

    /// The server rejects a check-out whose reflection is shorter than this (mirrors the web's
    /// "Daily Reflection · required before check-out · min 200 characters").
    private let reflectionMin = 200
    private var reflectionCount: Int { reflection.trimmingCharacters(in: .whitespacesAndNewlines).count }
    private var reflectionOK: Bool { reflectionCount >= reflectionMin }
    /// Only gate the flow while an open check-in is actually waiting to be closed.
    private var needsReflection: Bool { (checkedIn || forcePending) && !checkedOut }

    enum Action { case checkIn, checkOut }
    struct Banner: Identifiable { let id = UUID(); let text: String; let good: Bool }

    private var rec: AttendanceRecord? { today?.today }
    /// A PREVIOUS day's open check-in the user forgot to close. While this exists the backend blocks a
    /// new check-in ("close it first"), so we must surface a check-out flow for it (web "Finish yesterday's attendance").
    private var pendingRec: AttendanceRecord? { today?.pendingCheckout }
    private var forcePending: Bool { pendingRec != nil }
    private var dispRec: AttendanceRecord? { rec ?? pendingRec }   // what the hero/metrics display
    /// Taps that are on this phone and have not reached the server yet.
    ///
    /// While the server is down `load()` fails and `rec` is nil, so asking only the server whether
    /// somebody is clocked in answers "no" for everyone. On 8 September that is what happened: a
    /// person checked in offline at 10:29, and PRESENCE OUT stayed greyed out for the rest of the
    /// day because the only thing that could have enabled it was the server that was off. The
    /// nightly cron then read the missing check-out as an absence and took the day-off token.
    ///
    /// The queue is the other half of the truth, and it is on the device where the tap happened.
    private var queuedCheckIn: Bool { queue.pending.contains { $0.kind == .checkIn } }
    private var queuedCheckOut: Bool { queue.pending.contains { $0.kind == .checkOut } }

    private var checkedIn: Bool { rec?.hasCheckedIn == true || queuedCheckIn }
    private var checkedOut: Bool { rec?.hasCheckedOut == true || queuedCheckOut }
    private var pending: Bool { rec?.checkOutApproval == "PENDING" }   // offsite checkout awaiting BoD approval

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    hero
                    if loading { loadingRow }
                    if let error { errorBanner(error) }
                    if needsReflection { reflectionCard }
                    presenceButtons
                    // Say WHY the button is greyed out, right where the greyed-out button is.
                    if needsReflection && !reflectionOK {
                        Text(T("PRESENCE OUT unlocks once the daily reflection above reaches 200 characters."))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    if showOffsite { offsitePrompt }
                    if forcePending { infoBanner(forcePendingMessage, tone: .warning) }
                    if pending { infoBanner(T("⏳ Checkout outside the office area — waiting for BoD approval"), tone: .warning) }
                    if rec?.checkOutApproval == "REJECTED" { infoBanner(T("Your out-of-area checkout was rejected by the BoD."), tone: .danger) }
                    if let banner { infoBanner(banner.text, tone: banner.good ? .success : .danger) }
                    // A queued tap must never be invisible: someone who thinks they clocked in and
                    // did not would only find out at payroll.
                    if queue.count > 0 {
                        infoBanner(queue.count == 1
                                   ? T("1 attendance saved offline — not sent yet.")
                                   : "\(queue.count) " + T("attendance records saved offline — not sent yet."),
                                   tone: .warning)
                    }
                    metricsGrid
                    // OR, not a `??` fallback: the web is `canManageAttendance || canReviewAttendanceRequests`.
                    // With `??`, a server that sends canReviewAttendanceRequests=false stops the chain
                    // dead and an attendance MANAGER loses the review UI they're entitled to.
                    let canReview = (today?.canReviewAttendanceRequests ?? false) || (today?.canManageAttendance ?? false)
                    // Offsite check-outs used to be a second card below this one, and the reviewer
                    // had to know it was there. They are now one queue inside Submissions — but on
                    // canManageAttendance alone, which is what their endpoint actually checks. The
                    // old card was gated on `canReview`, so a team lead with only the requests
                    // permission got a card that could do nothing but 403.
                    AttendanceRequestsCard(canReview: canReview,
                                           canReviewOffsite: today?.canManageAttendance ?? false)
                    StreakBoardCard(canManage: today?.canManageAttendance ?? false)
                    if today?.canManageAttendance == true { OfficesCard() }
                }
                .padding(16)
            }
        }
        .navigationTitle(T("Attendance"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Drain before loading: a queued tap that lands now should be reflected in the numbers
            // this screen is about to fetch, not a refresh later.
            await AttendanceQueue.shared.flush()
            await load()
        }
        .onAppear { loc.requestPermissionIfNeeded() }
        .refreshable { await load() }
        .sheet(isPresented: $showCamera) {
            CameraPicker { data in pendingSelfie = data; Task { await submit(selfie: data) } }.ignoresSafeArea()
        }
    }

    // MARK: hero (map + gradient time card)

    /// How far the GPS dot is pushed below the map frame's centre, in points.
    /// Raise it if the purple card grows taller and starts covering the dot again.
    private static let pinDrop: CGFloat = 90

    private var hero: some View {
        ZStack {
            // The GPS dot sits at the map's centre, and the centre is exactly where the purple
            // card lands. Make the map taller than the visible frame and slide it down, so the dot
            // clears the card without touching the zoom.
            //
            // The second .frame is what keeps the trick contained. A ZStack takes the size of its
            // largest child, so the oversized map made the whole stack 540pt tall; the outer
            // .frame(height: 360) then CENTRED that stack and clipped 90pt off each end - taking
            // the top of the purple card and the entire bottom row with it. Collapsing the map's
            // layout height back to 360 right here leaves the offset as a pure paint-time shift,
            // which is all it was ever meant to be.
            Map(position: $camera) { UserAnnotation() }
                .mapStyle(.standard(elevation: .flat))
                .disabled(true)
                .frame(height: 360 + Self.pinDrop * 2)
                .offset(y: Self.pinDrop)
                .frame(height: 360)
                .clipped()

            VStack {
                timeCard.padding(12)
                Spacer()
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(statusText)\(officeSuffix)")
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(.ultraThinMaterial, in: Capsule())
                        // Without this the exemption is invisible: the member only discovers it
                        // by not being rejected. The web hero shows the same pill.
                        if today?.noGeofence == true {
                            Text(T("📍 Location-free — clock in from anywhere"))
                                .font(NXFont.text(12, .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(Self.locationFree, in: Capsule())
                        }
                    }
                    Spacer()
                    Button { camera = .userLocation(fallback: .automatic) } label: {
                        Image(systemName: "location.fill").font(.system(size: 16)).foregroundStyle(NX.foreground)
                            .frame(width: 40, height: 40).background(NX.card, in: Circle())
                            .overlay(Circle().strokeBorder(NX.border)).nexusShadowSoft()
                    }
                }
                .padding(12)
            }
        }
        .frame(height: 360)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
        .nexusShadowSoft()
    }

    private var timeCard: some View {
        VStack(spacing: 8) {
            HStack {
                Text(Self.dateLabel(.now)).font(NXFont.text(12, .semibold)).foregroundStyle(.white.opacity(0.9))
                Spacer()
            }
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                Text(Self.clock.string(from: ctx.date))
                    .font(NXFont.display(46, .bold)).monospacedDigit().foregroundStyle(.white)
            }
            Text(shiftLabel)
                .font(NXFont.text(12, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(.white.opacity(0.18), in: Capsule())
            HStack(spacing: 32) {
                Text("IN \(dispRec?.checkInAt.flatMap(Self.hhmm) ?? "--:--")")
                Text("OUT \(dispRec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")")
            }
            .font(NXFont.text(14, .bold)).monospacedDigit().foregroundStyle(.white.opacity(0.9))
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [Color(hex: "#c4b5fd"), Color(hex: "#7c3aed")], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.15)))
        .shadow(color: Color(hex: "#a78bfa").opacity(0.5), radius: 14, y: 8)
    }

    // MARK: fun-metric cards (web FunMetric row)

    private var metricsGrid: some View {
        let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        return LazyVGrid(columns: cols, spacing: 12) {
            FunMetricCard(icon: "cup.and.saucer.fill", label: T("Today's status"), value: todayStatusValue,
                          tint: NX.success)
            FunMetricCard(icon: "mappin.circle.fill", label: T("Office checkpoint"), value: officeValue,
                          helper: "In \(dispRec?.checkInAt.flatMap(Self.hhmm) ?? "--:--") · Out \(dispRec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")", tint: NX.violetText)
            FunMetricCard(icon: "sparkles", label: T("Day-off tokens"), value: Self.quotaValue(today?.dayOffUsedThisMonth, today?.dayOffQuota),
                          helper: T("This month's day-off allowance"), tint: NX.warning)
            FunMetricCard(icon: "calendar", label: T("Public holidays"), value: Self.quotaValue(today?.redDateUsedThisMonth, today?.redDateQuota),
                          helper: T("This month's public-holiday allowance"), tint: Color(hex: "#fb7185"))
        }
    }

    /// Allowances belong to each person and come from the API. When the server doesn't send one,
    /// show a dash rather than a default number: "0/4" for someone whose quota was never set is a
    /// convincing-looking lie.
    private static func quotaValue(_ used: Int?, _ quota: Int?) -> String {
        guard let quota else { return "\u{2014}" }
        return "\(used ?? 0)/\(quota) used"
    }

    private var todayStatusValue: String {
        if forcePending { return T("Finish yesterday's attendance") }
        if let s = rec?.status, !s.isEmpty { return Self.humanize(s) }
        if let req = today?.todayRequest, let t = req.type { return "\(Self.humanize(t)) \(Self.humanize(req.status ?? ""))".trimmingCharacters(in: .whitespaces) }
        return "Ready to check in"
    }
    private var officeValue: String {
        dispRec?.officeLocation?.name ?? "\(today?.activeOfficeCount ?? 0) active offices"
    }

    static func humanize(_ raw: String) -> String {
        raw.split(whereSeparator: { $0 == "_" || $0 == " " })
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }

    // MARK: presence buttons

    private var presenceButtons: some View {
        HStack(spacing: 12) {
            presenceButton(title: "Presence In", system: "arrow.right.to.line", tint: Color(hex: "#10b981"),
                           action: .checkIn, disabled: checkedIn || forcePending || pending)
            presenceButton(title: "Presence Out", system: "arrow.left.to.line", tint: Color(hex: "#f43f5e"),
                           action: .checkOut,
                           disabled: (!checkedIn && !forcePending) || checkedOut || pending || !reflectionOK)
        }
    }

    private func presenceButton(title: String, system: String, tint: Color, action: Action, disabled: Bool) -> some View {
        Button { startCapture(action) } label: {
            HStack(spacing: 8) {
                if busy && pendingAction == action { ProgressView().tint(.white) } else { Image(systemName: system) }
                Text(title).tracking(0.5)
            }
            .font(NXFont.display(15, .bold)).textCase(.uppercase)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 16)
            .background(tint, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: tint.opacity(0.4), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .disabled(disabled || busy || loading)
        .opacity(disabled || loading ? 0.4 : 1)
    }

    // MARK: offsite + banners

    // Amber warning banner. Every colour here used to be a fixed light-mode hex, including two
    // hardcoded white fills — in dark mode the reason you typed was white-on-white (invisible) and
    // Cancel was grey-on-white. Adaptive pairs now, so the banner reads in both schemes.
    private var amberSurface: Color { Color(light: 0xfffbeb, dark: 0x2b2110) }
    private var amberBorder:  Color { Color(light: 0xfcd34d, dark: 0x6d5320) }
    private var amberTitle:   Color { Color(light: 0x92400e, dark: 0xfbbf24) }
    private var amberBody:    Color { Color(light: 0xb45309, dark: 0xe0b877) }

    private var offsitePrompt: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T("You're outside the office area")).font(NXFont.text(14, .bold)).foregroundStyle(amberTitle)
            Text(T("Want to check out from here? **A reason is required** — the checkout will wait for BoD approval."))
                .font(NXFont.text(12)).foregroundStyle(amberBody)
            TextField(T("Reason (e.g. content shoot / client meeting)"), text: $offsiteReason, axis: .vertical)
                .font(NXFont.text(14)).lineLimit(2, reservesSpace: true)
                .foregroundStyle(NX.foreground)
                .padding(10).background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(amberBorder))
            HStack(spacing: 8) {
                Button(T("Cancel")) { showOffsite = false; offsiteReason = "" }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
                Button { showOffsite = false; Task { await submitOffsite() } } label: {
                    Text(busy ? T("Sending…") : T("Checkout & request approval")).font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(Color(hex: "#d97706"), in: RoundedRectangle(cornerRadius: 10))
                }
                .disabled(offsiteReason.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            }
        }
        .padding(12)
        .background(amberSurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(amberBorder))
    }

    /// The old copy told people to "tap PRESENCE OUT" while that button was greyed out by the
    /// reflection gate — an instruction the UI actively contradicted. Say the real next step instead.
    private var forcePendingMessage: String {
        reflectionOK
            ? T("⚠️ You still have an earlier shift that was never checked out. Tap PRESENCE OUT to close it first — then you can clock in again.")
            : T("⚠️ You still have an earlier shift that was never checked out. Fill in the daily reflection above first — PRESENCE OUT unlocks after 200 characters.")
    }

    /// The daily reflection the server demands before it will accept a check-out. Without this the
    /// native app could never close a shift — the API just kept returning the 200-character error.
    private var reflectionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(T("Daily reflection")).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                Text("\(reflectionCount)/\(reflectionMin)")
                    .font(NXFont.text(12, .bold)).monospacedDigit()
                    .foregroundStyle(reflectionOK ? NX.success : NX.warning)
            }
            Text(T("Required before check-out. Tell us what you worked on today."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            TextField(T("Today I worked on…"), text: $reflection, axis: .vertical)
                .font(NXFont.text(14)).lineLimit(5...12)
                .padding(10)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(reflectionOK ? NX.success.opacity(0.45) : NX.border))
            if !reflectionOK {
                Text("\(reflectionMin - reflectionCount) \(T("more characters needed before you can check out."))")
                    .font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
            }
        }
        .nexusCard()
    }

    /// Shown while `/api/attendance/today` is in flight — the hero's IN/OUT read "--:--" until it
    /// lands, which used to be indistinguishable from "belum absen".
    private var loadingRow: some View {
        HStack(spacing: 8) {
            ProgressView().tint(NX.violetText)
            Text(T("Loading attendance status…")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 6)
    }

    /// A failed load used to be silent (the screen just rendered empty state), so a network blip
    /// looked exactly like "kamu belum absen hari ini". Surface it with a retry.
    private func errorBanner(_ msg: String) -> some View {
        VStack(spacing: 8) {
            Text(msg).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                .frame(maxWidth: .infinity).multilineTextAlignment(.center)
            Button { Task { await load() } } label: {
                Text(T("Try again")).font(NXFont.text(12, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(NX.danger, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(NX.danger.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.danger.opacity(0.25)))
    }

    private func infoBanner(_ text: String, tone: ChipTone) -> some View {
        Text(text).font(NXFont.text(12, .semibold)).foregroundStyle(tone.fg)
            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(tone.bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(tone.fg.opacity(0.2)))
    }

    // MARK: computed copy

    /// sky-500, the same tone the web hero uses for the location-free pill.
    private static let locationFree = Color(red: 0.055, green: 0.647, blue: 0.914)

    /// A flexi member sees the check-in WINDOW and the +9h rule rather than a fixed schedule,
    /// because their clock-out is derived from when they actually clocked in. Same wording as
    /// the web hero, so the two clients read identically.
    private var shiftLabel: String {
        guard let shift = today?.myShift else { return T("My Work Schedule") + " —" }
        if shift.flexi == true { return "Flexi \(shift.startTime)–\(shift.endTime) · +9h" }
        return T("My Work Schedule") + " \(shift.startTime) – \(shift.endTime)"
    }

    private var statusText: String {
        if forcePending { return T("Finish yesterday's attendance") }
        if checkedOut { return T("Done for today 🎉") }
        if checkedIn { return T("Currently clocked-in") }
        return T("Ready to check in")
    }
    private var officeSuffix: String { "" }

    // MARK: flow (unchanged logic)

    private func startCapture(_ action: Action) { banner = nil; pendingAction = action; showCamera = true }

    private func submit(selfie: Data) async {
        guard let action = pendingAction else { return }
        busy = true; defer { busy = false }
        // One id for this tap, sent live AND reused if the tap ends up queued, so the two attempts
        // are the same event as far as the server is concerned.
        //
        // `clientId` alone changes nothing about how the tap is recorded — the server reads the
        // claimed time from `deviceAt` and flags a record offline on that field, neither of which a
        // live tap sends. All it buys is the ability to recognise a replay of THIS tap.
        let tapId = UUID().uuidString
        do {
            let fix = try await loc.currentFix()
            pendingCoords = (fix.latitude, fix.longitude)
            pendingFix = fix
            let outcome: AttendanceOutcome = try await {
                switch action {
                case .checkIn: return try await APIClient.shared.checkIn(lat: fix.latitude, lng: fix.longitude, selfie: selfie, fix: fix, clientId: tapId)
                case .checkOut: return try await APIClient.shared.checkOut(lat: fix.latitude, lng: fix.longitude, selfie: selfie, reflection: reflection, fix: fix, clientId: tapId)
                }
            }()
            switch outcome {
            case .success:
                Haptics.success()
                banner = Banner(text: action == .checkIn ? T("Check-in successful ✓") : T("Check-out successful ✓"), good: true)
                if action == .checkOut { reflection = "" }
                await load()
            case .outsideRadius:
                Haptics.warning()
                offsiteReason = ""; showOffsite = true
            }
        } catch APIError.unauthorized { auth.logout() }
        catch APIError.offline {
            // The server was unreachable, so nothing was recorded there. Keep the tap instead of
            // losing it: attendance is the one thing that cannot be re-created honestly later.
            // Only this error queues — anything the server actually answered must not be replayed.
            guard let fix = pendingCoords else {
                Haptics.warning()
                banner = Banner(text: T("No connection, and no location fix to save with."), good: false)
                return
            }
            AttendanceQueue.shared.enqueue(
                id: tapId,
                kind: action == .checkIn ? .checkIn : .checkOut,
                lat: fix.lat, lng: fix.lng, selfie: selfie,
                reflection: action == .checkOut ? reflection : nil,
                fix: pendingFix)
            Haptics.success()
            banner = Banner(text: T("Saved offline — will be sent when the server is back."), good: true)
            if action == .checkOut { reflection = "" }
        }
        catch { Haptics.warning(); banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? T("Failed."), good: false) }
    }

    private func submitOffsite() async {
        guard let selfie = pendingSelfie, let coords = pendingCoords else { return }
        busy = true; defer { busy = false }
        let tapId = UUID().uuidString
        let reason = offsiteReason.trimmingCharacters(in: .whitespaces)
        do {
            let outcome = try await APIClient.shared.checkOut(lat: coords.lat, lng: coords.lng, selfie: selfie,
                                                              reflection: reflection, offsite: true,
                                                              reason: reason,
                                                              fix: pendingFix, clientId: tapId)
            if case .success = outcome {
                banner = Banner(text: T("Checkout sent — waiting for BoD approval ⏳"), good: true)
                reflection = ""
                await load()
            }
        } catch APIError.unauthorized { auth.logout() }
        catch APIError.offline {
            // This path had no queue at all, and it is the one an outage hits hardest: the office
            // lost power, everybody went home, and checking out from home IS an offsite check-out.
            // Losing it costs the same day-off token as never checking out.
            AttendanceQueue.shared.enqueue(
                id: tapId,
                kind: .checkOut,
                lat: coords.lat, lng: coords.lng, selfie: selfie,
                reflection: reflection,
                offsite: true, reason: reason,
                fix: pendingFix)
            Haptics.success()
            banner = Banner(text: T("Saved offline — will be sent when the server is back."), good: true)
            reflection = ""
            showOffsite = false
        }
        catch { banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? T("Failed."), good: false) }
    }

    private func load() async {
        error = nil
        do { today = try await APIClient.shared.attendanceToday() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.") }
        loading = false
        // Drives the Dynamic Island from what the app actually believes, rather than from the tap.
        // A check-in made on the web, or one that arrived by replaying the queue, has to move the
        // Island too — and neither of those passes through the buttons on this screen.
        AttendancePresence.refresh(today: today, userName: auth.session?.userName)
    }

    // MARK: formatters

    static let clock: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }()
    static func dateLabel(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEE, d MMM"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); f.locale = Locale(identifier: "id_ID"); return f.string(from: d)
    }
    static func hhmm(_ iso: String) -> String? {
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let date else { return nil }
        let o = DateFormatter(); o.dateFormat = "HH:mm"; o.timeZone = TimeZone(identifier: "Asia/Jakarta"); return o.string(from: date)
    }
}

// MARK: - Fun-metric card (web FunMetric)

struct FunMetricCard: View {
    let icon: String
    let label: String
    let value: String
    var helper: String = ""
    let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 36, height: 36).background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(value).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1).minimumScaleFactor(0.65)
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            if !helper.isEmpty {
                Text(helper).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .padding(12)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        }
    }
}

// MARK: - Attendance status tone (port of web recTone + sCls)

enum AttTone {
    case present, wfh, leave, sick, dayoff, absent, none
    var color: Color {
        switch self {
        case .present: return NX.success.opacity(0.5)
        case .wfh:     return NX.blue.opacity(0.45)
        case .leave:   return NX.warning.opacity(0.55)
        case .sick:    return Color(hex: "#fb7185").opacity(0.6)
        case .dayoff:  return Color(hex: "#2dd4bf").opacity(0.6)
        case .absent:  return NX.danger.opacity(0.45)
        case .none:    return NX.muted.opacity(0.5)
        }
    }
    var label: String {
        switch self {
        case .present: return T("Present")
        case .wfh:     return "WFH"
        case .leave:   return T("Leave/Permit")
        case .sick:    return T("Sick")
        case .dayoff:  return T("Day off")
        case .absent:  return "Absent"
        case .none:    return ""
        }
    }
    static func of(_ r: AttendanceRow) -> AttTone {
        let dt = (r.attendanceDayType ?? "").uppercased()
        if dt == "SICK_APPROVED" { return .sick }
        if dt == "DAY_OFF_APPROVED" { return .dayoff }   // covers DAY_OFF + RED_DATE
        if dt == "LEAVE_APPROVED" || dt == "PERMIT_APPROVED" { return .leave }
        let s = (r.status ?? "").uppercased()
        if s.contains("REMOTE") || s.contains("WFH") { return .wfh }
        if s.contains("LEAVE") || s.contains("SICK") || s.contains("PERMIT") || s.contains("OFF") || s.contains("IZIN") || s.contains("CUTI") { return .leave }
        if r.checkInAt != nil || s.contains("PRESENT") || s.contains("HADIR") { return .present }
        if s.contains("ABSENT") || s.contains("ALPHA") { return .absent }
        return .none
    }
}

// MARK: - Crew streak board (month heatmap; web "Crew streak board" grid)

struct StreakBoardCard: View {
    let canManage: Bool
    @Environment(AuthStore.self) private var auth
    /// Built once per load, not per read. It used to be a computed property — a `Dictionary(grouping:)`
    /// plus a `localizedCaseInsensitiveCompare` sort (ICU collation, the slowest comparator Foundation
    /// has) — and `body` reads it three times: the empty check, the name column and the cell grid.
    @State private var members: [Member] = []
    @State private var loading = true
    @State private var selectedRow: AttendanceRow?   // BoD taps a cell → record actions (delete / clear check-out)
    @State private var monthOffset = 0               // 0 = this month; ◀ ▶ to reach past months

    private let cell: CGFloat = 24
    private let gap: CGFloat = 3
    private let nameW: CGFloat = 76

    // ProjDate's shared Calendar and DateFormatter cache instead of fresh ones. These are read from
    // `body`, and constructing a DateFormatter there is about the most expensive thing you can do:
    // the month header alone built two of them every pass. Same calendar (gregorian), same zone
    // (Asia/Jakarta) and the same patterns, so both strings come out byte-identical.
    private var monthDate: Date { ProjDate.cal.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date() }
    private var monthKey: String { ProjDate.fmt("yyyy-MM").string(from: monthDate) }
    private var monthLabel: String { ProjDate.fmt("MMMM yyyy").string(from: monthDate) }
    private var daysInMonth: Int { ProjDate.cal.range(of: .day, in: .month, for: monthDate)?.count ?? 30 }

    private struct Member: Identifiable { let id: String; let name: String; let cells: [Int: AttTone]; let rowByDay: [Int: AttendanceRow] }
    private static func buildMembers(_ rows: [AttendanceRow]) -> [Member] {
        let groups = Dictionary(grouping: rows) { $0.user?.id ?? "me" }
        return groups.map { uid, rs -> Member in
            var cells: [Int: AttTone] = [:]
            var rowByDay: [Int: AttendanceRow] = [:]
            for r in rs { if let d = Self.dayOf(r.attendanceDate) { cells[d] = AttTone.of(r); rowByDay[d] = r } }
            return Member(id: uid, name: rs.first?.user?.name ?? T("You"), cells: cells, rowByDay: rowByDay)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    private static func dayOf(_ iso: String?) -> Int? {
        guard let iso, iso.count >= 10 else { return nil }
        return Int(iso.dropFirst(8).prefix(2))   // "yyyy-MM-DD" → DD
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(canManage ? T("Crew streak board") : T("Your attendance history")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(monthLabel.capitalized).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                HStack(spacing: 2) {
                    Button { monthOffset -= 1 } label: { Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30) }
                    Button { if monthOffset < 0 { monthOffset += 1 } } label: { Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(monthOffset < 0 ? NX.foreground : NX.mutedFg.opacity(0.4)).frame(width: 30, height: 30) }.disabled(monthOffset >= 0)
                }
            }
            legend
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if members.isEmpty {
                Text(T("No attendance recorded this month.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
            } else {
                grid
            }
        }
        .nexusCard()
        .task(id: monthOffset) { await load() }
        .sheet(item: $selectedRow) { row in
            RecordActionsSheet(row: row) { await load() }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            ForEach([AttTone.present, .wfh, .leave, .sick, .dayoff], id: \.label) { t in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3).fill(t.color).frame(width: 11, height: 11)
                    Text(t.label).font(NXFont.text(9, .medium)).foregroundStyle(NX.mutedFg)
                }
            }
        }
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: gap) {
                Color.clear.frame(height: 14)
                ForEach(members) { m in
                    Text(m.name).font(NXFont.text(11, .medium)).foregroundStyle(NX.foreground)
                        .lineLimit(1).frame(width: nameW, height: cell, alignment: .leading)
                }
            }
            // Lazy along the axis that actually scrolls. A month for a full crew is ~31 days × 25
            // people ≈ 775 cells, and as plain HStacks every one of them was built and kept alive
            // even though a dozen columns fit on screen. Each row carries an explicit height — the
            // same height its children already had — because a lazy stack, unlike a plain one, will
            // stretch to fill its container across its axis, and that would blow the row spacing out.
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: gap) {
                    LazyHStack(spacing: gap) {
                        ForEach(1...daysInMonth, id: \.self) { d in
                            Text("\(d)").font(.system(size: 8)).foregroundStyle(NX.mutedFg).frame(width: cell, height: 14)
                        }
                    }
                    .frame(height: 14)
                    ForEach(members) { m in
                        LazyHStack(spacing: gap) {
                            ForEach(1...daysInMonth, id: \.self) { d in
                                let fill = RoundedRectangle(cornerRadius: 5, style: .continuous).fill((m.cells[d] ?? .none).color).frame(width: cell, height: cell)
                                if canManage, let row = m.rowByDay[d], row.id != nil {
                                    Button { selectedRow = row } label: { fill }.buttonStyle(.plain)
                                } else {
                                    fill
                                }
                            }
                        }
                        .frame(height: cell)
                    }
                }
            }
        }
    }

    private func load() async {
        loading = true
        do {
            let fetched = try await APIClient.shared.attendanceHistory(scope: canManage ? "workspace" : "me", month: monthKey)
            members = Self.buildMembers(fetched)
        }
        catch APIError.unauthorized { auth.logout() }   // leaves the board as it was, same as before
        catch { members = [] }
        loading = false
    }
}

/// BoD: tap a crew-board cell → see that day's check-in/out and clean up bad data — delete the whole
/// record (accidental/"mabok" double check-in) or just the check-out (mis-tapped → reopen).
struct RecordActionsSheet: View {
    let row: AttendanceRow
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var err: String?

    private var dateLabel: String { AgendaRange.dayLabel(AgendaRange.dayKey(row.attendanceDate ?? "")) }
    private func timeText(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "—" }
        return ProjDate.fmt("HH:mm").string(from: d)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.user?.name ?? "Staff").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                        Text(dateLabel).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }

                    VStack(spacing: 0) {
                        timeRow(T("Check-in"), row.checkInAt, "arrow.right.to.line", NX.success)
                        Divider().overlay(NX.border)
                        timeRow(T("Check-out"), row.checkOutAt, "arrow.left.to.line", NX.danger)
                    }
                    .padding(.horizontal, 12)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))

                    SectionLabel(T("Delete attendance data"))
                    if row.checkOutAt != nil {
                        Button { Task { await del(part: "checkout") } } label: {
                            Label(T("Delete check-out (reopen)"), systemImage: "arrow.uturn.backward")
                                .font(NXFont.text(14, .bold)).foregroundStyle(NX.danger).frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(NX.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.danger.opacity(0.3)))
                        }.buttonStyle(.plain).disabled(busy)
                    }
                    Button { confirmDelete = true } label: {
                        Label(T("Delete this attendance record"), systemImage: "trash.fill")
                            .font(NXFont.text(14, .bold)).foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(NX.danger, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }.buttonStyle(.plain).disabled(busy)

                    Text(T("For cleaning up an accidental check-in. \"Delete this attendance record\" removes the record and shields that day from attendance deductions. It is written to the audit log."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)

                    if let err { Text(err).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }
                    if busy { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity) }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Manage attendance")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
            .confirmationDialog("\(T("Delete the whole attendance record for")) \(dateLabel)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(T("Delete"), role: .destructive) { Task { await del(part: nil) } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { Text(T("That day's check-in & check-out are deleted permanently, and the day is shielded from attendance deductions.")) }
        }
    }

    private func timeRow(_ label: String, _ iso: String?, _ icon: String, _ tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(tint).frame(width: 26)
            Text(label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            Spacer()
            Text(timeText(iso)).font(NXFont.text(14, .bold)).foregroundStyle(iso == nil ? NX.mutedFg : NX.foreground)
        }
        .padding(.vertical, 11)
    }

    private func del(part: String?) async {
        guard let id = row.id else { return }
        busy = true; err = nil
        do {
            try await APIClient.shared.deleteAttendanceRecord(id, part: part)
            await onDone()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete.")
            busy = false
        }
    }
}
