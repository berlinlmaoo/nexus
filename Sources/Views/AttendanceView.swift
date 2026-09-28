import SwiftUI
import Observation
import MapKit
import CoreLocation

/// Native port of the web MobileCheckInHero: map hero + violet gradient time card (live clock,
/// schedule, IN/OUT) + green "Presence In" / red "Presence Out" + offsite-reason flow.
struct AttendanceView: View {
    @Environment(AuthStore.self) private var auth
    @State private var today: AttendanceToday?
    @State private var loading = true
    @State private var error: String?

    @State private var loc = LocationManager()
    @Environment(\.scenePhase) private var scenePhase
    /// Location switched off for NEXUS: said above the buttons, with the way to Settings, instead of
    /// discovered as a failure after the selfie.
    @State private var locationOff = false
    @State private var deniedPermission: PermissionKind?
    /// Offices with their geofences, and which one the person is actually standing in.
    @State private var offices: [Office] = []
    @State private var nearby: (office: Office, distance: Double, inside: Bool)?
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var showCamera = false
    @State private var pendingAction: Action?
    @State private var busy = false
    @State private var banner: Banner?
    /// `load()` gagal karena NEXUS tidak terjangkau (Cloudflare 52x/530, nginx 502–504, tanpa
    /// koneksi) — bukan karena server menolak. Dua hal itu butuh dua kartu yang berbeda: yang
    /// pertama berarti "absen tetap bisa, tersimpan di HP"; yang kedua berarti ada yang salah.
    @State private var serverDown = false
    /// When what is on screen came off the disk instead of the server. Drives one grey line; nil
    /// whenever the server answered.
    @State private var cachedFrom: Date?
    /// Tahap absen yang sedang berjalan, digambar sebagai kartu di atas layar. Nil = tidak ada.
    @State private var flow: Flow?

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
    @State private var showReflections = false

    /// The server rejects a check-out whose reflection is shorter than this (mirrors the web's
    /// "Daily Reflection · required before check-out · min 200 characters").
    private let reflectionMin = 200
    private var reflectionCount: Int { reflection.trimmingCharacters(in: .whitespacesAndNewlines).count }
    private var reflectionOK: Bool { reflectionCount >= reflectionMin }
    /// Only gate the flow while an open check-in is actually waiting to be closed.
    private var needsReflection: Bool { (checkedIn || forcePending) && !checkedOut }

