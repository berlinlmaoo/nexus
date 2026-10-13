import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// Calendar widgets (0.1.7): what every calendar widget shares — the scope picker, the timeline, the
// gallery sample, links, colours and words. Each widget's own file only lays out.
//
// Nothing here decides anything about tasks. What is "next", what is overdue, which of the four lists
// a task falls in: all of that is CalendarGlance (Shared/CalendarGlance.swift), asked against the
// entry's own date — so a widget moves at WIB midnight and when a task's time passes, without the app.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Bundles

/// The Home Screen half. A WidgetBundle builder takes at most ten widgets, so the calendar's eleven
/// ride in two bundles that NEXUSWidgetsBundle folds in.
struct CalendarHomeWidgets: WidgetBundle {
    var body: some Widget {
        CalendarMonthWidget()
        CalendarUpcomingWidget()
        CalendarWeekWidget()
        CalendarListDoWidget()
        CalendarListPlanWidget()
        CalendarListActWidget()
        CalendarListLaterWidget()
    }
}

/// The Lock Screen half.
struct CalendarLockWidgets: WidgetBundle {
    var body: some Widget {
        CalendarNextWidget()
        CalendarWeekStripWidget()
        CalendarRingWidget()
        CalendarInlineWidget()
    }
}

// MARK: - Configuration

/// Whose tasks a widget shows — the picker on every calendar widget. GlanceScope itself cannot be the
/// parameter: the shared file is Foundation-only and also compiled into the watch, so the display
/// names an AppEnum needs live here instead.
enum CalendarScopeOption: String, AppEnum {
    case me, division, all

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scope"
    static var caseDisplayRepresentations: [CalendarScopeOption: DisplayRepresentation] = [
        .me: "Mine",
        .division: "My division",
        .all: "Everyone"
    ]

    var glance: GlanceScope {
        switch self {
        case .me: return .me
        case .division: return .division
        case .all: return .all
        }
    }
}

struct CalendarScopeIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Scope"
    static var description = IntentDescription("Whose tasks the widget shows.")

    /// Mine by default: the one scope everybody has. "My division" needs a card in the Bagan.
    @Parameter(title: "Scope", default: .me)
    var scope: CalendarScopeOption
}

/// The ring's second question: today's tasks, or how far into the year we are.
enum CalendarRingShow: String, AppEnum {
    case today, year

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"
    static var caseDisplayRepresentations: [CalendarRingShow: DisplayRepresentation] = [
        .today: "Today",
        .year: "Year"
    ]
}

/// Its own intent rather than an extra parameter on the shared one, so the other ten widgets never
/// offer a "Show" row that means nothing to them.
struct CalendarRingIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Today"
    static var description = IntentDescription("Today's tasks done, or the year so far.")

    @Parameter(title: "Scope", default: .me)
    var scope: CalendarScopeOption

    @Parameter(title: "Show", default: .today)
    var show: CalendarRingShow
}

// MARK: - Entry

struct CalendarWidgetEntry: TimelineEntry {
    /// The moment this entry stands for. Every view works its picture out against THIS date, never
    /// Date(): the entries for midnight and for "the minute after 19:00" are rendered ahead of time.
    let date: Date
    /// What the person picked for this widget.
    let requested: GlanceScope
    /// The app's last answer for that scope; nil when nothing was ever saved, or after signing out.
    let stored: GlanceStored?
    /// The ring only: the year instead of today.
    var showsYear: Bool = false

    var freshness: GlanceFreshness {
        CalendarGlance.freshness(stored?.snapshot, savedAt: stored?.savedAt ?? date, now: date)
    }

    /// The snapshot, when there is anything to draw. A stale one is still drawn on the Home Screen —
    /// its days are still its days — with the footer saying it may be behind. "none", "off" and
    /// "empty" draw the reason instead.
    var snapshot: GlanceSnapshot? {
        switch freshness {
        case .fresh, .stale: return stored?.snapshot
        case .empty, .none, .off: return nil
        }
    }

    /// Today in WIB, as of this entry.
    var today: String { CalendarGlance.clock(date).day }

