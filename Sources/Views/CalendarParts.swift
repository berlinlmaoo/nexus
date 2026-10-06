import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Calendar — the pieces CalendarView is built from: the month grid, the day panel's sections and
// rows, the week "People" view, the filters and the read-only task preview. Same look and rules as
// the web (apps/nexus-lovable-ui/src/components/calendar); the rules themselves are in
// Shared/CalendarCore.swift.
//
// Layout follows what is proven on device here: plain VStack/HStack (no lazy grid inside a two-way
// scroll, no offsets, no reading the scroll position) — the month is LeaveRangeCalendar's structure.
// The filters are a plain grouped List, like every other settings-shaped sheet in the app.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Colours, dates, words

extension Color {
    /// A unit colour pair from the server ("#0B6FB8" / "#5AA9E6"), following light/dark.
    init(lightHex: String, darkHex: String) {
        func rgb(_ raw: String) -> UInt {
            var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if s.hasPrefix("#") { s.removeFirst() }
            return UInt(s, radix: 16) ?? 0x75839A
        }
        let l = rgb(lightHex), d = rgb(darkHex)
        self.init(uiColor: UIColor { trait in UIColor(rgb: trait.userInterfaceStyle == .dark ? d : l) })
    }
}

/// The Calendar's colours, light and dark, each with an Increase Contrast value.
///
/// The accent is the app's violet: today, the selection, toggles, badges and every call to action,
/// so a tint means "tappable" here exactly as on every other screen, the widgets and the watch. The
/// Bagan's navy had become a second accent on this one screen (impeccable audit, 6 Oct 2026); it
/// stays the Bagan's own, for the group ribbons.
enum CalTone {
    /// The accent as TEXT, ICON or RING on a surface (NX.violetText's values); it is also a fill
    /// under `onAccent`. 6.2:1 on white, 7.5:1 on the dark card.
    static let accent = tone(light: 0x6247d6, dark: 0xb3a6ff, lightHigh: 0x4a2fb0, darkHigh: 0xd2caff)
    /// Text on an `accent` fill.
    static let onAccent = tone(light: 0xffffff, dark: 0x17123a, lightHigh: 0xffffff, darkHigh: 0x0b0820)
    /// The accent as a FILL under white text (today's disc, the "You" badge, empty-state buttons):
    /// 6.2:1 light, 4.9:1 dark. NX.violet itself is 4.15:1 under white, under AA for small type.
    static let accentFill = tone(light: 0x6247d6, dark: 0x6f5ae6, lightHigh: 0x4a2fb0, darkHigh: 0x5a44d4)
    /// Older call sites still say navy. They get the accent, which does both of navy's jobs (a fill
    /// under `onNavy`, type on a surface) in both appearances.
    static let navy = accent
    static let onNavy = onAccent
    static let unknown = Color(light: 0x75839A, dark: 0x94A3B8)
    /// Overdue, as type and as marks. Light is rose-700: rose-600 (#e11d48) read 4.0:1 as the
    /// rail's 11 pt heading on its own wash; this is 5.3:1 there.
    static let overdue = tone(light: 0xbe123c, dark: 0xfb7185, lightHigh: 0x9f1239, darkHigh: 0xfda4af)
    /// The Bagan's group ribbon (the values of OrgChartView's OC.division / divisionLine).
    static let group = Color(light: 0xedf2f9, dark: 0x1a2a41)
    static let groupLine = tone(light: 0xc6d4e7, dark: 0x2e4565, lightHigh: 0x6b7f99, darkHigh: 0x6c86a8)
    /// Hairlines inside the grid and the table: NX.border as it looked at 70% on a card, and a
    /// line you can actually see under Increase Contrast.
    static let hairline = tone(light: 0xedeef1, dark: 0x2c3348, lightHigh: 0x9aa1ab, darkHigh: 0x6b7591)

    private static func tone(light: UInt, dark: UInt, lightHigh: UInt, darkHigh: UInt) -> Color {
        Color(uiColor: UIColor { trait in
            let high = trait.accessibilityContrast == .high
            if trait.userInterfaceStyle == .dark { return UIColor(rgb: high ? darkHigh : dark) }
            return UIColor(rgb: high ? lightHigh : light)
        })
    }
}

func calUnitColor(_ unit: CalUnit?) -> Color {
    guard let unit else { return CalTone.unknown }
    return Color(lightHex: unit.color, darkHex: unit.colorDark)
}

/// A project's colour. The server sends one hex and no dark value, and a dark project colour
/// vanished on the dark card (#0c1427 measured 1.1:1). In dark mode it is lifted toward white just
/// far enough to reach 3:1; light mode keeps the colour as chosen.
func calProjectColor(_ raw: String) -> Color {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6, let v = UInt(s, radix: 16) else { return CalTone.unknown }
    let r = Double((v >> 16) & 0xFF) / 255, g = Double((v >> 8) & 0xFF) / 255, b = Double(v & 0xFF) / 255
    func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    func luminance(_ m: Double) -> Double {
        0.2126 * lin(r + (1 - r) * m) + 0.7152 * lin(g + (1 - g) * m) + 0.0722 * lin(b + (1 - b) * m)
    }
    // 0.15 relative luminance = 3:1 against the dark card (#1c2130).
    var mix = 0.0
    while mix < 0.7 && luminance(mix) < 0.15 { mix += 0.05 }
    let light = UIColor(red: r, green: g, blue: b, alpha: 1)
    let dark = UIColor(red: r + (1 - r) * mix, green: g + (1 - g) * mix, blue: b + (1 - b) * mix, alpha: 1)
    return Color(uiColor: UIColor { trait in trait.userInterfaceStyle == .dark ? dark : light })
}

enum CalFormat {
    private static var cache: [String: DateFormatter] = [:]

    private static var isID: Bool { AppLanguage.shared.lang == .id }

    /// A WIB day string through a localized template, never shifted by the device's time zone.
    static func day(_ day: String, _ template: String) -> String {
        let key = "\(isID)|\(template)"
        let f: DateFormatter
        if let hit = cache[key] {
            f = hit
        } else {
            f = DateFormatter()
            f.locale = Locale(identifier: isID ? "id_ID" : "en_GB")
            f.timeZone = TimeZone(identifier: "UTC")
            f.setLocalizedDateFormatFromTemplate(template)
            cache[key] = f
        }
        return f.string(from: CalDays.date(day))
    }

    /// "19.00" in Indonesian, "19:00" in English.
    static func time(_ t: String?) -> String {
        guard let t else { return "" }
        return isID ? t.replacingOccurrences(of: ":", with: ".") : t
    }

    /// Monday…Sunday, short.
    static func weekdays() -> [String] {
        (0..<7).map { day(CalDays.addDays("2026-10-05", $0), "EEE") }
    }

    /// "1 task" / "%d tasks".
    static func tasks(_ n: Int) -> String { n == 1 ? T("1 task") : String(format: T("%d tasks"), n) }
    static func people(_ n: Int) -> String { n == 1 ? T("1 person") : String(format: T("%d people"), n) }
}

func calInitials(_ name: String) -> String {
    let parts = name.split(separator: " ").prefix(2)
    let s = parts.compactMap { $0.first.map { String($0).uppercased() } }.joined()
    return s.isEmpty ? "?" : s
}

/// One VoiceOver sentence from its parts, skipping the missing ones: "Finance & Tech, You, 5 tasks".
func calJoin(_ parts: String?...) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
}