    enum Action { case checkIn, checkOut }
    struct Banner: Identifiable { let id = UUID(); let text: String; let good: Bool }
    /// Absen adalah satu-satunya ketukan di aplikasi ini yang tidak boleh berakhir dengan "sudah
    /// belum ya?". Tahapannya digambar sebagai kartu di tengah layar — mencari lokasi, mengirim,
    /// lalu hasilnya — supaya orang yang menekan tombol melihat prosesnya, bukan cuma tombol yang
    /// redup sebentar lalu satu baris kecil di bawah.
    enum Flow: Equatable {
        case locating(Action)
        case sending(Action)
        case done(Action, String)          // jam yang tercatat
        case savedOffline(Action, String)  // jam yang akan dikreditkan
        case failed(Action, String)
        var action: Action {
            switch self {
            case .locating(let a), .sending(let a), .done(let a, _), .savedOffline(let a, _), .failed(let a, _): return a
            }
        }
        var isBusy: Bool { if case .locating = self { return true }; if case .sending = self { return true }; return false }
    }

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
                    if serverDown { downCard } else if let error { errorBanner(error) }
                    if let cachedFrom { OfflineNotice(savedAt: cachedFrom) }
                    // A Mac cannot take attendance: a check-in needs a selfie through the face
                    // check and the phone's own position, and a Mac has neither in a form anyone
                    // should trust. Everything that READS attendance stays exactly as it is — the
                    // card above, the reflections, the history board, the requests — so a manager
                    // can do their whole review at a desk.
                    #if targetEnvironment(macCatalyst)
                    phoneOnlyCard
                    reflectionsLink
                    #else
                    if needsReflection { reflectionCard }
                    reflectionsLink
                    if locationOff { PermissionBanner(kind: .location) }
                    presenceButtons
                    // Say WHY the button is greyed out, right where the greyed-out button is.
                    if needsReflection && !reflectionOK {
                        Text(T("PRESENCE OUT unlocks once the daily reflection above reaches 200 characters."))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    if showOffsite { offsitePrompt }
                    #endif
                    if forcePending { infoBanner(forcePendingMessage, tone: .warning) }
                    if pending { infoBanner(T("⏳ Checkout outside the office area — waiting for BoD approval"), tone: .warning) }
                    if rec?.checkOutApproval == "REJECTED" { infoBanner(T("Your out-of-area checkout was rejected by the BoD."), tone: .danger) }
                    if let banner { infoBanner(banner.text, tone: banner.good ? .success : .danger) }
                    // A queued tap must never be invisible: someone who thinks they clocked in and
                    // did not would only find out at payroll.
                    if let refused = queue.lastError, queue.count == 0 {
                        infoBanner(refused, tone: .danger)
                    }
                    if queue.count > 0 {
                        infoBanner(queue.count == 1
                                   ? T("1 attendance record is on this phone, waiting to be sent.")
                                   : "\(queue.count) " + T("attendance records are on this phone, waiting to be sent."),
                                   tone: .warning)
                    }
                    metricsGrid
                    // OR, not a `??` fallback: the web is `canManageAttendance || canReviewAttendanceRequests`.
                    // With `??`, a server that sends canReviewAttendanceRequests=false stops the chain
                    // dead and an attendance MANAGER loses the review UI they're entitled to.
                    let canReview = (today?.canReviewAttendanceRequests ?? false) || (today?.canManageAttendance ?? false)
                    // Offsite check-outs are one queue inside Submissions, on the same test as the
                    // requests: the server lists them to the BoD (everyone) AND to a manager with
                    // direct reports (theirs only), and a manager decides them — which is where the
                    // 2h30 auto offsite check-out sends its approval. Gated on canManageAttendance
                    // alone, a manager tapped "waiting for your approval" and found nothing.
                    // Granting a request for somebody else stays BoD-only (`canGrant`).
                    AttendanceRequestsCard(canReview: canReview,
                                           canReviewOffsite: canReview,
                                           canGrant: today?.canManageAttendance ?? false)
                    StreakBoardCard(canManage: today?.canManageAttendance ?? false,
                                    canReview: today?.canReviewAttendanceRequests ?? false)
                    if today?.canManageAttendance == true { OfficesCard() }
                }
                .padding(16)
            }
            // On the ScrollView, not beside `.permissionAlert` further down: two alerts on one view
            // and one of them never shows.
            .heldAttendanceNotice(whileLocked: false)
        }
        .overlay { flowOverlay.animation(.easeOut(duration: 0.18), value: flow) }
        .navigationTitle(T("Attendance"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Drain before loading: a queued tap that lands now should be reflected in the numbers
            // this screen is about to fetch, not a refresh later.
            await AttendanceQueue.shared.flush()
            await load()
        }
        .onAppear {
            // Nothing on a Mac asks for a position, so nothing asks for the permission either.
            #if !targetEnvironment(macCatalyst)
            loc.requestPermissionIfNeeded()
            locationOff = loc.isDenied
            #endif
        }
        // Coming back from Settings is a scene change, not a reappearance.
        .onChange(of: scenePhase) { _, phase in
            #if !targetEnvironment(macCatalyst)
            if phase == .active { locationOff = loc.isDenied }
            #endif
        }
        .permissionAlert($deniedPermission)
        .refreshable { await load() }
        .fullScreenCover(isPresented: $showCamera) {
            // Not the stock camera any more: a face check (straight, side, other side, blink) that
            // takes the selfie itself once it has seen a live person. Chat still uses CameraPicker.
            LivenessCaptureView { data in pendingSelfie = data; Task { await submit(selfie: data) } }
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
            FunMetricCard(icon: nearby?.inside == true && dispRec?.officeLocation?.name == nil ? "checkmark.circle.fill" : "mappin.circle.fill",
                          label: officeLabel, value: officeValue, helper: officeHelper, tint: officeTint)
            FunMetricCard(icon: "sparkles", label: T("Day-off tokens"), value: Self.quotaValue(today?.dayOffUsedThisMonth, today?.dayOffQuota),
                          helper: dayOffHelper, tint: NX.warning)
            FunMetricCard(icon: "calendar", label: T("Public holidays"), value: Self.quotaValue(today?.redDateUsedThisMonth, today?.redDateQuota),
                          helper: T("This month's public-holiday allowance"), tint: Color(hex: "#fb7185"))
        }
    }

    /// The quota above already counts extra days the BoD granted for this period; this says so,
    /// so a number that grew overnight is not a mystery. Older servers send no breakdown.
    private var dayOffHelper: String {
        let base = T("This month's day-off allowance")
        guard let bonus = today?.dayOffAllowance?.bonus, bonus > 0 else { return base }
        return "\(base) · " + String(format: T("incl. %d extra"), bonus)
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
    /// Once checked in this is the office on the record. Before that it used to say "5 active
    /// offices", which is a fact about the company and not about the person holding the phone —
    /// so now it answers the question they actually have: which office am I at?
    private var officeValue: String {
        if let name = dispRec?.officeLocation?.name { return name }
        if let n = nearby { return n.office.name }
        if locationOff { return T("Location is off") }
        return T("Finding you…")
    }
    private var officeLabel: String {
        dispRec?.officeLocation?.name != nil ? T("Office checkpoint") : T("Where you are")
    }
    private var officeHelper: String {
        if dispRec?.checkInAt != nil || dispRec?.checkOutAt != nil {
            return "In \(dispRec?.checkInAt.flatMap(Self.hhmm) ?? "--:--") · Out \(dispRec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")"
        }
        if let n = nearby {
            return n.inside
                ? T("You're inside this office area")
                : String(format: T("%@ from here"), Self.distanceLabel(n.distance))
        }
        if locationOff { return T("Turn location on to see which office you're at") }
        return T("Checking where you are…")
    }
    private var officeTint: Color {
        guard dispRec?.officeLocation?.name == nil else { return NX.violetText }
        guard let n = nearby else { return NX.mutedFg }
        return n.inside ? NX.success : NX.warning
    }
    private static func distanceLabel(_ metres: Double) -> String {
        metres < 1000 ? "\(Int(metres.rounded())) m" : String(format: "%.1f km", metres / 1000)
    }

    /// Which office the person is standing in, if any. Only asked before a check-in, because after
    /// one the record already names the office and a second GPS fix buys nothing.
    private func locateWithinOffice() async {
        #if !targetEnvironment(macCatalyst)
        guard dispRec?.officeLocation?.name == nil, !loc.isDenied else { return }
        if offices.isEmpty { offices = (try? await APIClient.shared.attendanceOffices()) ?? [] }
        guard !offices.isEmpty, let fix = try? await loc.currentFix() else { return }
        let here = CLLocation(latitude: fix.latitude, longitude: fix.longitude)
        var best: (office: Office, distance: Double)?
        for o in offices where (o.isActive ?? true) {
            guard let la = o.latitude, let lo = o.longitude else { continue }
            let d = here.distance(from: CLLocation(latitude: la, longitude: lo))
            if best == nil || d < best!.distance { best = (o, d) }
        }
        guard let best else { return }
        withAnimation(.easeInOut(duration: 0.25)) {
            nearby = (best.office, best.distance, best.distance <= Double(best.office.radiusMeters ?? 100))
        }
        #endif
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

    /// What a Mac shows where the two big buttons are.
    ///
    /// It says what to do and why, rather than greying out a button and leaving the person to work
    /// it out. The rest of the screen keeps working, so this is a redirection, not a dead end.
    private var phoneOnlyCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "iphone.gen3").font(.system(size: 30, weight: .light)).foregroundStyle(NX.violetText)
            Text(T("Check in from your phone")).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
            Text(T("Attendance is taken on the NEXUS app on your phone: it needs the face check and your real position, and a Mac can prove neither."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            Text(T("Everything else is here: today's status, your reflections, your history, and your team's board."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg.opacity(0.85))
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 22).padding(.horizontal, 18)
        .background(NX.violet.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.violet.opacity(0.25)))
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
    /// Where the reflections go after check-out: the month's notes with GIDEON's summaries. The
    /// sheet hangs off this button, not the screen — the screen already presents a fullScreenCover,
    /// and two presentation modifiers on one view is how "+ Office" died.
    private var reflectionsLink: some View {
        Button { showReflections = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                    .frame(width: 30, height: 30).background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Reflections")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Your check-out notes, summarized by GIDEON per day and per month.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .nexusCard()
        .sheet(isPresented: $showReflections) {
            ReflectionsView(canPickPeople: (today?.canReviewAttendanceRequests ?? false) || (today?.canManageAttendance ?? false))
        }
    }

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

    /// NEXUS tidak terjangkau. Bukan kartu merah "Server error (530)": angka itu tidak berarti apa-apa
    /// bagi orang yang cuma mau absen, dan yang penting justru kalimat keduanya — absen tetap bisa.
    private var downCard: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash").font(.system(size: 14, weight: .bold)).foregroundStyle(amberTitle)
                Text(T("NEXUS is down right now")).font(NXFont.text(14, .bold)).foregroundStyle(amberTitle)
            }
            Text(T("Offline check-in mode is on. Your check-in and check-out are saved on this phone with the time you tap, and sent by themselves the moment NEXUS is back."))
                .font(NXFont.text(12)).foregroundStyle(amberBody)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            Button { Task { await load() } } label: {
                Text(T("Check again")).font(NXFont.text(12, .bold)).foregroundStyle(amberTitle)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(amberBorder.opacity(0.35), in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12).padding(.vertical, 12)
        .background(amberSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(amberBorder))
    }

    /// Kartu proses absen di atas layar: cincin berputar saat mencari lokasi dan mengirim, centang
    /// saat berhasil, ikon HP saat tersimpan offline. Latar diredupkan supaya tidak ada ketukan
    /// kedua selama yang pertama belum selesai.
    @ViewBuilder private var flowOverlay: some View {
        if let flow {
            let isIn = flow.action == .checkIn
            ZStack {
                Color.black.opacity(0.35).ignoresSafeArea()
                    .onTapGesture { if !flow.isBusy { self.flow = nil } }
                VStack(spacing: 14) {
                    ZStack {
                        Circle().fill(flowTint(flow).opacity(0.14)).frame(width: 72, height: 72)
                        switch flow {
                        case .locating, .sending:
                            ProgressView().controlSize(.large).tint(flowTint(flow))
                        case .done:
                            Image(systemName: "checkmark").font(.system(size: 30, weight: .bold)).foregroundStyle(flowTint(flow))
                        case .savedOffline:
                            Image(systemName: "iphone.and.arrow.forward").font(.system(size: 28, weight: .bold)).foregroundStyle(flowTint(flow))
                        case .failed:
                            Image(systemName: "xmark").font(.system(size: 30, weight: .bold)).foregroundStyle(flowTint(flow))
                        }
                    }
                    Text(flowTitle(flow)).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                        .multilineTextAlignment(.center)
                    Text(flowBody(flow)).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    if flow.isBusy {
                        // Dua tahap, digambar sebagai dua ruas: lokasi lalu kirim.
                        HStack(spacing: 6) {
                            Capsule().fill(flowTint(flow)).frame(height: 4)
                            Capsule().fill({ if case .sending = flow { return flowTint(flow) } else { return NX.muted } }()).frame(height: 4)
                        }
                        .frame(width: 160)
                        HStack(spacing: 14) {
                            Text(T("Location")).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                            Text(isIn ? T("Check in") : T("Check out")).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                        }
                    } else {
                        Button { self.flow = nil } label: {
                            Text(T("OK")).font(NXFont.text(14, .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .background(flowTint(flow), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(22)
                .frame(maxWidth: 320)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(NX.border))
                .shadow(color: .black.opacity(0.25), radius: 30, y: 14)
                .padding(24)
            }
            .transition(.opacity)
        }
    }

    private func flowTint(_ f: Flow) -> Color {
        switch f {
        case .locating, .sending: return NX.violet
        case .done: return f.action == .checkIn ? Color(hex: "#10b981") : Color(hex: "#f43f5e")
        case .savedOffline: return NX.warning
        case .failed: return NX.danger
        }
    }
    private func flowTitle(_ f: Flow) -> String {
        let isIn = f.action == .checkIn
        switch f {
        case .locating: return T("Getting your location…")
        case .sending: return isIn ? T("Checking you in…") : T("Checking you out…")
        case .done(_, let t): return (isIn ? T("Checked in") : T("Checked out")) + " · " + t
        case .savedOffline: return isIn ? T("Check-in saved on this phone") : T("Check-out saved on this phone")
        case .failed: return isIn ? T("Check-in failed") : T("Check-out failed")
        }
    }
    private func flowBody(_ f: Flow) -> String {
        switch f {
        case .locating: return T("Hold on while the phone finds where you are.")
        case .sending: return T("Sending your selfie and location to NEXUS.")
        case .done: return f.action == .checkIn ? T("Have a good one. Don't forget to check out.") : T("Done for today. See you tomorrow.")
        case .savedOffline(_, let t): return T("NEXUS can't be reached, so this is kept here with the time you tapped") + " (\(t)). " + T("It sends itself once NEXUS is back — keep the app installed.")
        case .failed(_, let msg): return msg
        }
    }
    private static func clock(_ d: Date = Date()) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        return f.string(from: d)
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
        // A selfie with no face in it is not an attendance photo. Checked on the phone, before the
        // location fix and before anything is uploaded, so a photo of the wall costs one retake and
        // never reaches the record.
        switch await FaceGuard.check(selfie) {
        case .ok: break
        case .noFace:
            flow = .failed(action, T("No face in the photo. Take the selfie with your face clearly visible, then try again."))
            return
        case .unreadable:
            flow = .failed(action, T("That photo couldn't be read. Take it again."))
            return
        }
        // One id for this tap, sent live AND reused if the tap ends up queued, so the two attempts
        // are the same event as far as the server is concerned.
        //
        // `clientId` alone changes nothing about how the tap is recorded — the server reads the
        // claimed time from `deviceAt` and flags a record offline on that field, neither of which a
        // live tap sends. All it buys is the ability to recognise a replay of THIS tap.
        let tapId = UUID().uuidString
        flow = .locating(action)
        do {
            let fix = try await loc.currentFix()
            pendingCoords = (fix.latitude, fix.longitude)
            pendingFix = fix
            flow = .sending(action)
            let outcome: AttendanceOutcome = try await {
                switch action {
                case .checkIn: return try await APIClient.shared.checkIn(lat: fix.latitude, lng: fix.longitude, selfie: selfie, fix: fix, clientId: tapId)
                case .checkOut: return try await APIClient.shared.checkOut(lat: fix.latitude, lng: fix.longitude, selfie: selfie, reflection: reflection, fix: fix, clientId: tapId)
                }
            }()
            switch outcome {
            case .success:
                Haptics.success()
                let at = Self.clock()
                flow = .done(action, at)
                banner = Banner(text: action == .checkIn ? T("Check-in successful ✓") : T("Check-out successful ✓"), good: true)
                if action == .checkOut { reflection = "" }
                await load()
                // Kartunya menutup sendiri; tombol OK ada untuk yang tidak mau menunggu.
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                if flow == .done(action, at) { flow = nil }
            case .outsideRadius:
                Haptics.warning()
                flow = nil
                offsiteReason = ""; showOffsite = true
            }
        } catch LocationManager.LocationError.denied {
            // Not a failure to retry: nothing will change until the switch in Settings does.
            Haptics.warning()
            flow = .failed(action, LocationManager.LocationError.denied.errorDescription ?? T("Location permission denied."))
            locationOff = true
            deniedPermission = .location
        } catch APIError.unauthorized { flow = nil; auth.logout() }
        catch APIError.offline {
            // The server was unreachable, so nothing was recorded there. Keep the tap instead of
            // losing it: attendance is the one thing that cannot be re-created honestly later.
            // Only this error queues — anything the server actually answered must not be replayed.
            guard let fix = pendingCoords else {
                Haptics.warning()
                flow = .failed(action, T("No connection, and no location fix to save with."))
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
            serverDown = true
            flow = .savedOffline(action, Self.clock())
            banner = Banner(text: T("Saved on this phone — sends itself when NEXUS is back."), good: true)
            if action == .checkOut { reflection = "" }
        }
        catch APIError.upgradeRequired(let why) {
            // The server refused this BUILD before looking at the tap, so nothing was recorded.
            // Kept exactly like an offline tap (same id, the time tapped, the evidence captured
            // now) and sent by the updated build — otherwise somebody who taps at 09:00, updates,
            // and taps again at 09:06 is late for a reason that was never theirs. The update cover
            // replaces this screen and the queue raises the "saved on this phone" popup on it.
            guard let fix = pendingCoords else {
                Haptics.warning()
                flow = .failed(action, why)
                return
            }
            AttendanceQueue.shared.enqueue(
                id: tapId,
                kind: action == .checkIn ? .checkIn : .checkOut,
                lat: fix.lat, lng: fix.lng, selfie: selfie,
                reflection: action == .checkOut ? reflection : nil,
                fix: pendingFix)
            AttendanceQueue.shared.holdForUpdate(why)
            Haptics.warning()
            flow = nil
            if action == .checkOut { reflection = "" }
        }
        catch {
            Haptics.warning()
            let msg = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
            flow = .failed(action, msg)
            banner = Banner(text: msg, good: false)
        }
    }

    private func submitOffsite() async {
        guard let selfie = pendingSelfie, let coords = pendingCoords else { return }
        busy = true; defer { busy = false }
        let tapId = UUID().uuidString
        let reason = offsiteReason.trimmingCharacters(in: .whitespaces)
        flow = .sending(.checkOut)
        do {
            let outcome = try await APIClient.shared.checkOut(lat: coords.lat, lng: coords.lng, selfie: selfie,
                                                              reflection: reflection, offsite: true,
                                                              reason: reason,
                                                              fix: pendingFix, clientId: tapId)
            if case .success = outcome {
                let at = Self.clock()
                flow = .done(.checkOut, at)
                banner = Banner(text: T("Checkout sent — waiting for BoD approval ⏳"), good: true)
                reflection = ""
                await load()
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                if flow == .done(.checkOut, at) { flow = nil }
            } else { flow = nil }
        } catch APIError.unauthorized { flow = nil; auth.logout() }
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
            serverDown = true
            flow = .savedOffline(.checkOut, Self.clock())
            banner = Banner(text: T("Saved on this phone — sends itself when NEXUS is back."), good: true)
            reflection = ""
            showOffsite = false
        }
        catch APIError.upgradeRequired(let why) {
            // Same as the live tap above: refused for the build, kept for the updated one.
            AttendanceQueue.shared.enqueue(
                id: tapId,
                kind: .checkOut,
                lat: coords.lat, lng: coords.lng, selfie: selfie,
                reflection: reflection,
                offsite: true, reason: reason,
                fix: pendingFix)
            AttendanceQueue.shared.holdForUpdate(why)
            Haptics.warning()
            flow = nil
            reflection = ""
            showOffsite = false
        }
        catch {
            let msg = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
            flow = .failed(.checkOut, msg)
            banner = Banner(text: msg, good: false)
        }
    }

    private func load() async {
        error = nil
        do { today = try await APIClient.shared.attendanceToday(); serverDown = false; cachedFrom = nil }
        catch APIError.unauthorized { auth.logout() }
        catch APIError.offline { serverDown = true; restoreTodayFromCache() }
        catch APIError.transport(let why) {
            // Nothing answered. The saved copy is the best account of today anybody has.
            self.error = why
            restoreTodayFromCache()
        }
        catch {
            // The server DID answer — a 500, a 403, a body that would not decode. Believe it:
            // filling the screen from disk here would paper over a refusal. What is already drawn
            // stays, but it stops claiming to be live.
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.")
            markStale()
        }
        loading = false
        // Drives the Dynamic Island from what the app actually believes, rather than from the tap.
        // A check-in made on the web, or one that arrived by replaying the queue, has to move the
        // Island too — and neither of those passes through the buttons on this screen.
        AttendancePresence.refresh(today: today, userName: auth.session?.userName)
        // The widget's seven dots. Cheap (compact rows, one week), and only ever this person's own.
        if let days = try? await APIClient.shared.attendanceRecent(scope: "me") { AttendancePresence.updateRecent(days) }
        await locateWithinOffice()
    }

    /// What the server last said — but only if it said it TODAY.
    ///
    /// This is the one screen where a stale copy can be actively wrong rather than merely old:
    /// yesterday's payload says this person checked in at 09:00, and drawn this morning it says
    /// they already have. So the copy is trusted only while the Jakarta day it was SAVED on is
    /// still running.
    ///
    /// The guard is the save time rather than the server's own `attendanceDateKey` for the reason
    /// written in AttendanceSnapshot: a value produced here can only ever disagree about the day,
    /// never about the format somebody else writes it in.
    private func restoreTodayFromCache() {
        guard let hit = sameDayCache() else { return }
        // Only fills an empty screen. When a refresh fails over something already drawn, the
        // payload on screen is no less correct than it was a moment ago — it has simply stopped
        // being live, and `markStale` is what says so.
        if today == nil { today = hit.value }
        cachedFrom = hit.savedAt
    }

    /// Says when what is on screen was last confirmed, without changing it.
    ///
    /// Without this the line vanished exactly when it mattered most: a first load that succeeded
    /// followed by refreshes that fail left hours-old figures on screen with nothing marking them,
    /// because the restore path had already decided there was nothing to restore.
    private func markStale() {
        guard let hit = sameDayCache() else { return }
        cachedFrom = hit.savedAt
    }

    private func sameDayCache() -> (value: AttendanceToday, savedAt: Date)? {
        guard let hit = ResponseCache.decoded("attendance-today", as: AttendanceToday.self),
              JakartaDay.same(hit.savedAt, Date())
        else { return nil }
        return hit
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
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(
                    LinearGradient(colors: [tint.opacity(0.22), tint.opacity(0.10)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                )
                .contentTransition(.symbolEffect(.replace))
            Spacer(minLength: 10)
            // The label first and small, the answer second and large: the eye lands on the number,
            // and the word above it says what the number is about.
            Text(label.uppercased()).font(NXFont.text(10, .bold)).tracking(0.6).foregroundStyle(NX.mutedFg)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                .lineLimit(2).minimumScaleFactor(0.6).fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            if !helper.isEmpty {
                Text(helper).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true).padding(.top, 3)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .padding(13)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(tint.opacity(0.045)))
                .nexusShadowSoft()
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        }
        .animation(.easeInOut(duration: 0.2), value: value)
    }
}

// MARK: - Attendance status tone (port of web recTone + sCls)

// BoD's palette (17 Sep 2026), same as the web board: absent red, present & permit green, sick
// orange, day off purple, leave yellow, WFH blue.
enum AttTone {
    case present, permit, wfh, leave, sick, dayoff, absent, none
    var color: Color {
        switch self {
        case .present, .permit: return Color(hex: "#34d399").opacity(0.75)
        case .wfh:     return NX.blue.opacity(0.5)
        case .leave:   return Color(hex: "#fcd34d").opacity(0.85)
        case .sick:    return Color(hex: "#fb923c").opacity(0.85)
        case .dayoff:  return Color(hex: "#a78bfa").opacity(0.75)
        case .absent:  return Color(hex: "#f43f5e").opacity(0.8)
        case .none:    return NX.muted.opacity(0.5)
        }
    }
    var label: String {
        switch self {
        case .present: return T("Present / Permit")
        case .permit:  return T("Permit")
        case .wfh:     return "WFH"
        case .leave:   return T("Leave")
        case .sick:    return T("Sick")
        case .dayoff:  return T("Day off")
        case .absent:  return T("Absent")
        case .none:    return ""
        }
    }
    static func of(_ r: AttendanceRow) -> AttTone {
        let dt = (r.attendanceDayType ?? "").uppercased()
        if dt == "SICK_APPROVED" { return .sick }
        if dt == "DAY_OFF_APPROVED" { return .dayoff }   // covers DAY_OFF + RED_DATE
        if dt == "PERMIT_APPROVED" { return .permit }     // a working day with the manager's blessing
        if dt == "LEAVE_APPROVED" { return .leave }
        // The server's synthetic "no record on a workday" row (status INCOMPLETE, no check-in). It
        // fell through to .none and drew like a weekend, so an absence was invisible.
        if dt == "ABSENT" { return .absent }
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
    /// A manager with direct reports: the server scopes the workspace board to them (and, since
    /// 21 Sep 2026, to the manager too). Without this the card asked for `scope=me` and a manager
    /// never saw their people's month on the phone.
    var canReview: Bool = false
    private var wide: Bool { canManage || canReview }
    @Environment(AuthStore.self) private var auth
    // Month export — the same workbook the web's "Export" hands out, one sheet per month, everybody.
    @State private var exporting = false
    @State private var exportItem: ShareItem?
    @State private var exportError: String?
    @State private var showFull = false
    /// Today as a whole date, so the marker lands on the real day rather than on whichever cell
    /// happens to share its number.
    private var todayKey: String? { monthOffset == 0 ? ProjDate.fmt("yyyy-MM-dd").string(from: Date()) : nil }
    /// Only for the header line ("today 24").
    private var todayDay: Int? { monthOffset == 0 ? ProjDate.cal.component(.day, from: Date()) : nil }
    /// Built once per load, not per read. It used to be a computed property — a `Dictionary(grouping:)`
    /// plus a `localizedCaseInsensitiveCompare` sort (ICU collation, the slowest comparator Foundation
    /// has) — and `body` reads it three times: the empty check, the name column and the cell grid.
    @State private var members: [Member] = []
    @State private var cachedFrom: Date?
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
    /// The attendance PERIOD, not the calendar month: from the 28th, today already belongs to next
    /// month's period (28 Sep → "2026-10", 28 Sep–27 Oct), as on the server and the web. Until 28 Sep
    /// 2026 this took the calendar month, so on the 28th the board still showed the period that had ended.
    private var monthDate: Date {
        let now = Date()
        let base = ProjDate.cal.component(.day, from: now) >= 28 ? (ProjDate.cal.date(byAdding: .month, value: 1, to: now) ?? now) : now
        return ProjDate.cal.date(byAdding: .month, value: monthOffset, to: base) ?? base
    }
    private var monthKey: String { ProjDate.fmt("yyyy-MM").string(from: monthDate) }
    private var monthLabel: String { ProjDate.fmt("MMMM yyyy").string(from: monthDate) }
    /// The attendance PERIOD this board covers: the 28th of the previous month through the 27th of
    /// this one, which is what payroll counts and what the server returns for `month=`.
    ///
    /// The board used to draw 1…31 and key every cell by day-of-month alone, so 28–31 August were
    /// painted into September's 28–31 slots — at the far right, after the 27th, as if they were the
    /// end of the month rather than the start of the period. Days carry their whole date now, so
    /// they sit in the order they actually happened.
    struct PeriodDay: Identifiable, Hashable {
        let key: String     // yyyy-MM-dd
        let day: Int
        let startsMonth: Bool
        /// English three-letter weekday ("Mon"), shown through `T()` so Bahasa reads "Sen". Taken
        /// from the Jakarta calendar, not from a formatter locale, so it never depends on the device.
        let weekday: String
        var id: String { key }
        /// "MON" / "SEN" — the label above the day number, as on the web board.
        var weekdayLabel: String { T(weekday).uppercased() }
    }
    /// Indexed by `Calendar.component(.weekday)` − 1 (Sunday first). Each is a key in Localization.
    private static let weekdayKeys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    /// Payroll's cut-off: a day after the 27th belongs to the next month's period.
    private static let cutoffDay = 27
    /// Built once per month. `buildPeriodDays` allocates ~31 dates every call and the header reads
    /// it again through `periodLabel`; rebuilding that on every body pass also kept resetting the
    /// horizontal scroll, which is what stopped the board landing on today.
    @State private var periodDays: [PeriodDay] = []

    private func buildPeriodDays() -> [PeriodDay] {
        let cal = ProjDate.cal
        guard let firstOfMonth = cal.date(from: cal.dateComponents([.year, .month], from: monthDate)),
              let end = cal.date(byAdding: .day, value: Self.cutoffDay - 1, to: firstOfMonth),
              let prevMonth = cal.date(byAdding: .month, value: -1, to: firstOfMonth),
              let start = cal.date(byAdding: .day, value: Self.cutoffDay, to: prevMonth)
        else { return [] }
        let fmt = ProjDate.fmt("yyyy-MM-dd")
        var out: [PeriodDay] = []
        var d = start
        while d <= end {
            let day = cal.component(.day, from: d)
            out.append(PeriodDay(key: fmt.string(from: d), day: day, startsMonth: day == 1,
                                 weekday: Self.weekdayKeys[(cal.component(.weekday, from: d) - 1) % 7]))
            guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return out
    }
    /// "28 Aug – 27 Sep": the window this board covers, so it is never a guess.
    private var periodLabel: String {
        let inFmt = ProjDate.fmt("yyyy-MM-dd"), outFmt = ProjDate.fmt("d MMM")
        guard let first = periodDays.first, let last = periodDays.last,
              let a = inFmt.date(from: first.key), let b = inFmt.date(from: last.key) else { return "" }
        return "\(outFmt.string(from: a)) – \(outFmt.string(from: b))"
    }

    struct Member: Identifiable {
        let id: String; let name: String; let cells: [String: AttTone]; let rowByDay: [String: AttendanceRow]
        /// Weekly-rest quota from the server (4 for most people, 9 for some); 4 when an older server sends none.
        var quota: Int = 4
        /// Days worked in the period: a check-in, an approved permit or WFH — everything green or blue.
        var workedDays: Int { cells.values.filter { $0 == .present || $0 == .permit || $0 == .wfh }.count }
    }
    /// The period's working days: its calendar days minus the weekly-rest quota (4 by default), so 31
    /// days give 27 and 30 give 26 — the web board's Score column uses the same rule.
    static func workingDays(_ periodDays: Int, dayOffQuota: Int = 4) -> Int { max(0, periodDays - dayOffQuota) }
    /// "22/22 +3": capped at the working days with the surplus beside it, as on the web. A day cut from
    /// the quota for being >120 min late is still a day worked, so worked can exceed the target.
    static func scoreText(worked: Int, target: Int) -> Text {
        let base = Text("\(min(worked, target))/\(target)")
        guard worked > target else { return base }
        return base + Text(" +\(worked - target)").foregroundColor(NX.success)
    }
    private static func buildMembers(_ rows: [AttendanceRow]) -> [Member] {
        let groups = Dictionary(grouping: rows) { $0.user?.id ?? "me" }
        return groups.map { uid, rs -> Member in
            var cells: [String: AttTone] = [:]
            var rowByDay: [String: AttendanceRow] = [:]
            for r in rs { if let k = Self.dayKey(r.attendanceDate) { cells[k] = AttTone.of(r); rowByDay[k] = r } }
            return Member(id: uid, name: rs.first?.user?.name ?? T("You"), cells: cells, rowByDay: rowByDay,
                          quota: rs.compactMap { $0.user?.dayOffQuota }.first ?? 4)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    /// Whether a tap on this cell opens it, and with which row.
    ///
    /// Everybody opens a real record (one with an id). The BoD (canManageAttendance) also opens the
    /// server's id-less rows — the synthetic ABSENT day and request-covered days — and an empty day
    /// up to today, so a status can be set from the phone as on the web board. Future days stay
    /// closed: the server refuses to override them. `nowKey` is today's yyyy-MM-dd in Jakarta.
    ///
    /// Split in two so `body` only does the cheap check per cell; the stand-in row for an empty day
    /// (a JSON round-trip) is built on the tap, not for every empty cell on every render.
    static func canOpen(_ m: Member, _ pd: PeriodDay, canManage: Bool, nowKey: String) -> Bool {
        if let row = m.rowByDay[pd.key] { return row.id != nil || canManage }
        return canManage && pd.key <= nowKey && m.id != "me"
    }
    static func openableRow(_ m: Member, _ pd: PeriodDay) -> AttendanceRow? {
        m.rowByDay[pd.key] ?? AttendanceRow.emptyDay(userId: m.id, name: m.name, dateKey: pd.key)
    }
    /// The whole date, not the day number: the period spans two months and they share numbers.
    private static func dayKey(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        return String(iso.prefix(10))   // "yyyy-MM-dd"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(wide ? T("Crew streak board") : T("Your attendance history")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(todayDay.map { "\(monthLabel.capitalized) · \(T("today")) \($0)" } ?? monthLabel.capitalized)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    // The window this board actually covers — payroll counts 28→27, and the board
                    // used to name only the month it ended in.
                    Text(periodLabel)
                        .font(NXFont.text(10)).foregroundStyle(NX.mutedFg.opacity(0.85)).lineLimit(1)
                }
                Spacer()
                HStack(spacing: 2) {
                    Button { showFull = true } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30)
                    }
                    .accessibilityLabel(T("Open the full board"))
                    .fullScreenCover(isPresented: $showFull) {
                        FullBoard(members: members, periodDays: periodDays, monthLabel: "\(monthLabel.capitalized) · \(periodLabel)", todayKey: todayKey,
                                  canManage: canManage, legend: AnyView(legend)) { await load() }
                    }
                    if wide {
                        Button { Task { await exportMonth() } } label: {
                            if exporting { ProgressView().scaleEffect(0.7).frame(width: 30, height: 30) }
                            else { Image(systemName: "square.and.arrow.up").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30) }
                        }
                        .disabled(exporting)
                        .accessibilityLabel(T("Export this month as a spreadsheet"))
                        .sheet(item: $exportItem) { item in ActivityView(items: [item.url]) }
                        .alert(T("Export failed"), isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
                            Button("OK") { exportError = nil }
                        } message: { Text(exportError ?? "") }
                    }
                    Button { monthOffset -= 1 } label: { Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30) }
                    Button { if monthOffset < 0 { monthOffset += 1 } } label: { Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(monthOffset < 0 ? NX.foreground : NX.mutedFg.opacity(0.4)).frame(width: 30, height: 30) }.disabled(monthOffset >= 0)
                }
            }
            legend
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if members.isEmpty {
                EmptyState(icon: "calendar", title: T("No attendance this month yet"),
                           subtitle: wide
                               ? T("Nobody has checked in this month yet. The first check-in fills the first cell; use the arrows to look at earlier months.")
                               : T("Your check-ins fill this board day by day — green for present, purple for a day off, red for a missed day. Check in from the card above."),
                           compact: true)
            } else {
                grid
            }
            if let cachedFrom { OfflineNotice(savedAt: cachedFrom) }
        }
        .nexusCard()
        // Keyed on the permissions too: /attendance/today lands AFTER the first paint, and a board
        // fetched with `scope=me` before canManage flipped stayed that way until the month changed.
        .task(id: "\(monthOffset)|\(wide)") {
            periodDays = buildPeriodDays()
            await load()
        }
        .sheet(item: $selectedRow) { row in
            RecordActionsSheet(row: row, canDelete: canManage, canChangeStatus: canManage) { await load() }
        }
    }

    /// A `LazyHStack` only registers the ids of columns it has actually built, and today is ~27
    /// columns off-screen — so a single call made at the wrong moment scrolls nowhere and says
    /// nothing. Tried again as the layout settles.
    private func scrollToToday(_ proxy: ScrollViewProxy) {
        guard let t = todayKey else { return }
        Task { @MainActor in
            for delay in [0, 150, 500] {
                if delay > 0 { try? await Task.sleep(for: .milliseconds(delay)) }
                // Centred across, top down: the targets live in the grid's first (empty) row.
                proxy.scrollTo("day-\(t)", anchor: UnitPoint(x: 0.5, y: 0))
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            ForEach([AttTone.present, .leave, .sick, .dayoff, .absent], id: \.label) { t in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3).fill(t.color).frame(width: 11, height: 11)
                    Text(t.label).font(NXFont.text(9, .medium)).foregroundStyle(NX.mutedFg)
                }
            }
        }
    }

    /// Date row: weekday over day number.
    private let headerH: CGFloat = 24
    private let scoreW: CGFloat = 48
    private static let boardSpace = "streakBoardCells"
    /// Where the cell grid is scrolled to. Only the pinned strips read it, so a scroll frame
    /// re-renders those three and not the whole card.
    @State private var scrollOffset = BoardScrollOffset()

    /// Freeze panes, like the web board since 28 Sep 2026: while correcting attendance the owner
    /// scrolls down the crew and across the days, and lost both the dates and the names doing it.
    /// Only the cells scroll (both ways, inside a bounded height); the date row, the names and the
    /// Score column are separate strips that follow the grid's offset along one axis each, clipped
    /// to their lane, and the top-left corner never moves. The strips sit OUTSIDE the scroll view
    /// rather than overlaid on it, so a tap on a name can never land on a cell hidden underneath.
    private var grid: some View {
        let rowsH = max(0, CGFloat(members.count) * (cell + gap) - gap)
        let contentH = headerH + gap + rowsH
        return VStack(alignment: .leading, spacing: gap) {
            HStack(spacing: 6) {
                Color.clear.frame(width: nameW, height: headerH)
                Color.clear.frame(height: headerH)
                    .overlay(alignment: .topLeading) { PinnedStrip(offset: scrollOffset, axis: .horizontal) { dateRow } }
                    .clipped()
                Text(T("Score")).font(.system(size: 8, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: scoreW, height: headerH, alignment: .bottomTrailing)
            }
            HStack(alignment: .top, spacing: 6) {
                Color.clear.frame(width: nameW)
                    .overlay(alignment: .topLeading) { PinnedStrip(offset: scrollOffset, axis: .vertical) { nameColumn } }
                    .clipped()
                ScrollViewReader { proxy in
                    ScrollView([.horizontal, .vertical], showsIndicators: false) { cells }
                        // A crew that fits the height doesn't grab vertical drags from the page.
                        .scrollBounceBehavior(.basedOnSize)
                        .coordinateSpace(.named(Self.boardSpace))
                        .onPreferenceChange(BoardOffsetKey.self) { origin in
                            scrollOffset.x = -origin.x
                            scrollOffset.y = -origin.y
                        }
                        // The grid is rebuilt after every reload (the spinner replaces it), and a new
                        // scroll view starts at the origin while the model still holds the old offset.
                        .onAppear { scrollOffset.x = 0; scrollOffset.y = 0; scrollToToday(proxy) }
                        // Land on today, not on the 28th: the column that matters is the one being filled in.
                        .onChange(of: members.count) { _, _ in scrollToToday(proxy) }
                        .onChange(of: periodDays.count) { _, _ in scrollToToday(proxy) }
                }
                // Score, pinned to the right like the web board: days worked out of working days.
                Color.clear.frame(width: scoreW)
                    .overlay(alignment: .topTrailing) { PinnedStrip(offset: scrollOffset, axis: .vertical) { scoreColumn } }
                    .clipped()
            }
        }
        // As tall as the crew, up to ~60% of the visible screen; past that the board scrolls
        // inside itself and the page around it stays put.
        .containerRelativeFrame(.vertical, alignment: .top) { length, _ in min(contentH, length * 0.6) }
    }

    private var dateRow: some View {
        HStack(spacing: gap) {
            ForEach(periodDays) { pd in
                let isToday = pd.key == todayKey
                VStack(spacing: 1) {
                    Text(pd.weekdayLabel).font(.system(size: 7, weight: isToday ? .bold : .medium))
                        .foregroundStyle(isToday ? NX.violetText : NX.mutedFg.opacity(0.8))
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text("\(pd.day)").font(.system(size: 8, weight: isToday ? .bold : .regular))
                        .foregroundStyle(isToday ? Color.white : NX.mutedFg).frame(width: cell, height: 13)
                        .background(isToday ? NX.violet : Color.clear, in: Capsule())
                }
                .frame(width: cell, height: headerH)
                // Where the month turns over, so 31 followed by 1 reads as a new
                // month rather than as a gap.
                .overlay(alignment: .leading) {
                    if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: headerH).offset(x: -gap / 2) }
                }
            }
        }
    }

    private var nameColumn: some View {
        VStack(alignment: .leading, spacing: gap) {
            ForEach(members) { m in
                Text(m.name).font(NXFont.text(11, .medium)).foregroundStyle(NX.foreground)
                    .lineLimit(1).frame(width: nameW, height: cell, alignment: .leading)
            }
        }
    }

    private var scoreColumn: some View {
        VStack(alignment: .trailing, spacing: gap) {
            ForEach(members) { m in
                Self.scoreText(worked: m.workedDays, target: Self.workingDays(periodDays.count, dayOffQuota: m.quota))
                    .font(NXFont.text(10, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: scoreW, height: cell, alignment: .trailing)
            }
        }
    }

    // Each row is lazy across the days. A month for a full crew is ~31 days × 40 people ≈ 1,240 cells, and as
    // plain HStacks every one of them was built and kept alive even though a dozen columns fit on
    // screen. Each row carries an explicit height — the same height its children already had —
    // because a lazy stack, unlike a plain one, will stretch to fill its container across its axis,
    // and that would blow the row spacing out.
    private var cells: some View {
        let nowKey = ProjDate.fmt("yyyy-MM-dd").string(from: Date())
        return VStack(alignment: .leading, spacing: 0) {
            // Scroll targets for `scrollToToday`: zero-height and eager, so every day's id exists
            // even before its lazy column has been built.
            HStack(spacing: gap) {
                ForEach(periodDays) { pd in Color.clear.frame(width: cell, height: 0).id("day-\(pd.key)") }
            }
            VStack(alignment: .leading, spacing: gap) {
                ForEach(members) { m in
                    LazyHStack(spacing: gap) {
                        ForEach(periodDays) { pd in
                            let fill = RoundedRectangle(cornerRadius: 5, style: .continuous).fill((m.cells[pd.key] ?? .none).color).frame(width: cell, height: cell)
                                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(pd.key == todayKey ? NX.violet : Color.clear, lineWidth: 1.5))
                                .overlay(alignment: .leading) {
                                    if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: cell).offset(x: -gap / 2) }
                                }
                            // Every cell with a record opens it — a manager reviewing their people
                            // and staff on their own board need the day's detail and its
                            // location trail too. The BoD also opens id-less and empty days to
                            // change their status; only the BoD's actions stay gated.
                            if Self.canOpen(m, pd, canManage: canManage, nowKey: nowKey) {
                                Button { selectedRow = Self.openableRow(m, pd) } label: { fill }.buttonStyle(.plain)
                            } else {
                                fill
                            }
                        }
                    }
                    .frame(height: cell)
                }
            }
        }
        // The grid's origin in the scroll view's own space is minus its content offset; the pinned
        // strips read it from here. iOS 17 has no `onScrollGeometryChange`, and this works on both.
        .background(GeometryReader { g in
            Color.clear.preference(key: BoardOffsetKey.self, value: g.frame(in: .named(Self.boardSpace)).origin)
        })
    }

    /// The whole month at once, pinch-zoomable — the card shows a few days at a time and hides
    /// the shape of the month; this is where a BoD reads it in one look.
    private struct FullBoard: View {
        let members: [Member]
        let periodDays: [PeriodDay]
        let monthLabel: String
        let todayKey: String?
        let canManage: Bool
        let legend: AnyView
        let onChanged: () async -> Void
        @Environment(\.dismiss) private var dismiss
        @State private var selectedRow: AttendanceRow?
        private let cell: CGFloat = 22
        private let gap: CGFloat = 3
        private let nameW: CGFloat = 120

        var body: some View {
            NavigationStack {
                ZStack {
                    NX.background.ignoresSafeArea()
                    VStack(spacing: 8) {
                        legend.padding(.horizontal, 16)
                        ZoomableCanvas(fitTrigger: 0) { grid.padding(16) }
                    }
                }
                .navigationTitle(monthLabel).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
                .sheet(item: $selectedRow) { row in RecordActionsSheet(row: row, canDelete: canManage, canChangeStatus: canManage) { await onChanged() } }
            }
        }

        private var grid: some View {
            let nowKey = ProjDate.fmt("yyyy-MM-dd").string(from: Date())
            return HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: gap) {
                    Color.clear.frame(height: 26)
                    ForEach(members) { m in
                        Text(m.name).font(NXFont.text(11, .medium)).foregroundStyle(NX.foreground)
                            .lineLimit(1).frame(width: nameW, height: cell, alignment: .leading)
                    }
                }
                VStack(alignment: .leading, spacing: gap) {
                    HStack(spacing: gap) {
                        ForEach(periodDays) { pd in
                            let isToday = pd.key == todayKey
                            VStack(spacing: 1) {
                                Text(pd.weekdayLabel).font(.system(size: 7, weight: isToday ? .bold : .medium))
                                    .foregroundStyle(isToday ? NX.violetText : NX.mutedFg.opacity(0.8))
                                    .lineLimit(1).minimumScaleFactor(0.6)
                                Text("\(pd.day)").font(.system(size: 9, weight: isToday ? .bold : .regular))
                                    .foregroundStyle(isToday ? Color.white : NX.mutedFg).frame(width: cell, height: 16)
                                    .background(isToday ? NX.violet : Color.clear, in: Capsule())
                            }
                            .frame(width: cell, height: 26)
                            .overlay(alignment: .leading) {
                                if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: 26).offset(x: -gap / 2) }
                            }
                        }
                    }
                    ForEach(members) { m in
                        HStack(spacing: gap) {
                            ForEach(periodDays) { pd in
                                let fill = RoundedRectangle(cornerRadius: 5, style: .continuous).fill((m.cells[pd.key] ?? .none).color).frame(width: cell, height: cell)
                                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(pd.key == todayKey ? NX.violet : Color.clear, lineWidth: 1.5))
                                    .overlay(alignment: .leading) {
                                        if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: cell).offset(x: -gap / 2) }
                                    }
                                // Same rule as the card grid — see `canOpen`.
                                if StreakBoardCard.canOpen(m, pd, canManage: canManage, nowKey: nowKey) {
                                    Button { selectedRow = StreakBoardCard.openableRow(m, pd) } label: { fill }.buttonStyle(.plain)
                                } else {
                                    fill
                                }
                            }
                        }
                    }
                }
                VStack(alignment: .trailing, spacing: gap) {
                    Text(T("Score")).font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg).frame(height: 26, alignment: .bottom)
                    ForEach(members) { m in
                        StreakBoardCard.scoreText(worked: m.workedDays, target: StreakBoardCard.workingDays(periodDays.count, dayOffQuota: m.quota))
                            .font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                            .frame(height: cell, alignment: .trailing)
                    }
                }
            }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    /// One month, everybody, as xlsx — into the share sheet so it can go to Files, WhatsApp or Mail.
    private func exportMonth() async {
        exporting = true; defer { exporting = false }
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent("absensi-\(monthKey).xlsx")
        try? FileManager.default.removeItem(at: dest)
        let req = APIClient.shared.makeRequest("/api/attendance/history?scope=workspace&month=\(monthKey)&format=xlsx")
        do {
            let response = try await APIClient.shared.download(req, to: dest)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { exportError = "Server error (\(http.statusCode))."; return }
            exportItem = ShareItem(url: dest)
        } catch { exportError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't download the file.") }
    }

    private func load() async {
        loading = true
        // Named once: the fetch and the cache key it falls back to have to agree, and a board of
        // the whole crew restored into a personal board would be a quiet, convincing lie.
        let scope = wide ? "workspace" : "me"
        do {
            let fetched = try await APIClient.shared.attendanceHistory(scope: scope, month: monthKey)
            members = Self.buildMembers(fetched)
            cachedFrom = nil
        }
        catch APIError.unauthorized { auth.logout() }   // leaves the board as it was, same as before
        catch {
            // A month already drawn is far more use than an empty grid, and unlike today's card
            // this cannot be misread as live: a finished day does not change, and the line
            // underneath says when the copy was taken.
            if let hit = ResponseCache.decoded("attendance-history-\(scope)-\(monthKey)",
                                               as: AttendanceHistoryResponse.self) {
                members = Self.buildMembers(hit.value.all)
                cachedFrom = hit.savedAt
            } else {
                members = []
                cachedFrom = nil
            }
        }
        loading = false
    }
}

