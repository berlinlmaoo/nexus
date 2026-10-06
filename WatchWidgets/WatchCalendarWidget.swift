import AppIntents
import SwiftUI
import WidgetKit

// ─────────────────────────────────────────────────────────────────────────────
// Calendar complications (0.1.7): what is due next, and how much of today is done.
//
// Drawn from the GlanceSnapshot the watch app saves per scope into the watch's shared container
// (WatchCalendarGlance), worked out against each entry's own time with the same rules the phone's
// widgets and the web use (Shared/CalendarGlance.swift). Never touches the network or the session.
//
// Two widgets rather than one: the ring has a choice (today / the year) that means nothing to the
// others, and a watch face offers configurations only as the provider's recommendations — there is no
// editing screen on watchOS — so each widget recommends exactly the variants that make sense for it.
// Every word on the face comes from GlanceText (the app's language, mirrored into the container); the
// names in the face editor follow the device's language through the .lproj tables.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Configuration

enum WatchCalendarScope: String, AppEnum {
    case me, division, all

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scope"
    static var caseDisplayRepresentations: [WatchCalendarScope: DisplayRepresentation] = [
        .me: "Mine",
        .division: "My division",
        .all: "Everyone",
    ]

    var glance: GlanceScope {
        switch self {
        case .me: return .me
        case .division: return .division
        case .all: return .all
        }
    }
}

enum WatchCalendarRingShow: String, AppEnum {
    case today, year

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"
    static var caseDisplayRepresentations: [WatchCalendarRingShow: DisplayRepresentation] = [
        .today: "Today",
        .year: "Year",
    ]
}

struct WatchCalendarIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Calendar"
    static var description = IntentDescription("Your tasks from the NEXUS Calendar.")

    @Parameter(title: "Scope", default: .me)
    var scope: WatchCalendarScope

    init() {}

    init(scope: WatchCalendarScope) {
        self.scope = scope
    }
}

struct WatchCalendarRingIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Calendar progress"
    static var description = IntentDescription("Your tasks from the NEXUS Calendar.")

    @Parameter(title: "Scope", default: .me)
    var scope: WatchCalendarScope

    @Parameter(title: "Show", default: .today)
    var show: WatchCalendarRingShow

    init() {}

    init(scope: WatchCalendarScope, show: WatchCalendarRingShow) {
        self.scope = scope
        self.show = show
    }
}

// MARK: - Timeline

struct WatchCalendarEntry: TimelineEntry {
    let date: Date
    let scope: GlanceScope
    /// Nil: nothing saved for this scope (signed out, or the app has not fetched yet).
    let stored: GlanceStored?
    /// The ring only: how far the year has gone instead of today's tasks.
    let year: Bool
}

enum WatchCalendarTimeline {
    /// An entry at now and at every moment the picture changes on its own — each WIB midnight, the
    /// minute after an open task's time, the moment the snapshot turns stale — over the next day.
    /// `.atEnd` then asks again, at the latest one midnight from now.
    static func timeline(scope: GlanceScope, year: Bool) -> Timeline<WatchCalendarEntry> {
        let now = Date()
        let stored = GlanceStore.load(scope)
        var dates: [Date] = [now]
        if let stored, !year {
            dates += CalendarGlance.redrawTimes(stored.snapshot, savedAt: stored.savedAt, now: now, horizon: 24 * 3600)
        } else {
            // The year moves only at midnight; with nothing saved, midnight is still worth a look.
            dates.append(nextMidnight(after: now))
        }
        let entries: [WatchCalendarEntry] = dates.map { WatchCalendarEntry(date: $0, scope: scope, stored: stored, year: year) }
        return Timeline(entries: entries, policy: .atEnd)
    }

    /// What the face gallery shows before the app has saved anything: a believable day, never anyone's.
    static func entry(scope: GlanceScope, year: Bool, preview: Bool) -> WatchCalendarEntry {
        let now = Date()
        let stored = GlanceStore.load(scope) ?? (preview ? sample(now: now, scope: scope) : nil)
        return WatchCalendarEntry(date: now, scope: scope, stored: stored, year: year)
    }

    static func placeholder(year: Bool) -> WatchCalendarEntry {
        let now = Date()
        return WatchCalendarEntry(date: now, scope: .me, stored: sample(now: now, scope: .me), year: year)
    }

    private static func nextMidnight(after now: Date) -> Date {
        let tomorrow = CalDays.addDays(CalendarGlance.clock(now).day, 1)
        return CalendarGlance.date(ms: CalendarGlance.instantMs(tomorrow, "00:00"))
    }

