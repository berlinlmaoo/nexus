import SwiftUI
import MapKit
import CoreLocation

/// GET /api/attendance/records/{id}/trail — one record's working-hours path. Everything optional
/// that the contract allows to be missing, so a server that is a step behind still draws a map.
struct LocationTrailResponse: Decodable, Sendable {
    let record: Record
    let points: [Point]?
    let outsideSpans: [Span]?

    struct Record: Decodable, Sendable {
        let id: String
        let userId: String?
        let userName: String?
        let date: String?
        let checkInAt: String?
        let checkOutAt: String?
        let checkOutOffsite: Bool?
        let office: Office?
        /// "denied" when the person refused Always location for this record.
        let locationTrackingState: String?
    }
    struct Office: Decodable, Sendable {
        let name: String?
        let lat: Double
        let lng: Double
        let radiusMeters: Double?
    }
    struct Point: Decodable, Sendable, Identifiable {
        let lat: Double
        let lng: Double
        let accuracy: Double?
        let at: String
        let inside: Bool?
        let event: String?
        var id: String { "\(at)|\(lat)|\(lng)|\(event ?? "")" }
        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
    }
    struct Span: Decodable, Sendable, Identifiable {
        let from: String
        let to: String?
        var id: String { from }
    }
}

/// Where somebody went between check-in and check-out: the path, the office circle, where they
/// left and came back, and how long each stretch outside lasted.
///
/// Opened by a manager or the BoD from a crew-board cell, and by the person themselves from their
/// own day — the same screen for both, because "what does my manager see about me" should have
/// exactly one answer.
struct LocationTrailView: View {
    let recordId: String
    /// From the board row, so the "location off" badge shows even before the trail has loaded.
    var trackingState: String? = nil

    @State private var trail: LocationTrailResponse?
    @State private var loading = true
    @State private var error: String?
    @State private var camera: MapCameraPosition = .automatic

    private var points: [LocationTrailResponse.Point] { trail?.points ?? [] }
    private var spans: [LocationTrailResponse.Span] { trail?.outsideSpans ?? [] }
    private var locationOff: Bool { (trail?.record.locationTrackingState ?? trackingState) == "denied" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if loading && trail == nil {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if let error, trail == nil {
                    EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load the location trail"),
                               subtitle: error, tint: NX.danger,
                               actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                               action: { Task { await load() } }, compact: true)
                } else {
                    map
                    timeline
                }
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Location trail"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(trail?.record.userName ?? T("Location trail"))
                    .font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                if locationOff { locationOffBadge }
            }
            HStack(spacing: 14) {
                Label("IN \(time(trail?.record.checkInAt))", systemImage: "arrow.right.to.line")
                Label("OUT \(time(trail?.record.checkOutAt))", systemImage: "arrow.left.to.line")
            }
            .font(NXFont.text(13, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
            if locationOff {
                Text(T("Always location was refused on this phone, so NEXUS could only record while the app was open. Gaps in this trail are expected."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var locationOffBadge: some View {
        Label(T("Location off"), systemImage: "location.slash.fill")
            .font(NXFont.text(11, .bold)).foregroundStyle(.white)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(NX.danger, in: Capsule())
    }

    @ViewBuilder private var map: some View {
        if points.isEmpty && trail?.record.office == nil {
            EmptyState(icon: "map", title: T("No location points"),
                       subtitle: T("Nothing was recorded for this day. Points are only sent while the person is outside the office, so a day spent inside leaves an empty trail."),
                       compact: true)
                .nexusCard()
        } else {
            Map(position: $camera) {
                if let office = trail?.record.office {
                    let centre = CLLocationCoordinate2D(latitude: office.lat, longitude: office.lng)
                    MapCircle(center: centre, radius: office.radiusMeters ?? 100)
                        .foregroundStyle(NX.violet.opacity(0.15))
                        .stroke(NX.violet, lineWidth: 1.5)
                    Annotation(office.name ?? T("Office"), coordinate: centre) {
                        Image(systemName: "building.2.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            .padding(6).background(NX.violet, in: Circle())
                    }
                }
                if points.count >= 2 {
                    MapPolyline(coordinates: points.map(\.coordinate))
                        .stroke(Color.orange, lineWidth: 3)
                }
                ForEach(markers) { p in
                    Annotation(markerLabel(p), coordinate: p.coordinate) {
                        Image(systemName: p.event == "exit" ? "arrow.up.right" : "arrow.down.left")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .padding(6).background(p.event == "exit" ? Color.orange : NX.success, in: Circle())
                    }
                }
                if let last = points.last {
                    Annotation(T("Last point") + " · " + time(last.at), coordinate: last.coordinate) {
                        Circle().fill(Color.orange).frame(width: 12, height: 12)
                            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat))
            .frame(height: 320)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
        }
    }

    /// Only the moments that mean something: leaving and coming back. The 15-minute points are the
    /// line itself and would bury the map in pins.
    private var markers: [LocationTrailResponse.Point] {
        points.filter { $0.event == "exit" || $0.event == "enter" }
    }

    private func markerLabel(_ p: LocationTrailResponse.Point) -> String {
        (p.event == "exit" ? T("Left at") : T("Back at")) + " " + time(p.at)
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(T("Outside the office"))
            row(icon: "arrow.right.to.line", tint: NX.success, title: T("Check-in"), detail: time(trail?.record.checkInAt))
            if spans.isEmpty {
                Text(T("No time outside the office was recorded."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .padding(.leading, 30)
            } else {
                ForEach(spans) { span in
                    row(icon: "figure.walk", tint: .orange,
                        title: "\(time(span.from)) – \(span.to.map { time($0) } ?? T("now"))",
                        detail: duration(from: span.from, to: span.to))
                }
                Text(String(format: T("%@ outside in total"), totalOutside))
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                    .padding(.leading, 30)
            }
            row(icon: "arrow.left.to.line", tint: NX.danger,
                title: T("Check-out") + (trail?.record.checkOutOffsite == true ? " · " + T("offsite") : ""),
                detail: time(trail?.record.checkOutAt))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func row(icon: String, tint: Color, title: String, detail: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundStyle(tint)
                .frame(width: 20)
            Text(title).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            Spacer()
            Text(detail).font(NXFont.text(13, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
        }
    }

    // MARK: - formatting

    private func time(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "--:--" }
        return ProjDate.fmt("HH:mm").string(from: d)
    }

    /// An open span (no `to`) runs until the check-out, or until now while the day is still open.
    private func seconds(from: String, to: String?) -> TimeInterval {
        guard let start = ProjDate.parse(from) else { return 0 }
        let end = ProjDate.parse(to) ?? ProjDate.parse(trail?.record.checkOutAt) ?? Date()
        return max(0, end.timeIntervalSince(start))
    }

    private func duration(from: String, to: String?) -> String { Self.hm(seconds(from: from, to: to)) }

    private var totalOutside: String { Self.hm(spans.reduce(0) { $0 + seconds(from: $1.from, to: $1.to) }) }

    static func hm(_ s: TimeInterval) -> String {
        let m = Int(s / 60)
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            trail = try await APIClient.shared.locationTrail(recordId: recordId)
            error = nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.")
        }
    }
}
