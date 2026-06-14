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
    @State private var showOffsite = false
    @State private var offsiteReason = ""

    enum Action { case checkIn, checkOut }
    struct Banner: Identifiable { let id = UUID(); let text: String; let good: Bool }

    private var rec: AttendanceRecord? { today?.today }
    private var checkedIn: Bool { rec?.hasCheckedIn == true }
    private var checkedOut: Bool { rec?.hasCheckedOut == true }
    private var pending: Bool { rec?.checkOutApproval == "PENDING" }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    hero
                    presenceButtons
                    if showOffsite { offsitePrompt }
                    if pending { infoBanner("⏳ Checkout di luar area — nunggu approval BoD", tone: .warning) }
                    if rec?.checkOutApproval == "REJECTED" { infoBanner("Checkout di luar area kamu ditolak BoD.", tone: .danger) }
                    if let banner { infoBanner(banner.text, tone: banner.good ? .success : .danger) }
                    metricsGrid
                    AttendanceRequestsCard(canReview: today?.canReviewAttendanceRequests ?? today?.canManageAttendance ?? false)
                    StreakBoardCard(canManage: today?.canManageAttendance ?? false)
                    if today?.canManageAttendance == true { OfficesCard() }
                }
                .padding(16)
            }
        }
        .navigationTitle("Absensi")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onAppear { loc.requestPermissionIfNeeded() }
        .refreshable { await load() }
        .sheet(isPresented: $showCamera) {
            CameraPicker { data in pendingSelfie = data; Task { await submit(selfie: data) } }.ignoresSafeArea()
        }
    }

    // MARK: hero (map + gradient time card)

    private var hero: some View {
        ZStack {
            Map(position: $camera) { UserAnnotation() }
                .mapStyle(.standard(elevation: .flat))
                .disabled(true)

            VStack {
                timeCard.padding(12)
                Spacer()
                HStack {
                    Text("\(statusText)\(officeSuffix)")
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(.ultraThinMaterial, in: Capsule())
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
            Text("My Work Schedule \(today?.myShift.map { "\($0.startTime) – \($0.endTime)" } ?? "—")")
                .font(NXFont.text(12, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(.white.opacity(0.18), in: Capsule())
            HStack(spacing: 32) {
                Text("IN \(rec?.checkInAt.flatMap(Self.hhmm) ?? "--:--")")
                Text("OUT \(rec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")")
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
            FunMetricCard(icon: "cup.and.saucer.fill", label: "Today's status", value: todayStatusValue,
                          helper: "Live dari NEXUS attendance API", tint: NX.success)
            FunMetricCard(icon: "mappin.circle.fill", label: "Office checkpoint", value: officeValue,
                          helper: "In \(rec?.checkInAt.flatMap(Self.hhmm) ?? "--:--") · Out \(rec?.checkOutAt.flatMap(Self.hhmm) ?? "--:--")", tint: NX.violet)
            FunMetricCard(icon: "sparkles", label: "Day-off tokens", value: "\(today?.dayOffUsedThisMonth ?? 0)/\(today?.dayOffQuota ?? 4) used",
                          helper: "Jatah day-off bulan ini", tint: NX.warning)
            FunMetricCard(icon: "calendar", label: "Tanggal merah", value: "\(today?.redDateUsedThisMonth ?? 0)/\(today?.redDateQuota ?? 0) used",
                          helper: "Jatah tanggal merah bulan ini", tint: Color(hex: "#fb7185"))
        }
    }

    private var todayStatusValue: String {
        if let s = rec?.status, !s.isEmpty { return Self.humanize(s) }
        if let req = today?.todayRequest, let t = req.type { return "\(Self.humanize(t)) \(Self.humanize(req.status ?? ""))".trimmingCharacters(in: .whitespaces) }
        return "Ready to check in"
    }
    private var officeValue: String {
        rec?.officeLocation?.name ?? "\(today?.activeOfficeCount ?? 0) active offices"
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
                           action: .checkIn, disabled: checkedIn || pending)
            presenceButton(title: "Presence Out", system: "arrow.left.to.line", tint: Color(hex: "#f43f5e"),
                           action: .checkOut, disabled: !checkedIn || checkedOut || pending)
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
        .disabled(disabled || busy)
        .opacity(disabled ? 0.4 : 1)
    }

    // MARK: offsite + banners

    private var offsitePrompt: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Kamu di luar area kantor").font(NXFont.text(14, .bold)).foregroundStyle(Color(hex: "#92400e"))
            Text("Mau checkout dari sini? **Wajib isi alasan** — checkout-nya nunggu approval BoD dulu.")
                .font(NXFont.text(12)).foregroundStyle(Color(hex: "#b45309"))
            TextField("Alasan (mis. shoot konten / meeting client)", text: $offsiteReason, axis: .vertical)
                .font(NXFont.text(14)).lineLimit(2, reservesSpace: true)
                .padding(10).background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(hex: "#fcd34d")))
            HStack(spacing: 8) {
                Button("Batal") { showOffsite = false; offsiteReason = "" }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(.white, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
                Button { showOffsite = false; Task { await submitOffsite() } } label: {
                    Text(busy ? "Mengirim…" : "Checkout & minta approval").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(Color(hex: "#d97706"), in: RoundedRectangle(cornerRadius: 10))
                }
                .disabled(offsiteReason.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            }
        }
        .padding(12)
        .background(Color(hex: "#fffbeb"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color(hex: "#fcd34d")))
    }

    private func infoBanner(_ text: String, tone: ChipTone) -> some View {
        Text(text).font(NXFont.text(12, .semibold)).foregroundStyle(tone.fg)
            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(tone.bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(tone.fg.opacity(0.2)))
    }

    // MARK: computed copy

    private var statusText: String {
        if checkedOut { return "Selesai hari ini 🎉" }
        if checkedIn { return "Lagi clocked-in" }
        return "Siap check-in"
    }
    private var officeSuffix: String { "" }

    // MARK: flow (unchanged logic)

    private func startCapture(_ action: Action) { banner = nil; pendingAction = action; showCamera = true }

    private func submit(selfie: Data) async {
        guard let action = pendingAction else { return }
        busy = true; defer { busy = false }
        do {
            let fix = try await loc.currentFix()
            pendingCoords = (fix.latitude, fix.longitude)
            let outcome: AttendanceOutcome = try await {
                switch action {
                case .checkIn: return try await APIClient.shared.checkIn(lat: fix.latitude, lng: fix.longitude, selfie: selfie)
                case .checkOut: return try await APIClient.shared.checkOut(lat: fix.latitude, lng: fix.longitude, selfie: selfie)
                }
            }()
            switch outcome {
            case .success:
                banner = Banner(text: action == .checkIn ? "Check-in berhasil ✓" : "Check-out berhasil ✓", good: true)
                await load()
            case .outsideRadius:
                offsiteReason = ""; showOffsite = true
            }
        } catch APIError.unauthorized { auth.logout() }
        catch { banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? "Gagal.", good: false) }
    }

    private func submitOffsite() async {
        guard let selfie = pendingSelfie, let coords = pendingCoords else { return }
        busy = true; defer { busy = false }
        do {
            let outcome = try await APIClient.shared.checkOut(lat: coords.lat, lng: coords.lng, selfie: selfie,
                                                              offsite: true, reason: offsiteReason.trimmingCharacters(in: .whitespaces))
            if case .success = outcome {
                banner = Banner(text: "Checkout terkirim — nunggu approval BoD ⏳", good: true); await load()
            }
        } catch APIError.unauthorized { auth.logout() }
        catch { banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? "Gagal.", good: false) }
    }

    private func load() async {
        error = nil
        do { today = try await APIClient.shared.attendanceToday() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat." }
        loading = false
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
    let helper: String
    let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 36, height: 36).background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(value).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1).minimumScaleFactor(0.65)
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            Text(helper).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        .nexusShadowSoft()
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
        case .present: return "Hadir"
        case .wfh:     return "WFH"
        case .leave:   return "Cuti/Izin"
        case .sick:    return "Sakit"
        case .dayoff:  return "Day off"
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
    @State private var rows: [AttendanceRow] = []
    @State private var loading = true

    private let cell: CGFloat = 24
    private let gap: CGFloat = 3
    private let nameW: CGFloat = 76

    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Jakarta")!; return c }
    private var monthKey: String { let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.timeZone = cal.timeZone; return f.string(from: Date()) }
    private var monthLabel: String { let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; f.locale = Locale(identifier: "id_ID"); f.timeZone = cal.timeZone; return f.string(from: Date()) }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: Date())?.count ?? 30 }

    private struct Member: Identifiable { let id: String; let name: String; let cells: [Int: AttTone] }
    private var members: [Member] {
        let groups = Dictionary(grouping: rows) { $0.user?.id ?? "me" }
        return groups.map { uid, rs -> Member in
            var cells: [Int: AttTone] = [:]
            for r in rs { if let d = dayOf(r.attendanceDate) { cells[d] = AttTone.of(r) } }
            return Member(id: uid, name: rs.first?.user?.name ?? "Kamu", cells: cells)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    private func dayOf(_ iso: String?) -> Int? {
        guard let iso, iso.count >= 10 else { return nil }
        return Int(iso.dropFirst(8).prefix(2))   // "yyyy-MM-DD" → DD
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(canManage ? "Crew streak board" : "Riwayat absen kamu").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text(monthLabel.capitalized).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            legend
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if members.isEmpty {
                Text("Belum ada absen tercatat bulan ini.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
            } else {
                grid
            }
        }
        .nexusCard()
        .task { await load() }
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
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: gap) {
                    HStack(spacing: gap) {
                        ForEach(1...daysInMonth, id: \.self) { d in
                            Text("\(d)").font(.system(size: 8)).foregroundStyle(NX.mutedFg).frame(width: cell, height: 14)
                        }
                    }
                    ForEach(members) { m in
                        HStack(spacing: gap) {
                            ForEach(1...daysInMonth, id: \.self) { d in
                                RoundedRectangle(cornerRadius: 5, style: .continuous).fill((m.cells[d] ?? .none).color)
                                    .frame(width: cell, height: cell)
                            }
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        do { rows = try await APIClient.shared.attendanceHistory(scope: canManage ? "workspace" : "me", month: monthKey) }
        catch APIError.unauthorized { auth.logout() }
        catch { rows = [] }
        loading = false
    }
}
