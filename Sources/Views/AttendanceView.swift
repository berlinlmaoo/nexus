import SwiftUI

struct AttendanceView: View {
    @Environment(AuthStore.self) private var auth
    @State private var today: AttendanceToday?
    @State private var loading = true
    @State private var error: String?

    // capture → gps → upload flow
    @State private var loc = LocationManager()
    @State private var showCamera = false
    @State private var pendingAction: Action?
    @State private var busy = false
    @State private var banner: Banner?

    // offsite checkout (beyond geofence)
    @State private var pendingSelfie: Data?
    @State private var pendingCoords: (lat: Double, lng: Double)?
    @State private var showOffsiteSheet = false
    @State private var offsiteReason = ""

    enum Action { case checkIn, checkOut }
    struct Banner: Identifiable { let id = UUID(); let text: String; let good: Bool }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        if loading {
                            ProgressView().tint(NX.violet).padding(.top, 60)
                        } else if let error {
                            errorState(error)
                        } else {
                            statusCard
                            actionArea
                            if let banner {
                                HStack(spacing: 8) {
                                    Image(systemName: banner.good ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    Text(banner.text).font(NXFont.text(14, .semibold))
                                }
                                .foregroundStyle(.white)
                                .padding(13)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(banner.good ? NX.success : NX.danger, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Absensi")
            .task { await load() }
            .onAppear { loc.requestPermissionIfNeeded() }
            .refreshable { await load() }
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
                    pendingSelfie = data
                    Task { await submit(selfie: data) }
                }
                .ignoresSafeArea()
            }
            .sheet(isPresented: $showOffsiteSheet) { offsiteSheet }
        }
    }

    // MARK: - subviews

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Hari ini", systemImage: "calendar")
                    .font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                Spacer()
                if let shift = today?.myShift {
                    NexusChip(text: "Shift \(shift.startTime)–\(shift.endTime)", tone: .accent, systemImage: "clock.fill")
                }
            }
            Divider().overlay(NX.border)
            HStack(spacing: 0) {
                timeColumn(title: "Masuk", time: today?.today?.checkInAt, late: (today?.today?.lateMinutes ?? 0) > 0)
                Rectangle().fill(NX.border).frame(width: 1, height: 46)
                timeColumn(title: "Keluar", time: today?.today?.checkOutAt, late: false)
            }
            if today?.today?.checkOutApproval == "PENDING" {
                HStack(spacing: 6) {
                    Image(systemName: "hourglass")
                    Text("Checkout di luar area — nunggu approval BoD").font(NXFont.text(12, .semibold))
                }
                .foregroundStyle(NX.blue)
            }
        }
        .nexusCard(padding: 18)
    }

    private func timeColumn(title: String, time: String?, late: Bool) -> some View {
        VStack(spacing: 4) {
            Text(title).font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
            Text(time.flatMap(Self.hhmm) ?? "—")
                .font(NXFont.display(28, .black))
                .foregroundStyle(late ? NX.danger : NX.foreground)
            if late { NexusChip(text: "telat", tone: .danger) }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var actionArea: some View {
        let rec = today?.today
        if rec?.hasCheckedIn == true && rec?.hasCheckedOut == true {
            doneState("Absen hari ini lengkap", color: NX.success)
        } else if rec?.checkOutApproval == "PENDING" {
            doneState("Checkout nunggu approval BoD", color: NX.blue)
        } else if rec?.hasCheckedIn == true {
            bigButton(title: "Check Out", system: "arrow.right.square.fill", tint: .orange) { startCapture(.checkOut) }
        } else {
            bigButton(title: "Check In", system: "camera.fill", tint: NX.violet) { startCapture(.checkIn) }
        }
        if today?.activeOfficeCount == 0 {
            Text("Belum ada lokasi kantor aktif di workspace ini.")
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
    }

    private func bigButton(title: String, system: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(.white) } else { Image(systemName: system) }
                Text(busy ? "Memproses…" : title)
            }
        }
        .buttonStyle(NexusPrimaryButton(tint: tint))
        .disabled(busy)
    }

    private func doneState(_ text: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.seal.fill")
            Text(text).font(NXFont.display(15, .bold))
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity).padding(.vertical, 17)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 38)).foregroundStyle(NX.mutedFg)
            Text(msg).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }
        .padding(.top, 50)
    }

    private var offsiteSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Kamu di luar area kantor. Checkout tetap bisa, tapi **wajib alasan** dan di-approve BoD dulu.")
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                TextField("Alasan checkout di luar (mis. meeting di klien)", text: $offsiteReason, axis: .vertical)
                    .font(NXFont.text(15))
                    .lineLimit(3, reservesSpace: true)
                    .padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button {
                    showOffsiteSheet = false
                    Task { await submitOffsite() }
                } label: { Text("Checkout & minta approval") }
                .buttonStyle(NexusPrimaryButton(tint: NX.blue))
                .disabled(offsiteReason.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .background(NX.background)
            .navigationTitle("Checkout di luar area")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }

    // MARK: - flow

    private func startCapture(_ action: Action) {
        banner = nil
        pendingAction = action
        showCamera = true
    }

    private func submit(selfie: Data) async {
        guard let action = pendingAction else { return }
        busy = true
        defer { busy = false }
        do {
            let fix = try await loc.currentFix()
            pendingCoords = (fix.latitude, fix.longitude)
            let outcome: AttendanceOutcome
            switch action {
            case .checkIn:
                outcome = try await APIClient.shared.checkIn(lat: fix.latitude, lng: fix.longitude, selfie: selfie)
            case .checkOut:
                outcome = try await APIClient.shared.checkOut(lat: fix.latitude, lng: fix.longitude, selfie: selfie)
            }
            switch outcome {
            case .success:
                banner = Banner(text: action == .checkIn ? "Check-in berhasil ✓" : "Check-out berhasil ✓", good: true)
                await load()
            case .outsideRadius:
                offsiteReason = ""
                showOffsiteSheet = true
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? "Gagal.", good: false)
        }
    }

    private func submitOffsite() async {
        guard let selfie = pendingSelfie, let coords = pendingCoords else { return }
        busy = true
        defer { busy = false }
        do {
            let outcome = try await APIClient.shared.checkOut(
                lat: coords.lat, lng: coords.lng, selfie: selfie,
                offsite: true, reason: offsiteReason.trimmingCharacters(in: .whitespaces)
            )
            if case .success = outcome {
                banner = Banner(text: "Checkout terkirim — nunggu approval BoD ⏳", good: true)
                await load()
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            banner = Banner(text: (error as? LocalizedError)?.errorDescription ?? "Gagal.", good: false)
        }
    }

    private func load() async {
        error = nil
        do {
            today = try await APIClient.shared.attendanceToday()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat."
        }
        loading = false
    }

    // ISO8601 → "HH:mm" local.
    static func hhmm(_ iso: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? {
            let p2 = ISO8601DateFormatter(); p2.formatOptions = [.withInternetDateTime]; return p2.date(from: iso)
        }()
        guard let date else { return nil }
        let out = DateFormatter()
        out.dateFormat = "HH:mm"
        return out.string(from: date)
    }
}
