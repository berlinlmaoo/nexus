import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// The calendar's Home Screen pictures: the month (large, and extra large on iPad), the month beside
// what is coming up (medium), and this week (medium). The four lists live in CalendarListWidgets.swift.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Month

struct CalendarMonthWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarMonth", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarMonthWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.root)
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
    private var weekdays: some View {
        HStack(spacing: 0) {
            ForEach(weeks.first ?? [], id: \.day) { cell in
                Text(GlanceText.weekdayLetter(cell.day))
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(cell.sunday && full ? CalendarStyle.red : Color.secondary)
                    .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
                    .padding(.leading, wide ? 4 : 0)
            }
        }
    }

    private func row(_ days: [GlanceDay]) -> some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.day) { day in
                CalendarMonthCell(day: day, wide: wide, full: full)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

/// One day of the month. The whole cell opens that day in the Calendar.
struct CalendarMonthCell: View {
    let day: GlanceDay
    let wide: Bool
    let full: Bool

    var body: some View {
        Link(destination: CalendarLink.day(day.day)) {
            VStack(alignment: wide ? .leading : .center, spacing: wide ? 1 : 2) {
                number
                bars
            }
            .padding(.horizontal, wide ? 2 : 1.5)
            .padding(.top, 1)
            // min AND max: the cell takes exactly the height it is offered. With max alone a busy week
            // stays as tall as its bars and pushes the month's title and footer out of the widget on
            // the smaller iPads.
            .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
            .clipped()
            .contentShape(Rectangle())
            .opacity(day.inMonth ? 1 : 0.35)
            // A Link may tint its label like a button; the calendar's own colours win.
            .foregroundStyle(Color.primary)
        }
    }

    /// The number, with "+N" tucked into the corner so it costs no height.
    private var number: some View {
        ZStack(alignment: .topTrailing) {
            CalendarDayBadge(day: day, size: wide ? 14 : 18, fontSize: wide ? 9 : 11, full: full)
                .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
            if day.covered && day.more > 0 {
                Text(GlanceText.more(day.more))
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Outside the snapshot's window the widget knows nothing about a day — which is not the same as
    /// "nothing due" — so no bars at all rather than an empty day.
    @ViewBuilder private var bars: some View {
        if day.covered {
            ForEach(day.bars, id: \.key) { bar in
                if wide {
                    CalendarTitledBar(bar: bar, height: 9, fontSize: 7, full: full)
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
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.root)
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

/// The left half: the month as numbers with up to three dots a day, in the colours of that day's first
/// tasks. A sixth row only when the month reaches into it — the medium widget has no height to spare.
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

    /// Six weeks only fit the medium widget of the smallest iPhones with tighter rows.
    private var compact: Bool { weeks.count > 5 }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 1 : 2) {
            Text(GlanceText.monthYear(month.today))
                .font(.system(size: 10, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .widgetAccentable()
            HStack(spacing: 0) {
                ForEach(weeks.first ?? [], id: \.day) { cell in
                    Text(GlanceText.weekdayLetter(cell.day))
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundStyle(Color.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(0..<weeks.count, id: \.self) { i in
                CalendarMiniWeek(days: weeks[i], full: full, compact: compact)
            }
        }
    }
}

struct CalendarMiniWeek: View {
    let days: [GlanceDay]
    let full: Bool
    let compact: Bool

    var body: some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.day) { day in
                CalendarMiniCell(day: day, full: full, compact: compact)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

struct CalendarMiniCell: View {
    let day: GlanceDay
    let full: Bool
    let compact: Bool

    private var dot: CGFloat { compact ? 2.5 : 3 }

    var body: some View {
        Link(destination: CalendarLink.day(day.day)) {
            VStack(spacing: 1) {
                CalendarDayBadge(day: day, size: compact ? 11 : 12, fontSize: compact ? 7.5 : 8, full: full)
                dots
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .opacity(day.inMonth ? 1 : 0.3)
            .foregroundStyle(Color.primary)
        }
    }

    private var dots: some View {
        HStack(spacing: 1) {
            if day.covered {
                ForEach(day.bars, id: \.key) { bar in
                    Circle()
                        .fill(CalendarStyle.bar(bar, full: full))
                        .frame(width: dot, height: dot)
                }
            }
        }
        .frame(height: dot)
    }
}

/// The right half: the next four tasks still to do, from now on.
struct CalendarComingUp: View {
    let entry: CalendarWidgetEntry
    let list: GlanceList
    let full: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            header
            if list.rows.isEmpty {
                Text(CalendarWords.nothingComingUp)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(list.rows, id: \.key) { bar in
                    Link(destination: CalendarLink.task(bar)) {
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
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(full ? CalendarStyle.accent : Color.primary)
                .widgetAccentable()
            if let note = entry.scopeNote {
                Text(note)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// "Thu 8 · Upload flyer · 08:30" on one line, the day in a fixed column so the titles line up.
struct CalendarComingUpRow: View {
    let bar: GlanceBar
    let today: String
    let full: Bool

    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(CalendarStyle.bar(bar, full: full))
                .frame(width: 3, height: 13)
            Text(GlanceText.relativeDay(bar.day ?? today, today: today))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(width: 42, alignment: .leading)
            Text(GlanceText.title(bar))
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 2)
            if let time = bar.time {
                Text(GlanceText.time(time))
                    .font(.system(size: 10, weight: .medium).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(Color.primary)
    }
}

// MARK: - This week

struct CalendarWeekWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarWeek", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarWeekWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.root)
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
                    Link(destination: CalendarLink.day(day.day)) {
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
/// on a light accent wash.
struct CalendarWeekColumn: View {
    let day: GlanceDay
    let full: Bool

    var body: some View {
        VStack(spacing: 3) {
            VStack(spacing: 0) {
                Text(GlanceText.weekdayShort(day.day))
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(labelColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(GlanceText.dayNumber(day.day))
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(numberColor)
            }
            if day.covered {
                ForEach(day.bars, id: \.key) { bar in
                    CalendarTitledBar(bar: bar, height: 12, fontSize: 8, full: full)
                }
                if day.more > 0 {
                    Text(GlanceText.more(day.more))
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.secondary)
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

    private var labelColor: Color { red && full ? CalendarStyle.red : Color.secondary }

    private var numberColor: Color {
        if day.today { return full ? CalendarStyle.accent : Color.primary }
        if red { return full ? CalendarStyle.red : Color.secondary }
        return Color.primary
    }

    @ViewBuilder private var highlight: some View {
        if day.today {
            RoundedRectangle(cornerRadius: 6)
                .fill(full ? CalendarStyle.accent.opacity(0.14) : Color.primary.opacity(0.12))
                .widgetAccentable()
        }
    }
}
