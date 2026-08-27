import SwiftUI

// MARK: models

struct OfficesResponse: Decodable, Sendable { let offices: [Office]? }
struct Office: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let address: String?
    let latitude: Double?
    let longitude: Double?
    let radiusMeters: Int?
    let lateGraceMinutes: Int?
    let isActive: Bool?
}

// MARK: - Offices & geofence (admin)

struct OfficesCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var offices: [Office] = []
    @State private var loading = true
    @State private var showComposer = false
    @State private var editOffice: Office?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Offices & geofence").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text("Titik kantor + radius check-in.").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                Button { editOffice = nil; showComposer = true } label: {
                    Label("Office", systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain)
            }
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if offices.isEmpty {
                Text(T("No offices yet. Add an office point + geofence radius.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(offices) { row($0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
        .sheet(isPresented: $showComposer) { OfficeComposerSheet(editing: editOffice) { await load() } }
        .sheet(item: $editOffice) { o in OfficeComposerSheet(editing: o) { await load() } }
    }

    private func row(_ o: Office) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "mappin.circle.fill").font(.system(size: 18)).foregroundStyle((o.isActive ?? true) ? NX.violet : NX.mutedFg)
            VStack(alignment: .leading, spacing: 2) {
                Text(o.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text("\(o.address ?? "—") · radius \(o.radiusMeters ?? 0)m").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 6)
            Toggle("", isOn: Binding(get: { o.isActive ?? true }, set: { on in Task { try? await APIClient.shared.updateOffice(id: o.id, fields: ["isActive": on]); await load() } }))
                .labelsHidden().tint(NX.violet)
            Button { editOffice = o } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(NX.mutedFg) }.buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do { offices = try await APIClient.shared.attendanceOffices() }
        catch APIError.unauthorized { auth.logout() } catch { offices = [] }
        loading = false
    }
}

struct OfficeComposerSheet: View {
    let editing: Office?
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var address: String
    @State private var lat: String
    @State private var lng: String
    @State private var radius: String
    @State private var grace: String
    @State private var busy = false
    @State private var err: String?
    @State private var loc = LocationManager()

    init(editing: Office?, onSaved: @escaping () async -> Void) {
        self.editing = editing; self.onSaved = onSaved
        _name = State(initialValue: editing?.name ?? "")
        _address = State(initialValue: editing?.address ?? "")
        _lat = State(initialValue: editing?.latitude.map { String($0) } ?? "")
        _lng = State(initialValue: editing?.longitude.map { String($0) } ?? "")
        _radius = State(initialValue: String(editing?.radiusMeters ?? 100))
        _grace = State(initialValue: String(editing?.lateGraceMinutes ?? 0))
    }

    private var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && Double(lat) != nil && Double(lng) != nil }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        f(T("OFFICE NAME")) { field($name, "mis. PATS HQ") }
                        f("ALAMAT (opsional)") { field($address, "Alamat") }
                        HStack(spacing: 12) {
                            f("LATITUDE") { field($lat, "-6.2").keyboardType(.numbersAndPunctuation) }
                            f("LONGITUDE") { field($lng, "106.8").keyboardType(.numbersAndPunctuation) }
                        }
                        Button { Task { await useMyLocation() } } label: {
                            Label("Pakai lokasi sekarang", systemImage: "location.fill").font(NXFont.text(12, .semibold)).foregroundStyle(NX.violet)
                                .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet.opacity(0.1), in: Capsule())
                        }.buttonStyle(.plain)
                        HStack(spacing: 12) {
                            f("RADIUS (m)") { field($radius, "100").keyboardType(.numberPad) }
                            f("TOLERANSI TELAT (menit)") { field($grace, "0").keyboardType(.numberPad) }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await save() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(editing == nil ? T("Create office") : T("Save")) }
                        }.buttonStyle(NexusPrimaryButton()).disabled(busy || !canSave)
                    }.padding(20)
                }
            }
            .navigationTitle(editing == nil ? "Office baru" : "Edit office").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
            .onAppear { loc.requestPermissionIfNeeded() }
        }
    }

    private func f<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) { SectionLabel(label); content() }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func field(_ text: Binding<String>, _ ph: String) -> some View {
        TextField(ph, text: text).font(NXFont.text(15)).autocorrectionDisabled().padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
    }
    private func useMyLocation() async {
        if let fix = try? await loc.currentFix() { lat = String(fix.latitude); lng = String(fix.longitude) }
    }
    private func save() async {
        busy = true; err = nil; defer { busy = false }
        var fields: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "address": address.isEmpty ? NSNull() : address,
            "latitude": Double(lat) ?? 0, "longitude": Double(lng) ?? 0,
            "radiusMeters": Int(radius) ?? 100, "lateGraceMinutes": min(180, Int(grace) ?? 0),
            "shiftStartTime": "09:00", "shiftEndTime": "18:00"
        ]
        do {
            if let editing { try await APIClient.shared.updateOffice(id: editing.id, fields: fields) }
            else { fields.removeValue(forKey: "address"); if !address.isEmpty { fields["address"] = address }
                   try await APIClient.shared.createOffice(fields: fields) }
            await onSaved(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the office.") }
    }
}
