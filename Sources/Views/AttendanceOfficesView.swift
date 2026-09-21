import SwiftUI
import MapKit

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
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if offices.isEmpty {
                EmptyState(icon: "mappin.and.ellipse", title: T("No offices yet"),
                           subtitle: T("An office is a point on the map with a radius around it. Staff can only check in inside that radius, so nothing can be recorded until the first office exists."),
                           actionTitle: T("Add office"), actionIcon: "plus", action: { editOffice = nil; showComposer = true }, compact: true)
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
            // Everything but the switch opens the composer: the pencil is a 13pt target wedged
            // against a toggle, and the name is what people aim at.
            Button { editOffice = o } label: {
                HStack(spacing: 10) {
                    Image(systemName: "mappin.circle.fill").font(.system(size: 18)).foregroundStyle((o.isActive ?? true) ? NX.violetText : NX.mutedFg)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(o.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Text("\(o.address ?? "—") · radius \(o.radiusMeters ?? 0)m").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Toggle("", isOn: Binding(get: { o.isActive ?? true }, set: { on in Task { try? await APIClient.shared.updateOffice(id: o.id, fields: ["isActive": on]); await load() } }))
                .labelsHidden().tint(NX.violetText)
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
    @State private var confirmDelete = false
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
                        f(T("OFFICE NAME")) { field($name, "mis. Z Networks HQ") }
                        f("ALAMAT (opsional)") { field($address, "Alamat") }
                        f(T("LOCATION")) {
                            OfficeMapPicker(lat: $lat, lng: $lng, radiusMeters: Double(radius) ?? 100, locate: { try? await loc.currentFix() })
                        }
                        DisclosureGroup(T("Fine-tune coordinates")) {
                            HStack(spacing: 12) {
                                f("LATITUDE") { field($lat, "-6.2").keyboardType(.numbersAndPunctuation) }
                                f("LONGITUDE") { field($lng, "106.8").keyboardType(.numbersAndPunctuation) }
                            }
                            .padding(.top, 8)
                        }
                        .font(NXFont.text(12, .semibold)).tint(NX.mutedFg)
                        HStack(spacing: 12) {
                            f("\(T("RADIUS")) · \(Int(radius) ?? 100) m") {
                                // A slider, because the number only means something on the map above:
                                // drag it and watch the circle grow until it covers the entrance and the car park.
                                Slider(value: Binding(get: { Double(Int(radius) ?? 100) }, set: { radius = String(Int($0.rounded())) }),
                                       in: 25...500, step: 5)
                                    .tint(NX.violet)
                            }
                            f("TOLERANSI TELAT (menit)") { field($grace, "0").keyboardType(.numberPad) }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await save() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(editing == nil ? T("Create office") : T("Save")) }
                        }.buttonStyle(NexusPrimaryButton()).disabled(busy || !canSave)
                        if editing != nil {
                            // Refused by the server once anybody has checked in here (the rows point at the
                            // office); the reason comes back in `err` and says to switch it off instead.
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label(T("Delete office"), systemImage: "trash").font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                            }
                            .buttonStyle(.plain).disabled(busy)
                            .confirmationDialog(T("Delete this office?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                                Button(T("Delete"), role: .destructive) { Task { await remove() } }
                            } message: { Text(T("It disappears from the list and nobody can check in there anymore. Days already recorded there keep the office's name.")) }
                        }
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
    private func remove() async {
        guard let editing else { return }
        busy = true; err = nil; defer { busy = false }
        do { _ = try await APIClient.shared.deleteOffice(id: editing.id); await onSaved(); dismiss() }
        catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete the office.") }
    }

    private func save() async {
        busy = true; err = nil; defer { busy = false }
        var fields: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "address": address.isEmpty ? NSNull() : address,
            "latitude": Double(lat) ?? 0, "longitude": Double(lng) ?? 0,
            "radiusMeters": Int(radius) ?? 100, "lateGraceMinutes": min(180, Int(grace) ?? 0),
        ]
        do {
            // The shift is only sent on CREATE. On edit it used to send 09:00–18:00 every time, which
            // silently reset HQ's 15:00 shift whenever somebody fixed its radius.
            if let editing { try await APIClient.shared.updateOffice(id: editing.id, fields: fields) }
            else { fields.removeValue(forKey: "address"); if !address.isEmpty { fields["address"] = address }
                   fields["shiftStartTime"] = "09:00"; fields["shiftEndTime"] = "18:00"
                   try await APIClient.shared.createOffice(fields: fields) }
            await onSaved(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the office.") }
    }
}


// MARK: - Map picker

/// Pick the office point on a map instead of typing coordinates.
///
/// The map moves under a fixed pin — the pattern people know from ride-hailing apps — so the
/// point is wherever the map is left, never a tiny marker to drag. The circle is the check-in
/// radius, drawn from the radius field live, so "is 75 m enough to cover the car park" is answered
/// by looking. Search jumps the map to an address; the location button jumps it to the phone.
struct OfficeMapPicker: View {
    @Binding var lat: String
    @Binding var lng: String
    let radiusMeters: Double
    /// The phone's own position, if it can be had — the composer owns the LocationManager.
    let locate: () async -> LocationManager.Fix?

    @State private var position: MapCameraPosition = .automatic
    @State private var center: CLLocationCoordinate2D?
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var searching = false
    @State private var settled = false

    private static let jakarta = CLLocationCoordinate2D(latitude: -6.2088, longitude: 106.8456)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(NX.mutedFg)
                TextField(T("Search an address or place"), text: $query)
                    .font(NXFont.text(14)).autocorrectionDisabled().submitLabel(.search)
                    .onSubmit { Task { await search() } }
                if searching { ProgressView().scaleEffect(0.8) }
                else if !query.isEmpty { Button { query = ""; results = [] } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }.buttonStyle(.plain) }
            }
            .padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
            if !results.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(results.prefix(5).enumerated()), id: \.offset) { _, item in
                        Button { jump(to: item.placemark.coordinate); results = []; query = item.name ?? query } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.name ?? "—").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                                Text(item.placemark.title ?? "").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 8)
                        }.buttonStyle(.plain)
                        Divider().overlay(NX.border)
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
            }
            ZStack {
                Map(position: $position) {
                    if let center {
                        MapCircle(center: center, radius: radiusMeters)
                            .foregroundStyle(NX.violet.opacity(0.14))
                            .stroke(NX.violet, lineWidth: 2)
                    }
                }
                .mapStyle(.standard(pointsOfInterest: .including([.airport, .publicTransport, .parking])))
                .mapControls { MapCompass(); MapScaleView() }
                // `.onEnd`, not `.continuous`: the circle is map CONTENT keyed on `center`, so a
                // continuous update re-rendered the content on every frame of a drag, which moved
                // the camera, which updated again — the sheet froze solid on first open.
                .onMapCameraChange(frequency: .onEnd) { ctx in
                    center = ctx.camera.centerCoordinate
                    guard settled else { return }
                    lat = String(format: "%.6f", ctx.camera.centerCoordinate.latitude)
                    lng = String(format: "%.6f", ctx.camera.centerCoordinate.longitude)
                }
                // The fixed pin: its tip is the point that gets saved.
                VStack(spacing: 0) {
                    Image(systemName: "mappin.circle.fill").font(.system(size: 34)).foregroundStyle(NX.violet)
                        .background(Circle().fill(Color.white).padding(4))
                    Rectangle().fill(NX.violet).frame(width: 2, height: 12)
                }
                .offset(y: -23)
                .allowsHitTesting(false)
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            Task { if let fix = await locate() { jump(to: CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude)) } }
                        } label: {
                            Image(systemName: "location.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.violetText)
                                .frame(width: 36, height: 36).background(Color.white, in: Circle()).shadow(color: .black.opacity(0.15), radius: 4, y: 2)
                        }
                        .buttonStyle(.plain).padding(10)
                        .accessibilityLabel(T("Use my location"))
                    }
                    Spacer()
                }
            }
            .frame(height: 280)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
            Text(T("Drag the map until the pin sits on the office entrance. The circle is where people can check in."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
        }
        .task {
            // Start where the office already is; otherwise on the phone; otherwise Jakarta.
            if let la = Double(lat), let lo = Double(lng) {
                jump(to: CLLocationCoordinate2D(latitude: la, longitude: lo), animated: false)
            } else if let fix = await locate() {
                jump(to: CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude), animated: false)
            } else {
                jump(to: Self.jakarta, animated: false)
            }
            // Only after the first placement does moving the map write coordinates back, so the
            // initial camera settle cannot overwrite an office's real point with the map's default.
            try? await Task.sleep(for: .milliseconds(600))
            settled = true
        }
    }

    private func jump(to c: CLLocationCoordinate2D, animated: Bool = true) {
        let span = max(120, radiusMeters * 5)
        let region = MKCoordinateRegion(center: c, latitudinalMeters: span, longitudinalMeters: span)
        if animated { withAnimation(.easeInOut(duration: 0.35)) { position = .region(region) } } else { position = .region(region) }
        center = c
        lat = String(format: "%.6f", c.latitude); lng = String(format: "%.6f", c.longitude)
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces); guard !q.isEmpty else { return }
        searching = true; defer { searching = false }
        let req = MKLocalSearch.Request(); req.naturalLanguageQuery = q
        if let center { req.region = MKCoordinateRegion(center: center, latitudinalMeters: 50_000, longitudinalMeters: 50_000) }
        results = (try? await MKLocalSearch(request: req).start().mapItems) ?? []
    }
}
