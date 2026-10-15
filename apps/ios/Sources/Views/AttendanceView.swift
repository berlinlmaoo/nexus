import SwiftUI
import Observation
import MapKit
import CoreLocation

/// Native port of the web MobileCheckInHero: map hero + violet gradient time card (live clock,
/// schedule, IN/OUT) + ONE attendance button that follows the day (green Check in → Check out,
/// locked until the reflection is long enough → done) + offsite-reason flow.
struct AttendanceView: View {
    @Environment(AuthStore.self) private var auth
    /// Read for one thing: an approver's "Budi is outside the office" push lands on the crew board
    /// (`NotificationTarget.crewBoard`), which sits at the bottom of this screen.
    @Environment(AppRouter.self) private var router
    /// Only the Attendance screen in front claims that push: another one left mounted under a hidden
    /// tab (pushed from Home) must not take it and scroll where nobody is looking.
    @State private var onScreen = false
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
    /// Why "Finding you…" stopped: no position within `locateTimeout`, or no office to measure
    /// against. nil while still looking or once found (UI tour run 14, P-I23: it never resolved).
    @State private var locateProblem: LocateProblem?
    private enum LocateProblem { case noFix, noOffices }
    private static let locateTimeout: Duration = .seconds(20)
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
    /// Drives the keyboard's Done button: the reflection is multi-line, so Return adds a line and
    /// nothing else ever put the keyboard away (owner, 28 Sep 2026).
    @FocusState private var reflectionFocused: Bool
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
    /// Attendance is the one tap in this app that must never end in "did that work?". Every stage
    /// of it is drawn IN the button that was pressed (owner request, 28 Sep 2026): the face check,
    /// the position with the office it puts you in, the upload, then the result. Nothing here
    /// changes what is sent; it only says, step by step, what is happening to it.
    enum Flow: Equatable {
        case face(Action)                       // the selfie is being checked for a face
        case selfieOK(Action)
        case locating(Action)
        case located(Action, String, Bool)      // "At PATS Group HQ · 12 m", inside the geofence?
        case sending(Action, String?)           // the place line stays under "Sending…"
        case done(Action, String)               // the time recorded (HH:mm)
        case savedOffline(Action, String)       // the time that will be credited
        case failed(Action, String)             // the server's (or the phone's) sentence
        var action: Action {
            switch self {
            case .face(let a), .selfieOK(let a), .locating(let a), .located(let a, _, _), .sending(let a, _),
                 .done(let a, _), .savedOffline(let a, _), .failed(let a, _): return a
            }
        }
        var isBusy: Bool {
            switch self {
            case .face, .selfieOK, .locating, .located, .sending: return true
            case .done, .savedOffline, .failed: return false
            }
        }
    }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Bumped once per failure; `ShakeEffect` turns each step into one horizontal shake.
    @State private var shakes: CGFloat = 0
    /// The check-in time the press started from, kept so a check-out can say how long the day was
    /// even when the record it closed (a forgotten previous day) is gone from `today` afterwards.
    @State private var pressedFromCheckIn: String?

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

    @Environment(\.horizontalSizeClass) private var hSize
    /// The sidebar's Attendance page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.attendance, hSize: hSize, router: router) }
    /// The page scroll's top content inset (the pinned header above it).
    @State private var pageTopInset: CGFloat = 0

