import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// The calendar's Home Screen pictures: the month (large, and extra large on iPad), the month beside
// what is coming up (medium), and this week (medium). The four lists live in CalendarListWidgets.swift.
//
// Words follow the reading size up to Extra Large: past that a seven-column grid stops being a grid.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Month

struct CalendarMonthWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarMonth", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarMonthWidgetView(entry: entry)
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.calendar(scope: entry.linkScope))
        }
        .configurationDisplayName("Month")
        .description("This month at a glance.")
        .supportedFamilies([.systemLarge, .systemExtraLarge])
    }
}

struct CalendarMonthWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: CalendarWidgetEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            CalendarMonthGrid(entry: entry,
                              month: CalendarGlance.monthView(snapshot, now: entry.date, maxBars: 2),
                              wide: family == .systemExtraLarge,
                              full: mode == .fullColor)
        } else {
            CalendarEmptyView(entry: entry)
        }
    }
}

/// Six weeks, Monday first, always six: the grid does not jump in height from one month to the next.
struct CalendarMonthGrid: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let entry: CalendarWidgetEntry
    let month: GlanceMonth
    /// iPad's extra large: room for a title inside each bar.
    let wide: Bool
    let full: Bool
    let weeks: [[GlanceDay]]

    init(entry: CalendarWidgetEntry, month: GlanceMonth, wide: Bool, full: Bool) {
        self.entry = entry
        self.month = month
        self.wide = wide
        self.full = full
        self.weeks = CalendarWeeks.split(month.cells)
    }

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        VStack(spacing: 4) {
            header
            weekdays
            VStack(spacing: 0) {
                ForEach(0..<weeks.count, id: \.self) { i in
                    row(weeks[i])
                }
            }
            .frame(maxHeight: .infinity)
            CalendarFooter(entry: entry)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(GlanceText.monthYear(month.today))
                .font(.headline)
                .lineLimit(1)
                .widgetAccentable()
                .accessibilityAddTraits(.isHeader)
            if let note = entry.scopeNote {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(CalendarWords.yearProgress(month.year))
                .font(.caption2.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    /// Read from the grid's own first week, so the letters can never disagree with the days below.
    /// Silent to VoiceOver: every day says its own weekday.
    private var weekdays: some View {
        HStack(spacing: 0) {
            ForEach(weeks.first ?? [], id: \.day) { cell in
                Text(GlanceText.weekdayLetter(cell.day))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(cell.sunday && full ? ink.red : Color.secondary)
                    .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
                    .padding(.leading, wide ? 4 : 0)
            }
        }
        .accessibilityHidden(true)
    }

    private func row(_ days: [GlanceDay]) -> some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.day) { day in
                CalendarMonthCell(day: day, wide: wide, full: full, scope: entry.linkScope)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

/// One day of the month. The whole cell opens that day in the Calendar, on the widget's scope.
struct CalendarMonthCell: View {
    let day: GlanceDay
    let wide: Bool
    let full: Bool
    var scope: GlanceScope = .me

    var body: some View {
        Link(destination: CalendarLink.day(day.day, scope: scope)) {
            VStack(alignment: wide ? .leading : .center, spacing: wide ? 1 : 2) {
                number
                // Another month's day: its number in the secondary colour at full strength (the badge
                // does that), only its bars faded — the whole cell at 35% was 2.4:1 on the light
                // widget, the treatment the app's own grid already dropped.
                bars.opacity(day.inMonth ? 1 : 0.35)
            }
            .padding(.horizontal, wide ? 2 : 1.5)
            .padding(.top, 1)
            // min AND max: the cell takes exactly the height it is offered. With max alone a busy week
            // stays as tall as its bars and pushes the month's title and footer out of the widget on
            // the smaller iPads.
            .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
            .clipped()
            .contentShape(Rectangle())
            // A Link may tint its label like a button; the calendar's own colours win.
            .foregroundStyle(Color.primary)
        }
    }

    /// The number, with "+N" tucked into the corner so it costs no height. To VoiceOver it is the whole
    /// day — "Thursday 8 October, 3 tasks, some overdue" — since the bars below have no words.
    private var number: some View {
        ZStack(alignment: .topTrailing) {
            CalendarDayBadge(day: day, size: wide ? 15 : 18, fontSize: wide ? 10 : 11, full: full)
                .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
            if day.covered && day.more > 0 {
                Text(GlanceText.more(day.more))
                    .font(.caption2.weight(.semibold))
                    .minimumScaleFactor(0.8)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GlanceText.dayLabel(day))
    }

    /// Outside the snapshot's window the widget knows nothing about a day — which is not the same as
    /// "nothing due" — so no bars at all rather than an empty day.
    @ViewBuilder private var bars: some View {
        if day.covered {
            ForEach(day.bars, id: \.key) { bar in
                if wide {
                    CalendarTitledBar(bar: bar, height: 10, fontSize: 9, full: full)
                } else {
                    CalendarBarStrip(bar: bar, height: 5, full: full)
                }
            }
        }
    }
}

// MARK: - Month + Coming up

struct CalendarUpcomingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarUpcoming", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarUpcomingWidgetView(entry: entry)
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.calendar(scope: entry.linkScope))
        }
        .configurationDisplayName("Month + Coming up")
        .description("The month, and what comes next.")
        .supportedFamilies([.systemMedium])
    }
}

