import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// One month-grid style for every calendar in the app (UI tour run 16, R16-I-06; lead decision 8), the web's:
// a bordered joined grid (cells share hairlines, no gaps or rounded tiles), "MON … SUN" left-aligned over
// the day numbers, the number top-left, the days of the months around it greyed, today a navy disc, the
// picked day a navy outline, and a day's own target as a mark in the cell's top-right corner.
// Used by the project Calendar, the outlet calendar and the social media calendar; the main Calendar
// draws its own cells (CalendarParts.swift) with the same colours.
// ─────────────────────────────────────────────────────────────────────────────

enum NXMonthGrid {
    /// The cells' hairline.
    static var hairline: Color { NX.border.opacity(0.6) }
    /// Today's disc and the picked day's outline: the web's near-black primary.
    static var navy: Color { NX.onyx }
}

/// The weekday row over a month grid: "MON … SUN", left-aligned, on a muted band.
struct NXMonthWeekdayRow: View {
    let names: [String]
    var wide = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                Text(name.uppercased().replacingOccurrences(of: ".", with: ""))
                    .font(NXFont.text(wide ? 12 : 11, .semibold)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.leading, wide ? 8 : 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
            }
        }
        .background(NX.muted.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
    }
}

/// A day's number, top-left in its cell. Today sits on a navy disc whose left edge lines up with the other
/// days' numbers, so the figures under every number start at one inset (R16-I-08).
struct NXMonthDayNumber: View {
    let day: Int
    var inMonth = true
    var isToday = false
    /// Quieter, for a day still to come (the socmed calendar).
    var muted = false
    var wide = false

    var body: some View {
        let side: CGFloat = wide ? 26 : 24
        Text("\(day)")
            .font(NXFont.text(wide ? 14 : 13, isToday ? .bold : .medium)).monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(isToday ? NX.background : (!inMonth ? NX.mutedFg.opacity(0.6) : (muted ? NX.mutedFg : NX.foreground)))
            .frame(minWidth: isToday ? side : nil, minHeight: side, alignment: isToday ? .center : .leading)
            .background { if isToday { Circle().fill(NXMonthGrid.navy) } }
    }
}

extension View {
    /// A month-grid cell: joined hairlines, a navy outline when picked. A day outside the month has no fill,
    /// only its grey number (`NXMonthDayNumber`), as on the web: the grey fill read as a rounded block inside
    /// the square cell (UI tour run 17 R17-I-18, run 18 R18-I-03). `inMonth` stays for the callers' clarity.
    func nxMonthCell(inMonth: Bool, selected: Bool) -> some View {
        self
            .overlay(Rectangle().strokeBorder(NXMonthGrid.hairline, lineWidth: 0.5))
            .overlay { if selected { Rectangle().strokeBorder(NXMonthGrid.navy, lineWidth: 1.5) } }
    }

    /// The bordered card a month grid sits in.
    func nxMonthGridCard() -> some View {
        self
            // No focus platter: with a keyboard attached the first day button drew a rounded highlight inside its
            // square cell, the "rounded grey fill" of the out-of-month days (UI tour run 17, iPhone R17-I-18,
            // decision 12). The navy outline is the picked day's mark.
            .focusEffectDisabled()
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }
}

/// A day's own target: the web's ◎ in the cell's top-right corner.
struct NXMonthTargetMark: View {
    var wide = false
    var body: some View {
        Image(systemName: "target").font(.system(size: wide ? 11 : 9, weight: .semibold))
            .foregroundStyle(NX.foreground.opacity(0.7))
            .accessibilityHidden(true)
    }
}