/// The crew board's scroll position. A class (not @State values on the card) so a scroll frame
/// invalidates only the strips that read it — Observation tracks reads per property.
@Observable final class BoardScrollOffset {
    var x: CGFloat = 0
    var y: CGFloat = 0
}

/// The cell grid's origin in its scroll view's coordinate space (= minus the content offset).
private struct BoardOffsetKey: PreferenceKey {
    static let defaultValue: CGPoint = .zero
    static func reduce(value: inout CGPoint, nextValue: () -> CGPoint) { value = nextValue() }
}

/// A frozen strip of the crew board: its content moves with the grid along one axis only.
/// It reads just that axis, so scrolling across doesn't re-render the name column and
/// scrolling down doesn't re-render the date row.
private struct PinnedStrip<Content: View>: View {
    let offset: BoardScrollOffset
    let axis: Axis
    let content: Content
    init(offset: BoardScrollOffset, axis: Axis, @ViewBuilder content: () -> Content) {
        self.offset = offset; self.axis = axis; self.content = content()
    }
    var body: some View {
        content.fixedSize()
            .offset(x: axis == .horizontal ? -offset.x : 0, y: axis == .vertical ? -offset.y : 0)
    }
}

/// BoD: tap a crew-board cell → see that day's check-in/out and clean up bad data — delete the whole
/// record (accidental/"mabok" double check-in) or just the check-out (mis-tapped → reopen) — or
/// change the day's status (Present / Permit / Leave / Sick / Day off, or just clear the penalty).
struct RecordActionsSheet: View {
    let row: AttendanceRow
    /// The delete buttons are the BoD's (canManageAttendance). A manager reviewing their people,
    /// or somebody opening their own day, reads the same sheet without them — declared before
    /// `onDone` so the existing `RecordActionsSheet(row:) { … }` calls keep their trailing closure.
    var canDelete: Bool = true
    /// The BoD's "Change status" panel (canManageAttendance), as on the web board's cell drawer.
    var canChangeStatus: Bool = false
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var err: String?
    /// The override waiting for its confirmation (PRESENT … CLEAR_PENALTY).
    @State private var pendingOverride: String?
    @State private var overrideDone: String?
    /// Multi-day requests the server left covering a day just set to Present — told, then closed.
    @State private var multiDayLeft: Int?
    @State private var viewingPhoto: PhotoRef?