    /// Web attendance.tsx PageHeader; the subtitle follows whether this person sees the crew board.
    private var pageHeader: some View {
        NXPageHeader(title: T("Attendance"), subtitle: pageSubtitle)
    }
    private var pageSubtitle: String {
        let canSeeBoard = (today?.canManageAttendance ?? false) || (today?.canReviewAttendanceRequests ?? false)
        return canSeeBoard
            ? T("Who's in, on leave or working from home, and everyone's attendance history.")
            : T("Check in, ask for leave or a permission, and see your attendance history.")
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollViewReader { proxy in
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
                        // One button for the whole day. WHY it is greyed out (the reflection) is written
                        // on the button itself, with the count.
                        primaryControl
                        if showOffsite { offsitePrompt }
                        #endif
                        if forcePending { infoBanner(forcePendingMessage, tone: .warning) }
                        if pending { infoBanner(T("⏳ Checkout outside the office area — waiting for board approval"), tone: .warning) }
                        if rec?.checkOutApproval == "REJECTED" { infoBanner(T("Your out-of-area checkout was rejected by the board."), tone: .danger) }
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
                        // `ready`: the board's scope comes with /attendance/today. Asked before that, a
                        // manager's board was fetched as `scope=me` and could land over the whole crew
                        // (UI tour run 14, N-04 / P-I4 / P-M4).
                        StreakBoardCard(canManage: today?.canManageAttendance ?? false,
                                        canReview: today?.canReviewAttendanceRequests ?? false,
                                        ready: today != nil || !loading)
                            .id(Self.crewBoardAnchor)
                        if today?.canManageAttendance == true {
                            // The web page's Employment start date section (iPad / Mac; UI tour run 15, Q-IB8).
                            if hSize == .regular { EmploymentStartCard() }
                            OfficesCard()
                        }
                    }
                    .padding(.horizontal, NXSidebarPage.gutter(isRoot))
                    .padding(.vertical, isRoot ? 24 : 16)
                }
                // Where the page's visible top is, for the board's sticky day row (`StickyInPageScroll`).
                .modifier(PageTopInsetReader(inset: $pageTopInset))
                .environment(\.pageScrollTopInset, pageTopInset)
                // Dragging the page down puts the keyboard away too.
                .scrollDismissesKeyboard(.interactively)
                // On the ScrollView, not beside `.permissionAlert` further down: two alerts on one view
                // and one of them never shows.
                .heldAttendanceNotice(whileLocked: false)
                // The crew board a push asked for: once today has loaded (the board's permissions come
                // with it), or at once when it arrives while this screen is already up.
                .onAppear {
                    onScreen = true
                    if !loading, case .crewBoard = router.focus { scrollToCrewBoard(proxy) }
                }
                .onDisappear { onScreen = false }
                .onChange(of: loading) { _, now in
                    if !now, onScreen, case .crewBoard = router.focus { scrollToCrewBoard(proxy) }
                }
                .onChange(of: router.focus) { _, focus in
                    if !loading, onScreen, case .crewBoard = focus { scrollToCrewBoard(proxy) }
                }
            }
        }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: pageSubtitle) { pageHeader }
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

    private static let crewBoardAnchor = "crew-board"

    /// Brings the crew board to the top of the screen, once per push. Tried again as the cards above
    /// it fill in (the requests list, the metrics), each of which pushes the board further down.
    private func scrollToCrewBoard(_ proxy: ScrollViewProxy) {
        router.focus = nil
        Task { @MainActor in
            for delay in [0, 300, 600, 1200] {
                if delay > 0 { try? await Task.sleep(for: .milliseconds(delay)) }
                proxy.scrollTo(Self.crewBoardAnchor, anchor: .top)
            }
        }
    }

    // MARK: hero (map + gradient time card)

    /// How far the GPS dot is pushed below the map frame's centre, in points.
    /// Raise it if the purple card grows taller and starts covering the dot again.
    private static let pinDrop: CGFloat = 90

    /// The office drawn on the hero map: today's record's office, else the nearest one found before
    /// check-in. nil when neither has coordinates.
    private var mapOffice: (center: CLLocationCoordinate2D, radius: Double, name: String)? {
        // Location-free members aren't tied to an office: their map follows them, not a building.
        if locationFree { return nil }
        if let o = dispRec?.officeLocation, let la = o.latitude, let lo = o.longitude {
            return (CLLocationCoordinate2D(latitude: la, longitude: lo), o.radiusMeters ?? 100, o.name ?? "")
        }
        if let n = nearby, let la = n.office.latitude, let lo = n.office.longitude {
            return (CLLocationCoordinate2D(latitude: la, longitude: lo), Double(n.office.radiusMeters ?? 100), n.office.name)
        }
        return nil
    }
    /// Framed on the office: a few radii across, never tighter than ~300 m, so the circle and the
    /// streets around it are readable instead of a whole district.
    private var locationFree: Bool { today?.noGeofence == true }
    private func frameOffice() {
        if locationFree {
            // Framed on the person's own GPS fix, close enough to read the streets.
            #if !targetEnvironment(macCatalyst)
            Task {
                guard let fix = try? await loc.currentFix() else {
                    // No fix (location off, indoors, the simulator): the offices, as the web frames them,
                    // instead of the system's fallback that showed half of Southeast Asia (UI tour 13 Oct 2026).
                    if let region = Self.officesRegion(offices) { camera = .region(region) }
                    return
                }
                camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude),
                                                    latitudinalMeters: 400, longitudinalMeters: 400))
            }
            #endif
            return
        }
        guard let o = mapOffice else { return }
        let span = max(o.radius * 7, 300)
        camera = .region(MKCoordinateRegion(center: o.center, latitudinalMeters: span, longitudinalMeters: span))
    }
    /// Every active office with coordinates in one frame, with a margin; nil when none has any.
    private static func officesRegion(_ offices: [Office]) -> MKCoordinateRegion? {
        let points: [CLLocationCoordinate2D] = offices.compactMap { o in
            guard o.isActive != false, let la = o.latitude, let lo = o.longitude else { return nil }
            return CLLocationCoordinate2D(latitude: la, longitude: lo)
        }
        guard let first = points.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude, minLon = first.longitude, maxLon = first.longitude
        for p in points {
            minLat = min(minLat, p.latitude); maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude); maxLon = max(maxLon, p.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * 1.6, 0.02),
                                    longitudeDelta: max((maxLon - minLon) * 1.6, 0.02))
        return MKCoordinateRegion(center: center, span: span)
    }

    private var mapOfficeKey: String {
        if locationFree { return "free" }
        guard let o = mapOffice else { return "" }
        return "\(o.center.latitude),\(o.center.longitude),\(o.radius)"
    }

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
            Map(position: $camera) {
                UserAnnotation()
                // The office this day belongs to (or the nearest one before check-in) with its
                // check-in circle, so the map answers "am I inside?" at a glance (owner, 28 Sep 2026).
                if let o = mapOffice {
                    MapCircle(center: o.center, radius: o.radius)
                        .foregroundStyle(NX.violet.opacity(0.14))
                        .stroke(NX.violet, lineWidth: 2)
                    Annotation(o.name, coordinate: o.center, anchor: .center) {
                        Image(systemName: "building.2.fill")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(NX.violet, in: Circle())
                            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    }
                }
            }
                .mapStyle(.standard(elevation: .flat))
                .disabled(true)
                .frame(height: 360 + Self.pinDrop * 2)
                .offset(y: Self.pinDrop)
                .frame(height: 360)
                .clipped()
                .onAppear { frameOffice() }
                .onChange(of: mapOfficeKey) { _, _ in frameOffice() }

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
                            Text(T("Check in from anywhere"))
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

    /// A Grid, not a LazyVGrid: the two cards of a row take the taller one's height, so neither keeps a
    /// fixed minimum with its lower half empty (UI tour run 14, P-M11).
    private var metricsGrid: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                FunMetricCard(icon: "cup.and.saucer.fill", label: T("Today's status"), value: todayStatusValue,
                              helper: todayStatusHelper, tint: NX.success)
                FunMetricCard(icon: nearby?.inside == true && dispRec?.officeLocation?.name == nil ? "checkmark.circle.fill" : "mappin.circle.fill",
                              label: officeLabel, value: officeValue, helper: officeHelper, tint: officeTint)
            }
            GridRow {
                FunMetricCard(icon: "sparkles", label: T("Days off"), value: Self.quotaValue(today?.dayOffUsedThisMonth, today?.dayOffQuota),
                              helper: dayOffHelper, tint: NX.warning)
                FunMetricCard(icon: "calendar", label: T("Public holidays"), value: Self.quotaValue(today?.redDateUsedThisMonth, today?.redDateQuota),
                              helper: T("This month's public\u{2011}holiday allowance"), tint: Color(hex: "#fb7185"))
            }
        }
    }

    /// Under today's status: the schedule it is measured against.
    private var todayStatusHelper: String {
        guard let shift = today?.myShift else { return "" }
        if shift.flexi == true { return "Flexi \(shift.startTime)–\(shift.endTime) · +9h" }
        return T("My Work Schedule") + " \(shift.startTime) – \(shift.endTime)"
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
    /// A quota of 0 says so in words: "0/0 used" carried no information (UI tour run 13, F-17 / I-24 / M-19).
    /// "0/4 used" on every platform, a quota of 0 included ("0/0 used", as the web; UI tour run 16, R16-I-11 /
    /// R16-B-24, decision 4).
    private static func quotaValue(_ used: Int?, _ quota: Int?) -> String {
        guard let quota else { return "\u{2014}" }
        return String(format: T("%@/%@ used"), AppNumber.int(used ?? 0), AppNumber.int(quota))
    }

    private var todayStatusValue: String {
        if forcePending { return T("Finish yesterday's attendance") }
        if let s = rec?.status, !s.isEmpty { return Self.humanize(s) }
        if let req = today?.todayRequest, let t = req.type { return "\(Self.humanize(t)) \(Self.humanize(req.status ?? ""))".trimmingCharacters(in: .whitespaces) }
        // The web's wording before check-in (UI tour run 16, R16-B-24, decision 4).
        return T("Ready to check in")
    }
    /// Once checked in this is the office on the record. Before that it used to say "5 active
    /// offices", which is a fact about the company and not about the person holding the phone —
    /// so now it answers the question they actually have: which office am I at?
    /// Per record (owner, 28 Sep 2026): was the displayed day's check-in made away from the office?
    /// nil before check-in or when unknown — then the per-person `locationFree` rule below applies.
    private var recordAway: Bool? { dispRec?.checkInAt != nil ? dispRec?.checkedInAway : nil }
    private var officeValue: String {
        // The record decides once there is a check-in: away → the address it was made at; inside the
        // radius → the office, even for a location-free member.
        if recordAway == true { return dispRec?.placeLabel ?? T("Checked in away from the office") }
        if recordAway == false, let name = dispRec?.officeLocation?.name { return name }
        // Location-free: where they actually checked in (the server's address for it), not the
        // office the record happens to be filed under.
        if locationFree {
            if let a = dispRec?.checkInAddress, !a.isEmpty { return a.components(separatedBy: ",").prefix(2).joined(separator: ",") }
            // Before check-in the web's tile says what the rule means for you: "Any location /
            // Check in from anywhere" (attendance.tsx), not "Location-free" (UI tour run 4).
            return dispRec?.checkInAt != nil ? T("Checked in away from the office") : T("Check in from anywhere")
        }
        if let name = dispRec?.officeLocation?.name { return name }
        if let n = nearby { return n.office.name }
        // iPad / Mac before check-in: the web's "4 active offices" (UI tour run 15, Q-IB8); the location state
        // is already the chip's on the map.
        if hSize == .regular, dispRec?.checkInAt == nil, let n = today?.activeOfficeCount, n > 0 {
            return T("{n} active offices").replacingOccurrences(of: "{n}", with: AppNumber.int(n))
        }
        // A Mac never takes a GPS fix (locateWithinOffice is phone-only), so "Finding you…" spun forever
        // there (UI tour run 11, MC-12). Say where the location is read instead.
        #if targetEnvironment(macCatalyst)
        return T("On your phone")
        #else
        if locationOff { return T("Location is off") }
        switch locateProblem {
        case .noFix: return T("Location not found")
        case .noOffices: return T("No office set up")
        // One wording with the map pill (UI tour run 17, iPhone R17-I-16, decision 8).
        case nil: return T("Finding your location…")
        }
        #endif
    }
    /// iPad / Mac before check-in with no office in reach: the web's OFFICES tile, "4 active offices".
    private var showsOfficeCount: Bool {
        hSize == .regular && dispRec?.checkInAt == nil && nearby == nil && (today?.activeOfficeCount ?? 0) > 0
    }

    private var officeLabel: String {
        if showsOfficeCount { return T("Offices") }
        if recordAway == true { return T("Where you checked in") }
        if recordAway == false { return dispRec?.officeLocation?.name != nil ? T("Office") : T("Where you are") }
        if locationFree { return dispRec?.checkInAt != nil ? T("Where you checked in") : T("Any location") }
        #if targetEnvironment(macCatalyst)
        if dispRec?.officeLocation?.name == nil { return T("Check-in location") }
        #endif
        return dispRec?.officeLocation?.name != nil ? T("Office") : T("Where you are")
    }
    private var officeHelper: String {
        if dispRec?.checkInAt != nil || dispRec?.checkOutAt != nil {
            let times = "In \(dispRec?.checkInAt.flatMap(Self.hhmm) ?? "--:--") · Out \(dispRec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")"
            // Moved to another office since checking in: say which one (any active office counts).
            if dispRec?.checkOutAt == nil, let id = dispRec?.id, WorkPlace.shared.recordId == id,
               let here = WorkPlace.shared.officeName, here != dispRec?.officeLocation?.name {
                return "\(String(format: T("Now at %@"), here)) · \(times)"
            }
            return recordAway == true ? "\(T("Away from the office")) · \(times)" : times
        }
        // Location-free and not in yet: no office to measure against, so not "Checking where you are…".
        // The web's wording before check-in, everywhere (UI tour run 17, decision 7).
        if locationFree { return T("Ready to check in") }
        if showsOfficeCount { return T("Ready to check in") }
        if let n = nearby {
            return n.inside
                ? T("You're inside this office area")
                : String(format: T("%@ from here"), Self.distanceLabel(n.distance))
        }
        #if targetEnvironment(macCatalyst)
        return T("Check-in location is taken by the NEXUS app on your phone.")
        #else
        if locationOff { return T("Turn location on to see which office you're at") }
        switch locateProblem {
        case .noFix: return T("Couldn't get your position. Pull down to try again.")
        case .noOffices: return T("Your workspace has no office to check in at yet.")
        // Not a second "…" under "Finding you…" (run 14, N-33): the two fonts draw the ellipsis differently.
        case nil: return T("Usually takes a few seconds.")
        }
        #endif
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
        locateProblem = nil
        if offices.isEmpty { offices = (try? await APIClient.shared.attendanceOffices()) ?? [] }
        guard !offices.isEmpty else { locateProblem = .noOffices; return }
        // The fix itself has no deadline (it waits on Core Location), so a timer says when to stop
        // promising one; a fix that still arrives later replaces the message.
        let deadline = Task { @MainActor in
            try? await Task.sleep(for: Self.locateTimeout)
            if !Task.isCancelled, nearby == nil { withAnimation { locateProblem = .noFix } }
        }
        defer { deadline.cancel() }
        guard let fix = try? await loc.currentFix() else { locateProblem = .noFix; return }
        guard let best = nearestOffice(to: fix) else { locateProblem = .noOffices; return }
        withAnimation(.easeInOut(duration: 0.25)) { nearby = best; locateProblem = nil }
        #endif
    }

    private func nearestOffice(to fix: LocationManager.Fix) -> (office: Office, distance: Double, inside: Bool)? {
        let here = CLLocation(latitude: fix.latitude, longitude: fix.longitude)
        var best: (office: Office, distance: Double)?
        for o in offices where (o.isActive ?? true) {
            guard let la = o.latitude, let lo = o.longitude else { continue }
            let d = here.distance(from: CLLocation(latitude: la, longitude: lo))
            if best == nil || d < best!.distance { best = (o, d) }
        }
        guard let best else { return nil }
        return (best.office, best.distance, best.distance <= Double(best.office.radiusMeters ?? 100))
    }

    /// The line the button shows once the phone has a position: which office it puts you in and how
    /// far from its centre. A preview only — the server measures again and its answer is the one that
    /// counts (a check-in outside is refused with its own sentence, a check-out outside asks for a
    /// reason). Offices come from the list loaded before a check-in; for a check-out the list may not
    /// be there, and the office on the open record is the one that matters anyway.
    private func placeLine(for fix: LocationManager.Fix) -> (text: String, inside: Bool) {
        if today?.noGeofence == true { return (T("Location-free · position recorded"), true) }
        if let n = nearestOffice(to: fix) {
            withAnimation(.easeInOut(duration: 0.25)) { nearby = n }
            return n.inside
                ? (String(format: T("At %@ · %@"), n.office.name, Self.distanceLabel(n.distance)), true)
                : (String(format: T("%@ from %@ — outside the office area"), Self.distanceLabel(n.distance), n.office.name), false)
        }
        let here = CLLocation(latitude: fix.latitude, longitude: fix.longitude)
        if let o = dispRec?.officeLocation, let la = o.latitude, let lo = o.longitude {
            let d = here.distance(from: CLLocation(latitude: la, longitude: lo))
            let name = o.name ?? T("the office")
            return d <= (o.radiusMeters ?? 100)
                ? (String(format: T("At %@ · %@"), name, Self.distanceLabel(d)), true)
                : (String(format: T("%@ from %@ — outside the office area"), Self.distanceLabel(d), name), false)
        }
        return (String(format: T("Location found · ±%@"), Self.distanceLabel(fix.accuracyM)), true)
    }

    static func humanize(_ raw: String) -> String {
        raw.split(whereSeparator: { $0 == "_" || $0 == " " })
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }

    // MARK: the one attendance button

    /// What the button is for, read off the day. `flow` draws over it while a press is running and
    /// for a moment after. nil = there is nothing to press today (an approved request covers it).
    private enum Primary: Equatable {
        case loading
        case checkIn
        case checkOutLocked(Int)    // reflection characters so far
        case checkOut
        case waitingApproval
        case done
    }

    private var primary: Primary? {
        if loading && today == nil && queue.count == 0 { return .loading }
        if pending { return .waitingApproval }
        // The forgotten check-out comes first: the server will not take today's check-in until it
        // is closed, and it needs the same reflection as any other check-out.
        if forcePending || (checkedIn && !checkedOut) {
            return reflectionOK ? .checkOut : .checkOutLocked(reflectionCount)
        }
        if checkedOut { return .done }
        if today?.todayRequest != nil { return nil }
        return .checkIn
    }

    /// Everything the button needs to draw one state. One struct for every state so SwiftUI keeps
    /// the same button and animates its colour and label instead of swapping views.
    private struct Look {
        enum Icon: Equatable { case symbol(String), ring, spinner, check }
        var key: String
        var title: String
        var subtitle: String? = nil
        var icon: Icon
        var fill: Color
        var fg: Color = .white
        /// 0…1 — the reflection gate fills the grey button towards red as the note grows.
        var progress: Double? = nil
        var enabled: Bool
    }

    private static let inGreen = Color(hex: "#10b981")
    private static let outRed = Color(hex: "#f43f5e")

    @ViewBuilder private var primaryControl: some View {
        if flow == nil && primary == nil {
            coveredByRequestCard
        } else {
            let look = flow.map { pressLook($0) } ?? stateLook(primary ?? .loading)
            VStack(spacing: 8) {
                attendanceButton(look)
                if case .failed(_, let msg) = flow {
                    VStack(spacing: 6) {
                        Text(msg).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                        Button(T("Cancel")) { withAnimation { flow = nil } }
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
                }
            }
        }
    }

    private func attendanceButton(_ l: Look) -> some View {
        Button { pressed() } label: {
            HStack(spacing: 10) {
                buttonIcon(l.icon)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(l.title).font(NXFont.display(16, .bold))
                        .lineLimit(2).minimumScaleFactor(0.85)
                    if let sub = l.subtitle {
                        Text(sub).font(NXFont.text(12, .semibold)).opacity(0.88)
                            .lineLimit(2).minimumScaleFactor(0.85)
                    }
                }
                .multilineTextAlignment(.leading)
                .id(l.key)
                .transition(reduceMotion
                            ? .opacity
                            : .asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
            }
            .foregroundStyle(l.fg)
            .padding(.horizontal, 18).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background {
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(l.fill)
                    if let p = l.progress {
                        GeometryReader { g in
                            Rectangle().fill(Self.outRed.opacity(0.22))
                                .frame(width: g.size.width * min(1, max(0, p)))
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .overlay {
                // The celebration the web has always had, kept inside the button it belongs to.
            }
            .shadow(color: l.enabled || flow != nil ? l.fill.opacity(0.35) : .clear, radius: 12, y: 6)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressDownStyle(reduceMotion: reduceMotion))
        .disabled(!l.enabled)
        .modifier(ShakeEffect(animatableData: shakes))
        .animation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.82), value: l.key)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.subtitle.map { "\(l.title). \($0)" } ?? l.title)
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private func buttonIcon(_ icon: Look.Icon) -> some View {
        switch icon {
        case .symbol(let name):
            Image(systemName: name).font(.system(size: 18, weight: .bold))
        case .spinner:
            ProgressView().tint(.white)
        case .ring:
            if reduceMotion { ProgressView().tint(.white) } else { SpinningRing() }
        case .check:
            DrawnCheck(animated: !reduceMotion)
        }
    }

    private func pressed() {
        if let flow {
            switch flow {
            case .failed(let a, _): startCapture(a)                 // retry = a fresh face check
            case .done, .savedOffline: self.flow = nil              // tap to skip the result
            default: break
            }
            return
        }
        switch primary {
        case .checkIn:
            // No check-in without location "Always" + Precise (owner, 28 Sep 2026; remote flag).
            if RemoteConfig.shared.requireAlwaysLocation && !WorkLocationTracker.shared.locationReady {
                WorkLocationTracker.shared.requireAlways()
                return
            }
            startCapture(.checkIn)
        case .checkOut: startCapture(.checkOut)
        default: break
        }
    }

    private func stateLook(_ p: Primary) -> Look {
        switch p {
        case .loading:
            return Look(key: "loading", title: T("Loading…"), icon: .spinner, fill: NX.mutedFg.opacity(0.45), enabled: false)
        case .checkIn:
            return Look(key: "in", title: T("Check in"), subtitle: whereHint,
                        icon: .symbol("arrow.right.to.line"), fill: Self.inGreen, enabled: !busy)
        case .checkOutLocked(let n):
            return Look(key: "out-locked",
                        title: forcePending ? T("Check out the previous day") : T("Check out"),
                        subtitle: String(format: T("Write your reflection first · %d/%d"), n, reflectionMin),
                        icon: .symbol("lock.fill"), fill: NX.muted, fg: NX.mutedFg,
                        progress: Double(n) / Double(reflectionMin), enabled: false)
        case .checkOut:
            return Look(key: "out",
                        title: forcePending ? T("Check out the previous day") : T("Check out"),
                        subtitle: T("Reflection ready ✓"),
                        icon: .symbol("arrow.left.to.line"), fill: Self.outRed, enabled: !busy)
        case .waitingApproval:
            return Look(key: "waiting", title: T("Check-out sent · waiting for approval"),
                        icon: .symbol("hourglass"), fill: amberSurface, fg: amberTitle, enabled: false)
        case .done:
            return Look(key: "done", title: doneLine, subtitle: doneTimes,
                        icon: .symbol("checkmark.seal.fill"), fill: NX.success.opacity(0.14), fg: NX.success, enabled: false)
        }
    }

    private func pressLook(_ f: Flow) -> Look {
        let isIn = f.action == .checkIn
        switch f {
        case .face:
            return Look(key: "face", title: T("Checking your selfie…"), icon: .spinner, fill: NX.violet, enabled: false)
        case .selfieOK:
            return Look(key: "selfie", title: T("Selfie ✓"), icon: .check, fill: NX.violet, enabled: false)
        case .locating:
            return Look(key: "locating", title: T("Finding your location…"), icon: .ring, fill: NX.violet, enabled: false)
        case .located(_, let place, let inside):
            return Look(key: "located", title: place + (inside ? " ✓" : ""),
                        icon: inside ? .check : .symbol("exclamationmark.triangle.fill"),
                        fill: inside ? NX.violet : Color(hex: "#d97706"), enabled: false)
        case .sending(_, let place):
            return Look(key: "sending", title: T("Sending…"), subtitle: place, icon: .spinner, fill: NX.violet, enabled: false)
        case .done(_, let at):
            let when = (isIn ? rec?.checkInAt.flatMap(Self.hhmm) : nil) ?? at
            var title = (isIn ? T("Checked in") : T("Checked out")) + " " + when
            if let extra = successExtra(isIn) { title += " · " + extra }
            return Look(key: "done-\(title)", title: title, icon: .check, fill: NX.success, enabled: true)
        case .savedOffline:
            return Look(key: "offline", title: T("Saved on this phone"),
                        subtitle: T("Sends itself when NEXUS is back"),
                        icon: .symbol("iphone.and.arrow.forward"), fill: Color(hex: "#d97706"), enabled: true)
        case .failed:
            return Look(key: "failed", title: T("Try again"),
                        subtitle: isIn ? T("Check-in failed") : T("Check-out failed"),
                        icon: .symbol("arrow.clockwise"), fill: NX.danger, enabled: !busy)
        }
    }

    /// "on time" / "6 min late" after a check-in, "worked 8h 45m" after a check-out. Only once the
    /// server's copy of the record is back — until then the time alone is the honest answer.
    private func successExtra(_ isIn: Bool) -> String? {
        if isIn {
            guard let r = rec, r.hasCheckedIn else { return nil }
            let late = r.lateMinutes ?? 0
            return late > 0 ? String(format: T("%d min late"), late) : T("on time")
        }
        if let w = workedMinutes(rec), rec?.hasCheckedOut == true { return String(format: T("worked %@"), Self.duration(w)) }
        guard let from = pressedFromCheckIn.flatMap(Self.parseISO) else { return nil }
        let m = Int(Date().timeIntervalSince(from) / 60)
        return m > 0 ? String(format: T("worked %@"), Self.duration(m)) : nil
    }

    private var doneLine: String {
        if rec?.hasCheckedOut != true && queuedCheckOut { return T("Check-out saved on this phone") }
        guard let w = workedMinutes(rec) else { return T("Done for today") }
        return T("Done for today") + " · " + String(format: T("worked %@"), Self.duration(w))
    }
    private var doneTimes: String? {
        guard let i = rec?.checkInAt.flatMap(Self.hhmm), let o = rec?.checkOutAt.flatMap(Self.hhmm) else { return nil }
        return "In \(i) · Out \(o)"
    }
    private func workedMinutes(_ r: AttendanceRecord?) -> Int? {
        if let w = r?.workedMinutes, w > 0 { return w }
        guard let i = r?.checkInAt.flatMap(Self.parseISO), let o = r?.checkOutAt.flatMap(Self.parseISO), o > i else { return nil }
        return Int(o.timeIntervalSince(i) / 60)
    }
    static func duration(_ m: Int) -> String { m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m" }

    /// Under "Check in": where the phone last put you, so the answer to "am I inside?" comes before
    /// the tap rather than after it.
    private var whereHint: String? {
        if today?.noGeofence == true { return T("Check in from anywhere") }
        guard let n = nearby else { return nil }
        return n.inside
            ? String(format: T("At %@"), n.office.name)
            : String(format: T("%@ from %@"), Self.distanceLabel(n.distance), n.office.name)
    }

    /// The approved leave / sick / permit / day off that covers today: the server refuses a
    /// check-in on such a day, so there is no button to press — only the reason there is none.
    private var coveredByRequestCard: some View {
        let type = today?.todayRequest?.type.map(Self.humanize) ?? T("Request")
        return VStack(spacing: 6) {
            Image(systemName: "calendar.badge.checkmark").font(.system(size: 24, weight: .semibold)).foregroundStyle(NX.success)
            Text(T("Your approved request covers today")).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                .multilineTextAlignment(.center)
            Text("\(type) · " + T("No check-in needed — it's already on your record."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16).padding(.horizontal, 14)
        .background(NX.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.success.opacity(0.25)))
    }

    /// What a Mac shows where the attendance button is.
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
            Text(T("Want to check out from here? **A reason is required** — the checkout will wait for board approval."))
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
            ? T("You still have an earlier shift that was never checked out. Tap Check out to close it first — then you can check in again.")
            : T("You still have an earlier shift that was never checked out. Write the daily reflection above first — Check out unlocks at 200 characters.")
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
                // Done sits in the card, beside the count, while typing (owner, 29 Sep 2026): the
                // keyboard toolbar drew an empty glass capsule over the Check out button on iOS 26.
                if reflectionFocused {
                    Button { reflectionFocused = false } label: {
                        Text(T("Done")).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(NX.violet, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .transition(.opacity)
                }
            }
            Text(T("Required before check-out. Tell us what you worked on today."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            TextField(T("Today I worked on…"), text: $reflection, axis: .vertical)
                .focused($reflectionFocused)
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
        if checkedOut { return T("Done for today") }
        if checkedIn { return T("Currently clocked-in") }
        // A Mac cannot check in (the card under the map says so), so its chip must not invite one
        // (UI tour run 14, P-M3).
        // The card under the map already says "Check in from your phone": said once (UI tour run 17,
        // R17-M-11, decision 9), the chip gives the day's state like every other platform.
        #if targetEnvironment(macCatalyst)
        return T("Ready to check in")
        #else
        // Ready only once it is known where the person is: "Ready to check in" beside "Finding you…"
        // contradicted itself (UI tour run 15, Q-IB7).
        if locationFree { return T("Ready to check in") }
        if locationOff { return T("Location is off") }
        if nearby == nil {
            switch locateProblem {
            case .noFix: return T("Location not found")
            case .noOffices: return T("No office set up")
            case nil: return T("Finding your location…")
            }
        }
        return T("Ready to check in")
        #endif
    }
    private var officeSuffix: String { "" }

    // MARK: flow (unchanged logic)

    private func startCapture(_ action: Action) {
        guard !busy else { return }
        banner = nil; flow = nil; pendingAction = action; showCamera = true
    }

    /// Holds a finished step on the button long enough to be read. Short, and shorter still with
    /// Reduce Motion; the steps themselves are real work, this only keeps the ticks from flashing by.
    private func hold(_ f: Flow) async {
        flow = f
        Haptics.tap()
        try? await Task.sleep(nanoseconds: reduceMotion ? 250_000_000 : 450_000_000)
    }

    private func fail(_ action: Action, _ msg: String) {
        Haptics.warning()
        flow = .failed(action, msg)
        if !reduceMotion { withAnimation(.linear(duration: 0.45)) { shakes += 1 } }
        AccessibilityNotification.Announcement(msg).post()
    }

    /// The result stays on the button for a moment, then the button becomes what the day needs next.
    private func settle(after f: Flow, seconds: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        if flow == f { withAnimation { flow = nil } }
    }

    private func submit(selfie: Data) async {
        guard let action = pendingAction else { return }
        busy = true; defer { busy = false }
        pressedFromCheckIn = dispRec?.checkInAt
        // A selfie with no face in it is not an attendance photo. Checked on the phone, before the
        // location fix and before anything is uploaded, so a photo of the wall costs one retake and
        // never reaches the record.
        flow = .face(action)
        switch await FaceGuard.check(selfie) {
        case .ok: break
        case .noFace:
            fail(action, T("No face in the photo. Take the selfie with your face clearly visible, then try again."))
            return
        case .unreadable:
            fail(action, T("That photo couldn't be read. Take it again."))
            return
        }
        await hold(.selfieOK(action))
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
            let place = placeLine(for: fix)
            await hold(.located(action, place.text, place.inside))
            flow = .sending(action, place.text)
            let outcome: AttendanceOutcome = try await {
                switch action {
                case .checkIn: return try await APIClient.shared.checkIn(lat: fix.latitude, lng: fix.longitude, selfie: selfie, fix: fix, clientId: tapId)
                case .checkOut: return try await APIClient.shared.checkOut(lat: fix.latitude, lng: fix.longitude, selfie: selfie, reflection: reflection, fix: fix, clientId: tapId)
                }
            }()
            switch outcome {
            case .success:
                Haptics.success()
                let done = Flow.done(action, Self.clock())
                withAnimation { flow = done }
                AccessibilityNotification.Announcement(action == .checkIn ? T("Checked in") : T("Checked out")).post()
                if action == .checkOut { reflection = "" }
                // The time is on the button at once; "on time" / "6 min late" / "worked 8h 45m"
                // joins it when the server's copy of the record lands.
                await load()
                Task { await settle(after: done, seconds: 2.6) }
            case .outsideRadius:
                Haptics.warning()
                flow = nil
                offsiteReason = ""; showOffsite = true
            }
        } catch LocationManager.LocationError.denied {
            // Not a failure to retry: nothing will change until the switch in Settings does.
            fail(action, LocationManager.LocationError.denied.errorDescription ?? T("Location permission denied."))
            locationOff = true
            deniedPermission = .location
        } catch APIError.unauthorized { flow = nil; auth.logout() }
        catch APIError.offline {
            // The server was unreachable, so nothing was recorded there. Keep the tap instead of
            // losing it: attendance is the one thing that cannot be re-created honestly later.
            // Only this error queues — anything the server actually answered must not be replayed.
            guard let fix = pendingCoords else {
                fail(action, T("No connection, and no location fix to save with."))
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
            let saved = Flow.savedOffline(action, Self.clock())
            withAnimation { flow = saved }
            AccessibilityNotification.Announcement(T("Saved on this phone") + ". " + T("Sends itself when NEXUS is back")).post()
            if action == .checkOut { reflection = "" }
            Task { await settle(after: saved, seconds: 4) }
        }
        catch APIError.upgradeRequired(let why) {
            // The server refused this BUILD before looking at the tap, so nothing was recorded.
            // Kept exactly like an offline tap (same id, the time tapped, the evidence captured
            // now) and sent by the updated build — otherwise somebody who taps at 09:00, updates,
            // and taps again at 09:06 is late for a reason that was never theirs. The update cover
            // replaces this screen and the queue raises the "saved on this phone" popup on it.
            guard let fix = pendingCoords else {
                fail(action, why)
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
            // The server's own sentence ("You're outside the allowed attendance radius for …"),
            // under the button, with the button itself turned into the retry.
            fail(action, (error as? LocalizedError)?.errorDescription ?? T("Failed."))
        }
    }

    private func submitOffsite() async {
        guard let selfie = pendingSelfie, let coords = pendingCoords else { return }
        busy = true; defer { busy = false }
        let tapId = UUID().uuidString
        let reason = offsiteReason.trimmingCharacters(in: .whitespaces)
        flow = .sending(.checkOut, T("Outside the office · with your reason"))
        do {
            let outcome = try await APIClient.shared.checkOut(lat: coords.lat, lng: coords.lng, selfie: selfie,
                                                              reflection: reflection, offsite: true,
                                                              reason: reason,
                                                              fix: pendingFix, clientId: tapId)
            if case .success = outcome {
                Haptics.success()
                banner = Banner(text: T("Checkout sent — waiting for board approval ⏳"), good: true)
                reflection = ""
                await load()
                // The button itself now reads "Check-out sent · waiting for approval".
                withAnimation { flow = nil }
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
            let saved = Flow.savedOffline(.checkOut, Self.clock())
            withAnimation { flow = saved }
            reflection = ""
            showOffsite = false
            Task { await settle(after: saved, seconds: 4) }
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
            fail(.checkOut, (error as? LocalizedError)?.errorDescription ?? T("Failed."))
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
        AttendancePresence.refresh(today: today, userName: auth.session?.userName, heardAt: cachedFrom)
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
    /// The clock card's day: "Thursday 15 Oct", no comma, no year for this year (UI tour run 16, decision 10).
    static func dateLabel(_ d: Date) -> String {
        AppDateLocale.weekdayDate(d)
    }
    static func parseISO(_ iso: String) -> Date? {
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
    }
    static func hhmm(_ iso: String) -> String? {
        guard let date = parseISO(iso) else { return nil }
        let o = DateFormatter(); o.dateFormat = "HH:mm"; o.timeZone = TimeZone(identifier: "Asia/Jakarta"); return o.string(from: date)
    }
}

// MARK: - Pieces of the attendance button

/// One horizontal shake per whole step of `animatableData` — the "no" of a failed press.
private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 8 * sin(animatableData * .pi * 6), y: 0))
    }
}

/// The button sinks a little under the finger. Nothing moves with Reduce Motion.
private struct PressDownStyle: ButtonStyle {
    let reduceMotion: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// "Finding your location…": an open ring turning while the phone waits for a fix.
private struct SpinningRing: View {
    @State private var turning = false
    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.25), lineWidth: 3)
            Circle().trim(from: 0, to: 0.3)
                .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(turning ? 360 : 0))
        }
        .padding(2)
        .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { turning = true } }
    }
}