    private static func sample(now: Date, scope: GlanceScope) -> GlanceStored {
        let today = CalendarGlance.clock(now).day
        let tomorrow = CalDays.addDays(today, 1)
        func task(_ key: String, _ en: String, _ id: String, day: String, time: String?, done: Bool) -> GlanceEntry {
            GlanceEntry(id: key, k: nil, t: GlanceText.t(en, id), day: day, time: time, c: "#7B68EE",
                        p: nil, prio: "MEDIUM", done: done, m: false, ns: nil)
        }
        let items: [GlanceEntry] = [
            task("s1", "Stand-up notes", "Catatan stand-up", day: today, time: nil, done: true),
            task("s2", "Client brief", "Brief klien", day: today, time: nil, done: true),
            task("s3", "Weekly report", "Laporan mingguan", day: today, time: nil, done: false),
            task("s4", "Design review", "Review desain", day: tomorrow, time: "09:00", done: false),
            task("s5", "Content plan", "Rencana konten", day: tomorrow, time: "14:00", done: false),
        ]
        let snapshot = GlanceSnapshot(v: 1, userId: "", access: "all", scope: scope.rawValue, today: today,
                                      from: CalDays.addDays(today, -14), to: CalDays.addDays(today, 30),
                                      rules: nil, items: items, undated: [], holidays: [], truncated: false)
        return GlanceStored(userId: "", savedAt: now, snapshot: snapshot)
    }
}

struct WatchCalendarProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WatchCalendarEntry {
        WatchCalendarTimeline.placeholder(year: false)
    }

    func snapshot(for configuration: WatchCalendarIntent, in context: Context) async -> WatchCalendarEntry {
        WatchCalendarTimeline.entry(scope: configuration.scope.glance, year: false, preview: context.isPreview)
    }

    func timeline(for configuration: WatchCalendarIntent, in context: Context) async -> Timeline<WatchCalendarEntry> {
        WatchCalendarTimeline.timeline(scope: configuration.scope.glance, year: false)
    }

    /// The face editor's list for this widget — on watchOS it is the only way to pick a scope.
    func recommendations() -> [AppIntentRecommendation<WatchCalendarIntent>] {
        [
            AppIntentRecommendation(intent: WatchCalendarIntent(scope: .me), description: "My tasks"),
            AppIntentRecommendation(intent: WatchCalendarIntent(scope: .division), description: "My division's tasks"),
            AppIntentRecommendation(intent: WatchCalendarIntent(scope: .all), description: "Everyone's tasks"),
        ]
    }
}

struct WatchCalendarRingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WatchCalendarEntry {
        WatchCalendarTimeline.placeholder(year: false)
    }

    func snapshot(for configuration: WatchCalendarRingIntent, in context: Context) async -> WatchCalendarEntry {
        WatchCalendarTimeline.entry(scope: configuration.scope.glance, year: configuration.show == .year,
                                    preview: context.isPreview)
    }

    func timeline(for configuration: WatchCalendarRingIntent, in context: Context) async -> Timeline<WatchCalendarEntry> {
        WatchCalendarTimeline.timeline(scope: configuration.scope.glance, year: configuration.show == .year)
    }

    /// Today's ring once per scope; the year once, because it is the same for every scope.
    func recommendations() -> [AppIntentRecommendation<WatchCalendarRingIntent>] {
        [
            AppIntentRecommendation(intent: WatchCalendarRingIntent(scope: .me, show: .today), description: "Today · My tasks"),
            AppIntentRecommendation(intent: WatchCalendarRingIntent(scope: .division, show: .today), description: "Today · My division"),
            AppIntentRecommendation(intent: WatchCalendarRingIntent(scope: .all, show: .today), description: "Today · Everyone"),
            AppIntentRecommendation(intent: WatchCalendarRingIntent(scope: .me, show: .year), description: "Year progress"),
        ]
    }
}

// MARK: - Widgets

/// "Next" (rectangular), the one-liner (inline) and today's open count (corner).
struct WatchCalendarWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSWatchCalendar", intent: WatchCalendarIntent.self,
                               provider: WatchCalendarProvider()) { entry in
            WatchCalendarView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "nexus://calendar"))
        }
        .configurationDisplayName("Calendar")
        .description("What's due next, and how much is left today.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

/// Today's ring, or the year's.
struct WatchCalendarRingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSWatchCalendarRing", intent: WatchCalendarRingIntent.self,
                               provider: WatchCalendarRingProvider()) { entry in
            WatchCalendarCircularView(state: WatchCalendarState(entry), year: entry.year)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "nexus://calendar"))
        }
        .configurationDisplayName("Calendar progress")
        .description("Today's tasks done, or how far the year has gone.")
        .supportedFamilies([.accessoryCircular])
    }
}

