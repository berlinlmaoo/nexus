import WidgetKit
import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The small views more than one calendar widget draws: the footer, the empty states, a day number, and
// a task as a bar. Plain stacks with fixed sizes — a widget is rendered once, ahead of time, and has no
// second chance to fix a layout that measured itself wrong. Words use text styles (they follow the
// reading size, within the cap each widget sets); the marks inside a day cell keep fixed sizes.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Footer and empty states

/// The last line of a Home Screen widget: "+3 more" on the left when a list was cut short, and on the
/// right when the snapshot was fetched — or, when it is behind or missing, what to do about it. That
/// second half is the widget's honesty line, so it never shrinks below the caption size.
struct CalendarFooter: View {
    let entry: CalendarWidgetEntry
    var leading: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            // "+3 more" gives way to "Open NEXUS to refresh": on a small widget there is room for one.
            if let text = leading, entry.freshness == .fresh {
                Text(text).fontWeight(.semibold)
            }
            Spacer(minLength: 4)
            if entry.freshness != .fresh {
                Image(systemName: "arrow.clockwise")
                    .accessibilityHidden(true)
            }
            Text(entry.footer)
                .lineLimit(entry.freshness == .fresh ? 1 : 2)
                .multilineTextAlignment(.trailing)
                .layoutPriority(1)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }
}

/// Drawn instead of the calendar when there is nothing to draw: never signed in, signed out, or the
/// calendar is not on for this account. Says why and what to do, nothing more — a widget has no
/// buttons, and a tap anywhere already opens NEXUS.
struct CalendarEmptyView: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: CalendarEmptyView.symbol(entry.freshness))
                .font(.title3)
                .foregroundStyle(.secondary)
                .widgetAccentable()
                .accessibilityHidden(true)
            Text(entry.footer)
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    static func symbol(_ f: GlanceFreshness) -> String {
        switch f {
        case .empty: return "person.crop.circle"
        case .none, .off: return "calendar.badge.minus"
        case .stale, .fresh: return "arrow.clockwise"
        }
    }
}

/// The Lock Screen's version. Too small for a footer, so when the snapshot is behind or missing the
/// whole widget says so, rather than drawing tasks it cannot vouch for.
struct CalendarAccessoryNotice: View {
    let entry: CalendarWidgetEntry

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: CalendarEmptyView.symbol(entry.freshness))
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(entry.footer)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Days

/// A day number: on a violet disc for today, red on Sundays and public holidays.
struct CalendarDayBadge: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let day: GlanceDay
    let size: CGFloat
    let fontSize: CGFloat
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        Text(GlanceText.dayNumber(day.day))
            .font(.system(size: fontSize, weight: weight))
            .monospacedDigit()
            .foregroundStyle(numberColor)
            .frame(width: size, height: size)
            .background { disc }
    }

    private var weight: Font.Weight { day.today ? .bold : .medium }

    private var numberColor: Color {
        if day.today { return full ? Color.white : Color.primary }
        if day.sunday || day.holiday != nil { return full ? ink.red : Color.secondary }
        return Color.primary
    }

    /// The tinted modes drop colour, so there today is a ring instead of a disc it could not fill.
    @ViewBuilder private var disc: some View {
        if day.today {
            if full {
                Circle().fill(ink.todayDisc)
            } else {
                Circle().stroke(Color.primary, lineWidth: 1.2).widgetAccentable()
            }
        }
    }
}

// MARK: - Tasks

/// A thin bar with no words, for the large month's cells. Done (or in a calendar-only project) is
/// faded with a small tick; overdue within the window gets a red outline. Decoration to VoiceOver: the
/// day cell around it says how many tasks there are and whether any is overdue.
struct CalendarBarStrip: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let bar: GlanceBar
    let height: CGFloat
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        Capsule()
            .fill(ink.bar(bar, full: full))
            .frame(height: height)
            .overlay(alignment: .leading) { tick }
            .overlay { outline }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var tick: some View {
        // Only a task ticked done; a calendar-only project is dimmed too but was never "done".
        if bar.done {
            Image(systemName: "checkmark")
                .font(.system(size: max(5, height - 1), weight: .heavy))
                .foregroundStyle(Color.primary)
                .padding(.leading, 2)
        }
    }

    @ViewBuilder private var outline: some View {
        if bar.overdue == .recent {
            Capsule().stroke(full ? ink.overdue : Color.primary, lineWidth: 1)
        }
    }
}

/// A bar with its title in it, where the cell is wide enough to read one: the week's columns and the
/// iPad month. A tinted wash with a solid stripe rather than a solid fill, so the title stays readable
/// on any project colour, in light and dark.
struct CalendarTitledBar: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let bar: GlanceBar
    let height: CGFloat
    let fontSize: CGFloat
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        HStack(spacing: 2) {
            if bar.done {
                Image(systemName: "checkmark")
                    .font(.system(size: max(5, fontSize - 1), weight: .bold))
                    .accessibilityLabel(GlanceText.doneLabel)
            }
            Text(GlanceText.title(bar))
                .font(.system(size: fontSize, weight: .medium))
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 0)
        }
        .foregroundStyle(Color.primary)
        .padding(.leading, 4)
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .background { wash }
        .opacity(bar.dim ? 0.7 : 1)
    }

    private var tint: Color { ink.bar(bar, full: full) }

    private var wash: some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(tint.opacity(0.22))
            Rectangle().fill(tint).frame(width: 2)
        }
        .clipShape(RoundedRectangle(cornerRadius: 2))
        .overlay { outline }
    }

    @ViewBuilder private var outline: some View {
        if bar.overdue == .recent {
            RoundedRectangle(cornerRadius: 2).stroke(full ? ink.overdue : Color.primary, lineWidth: 1)
        }
    }
}

/// The red mark on an overdue row: filled while it is within the window, a grey ring once it is older.
/// Shapes as well as colours, so it still reads when iOS tints the widget; VoiceOver says which.
struct CalendarOverdueMark: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    let overdue: GlanceOverdue
    let full: Bool

    private var ink: CalendarInk { CalendarInk(scheme, contrast) }

    var body: some View {
        switch overdue {
        case .recent:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(full ? ink.overdue : Color.primary)
                .accessibilityLabel(GlanceText.overdueLabel(.recent) ?? "")
        case .stale:
            Image(systemName: "exclamationmark.circle")
                .font(.caption2)
                .foregroundStyle(Color.secondary)
                .accessibilityLabel(GlanceText.overdueLabel(.stale) ?? "")
        case .none:
            EmptyView()
        }
    }
}
