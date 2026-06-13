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