// MARK: - What every view works out first

struct WatchCalendarState {
    /// The entry's moment, not the wall clock: the timeline renders ahead of time.
    let now: Date
    let today: String
    let scope: GlanceScope
    let snapshot: GlanceSnapshot?
    let savedAt: Date?
    let freshness: GlanceFreshness

    init(_ entry: WatchCalendarEntry) {
        now = entry.date
        today = CalendarGlance.clock(entry.date).day
        scope = entry.scope
        snapshot = entry.stored?.snapshot
        savedAt = entry.stored?.savedAt
        freshness = CalendarGlance.freshness(entry.stored?.snapshot, savedAt: entry.stored?.savedAt ?? entry.date,
                                             now: entry.date)
    }

    /// The snapshot, only while it may be shown as current. Stale is not drawn: two-day-old tasks
    /// presented as today's would be a confident, wrong answer.
    var current: GlanceSnapshot? { freshness == .fresh ? snapshot : nil }

    /// GlanceText.footer, cut down for a corner or an inline slot.
    var shortReason: String {
        switch freshness {
        case .none, .off: return GlanceText.t("Calendar not on", "Kalender belum aktif")
        default: return GlanceText.t("Open NEXUS", "Buka NEXUS")
        }
    }

    var reasonSymbol: String {
        freshness == .stale ? "arrow.clockwise" : "calendar"
    }

    /// What the server answered for: "My division" without a card in the Bagan comes back as "me",
    /// and the face must not label the wearer's own tasks as the division's.
    var shownScope: GlanceScope {
        snapshot.flatMap { GlanceScope(rawValue: $0.scope) } ?? scope
    }
}

/// "19:00" today; "Tomorrow 09:00" / "Thu 8" on another day.
func watchCalendarWhen(_ bar: GlanceBar, today: String) -> String {
    guard let day = bar.day else { return "" }
    if day == today {
        return bar.time.map { GlanceText.time($0) } ?? GlanceText.t("Today", "Hari ini")
    }
    let relative = GlanceText.relativeDay(day, today: today)
    guard let time = bar.time else { return relative }
    return relative + " " + GlanceText.time(time)
}

/// "3 due today · next 19:00" / "3 tugas hari ini · berikut 19.00".
func watchCalendarInline(_ s: GlanceSnapshot, now: Date, today: String) -> String {
    let line = CalendarGlance.inline(s, now: now)
    let head = line.openToday > 0
        ? GlanceText.t("\(line.openToday) due today", "\(line.openToday) tugas hari ini")
        : GlanceText.t("Nothing due today", "Tidak ada tugas hari ini")
    guard let day = line.nextDay else { return head }
    let next: String
    switch CalDays.dayDiff(today, day) {
    case 0:
        // A date-only task today says nothing the count does not already say.
        guard let time = line.nextTime else { return head }
        next = GlanceText.time(time)
    case 1:
        next = GlanceText.t("tomorrow", "besok") + (line.nextTime.map { " " + GlanceText.time($0) } ?? "")
    default:
        next = GlanceText.weekdayDay(day) + (line.nextTime.map { " " + GlanceText.time($0) } ?? "")
    }
    return head + " · " + GlanceText.t("next \(next)", "berikut \(next)")
}

// MARK: - Views

struct WatchCalendarView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WatchCalendarEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            WatchCalendarInlineView(state: WatchCalendarState(entry))
        case .accessoryCorner:
            WatchCalendarCornerView(state: WatchCalendarState(entry))
        default:
            WatchCalendarRectangularView(state: WatchCalendarState(entry))
        }
    }
}

/// "Next": up to three open tasks still to come, time first. Three rows when the face has the room
/// for them, two otherwise.
struct WatchCalendarRectangularView: View {
    let state: WatchCalendarState

