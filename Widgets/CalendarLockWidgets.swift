import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// The calendar on the Lock Screen: the next tasks, the week as dots, a ring, and one line.
//
// iOS draws these in a single tint, so nothing here may depend on colour: filled against hollow,
// a pill against a letter, a number in a ring. Titles are privacySensitive — the Lock Screen is
// exactly where somebody else reads them — and redacted while the phone is locked.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Next

struct CalendarNextWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarNext", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarNextView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarNextView.link(entry))
        }
        .configurationDisplayName("Next")
        .description("Your next tasks and their times.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct CalendarNextView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        if let snapshot = entry.snapshot, entry.freshness == .fresh {
            CalendarNextRows(rows: CalendarGlance.upcoming(snapshot, now: entry.date, limit: 3).rows,
                             today: entry.today)
        } else {
            CalendarAccessoryNotice(entry: entry)
        }
    }

    /// The first task when there is one, so a tap lands on what the widget leads with.
    static func link(_ entry: CalendarWidgetEntry) -> URL {
        guard let snapshot = entry.snapshot, entry.freshness == .fresh,
              let first = CalendarGlance.upcoming(snapshot, now: entry.date, limit: 1).rows.first
        else { return CalendarLink.calendar(scope: entry.linkScope) }
        return CalendarLink.task(first, scope: entry.linkScope)
    }
}

/// "19:00 Shooting konten", up to three lines.
struct CalendarNextRows: View {
    let rows: [GlanceBar]
    let today: String

    var body: some View {
        if rows.isEmpty {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle")
                    .accessibilityHidden(true)
                Text(CalendarWords.nothingComingUp)
                    .lineLimit(2)
            }
            .font(.system(size: 13, weight: .semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(rows, id: \.key) { bar in
                    CalendarNextRow(bar: bar, today: today)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct CalendarNextRow: View {
    let bar: GlanceBar
    let today: String

    var body: some View {
        HStack(spacing: 5) {
            Text(CalendarWords.when(bar, today: today))
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .widgetAccentable()
            Text(GlanceText.title(bar))
                .font(.system(size: 13))
                .lineLimit(1)
                .privacySensitive()
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Week strip

struct CalendarWeekStripWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarWeekStrip", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarWeekStripView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.day(entry.today, scope: entry.linkScope))
        }
        .configurationDisplayName("Week")
        .description("This week's tasks as dots.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct CalendarWeekStripView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            VStack(alignment: .leading, spacing: 4) {
                Text(summary(snapshot))
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 0) {
                    ForEach(CalendarGlance.weekView(snapshot, now: entry.date, maxBars: 0), id: \.day) { day in
                        CalendarStripDay(day: day)
                    }
                }
            }
        } else {
            CalendarAccessoryNotice(entry: entry)
        }
    }

    /// The same line as the inline widget while the snapshot is current. Once it is behind, that line
    /// says so instead — the dots stay, since they are still that snapshot's days.
    private func summary(_ snapshot: GlanceSnapshot) -> String {
        guard entry.freshness == .fresh else { return entry.footer }
        return CalendarWords.inline(CalendarGlance.inline(snapshot, now: entry.date), today: entry.today)
    }
}

/// A weekday letter over 0–3 dots: one per task, filled while anything that day is still to do, hollow
/// once all of it is done. Today's letter is cut out of a filled pill. VoiceOver hears the day in
/// words — "Today, Thursday 8 October, 3 tasks" — rather than a letter and some dots.
struct CalendarStripDay: View {
    let day: GlanceDay

    var body: some View {
        VStack(spacing: 3) {
            letter
            dots
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GlanceText.dayLabel(day))
    }

    @ViewBuilder private var letter: some View {
        if day.today {
            // destinationOut punches the letter through the pill, so it reads as "inverted" in the
            // Lock Screen's single tint, where a second colour for the letter would not exist.
            ZStack {
                Capsule().fill(Color.primary)
                Text(GlanceText.weekdayLetter(day.day))
                    .font(.system(size: 11, weight: .bold))
                    .blendMode(.destinationOut)
            }
            .compositingGroup()
            .frame(width: 18, height: 15)
            .widgetAccentable()
        } else {
            Text(GlanceText.weekdayLetter(day.day))
                .font(.system(size: 11, weight: .medium))
                .frame(width: 18, height: 15)
        }
    }

    private var dots: some View {
        HStack(spacing: 2) {
            ForEach(0..<dotCount, id: \.self) { _ in
                dot
            }
        }
        .frame(height: 4)
    }

    /// Outside the snapshot's window nothing is known, so nothing is drawn.
    private var dotCount: Int { day.covered ? min(3, day.count) : 0 }

    @ViewBuilder private var dot: some View {
        if day.open > 0 {
            Circle().fill(Color.primary).frame(width: 4, height: 4)
        } else {
            Circle().stroke(Color.primary, lineWidth: 1).frame(width: 4, height: 4)
        }
    }
}

// MARK: - Ring

struct CalendarRingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarRing", intent: CalendarRingIntent.self,
                               provider: CalendarRingProvider()) { entry in
            CalendarRingView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.day(entry.today, scope: entry.linkScope))
        }
        .configurationDisplayName("Today")
        .description("Today's tasks done, or the year so far.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct CalendarRingView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        if entry.showsYear {
            // Needs no snapshot at all: the year moves whether or not anybody is signed in.
            CalendarYearGauge(year: CalendarGlance.yearProgress(entry.today))
        } else if let snapshot = entry.snapshot, entry.freshness == .fresh {
            CalendarTodayGauge(ring: CalendarGlance.todayRing(snapshot, now: entry.date))
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: CalendarEmptyView.symbol(entry.freshness))
                    .font(.system(size: 18, weight: .semibold))
            }
        }
    }
}