    /// "Updated 14:05", or why there is nothing current.
    var footer: String { GlanceText.footer(freshness, savedAt: stored?.savedAt) }

    /// "My division" comes back as Mine for somebody without a card in the Bagan, and a widget
    /// labelled one thing that quietly shows another would be a lie — so it says so. The other
    /// scopes than Mine are named, so two widgets side by side can be told apart.
    var scopeNote: String? {
        if requested == .division, let s = stored?.snapshot, s.scope != requested.rawValue {
            return GlanceText.t("Mine (not in the chart yet)", "Saya (belum ada di Bagan)")
        }
        return requested == .me ? nil : GlanceText.scopeName(requested)
    }

    /// The scope a tap opens the Calendar on: what this widget shows. That is the server's answer, so
    /// "My division" for somebody without a card in the Bagan opens on Mine, as the widget draws it.
    var linkScope: GlanceScope {
        if let answered = stored.flatMap({ GlanceScope(rawValue: $0.snapshot.scope) }) { return answered }
        return requested
    }
}

// MARK: - Timeline

enum CalendarTimeline {
    /// One entry now, and one at every moment within a day at which the picture changes on its own:
    /// each WIB midnight, the minute after an open task's time, the moment the snapshot turns stale.
    /// After the last one WidgetKit asks again. A new snapshot does not wait for that — the app
    /// reloads the widgets whenever it saves one.
    static func make(scope: GlanceScope, showsYear: Bool, now: Date) -> Timeline<CalendarWidgetEntry> {
        let stored = GlanceStore.load(scope)
        var entries = [CalendarWidgetEntry(date: now, requested: scope, stored: stored, showsYear: showsYear)]
        guard let stored = stored else {
            // Nothing saved: only the date itself moves (the year ring). Look again at midnight, or
            // within the hour as a safety net for a save whose reload never arrived.
            let next = min(nextMidnight(after: now), now.addingTimeInterval(3600))
            return Timeline(entries: entries, policy: .after(next))
        }
        let times = CalendarGlance.redrawTimes(stored.snapshot, savedAt: stored.savedAt, now: now, horizon: 24 * 3600)
        for time in times {
            entries.append(CalendarWidgetEntry(date: time, requested: scope, stored: stored, showsYear: showsYear))
        }
        return Timeline(entries: entries, policy: .atEnd)
    }

    static func nextMidnight(after now: Date) -> Date {
        let tomorrow = CalDays.addDays(CalendarGlance.clock(now).day, 1)
        return CalendarGlance.date(ms: CalendarGlance.instantMs(tomorrow, "00:00"))
    }
}

/// Every calendar widget but the ring.
struct CalendarWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CalendarWidgetEntry {
        CalendarSample.entry(scope: .me, now: Date())
    }

    func snapshot(for configuration: CalendarScopeIntent, in context: Context) async -> CalendarWidgetEntry {
        let scope = configuration.scope.glance
        if context.isPreview { return CalendarSample.entry(scope: scope, now: Date()) }
        return CalendarWidgetEntry(date: Date(), requested: scope, stored: GlanceStore.load(scope))
    }

    func timeline(for configuration: CalendarScopeIntent, in context: Context) async -> Timeline<CalendarWidgetEntry> {
        CalendarTimeline.make(scope: configuration.scope.glance, showsYear: false, now: Date())
    }
}

/// The ring: the same timeline, plus its Today / Year choice.
struct CalendarRingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CalendarWidgetEntry {
        CalendarSample.entry(scope: .me, now: Date())
    }

    func snapshot(for configuration: CalendarRingIntent, in context: Context) async -> CalendarWidgetEntry {
        let scope = configuration.scope.glance
        let year = configuration.show == .year
        if context.isPreview { return CalendarSample.entry(scope: scope, now: Date(), showsYear: year) }
        return CalendarWidgetEntry(date: Date(), requested: scope, stored: GlanceStore.load(scope), showsYear: year)
    }

    func timeline(for configuration: CalendarRingIntent, in context: Context) async -> Timeline<CalendarWidgetEntry> {
        CalendarTimeline.make(scope: configuration.scope.glance, showsYear: configuration.show == .year, now: Date())
    }
}