/// A tick that draws itself; with Reduce Motion it is simply there.
private struct DrawnCheck: View {
    let animated: Bool
    @State private var drawn: CGFloat = 0
    var body: some View {
        ZStack {
            Circle().fill(.white.opacity(0.22))
            CheckShape().trim(from: 0, to: animated ? drawn : 1)
                .stroke(.white, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                .padding(6)
        }
        .onAppear { if animated { withAnimation(.easeOut(duration: 0.35)) { drawn = 1 } } }
    }
    private struct CheckShape: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.minX + r.width * 0.12, y: r.midY + r.height * 0.02))
            p.addLine(to: CGPoint(x: r.minX + r.width * 0.40, y: r.maxY - r.height * 0.14))
            p.addLine(to: CGPoint(x: r.maxX - r.width * 0.08, y: r.minY + r.height * 0.16))
            return p
        }
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
                // A fixed gap: a Spacer grew with the card on the Mac and left the icon far above its
                // label (UI tour run 13, M-19); the spare height now sits under the text.
                .padding(.bottom, 10)
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
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(13)
        // Fills the Grid row (both cards as tall as the taller one).
        .frame(maxHeight: .infinity, alignment: .top)
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

/// Today's cell of somebody who is outside the office right now (owner, 8 Oct 2026; the web board
/// draws the same amber bar). Not colour alone: a walking figure in the corner carries it too, and
/// VoiceOver reads "Budi, Outside the office since 10:12". Nothing at all when `since` is nil.
struct OutsideNowMark: ViewModifier {
    let since: Date?
    let name: String
    var cell: CGFloat = 24