// MARK: - Unit mark, status glyph, priority, "You"

/// An IP's logo on a tile picked from the logo itself, or the unit's initial on its own colour.
struct CalUnitMark: View {
    let unit: CalUnit
    var size: CGFloat = 22

    private var logoURL: URL? {
        guard unit.kind == "IP", let raw = unit.logoUrl, !raw.isEmpty else { return nil }
        return URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    var body: some View {
        let tint = calUnitColor(unit)
        Group {
            if let logoURL {
                CalLogoTile(url: logoURL, size: size) { initial(tint) }
            } else {
                initial(tint)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func initial(_ tint: Color) -> some View {
        Text(String(unit.name.first.map { String($0) } ?? "·").uppercased())
            .font(NXFont.text(size * 0.45, .bold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// The Bagan's logo tile (OrgChartView's OrgLogo, which is private to that file): a mostly-light
/// logo (white type on a transparent PNG) sits on dark navy, any other on white. On the old grey
/// tile a white logo was an empty square, the defect the owner reported on the Bagan on 30 Sep 2026.
private struct CalLogoTile<Fallback: View>: View {
    let url: URL
    let size: CGFloat
    let fallback: Fallback
    @State private var image: UIImage? = nil
    @State private var light = false
    /// The logo `image` belongs to. A row reused for another IP (the People list after a filter change)
    /// must not keep showing the previous IP's logo while the new one loads.
    @State private var imageURL: URL? = nil

    init(url: URL, size: CGFloat, @ViewBuilder fallback: () -> Fallback) {
        self.url = url
        self.size = size
        self.fallback = fallback()
        // A cached logo paints on the first frame, with its tile already decided.
        if let hit = ImageLoader.memory.object(forKey: ImageLoader.cacheKey(url, ImageLoader.tilePixel) as NSURL) {
            _image = State(initialValue: hit)
            _light = State(initialValue: CalLogoTone.isLight(hit, url))
            _imageURL = State(initialValue: url)
        }
    }

    var body: some View {
        Group {
            if let image, imageURL == url {
                Image(uiImage: image).resizable().scaledToFit().padding(size > 20 ? 2 : 1)
                    .frame(width: size, height: size)
                    .background(light ? CalLogoTone.darkTile : Color.white,
                                in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            } else {
                fallback
            }
        }
        .task(id: url) {
            if imageURL == url, image != nil { return }
            guard let img = await ImageLoader.shared.image(for: url) else { return }
            light = CalLogoTone.isLight(img, url)
            image = img
            imageURL = url
        }
    }
}

/// Whether a logo is mostly light, measured once per logo (the Bagan's rule: average brightness of
/// the visible pixels of a 32×32 copy above 0.72).
private enum CalLogoTone {
    static let darkTile = Color(hex: "#0f1b2d")
    private static var known: [URL: Bool] = [:]

    static func isLight(_ img: UIImage, _ url: URL) -> Bool {
        if let hit = known[url] { return hit }
        let light = measure(img)
        known[url] = light
        return light
    }

    private static func measure(_ img: UIImage) -> Bool {
        guard let cg = img.cgImage else { return false }
        let w = 32, h = 32
        var px = [UInt8](repeating: 0, count: w * h * 4)
        // The context draws into the array's own bytes, so it lives only inside this closure.
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return false }
        var sum = 0.0, n = 0.0
        for i in stride(from: 0, to: px.count, by: 4) {
            let a = Double(px[i + 3]) / 255
            if a < 0.2 { continue }
            // Premultiplied: undo the alpha before weighing the colour.
            let r = Double(px[i]) / 255 / a, gr = Double(px[i + 1]) / 255 / a, b = Double(px[i + 2]) / 255 / a
            sum += 0.2126 * r + 0.7152 * gr + 0.0722 * b
            n += 1
        }
        return n > 0 && sum / n > 0.72
    }
}

/// ○ to do, ✓ done, ! overdue (red within the window, grey after it), ◆ project without status.
struct CalStatusGlyph: View {
    let item: CalItem
    let today: String
    let now: Date
    let windowDays: Int
    var size: CGFloat = 16
    /// The row has usually worked this out already; passed in, it is not done twice per row.
    var state: CalOverdue? = nil

    var body: some View {
        let od = state ?? CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        Group {
            if item.done {
                Image(systemName: "checkmark.circle.fill").resizable().foregroundStyle(NX.success)
            } else if item.noStatus {
                Image(systemName: "diamond.fill").resizable().scaleEffect(0.5).foregroundStyle(NX.mutedFg)
            } else if od == .recent {
                Image(systemName: "exclamationmark.circle.fill").resizable().foregroundStyle(CalTone.overdue)
            } else {
                // Stale = overdue past the window: quieter than a fresh one, still 3:1 on the card.
                Circle().strokeBorder(od == .stale ? NX.mutedFg.opacity(0.7) : NX.mutedFg, lineWidth: 2)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(item.done ? T("Done") : item.noStatus ? T("No status") : od == .recent ? T("Overdue") : T("To do"))
    }
}

struct CalPriorityChip: View {
    let priority: String?
    var body: some View {
        if priority == "URGENT" {
            NexusChip(text: T("Urgent"), tone: .danger)
        } else if priority == "HIGH" {
            NexusChip(text: T("High"), tone: .warning)
        }
    }
}

/// The viewer's own card, person or row: "YOU" on the accent.
private struct CalYouBadge: View {
    var body: some View {
        Text(T("You").uppercased()).font(NXFont.text(11, .bold))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(CalTone.accentFill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

// MARK: - Month grid

/// Monday first, always six weeks. One dot per unit at the focus level (filled = still something to
/// do, ring = only done / status-less), in Bagan order; a red bar = overdue within the window; days
/// of other months are muted and carry no dots.
///
/// The grid grows with the reader's text size as far as AX1, like Apple's Calendar month (beyond
/// that a seven-column month cannot hold its numbers); the day's list below it keeps scaling.
struct CalMonthGrid: View {
    let days: [String]
    let month: String
    let cells: [String: CalDayCell]
    let selected: String
    let today: String
    let holidays: [String: String]
    let ix: CalIndex
    let wide: Bool
    /// The month on screen has arrived. While it has not (loading, or failed) the cells carry no
    /// counts, and VoiceOver must not hear "No tasks" about a month nobody has seen.
    var loaded: Bool = true
    let onSelect: (String) -> Void

    var body: some View {
        // The cap is set out here: the sizes inside are read from the capped environment.
        CalMonthGridBody(grid: self)
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }
}

private struct CalMonthGridBody: View {
    let grid: CalMonthGrid
    /// Cell heights and the number's disc follow Dynamic Type, so a larger text size grows the rows
    /// instead of spilling a day into the week below it.
    @ScaledMetric(relativeTo: .body) private var phoneHeight: CGFloat = 54
    @ScaledMetric(relativeTo: .body) private var wideHeight: CGFloat = 84
    @ScaledMetric(relativeTo: .body) private var disc: CGFloat = 26
    @ScaledMetric(relativeTo: .body) private var dotRow: CGFloat = 8

    var body: some View {
        let names = CalFormat.weekdays()
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(names[i].uppercased())
                        .font(NXFont.text(11, .bold)).tracking(0.4)
                        .foregroundStyle(NX.mutedFg)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .background(NX.muted.opacity(0.5))
            Divider().overlay(NX.border)
            ForEach(0..<6, id: \.self) { w in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { d in
                        dayCell(grid.days[w * 7 + d], weekend: d >= 5)
                    }
                }
                if w < 5 { Divider().overlay(CalTone.hairline) }
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
    }

    private func dayCell(_ day: String, weekend: Bool) -> some View {
        let g = grid
        let inMonth = day.hasPrefix(g.month)
        let cell = inMonth ? g.cells[day] : nil
        let isToday = day == g.today
        let isSel = day == g.selected
        let holiday = g.holidays[day]
        let dots = cell?.dots ?? []
        let maxDots = g.wide ? 4 : 3
        let shown = Array(dots.prefix(maxDots))
        // Another month's days used to be the whole cell at 38% (2.2:1); muted type reads at 5:1.
        let numberColor: Color = isToday ? Color.white : !inMonth ? NX.mutedFg : (holiday != nil ? CalTone.overdue : NX.foreground)
        let discSize = min(disc, g.wide ? 40 : 34)
        let unitName: (CalDot) -> String = { dot in dot.unitId == "other" ? T("Other") : (g.ix.byId[dot.unitId]?.name ?? "") }
        return Button {
            Haptics.tap()
            g.onSelect(day)
        } label: {
            VStack(spacing: 3) {
                HStack(alignment: .top, spacing: 0) {
                    Text("\(Int(day.suffix(2)) ?? 0)")
                        .font(NXFont.text(13, inMonth ? .semibold : .regular)).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .foregroundStyle(numberColor)
                        .frame(minWidth: discSize, minHeight: discSize)
                        .background { if isToday { Circle().fill(CalTone.accentFill) } }
                    if g.wide {
                        Spacer(minLength: 0)
                        if let cell, cell.count > 0 {
                            Text("\(cell.count)").font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                                .lineLimit(1)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: g.wide ? .leading : .center)
                if cell?.overdue == true {
                    Capsule().fill(CalTone.overdue).frame(width: 14, height: 2)
                        .frame(maxWidth: .infinity, alignment: g.wide ? .leading : .center)
                }
                if g.wide, let holiday {
                    Text(holiday).font(NXFont.text(11, .medium)).foregroundStyle(inMonth ? CalTone.overdue : NX.mutedFg).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    ForEach(shown, id: \.unitId) { dot in
                        let tint = calUnitColor(g.ix.byId[dot.unitId])
                        Circle()
                            .fill(dot.filled ? tint : Color.clear)
                            .overlay(Circle().strokeBorder(tint, lineWidth: 1.5))
                            .frame(width: 6, height: 6)
                    }
                    if dots.count > shown.count {
                        Text("+\(dots.count - shown.count)").font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: dotRow, alignment: g.wide ? .leading : .center)
            }
            .padding(g.wide ? 7 : 4)
            .frame(maxWidth: .infinity)
            .frame(height: g.wide ? wideHeight : phoneHeight)
            .background(weekend ? NX.muted.opacity(0.3) : Color.clear)
            .overlay { if isSel { Rectangle().strokeBorder(CalTone.accent, lineWidth: 2) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(cellLabel(day, cell, holiday, isToday))
        .modifier(CalCellDivisions(todo: dots.filter(\.filled).map(unitName).joined(separator: ", "),
                                   done: dots.filter { !$0.filled }.map(unitName).joined(separator: ", ")))
        .accessibilityAddTraits(isSel ? .isSelected : [])
    }

    private func cellLabel(_ day: String, _ cell: CalDayCell?, _ holiday: String?, _ isToday: Bool) -> String {
        var parts = [CalFormat.day(day, "EEEEdMMMM")]
        // A day of another month never has a count; only a loaded month may say "No tasks".
        if grid.loaded && day.hasPrefix(grid.month) {
            parts.append(cell.map { $0.count > 0 ? CalFormat.tasks($0.count) : T("No tasks") } ?? T("No tasks"))
        }
        if cell?.overdue == true { parts.append(T("Overdue")) }
        if let holiday { parts.append(holiday) }
        if isToday { parts.append(T("Today")) }
        return parts.joined(separator: ", ")
    }
}

/// Which divisions have work on a day, for VoiceOver's "More content": what the dots tell a sighted
/// reader (filled = still to do, ring = only done or status-less).
private struct CalCellDivisions: ViewModifier {
    let todo: String
    let done: String

    @ViewBuilder func body(content: Content) -> some View {
        if todo.isEmpty && done.isEmpty {
            content
        } else if done.isEmpty {
            content.accessibilityCustomContent(Text(T("To do")), Text(todo))
        } else if todo.isEmpty {
            content.accessibilityCustomContent(Text(T("Done or no status")), Text(done))
        } else {
            content
                .accessibilityCustomContent(Text(T("To do")), Text(todo))
                .accessibilityCustomContent(Text(T("Done or no status")), Text(done))
        }
    }
}

// MARK: - Rows

/// Who a person is, for a row: a member of the Bagan, or a former member named by the server.
struct CalPeople {
    let ix: CalIndex
    let extra: [String: CalPersonRef]

    func name(_ id: String) -> String {
        if let p = ix.person[id], let n = p.name, !n.isEmpty { return n }
        return extra[id]?.name ?? T("Former member")
    }
    func avatar(_ id: String) -> String? { ix.person[id]?.avatar ?? extra[id]?.avatar }
    func inChart(_ id: String) -> Bool { !(ix.person[id]?.homeUnitIds.isEmpty ?? true) }
}

/// One task. `unitId` = the card it is shown under: its PICs there come first, the others are
/// "with …". A masked row says "Internal task · <division>": it is never fetched, but a tap still
/// goes to `onOpen`, which shows why it cannot be opened (the row used to be disabled, a tap that
/// did nothing). A row with no task behind it says why in place. The viewer is "You" among the people.
struct CalItemRow: View {
    let item: CalItem
    let unitId: String?
    let ix: CalIndex
    let people: CalPeople
    let today: String
    let now: Date
    let windowDays: Int
    var showPeople = true
    var compact = false
    var trailingNote: String? = nil
    let onOpen: (CalItem) -> Void
    @Environment(AuthStore.self) private var auth
    @State private var explained = false

    var body: some View {
        let od = CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        let openable = !item.masked && item.taskId != nil
        Button {
            if openable || item.masked {
                onOpen(item)
            } else {
                withAnimation(.snappy(duration: 0.2)) { explained.toggle() }
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays, size: compact ? 14 : 16, state: od)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        if item.masked {
                            Label(maskedTitle, systemImage: "lock.fill")
                                .font(NXFont.text(13).italic()).foregroundStyle(NX.mutedFg).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(item.title ?? "")
                                .font(NXFont.text(compact ? 12.5 : 13.5, .medium))
                                .foregroundStyle(item.done || od == .stale ? NX.mutedFg : NX.foreground)
                                .strikethrough(item.done, color: NX.mutedFg)
                                .lineLimit(compact ? 1 : 2)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let note = trailingNote {
                            Text(note).font(NXFont.text(11)).foregroundStyle(CalTone.overdue)
                        }
                        if item.time != nil {
                            Text(CalFormat.time(item.time)).font(NXFont.text(11.5, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        }
                    }
                    if !openable && explained {
                        Text(closedReason)
                            .font(NXFont.text(11.5)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !compact { meta(od) }
                    if showPeople, !compact, !item.assigneeIds.isEmpty { peopleLine }
                }
            }
            .padding(.horizontal, 10).padding(.vertical, compact ? 6 : 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityHint(openable ? "" : closedReason)
    }

    private var maskedTitle: String {
        guard let unitId, let unit = ix.byId[unitId] else { return T("Internal task") }
        let section = ix.byId[unit.sectionId]?.name ?? unit.name
        return String(format: T("Internal task · %@"), section)
    }

    /// Why this row does not open.
    private var closedReason: String {
        item.masked ? T("This is an internal task of a private project. Only its members can open it.")
                    : T("This entry has no task to open.")
    }

    private func who(_ id: String) -> String {
        id == auth.session?.userId ? T("You") : people.name(id)
    }

    @ViewBuilder private func meta(_ od: CalOverdue) -> some View {
        HStack(spacing: 6) {
            if let p = item.project {
                RoundedRectangle(cornerRadius: 2).fill(calProjectColor(p.color)).frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(p.name).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                if !item.linkedProjectIds.isEmpty {
                    Text(String(format: T("+%d project"), item.linkedProjectIds.count)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            CalPriorityChip(priority: item.priority)
            if od == .recent {
                Text(T("Overdue")).font(NXFont.text(11, .semibold)).foregroundStyle(CalTone.overdue)
            }
        }
        if od == .stale {
            Text(String(format: T("Overdue for more than %d days"), windowDays)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        if let parent = item.parent {
            Label(String(format: T("from %@"), parent.title), systemImage: "arrow.turn.down.right")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
    }

    private var peopleLine: some View {
        let here = unitId.flatMap { u in item.placements.first { $0.unitId == u }?.userIds } ?? item.assigneeIds
        let others = item.assigneeIds.filter { !here.contains($0) }
        let unitOf: (String) -> String = { id in
            guard people.inChart(id), let p = item.placements.first(where: { $0.userIds.contains(id) }) else { return T("not in the chart") }
            return ix.byId[p.unitId]?.name ?? T("not in the chart")
        }
        let othersText = others.map { "\(who($0)) (\(unitOf($0)))" }.joined(separator: ", ")
        return VStack(alignment: .leading, spacing: 3) {
            if !here.isEmpty {
                HStack(spacing: 6) {
                    HStack(spacing: -6) {
                        ForEach(here.prefix(3), id: \.self) { id in
                            AvatarView(url: people.avatar(id), initial: calInitials(people.name(id)), size: 18)
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                        }
                    }
                    .accessibilityHidden(true)
                    Text(here.map { who($0) }.joined(separator: ", "))
                        .font(NXFont.text(11.5, .semibold)).foregroundStyle(NX.foreground.opacity(0.9)).lineLimit(1)
                }
            }
            if !others.isEmpty {
                Text(here.isEmpty ? othersText : "\(T("with")) \(othersText)")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
        }
    }
}

/// A person with their tasks of the day (lens "by person"); "also in …" names their other cards.
struct CalPersonBlock: View {
    let row: CalPersonRow
    let unitId: String?
    let ix: CalIndex
    let people: CalPeople
    let today: String
    let now: Date
    let windowDays: Int
    let onOpen: (CalItem) -> Void
    @Environment(AuthStore.self) private var auth

    var body: some View {
        let also = (ix.person[row.userId]?.homeUnitIds ?? []).filter { $0 != unitId }.compactMap { ix.byId[$0]?.name }
        let name = people.name(row.userId)
        let isMe = row.userId == auth.session?.userId
        let alsoText: String? = also.isEmpty ? nil : String(format: T("also in %@"), also.joined(separator: ", "))
        let outside = also.isEmpty && !people.inChart(row.userId)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                AvatarView(url: people.avatar(row.userId), initial: calInitials(name), size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if isMe { CalYouBadge() }
                    }
                    if let alsoText {
                        Text(alsoText).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    } else if outside {
                        Text(T("not in the chart")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
                Spacer(minLength: 0)
                Text("\(row.items.count)").font(NXFont.text(11.5, .bold)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            // One header for VoiceOver: who, whether it is you, how many, where else.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(calJoin(name, isMe ? T("You") : nil, CalFormat.tasks(row.items.count), alsoText, outside ? T("not in the chart") : nil))
            .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(row.items) { item in
                    CalItemRow(item: item, unitId: unitId, ix: ix, people: people, today: today, now: now, windowDays: windowDays, showPeople: false, onOpen: onOpen)
                }
            }
            .padding(.leading, 18)
            .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 1).padding(.leading, 20) }
        }
    }
}

// MARK: - Day panel sections

struct CalRowContext {
    let ix: CalIndex
    let people: CalPeople
    let today: String
    let now: Date
    let windowDays: Int
    let lensByPerson: Bool
    let onOpen: (CalItem) -> Void
}

/// A card right under the focus (Finance & Tech, Framework Agency, …), or the focus itself for the
/// people sitting on it. Collapsible; the viewer's own cards are marked "You".
struct CalSectionCard: View {
    let node: CalTreeNode
    let own: Bool
    let mine: Bool
    let collapsed: Bool
    let toggle: () -> Void
    let ctx: CalRowContext

    var body: some View {
        let tint = calUnitColor(node.unit)
        let count = own ? Set(node.items.map(\.key) + node.people.flatMap { $0.items.map(\.key) }).count : node.count
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 10) {
                    CalUnitMark(unit: node.unit, size: 24)
                    Text(node.unit.name.uppercased()).font(NXFont.text(12, .bold)).tracking(0.6)
                        .foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    if mine { CalYouBadge() }
                    Text("\(count)").font(NXFont.text(11.5, .bold)).monospacedDigit()
                        .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(collapsed ? -90 : 0))
                }
                .padding(.horizontal, 12).padding(.vertical, 11)
                .frame(minHeight: 44)
                .overlay(alignment: .leading) { Rectangle().fill(tint).frame(width: 3) }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            // Read as a heading with its state, not as "FINANCE & TECH, 5, chevron down".
            .accessibilityLabel(calJoin(node.unit.name, mine ? T("You") : nil, CalFormat.tasks(count)))
            .accessibilityValue(collapsed ? T("Collapsed") : T("Expanded"))
            .accessibilityAddTraits(.isHeader)
            if !collapsed {
                VStack(alignment: .leading, spacing: 0) {
                    CalNodeBody(node: node, includeChildren: !own, ctx: ctx)
                }
                .padding(.horizontal, 4).padding(.bottom, 8)
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }
}

/// What a unit holds for the day: its tasks (by division) or its people (by person), then its sub-cards.
struct CalNodeBody: View {
    let node: CalTreeNode
    let includeChildren: Bool
    let ctx: CalRowContext

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if ctx.lensByPerson {
                ForEach(node.people, id: \.userId) { p in
                    CalPersonBlock(row: p, unitId: node.unit.id, ix: ctx.ix, people: ctx.people, today: ctx.today, now: ctx.now, windowDays: ctx.windowDays, onOpen: ctx.onOpen)
                }
                ForEach(node.loose) { item in
                    CalItemRow(item: item, unitId: node.unit.id, ix: ctx.ix, people: ctx.people, today: ctx.today, now: ctx.now, windowDays: ctx.windowDays, showPeople: false, onOpen: ctx.onOpen)
                }
            } else {
                ForEach(node.items) { item in
                    CalItemRow(item: item, unitId: node.unit.id, ix: ctx.ix, people: ctx.people, today: ctx.today, now: ctx.now, windowDays: ctx.windowDays, onOpen: ctx.onOpen)
                }
            }
            if includeChildren {
                ForEach(node.children) { child in
                    // Recursive views go through AnyView so the type does not contain itself.
                    AnyView(CalSubNode(node: child, ctx: ctx))
                }
            }
        }
    }
}

/// A sub-card inside a section, or a group drawn as a thin ribbon ("CREATIVE · 1") around its cards.
struct CalSubNode: View {
    let node: CalTreeNode
    let ctx: CalRowContext

    var body: some View {
        if node.unit.isGroup {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(node.unit.name.uppercased()) · \(node.count)")
                    .font(NXFont.text(11, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.top, 6)
                    .accessibilityLabel(calJoin(node.unit.name, CalFormat.tasks(node.count)))
                    .accessibilityAddTraits(.isHeader)
                ForEach(node.children) { child in AnyView(CalSubNode(node: child, ctx: ctx)) }
            }
            .padding(.bottom, 4)
            .background(CalTone.group.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(CalTone.groupLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .padding(.horizontal, 4).padding(.top, 8)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 1.5).fill(calUnitColor(node.unit)).frame(width: 3, height: 14)
                    Text(node.unit.name).font(NXFont.text(12.5, .semibold)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(node.count)").font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                }
                .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(calJoin(node.unit.name, CalFormat.tasks(node.count)))
                .accessibilityAddTraits(.isHeader)
                CalNodeBody(node: node, includeChildren: true, ctx: ctx)
                    .padding(.leading, 6)
            }
        }
    }
}

// MARK: - Week "People"

/// One week: a row per person under their Bagan card, a column per day. Phone = list (card › person ›
/// up to three tasks with the day in front); iPad/Mac = a table that fits the width (no sideways
/// scroll) when the window has room for it, the list otherwise.
struct CalPeopleWeek: View {
    let rows: [CalWeekRow]
    let days: [String]
    let today: String
    let now: Date
    let windowDays: Int
    let ix: CalIndex
    let people: CalPeople
    let wide: Bool
    let onOpenDay: (String) -> Void
    let onOpen: (CalItem) -> Void
    /// Filters are on: an empty week offers to reset them, as the day panel does.
    var filtered = false
    var onResetFilters: (() -> Void)? = nil
    /// Another week than this one: an empty week offers the way back.
    var onThisWeek: (() -> Void)? = nil
    @State private var expanded: Set<String> = []
    @Environment(AuthStore.self) private var auth
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var dayLabelWidth: CGFloat = 52
    @ScaledMetric(relativeTo: .body) private var nameColumn: CGFloat = 180
    @ScaledMetric(relativeTo: .body) private var dayColumn: CGFloat = 90

    var body: some View {
        if rows.isEmpty {
            emptyWeek
        } else if wide {
            // Regular width is not room enough by itself: Split View, Stage Manager and a Mac window
            // beside another one are regular too. The table needs its name column and seven readable
            // days; anything narrower gets the phone's list.
            ViewThatFits(in: .horizontal) {
                table.frame(minWidth: tableWidth, idealWidth: tableWidth, maxWidth: .infinity)
                list
            }
        } else {
            list
        }
    }

    private var tableWidth: CGFloat { nameColumn + 12 + 7 * dayColumn }

    @ViewBuilder private var emptyWeek: some View {
        let thisWeek = days.contains(today)
        if filtered, let onResetFilters {
            EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nobody has a task this week"),
                       subtitle: T("Filters are hiding the rest. Reset them to see everything."),
                       tint: CalTone.accentFill, actionTitle: T("Reset filters"), actionIcon: nil, action: onResetFilters, compact: true)
        } else if !thisWeek, let onThisWeek {
            EmptyState(icon: "person.2", title: T("Nobody has a task this week"), subtitle: T("Pick another week, or reset the filters."),
                       tint: CalTone.accentFill, actionTitle: T("This week"), actionIcon: nil, action: onThisWeek, compact: true)
        } else {
            EmptyState(icon: "person.2", title: T("Nobody has a task this week"), subtitle: T("Pick another week, or reset the filters."),
                       tint: CalTone.accentFill, compact: true)
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                switch row {
                case let .unit(unit, depth, count):
                    if unit.isGroup {
                        Text("\(unit.name.uppercased()) · \(count)").font(NXFont.text(11, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg)
                            .padding(.leading, CGFloat(depth) * 10 + 4).padding(.top, 4)
                            .accessibilityLabel(calJoin(unit.name, CalFormat.tasks(count)))
                            .accessibilityAddTraits(.isHeader)
                    } else {
                        HStack(spacing: 8) {
                            CalUnitMark(unit: unit, size: 20)
                            Text(unit.name.uppercased()).font(NXFont.text(11.5, .bold)).tracking(0.5).lineLimit(1)
                            Spacer(minLength: 0)
                            Text("\(count)").font(NXFont.text(11.5, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(alignment: .leading) { Rectangle().fill(calUnitColor(unit)).frame(width: 3).clipShape(RoundedRectangle(cornerRadius: 1.5)) }
                        .padding(.leading, CGFloat(depth) * 10)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(calJoin(unit.name, CalFormat.tasks(count)))
                        .accessibilityAddTraits(.isHeader)
                    }
                case let .unplaced(_, count):
                    Text(String(format: T("Not in the chart yet · %d"), count).uppercased()).font(NXFont.text(11, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg).padding(.top, 4)
                        .accessibilityAddTraits(.isHeader)
                case let .person(unitId, userId, depth, perDay):
                    personCard(key: "p|\(unitId ?? "-")|\(userId)", userId: userId, depth: depth, perDay: perDay)
                case let .loose(unitId, depth, perDay):
                    personCard(key: "l|\(unitId)", userId: nil, depth: depth, perDay: perDay)
                }
            }
        }
    }

    private func personCard(key: String, userId: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        let name = userId.map { people.name($0) }
        let isMe = userId != nil && userId == auth.session?.userId
        let entries: [(day: String, item: CalItem)] = perDay.enumerated().flatMap { i, list in list.map { (days[i], $0) } }
        let unfolded = expanded.contains(key)
        let shown = unfolded ? entries : Array(entries.prefix(3))
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if let name, let userId {
                    AvatarView(url: people.avatar(userId), initial: calInitials(name), size: 24)
                }
                Text(name ?? T("Tasks without a person")).font(NXFont.text(13, name == nil ? .regular : .semibold))
                    .italic(name == nil).foregroundStyle(name == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                if isMe { CalYouBadge() }
                Spacer(minLength: 0)
                heatStrip(perDay)
                Text("\(entries.count)").font(NXFont.text(11.5, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
            }
            // The strip, in words: who, how many, and on which days.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(weekLabel(name: name, isMe: isMe, total: entries.count, perDay: perDay))
            .accessibilityAddTraits(.isHeader)
            ForEach(Array(shown.enumerated()), id: \.offset) { _, e in
                entryRow(e.day, e.item)
            }
            if entries.count > 3 {
                Button {
                    if unfolded { expanded.remove(key) } else { expanded.insert(key) }
                } label: {
                    Text(unfolded ? T("Show less") : String(format: T("+%d more"), entries.count - 3))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.accent)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.leading, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
            }
        }
        .padding(10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .padding(.leading, CGFloat(depth) * 10)
    }

    /// The day in front of a task; above it at the accessibility text sizes, where a fixed column
    /// would squeeze the task to a few letters.
    @ViewBuilder private func entryRow(_ day: String, _ item: CalItem) -> some View {
        let label = Text(CalFormat.day(day, "EEEd")).font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
        let row = CalItemRow(item: item, unitId: nil, ix: ix, people: people, today: today, now: now, windowDays: windowDays,
                             showPeople: false, compact: true, onOpen: onOpen)
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                label.padding(.leading, 10).padding(.top, 4)
                row
            }
        } else {
            HStack(spacing: 6) {
                label.frame(width: dayLabelWidth, alignment: .leading)
                row
            }
        }
    }

    /// Seven squares, Monday to Sunday: hollow = nothing due, filled = something due (darker = more).
    /// Filled starts at 70% of the accent, so a one-task day is 3.3:1 against the card, never a
    /// shade away from an empty one.
    private func heatStrip(_ perDay: [[CalItem]]) -> some View {
        HStack(spacing: 2) {
            ForEach(0..<7, id: \.self) { i in
                let n = perDay[i].count
                RoundedRectangle(cornerRadius: 2)
                    .fill(n == 0 ? Color.clear : CalTone.accent.opacity(n <= 2 ? 0.7 : n <= 4 ? 0.85 : 1))
                    .overlay {
                        if n == 0 { RoundedRectangle(cornerRadius: 2).strokeBorder(NX.mutedFg.opacity(0.6), lineWidth: 1) }
                    }
                    .frame(width: 8, height: 8)
            }
        }
        .accessibilityHidden(true)
    }

    private func weekLabel(name: String?, isMe: Bool, total: Int, perDay: [[CalItem]]) -> String {
        var busy: [String] = []
        for i in 0..<7 where !perDay[i].isEmpty {
            busy.append("\(CalFormat.day(days[i], "EEE")) \(perDay[i].count)")
        }
        return calJoin(name ?? T("Tasks without a person"), isMe ? T("You") : nil, CalFormat.tasks(total), busy.joined(separator: ", "))
    }

    private var table: some View {
        let names = CalFormat.weekdays()
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text(T("Person").uppercased()).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: nameColumn, alignment: .leading).padding(.leading, 12)
                ForEach(0..<7, id: \.self) { i in
                    let isToday = days[i] == today
                    Button { onOpenDay(days[i]) } label: {
                        Text("\(names[i].uppercased()) \(Int(days[i].suffix(2)) ?? 0)")
                            .font(NXFont.text(11, .bold)).foregroundStyle(isToday ? CalTone.accent : NX.mutedFg)
                            .lineLimit(1).minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.leading, 6)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityLabel(calJoin(CalFormat.day(days[i], "EEEEdMMMM"), isToday ? T("Today") : nil))
                }
            }
            .background(NX.muted.opacity(0.6))
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                tableRow(row)
                Divider().overlay(CalTone.hairline)
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }

    @ViewBuilder private func tableRow(_ row: CalWeekRow) -> some View {
        switch row {
        case let .unit(unit, depth, count):
            HStack(spacing: 8) {
                if !unit.isGroup { RoundedRectangle(cornerRadius: 1.5).fill(calUnitColor(unit)).frame(width: 3, height: 14) }
                Text(unit.name.uppercased()).font(NXFont.text(unit.isGroup ? 11 : 11.5, .bold)).tracking(0.5)
                    .foregroundStyle(unit.isGroup ? NX.mutedFg : NX.foreground)
                Text("\(count)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
            }
            .padding(.leading, 12 + CGFloat(depth) * 14).padding(.vertical, 6)
            .background(unit.isGroup ? CalTone.group.opacity(0.4) : NX.muted.opacity(0.3))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(calJoin(unit.name, CalFormat.tasks(count)))
            .accessibilityAddTraits(.isHeader)
        case let .unplaced(_, count):
            Text(String(format: T("Not in the chart yet · %d"), count).uppercased()).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 12).padding(.vertical, 6)
                .accessibilityAddTraits(.isHeader)
        case let .person(_, userId, depth, perDay):
            dayCells(userId: userId, depth: depth, perDay: perDay)
        case let .loose(_, depth, perDay):
            dayCells(userId: nil, depth: depth, perDay: perDay)
        }
    }

    private func dayCells(userId: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        let name = userId.map { people.name($0) }
        let isMe = userId != nil && userId == auth.session?.userId
        let who = name ?? T("Tasks without a person")
        return HStack(alignment: .top, spacing: 0) {
            HStack(spacing: 6) {
                if let name, let userId {
                    AvatarView(url: people.avatar(userId), initial: calInitials(name), size: 20).accessibilityHidden(true)
                }
                Text(who).font(NXFont.text(12, name == nil ? .regular : .semibold))
                    .italic(name == nil).foregroundStyle(name == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                if isMe { CalYouBadge() }
            }
            .frame(width: max(nameColumn - CGFloat(depth) * 14, 60), alignment: .leading)
            .padding(.leading, 12 + CGFloat(depth) * 14).padding(.vertical, 6)
            .frame(minHeight: 44)
            ForEach(0..<7, id: \.self) { i in
                tableCell(who: calJoin(who, isMe ? T("You") : nil), day: days[i], items: perDay[i])
            }
        }
    }

    /// A day of one person: the whole cell is one target that opens the day (by person), instead of
    /// 11 pt task lines nobody could hit with a finger. A long press (right-click on a Mac) still
    /// opens a task straight away.
    @ViewBuilder private func tableCell(who: String, day: String, items: [CalItem]) -> some View {
        let isToday = day == today
        let openable = items.filter { !$0.masked && $0.taskId != nil }
        let cell = VStack(alignment: .leading, spacing: 2) {
            ForEach(items.prefix(2)) { item in
                HStack(spacing: 4) {
                    CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays, size: 11)
                    Text(item.masked ? T("Internal task") : (item.title ?? ""))
                        .font(NXFont.text(11)).lineLimit(1)
                        .foregroundStyle(item.masked || item.done ? NX.mutedFg : NX.foreground)
                        .strikethrough(item.done, color: NX.mutedFg)
                }
            }
            if items.count > 2 {
                Text(String(format: T("+%d more"), items.count - 2))
                    .font(NXFont.text(11, .semibold)).foregroundStyle(CalTone.accent)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
        .padding(4)
        .background(isToday ? CalTone.accent.opacity(0.06) : Color.clear)
        .overlay(alignment: .leading) { Rectangle().fill(CalTone.hairline).frame(width: 1) }
        .contentShape(Rectangle())
        let button = Button { onOpenDay(day) } label: { cell }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(tableCellLabel(who: who, day: day, items: items))
            .accessibilityHint(T("Opens this day in the calendar"))
        if items.isEmpty {
            cell.accessibilityHidden(true)
        } else if openable.isEmpty {
            button
        } else {
            button.contextMenu {
                ForEach(openable) { item in
                    Button(item.title ?? T("Task details")) { onOpen(item) }
                }
            }
        }
    }

    private func tableCellLabel(who: String, day: String, items: [CalItem]) -> String {
        var titles = items.prefix(3).map { $0.masked ? T("Internal task") : ($0.title ?? "") }
        if items.count > 3 { titles.append(String(format: T("+%d more"), items.count - 3)) }
        return calJoin(CalFormat.day(day, "EEEEdMMMM"), who, "\(CalFormat.tasks(items.count)): \(titles.joined(separator: ", "))")
    }
}

// MARK: - Filters

/// Every filter of the Calendar; they run on what is loaded and move the dots, counts, legend, day
/// and People view together. The server only decides what may be seen.
///
/// A grouped List like the app's other settings-shaped sheets: the scope and the priorities as
/// checkmark rows, the two switches, and divisions / people / projects each on a searchable page of
/// their own. Reset sits in the toolbar, not under 50 rows.
struct CalFilterSheet: View {
    @Binding var filters: CalFilters
    let ix: CalIndex
    let items: [CalItem]
    let people: CalPeople
    let myHomes: [String]
    @Environment(\.dismiss) private var dismiss

    private static let priorities = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]

    /// Everyone with a task this month, plus anyone still picked (so they can be un-picked).
    private var personIds: [String] {
        Array(Set(items.flatMap(\.assigneeIds)).union(filters.people)).sorted { CalendarCore.nameOrder(people.name($0), people.name($1)) }
    }
    private var projects: [CalProjectRef] {
        var seen: [String: CalProjectRef] = [:]
        for i in items { if let p = i.project { seen[p.id] = p } }
        return seen.values.sorted { CalendarCore.nameOrder($0.name, $1.name) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    scopeRow(.all, T("Everyone"))
                    scopeRow(.me, T("Mine"))
                    scopeRow(.division, T("My division"))
                } header: {
                    Text(T("Show"))
                } footer: {
                    if myHomes.isEmpty { Text(T("You are not in the chart yet, so \"My division\" is off.")) }
                }
                Section {
                    Toggle(isOn: $filters.hideDone) { Text(T("Hide done tasks")).font(NXFont.text(15)).foregroundStyle(NX.foreground) }
                        .tint(NX.violetText)
                    Toggle(isOn: $filters.overdueOnly) { Text(T("Only overdue")).font(NXFont.text(15)).foregroundStyle(NX.foreground) }
                        .tint(NX.violetText)
                }
                Section {
                    NavigationLink { unitPage } label: {
                        linkLabel(T("Divisions"), summary(filters.units) { ix.byId[$0]?.name })
                    }
                    NavigationLink { peoplePage } label: {
                        linkLabel(T("People"), summary(filters.people) { people.name($0) })
                    }
                    NavigationLink { projectPage } label: {
                        linkLabel(T("Projects"), summary(filters.projects) { id in projects.first { $0.id == id }?.name })
                    }
                }
                Section(T("Priority")) {
                    ForEach(Self.priorities, id: \.self) { p in
                        CalCheckRow(on: filters.priorities.contains(p), action: { toggle(&filters.priorities, p) },
                                    label: Text(priorityLabel(p)).font(NXFont.text(15)))
                    }
                }
            }
            .navigationTitle(T("Filters"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(T("Reset filters"), role: .destructive) { filters = CalFilters() }
                        .disabled(filters.activeCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            }
        }
    }

    /// "My division" needs a place in the chart; without one it is shown off, and the footer says why.
    private func scopeRow(_ scope: CalScope, _ title: String) -> some View {
        let unavailable = scope == .division && myHomes.isEmpty
        return CalCheckRow(on: filters.scope == scope, action: { filters.scope = scope },
                           label: Text(title).font(NXFont.text(15)).foregroundStyle(unavailable ? NX.mutedFg : NX.foreground))
            .disabled(unavailable)
    }

    private func linkLabel(_ title: String, _ value: String) -> some View {
        HStack(spacing: 8) {
            Text(title).font(NXFont.text(15)).foregroundStyle(NX.foreground)
            Spacer(minLength: 8)
            Text(value).font(NXFont.text(15)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
    }

    /// "All" when nothing is picked, the name when one is, the count otherwise.
    private func summary(_ ids: [String], _ name: (String) -> String?) -> String {
        if ids.isEmpty { return T("All") }
        if ids.count == 1, let n = name(ids[0]), !n.isEmpty { return n }
        return String(format: T("%d selected"), ids.count)
    }

    private var unitPage: some View {
        CalFilterPickList(title: T("Divisions"), prompt: T("Search divisions…"),
                          options: ix.units.map { u in
                              CalFilterOption(id: u.id, name: u.name, mark: .dot(calUnitColor(u)), indent: u.depth, heading: u.isGroup)
                          },
                          selection: $filters.units)
    }

    private var peoplePage: some View {
        CalFilterPickList(title: T("People"), prompt: T("Search people…"), empty: T("Nobody has a task this month."),
                          options: personIds.map { id in CalFilterOption(id: id, name: people.name(id), mark: .avatar(people.avatar(id))) },
                          selection: $filters.people)
    }

    private var projectPage: some View {
        CalFilterPickList(title: T("Projects"), prompt: T("Search projects…"), empty: T("No project has a task this month."),
                          options: projects.map { p in CalFilterOption(id: p.id, name: p.name, mark: .swatch(calProjectColor(p.color))) },
                          selection: $filters.projects)
    }

    private func toggle(_ list: inout [String], _ id: String) {
        if let i = list.firstIndex(of: id) { list.remove(at: i) } else { list.append(id) }
    }

    private func priorityLabel(_ p: String) -> String {
        switch p {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "MEDIUM": return T("Medium")
        case "LOW": return T("Low")
        default: return T("None")
        }
    }
}

/// A list row that is picked or not: the system's trailing checkmark, and "Selected" for VoiceOver.
private struct CalCheckRow<RowLabel: View>: View {
    let on: Bool
    let action: () -> Void
    let label: RowLabel

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                label
                Spacer(minLength: 8)
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(CalTone.accent)
                    .opacity(on ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(NX.foreground)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// One thing a filter page can pick: a division (with its dot), a person (avatar) or a project
/// (its colour).
private struct CalFilterOption: Identifiable {
    enum Mark {
        case dot(Color)
        case avatar(String?)
        case swatch(Color)
    }
    let id: String
    let name: String
    let mark: Mark
    var indent = 0
    /// A Bagan group (CREATIVE): small capitals, as everywhere else.
    var heading = false
}

/// A searchable page of options with checkmarks; "Clear" un-picks them all.
private struct CalFilterPickList: View {
    let title: String
    let prompt: String
    var empty: String? = nil
    let options: [CalFilterOption]
    @Binding var selection: [String]
    @State private var query = ""

    private var shown: [CalFilterOption] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? options : options.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        List {
            if options.isEmpty {
                if let empty { Text(empty).font(NXFont.text(14)).foregroundStyle(NX.mutedFg) }
            } else if shown.isEmpty {
                Text(String(format: T("Nothing matches “%@”."), query)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(shown) { o in
                    CalCheckRow(on: selection.contains(o.id), action: { toggle(o.id) }, label: optionLabel(o))
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !selection.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { Button(T("Clear")) { selection = [] } }
            }
        }
    }

    private func optionLabel(_ o: CalFilterOption) -> some View {
        HStack(spacing: 10) {
            Group {
                switch o.mark {
                case .dot(let c):
                    Circle().fill(c).frame(width: 10, height: 10)
                case .avatar(let url):
                    AvatarView(url: url, initial: calInitials(o.name), size: 26)
                case .swatch(let c):
                    RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 12, height: 12)
                }
            }
            .accessibilityHidden(true)
            Text(o.heading ? o.name.uppercased() : o.name)
                .font(o.heading ? NXFont.text(12, .bold) : NXFont.text(15))
                .foregroundStyle(o.heading ? NX.mutedFg : NX.foreground)
                .lineLimit(1)
        }
        // The Bagan's nesting, while browsing; a search result stands on its own.
        .padding(.leading, query.isEmpty ? CGFloat(o.indent) * 12 : 0)
    }

    private func toggle(_ id: String) {
        if let i = selection.firstIndex(of: id) { selection.remove(at: i) } else { selection.append(id) }
    }
}

// MARK: - Read-only task preview

/// A task the viewer may read but not change (owner, 5 Oct 2026: someone outside the task's project
/// can open it and see its details, not edit it). The same GET /api/tasks/:id as the full screen, no
/// controls at all. A task of a private project the viewer is not in is never fetched.
struct CalTaskPreview: View {
    let taskId: String
    let projectName: String?
    let notMember: Bool
    let masked: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var labelWidth: CGFloat = 90
    @State private var task: TaskDetail?
    @State private var failure: Failure?

    /// Why the task did not come. The server's words for the first two are English ("Forbidden",
    /// "Task not found"), so they get the app's own sentences in either language; anything else
    /// keeps its message and a way to try again.
    private enum Failure {
        case forbidden
        case gone
        case other(String)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label(projectName != nil && notMember ? String(format: T("Read only · you are not a member of %@"), projectName ?? "") : T("Read only"), systemImage: "eye")
                        .font(NXFont.text(12.5)).foregroundStyle(Color(light: 0x92400e, dark: 0xfcd34d))
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(light: 0xfffbeb, dark: 0x3a2a0a), in: RoundedRectangle(cornerRadius: 12))
                    if masked {
                        EmptyState(icon: "lock", title: T("Internal task"),
                                   subtitle: T("This is an internal task of a private project. Only its members can open it."),
                                   tint: CalTone.accentFill, compact: true)
                    } else if let task {
                        content(task)
                    } else if let failure {
                        failureView(failure)
                    } else {
                        SkeletonList(count: 3)
                    }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            // "Task" stays "Task" in Indonesian elsewhere in the app; this sheet says tugas like its rows.
            .navigationTitle(T("Task details"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
        }
        .task {
            guard !masked, task == nil else { return }
            await load()
        }
    }

    private func load() async {
        failure = nil
        do {
            task = try await APIClient.shared.taskDetail(taskId)
        } catch APIError.http(403, _) {
            failure = .forbidden
        } catch APIError.http(404, _) {
            failure = .gone
        } catch _ where Task.isCancelled {
            return
        } catch {
            failure = .other(error.localizedDescription)
        }
    }

    @ViewBuilder private func failureView(_ f: Failure) -> some View {
        switch f {
        case .forbidden:
            EmptyState(icon: "lock", title: T("You can't open this task anymore"),
                       subtitle: T("You no longer have access to its project. Ask one of its members if you need it."),
                       tint: CalTone.accentFill, compact: true)
        case .gone:
            EmptyState(icon: "trash", title: T("This task no longer exists"),
                       subtitle: T("It may have been deleted. The calendar drops it on its next refresh."),
                       tint: CalTone.accentFill, compact: true)
        case .other(let message):
            ErrorState(message: message, icon: "checklist") { Task { await load() } }
        }
    }

    @ViewBuilder private func content(_ t: TaskDetail) -> some View {
        if let parent = t.parent {
            Label(String(format: T("from %@"), parent.title ?? ""), systemImage: "arrow.turn.down.right")
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        Text(t.title).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            .accessibilityAddTraits(.isHeader)
        VStack(alignment: .leading, spacing: 8) {
            field(T("Status"), statusLabel(t.status))
            field(T("Due"), dueLabel(t.dueDate))
            field(T("Priority"), priorityLabel(t.priority))
            if let projectName { field(T("Project"), projectName) }
            fieldRow(T("People")) {
                VStack(alignment: .leading, spacing: 4) {
                    let users = (t.assignees ?? []).compactMap(\.user)
                    if users.isEmpty { Text(T("Nobody yet")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
                    ForEach(Array(users.enumerated()), id: \.offset) { _, u in
                        HStack(spacing: 6) {
                            AvatarView(url: u.avatar, initial: calInitials(u.name ?? "?"), size: 20).accessibilityHidden(true)
                            Text(u.name ?? "?").font(NXFont.text(13))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 16)
        let description = blockText(t.description)
        if !description.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Description")).accessibilityAddTraits(.isHeader)
                Text(description).font(NXFont.text(13.5)).foregroundStyle(NX.foreground).frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard(padding: 14, radius: 16)
            }
        }
        if let subs = t.subtasks, !subs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Subtasks")).accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(subs) { s in
                        HStack(spacing: 8) {
                            Image(systemName: s.isDone ? "checkmark.circle.fill" : "circle").foregroundStyle(s.isDone ? NX.success : NX.mutedFg)
                                .accessibilityLabel(s.isDone ? T("Done") : T("To do"))
                            Text(s.title ?? "").font(NXFont.text(13.5)).strikethrough(s.isDone, color: NX.mutedFg)
                                .foregroundStyle(s.isDone ? NX.mutedFg : NX.foreground)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
        if let comments = t.comments, !comments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Comments")).accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(comments) { c in
                        HStack(alignment: .top, spacing: 8) {
                            AvatarView(url: c.user?.avatar, initial: calInitials(c.user?.name ?? "?"), size: 24).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.user?.name ?? "?").font(NXFont.text(12, .semibold))
                                Text(blockText(c.content)).font(NXFont.text(13.5)).foregroundStyle(NX.foreground)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        fieldRow(label) { Text(value).font(NXFont.text(13)).foregroundStyle(NX.foreground) }
    }

    /// A label and its value side by side; at the accessibility text sizes the label goes above,
    /// so "Prioritas" is never broken in the middle of the word by a fixed column.
    @ViewBuilder private func fieldRow<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                value()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            HStack(alignment: .top, spacing: 10) {
                Text(label).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).frame(width: labelWidth, alignment: .leading)
                value()
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func statusLabel(_ s: String?) -> String {
        switch (s ?? "").uppercased() {
        case "DONE": return T("Done")
        case "IN_PROGRESS": return T("In progress")
        case "IN_REVIEW": return T("In review")
        case "CANCELLED": return T("Cancelled")
        default: return T("To do")
        }
    }

    private func priorityLabel(_ p: String?) -> String {
        switch (p ?? "").uppercased() {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "LOW": return T("Low")
        case "NONE": return T("None")
        default: return T("Medium")
        }
    }

    /// The WIB day of the due date, plus its time when it has one (not 00:00 UTC / 00:00 WIB).
    private func dueLabel(_ iso: String?) -> String {
        guard let iso, let due = CalDays.instant(iso) else { return T("No due date") }
        let wib = due.addingTimeInterval(7 * 3600)
        let day = CalDays.key(wib)
        let comps = CalDays.utc.dateComponents([.hour, .minute], from: wib)
        let utcComps = CalDays.utc.dateComponents([.hour, .minute], from: due)
        let dateOnly = (utcComps.hour == 0 && utcComps.minute == 0) || (comps.hour == 0 && comps.minute == 0)
        let base = CalFormat.day(day, "EEEEdMMMMyyyy")
        guard !dateOnly, let h = comps.hour, let m = comps.minute else { return base }
        return "\(base) · \(CalFormat.time(String(format: "%02d:%02d", h, m))) WIB"
    }
}
