import WidgetKit
import SwiftUI

private let nxViolet = Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)
private let nxAmber = Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)
private let nxGreen = Color(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255)

struct AttendanceEntry: TimelineEntry {
    let date: Date
    let snapshot: AttendanceSnapshot?
}

struct AttendanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> AttendanceEntry {
        AttendanceEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (AttendanceEntry) -> Void) {
        completion(AttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AttendanceEntry>) -> Void) {
        let entry = AttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load())
        // The running clock redraws itself, so the only thing a reload buys is the day rolling over
        // and the app publishing something new. Fifteen minutes is frequent enough for both without
        // spending the widget's refresh budget on nothing.
        let next = Date().addingTimeInterval(15 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct AttendanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NEXUSAttendance", provider: AttendanceProvider()) { entry in
            AttendanceWidgetView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Attendance")
        .description("Where you stand today.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct AttendanceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: AttendanceSnapshot?

    private var state: AttendanceSnapshot.State { snapshot?.state() ?? .stale }
    private var pending: Bool { snapshot?.isPending ?? false }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(inlineText, systemImage: symbol)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    Image(systemName: symbol).font(.caption2)
                    clock.font(.system(size: 12, design: .rounded).monospacedDigit())
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(headline, systemImage: symbol).font(.caption.weight(.semibold)).lineLimit(1)
                clock.font(.system(.title3, design: .rounded).monospacedDigit())
                Text(detail).font(.caption2).lineLimit(1)
            }
        default:
            small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.caption)
                Text(headline).font(.caption.weight(.semibold)).lineLimit(1)
            }
            .foregroundStyle(tint)
            Spacer(minLength: 0)
            clock
                .font(.system(.title, design: .rounded).weight(.semibold).monospacedDigit())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - presentation

    @ViewBuilder
    private var clock: some View {
        switch state {
        case .working(let since):
            // Counts up by itself, with no reload and no battery cost.
            Text(since, style: .timer)
        case .done(let at):
            Text(at, style: .time)
        case .notCheckedIn, .stale:
            Text("--:--")
        }
    }

    private var tint: Color {
        if pending { return nxAmber }
        switch state {
        case .working: return nxViolet
        case .done: return nxGreen
        case .notCheckedIn, .stale: return .secondary
        }
    }

    private var symbol: String {
        if pending { return "arrow.triangle.2.circlepath" }
        switch state {
        case .working: return "briefcase.fill"
        case .done: return "checkmark.circle.fill"
        case .notCheckedIn: return "circle.dashed"
        case .stale: return "arrow.clockwise"
        }
    }

    private var headline: String {
        if pending { return "Sending" }
        switch state {
        case .working: return snapshot?.officeName ?? "Working"
        case .done: return "Done"
        case .notCheckedIn: return "Not checked in"
        case .stale: return "NEXUS"
        }
    }

    private var detail: String {
        if let snapshot, snapshot.isPending {
            return snapshot.pendingCount == 1 ? "1 tap still to send" : "\(snapshot.pendingCount) taps still to send"
        }
        switch state {
        case .working:
            if let out = snapshot?.expectedOutAt {
                return "Until \(out.formatted(date: .omitted, time: .shortened))"
            }
            return "Checked in"
        case .done: return "Checked out"
        case .notCheckedIn: return "Tap to check in"
        // Never claims a state it cannot know. A widget only refreshes while the app runs, so
        // yesterday's answer must not be presented as today's.
        case .stale: return "Open NEXUS to refresh"
        }
    }

    private var inlineText: String {
        switch state {
        case .working: return pending ? "Sending" : (snapshot?.officeName ?? "Working")
        case .done: return "Checked out"
        case .notCheckedIn: return "Not checked in"
        case .stale: return "Open NEXUS"
        }
    }
}