    private var dateLabel: String { AgendaRange.dayLabel(AgendaRange.dayKey(row.attendanceDate ?? "")) }
    private func timeText(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "—" }
        return ProjDate.fmt("HH:mm").string(from: d)
    }
    private var isRecord: Bool { (row.recordKind ?? (row.checkInAt != nil ? "ATTENDANCE" : "")) == "ATTENDANCE" }
    private var tone: AttTone { AttTone.of(row) }
    /// What the cell colour meant, in words — plus the number that decides the penalty.
    private var statusLabel: String {
        switch (row.attendanceDayType ?? "").uppercased() {
        case "SICK_APPROVED":    return T("Sick")
        case "PERMIT_APPROVED":  return T("Permit")
        case "LEAVE_APPROVED":   return T("Leave")
        case "DAY_OFF_APPROVED": return T("Day off")
        case "ABSENT":           return T("Absent")
        default:
            if let late = row.lateMinutes, late > 0 { return "\(T("Late")) \(late) \(T("min"))" }
            return row.checkInAt != nil ? T("Present") : T("No record")
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(row.user?.name ?? "Staff").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                        HStack(spacing: 8) {
                            Text(dateLabel).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            Text(statusLabel).font(NXFont.text(11, .bold)).foregroundStyle(Color.white)
                                .padding(.horizontal, 9).padding(.vertical, 4).background(tone.color, in: Capsule())
                            // Always location refused for this day: an empty trail below is the
                            // phone's permission, not a day spent inside.
                            if row.locationTrackingState == "denied" {
                                Label(T("Location off"), systemImage: "location.slash.fill")
                                    .font(NXFont.text(11, .bold)).foregroundStyle(Color.white)
                                    .padding(.horizontal, 9).padding(.vertical, 4).background(NX.danger, in: Capsule())
                            }
                        }
                    }

                    if isRecord {
                        evidence(T("Check-in"), at: row.checkInAt, status: row.checkInStatus, address: row.checkInAddress,
                                 distance: row.checkInDistanceMeters, photo: row.checkInPhotoUrl, icon: "arrow.right.to.line", tint: NX.success)
                        evidence(T("Check-out"), at: row.checkOutAt, status: row.checkOutStatus, address: row.checkOutAddress,
                                 distance: row.checkOutDistanceMeters, photo: row.checkOutPhotoUrl, icon: "arrow.left.to.line", tint: NX.danger)
                        if row.checkOutOffsite == true {
                            infoLine("mappin.and.ellipse", "\(T("Offsite check-out")) · \(reqStatusLabel(row.checkOutApproval))" + (row.checkOutReason.map { " · \($0)" } ?? ""))
                        }
                        if let office = row.officeLocation?.name {
                            infoLine("building.2", office + (row.effectiveShiftStartTime.map { " · \(T("shift")) \($0)–\(row.effectiveShiftEndTime ?? "")" } ?? ""))
                        }
                        if let w = row.workedMinutes, w > 0 { infoLine("clock", "\(T("Worked")) \(w / 60)h \(w % 60)m") }
                        if row.isCorrected == true {
                            infoLine("pencil.and.list.clipboard", "\(T("Corrected by BoD")) · \(row.correctionReason ?? "")")
                        }
                        if let notes = row.notes, !notes.isEmpty { infoLine("text.alignleft", notes) }
                        // Pushed inside this sheet's own stack rather than presented: the sheet
                        // already owns a fullScreenCover and a confirmationDialog.
                        if let id = row.id, row.checkInAt != nil {
                            NavigationLink {
                                LocationTrailView(recordId: id, trackingState: row.locationTrackingState)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "map.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                                    Text(T("View location trail")).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
                                }
                                .padding(12)
                                .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.violet.opacity(0.25)))
                            }
                            .buttonStyle(.plain)
                        }
                    } else if row.recordKind == "EMPTY" {
                        // A board cell the server sent no row for, opened by the BoD to set a status.
                        Text(T("Nothing was recorded for this day yet."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    } else if (row.attendanceDayType ?? "").uppercased() == "ABSENT" {
                        Text(T("No check-in was recorded that day and no request covered it."))
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    } else {
                        // A request row: the reason, who approved it, and the evidence attached.
                        infoLine("checkmark.seal", "\(reqLabel(row.requestType)) · \(reqStatusLabel(row.requestStatus))"
                                 + (row.reviewedBy?.name.map { " · \(T("approved by")) \($0)" } ?? ""))
                        if let notes = row.notes, !notes.isEmpty { infoLine("text.alignleft", notes) }
                        // The same attachment view as the Submissions card: a photo is labelled by what
                        // it is evidence of, never "sick-note.jpg"; any other file keeps its name.
                        if AttendanceRow.fileURL(row.supportingDocumentUrl) != nil, let path = row.supportingDocumentUrl {
                            RequestAttachmentView(path: path, name: row.supportingDocumentName, type: row.requestType, large: true)
                        }
                    }

                    if isRecord, row.id != nil, canDelete {
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
                    }

                    if canChangeStatus, overrideUserId != nil, overrideDayKey != nil { changeStatusPanel }

                    if let overrideDone { Text(overrideDone).font(NXFont.text(12, .semibold)).foregroundStyle(NX.success) }
                    if let err { Text(err).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }
                    if busy { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity) }
                }
                .padding(16)
                // On the content stack, not beside the ScrollView's cover and delete dialog: one
                // presentation per view.
                .alert(T("Heads up"), isPresented: Binding(get: { multiDayLeft != nil }, set: { if !$0 { multiDayLeft = nil } })) {
                    Button("OK") { multiDayLeft = nil; dismiss() }
                } message: {
                    Text(String(format: T("This date is still covered by %d multi-day request(s). If this day should really show as Present, adjust that request in Submissions."), multiDayLeft ?? 0))
                }
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Attendance detail")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
            .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
            .confirmationDialog("\(T("Delete the whole attendance record for")) \(dateLabel)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(T("Delete"), role: .destructive) { Task { await del(part: nil) } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { Text(T("That day's check-in & check-out are deleted permanently, and the day is shielded from attendance deductions.")) }
        }
    }

    // MARK: Change status (BoD) — web StatusOverridePanel

    private static let overrideActions = ["PRESENT", "PERMIT", "LEAVE", "SICK", "DAY_OFF"]
    private var overrideUserId: String? { row.user?.id }
    /// yyyy-MM-dd, the same slice of attendanceDate the web sends.
    private var overrideDayKey: String? {
        guard let d = row.attendanceDate, d.count >= 10 else { return nil }
        return String(d.prefix(10))
    }
    private var personName: String { row.user?.name ?? T("this staff member") }
    private static func overrideLabel(_ action: String) -> String {
        switch action {
        case "PRESENT": return T("Present")
        case "PERMIT":  return T("Permit")
        case "LEAVE":   return T("Leave")
        case "SICK":    return T("Sick")
        case "DAY_OFF": return T("Day off")
        default:        return T("Clear penalty")
        }
    }
    private func overrideTitle(_ action: String) -> String {
        action == "CLEAR_PENALTY"
            ? String(format: T("Clear the penalty for %@ for %@?"), dateLabel, personName)
            : String(format: T("Change %@ (%@) to %@?"), dateLabel, personName, Self.overrideLabel(action))
    }
    /// The exact consequence, per action — what the server does besides writing the status.
    private func overrideConsequence(_ action: String) -> String {
        let restored = T("That day's auto XP & day-off deductions are restored too.")
        switch action {
        case "CLEAR_PENALTY":
            return T("Deducted XP (late / forgot check-out / no-show) is refunded and any auto-deducted day-off is restored. The attendance status is NOT changed.")
        case "PRESENT":
            return T("The day becomes an on-time check-in over the shift hours, and a single-day request covering it is canceled.") + " " + restored
        case "PERMIT":
            return T("A check-in already made that day is kept.") + " " + restored
        default:
            return T("An unfinished check-in (no check-out) that day is removed.") + " " + restored
        }
    }

    private var changeStatusPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Change status (BoD)"))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                ForEach(Self.overrideActions, id: \.self) { action in
                    Button { pendingOverride = action } label: {
                        Text(Self.overrideLabel(action))
                            .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(NX.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(NX.border))
                    }.buttonStyle(.plain).disabled(busy)
                }
            }
            Button { pendingOverride = "CLEAR_PENALTY" } label: {
                Label(T("Clear penalty (restore XP & day-off)"), systemImage: "scalemass")
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.warning).frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(NX.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.warning.opacity(0.35)))
            }.buttonStyle(.plain).disabled(busy)
            Text(T("Every action restores that day's XP & day-off deductions and is written to the audit log."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .padding(12)
        .background(NX.violet.opacity(0.05), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.violet.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        // Its own view for the dialog: the sheet's stack already carries the delete confirmation.
        .confirmationDialog(pendingOverride.map { overrideTitle($0) } ?? "",
                            isPresented: Binding(get: { pendingOverride != nil }, set: { if !$0 { pendingOverride = nil } }),
                            titleVisibility: .visible, presenting: pendingOverride) { action in
            Button(action == "CLEAR_PENALTY" ? T("Clear penalty") : String(format: T("Change to %@"), Self.overrideLabel(action))) {
                Task { await applyOverride(action) }
            }
            Button(T("Cancel"), role: .cancel) {}
        } message: { action in Text(overrideConsequence(action)) }
    }

    private func applyOverride(_ action: String) async {
        guard let uid = overrideUserId, let day = overrideDayKey else { return }
        busy = true; err = nil; overrideDone = nil
        do {
            let r = try await APIClient.shared.attendanceOverride(userId: uid, date: day, action: action)
            if action == "CLEAR_PENALTY" {
                overrideDone = r.refunded == true
                    ? String(format: T("Penalty for %@ cleared — XP & day-off restored."), dateLabel)
                    : String(format: T("No penalty on %@ — this day stays safe from deductions."), dateLabel)
            } else {
                overrideDone = "\(personName) · \(dateLabel) → \(Self.overrideLabel(action))"
                    + (r.refunded == true ? " · \(T("Penalty restored."))" : "")
            }
            await onDone()
            if let n = r.multiDayRequestsLeft, n > 0 {
                // The alert's OK closes the sheet.
                multiDayLeft = n
                busy = false
                return
            }
            // Long enough to read the confirmation; still busy so nothing is tapped twice.
            try? await Task.sleep(for: .milliseconds(1400))
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change the status.")
            busy = false
        }
    }

    /// One leg of the day: time and status on the left, the selfie on the right, the place below.
    private func evidence(_ label: String, at iso: String?, status: String?, address: String?, distance: Double?, photo: String?, icon: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: icon).font(.system(size: 12)).foregroundStyle(tint)
                    Text(label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    Spacer()
                    Text(timeText(iso)).font(NXFont.text(15, .bold)).foregroundStyle(iso == nil ? NX.mutedFg : NX.foreground)
                }
                if let status, !status.isEmpty {
                    Text(status.replacingOccurrences(of: "_", with: " ").capitalized).font(NXFont.text(11, .semibold)).foregroundStyle(status.uppercased().contains("LATE") || status.uppercased().contains("EARLY") ? NX.danger : NX.mutedFg)
                }
                if let address, !address.isEmpty {
                    Text(address).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
                if let distance { Text("±\(Int(distance.rounded())) m \(T("from the office"))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                if iso == nil { Text(T("Not recorded.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
            }
            if let url = AttendanceRow.fileURL(photo) {
                Button { viewingPhoto = PhotoRef(url: url, name: label) } label: {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                        .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }.buttonStyle(.plain).accessibilityLabel(T("Selfie"))
            } else if iso != nil {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NX.muted).frame(width: 64, height: 64)
                    .overlay(Image(systemName: "camera").foregroundStyle(NX.mutedFg))
            }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    private func infoLine(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(NX.mutedFg).frame(width: 18)
            Text(text).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
        }
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