struct CalendarUpcomingWidgetView: View {
    @Environment(\.widgetRenderingMode) private var mode
    let entry: CalendarWidgetEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            HStack(alignment: .top, spacing: 12) {
                CalendarMiniMonth(month: CalendarGlance.monthView(snapshot, now: entry.date, maxBars: 3),
                                  full: mode == .fullColor)
                    .frame(width: 112)
                CalendarComingUp(entry: entry,
                                 list: CalendarGlance.upcoming(snapshot, now: entry.date, limit: 4),
                                 full: mode == .fullColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            CalendarEmptyView(entry: entry)
        }
    }
}

/// How big the mini month's words and marks are drawn.
struct CalendarMiniMetrics {
    let title: CGFloat
    let letter: CGFloat
    let number: CGFloat
    let badge: CGFloat
    let dot: CGFloat

    /// 11 pt words: what fits on most phones.
    static let roomy = CalendarMiniMetrics(title: 11, letter: 11, number: 11, badge: 14, dot: 3)
    /// Six weeks in the medium widget of the smallest iPhones: the only size that still fits there.
    static let compact = CalendarMiniMetrics(title: 10, letter: 8, number: 8.5, badge: 11, dot: 2.5)
}

/// The left half: the month as numbers with up to three dots a day, in the colours of that day's first
/// tasks. A sixth row only when the month reaches into it — the medium widget has no height to spare.
///
/// No day here is its own link: seven of them across 112 pt are 16 pt targets that open the neighbour
/// as often as the day. A tap anywhere on this half opens the Calendar (the widget's own URL), as on
/// Apple's Calendar widget; the tasks on the right open themselves.
struct CalendarMiniMonth: View {
    let month: GlanceMonth
    let full: Bool
    let weeks: [[GlanceDay]]

    init(month: GlanceMonth, full: Bool) {
        self.month = month
        self.full = full
        let all = CalendarWeeks.split(month.cells)
        if all.count == 6, let first = all[5].first, !first.inMonth {
            self.weeks = Array(all.prefix(5))
        } else {
            self.weeks = all
        }
    }

    var body: some View {
        // The roomier layout wherever it fits, the tighter one where it does not.
        ViewThatFits(in: .vertical) {
            CalendarMiniGrid(month: month, weeks: weeks, full: full, metrics: .roomy)
            CalendarMiniGrid(month: month, weeks: weeks, full: full, metrics: .compact)
        }
    }
}