// MARK: - Gallery sample

/// What the widget gallery and the placeholder draw: a believable fortnight of somebody's work, built
/// around today. Never the person's own data — a placeholder is exactly what iOS puts up when it
/// cannot (or must not) show the real thing.
enum CalendarSample {
    static func entry(scope: GlanceScope, now: Date, showsYear: Bool = false) -> CalendarWidgetEntry {
        let stored = GlanceStored(userId: "sample", savedAt: now, snapshot: snapshot(scope: scope, now: now))
        return CalendarWidgetEntry(date: now, requested: scope, stored: stored, showsYear: showsYear)
    }

    static func snapshot(scope: GlanceScope, now: Date) -> GlanceSnapshot {
        let today = CalendarGlance.clock(now).day
        let items: [GlanceEntry] = [
            item("s01", "Rekap absensi", day(today, -6), nil, "#10B981", "Operasional", "MEDIUM", done: true),
            item("s02", "Laporan mingguan", day(today, -3), nil, "#10B981", "Operasional", "MEDIUM", done: true),
            item("s03", "Revisi deck klien", day(today, -1), "15:00", "#F97316", "PATS x Brand", "URGENT"),
            item("s04", "Rapat koordinasi", day(today, 0), "09:00", "#10B981", "Operasional", "MEDIUM", done: true),
            item("s05", "Kirim invoice", day(today, 0), nil, "#10B981", "Operasional", "LOW"),
            item("s06", "Shooting konten", day(today, 0), "19:00", "#7B68EE", "Framework Agency", "HIGH"),
            item("s07", "Upload flyer", day(today, 1), "08:30", "#F97316", "PATS x Brand", "HIGH"),
            item("s08", "Brief klien radio", day(today, 1), nil, "#0EA5E9", "Suwara Radio", "MEDIUM"),
            item("s09", "Desain thumbnail", day(today, 2), "13:00", "#7B68EE", "Framework Agency", "LOW"),
            item("s10", "Persiapan event", day(today, 3), nil, "#7B68EE", "Framework Agency", "URGENT"),
            item("s11", "Review naskah siaran", day(today, 4), "10:00", "#0EA5E9", "Suwara Radio", "MEDIUM"),
            item("s12", "Proposal sponsor", day(today, 6), nil, "#EC4899", "Kemitraan", "HIGH"),
            item("s13", "Meeting vendor", day(today, 9), "14:00", "#F97316", "PATS x Brand", "MEDIUM"),
            item("s14", "Evaluasi kampanye", day(today, 13), nil, "#EC4899", "Kemitraan", "HIGH"),
            item("s15", "Rapat bulanan", day(today, 17), "09:30", "#10B981", "Operasional", "MEDIUM")
        ]
        let undated: [GlanceEntry] = [
            item("s20", "Riset referensi visual", nil, nil, "#7B68EE", "Framework Agency", "LOW"),
            item("s21", "Rapikan arsip foto", nil, nil, "#0EA5E9", "Suwara Radio", "NONE")
        ]
        return GlanceSnapshot(v: 1, userId: "sample", access: "all", scope: scope.rawValue, today: today,
                              from: CalDays.gridRange(today).from, to: day(today, 60), rules: .standard,
                              items: items, undated: undated, holidays: [], truncated: false)
    }

    private static func day(_ today: String, _ offset: Int) -> String {
        CalDays.addDays(today, offset)
    }

    private static func item(_ id: String, _ title: String, _ day: String?, _ time: String?, _ color: String,
                             _ project: String, _ priority: String, done: Bool = false) -> GlanceEntry {
        GlanceEntry(id: id, k: nil, t: title, day: day, time: time, c: color, p: project, prio: priority,
                    done: done, m: false, ns: nil)
    }
}

// MARK: - Links