/// Done out of everything due today. A day with nothing due shows a calendar rather than "0/0".
struct CalendarTodayGauge: View {
    let ring: GlanceRing

    var body: some View {
        Gauge(value: Double(ring.done), in: 0...Double(max(1, ring.total))) {
            Image(systemName: "checkmark")
        } currentValueLabel: {
            if ring.total == 0 {
                Image(systemName: "calendar")
            } else {
                Text(verbatim: "\(ring.done)/\(ring.total)")
            }
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GlanceText.t("Today's tasks", "Tugas hari ini"))
        .accessibilityValue(ring.total == 0
                            ? GlanceText.taskCount(0)
                            : GlanceText.t("\(ring.done) of \(ring.total) done", "\(ring.done) dari \(ring.total) selesai"))
    }
}

/// "76%" of the year.
struct CalendarYearGauge: View {
    let year: GlanceYear

    var body: some View {
        Gauge(value: Double(year.percent), in: 0...100) {
            Text(GlanceText.t("Year", "Tahun"))
        } currentValueLabel: {
            Text(verbatim: "\(year.percent)%")
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(GlanceText.t("Year", "Tahun"))
        .accessibilityValue(CalendarWords.yearProgress(year))
    }
}

// MARK: - Inline

struct CalendarInlineWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NEXUSCalendarInline", intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarInlineView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.day(entry.today, scope: entry.linkScope))
        }
        .configurationDisplayName("Calendar line")
        .description("Today's tasks in one line.")
        .supportedFamilies([.accessoryInline])
    }
}

/// "3 due today · next 19:00". iOS draws one line of text and one symbol here, nothing else.
struct CalendarInlineView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        Label(text, systemImage: "calendar")
    }

    private var text: String {
        guard let snapshot = entry.snapshot, entry.freshness == .fresh else { return entry.footer }
        return CalendarWords.inline(CalendarGlance.inline(snapshot, now: entry.date), today: entry.today)
    }
}
