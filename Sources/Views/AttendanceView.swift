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
            ScrollView {
                VStack(spacing: 18) {
                    if loading {
                        ProgressView().padding(.top, 60)
                    } else if let error {
                        errorState(error)
                    } else {
                        statusCard
                        actionArea
                        if let banner {
                            Text(banner.text)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(banner.good ? Brand.success : .red, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Absensi")
            .background(Color(.systemGroupedBackground))
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
                    .font(.subheadline.weight(.bold))
                Spacer()
                if let shift = today?.myShift {
                    Text("Shift \(shift.startTime)–\(shift.endTime)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            Divider()
            HStack(spacing: 0) {
                timeColumn(title: "Masuk", time: today?.today?.checkInAt, late: (today?.today?.lateMinutes ?? 0) > 0)
                Divider().frame(height: 40)
                timeColumn(title: "Keluar", time: today?.today?.checkOutAt, late: false)
            }
            if today?.today?.checkOutApproval == "PENDING" {
                Text("⏳ Checkout di luar area — nunggu approval BoD")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Brand.blue)
            }
        }
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    private func timeColumn(title: String, time: String?, late: Bool) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(time.flatMap(Self.hhmm) ?? "—")
                .font(.system(size: 26, weight: .black, design: .rounded))
                .foregroundStyle(late ? .red : .primary)
            if late { Text("telat").font(.caption2.weight(.bold)).foregroundStyle(.red) }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var actionArea: some View {
        let rec = today?.today
        if rec?.hasCheckedIn == true && rec?.hasCheckedOut == true {
            doneState("✓ Absen hari ini lengkap", color: Brand.success)
        } else if rec?.checkOutApproval == "PENDING" {
            doneState("Checkout nunggu approval BoD", color: Brand.blue)
        } else if rec?.hasCheckedIn == true {
            bigButton(title: "Check Out", system: "arrow.right.square.fill", tint: .orange) { startCapture(.checkOut) }
        } else {
            bigButton(title: "Check In", system: "camera.fill", tint: Brand.violet) { startCapture(.checkIn) }
        }
        if today?.activeOfficeCount == 0 {
            Text("Belum ada lokasi kantor aktif di workspace ini.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func bigButton(title: String, system: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                if busy { ProgressView().tint(.white) } else { Image(systemName: system) }
                Text(busy ? "Memproses…" : title).font(.headline)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 18)
            .background(tint, in: RoundedRectangle(cornerRadius: 18))
            .foregroundStyle(.white)
        }
        .disabled(busy)
    }

    private func doneState(_ text: String, color: Color) -> some View {
        HStack {
            Image(systemName: "checkmark.seal.fill")
            Text(text).font(.headline)
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity).padding(.vertical, 18)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(.secondary)
            Text(msg).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Coba lagi") { Task { await load() } }.buttonStyle(.borderedProminent)
        }
        .padding(.top, 50)
    }

    private var offsiteSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Kamu di luar area kantor. Checkout tetap bisa, tapi **wajib alasan** dan di-approve BoD dulu.")
                    .font(.subheadline).foregroundStyle(.secondary)
                TextField("Alasan checkout di luar (mis. meeting di klien)", text: $offsiteReason, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
                    .padding(12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                Button {
                    showOffsiteSheet = false
                    Task { await submitOffsite() }
                } label: {
                    Text("Checkout & minta approval").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(offsiteReason.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
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
                showOffsiteSheet = true   // keep pendingSelfie + pendingCoords for the resubmit
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
