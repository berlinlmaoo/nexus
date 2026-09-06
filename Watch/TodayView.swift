import SwiftUI

private let nxViolet = Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)
private let nxGreen = Color(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255)

/// Where today stands. Read-only, and that is the whole point.
///
/// Attendance needs a selfie, and a check-out also needs a 200-character reflection. Neither is
/// possible here, and a shortcut that skipped them would instantly become the easiest way to be
/// marked present from somewhere else entirely.
struct TodayView: View {
    @Environment(WatchAuth.self) private var auth

    @State private var today: AttendanceToday?
    @State private var error: String?
    @State private var loading = true

    private var record: AttendanceRecord? { today?.today }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header
                if loading && today == nil {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    Text(error).font(.caption2).foregroundStyle(.secondary)
                } else {
                    body(for: record)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Today")
        .task { await load() }
        .refreshable { await load() }
    }

    private var header: some View {
        Text(record?.officeLocation?.name ?? "NEXUS")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    @ViewBuilder
    private func body(for record: AttendanceRecord?) -> some View {
        if let record, let start = parseISO(record.checkInAt), !record.hasCheckedOut {
            VStack(alignment: .leading, spacing: 2) {
                Text(start, style: .timer)
                    .font(.system(.title, design: .rounded).weight(.semibold).monospacedDigit())
                    .foregroundStyle(nxViolet)
                Text("Since \(start.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else if let record, let out = parseISO(record.checkOutAt) {
            Label("Checked out \(out.formatted(date: .omitted, time: .shortened))",
                  systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(nxGreen)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Label("Not checked in", systemImage: "circle.dashed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                // Says plainly why the watch cannot help, rather than leaving somebody prodding a
                // screen that was never going to respond.
                Text("Check in on your iPhone — it needs a photo.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func load() async {
        guard let session = auth.session else { return }
        error = nil
        do { today = try await WatchAPI.today(session) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't load." }
        loading = false
    }

    private func parseISO(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: iso) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