    @ViewBuilder func body(content: Content) -> some View {
        if let since {
            content
                .overlay(alignment: .bottom) {
                    Capsule().fill(NX.warning).frame(width: cell * 0.5, height: 3).padding(.bottom, 2)
                }
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: cell * 0.3, weight: .bold))
                        .foregroundStyle(NX.ink)
                        .frame(width: cell * 0.5, height: cell * 0.5)
                        .background(NX.warning, in: Circle())
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "\(name), \(Self.label(since))"))
        } else {
            content
        }
    }

    /// "Outside the office since 10:12", on the office clock.
    static func label(_ since: Date) -> String {
        String(format: T("Outside the office since %@"), ProjDate.fmt("HH:mm").string(from: since))
    }
}

struct StreakBoardCard: View {
    let canManage: Bool
    /// A manager with direct reports: the server scopes the workspace board to them (and, since
    /// 21 Sep 2026, to the manager too). Without this the card asked for `scope=me` and a manager
    /// never saw their people's month on the phone.
    var canReview: Bool = false
    /// Whether the permissions above are known yet (the screen's /attendance/today has answered or
    /// failed). Until then the board does not load: a `scope=me` fetch made on the default `false`
    /// permissions used to finish — or fall back to its cached copy — after the crew board, and a
    /// BoD's board shrank to their own row (UI tour run 14, N-04 / P-I4 / P-M4).
    var ready: Bool = true
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
    /// Built once per load, not per read. It used to be a computed property — a `Dictionary(grouping:)`
    /// plus a `localizedCaseInsensitiveCompare` sort (ICU collation, the slowest comparator Foundation
    /// has) — and `body` reads it three times: the empty check, the name column and the cell grid.
    @State private var members: [Member] = []
    /// The board's name filter (the web board's Search; UI tour run 15, Q-IB8).
    @State private var query = ""
    /// iPad / Mac, as the web board (UI tour run 15, Q-IB8): Board or Log, the viewer's own record, and each
    /// person's day-off and XP pills from /api/attendance/deductions (managers only, as on the web).
    @State private var showLog = false
    @State private var showMyRecord = false
    @State private var deductions: [String: AttendanceDeductionsSummary.Member] = [:]
    @Environment(AppRouter.self) private var router
    private var webTools: Bool { hSize == .regular && wide }
    private var shownMembers: [Member] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return members }
        return members.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }
    @State private var cachedFrom: Date?
    @State private var loading = true
    @State private var selectedRow: AttendanceRow?   // BoD taps a cell → record actions (delete / clear check-out)
    @State private var monthOffset = 0               // 0 = this month; ◀ ▶ to reach past months
    /// Who is outside the office right now is live (owner, 8 Oct 2026): the current period is read
    /// again every minute while the board is on screen and the app is in front, and on coming back.
    @Environment(\.scenePhase) private var scenePhase
    @State private var appActive = true
    /// The day whose open records may carry the "outside right now" mark: today, and only while what
    /// is drawn came from the server — a copy off the disk cannot say where anybody is now.
    private var outsideKey: String? { cachedFrom == nil ? todayKey : nil }

    private let cell: CGFloat = 24
    /// A day's width: 24 pt, or wider when the strip has room for the whole period, so an iPad or Mac
    /// shows every day of it instead of cutting the last one at the edge ("MO 26", UI tour run 14,
    /// P-M11). Rows keep their 24 pt height.
    private var cellW: CGFloat {
        guard stripWidth > 0, periodDays.count > 1 else { return cell }
        let n = CGFloat(periodDays.count)
        // iPad / Mac: a day may narrow to 20 pt so the whole period fits, as on the web; at 24 pt a 13" iPad
        // missed by a few points and opened mid-period with a cut column at each edge (UI tour run 15, Q-IB21).
        // 16 pt since run 16 (R16-M-14): a default Mac window missed the whole 28 Sep – 27 Oct period by three
        // days at 18.
        let least: CGFloat = hSize == .regular ? 16 : cell
        return min(40, max(least, ((stripWidth - gap * (n - 1)) / n).rounded(.down)))
    }
    private let gap: CGFloat = 3
    /// The strip's width rounded down to whole days, while the period does not fit; nil = all the room.
    private var wholeDaysWidth: CGFloat? {
        guard stripWidth > 0, periodDays.count > 1 else { return nil }
        let step = cellW + gap
        let fit = Int((stripWidth + gap) / step)
        guard fit > 0, fit < periodDays.count else { return nil }
        return CGFloat(fit) * step - gap
    }
    @Environment(\.horizontalSizeClass) private var hSize
    /// Wide enough that "Muhammad …" rows can be told apart (UI tour run 13, F-16 / I-24: 76 pt cut every
    /// name to about ten characters); more on an iPad or Mac, where the board has room.
    /// 190 on iPad / Mac: full names, as the web's board, where 150 turned them into "Irvandes Hasri Ilham M."
    /// (UI tour run 16, R16-B-24).
    private var nameW: CGFloat { hSize == .regular ? 190 : 104 }

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
    /// The visible width of the scrolling day strip (whole-day alignment, scrollToToday).
    @State private var stripWidth: CGFloat = 0
    /// The day at the strip's left edge ("day-yyyy-MM-dd"), kept by identity (`alignLeadDay`).
    @State private var leadDay: String?

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
        /// The last working day of someone who left the company (offboarding, 8 Oct 2026): the board
        /// keeps them for the periods they were part of, marked "Left · 10 Oct".
        var leftAt: String? = nil
        /// What the Score is out of, from the server (QA S-20): nil from an older server.
        var owed: AttendanceOwed? = nil
        /// Days worked in the period: a check-in, an approved permit or WFH — everything green or blue.
        var workedDays: Int { cells.values.filter { $0 == .present || $0 == .permit || $0 == .wfh }.count }
    }
    /// The period's working days: its calendar days minus the weekly-rest quota (4 by default), so 31
    /// days give 27 and 30 give 26 — the web board's Score column uses the same rule.
    static func workingDays(_ periodDays: Int, dayOffQuota: Int = 4) -> Int { max(0, periodDays - dayOffQuota) }
    /// The Score's target for one person: the server's `owed` (someone who joined mid-period owes only the
    /// days from their start, prorated allowance — the record's rule), else the whole period minus the quota.
    static func scoreTarget(_ m: Member, periodDays: Int) -> Int {
        m.owed?.working ?? workingDays(periodDays, dayOffQuota: m.quota)
    }
    /// "22/22 +3": capped at the working days with the surplus beside it, as on the web. A day cut from
    /// the quota for being >120 min late is still a day worked, so worked can exceed the target.
    static func scoreText(worked: Int, target: Int) -> Text {
        let base = Text("\(min(worked, target))/\(target)")
        guard worked > target else { return base }
        return base + Text(" +\(worked - target)").foregroundColor(NX.success)
    }
    private static func buildMembers(_ rows: [AttendanceRow], roster: [AttendanceHistoryResponse.RosterEntry]? = nil) -> [Member] {
        let groups = Dictionary(grouping: rows) { $0.user?.id ?? "me" }
        var members = groups.map { uid, rs -> Member in
            var cells: [String: AttTone] = [:]
            var rowByDay: [String: AttendanceRow] = [:]
            for r in rs { if let k = Self.dayKey(r.attendanceDate) { cells[k] = AttTone.of(r); rowByDay[k] = r } }
            return Member(id: uid, name: rs.first?.user?.name ?? T("You"), cells: cells, rowByDay: rowByDay,
                          quota: rs.compactMap { $0.user?.dayOffQuota }.first ?? 4,
                          leftAt: rs.compactMap { $0.user?.leftAt }.first,
                          owed: rs.compactMap { $0.user?.owed }.first ?? roster?.first(where: { $0.id == uid })?.owed)
        }
        // Everyone the server lists for the board gets a line, rows or not: on the first day of a
        // period most of the crew has no row yet, and the board used to show only a handful of names.
        for person in roster ?? [] where groups[person.id] == nil {
            members.append(Member(id: person.id, name: person.name ?? T("Unknown"), cells: [:], rowByDay: [:],
                                  quota: person.dayOffQuota ?? 4, leftAt: person.leftAt, owed: person.owed))
        }
        return members.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
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
    /// Since when this person has been outside the office, while they still are: TODAY's record, not
    /// checked out, with the server's `outsideSince` — the web board's test. nil for every other cell
    /// (`todayKey` nil = the board is not showing a live today).
    static func outsideSince(_ row: AttendanceRow?, dayKey: String, todayKey: String?) -> Date? {
        guard let todayKey, dayKey == todayKey, let row, row.checkOutAt == nil else { return nil }
        return ProjDate.parse(row.outsideSince)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(wide ? T("Attendance board") : T("Your attendance history")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    // The month alone: today is the highlighted column of the date row (run 14, N-34 read
                    // "October 2026 · today 15" as odd).
                    Text(monthLabel.capitalized)
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    // The window this board actually covers — payroll counts 28→27, and the board
                    // used to name only the month it ended in.
                    Text(periodLabel)
                        .font(NXFont.text(10)).foregroundStyle(NX.mutedFg.opacity(0.85)).lineLimit(1)
                    // Who the board covers: a manager's board is their team only, which looked like the
                    // whole company's had shrunk to one row (UI tour run 13, F-15).
                    // The BoD's board names its scope too, so a board of one is never a puzzle (run 14, N-04).
                    if wide {
                        Text(canManage ? T("Everyone in the workspace") : T("You and your direct reports"))
                            .font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer()
                HStack(spacing: 2) {
                    Button { showFull = true } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30)
                            .touchTarget44(drawn: 30)
                    }
                    .accessibilityLabel(T("Open the full board"))
                    .fullScreenCover(isPresented: $showFull) {
                        FullBoard(members: shownMembers, periodDays: periodDays, monthLabel: "\(monthLabel.capitalized) · \(periodLabel)", todayKey: todayKey,
                                  outsideKey: outsideKey, canManage: canManage, legend: AnyView(legend),
                                  refresh: { await liveRefresh() }) { await load() }
                    }
                    if wide {
                        Button { Task { await exportMonth() } } label: {
                            if exporting { ProgressView().scaleEffect(0.7).frame(width: 30, height: 30).touchTarget44(drawn: 30) }
                            else {
                                // Named, as the web's "Export" (UI tour run 16, R16-B-24: bare icons), with the
                                // download tray the other downloads use (run 17, iPad R17-I-18), and never cut to
                                // "Exp…" beside the title on a phone (run 17, iPhone R17-I-05).
                                Label(T("Export"), systemImage: "tray.and.arrow.down")
                                    .labelStyle(ExportLabelStyle(iconOnly: hSize == .compact))
                                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                                    .lineLimit(1).fixedSize()
                                    .padding(.horizontal, 10).frame(height: 30)
                                    .overlay(Capsule().strokeBorder(NX.border))
                                    .frame(minHeight: 44).contentShape(Rectangle())
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 4)
                        .disabled(exporting)
                        .accessibilityLabel(T("Export this month as a spreadsheet"))
                        .sheet(item: $exportItem) { item in ActivityView(items: [item.url]) }
                        .alert(T("Export failed"), isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
                            Button("OK") { exportError = nil }
                        } message: { Text(exportError ?? "") }
                    }
                    Button { monthOffset -= 1 } label: { Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.foreground).frame(width: 30, height: 30).touchTarget44(drawn: 30) }
                    Button { if monthOffset < 0 { monthOffset += 1 } } label: { Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(monthOffset < 0 ? NX.foreground : NX.mutedFg.opacity(0.4)).frame(width: 30, height: 30).touchTarget44(drawn: 30) }.disabled(monthOffset >= 0)
                }
            }
            legend
            if webTools {
                // The web board's toolbar: Board / Log, Search, My record.
                HStack(spacing: 10) {
                    Picker(T("Attendance view"), selection: $showLog) {
                        Text(T("Board")).tag(false)
                        Text(T("Log")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                    if members.count > 8 { searchField.frame(maxWidth: 320) }
                    Spacer(minLength: 0)
                    Button { showMyRecord = true } label: {
                        Text(T("My record")).font(NXFont.text(13, .semibold))
                    }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                }
            } else if wide && members.count > 8 { searchField }
            // The spinner only while there is nothing to show yet. A reload (the permissions landing
            // after the first paint, an attendance change, the minute's refresh) keeps the grid: tearing
            // it down rebuilt the scroll view at the 28th, after it had already been brought to today —
            // the board "always" opened on the period's first day (owner, 9 Oct 2026).
            if loading && members.isEmpty {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if members.isEmpty {
                EmptyState(icon: "calendar", title: T("No attendance this month yet"),
                           subtitle: wide
                               ? T("Nobody has checked in this month yet. The first check-in fills the first cell; use the arrows to look at earlier months.")
                               : T("Your check-ins fill this board day by day — green for present, purple for a day off, red for a missed day. Check in from the card above."),
                           compact: true)
            } else if webTools && showLog {
                logList
            } else {
                grid
            }
            if let cachedFrom { OfflineNotice(savedAt: cachedFrom) }
        }
        .nexusCard()
        // Keyed on the permissions too: /attendance/today lands AFTER the first paint, and a board
        // fetched with `scope=me` before canManage flipped stayed that way until the month changed.
        .task(id: "\(monthOffset)|\(wide)|\(ready)") {
            guard ready else { return }
            let days = buildPeriodDays()
            if days.first?.key != periodDays.first?.key { members = [] }
            periodDays = days
            await load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusAttendanceChanged)) { _ in
            if ready { Task { await load() } }
        }
        // Every minute while on screen; cancelled with the view. The full-screen board, while it is
        // up, keeps its own minute instead (`FullBoard`).
        .task { await liveRefreshLoop() }
        .onChange(of: scenePhase) { _, phase in
            appActive = phase == .active
            if phase == .active, !showFull { Task { await liveRefresh() } }
        }
        .sheet(item: $selectedRow) { row in
            RecordActionsSheet(row: row, canDelete: canManage, canChangeStatus: canManage) { await load() }
        }
        .fullScreenCover(isPresented: $showMyRecord) {
            NavigationStack {
                MemberProfileView(target: ProfileTarget(userId: auth.session?.userId ?? "", name: auth.session?.userName, avatar: nil))
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { showMyRecord = false } } }
            }
            .environment(auth).environment(router)
        }
        .task(id: "\(monthKey)|\(canManage)|\(webTools)") {
            guard canManage, webTools else { return }
            if let r = try? await APIClient.shared.attendanceDeductionsSummary(month: monthKey) {
                deductions = Dictionary(r.members.map { ($0.userId, $0) }, uniquingKeysWith: { a, _ in a })
            }
        }
    }

    private func liveRefreshLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
            if Task.isCancelled { return }
            guard appActive, !showFull else { continue }
            await liveRefresh()
        }
    }

    /// The current period read again in the background — no spinner, nothing cleared, and a failure
    /// leaves the board as it was. A past month does not change by the minute, and a load already
    /// under way is not doubled.
    private func liveRefresh() async {
        guard monthOffset == 0, !loading, ready else { return }
        await load(silent: true)
    }

    /// Where the days' scroll view opens (see `grid`): today's place along the period, from 0 on its
    /// first day to 1 on its last. `defaultScrollAnchor` lines that point of the row up with the same
    /// point of the visible strip, which puts today's column at that fraction of the strip — fully
    /// inside it on every day of the period, near the left on the 28th and near the right on the
    /// 27th. Pure arithmetic on what is already known, so it holds on the first frame. A past period
    /// opens on its first day.
    private var daysAnchor: UnitPoint {
        guard let t = todayKey, periodDays.count > 1,
              let i = periodDays.firstIndex(where: { $0.key == t }) else { return .leading }
        return UnitPoint(x: CGFloat(i) / CGFloat(periodDays.count - 1), y: 0.5)
    }

    /// Tried again as the layout settles: a single call made before the scroll view has its
    /// size scrolls nowhere and says nothing.
    ///
    /// Centring today left a half day at the strip's left edge, its date cut in two (UI tour run 9: I10 on
    /// the phone, M5 on the Mac). With the strip's width known, the scroll now lines a WHOLE day up with
    /// the left edge, chosen so today still sits in the middle; before the width is known it centres.
    /// Puts a whole day flush with the strip's left edge: the one that centres today, or the period's first.
    private func alignLeadDay() {
        guard !periodDays.isEmpty else { return }
        let key = todayKey.flatMap { leadingDayKey(today: $0) } ?? (wholeDaysWidth == nil ? periodDays[0].key : nil)
        if let key, leadDay != "day-\(key)" { leadDay = "day-\(key)" }
    }

    private func scrollToToday(_ proxy: ScrollViewProxy) {
        alignLeadDay()
        guard let t = todayKey else { return }
        Task { @MainActor in
            for delay in [0, 150, 500] {
                if delay > 0 { try? await Task.sleep(for: .milliseconds(delay)) }
                if let lead = leadingDayKey(today: t) {
                    proxy.scrollTo("day-\(lead)", anchor: .leading)
                } else {
                    proxy.scrollTo("day-\(t)", anchor: .center)
                }
            }
        }
    }

    /// The day to put flush with the strip's left edge so today lands mid-strip; nil while the strip's
    /// width is unknown or the whole period fits.
    private func leadingDayKey(today: String) -> String? {
        guard stripWidth > 0, let i = periodDays.firstIndex(where: { $0.key == today }) else { return nil }
        let fit = Int((stripWidth + gap) / (cellW + gap))
        guard fit > 0, fit < periodDays.count else { return nil }
        let lead = min(max(0, i - fit / 2), periodDays.count - fit)
        return periodDays[lead].key
    }

    private var legend: some View {
        HStack(spacing: 10) {
            ForEach([AttTone.present, .leave, .sick, .dayoff, .absent], id: \.label) { t in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3).fill(t.color).frame(width: 11, height: 11)
                    // The legend names the kind, plural like the web's ("Days off"); a cell says "Day off".
                    Text(t == .dayoff ? T("Days off") : t.label).font(NXFont.text(9, .medium)).foregroundStyle(NX.mutedFg)
                }
            }
            // The web's two marks on a cell (iPad / Mac, where the legend has the room).
            if webTools {
                Label(T("Web check-in"), systemImage: "globe").font(NXFont.text(9, .medium)).foregroundStyle(NX.mutedFg)
                Label(T("Location off"), systemImage: "location.slash").font(NXFont.text(9, .medium)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    /// The month as a list, newest first (the web board's Log): who, the day, the status, in and out.
    private struct LogEntry {
        let member: Member
        let day: String
        let row: AttendanceRow
    }

    private var logEntries: [LogEntry] {
        var out: [LogEntry] = []
        for m in shownMembers {
            for (day, row) in m.rowByDay where row.checkInAt != nil || row.attendanceDayType != nil || row.status != nil {
                out.append(LogEntry(member: m, day: day, row: row))
            }
        }
        out.sort { a, b in a.day != b.day ? a.day > b.day : a.member.name < b.member.name }
        return out
    }

    private var logList: some View {
        let entries = logEntries
        return VStack(spacing: 0) {
            if entries.isEmpty {
                Text(T("No attendance this month yet")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(.vertical, 12)
            }
            ForEach(Array(entries.prefix(300).enumerated()), id: \.offset) { i, e in
                Button { selectedRow = e.row } label: {
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 3).fill((e.member.cells[e.day] ?? .none).color).frame(width: 10, height: 10)
                        Text(e.member.name).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                            .frame(width: 200, alignment: .leading)
                        Text(ProjDate.fmt("yyyy-MM-dd").date(from: e.day).map { AppDateLocale.weekdayDate($0, timeZone: nil) } ?? e.day)
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        Spacer(minLength: 8)
                        Text((e.member.cells[e.day] ?? .none).label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        Text("\(e.row.checkInAt.flatMap(Self.logTime) ?? "--:--") – \(e.row.checkOutAt.flatMap(Self.logTime) ?? "--:--")")
                            .font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.foreground)
                            .frame(width: 100, alignment: .trailing)
                        Self.trackingMark(e.row)
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if i < min(entries.count, 300) - 1 { Divider() }
            }
        }
    }

    private static func logTime(_ iso: String) -> String? {
        ProjDate.parse(iso).map { ProjDate.fmt("HH:mm").string(from: $0) }
    }

    /// The web's mark for a record checked in from a browser (location not tracked) or with location off.
    @ViewBuilder static func trackingMark(_ row: AttendanceRow?) -> some View {
        switch row?.locationTrackingState {
        case "web":
            Image(systemName: "globe").font(.system(size: 8, weight: .bold)).foregroundStyle(Color(hex: "#0284c7"))
                .accessibilityLabel(T("Web check-in · location not tracked"))
        case "denied":
            Image(systemName: "location.slash").font(.system(size: 8, weight: .bold)).foregroundStyle(NX.mutedFg)
                .accessibilityLabel(T("Location off"))
        default:
            EmptyView()
        }
    }

    /// The web board's name search, for a board of the whole team (UI tour run 15, Q-IB8).
    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
            TextField(T("Search…"), text: $query)
                .font(NXFont.text(14)).textFieldStyle(.plain)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                    .buttonStyle(.plain).accessibilityLabel(T("Clear"))
            }
        }
        .padding(.horizontal, 10).frame(minHeight: 36)
        .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
    }

    /// Date row: weekday over day number.
    private let headerH: CGFloat = 30
    private let scoreW: CGFloat = 48
    /// The gutter between the names and the first day, and between the last day and the Score.
    private let lane: CGFloat = 6
    /// Names on the left and Score on the right stay put; only the date row and the cells scroll
    /// across, together, so a date always sits over its dots. Down is the page's own scroll, from
    /// anywhere on the board. (28 Sep 2026: a 2-D scroll view with hand-offset "frozen panes" lost
    /// the names off-screen and parked the Score column in the middle of the grid on the owner's
    /// phone — the offset it relied on never updated after the programmatic scroll to today. The
    /// full-screen board is where the whole month and its dates stay in view at once.)
    /// Plain stacks throughout: lazy ones inside a scroll view left whole rows empty.
    private var grid: some View {
        HStack(alignment: .top, spacing: lane) {
            VStack(alignment: .leading, spacing: gap) {
                Color.clear.frame(width: nameW, height: headerH)
                nameColumn
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: gap) {
                        dateRow
                            .background(NX.card)
                            // Sticky under the page's top edge while the rows scroll by, as the web keeps MEMBER /
                            // days / SCORE: thirty rows down nobody could tell which column was which day (UI
                            // tour run 17, iPhone R17-I-05).
                            .modifier(StickyInPageScroll(limit: CGFloat(shownMembers.count) * (cell + gap) - headerH))
                            .zIndex(1)
                        cells
                    }
                }
                // Comes to rest on a whole day (the date row is the scroll-target layout), and the edges
                // fade where more days lie, so a cut column reads as "scroll for more" instead of a
                // clipped "ION 28" (UI tour run 11: IP-10, MC-11).
                .scrollTargetBehavior(.viewAligned)
                .nxEdgeFade(8)
                // Opens on today, not on the 28th: the column that matters is the one being filled in
                // (owner, 8 and 9 Oct 2026: "rata kiri", three times). Scrolling there after the fact
                // — timed tries, then measuring where today's column was — never held on the phone, so
                // the scroll view now STARTS there: its initial position comes from `daysAnchor`, not
                // from anything that has to happen after layout. The tries below only centre it.
                .defaultScrollAnchor(daysAnchor)
                // The day flush with the strip's left edge, by identity: the strip changes width after the
                // first scroll (the members, then the iPad / Mac pills column load and the day width follows),
                // and a position kept in points then sat mid-day, so both edges cut a column ("N" of SUN 11,
                // "MO 2("; UI tour run 17, iPhone R17-I-05 / R17-I-12, iPad R17-I-07, Mac R17-M-05).
                .scrollPosition(id: $leadDay, anchor: .leading)
                // Exactly as wide as the whole days that fit: with the scroll resting on a day, neither edge
                // ever cuts one ("TU…" at the right, a sliver at the left; UI tour run 16, R16-I-17 /
                // R16-M-14). The width is measured outside this frame, on the room the board leaves.
                .frame(width: wholeDaysWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { stripWidth = $0 }
                // One scroll view per period, so another month opens from its own anchor.
                .id(monthOffset)
                .onAppear { scrollToToday(proxy) }
                .onChange(of: stripWidth) { _, _ in alignLeadDay() }
                .onChange(of: periodDays) { _, _ in alignLeadDay() }
            }
            VStack(alignment: .trailing, spacing: gap) {
                Text(T("Score")).font(.system(size: 8, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: scoreW, height: headerH, alignment: .bottomTrailing)
                scoreColumn
            }
            // The web board's per-person pills, "0/4 days off" and "−590 XP" (managers, iPad / Mac; Q-IB8).
            if webTools && !deductions.isEmpty {
                VStack(alignment: .leading, spacing: gap) {
                    Color.clear.frame(width: 150, height: headerH)
                    ForEach(shownMembers) { m in
                        HStack(spacing: 4) {
                            if let d = deductions[m.id] {
                                Self.pill(T("{left}/{quota} days off").replacingOccurrences(of: "{left}", with: AppNumber.int(d.remaining))
                                            .replacingOccurrences(of: "{quota}", with: AppNumber.int(d.quota)),
                                          tone: d.remaining == 0 ? NX.danger : d.remaining <= 1 ? NX.warning : NX.mutedFg)
                                if let xp = d.xp {
                                    Self.pill("\(xp.score < 0 ? "−" : "")\(AppNumber.int(abs(xp.score))) XP",
                                              tone: xp.score < 0 ? NX.danger : xp.score > 1000 ? NX.success : NX.mutedFg)
                                }
                            }
                        }
                        .frame(width: 150, height: cell, alignment: .leading)
                    }
                }
            }
        }
    }

    private static func pill(_ text: String, tone: Color) -> some View {
        Text(text).font(NXFont.text(9, .bold)).monospacedDigit().foregroundStyle(tone)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(tone.opacity(0.12), in: Capsule())
            .lineLimit(1).fixedSize()
    }

    private var dateRow: some View {
        HStack(spacing: gap) {
            ForEach(periodDays) { pd in
                let isToday = pd.key == todayKey
                // Two readable lines as on the web, 9 and 11 pt (they were 7 and 8; UI tour run 17, R17-B-11).
                // A narrow day takes the weekday's first two letters rather than shrinking it.
                VStack(spacing: 1) {
                    Text(cellW < 24 ? String(pd.weekdayLabel.prefix(2)) : pd.weekdayLabel)
                        .font(.system(size: 9, weight: isToday ? .bold : .medium))
                        .foregroundStyle(isToday ? NX.violetText : NX.mutedFg)
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Text("\(pd.day)").font(.system(size: 11, weight: isToday ? .bold : .medium))
                        .foregroundStyle(isToday ? Color.white : NX.foreground.opacity(0.75))
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .frame(width: max(cellW, 18), height: 15)
                        .background(isToday ? NX.violet : Color.clear, in: Capsule())
                }
                .frame(width: cellW, height: headerH)
                .id("day-\(pd.key)")
                // Where the month turns over, so 31 followed by 1 reads as a new
                // month rather than as a gap.
                .overlay(alignment: .leading) {
                    if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: headerH).offset(x: -gap / 2) }
                }
            }
        }
        .scrollTargetLayout()
    }

    private var nameColumn: some View {
        VStack(alignment: .leading, spacing: gap) {
            ForEach(shownMembers) { m in
                Self.nameLabel(m).frame(width: nameW, height: cell, alignment: .leading)
            }
        }
    }

    /// The name, and under it, for someone who left the company, a muted "Left · 10 Oct" (offboarding,
    /// 8 Oct 2026). Two short lines fit a row; the name keeps its size so the column stays even.
    /// The full name, then shorter forms of it: the words after the first become initials one by
    /// one from the end ("Muhammad Alvar Pratama" → "Muhammad Alvar P." → "Muhammad A. P.").
    static func nameVariants(_ name: String) -> [String] {
        let words = name.split(separator: " ").map(String.init)
        guard words.count > 1 else { return [name] }
        var out = [name]
        var parts = words
        for i in stride(from: parts.count - 1, through: 1, by: -1) {
            if let c = parts[i].first { parts[i] = "\(c.uppercased())." }
            out.append(parts.joined(separator: " "))
        }
        return out
    }

    static func nameLabel(_ m: Member) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // One size for every row (run 14, N-05 / P-I23: a shrink-to-fit name came out in three sizes
            // and was still cut). A name too long for the column keeps its first word and turns the
            // rest into initials ("Ashley K. A."); only a name that still does not fit is cut.
            ViewThatFits(in: .horizontal) {
                ForEach(Array(nameVariants(m.name).enumerated()), id: \.offset) { _, v in
                    Text(v).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                }
                Text(m.name).lineLimit(1)
            }
            .font(NXFont.text(11, .medium)).foregroundStyle(NX.foreground)
            .accessibilityElement(children: .ignore).accessibilityLabel(m.name)
            if m.leftAt != nil {
                Text(LeftTag.label(m.leftAt)).font(NXFont.text(7, .semibold)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    .accessibilityLabel(LeftTag.accessibilityText(m.leftAt))
            }
        }
    }

    private var scoreColumn: some View {
        VStack(alignment: .trailing, spacing: gap) {
            ForEach(shownMembers) { m in
                Self.scoreText(worked: m.workedDays, target: Self.scoreTarget(m, periodDays: periodDays.count))
                    .font(NXFont.text(10, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: scoreW, height: cell, alignment: .trailing)
            }
        }
    }

    /// Plain stacks, every row and every day built — see `grid` for why not lazy ones. Nothing in
    /// here reads the scroll offset, so scrolling never rebuilds a row.
    private var cells: some View {
        let nowKey = ProjDate.fmt("yyyy-MM-dd").string(from: Date())
        let liveKey = outsideKey
        return VStack(alignment: .leading, spacing: gap) {
            ForEach(shownMembers) { m in
                HStack(spacing: gap) {
                    ForEach(periodDays) { pd in
                        let fill = RoundedRectangle(cornerRadius: 5, style: .continuous).fill((m.cells[pd.key] ?? .none).color).frame(width: cellW, height: cell)
                            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(pd.key == todayKey ? NX.violet : Color.clear, lineWidth: 1.5))
                            .overlay(alignment: .leading) {
                                if pd.startsMonth { Rectangle().fill(NX.border).frame(width: 1, height: cell).offset(x: -gap / 2) }
                            }
                            .modifier(OutsideNowMark(since: Self.outsideSince(m.rowByDay[pd.key], dayKey: pd.key, todayKey: liveKey),
                                                     name: m.name, cell: cell))
                            // Web check-in / location off, as the web board's corner marks (Q-IB8).
                            // Inside the cell's corner: offset out of it, the mark crossed into the row above
                            // and showed as a clipped ")" beside the first day in view (UI tour run 16,
                            // R16-I-13 / R16-M-14).
                            .overlay(alignment: .topTrailing) { Self.trackingMark(m.rowByDay[pd.key]).padding(1) }
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

    /// The whole month at once, pinch-zoomable — the card shows a few days at a time and hides
    /// the shape of the month; this is where a BoD reads it in one look.
    private struct FullBoard: View {
        let members: [Member]
        let periodDays: [PeriodDay]
        let monthLabel: String
        let todayKey: String?
        /// Today while the card's data is live, else nil: where the "outside right now" mark may go.
        let outsideKey: String?
        let canManage: Bool
        let legend: AnyView
        /// The card's quiet re-read, run every minute while this is up and the app is in front: the
        /// card underneath is covered and keeps no minute of its own meanwhile.
        let refresh: () async -> Void
        let onChanged: () async -> Void
        @Environment(\.dismiss) private var dismiss
        @Environment(\.scenePhase) private var scenePhase
        @State private var appActive = true
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
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
                    if Task.isCancelled { return }
                    if appActive { await refresh() }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                appActive = phase == .active
                if phase == .active { Task { await refresh() } }
            }
        }

        private var grid: some View {
            let nowKey = ProjDate.fmt("yyyy-MM-dd").string(from: Date())
            return HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: gap) {
                    Color.clear.frame(height: 26)
                    ForEach(members) { m in
                        StreakBoardCard.nameLabel(m).frame(width: nameW, height: cell, alignment: .leading)
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
                                    .modifier(OutsideNowMark(since: StreakBoardCard.outsideSince(m.rowByDay[pd.key], dayKey: pd.key, todayKey: outsideKey),
                                                             name: m.name, cell: cell))
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
                        StreakBoardCard.scoreText(worked: m.workedDays, target: StreakBoardCard.scoreTarget(m, periodDays: periodDays.count))
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

    /// `silent`: the minute's re-read (`liveRefresh`) — no spinner, and a failure keeps the board.
    private func load(silent: Bool = false) async {
        if !silent { loading = true }
        // Named once: the fetch and the cache key it falls back to have to agree, and a board of
        // the whole crew restored into a personal board would be a quiet, convincing lie.
        let scope = wide ? "workspace" : "me"
        let month = monthKey
        // A load whose scope or month is no longer the one on screen must not touch the board — not
        // with its answer and not with its cached fallback. The board's `.task` is cancelled and
        // restarted when the permissions land (`me` → `workspace`); the cancelled `me` load then
        // failed into the catch below and drew the viewer's own cached row over the crew board.
        func stale() -> Bool { Task.isCancelled || scope != (wide ? "workspace" : "me") || month != monthKey }
        do {
            let fetched = try await APIClient.shared.attendanceHistoryResponse(scope: scope, month: month)
            if stale() { return }
            members = Self.buildMembers(fetched.all, roster: fetched.roster)
            cachedFrom = nil
        }
        catch APIError.unauthorized { auth.logout() }   // leaves the board as it was, same as before
        catch {
            if stale() { return }
            // A quiet re-read that fails keeps what is drawn; the next minute tries again.
            if silent { return }
            // A month already drawn is far more use than an empty grid, and unlike today's card
            // this cannot be misread as live: a finished day does not change, and the line
            // underneath says when the copy was taken. (Nor are the "outside right now" marks
            // drawn on it: `outsideKey`.)
            if let hit = ResponseCache.decoded("attendance-history-\(scope)-\(month)",
                                               as: AttendanceHistoryResponse.self) {
                members = Self.buildMembers(hit.value.all, roster: hit.value.roster)
                cachedFrom = hit.savedAt
            } else {
                members = []
                cachedFrom = nil
            }
        }
        if !silent { loading = false }
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
    /// Since when the person has been outside the office, if this is today's open record and they
    /// still are (the crew board's test).
    private var outsideSince: Date? {
        StreakBoardCard.outsideSince(row, dayKey: String((row.attendanceDate ?? "").prefix(10)),
                                     todayKey: ProjDate.fmt("yyyy-MM-dd").string(from: Date()))
    }
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
                        HStack(spacing: 8) {
                            Text(row.user?.name ?? "Staff").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                            if let left = row.user?.leftAt { LeftTag(leftAt: left) }
                        }
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
                        // Out of the office right now — today's open record (the web's "Outside since"
                        // chip, owner 8 Oct 2026). Its own line: the row above is full on a phone.
                        if let since = outsideSince {
                            Label(String(format: T("Outside since %@"), ProjDate.fmt("HH:mm").string(from: since)),
                                  systemImage: "figure.walk")
                                .font(NXFont.text(11, .bold)).foregroundStyle(ChipTone.warning.fg)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(ChipTone.warning.bg, in: Capsule())
                                .accessibilityLabel(OutsideNowMark.label(since))
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
                        // Which office — or, for a check-in made away from it (location-free), the
                        // address it was made at (owner, 28 Sep 2026).
                        if row.checkedInAway == true {
                            infoLine("mappin.and.ellipse", "\(T("Away from the office"))" + (row.placeLabel.map { " · \($0)" } ?? "")
                                     + (row.effectiveShiftStartTime.map { " · \(T("shift")) \($0)–\(row.effectiveShiftEndTime ?? "")" } ?? ""))
                        } else if let office = row.officeLocation?.name {
                            infoLine("building.2", office + (row.effectiveShiftStartTime.map { " · \(T("shift")) \($0)–\(row.effectiveShiftEndTime ?? "")" } ?? ""))
                        }
                        if let w = row.workedMinutes, w > 0 { infoLine("clock", "\(T("Worked")) \(w / 60)h \(w % 60)m") }
                        if row.isCorrected == true {
                            infoLine("pencil.and.list.clipboard", "\(T("Corrected by the board")) · \(row.correctionReason ?? "")")
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
            .alert("\(T("Delete the whole attendance record for")) \(dateLabel)?", isPresented: $confirmDelete) {
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
            SectionLabel(T("Change status (board)"))
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
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.violet.opacity(0.3), lineWidth: 1))
        // Its own view for the dialog: the sheet's stack already carries the delete confirmation.
        .alert(pendingOverride.map { overrideTitle($0) } ?? "",
                            isPresented: Binding(get: { pendingOverride != nil }, set: { if !$0 { pendingOverride = nil } }), presenting: pendingOverride) { action in
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
                    Text(attendanceStatusLabel(status)).font(NXFont.text(11, .semibold)).foregroundStyle(status.uppercased().contains("LATE") || status.uppercased().contains("EARLY") ? NX.danger : NX.mutedFg)
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

/// A check-in / check-out status in the app's language (copy sweep, 12 Oct 2026: it showed the raw value,
/// "Early leave", in English in both languages). Anything unknown is humanised as before.
func attendanceStatusLabel(_ raw: String) -> String {
    switch raw.uppercased() {
    case "ON_TIME", "PRESENT": return T("On time")
    case "LATE": return T("Late")
    case "EARLY_LEAVE", "EARLY", "LEFT_EARLY": return T("Left early")
    case "INCOMPLETE": return T("Incomplete")
    case "CHECKED_IN": return T("Checked in")
    case "WFH": return "WFH"
    case "LEAVE": return T("Leave")
    case "SICK": return T("Sick")
    case "PERMIT": return T("Permit")
    case "DAY_OFF": return T("Day off")
    default: return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

/// The board's Export: icon and word where the header has room, the icon alone on a phone (its accessibility
/// label still says Export).
private struct ExportLabelStyle: LabelStyle {
    let iconOnly: Bool
    func makeBody(configuration: Configuration) -> some View {
        if iconOnly {
            configuration.icon
        } else {
            HStack(spacing: 6) { configuration.icon; configuration.title }
        }
    }
}

