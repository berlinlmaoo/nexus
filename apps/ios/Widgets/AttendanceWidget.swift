import WidgetKit
import SwiftUI

struct AttendanceEntry: TimelineEntry {
    let date: Date
    let snapshot: AttendanceSnapshot?
    /// Everything the medium size shows beside the clock. Read here rather than in the view so the
    /// two blobs are fetched together, once per timeline, instead of once per redraw.
    let glance: NexusGlance?
}

struct AttendanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> AttendanceEntry {
        AttendanceEntry(date: Date(), snapshot: nil, glance: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (AttendanceEntry) -> Void) {
        completion(AttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load(), glance: NexusGlance.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AttendanceEntry>) -> Void) {
        let entry = AttendanceEntry(date: Date(), snapshot: AttendanceSnapshot.load(), glance: NexusGlance.load())
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
            AttendanceWidgetView(snapshot: entry.snapshot, glance: entry.glance)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "nexus://attendance"))
        }
        .configurationDisplayName("Attendance")
        .description("Where you stand today.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// Every word goes through GlanceText.t, so the widget speaks the language picked in the app (mirrored
/// into the App Group) rather than the phone's: the extension does not compile Localization.swift.
///
/// Colours come from CalendarInk, per appearance: the headline's violet, green and amber are the app's
/// text colours (NX.violetText and friends), readable on a light Home Screen as well as a dark one.
struct AttendanceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let snapshot: AttendanceSnapshot?
    let glance: NexusGlance?

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

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
                if let days = snapshot?.recentDays, !days.isEmpty {
                    // Lock Screen widgets are drawn in one tint by iOS, so colour cannot carry the
                    // tone here: a filled dot is a full day, a half dot late, a ring an approved
                    // day off/leave/sick/permit, a cross an absence, a dotted ring nothing.
                    HStack(spacing: 4) {
                        ForEach(days, id: \.dateKey) { d in
                            Image(systemName: toneSymbol(d.tone)).font(.system(size: 9, weight: .semibold))
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(weekLabel(days))
                } else {
                    Text(detail).font(.caption2).lineLimit(1)
                }
            }
        case .systemMedium:
            medium
        default:
            small
        }
    }

    /// The clock on the left, the rest of the day on the right.
    ///
    /// The right-hand column is drawn from `NexusGlance`, which the app writes when the dashboard
    /// loads. It is shown ONLY while it describes today: a widget refreshes while the app runs, so
    /// yesterday's "3 due today" presented as today's would be a confident lie — the same rule
    /// `AttendanceSnapshot.state` already applies to the clock.
    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            small
                .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // The person's own day: when they came in, when the shift ends and how much is left,
            // and the last seven days as dots — the strip a BoD reads on the board, for one person.
            VStack(alignment: .leading, spacing: 7) {
                if let snapshot, snapshot.dateKey == AttendanceSnapshot.currentDateKey() {
                    if let inAt = snapshot.checkInAt {
                        glanceRow("arrow.right.to.line", GlanceText.t("In \(inAt.formatted(date: .omitted, time: .shortened))", "Masuk \(inAt.formatted(date: .omitted, time: .shortened))"), ink.green)
                    }
                    if let out = snapshot.checkOutAt {
                        glanceRow("checkmark.circle.fill", GlanceText.t("Out \(out.formatted(date: .omitted, time: .shortened))", "Pulang \(out.formatted(date: .omitted, time: .shortened))"), ink.green)
                    } else if let end = snapshot.expectedOutAt, snapshot.checkInAt != nil || snapshot.queuedSince != nil {
                        if end > entryDate {
                            HStack(spacing: 4) {
                                Image(systemName: "hourglass").font(.caption2).foregroundStyle(ink.accent).accessibilityHidden(true)
                                Text(timerInterval: entryDate...end, countsDown: true, showsHours: true)
                                    .font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(.primary)
                                Text(GlanceText.t("left", "lagi")).font(.caption2).foregroundStyle(.secondary)
                            }
                        } else {
                            glanceRow("moon.zzz.fill", GlanceText.t("Past \(end.formatted(date: .omitted, time: .shortened)) · check out", "Lewat \(end.formatted(date: .omitted, time: .shortened)) · check out"), ink.amber)
                        }
                    } else if snapshot.checkInAt == nil {
                        glanceRow("circle.dashed", GlanceText.t("Not checked in", "Belum absen"), .secondary)
                    }
                } else {
                    glanceRow("arrow.clockwise", GlanceText.t("Open NEXUS to refresh", "Buka NEXUS untuk memperbarui"), .secondary)
                }
                Spacer(minLength: 0)
                if let days = snapshot?.recentDays, !days.isEmpty {
                    // The Lock Screen's shapes here too, coloured where iOS keeps colour: a filled dot
                    // is a full day, a half dot late, a ring an approved day off/leave/sick/permit, a
                    // cross an absence, a dotted ring nothing. Colour alone vanished on a tinted or
                    // clear Home Screen, and never reached anyone who cannot tell green from amber.
                    HStack(spacing: 4) {
                        ForEach(days, id: \.dateKey) { d in
                            VStack(spacing: 2) {
                                Image(systemName: toneSymbol(d.tone))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(mode == .fullColor ? toneColor(d.tone) : Color.primary)
                                    .frame(width: 13, height: 13)
                                    .widgetAccentable()
                                Text(GlanceText.weekdayLetter(d.dateKey))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(weekLabel(days))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var entryDate: Date { Date() }

    private func toneSymbol(_ t: String) -> String {
        switch t {
        case "P": return "circle.fill"
        case "L": return "circle.bottomhalf.filled"
        case "I", "C", "S", "D": return "circle"
        case "A": return "xmark"
        default: return "circle.dotted"
        }
    }

    /// The board's colours, each moved just far enough in lightness to read on this appearance.
    private func toneColor(_ t: String) -> Color {
        switch t {
        case "P", "I": return ink.task("#34D399")
        case "L":      return ink.task("#FBBF24")
        case "C":      return ink.task("#FACC33")
        case "S":      return ink.task("#F78C33")
        case "D":      return ink.task("#7B68EE")
        case "A":      return ink.task("#F05466")
        default:       return Color.secondary
        }
    }

    /// "Last 7 days: Monday, present; Tuesday, late; …" — the strip in one VoiceOver swipe.
    private func weekLabel(_ days: [AttendanceSnapshot.DayDot]) -> String {
        GlanceText.attendanceWeek(days.map { (dateKey: $0.dateKey, tone: $0.tone) })
    }

    private func glanceRow(_ symbol: String, _ text: String, _ color: Color) -> some View {
        Label {
            Text(text).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
        } icon: {
            Image(systemName: symbol).font(.caption2).foregroundStyle(color)
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
        if pending { return ink.amber }
        switch state {
        case .working: return ink.accent
        case .done: return ink.green
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
        if pending { return GlanceText.t("Sending", "Mengirim") }
        switch state {
        case .working: return snapshot?.officeName ?? GlanceText.t("Working", "Bekerja")
        case .done: return GlanceText.t("Done", "Selesai")
        case .notCheckedIn: return GlanceText.t("Not checked in", "Belum absen")
        case .stale: return "NEXUS"
        }
    }

    private var detail: String {
        if let snapshot, snapshot.isPending {
            return snapshot.pendingCount == 1
                ? GlanceText.t("1 tap still to send", "1 ketukan belum terkirim")
                : GlanceText.t("\(snapshot.pendingCount) taps still to send", "\(snapshot.pendingCount) ketukan belum terkirim")
        }
        switch state {
        case .working:
            if let out = snapshot?.expectedOutAt {
                return GlanceText.t("Until \(out.formatted(date: .omitted, time: .shortened))", "Sampai \(out.formatted(date: .omitted, time: .shortened))")
            }
            return GlanceText.t("Checked in", "Sudah check in")
        case .done: return GlanceText.t("Checked out", "Sudah check out")
        case .notCheckedIn: return GlanceText.t("Tap to check in", "Ketuk untuk absen")
        // Never claims a state it cannot know. A widget only refreshes while the app runs, so
        // yesterday's answer must not be presented as today's.
        case .stale: return GlanceText.t("Open NEXUS to refresh", "Buka NEXUS untuk memperbarui")
        }
    }

    private var inlineText: String {
        switch state {
        case .working: return pending ? GlanceText.t("Sending", "Mengirim") : (snapshot?.officeName ?? GlanceText.t("Working", "Bekerja"))
        case .done: return GlanceText.t("Checked out", "Sudah check out")
        case .notCheckedIn: return GlanceText.t("Not checked in", "Belum absen")
        case .stale: return GlanceText.t("Open NEXUS", "Buka NEXUS")
        }
    }
}
