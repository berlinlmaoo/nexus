import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// One month-grid style for every calendar in the app (UI tour run 16, R16-I-06; lead decision 8), the web's:
// a bordered joined grid (cells share hairlines, no gaps or rounded tiles), "MON … SUN" left-aligned over
// the day numbers, the number top-left, the days of the months around it greyed, today a navy disc, the
// picked day a soft rounded accent tint (R-12, 19 Oct), and a day's own target as a mark in the cell's top-right corner.
// Used by the project Calendar, the outlet calendar and the social media calendar; the main Calendar
// draws its own cells (CalendarParts.swift) with the same colours.
// ─────────────────────────────────────────────────────────────────────────────

enum NXMonthGrid {
    /// The cells' hairline.
    static var hairline: Color { NX.border.opacity(0.6) }
    /// Today's disc: the web's near-black primary.
    static var navy: Color { NX.onyx }
}

/// The picked day's mark on every month grid: a 10 pt rounded fill in the soft accent tint, inset from the
/// cell's hairlines, no outline (Berlin device review 19 Oct, R-12: the near-black square read as a hard border).
struct NXMonthSelection: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(NX.accentBg)
            .padding(2)
            .accessibilityHidden(true)
    }
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
    /// A month-grid cell: joined hairlines, a soft rounded tint when picked, a faint square fill outside the month.
    func nxMonthCell(inMonth: Bool, selected: Bool) -> some View {
        self
            .background { if selected { NXMonthSelection() } }
            // The web's faint square fill on a day outside the month (bg-muted/30), the whole cell to its
            // hairlines, never a rounded block (UI tour run 19, R19-I-19; run 18 R18-I-03).
            .background { if !inMonth { Rectangle().fill(NX.muted.opacity(0.3)) } }
            .overlay(Rectangle().strokeBorder(NXMonthGrid.hairline, lineWidth: 0.5))
    }

    /// The bordered card a month grid sits in.
    func nxMonthGridCard() -> some View {
        self
            // No focus platter: with a keyboard attached the first day button drew a rounded highlight inside its
            // square cell, the "rounded grey fill" of the out-of-month days (UI tour run 17, iPhone R17-I-18,
            // decision 12). The soft tint is the picked day's mark.
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
        // One placement and colour on every calendar (decision 12 of run 20, R20-I-21 / R20-B-29): neutral
        // secondary grey, right after the day number on its line, never in the cell's corner.
        Image(systemName: "target").font(.system(size: wide ? 11 : 9, weight: .semibold))
            .foregroundStyle(NX.mutedFg)
            .padding(.leading, 2)
            .accessibilityHidden(true)
    }
}