    var body: some View {
        if let s = state.current {
            let rows: [GlanceBar] = CalendarGlance.upcoming(s, now: state.now, limit: 3).rows
            if rows.isEmpty {
                VStack(alignment: .leading, spacing: 1) {
                    header
                    Text(GlanceText.t("Nothing coming up", "Tidak ada tugas mendatang"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ViewThatFits(in: .vertical) {
                    list(rows)
                    list(Array(rows.prefix(2)))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 1) {
                header
                Text(GlanceText.footer(state.freshness, savedAt: state.savedAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func list(_ rows: [GlanceBar]) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            header
            ForEach(rows, id: \.key) { bar in
                WatchCalendarRow(bar: bar, today: state.today)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Next", and the scope when it is not the wearer's own tasks.
    private var header: some View {
        HStack(spacing: 4) {
            Text(GlanceText.t("Next", "Berikutnya"))
                .font(.caption.weight(.semibold))
                .widgetAccentable()
            if state.shownScope != .me {
                Text(GlanceText.scopeName(state.shownScope))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
    }
}

struct WatchCalendarRow: View {
    let bar: GlanceBar
    let today: String

    var body: some View {
        HStack(spacing: 4) {
            Text(watchCalendarWhen(bar, today: today))
                .font(.caption2.weight(.semibold).monospacedDigit())
                .widgetAccentable()
                .layoutPriority(1)
            // A masked row is a private project the wearer is not in: "Internal task", never a title.
            Text(GlanceText.title(bar))
                .font(.caption2)
                .foregroundStyle(bar.masked ? Color.secondary : Color.primary)
                .privacySensitive()
        }
        .lineLimit(1)
    }
}

/// "3 due today · next 19:00".
struct WatchCalendarInlineView: View {
    let state: WatchCalendarState

    var body: some View {
        // Counts and a time only, no title, so nothing here needs hiding when the wrist is down.
        if let s = state.current {
            Label(watchCalendarInline(s, now: state.now, today: state.today), systemImage: "calendar")
        } else {
            Label(state.shortReason, systemImage: state.reasonSymbol)
        }
    }
}

/// The tasks still open today, with today's done / all along the curve.
struct WatchCalendarCornerView: View {
    let state: WatchCalendarState

    var body: some View {
        if let s = state.current {
            let ring: GlanceRing = CalendarGlance.todayRing(s, now: state.now)
            let open: Int = CalendarGlance.inline(s, now: state.now).openToday
            if ring.total > 0 {
                count(open)
                    .widgetLabel {
                        Gauge(value: Double(ring.done), in: 0...Double(ring.total)) {
                            Text(GlanceText.t("Today", "Hari ini"))
                        } currentValueLabel: {
                            Text(verbatim: "\(ring.done)")
                        } minimumValueLabel: {
                            Text(verbatim: "\(ring.done)")
                        } maximumValueLabel: {
                            Text(verbatim: "\(ring.total)")
                        }
                    }
            } else {
                count(open)
                    .widgetLabel {
                        Text(GlanceText.t("Nothing today", "Kosong hari ini"))
                    }
            }
        } else {
            Image(systemName: state.reasonSymbol)
                .font(.system(size: 18, weight: .semibold))
                .widgetAccentable()
                .widgetLabel {
                    Text(state.shortReason)
                }
        }
    }

    private func count(_ n: Int) -> some View {
        Text(verbatim: "\(n)")
            .font(.system(size: 22, weight: .semibold, design: .rounded).monospacedDigit())
            .widgetAccentable()
    }
}

/// Today: done / all as a ring, "3/5" inside. Year: "76%". The year needs no snapshot, so it shows
/// even signed out.
struct WatchCalendarCircularView: View {
    let state: WatchCalendarState
    let year: Bool

    var body: some View {
        if year {
            let progress: GlanceYear = CalendarGlance.yearProgress(state.today)
            Gauge(value: Double(progress.percent), in: 0...100) {
                Text(GlanceText.t("Year", "Tahun"))
            } currentValueLabel: {
                Text(verbatim: "\(progress.percent)%")
                    .font(.system(size: 14, weight: .semibold, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.6)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
        } else if let s = state.current {
            let ring: GlanceRing = CalendarGlance.todayRing(s, now: state.now)
            // An empty day: an empty ring and "0", rather than a range that starts and ends at zero.
            Gauge(value: Double(ring.done), in: 0...Double(max(ring.total, 1))) {
                Text(GlanceText.t("Today", "Hari ini"))
            } currentValueLabel: {
                Text(verbatim: ring.total > 0 ? "\(ring.done)/\(ring.total)" : "0")
                    .font(.system(size: 14, weight: .semibold, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.6)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: state.reasonSymbol)
                    .font(.system(size: 18, weight: .semibold))
                    .widgetAccentable()
            }
            .accessibilityLabel(state.shortReason)
        }
    }
}
