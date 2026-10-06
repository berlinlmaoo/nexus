import WidgetKit
import SwiftUI

/// The watch-face complication: where attendance stands, and the last seven days as dots.
///
/// Reads the snapshot the watch app writes into the shared container after it loads today — the
/// same `AttendanceSnapshot` the phone's widgets read, written by a different app on a different
/// device. Faces that render in full colour get the colours the board uses; faces that render in
/// one tint get shapes instead, so a late day still reads as late.
struct WatchAttendanceEntry: TimelineEntry {
    let date: Date
    let snapshot: AttendanceSnapshot?
}

struct WatchAttendanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchAttendanceEntry { WatchAttendanceEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (WatchAttendanceEntry) -> Void) {
        completion(WatchAttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchAttendanceEntry>) -> Void) {
        let entry = WatchAttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

struct WatchAttendanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NEXUSWatchAttendance", provider: WatchAttendanceProvider()) { entry in
            WatchAttendanceView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Attendance")
        .description("Today's clock and your last seven days.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

struct WatchAttendanceView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let snapshot: AttendanceSnapshot?

    private var state: AttendanceSnapshot.State { snapshot?.state() ?? .stale }
    private var days: [AttendanceSnapshot.DayDot] { snapshot?.recentDays ?? [] }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(inlineText, systemImage: symbol)
        case .accessoryCorner:
            clock.font(.system(size: 14, design: .rounded).monospacedDigit())
                .widgetLabel { Text(headline) }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    Image(systemName: symbol).font(.caption2)
                    clock.font(.system(size: 12, design: .rounded).monospacedDigit())
                }
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                Label(headline, systemImage: symbol).font(.caption.weight(.semibold)).lineLimit(1)
                clock.font(.system(.title3, design: .rounded).monospacedDigit())
                if days.isEmpty {
                    Text(detail).font(.caption2).lineLimit(1)
                } else {
                    DotRow(days: days, colour: mode == .fullColor)
                }
            }
        }
    }

    @ViewBuilder private var clock: some View {
        switch state {
        case .working(let since): Text(since, style: .timer)
        case .done(let at): Text(at, style: .time)
        case .notCheckedIn, .stale: Text("--:--")
        }
    }
    private var symbol: String {
        switch state {
        case .working: return "briefcase.fill"
        case .done: return "checkmark.circle.fill"
        case .notCheckedIn: return "circle.dashed"
        case .stale: return "arrow.clockwise"
        }
    }
    private var headline: String {
        switch state {
        case .working: return snapshot?.officeName ?? GlanceText.t("Working", "Bekerja")
        case .done: return GlanceText.t("Done", "Selesai")
        case .notCheckedIn: return GlanceText.t("Not checked in", "Belum absen")
        case .stale: return "NEXUS"
        }
    }
    private var detail: String {
        switch state {
        case .working:
            if let out = snapshot?.expectedOutAt { return GlanceText.t("Until \(out.formatted(date: .omitted, time: .shortened))", "Sampai \(out.formatted(date: .omitted, time: .shortened))") }
            return GlanceText.t("Checked in", "Sudah absen masuk")
        case .done: return GlanceText.t("Checked out", "Sudah absen pulang")
        case .notCheckedIn: return GlanceText.t("Check in on iPhone", "Absen lewat iPhone")
        case .stale: return GlanceText.t("Open NEXUS to refresh", "Buka NEXUS untuk memperbarui")
        }
    }
    private var inlineText: String {
        switch state {
        case .working(let since): return GlanceText.t("Working since \(since.formatted(date: .omitted, time: .shortened))", "Bekerja sejak \(since.formatted(date: .omitted, time: .shortened))")
        case .done(let at): return GlanceText.t("Done \(at.formatted(date: .omitted, time: .shortened))", "Selesai \(at.formatted(date: .omitted, time: .shortened))")
        case .notCheckedIn: return GlanceText.t("Not checked in", "Belum absen")
        case .stale: return "NEXUS"
        }
    }
}

/// Seven days in a row. In colour: the board's palette. In one tint: shapes — a filled dot is a
/// full day, a half dot a late one, a ring an approved day off/leave/sick/permit, a cross an
/// absence, a dotted ring nothing recorded.
struct DotRow: View {
    let days: [AttendanceSnapshot.DayDot]
    let colour: Bool
    var body: some View {
        HStack(spacing: 4) {
            ForEach(days, id: \.dateKey) { d in
                if colour {
                    Circle().fill(toneColour(d.tone)).frame(width: 9, height: 9)
                } else {
                    Image(systemName: toneSymbol(d.tone)).font(.system(size: 9, weight: .semibold))
                }
            }
        }
    }
}

func toneSymbol(_ t: String) -> String {
    switch t {
    case "P": return "circle.fill"
    case "L": return "circle.bottomhalf.filled"
    case "I", "C", "S", "D": return "circle"
    case "A": return "xmark"
    default: return "circle.dotted"
    }
}

func toneColour(_ t: String) -> Color {
    switch t {
    case "P", "I": return Color(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255)
    case "L":      return Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)
    case "C":      return Color(red: 0.98, green: 0.80, blue: 0.20)
    case "S":      return Color(red: 0.97, green: 0.55, blue: 0.20)
    case "D":      return Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)
    case "A":      return Color(red: 0.94, green: 0.33, blue: 0.40)
    default:       return Color.secondary.opacity(0.3)
    }
}
