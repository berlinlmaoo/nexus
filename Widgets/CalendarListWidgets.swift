import WidgetKit
import SwiftUI
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// The four lists (decision 7: only in widgets): every open task once — dated or not — in the one list
// its priority and due date put it in. Four widget kinds rather than one with a picker, so each sits
// in the gallery under its own name and two can stand side by side.
//
// Small: the count and the top two. Medium: four. Large: eight, with the project under each title —
// one fewer where a larger reading size or the smallest iPhones leave no room for the last.
//
// The names stay (owner's call), but "Urgent" is also a priority in the app, and this list holds the
// other kind of urgent. So "Urgent" and "Someday" carry a line under the name saying what they hold,
// and the gallery says it too.
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
                                       description: "Urgent, not high priority: due now, get them done.")
    }
}

struct CalendarListLaterWidget: Widget {
    var body: some WidgetConfiguration {
        CalendarListConfiguration.make(.later, kind: "NEXUSCalendarListLater", name: "Someday",
                                       description: "Not urgent, not high priority: everything else, tasks without a date included.")
    }
}

enum CalendarListConfiguration {
    static func make(_ quadrant: GlanceQuadrant, kind: String, name: LocalizedStringKey,
                     description: LocalizedStringKey) -> some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: CalendarScopeIntent.self,
                               provider: CalendarWidgetProvider()) { entry in
            CalendarQuadrantWidgetView(entry: entry, quadrant: quadrant)
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(CalendarLink.calendar(scope: entry.linkScope))
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
            let list: GlanceQuadrantList = CalendarGlance.quadrant(quadrant, snapshot, now: entry.date)
            let size = CalendarListSize(family)
            let full: Bool = mode == .fullColor
            // As many rows as the size promises wherever they fit; one fewer where a larger reading
            // size or the smallest iPhones leave no room for them. "+N more" counts the rest either way.
            ViewThatFits(in: .vertical) {
                CalendarQuadrantList(entry: entry, list: list, size: size, full: full)
                CalendarQuadrantList(entry: entry, list: list, size: size, full: full, limit: size.limit - 1)
            }
        } else {
            CalendarEmptyView(entry: entry)
        }
    }
}

struct CalendarQuadrantList: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let entry: CalendarWidgetEntry
    let list: GlanceQuadrantList
    let size: CalendarListSize
    let full: Bool
    /// Rows to show; the size's own number when nil.
    var limit: Int? = nil

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }
    private var rowLimit: Int { max(1, limit ?? size.limit) }
    private var shown: [GlanceBar] { Array(list.rows.prefix(rowLimit)) }
    private var hidden: Int { max(0, list.count - rowLimit) }
    private var color: Color { full ? ink.quadrant(list.quadrant) : Color.primary }
    /// "Urgent" and "Someday" say under their names what they hold.
    private var note: String? { GlanceText.quadrantNote(list.quadrant) }
    private var spacing: CGFloat { size == .small && note == nil ? 5 : 3 }

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
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center, spacing: 5) {
                    Circle()
                        .fill(color)
                        .frame(width: 7, height: 7)
                        .widgetAccentable()
                        .accessibilityHidden(true)
                    Text(GlanceText.quadrantName(list.quadrant))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(color)
                        .lineLimit(size == .small ? 2 : 1)
                        .minimumScaleFactor(0.8)
                        .widgetAccentable()
                    if size != .small, let scope = entry.scopeNote {
                        Text(scope)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                if let note {
                    // Under the name, not under the dot.
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .padding(.leading, 12)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            Text(String(list.count))
                .font(countFont)
                .monospacedDigit()
                .accessibilityLabel(GlanceText.taskCount(list.count))
        }
    }

    private var countFont: Font { size == .small ? Font.title2.weight(.bold) : Font.headline }

    /// The small widget is one tap target (its widgetURL); the larger ones open each task.
    @ViewBuilder private func row(_ bar: GlanceBar) -> some View {
        if size == .small {
            CalendarQuadrantRow(bar: bar, today: entry.today, stacked: true, showProject: false, full: full)
        } else {
            Link(destination: CalendarLink.task(bar, scope: entry.linkScope)) {
                CalendarQuadrantRow(bar: bar, today: entry.today, stacked: size == .large, showProject: true, full: full)
            }
        }
    }
}

/// One task: a colour stripe, the title (with the overdue mark), when it is due and — where there is
/// room — its project. Stacked on two lines in the small and large sizes, one line in the medium.
struct CalendarQuadrantRow: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let bar: GlanceBar
    let today: String
    let stacked: Bool
    let showProject: Bool
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        HStack(alignment: .center, spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(ink.bar(bar, full: full))
                .frame(width: 3, height: stacked ? 26 : 13)
                .accessibilityHidden(true)
            if stacked {
                twoLines
            } else {
                oneLine
            }
        }
        // A Link may tint its label like a button; the list's own colours win.
        .foregroundStyle(Color.primary)
        // One element per task: "Overdue, Upload flyer, Tomorrow · 08:30, PATS x Brand".
        .accessibilityElement(children: .combine)
    }

    private var titleLine: some View {
        HStack(spacing: 3) {
            CalendarOverdueMark(overdue: bar.overdue, full: full)
            Text(GlanceText.title(bar))
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .privacySensitive()
        }
    }

    private var twoLines: some View {
        VStack(alignment: .leading, spacing: 1) {
            titleLine
            Text(detail)
                .font(.caption2)
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
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: 80, alignment: .trailing)
            }
            Text(CalendarWords.due(bar, today: today))
                .font(.caption2.weight(.medium).monospacedDigit())
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

    private var dueColor: Color { bar.overdue == .recent && full ? ink.red : Color.secondary }
}