/// Where a tap goes. The Calendar opens on the day; with a task id it opens that task as well. A masked
/// row carries no id on this side, so it can only ever open its day. Every link names the widget's
/// scope (`&scope=me|division|all`), so a "Mine" widget opens the Calendar on Mine rather than on
/// whatever the app last showed.
enum CalendarLink {
    static let root = URL(string: "nexus://calendar")!

    /// The Calendar itself, on today: `?scope=S`.
    static func calendar(scope: GlanceScope) -> URL {
        make([], scope: scope)
    }

    /// `?date=D&scope=S`.
    static func day(_ day: String, scope: GlanceScope) -> URL {
        make([URLQueryItem(name: "date", value: day)], scope: scope)
    }

    /// Dated: `?date=D&task=ID&scope=S`. Undated ("Someday"): `?task=ID&scope=S`. Masked: `?date=D&scope=S`,
    /// or the Calendar itself when it has no date either.
    static func task(_ bar: GlanceBar, scope: GlanceScope) -> URL {
        var items: [URLQueryItem] = []
        if let day = bar.day { items.append(URLQueryItem(name: "date", value: day)) }
        if !bar.masked, let id = bar.id { items.append(URLQueryItem(name: "task", value: id)) }
        return make(items, scope: scope)
    }

    private static func make(_ items: [URLQueryItem], scope: GlanceScope) -> URL {
        var c = URLComponents()
        c.scheme = "nexus"
        c.host = "calendar"
        c.queryItems = items + [URLQueryItem(name: "scope", value: scope.rawValue)]
        return c.url ?? root
    }
}

// MARK: - Colours

/// The colours a calendar widget draws with, for the appearance it is drawn in. iOS draws a widget
/// light and dark, with or without Increase Contrast, and a fixed hex reads in one of those at best, so
/// every colour here is picked per appearance and checked against the widget's own background: words
/// at 4.5:1 (7:1 with Increase Contrast), bars, dots and marks at 3:1 (4.5:1). A project's own colour
/// keeps its hue and only moves in lightness when it would otherwise vanish.
///
/// Built in each view from its environment: `CalendarInk(scheme, contrast)`.
struct CalendarInk {
    let dark: Bool
    let high: Bool

    init(_ scheme: ColorScheme, _ contrast: ColorSchemeContrast) {
        dark = scheme == .dark
        high = contrast == .increased
    }

    private var wordRatio: Double { high ? 7 : 4.5 }
    private var markRatio: Double { high ? 4.5 : 3 }

    static func color(_ c: GlanceColor.RGB) -> Color {
        Color(red: c.r, green: c.g, blue: c.b)
    }

    private func word(_ pair: GlanceColor.Pair) -> Color {
        Self.color(GlanceColor.readable(pair.pick(dark: dark), dark: dark, ratio: wordRatio))
    }

    private func mark(_ pair: GlanceColor.Pair) -> Color {
        Self.color(GlanceColor.readable(pair.pick(dark: dark), dark: dark, ratio: markRatio))
    }

    /// Violet words: "Coming up", today's number in the week, the attendance headline at work.
    var accent: Color { word(GlanceColor.violetText) }
    /// Today's disc: the app's violet, visible on the widget and deep enough for the white number on
    /// it. Where both cannot hold (Increase Contrast in dark), the number wins.
    var todayDisc: Color {
        let violet = GlanceColor.rgb(GlanceColor.violet.pick(dark: dark))
        let seen = GlanceColor.readable(violet, on: GlanceColor.surface(dark: dark), ratio: markRatio)
        return Self.color(GlanceColor.readable(seen, on: GlanceColor.white, ratio: wordRatio))
    }
    /// Today's column in the week: a wash of the same violet.
    var todayWash: Color { mark(GlanceColor.violet).opacity(dark ? 0.24 : 0.14) }
    /// Sundays, public holidays, an overdue due date.
    var red: Color { word(GlanceColor.red) }
    /// The outline round an overdue bar and the overdue mark on a row.
    var overdue: Color { mark(GlanceColor.overdue) }
    /// A task overdue for longer than the window.
    var stale: Color { mark(GlanceColor.slate) }
    var amber: Color { word(GlanceColor.amber) }
    var green: Color { word(GlanceColor.green) }

