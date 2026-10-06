import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// The four lists (decision 7: only in widgets): every open task once — dated or not — in the one list
// its priority and due date put it in. Four widget kinds rather than one with a picker, so each sits
// in the gallery under its own name and two can stand side by side.
//
// Small: the count and the top two. Medium: four. Large: eight, with the project under each title.
// ─────────────────────────────────────────────────────────────────────────────

struct CalendarListDoWidget: Widget {
    var body: some WidgetConfiguration {
        CalendarListConfiguration.make(.doFirst, kind: "NEXUSCalendarListDo", name: "Important & urgent",
                                       description: "High priority and due now: do these first.")
    }
}

struct CalendarListPlanWidget: Widget {
    var body: some WidgetConfiguration {
        CalendarListConfiguration.make(.plan, kind: "NEXUSCalendarListPlan", name: "Important",
                                       description: "High priority, not due yet: plan them in.")
    }
}

struct CalendarListActWidget: Widget {
    var body: some WidgetConfiguration {
        CalendarListConfiguration.make(.act, kind: "NEXUSCalendarListAct", name: "Urgent",
                                       description: "Due now, normal priority: get them done.")
    }
}

struct CalendarListLaterWidget: Widget {
    var body: some WidgetConfiguration {
        CalendarListConfiguration.make(.later, kind: "NEXUSCalendarListLater", name: "Someday",
                                       description: "Everything else, tasks without a date included.")
    }
}

enum CalendarListConfiguration {
    static func make(_ quadrant: GlanceQuadrant, kind: String, name: LocalizedStringKey,
                     description: LocalizedStringKey) -> some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarQuadrantWidgetView(entry: entry, quadrant: quadrant)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.root)
        }
        .configurationDisplayName(name)
        .description(description)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

/// How much of a list each size shows.
enum CalendarListSize {
    case small, medium, large

    init(_ family: WidgetFamily) {
        switch family {
        case .systemSmall: self = .small
        case .systemMedium: self = .medium
        default: self = .large
        }
    }

    var limit: Int {
        switch self {
        case .small: return 2
        case .medium: return 4
        case .large: return 8
        }
    }
}

struct CalendarQuadrantWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: CalendarWidgetEntry
    let quadrant: GlanceQuadrant

    var body: some View {
        if let snapshot = entry.snapshot {
            CalendarQuadrantList(entry: entry,
                                 list: CalendarGlance.quadrant(quadrant, snapshot, now: entry.date),
                                 size: CalendarListSize(family),
                                 full: mode == .fullColor)
        } else {
            CalendarEmptyView(entry: entry)
        }
    }
}

struct CalendarQuadrantList: View {
    let entry: CalendarWidgetEntry
    let list: GlanceQuadrantList
    let size: CalendarListSize
    let full: Bool

    private var shown: [GlanceBar] { Array(list.rows.prefix(size.limit)) }
    private var hidden: Int { max(0, list.count - size.limit) }
    private var color: Color { full ? CalendarStyle.quadrant(list.quadrant) : Color.primary }
    private var spacing: CGFloat { size == .small ? 5 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            header
            if shown.isEmpty {
                Text(CalendarWords.nothingHere)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(shown, id: \.key) { bar in
                    row(bar)
                }
            }
            Spacer(minLength: 0)
            CalendarFooter(entry: entry, leading: hidden > 0 ? GlanceText.more(hidden, long: true) : nil)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .widgetAccentable()
            Text(GlanceText.quadrantName(list.quadrant))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(color)
                .lineLimit(size == .small ? 2 : 1)
                .minimumScaleFactor(0.8)
                .widgetAccentable()
            if size != .small, let note = entry.scopeNote {
                Text(note)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(String(list.count))
                .font(countFont)
                .monospacedDigit()
        }
    }

    private var countFont: Font { size == .small ? Font.title2.weight(.bold) : Font.headline }

    /// The small widget is one tap target (its widgetURL); the larger ones open each task.
    @ViewBuilder private func row(_ bar: GlanceBar) -> some View {
        if size == .small {
            CalendarQuadrantRow(bar: bar, today: entry.today, stacked: true, showProject: false, full: full)
        } else {
            Link(destination: CalendarLink.task(bar)) {
                CalendarQuadrantRow(bar: bar, today: entry.today, stacked: size == .large, showProject: true, full: full)
            }
        }
    }
}

/// One task: a colour stripe, the title (with the overdue mark), when it is due and — where there is
/// room — its project. Stacked on two lines in the small and large sizes, one line in the medium.
struct CalendarQuadrantRow: View {
    let bar: GlanceBar
    let today: String
    let stacked: Bool
    let showProject: Bool
    let full: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(CalendarStyle.bar(bar, full: full))
                .frame(width: 3, height: stacked ? 24 : 13)
            if stacked {
                twoLines
            } else {
                oneLine
            }
        }
        // A Link may tint its label like a button; the list's own colours win.
        .foregroundStyle(Color.primary)
    }

    private var titleLine: some View {
        HStack(spacing: 3) {
            CalendarOverdueMark(overdue: bar.overdue, full: full)
            Text(GlanceText.title(bar))
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
                .privacySensitive()
        }
    }

    private var twoLines: some View {
        VStack(alignment: .leading, spacing: 1) {
            titleLine
            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(dueColor)
                .lineLimit(1)
        }
    }

    private var oneLine: some View {
        HStack(spacing: 4) {
            titleLine
            Spacer(minLength: 4)
            if let name = project {
                Text(name)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: 80, alignment: .trailing)
            }
            Text(CalendarWords.due(bar, today: today))
                .font(.system(size: 10, weight: .medium).monospacedDigit())
                .foregroundStyle(dueColor)
                .lineLimit(1)
        }
    }

    /// A masked row never names its project: which project somebody else's task sits in is exactly
    /// what masking hides.
    private var project: String? { showProject && !bar.masked ? bar.project : nil }

    private var detail: String {
        let due = CalendarWords.due(bar, today: today)
        guard let name = project else { return due }
        return due + " · " + name
    }

    private var dueColor: Color { bar.overdue == .recent && full ? CalendarStyle.red : Color.secondary }
}