struct CalendarMiniGrid: View {
    let month: GlanceMonth
    let weeks: [[GlanceDay]]
    let full: Bool
    let metrics: CalendarMiniMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(GlanceText.monthYear(month.today))
                .font(.system(size: metrics.title, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .widgetAccentable()
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 0) {
                ForEach(weeks.first ?? [], id: \.day) { cell in
                    Text(GlanceText.weekdayLetter(cell.day))
                        .font(.system(size: metrics.letter, weight: .semibold))
                        .foregroundStyle(Color.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
            ForEach(0..<weeks.count, id: \.self) { i in
                CalendarMiniWeek(days: weeks[i], full: full, metrics: metrics)
            }
        }
    }
}

struct CalendarMiniWeek: View {
    let days: [GlanceDay]
    let full: Bool
    let metrics: CalendarMiniMetrics

    var body: some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.day) { day in
                CalendarMiniCell(day: day, full: full, metrics: metrics)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

/// One day: its number and up to three dots. To VoiceOver, the day in words; the days of the
/// neighbouring months are left out. Those draw their number in the secondary colour at full strength
/// and only their dots faded (the whole cell at 30% was 2.1:1 on the light widget).
struct CalendarMiniCell: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let day: GlanceDay
    let full: Bool
    let metrics: CalendarMiniMetrics

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        VStack(spacing: 1) {
            CalendarDayBadge(day: day, size: metrics.badge, fontSize: metrics.number, full: full)
            dots.opacity(day.inMonth ? 1 : 0.35)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GlanceText.dayLabel(day))
        .accessibilityHidden(!day.inMonth)
    }

    private var dots: some View {
        HStack(spacing: 1) {
            if day.covered {
                ForEach(day.bars, id: \.key) { bar in
                    Circle()
                        .fill(ink.bar(bar, full: full))
                        .frame(width: metrics.dot, height: metrics.dot)
                }
            }
        }
        .frame(height: metrics.dot)
    }
}

/// The right half: the next four tasks still to do, from now on.
struct CalendarComingUp: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let entry: CalendarWidgetEntry
    let list: GlanceList
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            if list.rows.isEmpty {
                Text(CalendarWords.nothingComingUp)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(list.rows, id: \.key) { bar in
                    Link(destination: CalendarLink.task(bar, scope: entry.linkScope)) {
                        CalendarComingUpRow(bar: bar, today: entry.today, full: full)
                    }
                }
            }
            Spacer(minLength: 0)
            CalendarFooter(entry: entry, leading: list.more > 0 ? GlanceText.more(list.more, long: true) : nil)
        }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Text(CalendarWords.comingUp)
                .font(.caption.weight(.semibold))
                .foregroundStyle(full ? ink.accent : Color.primary)
                .widgetAccentable()
                .accessibilityAddTraits(.isHeader)
            if let note = entry.scopeNote {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// "Thu 8 · Upload flyer · 08:30" on one line, the day in a fixed column so the titles line up.
struct CalendarComingUpRow: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let bar: GlanceBar
    let today: String
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(ink.bar(bar, full: full))
                .frame(width: 3, height: 13)
                .accessibilityHidden(true)
            Text(GlanceText.relativeDay(bar.day ?? today, today: today))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(width: 46, alignment: .leading)
            Text(GlanceText.title(bar))
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 2)
            if let time = bar.time {
                Text(GlanceText.time(time))
                    .font(.caption2.weight(.medium).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(Color.primary)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - This week

struct CalendarWeekWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarWeek", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarWeekWidgetView(entry: entry)
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.calendar(scope: entry.linkScope))
        }
        .configurationDisplayName("This week")
        .description("Monday to Sunday at a glance.")
        .supportedFamilies([.systemMedium])
    }
}

struct CalendarWeekWidgetView: View {
    @Environment(\.widgetRenderingMode) private var mode
    let entry: CalendarWidgetEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            CalendarWeekColumns(entry: entry,
                                days: CalendarGlance.weekView(snapshot, now: entry.date, maxBars: 3),
                                full: mode == .fullColor)
        } else {
            CalendarEmptyView(entry: entry)
        }
    }
}

struct CalendarWeekColumns: View {
    let entry: CalendarWidgetEntry
    let days: [GlanceDay]
    let full: Bool

    var body: some View {
        VStack(spacing: 4) {
            HStack(alignment: .top, spacing: 3) {
                ForEach(days, id: \.day) { day in
                    Link(destination: CalendarLink.day(day.day, scope: entry.linkScope)) {
                        CalendarWeekColumn(day: day, full: full)
                    }
                }
            }
            .frame(maxHeight: .infinity)
            CalendarFooter(entry: entry, leading: entry.scopeNote)
        }
    }
}

/// One day: weekday and number on top, up to three titled bars, "+N" under them. Today's column sits
/// on a light violet wash.
struct CalendarWeekColumn: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let day: GlanceDay
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        VStack(spacing: 2) {
            // VoiceOver hears the day in words here, then each title, then "2 more".
            VStack(spacing: 0) {
                Text(GlanceText.weekdayShort(day.day))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(labelColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(GlanceText.dayNumber(day.day))
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(numberColor)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(GlanceText.dayLabel(day))
            if day.covered {
                ForEach(day.bars, id: \.key) { bar in
                    CalendarTitledBar(bar: bar, height: 13, fontSize: 10, full: full)
                }
                if day.more > 0 {
                    Text(GlanceText.more(day.more))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(GlanceText.moreSpoken(day.more))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background { highlight }
        .contentShape(Rectangle())
        .foregroundStyle(Color.primary)
    }

    private var red: Bool { day.sunday || day.holiday != nil }

    private var labelColor: Color { red && full ? ink.red : Color.secondary }

    private var numberColor: Color {
        if day.today { return full ? ink.accent : Color.primary }
        if red { return full ? ink.red : Color.secondary }
        return Color.primary
    }

    @ViewBuilder private var highlight: some View {
        if day.today {
            RoundedRectangle(cornerRadius: 6)
                .fill(full ? ink.todayWash : Color.primary.opacity(0.12))
                .widgetAccentable()
        }
    }
}