    /// A list's name and dot.
    func quadrant(_ q: GlanceQuadrant) -> Color {
        switch q {
        case .doFirst: return word(GlanceColor.red)
        case .plan: return word(GlanceColor.indigo)
        case .act: return word(GlanceColor.amber)
        case .later: return Color.secondary
        }
    }

    /// A colour the server or the attendance board chose ("#rrggbb"), as a bar or a dot.
    func task(_ hex: String) -> Color {
        Self.color(GlanceColor.readable(hex, dark: dark, ratio: markRatio))
    }

    /// One task's colour. In the tinted modes iOS throws the hue away, so there open, done and overdue
    /// differ by opacity alone — the marks drawn on top (tick, outline) carry the rest.
    func bar(_ b: GlanceBar, full: Bool) -> Color {
        if !full {
            if b.dim { return Color.primary.opacity(0.3) }
            return Color.primary.opacity(b.overdue == .recent ? 1 : 0.65)
        }
        if b.dim { return task(b.color).opacity(0.35) }
        // Overdue for longer than the window: it stays on its date, but grey — it is not news any more.
        if b.overdue == .stale { return stale }
        return task(b.color)
    }
}

// MARK: - Words

/// The few sentences the calendar widgets build out of GlanceText's pieces. Bilingual like the rest:
/// English first, Indonesian second, in the app's language.
enum CalendarWords {
    static var comingUp: String { GlanceText.t("Coming up", "Tidak lama lagi") }
    static var nothingComingUp: String { GlanceText.t("Nothing coming up", "Belum ada tugas mendatang") }
    static var nothingHere: String { GlanceText.t("Nothing here", "Tidak ada tugas di sini") }
    static var noDate: String { GlanceText.t("No date", "Tanpa tenggat") }

    /// "Day 278 · 76%" / "Hari ke-278 · 76%".
    static func yearProgress(_ y: GlanceYear) -> String {
        GlanceText.t("Day \(y.day) · \(y.percent)%", "Hari ke-\(y.day) · \(y.percent)%")
    }

    /// A list row's due: "Today · 19:00", "Thu 8", or "No date".
    static func due(_ bar: GlanceBar, today: String) -> String {
        guard let day = bar.day else { return noDate }
        let label = GlanceText.relativeDay(day, today: today)
        guard let time = bar.time else { return label }
        return label + " · " + GlanceText.time(time)
    }

    /// The Lock Screen's short form: "19:00" today, "Thu 19:00" another day, "Thu 8" when it has no time.
    static func when(_ bar: GlanceBar, today: String) -> String {
        short(day: bar.day, time: bar.time, today: today) ?? noDate
    }

    /// "3 due today · next 19:00"; "Nothing due today · next Thu 8".
    static func inline(_ i: GlanceInline, today: String) -> String {
        let base = i.openToday == 0
            ? GlanceText.t("Nothing due today", "Tidak ada tugas hari ini")
            : GlanceText.t("\(i.openToday) due today", "\(i.openToday) tugas hari ini")
        // A date-only task today has no moment to point at, and "due today" already counts it.
        if i.nextDay == today && i.nextTime == nil { return base }
        guard let next = short(day: i.nextDay, time: i.nextTime, today: today) else { return base }
        return base + " · " + GlanceText.t("next \(next)", "berikut \(next)")
    }

    private static func short(day: String?, time: String?, today: String) -> String? {
        guard let day = day else { return nil }
        if day == today {
            guard let time = time else { return GlanceText.t("Today", "Hari ini") }
            return GlanceText.time(time)
        }
        guard let time = time else { return GlanceText.weekdayDay(day) }
        return GlanceText.weekdayShort(day) + " " + GlanceText.time(time)
    }
}

/// Seven days a row. monthView always hands over 42; this never assumes it.
enum CalendarWeeks {
    static func split(_ cells: [GlanceDay]) -> [[GlanceDay]] {
        stride(from: 0, to: cells.count, by: 7).map { start in
            Array(cells[start..<min(start + 7, cells.count)])
        }
    }
}
