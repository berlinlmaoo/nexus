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
// The one lazy stack is the People week's list, inside the screen's single vertical scroll.
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

/// The Calendar's colours, light and dark, with an Increase Contrast value where one exists.
///
/// The accent IS the app's violet (NX.violetText / NX.violetFill): today, the selection, toggles,
/// badges and every call to action, so a tint means "tappable" here exactly as on every other screen,
/// the widgets and the watch. It used to be a copy of those values with its own high-contrast pair,
/// so with Increase Contrast on the Calendar drew two different violets side by side (impeccable
/// re-audit, 7 Oct 2026). The Bagan's navy stays the Bagan's own: the group ribbons and the tile
/// behind a light logo.
enum CalTone {
    /// The accent as TEXT, ICON or RING on a surface.
    static let accent = NX.violetText
    /// The accent as a FILL under white text (today's disc, empty-state buttons).
    static let accentFill = NX.violetFill
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

// MARK: - Type

/// The Calendar's point sizes. The Mac build is the iPad app drawn at 77%, where an 11 pt count came
/// out at about 8.5 pt, under the Mac's 10 pt floor (impeccable re-audit, 7 Oct 2026). There a size is
/// raised by the same factor, to the nearest half point, so it lands where the iPad has it; on iPhone
/// and iPad it is the size as written. Used for type, for the symbols set in a line of type, and for
/// the month cell that has to hold them.
enum CalType {
    static func size(_ pt: CGFloat) -> CGFloat {
        #if targetEnvironment(macCatalyst)
        return (pt / 0.77 * 2).rounded() / 2
        #else
        return pt
        #endif
    }
}

/// The Calendar's one uppercase label, SectionLabel's own style (11 pt bold, tracked 0.5): the weekday
/// row, division and group names, "Not in the chart yet", the People table's headings and the "You"
/// tag — in the month, the day and the People week alike. They used five sizes and trackings between
/// them, so the same division name changed when switching Month and People. Colour stays per label.
enum CalCaps {
    static var font: Font { NXFont.text(CalType.size(11), .bold) }
    static let tracking: CGFloat = 0.5
}

extension Text {
    /// Set as the Calendar's uppercase label (CalCaps); the words come upper-cased.
    func calCaps() -> Text { font(CalCaps.font).tracking(CalCaps.tracking) }
}

enum CalFormat {
    private static var cache: [String: DateFormatter] = [:]
    /// Days already formatted. The grid asks for the same 42 VoiceOver labels on every pass, and the
    /// People week for each card's days — each a parse and a format. Keyed by language, template and
    /// day; emptied when it grows past a few thousand.
    private static var labels: [String: String] = [:]

    private static var isID: Bool { AppLanguage.shared.lang == .id }

    /// A WIB day string through a localized template, never shifted by the device's time zone.
    static func day(_ day: String, _ template: String) -> String {
        let key = "\(isID)|\(template)"
        let labelKey = key + "|" + day
        if let hit = labels[labelKey] { return hit }
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
        let text = f.string(from: CalDays.date(day))
        if labels.count > 4000 { labels.removeAll(keepingCapacity: true) }
        labels[labelKey] = text
        return text
    }

    /// "19.00" in Indonesian, "19:00" in English.
    static func time(_ t: String?) -> String {
        guard let t else { return "" }
        return isID ? t.replacingOccurrences(of: ":", with: ".") : t
    }

    /// Monday…Sunday, short; worked out once per language.
    static func weekdays() -> [String] {
        let id = isID
        if let hit = weekdayNames[id] { return hit }
        let names = (0..<7).map { day(CalDays.addDays("2026-10-05", $0), "EEE") }
        weekdayNames[id] = names
        return names
    }
    private static var weekdayNames: [Bool: [String]] = [:]

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

// MARK: - Unit mark, avatar, status glyph, priority, "You"

/// An IP's logo on a tile picked from the logo itself, or the unit's initial on its own colour.
///
/// The tile grows with the reader's text size, up to twice its size, so a name set three times
/// larger does not dwarf it; the initial is sized from the tile, not from the text size, so it never
/// spills out of it (at AX5 it used to be three times the tile).
struct CalUnitMark: View {
    let unit: CalUnit
    var size: CGFloat = 22
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    private var logoURL: URL? {
        guard unit.kind == "IP", let raw = unit.logoUrl, !raw.isEmpty else { return nil }
        return URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    var body: some View {
        let tint = calUnitColor(unit)
        let side = size * min(max(scale, 1), 2)
        Group {
            if let logoURL {
                CalLogoTile(url: logoURL, size: side) { initial(tint, side) }
            } else {
                initial(tint, side)
            }
        }
        .frame(width: side, height: side)
        .accessibilityHidden(true)
    }

    private func initial(_ tint: Color, _ side: CGFloat) -> some View {
        Text(String(unit.name.first.map { String($0) } ?? "·").uppercased())
            .font(.custom("Inter", fixedSize: side * 0.45).weight(.bold))
            .foregroundStyle(tint)
            .frame(width: side, height: side)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: side / 4, style: .continuous))
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
                                in: RoundedRectangle(cornerRadius: size / 4, style: .continuous))
                    // Smart Invert leaves a logo, and the tile picked for it, as they are: inverted,
                    // a white logo on its navy tile became a dark logo on a black one.
                    .accessibilityIgnoresInvertColors()
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

/// A face in the Calendar: AvatarView's look, decoded at the size the Calendar draws it.
///
/// Every face here is 18–26 pt, and the app's 300 px tile is about 17 times the pixels of a 24 pt
/// circle at 3× — some 16 MB of bitmaps for one "Everyone" week of the People view (impeccable
/// re-audit, 7 Oct 2026). One 96 px decode (3× of 32 pt) serves every size here. A 300 px tile some
/// other screen already decoded is used as it is: that costs nothing more, and it paints at once.
struct CalAvatar: View {
    let url: String?
    let initial: String
    let size: CGFloat
    @State private var image: UIImage? = nil
    /// The picture `image` belongs to, so a row reused for someone else never shows the last face.
    @State private var imageURL: URL? = nil

    private static let pixels: CGFloat = 96

    init(url: String?, initial: String, size: CGFloat) {
        self.url = url
        self.initial = initial
        self.size = size
        ImageDiskCache.prewarm()
        if let resolved = Self.resolve(url), let hit = Self.decoded(resolved) {
            _image = State(initialValue: hit)
            _imageURL = State(initialValue: resolved)
        }
    }

    private static func resolve(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        return URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    /// This face already decoded: at the Calendar's size, or as another screen's tile.
    private static func decoded(_ url: URL) -> UIImage? {
        ImageLoader.memory.object(forKey: ImageLoader.cacheKey(url, pixels) as NSURL)
            ?? ImageLoader.memory.object(forKey: ImageLoader.cacheKey(url, ImageLoader.tilePixel) as NSURL)
    }

    var body: some View {
        let resolved = Self.resolve(url)
        ZStack {
            Circle().fill(NX.accentBg)
            if let image, let resolved, imageURL == resolved {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    // A face stays a face under Smart Invert.
                    .accessibilityIgnoresInvertColors()
            } else {
                // Sized from the circle, not the text size: at the accessibility sizes Inter at body
                // scale outgrew the circle.
                Text(initial).font(.custom("Inter", fixedSize: size * 0.36).weight(.bold)).foregroundStyle(NX.violetText)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(NX.border, lineWidth: 0.5))
        .task(id: resolved) {
            guard let resolved else { return }
            if imageURL == resolved, image != nil { return }
            if let hit = Self.decoded(resolved) {
                image = hit
                imageURL = resolved
                return
            }
            guard let img = await ImageLoader.shared.image(for: resolved, maxPixel: Self.pixels) else { return }
            image = img
            imageURL = resolved
        }
    }
}

/// ○ to do, ✓ done, ! overdue within the window (red), a dashed ring once it is older, ◆ project
/// without status.
///
/// `size` is the mark at the default text size; it grows with the reader's text size as the title
/// beside it does (Inter is scaled relative to body). It used to stay 16 pt beside a title three times
/// that at AX5 (impeccable re-audit round 3, 8 Oct 2026).
struct CalStatusGlyph: View {
    let item: CalItem
    let today: String
    let now: Date
    let windowDays: Int
    var size: CGFloat = 16
    /// The row has usually worked this out already; passed in, it is not done twice per row.
    var state: CalOverdue? = nil
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let od = state ?? CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        let side = size * scale
        Group {
            if item.done {
                Image(systemName: "checkmark.circle.fill").resizable().foregroundStyle(NX.success)
            } else if item.noStatus {
                Image(systemName: "diamond.fill").resizable().scaleEffect(0.5).foregroundStyle(NX.mutedFg)
            } else if od == .recent {
                Image(systemName: "exclamationmark.circle.fill").resizable().foregroundStyle(CalTone.overdue)
            } else if od == .stale {
                // Overdue past the window: no longer red news, but not a plain to-do either. It was the
                // to-do ring at 70% (2.9:1, under the 3:1 a mark needs) and VoiceOver called it "To do";
                // now a dashed ring at full strength (5.3:1), spoken as what it is.
                Circle().strokeBorder(NX.mutedFg, style: StrokeStyle(lineWidth: 2, dash: dash(side)))
            } else {
                Circle().strokeBorder(NX.mutedFg, lineWidth: 2)
            }
        }
        .frame(width: side, height: side)
        .accessibilityLabel(spoken(od))
    }

    /// Even dashes all the way round, at any size.
    private func dash(_ side: CGFloat) -> [CGFloat] {
        let round = CGFloat.pi * max(side - 2, 1)
        let step = round / (side >= 14 ? 8 : 6)
        return [step * 0.6, step * 0.4]
    }

    private func spoken(_ od: CalOverdue) -> String {
        if item.done { return T("Done") }
        if item.noStatus { return T("No status") }
        switch od {
        case .recent: return T("Overdue")
        case .stale: return String(format: T("Overdue for more than %d days"), windowDays)
        case .none: return T("To do")
        }
    }
}

struct CalPriorityChip: View {
    let priority: String?
    var body: some View {
        if priority == "URGENT" {
            CalChip(text: T("Urgent"), tone: .danger)
        } else if priority == "HIGH" {
            CalChip(text: T("High"), tone: .warning)
        }
    }
}

/// NexusChip's look in the Calendar's sizes (CalType): the shared chip is 11 pt as written, which the
/// Mac draws at about 8.5 pt (impeccable re-audit round 3, 8 Oct 2026). The same chip on iPhone and
/// iPad; every other screen keeps NexusChip as it is.
private struct CalChip: View {
    let text: String
    let tone: ChipTone
    var body: some View {
        Text(text).font(NXFont.text(CalType.size(11), .bold))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .foregroundStyle(tone.fg)
            .background(tone.bg, in: Capsule())
    }
}

/// OfflineNotice in the Calendar's sizes (CalType), its symbol in the line's own type so it grows with
/// the text. The shared notice is 11 / 10 pt as written: about 8.5 pt on the Mac.
struct CalSavedNotice: View {
    let savedAt: Date

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.down.circle").font(NXFont.text(CalType.size(10), .semibold))
            Text(String(format: T("Saved copy from %@"), OfflineNotice.stamp(savedAt)))
                .font(NXFont.text(CalType.size(11)))
        }
        .foregroundStyle(NX.mutedFg)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 2)
    }
}

/// The Calendar's two-line bar title on iPhone: "Calendar" in the bar's own face, and the day. The
/// first line grows with the text size like a headline (it was a fixed 17 pt beside a day that grew);
/// the cap is set from outside, where the bar's room is known.
struct CalBarTitle: View {
    let day: String
    @ScaledMetric(relativeTo: .headline) private var titleSize: CGFloat = 17

    var body: some View {
        VStack(spacing: 0) {
            Text(T("Calendar")).font(.system(size: CalType.size(titleSize), weight: .bold)).foregroundStyle(NX.foreground)
            Text(CalFormat.day(day, "EEEdMMM")).font(NXFont.text(CalType.size(11), .medium)).foregroundStyle(NX.mutedFg)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The viewer's own card, person or row: "YOU" as a tag in the Calendar's uppercase label, the form
/// TODAY has beside the date. It was a solid violet block — the form of a button here — and beside
/// the Bagan's own violet (INTOO, Production House, PATS BSD) it was one more patch of the same colour.
private struct CalYouBadge: View {
    var body: some View {
        Text(T("You").uppercased()).calCaps()
            .foregroundStyle(CalTone.accent)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

// MARK: - Month grid

/// One task as a line in a month cell (regular width): its division's colour, its title, and how it
/// stands. Worked out once per month in CalendarView (`monthLines`), not per cell per frame.
struct CalMonthLine: Hashable, Sendable {
    let key: String
    let title: String
    let masked: Bool
    /// Done, or a calendar-only entry: drawn quieter than the work still to do.
    let quiet: Bool
    let done: Bool
    /// Overdue within the window.
    let overdue: Bool
    /// HIGH or URGENT.
    let urgent: Bool
    /// The unit at the focus level the line takes its colour from ("other" = placed nowhere).
    let unitId: String
}

/// What a month cell shows beyond its dots: its tasks in the day list's order, and how many are overdue.
struct CalMonthDay: Hashable, Sendable {
    let lines: [CalMonthLine]
    let overdue: Int

    static let empty = CalMonthDay(lines: [], overdue: 0)
}

extension CalendarCore {
    /// The month cell's lines for one day, in the day list's order (to do and overdue first).
    static func monthDay(_ items: [CalItem], _ ix: CalIndex, focus focusId: String, today: String, now: Date, windowDays: Int) -> CalMonthDay {
        let cmp = compareInDay(today: today, now: now, windowDays: windowDays)
        var overdue = 0
        let lines: [CalMonthLine] = items.sorted(by: cmp).map { i in
            let late = overdueState(i, today: today, now: now, windowDays: windowDays) == .recent
            if late { overdue += 1 }
            let bucket = i.placements.lazy.compactMap { ix.bucketOf($0.unitId, focus: focusId) }.first ?? "other"
            return CalMonthLine(key: i.key, title: i.masked ? T("Internal task") : UntitledText.task(i.title), masked: i.masked,
                                quiet: !isOpen(i), done: i.done, overdue: late,
                                urgent: i.priority == "HIGH" || i.priority == "URGENT", unitId: bucket)
        }
        return CalMonthDay(lines: lines, overdue: overdue)
    }
}

/// Monday first, always six weeks.
///
/// Regular width (iPad, Mac), as the dev web (MonthGrid.tsx, owner screenshots 280/281, 13 Oct 2026):
/// each day is a bordered cell with the date top left, the day's count top right, a short red dash
/// under the date when something due that day is overdue, and one dot per division along the bottom.
/// Task titles are read in the day panel beside the grid, not in the cells; the Mac shows the web's
/// tooltip ("Thu 8 Oct · 5 tasks" and the divisions) under the pointer. Today is a near-black disc and
/// the picked day an outlined cell.
///
/// Compact width (iPhone): the date, then one dot per division (filled = still something to do, a
/// small tick = only done / status-less) after a red badge with the overdue count. A red dash under
/// the date used to mean "overdue" and read as an underline.
///
/// The grid grows with the reader's text size as far as AX1, like Apple's Calendar month (beyond that
/// a seven-column month cannot hold its numbers); the day's list keeps scaling.
struct CalMonthGrid: View {
    let days: [String]
    let month: String
    let cells: [String: CalDayCell]
    /// The tasks of each day as lines (regular width).
    var lines: [String: CalMonthDay] = [:]
    let selected: String
    let today: String
    let holidays: [String: String]
    let ix: CalIndex
    let wide: Bool
    /// The month on screen has arrived. While it has not (loading, or failed) the cells carry no
    /// counts, and VoiceOver must not hear "No tasks" about a month nobody has seen.
    var loaded: Bool = true
    /// Two panes: the height the whole grid may take (CalendarView.gridRoom). The tall weeks then
    /// shrink from their own height to fit it, down to a floor; nil = the weeks' own height.
    var fitHeight: CGFloat? = nil
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
    /// The tall cell: the date row, the overdue dash, a holiday's name and the dots.
    @ScaledMetric(relativeTo: .body) private var wideHeight: CGFloat = 96
    /// The least a tall week shrinks to when fitting two panes (`fitHeight`): the date and one line.
    @ScaledMetric(relativeTo: .body) private var wideFloor: CGFloat = 60
    @ScaledMetric(relativeTo: .body) private var disc: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var dotRow: CGFloat = 12
    /// The weekday row's measured height, taken off `fitHeight` with the six dividers.
    @State private var headRow: CGFloat = 30

    /// The height of a week: the phone's, the tall cell's, or — two panes — what fits `fitHeight`
    /// between the floor and the tall cell's own height. Fitted, it is whole points: the grid then
    /// grows or shrinks by whole points, the measured heights it is fitted from move together, and
    /// the fit cannot flip between two sizes a fraction apart.
    private var rowHeight: CGFloat {
        guard grid.wide else { return CalType.size(phoneHeight) }
        let ideal = CalType.size(wideHeight)
        guard let room = grid.fitHeight else { return ideal }
        let fit = ((room - headRow - 6) / 6).rounded(.down)
        return min(ideal.rounded(.down), max(CalType.size(wideFloor).rounded(.up), fit))
    }

    var body: some View {
        let names = CalFormat.weekdays()
        let height = rowHeight
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(names[i].uppercased()).calCaps()
                        .foregroundStyle(i >= 5 ? NX.mutedFg.opacity(0.8) : NX.mutedFg)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, alignment: grid.wide ? .leading : .center)
                        .padding(.horizontal, grid.wide ? 8 : 0)
                        .padding(.vertical, 8)
                }
            }
            .background(NX.muted.opacity(0.5))
            .background {
                if grid.fitHeight != nil {
                    GeometryReader { g in
                        Color.clear.onChange(of: g.size.height, initial: true) { _, h in
                            let v = h.rounded(.up)
                            if headRow != v { headRow = v }
                        }
                    }
                }
            }
            Divider().overlay(NX.border)
            ForEach(0..<6, id: \.self) { w in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { d in
                        dayCell(grid.days[w * 7 + d], weekend: d >= 5, height: height)
                            // Regular width: a line between the days, so a cell's marks are seen to
                            // belong to it and not to the day beside it.
                            .overlay(alignment: .trailing) {
                                if grid.wide && d < 6 { Rectangle().fill(CalTone.hairline).frame(width: 1) }
                            }
                    }
                }
                if w < 5 { Divider().overlay(CalTone.hairline) }
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
    }

    private func dayCell(_ day: String, weekend: Bool, height: CGFloat) -> some View {
        let g = grid
        let inMonth = day.hasPrefix(g.month)
        // Days of the neighbouring months show their tasks too, a little quieter (web QA B18, 13 Oct
        // 2026: the loaded range covers all 42 days, and those days used to read "No tasks").
        let cell = g.cells[day]
        let isToday = day == g.today
        let isSel = day == g.selected
        let holiday = g.holidays[day]
        let dots = cell?.dots ?? []
        let info = g.lines[day] ?? .empty
        let unitName: (CalDot) -> String = { dot in dot.unitId == "other" ? T("No division") : (g.ix.byId[dot.unitId]?.name ?? "") }
        return Button {
            Haptics.tap()
            g.onSelect(day)
        } label: {
            Group {
                if g.wide {
                    webContent(day, cell: cell, inMonth: inMonth, isToday: isToday, isSel: isSel, holiday: holiday, height: height)
                } else {
                    compactContent(day, dots: dots, info: info, inMonth: inMonth, isToday: isToday, isSel: isSel, holiday: holiday)
                }
            }
            .opacity(inMonth ? 1 : 0.6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .frame(height: height)
            // Weekends a shade off the weekdays; another month's days a shade further, so the month
            // on screen reads as one block.
            .background(!inMonth ? NX.muted.opacity(0.45) : weekend ? NX.muted.opacity(0.3) : Color.clear)
            // The picked day is a soft accent tile behind the cell: an area, not a line. A ring drawn
            // 2 pt inside the 54 pt phone cell ran into today's disc (owner, 8 Oct 2026: "nabrak sama
            // tanggal hari ini yang bulet"). The tall cell has room for an edge as well, well clear of
            // the disc, so the pick is seen at a glance across a big grid.
            .background {
                if isSel && !g.wide {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(CalTone.accent.opacity(0.14))
                        .padding(2)
                }
            }
            // Regular width, as the dev web's grid (MonthGrid.tsx `ring-2 ring-inset`): the picked day
            // is an outlined cell in the near-black of the web's primary, no tint behind its dots.
            .overlay {
                if isSel && g.wide {
                    Rectangle().strokeBorder(NX.onyx, lineWidth: 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .modifier(CalCellTip(text: g.wide ? tipText(day, cell) : nil))
        .accessibilityLabel(cellLabel(day, cell, info, holiday, isToday))
        .modifier(CalCellDivisions(todo: dots.filter(\.filled).map(unitName).joined(separator: ", "),
                                   done: dots.filter { !$0.filled }.map(unitName).joined(separator: ", ")))
        .accessibilityAddTraits(isSel ? .isSelected : [])
    }

    /// The date on today's violet disc, or plain; red on a holiday; the accent when picked.
    private func number(_ day: String, inMonth: Bool, isToday: Bool, isSel: Bool, holiday: String?) -> some View {
        let wide = grid.wide
        // Regular width: today is a near-black disc (web `bg-cal-accent` / dark `bg-primary`) and the
        // pick is the cell's outline, so the number itself is not tinted.
        let todayFg: Color = wide ? NX.background : Color.white
        let picked: Color = wide ? NX.foreground : CalTone.accent
        let color: Color = isToday ? todayFg : !inMonth ? NX.mutedFg : (holiday != nil ? CalTone.overdue : (isSel ? picked : NX.foreground))
        let side = CalType.size(min(disc, wide ? 36 : 32))
        return Text("\(Int(day.suffix(2)) ?? 0)")
            .font(NXFont.text(CalType.size(13), inMonth ? (isToday || isSel ? .bold : .semibold) : .regular)).monospacedDigit()
            .lineLimit(1).minimumScaleFactor(0.7)
            .foregroundStyle(color)
            .frame(minWidth: side, minHeight: side)
            .background { if isToday { Circle().fill(wide ? NX.onyx : CalTone.accentFill) } }
    }

    /// The pointer's tooltip on a day (Mac), as the web's: "Thu 8 Oct · 5 tasks" over the divisions and
    /// their counts. Nil for a day with nothing on it.
    private func tipText(_ day: String, _ cell: CalDayCell?) -> String? {
        guard grid.loaded, let cell, cell.count > 0 else { return nil }
        let head = "\(CalFormat.day(day, "EEEdMMM")) · \(CalFormat.tasks(cell.count))"
        let parts = cell.dots.map { dot -> String in
            let name = dot.unitId == "other" ? T("No division") : (grid.ix.byId[dot.unitId]?.name ?? "")
            return "\(name) \(dot.count)"
        }
        return parts.isEmpty ? head : head + "\n" + parts.joined(separator: " · ")
    }

    /// One division's mark: filled = something still to do; a tick = nothing left (done or no status).
    @ViewBuilder private func dotMark(_ dot: CalDot, size: CGFloat) -> some View {
        let tint = dot.unitId == "other" ? CalTone.unknown : calUnitColor(grid.ix.byId[dot.unitId])
        if dot.filled {
            Circle().fill(tint).frame(width: size, height: size)
        } else {
            Image(systemName: "checkmark")
                .font(.system(size: CalType.size(size + 1), weight: .black))
                .foregroundStyle(tint.opacity(0.6))
                .frame(width: size + 2, height: size + 2)
        }
    }

    /// The regular-width cell, as the dev web draws it (MonthGrid.tsx): the date top left, the day's
    /// count top right, a short red dash under the date when something due that day is overdue, the
    /// holiday's name where there is room, and one dot per division along the bottom (up to four, then
    /// "+N"). No task titles: the day panel beside the grid is where they are read (owner, 13 Oct 2026).
    @ViewBuilder private func webContent(_ day: String, cell: CalDayCell?, inMonth: Bool, isToday: Bool, isSel: Bool,
                                         holiday: String?, height: CGFloat) -> some View {
        let dots = cell?.dots ?? []
        let shown = Array(dots.prefix(4))
        let more = dots.count - shown.count
        let roomForHoliday = height >= CalType.size(78)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 3) {
                number(day, inMonth: inMonth, isToday: isToday, isSel: isSel, holiday: holiday)
                Spacer(minLength: 2)
                if let cell, cell.count > 0 {
                    Text("\(cell.count)")
                        .font(NXFont.text(CalType.size(11), .semibold)).monospacedDigit()
                        .foregroundStyle(NX.mutedFg)
                        .lineLimit(1)
                        .padding(.top, 4).padding(.trailing, 2)
                }
            }
            if cell?.overdue == true {
                Capsule().fill(CalTone.overdue)
                    .frame(width: 16, height: 2)
                    .padding(.top, 2).padding(.leading, 4)
            }
            if roomForHoliday, let holiday {
                Text(holiday).font(NXFont.text(CalType.size(10.5), .medium))
                    .foregroundStyle(inMonth ? CalTone.overdue : NX.mutedFg).lineLimit(1)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
            HStack(spacing: 3) {
                ForEach(shown, id: \.unitId) { dot in dotMark(dot, size: 7) }
                if more > 0 {
                    Text("+\(more)").font(NXFont.text(CalType.size(10), .bold)).foregroundStyle(NX.mutedFg)
                        .lineLimit(1)
                }
            }
            .frame(minHeight: CalType.size(dotRow), alignment: .leading)
            .padding(.leading, 3)
        }
        .padding(6)
    }

    /// The red count of what is overdue that day: a filled badge, not a line under the date.
    private func overdueBadge(_ n: Int, small: Bool) -> some View {
        HStack(spacing: 2) {
            if !small {
                Image(systemName: "exclamationmark").font(NXFont.text(CalType.size(8.5), .black))
            }
            Text("\(n)").font(NXFont.text(CalType.size(small ? 9.5 : 10.5), .bold)).monospacedDigit()
        }
        .lineLimit(1)
        .foregroundStyle(Color.white)
        .padding(.horizontal, small ? 4 : 5)
        .frame(minWidth: CalType.size(small ? 14 : 18), minHeight: CalType.size(small ? 14 : 17))
        .background(CalTone.overdue, in: Capsule())
    }

    /// The phone's cell: the date, then the overdue badge and one dot per division.
    @ViewBuilder private func compactContent(_ day: String, dots: [CalDot], info: CalMonthDay, inMonth: Bool, isToday: Bool, isSel: Bool,
                                             holiday: String?) -> some View {
        let shown = Array(dots.prefix(3))
        VStack(spacing: 2) {
            number(day, inMonth: inMonth, isToday: isToday, isSel: isSel, holiday: holiday)
            // The web's mark on every width (mobile web and desktop MonthGrid): a short red dash under
            // the date, not a red count badge (UI tour run 3: desktop web is the reference).
            Capsule().fill(info.overdue > 0 ? CalTone.overdue : Color.clear)
                .frame(width: 14, height: 2)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            HStack(spacing: 3) {
                // Filled = something still to do; a tick = nothing left (done or status-less),
                // quieter than the work still open. Owner, 8 Oct 2026: a ring read as "to do"
                // beside the task list's ○.
                ForEach(shown, id: \.unitId) { dot in dotMark(dot, size: 6) }
                if dots.count > shown.count {
                    Text("+\(dots.count - shown.count)").font(NXFont.text(CalType.size(9.5), .bold)).foregroundStyle(NX.mutedFg)
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
            }
            .frame(maxWidth: .infinity, minHeight: CalType.size(dotRow))
        }
        .padding(.horizontal, 3)
        .padding(.top, 4).padding(.bottom, 5)
    }

    private func cellLabel(_ day: String, _ cell: CalDayCell?, _ info: CalMonthDay, _ holiday: String?, _ isToday: Bool) -> String {
        var parts = [CalFormat.day(day, "EEEEdMMMM")]
        // Only a loaded range may say "No tasks"; it covers the neighbouring months' days on the grid too.
        if grid.loaded {
            parts.append(cell.map { $0.count > 0 ? CalFormat.tasks($0.count) : T("No tasks") } ?? T("No tasks"))
        }
        if info.overdue > 0 {
            parts.append(String(format: T("%d overdue"), info.overdue))
        } else if cell?.overdue == true {
            parts.append(T("Overdue"))
        }
        if let holiday { parts.append(holiday) }
        if isToday { parts.append(T("Today")) }
        return parts.joined(separator: ", ")
    }
}

/// The day's tooltip under the pointer (Mac): `help` is a tooltip there. Not on the iPad or iPhone, where
/// `help` becomes the VoiceOver hint and would repeat what the cell's label and "More content" say.
private struct CalCellTip: ViewModifier {
    let text: String?

    @ViewBuilder func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        if let text { content.help(text) } else { content }
        #else
        content
        #endif
    }
}

/// Which divisions have work on a day, for VoiceOver's "More content": what the dots tell a sighted
/// reader (filled = still to do, a small tick = only done or status-less).
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
///
/// A task that opens read-only says so before the tap: a quiet eye after its title, and "Read only"
/// to VoiceOver. Editable and read-only rows used to look the same, and only the tap told them apart.
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
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var explained = false

    var body: some View {
        let od = CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        let openable = !item.masked && item.taskId != nil
        // The rule CalendarView.openItem follows: editable only through the task's home project.
        let readOnly = openable && !(item.canEdit && item.editProjectId == item.project?.id)
        let large = typeSize.isAccessibilitySize
        let hasNotes = trailingNote != nil || item.time != nil || readOnly
        Button {
            if openable || item.masked {
                onOpen(item)
            } else {
                withAnimation(.snappy(duration: 0.2)) { explained.toggle() }
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays,
                               size: CalType.size(compact ? 14 : 16), state: od)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 4) {
                    // At the accessibility text sizes the title has the line to itself and the date,
                    // time and read-only eye go under it: beside them it came down to a word or two.
                    if large {
                        rowTitle(od, large: true)
                        if hasNotes {
                            HStack(alignment: .top, spacing: 8) { rowNotes(readOnly: readOnly) }
                        }
                    } else {
                        HStack(alignment: .top, spacing: 8) {
                            rowTitle(od, large: false)
                            rowNotes(readOnly: readOnly)
                        }
                    }
                    if !openable && explained {
                        Text(closedReason)
                            .font(NXFont.text(CalType.size(11.5))).foregroundStyle(NX.mutedFg)
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
        .accessibilityHint(readOnly ? T("Read only") : (openable ? "" : closedReason))
    }

    /// The title, or "Internal task · <division>" for a masked row. Up to four lines in the People
    /// week and the whole title in the day list at the accessibility sizes; one or two otherwise.
    @ViewBuilder private func rowTitle(_ od: CalOverdue, large: Bool) -> some View {
        if item.masked {
            Label(maskedTitle, systemImage: "lock.fill")
                .font(NXFont.text(CalType.size(13)).italic()).foregroundStyle(NX.mutedFg)
                .lineLimit(large ? 3 : 1)
                .fixedSize(horizontal: false, vertical: large)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            let lines: Int? = large ? (compact ? 4 : nil) : (compact ? 1 : 2)
            Text(UntitledText.task(item.title))
                .font(NXFont.text(CalType.size(compact ? 12.5 : 13), .medium))
                .foregroundStyle(item.done || od == .stale ? NX.mutedFg : NX.foreground)
                .strikethrough(item.done, color: NX.mutedFg)
                .lineLimit(lines)
                .fixedSize(horizontal: false, vertical: large)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The overdue rail's date, the time and the read-only eye: after the title, or under it.
    @ViewBuilder private func rowNotes(readOnly: Bool) -> some View {
        if let note = trailingNote {
            Text(note).font(NXFont.text(CalType.size(11))).foregroundStyle(CalTone.overdue)
        }
        if item.time != nil {
            Text(CalFormat.time(item.time)).font(NXFont.text(CalType.size(11.5), .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
        }
        if readOnly {
            Image(systemName: "eye")
                .font(NXFont.text(CalType.size(11), .semibold))
                .foregroundStyle(NX.mutedFg)
                .padding(.top, 1)
                .accessibilityHidden(true)
        }
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

    /// The overdue words are for the eye: VoiceOver already heard them from the status mark, once.
    @ViewBuilder private func meta(_ od: CalOverdue) -> some View {
        HStack(spacing: 6) {
            if let p = item.project {
                RoundedRectangle(cornerRadius: 2).fill(calProjectColor(p.color)).frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(p.name).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg).lineLimit(1)
                if !item.linkedProjectIds.isEmpty {
                    Text(String(format: T("+%d project"), item.linkedProjectIds.count)).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg)
                }
            }
            CalPriorityChip(priority: item.priority)
            if od == .recent {
                Text(T("Overdue")).font(NXFont.text(CalType.size(11), .semibold)).foregroundStyle(CalTone.overdue)
                    .accessibilityHidden(true)
            }
        }
        if od == .stale {
            Text(String(format: T("Overdue for more than %d days"), windowDays)).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg)
                .accessibilityHidden(true)
        }
        if let parent = item.parent {
            Label(String(format: T("from %@"), parent.title), systemImage: "arrow.turn.down.right")
                .font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg).lineLimit(1)
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
                            CalAvatar(url: people.avatar(id), initial: calInitials(people.name(id)), size: 18)
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                        }
                    }
                    .accessibilityHidden(true)
                    Text(here.map { who($0) }.joined(separator: ", "))
                        .font(NXFont.text(CalType.size(11.5), .semibold)).foregroundStyle(NX.foreground.opacity(0.9)).lineLimit(1)
                }
            }
            if !others.isEmpty {
                Text(here.isEmpty ? othersText : "\(T("with")) \(othersText)")
                    .font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg).lineLimit(2)
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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let also = (ix.person[row.userId]?.homeUnitIds ?? []).filter { $0 != unitId }.compactMap { ix.byId[$0]?.name }
        let name = people.name(row.userId)
        let isMe = row.userId == auth.session?.userId
        let alsoText: String? = also.isEmpty ? nil : String(format: T("also in %@"), also.joined(separator: ", "))
        let outside = also.isEmpty && !people.inChart(row.userId)
        VStack(alignment: .leading, spacing: 2) {
            header(name: name, isMe: isMe, alsoText: alsoText, outside: outside)
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

    /// Face, name, "You" and the count on one line; at the accessibility sizes the name has a line of
    /// its own (up to three), with "You" and the count under it — squeezed beside them it came down to
    /// a few letters.
    @ViewBuilder private func header(name: String, isMe: Bool, alsoText: String?, outside: Bool) -> some View {
        let face = CalAvatar(url: people.avatar(row.userId), initial: calInitials(name), size: 26)
        let title = Text(name).font(NXFont.text(CalType.size(13), .semibold)).foregroundStyle(NX.foreground)
        let number = Text("\(row.items.count)").font(NXFont.text(CalType.size(11.5), .bold)).monospacedDigit()
            .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 8) {
                    face
                    title.lineLimit(3).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 6) {
                    if isMe { CalYouBadge() }
                    number
                }
                placeNote(alsoText: alsoText, outside: outside, lines: 3)
            }
        } else {
            HStack(spacing: 8) {
                face
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        title.lineLimit(1)
                        if isMe { CalYouBadge() }
                    }
                    placeNote(alsoText: alsoText, outside: outside, lines: 1)
                }
                Spacer(minLength: 0)
                number
            }
        }
    }

    /// "also in …", or "not in the chart".
    @ViewBuilder private func placeNote(alsoText: String?, outside: Bool, lines: Int) -> some View {
        if let alsoText {
            Text(alsoText).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg).lineLimit(lines)
        } else if outside {
            Text(T("not in the chart")).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg)
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
    /// The viewer: their own block goes first in each card of the "by person" lens. Without it, the
    /// signed-in user is asked.
    var meId: String? = nil
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
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let tint = calUnitColor(node.unit)
        let count = own ? Set(node.items.map(\.key) + node.people.flatMap { $0.items.map(\.key) }).count : node.count
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                header(count)
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

    /// Mark, name, "You", count, chevron. At the accessibility sizes the name has the first line to
    /// itself (up to three lines) and the rest goes under it: on one line, at AX5, "FINANCE & TECH"
    /// came down to about four letters beside a "You" badge.
    @ViewBuilder private func header(_ count: Int) -> some View {
        let name = Text(node.unit.name.uppercased()).calCaps().foregroundStyle(NX.foreground)
        let number = Text("\(count)").font(NXFont.text(CalType.size(11.5), .bold)).monospacedDigit()
            .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
        let chevron = Image(systemName: "chevron.down").font(NXFont.text(CalType.size(11), .semibold)).foregroundStyle(NX.mutedFg)
            .rotationEffect(.degrees(collapsed ? -90 : 0))
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    CalUnitMark(unit: node.unit, size: 24)
                    name.lineLimit(3).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 8) {
                    if mine { CalYouBadge() }
                    number
                    Spacer(minLength: 4)
                    chevron
                }
            }
        } else {
            HStack(spacing: 10) {
                CalUnitMark(unit: node.unit, size: 24)
                name.lineLimit(1)
                Spacer(minLength: 4)
                if mine { CalYouBadge() }
                number
                chevron
            }
        }
    }
}

/// What a unit holds for the day: its tasks (by division) or its people (by person), then its sub-cards.
struct CalNodeBody: View {
    let node: CalTreeNode
    let includeChildren: Bool
    let ctx: CalRowContext
    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if ctx.lensByPerson {
                ForEach(meFirst(node.people), id: \.userId) { p in
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

    /// The viewer's own block first in the card, everyone else in the Bagan's order. On screen only:
    /// CalendarCore, and the golden files the web and Android share with it, keep the Bagan order.
    private func meFirst(_ rows: [CalPersonRow]) -> [CalPersonRow] {
        guard let me = ctx.meId ?? auth.session?.userId,
              let at = rows.firstIndex(where: { $0.userId == me }), at > 0 else { return rows }
        var out = rows
        out.insert(out.remove(at: at), at: 0)
        return out
    }
}

/// A sub-card inside a section, or a group drawn as a thin ribbon ("CREATIVE · 1") around its cards.
struct CalSubNode: View {
    let node: CalTreeNode
    let ctx: CalRowContext
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if node.unit.isGroup {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(node.unit.name.uppercased()) · \(node.count)").calCaps().foregroundStyle(NX.mutedFg)
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
            // At the accessibility sizes the name wraps (up to three lines) instead of being cut.
            let large = typeSize.isAccessibilitySize
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: large ? VerticalAlignment.top : .center, spacing: 8) {
                    RoundedRectangle(cornerRadius: 1.5).fill(calUnitColor(node.unit)).frame(width: 3, height: 14)
                        .padding(.top, large ? 4 : 0)
                    Text(node.unit.name).font(NXFont.text(CalType.size(12.5), .semibold)).foregroundStyle(NX.foreground.opacity(0.85))
                        .lineLimit(large ? 3 : 1)
                        .fixedSize(horizontal: false, vertical: large)
                    Spacer(minLength: 0)
                    Text("\(node.count)").font(NXFont.text(CalType.size(11), .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
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

/// One row of the week, with an identity that outlives the week: the same person under the same card
/// is the same row next week, so stepping a week updates the cards in place instead of rebuilding
/// every one (and reloading every face).
private struct CalWeekLine: Identifiable {
    let id: String
    let row: CalWeekRow
}

/// One week: a row per person under their Bagan card, a column per day. Phone (and the accessibility
/// text sizes) = list (card › person › up to three tasks with the day in front); iPad/Mac = a table
/// with the names held on the left and the seven days beside them, scrolling sideways only when the
/// window is too narrow for seven readable days. Headings fold away the rows under them.
struct CalPeopleWeek: View {
    let rows: [CalWeekRow]
    let days: [String]
    let today: String
    let now: Date
    let windowDays: Int
    let ix: CalIndex
    let people: CalPeople
    let wide: Bool
    /// The width the table may take; under the name column and seven readable days the days scroll.
    var room: CGFloat = 1024
    let onOpenDay: (String) -> Void
    let onOpen: (CalItem) -> Void
    /// Filters are on: an empty week offers to reset them, as the day panel does.
    var filtered = false
    var onResetFilters: (() -> Void)? = nil
    /// Another week than this one: an empty week offers the way back.
    var onThisWeek: (() -> Void)? = nil
    /// The division the calendar is focused on (nil = all of them): an empty week then says it is that
    /// division's week that is empty, and offers all divisions back.
    var focusName: String? = nil
    var onAllDivisions: (() -> Void)? = nil
    /// Whose tasks are shown. Mine and My division are a view, not a filter: an empty week says whose
    /// week is empty, and offers everyone's.
    var scope: CalScope = .all
    var onShowEveryone: (() -> Void)? = nil
    @State private var expanded: Set<String> = []
    /// Headings folded away, by unit; they stay folded from week to week.
    @State private var folded: Set<String> = []
    @Environment(AuthStore.self) private var auth
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var dayLabelWidth: CGFloat = 52
    /// Wide enough for "Geraldo Valentino" and "Hary Ade Saputra" whole, with a face and a count.
    @ScaledMetric(relativeTo: .body) private var nameColumn: CGFloat = 236
    /// The least a day may be before the days scroll sideways: two words of a title a line.
    @ScaledMetric(relativeTo: .body) private var dayColumn: CGFloat = 118
    @ScaledMetric(relativeTo: .body) private var headerDisc: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var headRow: CGFloat = 44
    @ScaledMetric(relativeTo: .body) private var topRow: CGFloat = 44
    @ScaledMetric(relativeTo: .body) private var divisionRow: CGFloat = 38
    @ScaledMetric(relativeTo: .body) private var subRow: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var groupRow: CGFloat = 30
    @ScaledMetric(relativeTo: .body) private var personRow: CGFloat = 56
    /// A task tile in a day: two lines of 11.5 pt.
    @ScaledMetric(relativeTo: .body) private var chipHeight: CGFloat = 38
    @ScaledMetric(relativeTo: .body) private var moreHeight: CGFloat = 22

    var body: some View {
        // One container whatever is showing, so the week's reset below always runs.
        VStack(alignment: .leading, spacing: 0) {
            if rows.isEmpty {
                emptyWeek
            } else if wide && !typeSize.isAccessibilitySize {
                // The rows have set heights so the names and the days line up; at the accessibility
                // text sizes a name or a title needs more lines than any set height, and the list,
                // which grows with them, is the better read.
                table
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            } else {
                list(lazy: true)
            }
        }
        // The cards unfolded belong to the week they were unfolded in.
        .onChange(of: days) { _, _ in expanded = [] }
    }

    /// `lines` with the rows under a folded heading left out.
    private var visibleLines: [CalWeekLine] {
        let all = lines
        guard !folded.isEmpty else { return all }
        var out: [CalWeekLine] = []
        var hideBelow: Int? = nil
        for line in all {
            let d = Self.depth(line.row)
            if let h = hideBelow {
                if d > h { continue }
                hideBelow = nil
            }
            out.append(line)
            if case let .unit(unit, depth, _) = line.row, folded.contains(unit.id) { hideBelow = depth }
        }
        return out
    }

    private static func depth(_ row: CalWeekRow) -> Int {
        switch row {
        case let .unit(_, depth, _): return depth
        case let .unplaced(depth, _): return depth
        case let .person(_, _, depth, _): return depth
        case let .loose(_, depth, _): return depth
        }
    }

    /// The rows with their identities, the viewer first among the people of each card. On screen only:
    /// CalendarCore keeps the Bagan order the web and Android share.
    private var lines: [CalWeekLine] {
        let me = auth.session?.userId
        var out: [CalWeekLine] = []
        out.reserveCapacity(rows.count)
        var i = 0
        while i < rows.count {
            guard let first = Self.person(rows[i]) else {
                out.append(CalWeekLine(id: Self.key(rows[i]), row: rows[i]))
                i += 1
                continue
            }
            // The people of one card come one after another.
            var run: [CalWeekRow] = []
            while i < rows.count, let p = Self.person(rows[i]), p.unitId == first.unitId {
                run.append(rows[i])
                i += 1
            }
            if let me, let at = run.firstIndex(where: { Self.person($0)?.userId == me }), at > 0 {
                run.insert(run.remove(at: at), at: 0)
            }
            out.append(contentsOf: run.map { CalWeekLine(id: Self.key($0), row: $0) })
        }
        return out
    }

    private static func person(_ row: CalWeekRow) -> (unitId: String?, userId: String)? {
        if case let .person(unitId, userId, _, _) = row { return (unitId, userId) }
        return nil
    }

    /// Unique within a week: a unit once, a person once per card, the card's "without a person" once.
    private static func key(_ row: CalWeekRow) -> String {
        switch row {
        case let .unit(unit, _, _): return "u|\(unit.id)"
        case .unplaced: return "x"
        case let .person(unitId, userId, _, _): return "p|\(unitId ?? "-")|\(userId)"
        case let .loose(unitId, _, _): return "l|\(unitId)"
        }
    }

    /// Why the week is empty, most specific first: the focus on one division, the filters, whose tasks
    /// are shown, then the week itself.
    @ViewBuilder private var emptyWeek: some View {
        if let focusName {
            EmptyState(icon: "scope", title: String(format: T("Nothing in %@ this week"), focusName),
                       tint: CalTone.accentFill,
                       actionTitle: onAllDivisions == nil ? nil : T("All divisions"), actionIcon: nil, action: onAllDivisions,
                       compact: true)
        } else if filtered, let onResetFilters {
            EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nothing matches the filters this week"),
                       subtitle: T("Filters are hiding the rest. Reset them to see everything."),
                       tint: CalTone.accentFill, actionTitle: T("Reset filters"), actionIcon: nil, action: onResetFilters, compact: true)
        } else if scope != .all {
            let mine = scope == .me
            EmptyState(icon: mine ? "person" : "person.2",
                       title: mine ? T("You have nothing due this week") : T("Nothing due in your division this week"),
                       subtitle: T("Pick another week."), tint: CalTone.accentFill,
                       actionTitle: onShowEveryone == nil ? nil : T("Show everyone"), actionIcon: nil, action: onShowEveryone,
                       compact: true)
        } else if !days.contains(today), let onThisWeek {
            EmptyState(icon: "person.2", title: T("Nobody has a task this week"), subtitle: T("Pick another week."),
                       tint: CalTone.accentFill, actionTitle: T("This week"), actionIcon: nil, action: onThisWeek, compact: true)
        } else {
            EmptyState(icon: "person.2", title: T("Nobody has a task this week"), subtitle: T("Pick another week."),
                       tint: CalTone.accentFill, compact: true)
        }
    }

    /// The phone's list builds its cards as they scroll into view (an "Everyone" week is about 46
    /// people under 20 cards); beside the table, where ViewThatFits measures it, it stays a plain stack.
    @ViewBuilder private func list(lazy: Bool) -> some View {
        let shown = visibleLines
        if lazy {
            LazyVStack(alignment: .leading, spacing: 8) { listRows(shown) }
        } else {
            VStack(alignment: .leading, spacing: 8) { listRows(shown) }
        }
    }

    private func listRows(_ shown: [CalWeekLine]) -> some View {
        let large = typeSize.isAccessibilitySize
        return ForEach(shown) { line in
            switch line.row {
            case let .unit(unit, depth, count):
                let isFolded = folded.contains(unit.id)
                Button {
                    withAnimation(.snappy(duration: 0.2)) { toggleFold(unit.id) }
                } label: {
                    if unit.isGroup {
                        HStack(spacing: 6) {
                            Text("\(unit.name.uppercased()) · \(count)").calCaps().foregroundStyle(NX.mutedFg)
                            Spacer(minLength: 0)
                            listChevron(isFolded)
                        }
                        .padding(.leading, CGFloat(depth) * 10 + 4).padding(.trailing, 10)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                    } else {
                        HStack(alignment: large ? VerticalAlignment.top : .center, spacing: 8) {
                            CalUnitMark(unit: unit, size: depth == 0 ? 22 : 20)
                            Group {
                                if depth == 0 {
                                    Text(unit.name).font(NXFont.text(CalType.size(14), .bold))
                                } else {
                                    Text(unit.name.uppercased()).calCaps()
                                }
                            }
                            .foregroundStyle(NX.foreground)
                            .lineLimit(large ? 3 : 1)
                            .fixedSize(horizontal: false, vertical: large)
                            Spacer(minLength: 0)
                            Text("\(count)").font(NXFont.text(CalType.size(11.5), .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                            listChevron(isFolded)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .frame(minHeight: 44)
                        .background(depth == 0 ? NX.muted : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .padding(.leading, CGFloat(depth) * 10)
                        .contentShape(Rectangle())
                    }
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(calJoin(unit.name, CalFormat.tasks(count)))
                .accessibilityValue(isFolded ? T("Collapsed") : T("Expanded"))
                .accessibilityAddTraits(.isHeader)
            case let .unplaced(_, count):
                Text(String(format: T("Not in the chart yet · %d"), count).uppercased()).calCaps().foregroundStyle(NX.mutedFg).padding(.top, 4)
                    .accessibilityAddTraits(.isHeader)
            case let .person(_, userId, depth, perDay):
                personCard(key: line.id, userId: userId, depth: depth, perDay: perDay)
            case let .loose(_, depth, perDay):
                personCard(key: line.id, userId: nil, depth: depth, perDay: perDay)
            }
        }
    }

    private func toggleFold(_ id: String) {
        if folded.contains(id) {
            folded.remove(id)
        } else {
            folded.insert(id)
        }
    }

    private func listChevron(_ isFolded: Bool) -> some View {
        Image(systemName: "chevron.down").font(NXFont.text(CalType.size(11), .semibold)).foregroundStyle(NX.mutedFg)
            .rotationEffect(.degrees(isFolded ? -90 : 0))
            .accessibilityHidden(true)
    }

    private func personCard(key: String, userId: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        let name = userId.map { people.name($0) }
        let isMe = userId != nil && userId == auth.session?.userId
        let entries: [(day: String, item: CalItem)] = perDay.enumerated().flatMap { i, list in list.map { (days[i], $0) } }
        let unfolded = expanded.contains(key)
        let shown = unfolded ? entries : Array(entries.prefix(3))
        return VStack(alignment: .leading, spacing: 4) {
            cardHeader(name: name, userId: userId, isMe: isMe, total: entries.count, perDay: perDay)
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
                        .font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(CalTone.accent)
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

    /// Face, name, "You", the week's strip and the count. At the accessibility sizes the name has a
    /// line of its own (up to three) with "You" and the count under it, and the strip is left out:
    /// VoiceOver already hears the days, and beside it the name came down to four letters.
    @ViewBuilder private func cardHeader(name: String?, userId: String?, isMe: Bool, total: Int, perDay: [[CalItem]]) -> some View {
        let title = Text(name ?? T("Tasks without a person")).font(NXFont.text(CalType.size(13), name == nil ? .regular : .semibold))
            .italic(name == nil).foregroundStyle(name == nil ? NX.mutedFg : NX.foreground)
        let number = Text("\(total)").font(NXFont.text(CalType.size(11.5), .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 8) {
                    if let name, let userId {
                        CalAvatar(url: people.avatar(userId), initial: calInitials(name), size: 24)
                    }
                    title.lineLimit(3).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 6) {
                    if isMe { CalYouBadge() }
                    Spacer(minLength: 0)
                    number
                }
            }
        } else {
            HStack(spacing: 8) {
                if let name, let userId {
                    CalAvatar(url: people.avatar(userId), initial: calInitials(name), size: 24)
                }
                title.lineLimit(1)
                if isMe { CalYouBadge() }
                Spacer(minLength: 0)
                heatStrip(perDay)
                number
            }
        }
    }

    /// The day in front of a task; above it at the accessibility text sizes, where a fixed column
    /// would squeeze the task to a few letters.
    @ViewBuilder private func entryRow(_ day: String, _ item: CalItem) -> some View {
        let label = Text(CalFormat.day(day, "EEEd")).font(NXFont.text(CalType.size(11), .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
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

    // MARK: Table (regular width)

    /// The table's sizes, on the Mac raised as the rest of the Calendar's type is (CalType).
    private var nameWidth: CGFloat { CalType.size(nameColumn) }
    private var dayWidth: CGFloat { CalType.size(dayColumn) }

    /// A row's height, worked out from what it holds, the same on both sides of the table: the names
    /// stay put while the days scroll sideways beside them, so the two halves are two stacks whose rows
    /// must line up without being measured. A person's row is as tall as their busiest day needs (two
    /// tasks, and "+N more" under them), never taller; rows used to be as uneven as their titles.
    private func rowHeight(_ row: CalWeekRow) -> CGFloat {
        switch row {
        case let .unit(unit, depth, _):
            if unit.isGroup { return CalType.size(groupRow) }
            return CalType.size(depth == 0 ? topRow : depth == 1 ? divisionRow : subRow)
        case .unplaced:
            return CalType.size(divisionRow)
        case let .person(_, _, _, perDay), let .loose(_, _, perDay):
            let most = perDay.map(\.count).max() ?? 0
            let chips = CGFloat(min(most, 2))
            var h = 12 + chips * CalType.size(chipHeight) + max(chips - 1, 0) * 4
            if most > 2 { h += CalType.size(moreHeight) + 2 }
            return max(CalType.size(personRow), h)
        }
    }

    /// Names on the left, held in place; the seven days beside them. The days share the width that is
    /// left when it is enough for seven readable columns, and scroll sideways (the names staying) only
    /// when it is not. One direction per scroll: this sideways scroll sits inside the screen's vertical
    /// one, and both halves are plain stacks.
    private var table: some View {
        let shown = visibleLines
        let fits = room >= nameWidth + 1 + 7 * dayWidth
        return HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 0) {
                nameHeader
                ForEach(shown) { line in
                    nameCell(line.row)
                        .frame(height: rowHeight(line.row))
                        .background(rowBand(line.row))
                    hairline
                }
            }
            .frame(width: nameWidth)
            Rectangle().fill(NX.border).frame(width: 1)
            if fits {
                dayGrid(shown, flexible: true)
            } else {
                ScrollView(.horizontal, showsIndicators: true) {
                    dayGrid(shown, flexible: false)
                }
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
    }

    private var hairline: some View {
        Rectangle().fill(CalTone.hairline).frame(height: 1)
    }

    /// The fill behind a heading row, across the names and the days alike: the company strongest, a
    /// division lighter, a sub-division none, a group the Bagan's own ribbon colour.
    private func rowBand(_ row: CalWeekRow) -> Color {
        switch row {
        case let .unit(unit, depth, _):
            if unit.isGroup { return CalTone.group.opacity(0.45) }
            return depth == 0 ? NX.muted.opacity(0.85) : depth == 1 ? NX.muted.opacity(0.45) : Color.clear
        case .unplaced:
            return NX.muted.opacity(0.45)
        default:
            return Color.clear
        }
    }

    private var nameHeader: some View {
        Text(T("Person").uppercased()).calCaps().foregroundStyle(NX.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 14)
            .frame(height: CalType.size(headRow))
            .background(NX.muted.opacity(0.6))
            .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
    }

    @ViewBuilder private func nameCell(_ row: CalWeekRow) -> some View {
        switch row {
        case let .unit(unit, depth, count):
            unitHeading(unit: unit, depth: depth, count: count)
        case let .unplaced(_, count):
            HStack(spacing: 8) {
                Text(T("Not in the chart yet").uppercased()).calCaps().foregroundStyle(NX.mutedFg).lineLimit(1)
                countPill(count)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(calJoin(T("Not in the chart yet"), CalFormat.people(count)))
            .accessibilityAddTraits(.isHeader)
        case let .person(unitId, userId, depth, perDay):
            personName(userId: userId, unitId: unitId, depth: depth, perDay: perDay)
        case let .loose(unitId, depth, perDay):
            personName(userId: nil, unitId: unitId, depth: depth, perDay: perDay)
        }
    }

    private func countPill(_ n: Int) -> some View {
        Text("\(n)").font(NXFont.text(CalType.size(11), .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 7).padding(.vertical, 1)
            .background(NX.card.opacity(0.9), in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border))
    }

    /// Company › division › sub-division, each a step quieter: the company in full type with its mark,
    /// a division in the Calendar's capitals with its mark, a sub-division in plain type behind its
    /// colour, a group as the Bagan's ribbon label. A tap folds the rows under it away.
    private func unitHeading(unit: CalUnit, depth: Int, count: Int) -> some View {
        let isFolded = folded.contains(unit.id)
        let indent = CGFloat(max(min(depth, 3) - 1, 0)) * 12
        return Button {
            withAnimation(.snappy(duration: 0.2)) { toggleFold(unit.id) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.down")
                    .font(NXFont.text(CalType.size(10), .bold)).foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(isFolded ? -90 : 0))
                    .frame(width: CalType.size(12))
                    .accessibilityHidden(true)
                if unit.isGroup {
                    Text(unit.name.uppercased()).calCaps().foregroundStyle(NX.mutedFg).lineLimit(1)
                } else if depth == 0 {
                    CalUnitMark(unit: unit, size: 22)
                    Text(unit.name).font(NXFont.text(CalType.size(14), .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                } else if depth == 1 {
                    CalUnitMark(unit: unit, size: 18)
                    Text(unit.name.uppercased()).calCaps().foregroundStyle(NX.foreground).lineLimit(1)
                } else {
                    RoundedRectangle(cornerRadius: 1.5).fill(calUnitColor(unit)).frame(width: 3, height: CalType.size(14))
                    Text(unit.name).font(NXFont.text(CalType.size(12.5), .semibold)).foregroundStyle(NX.foreground.opacity(0.85)).lineLimit(1)
                }
                countPill(count)
                Spacer(minLength: 0)
            }
            .padding(.leading, 10 + indent).padding(.trailing, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(calJoin(unit.name, CalFormat.tasks(count)))
        .accessibilityValue(isFolded ? T("Collapsed") : T("Expanded"))
        .accessibilityAddTraits(.isHeader)
    }

    /// Face, the whole name (two lines when it needs them), and where the person sits, with the week's
    /// count at the end.
    private func personName(userId: String?, unitId: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        let name = userId.map { people.name($0) }
        let isMe = userId != nil && userId == auth.session?.userId
        let total = perDay.reduce(0) { $0 + $1.count }
        let place: String = unitId.flatMap { ix.byId[$0]?.name } ?? T("not in the chart")
        let indent = CGFloat(max(min(depth, 4) - 1, 0)) * 8
        return HStack(spacing: 10) {
            if let name, let userId {
                CalAvatar(url: people.avatar(userId), initial: calInitials(name), size: CalType.size(28))
            } else {
                Image(systemName: "tray")
                    .font(NXFont.text(CalType.size(12), .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(width: CalType.size(28), height: CalType.size(28))
                    .background(NX.muted, in: Circle())
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(name ?? T("Tasks without a person"))
                    .font(NXFont.text(CalType.size(13), name == nil ? .regular : .semibold))
                    .italic(name == nil)
                    .foregroundStyle(name == nil ? NX.mutedFg : NX.foreground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 5) {
                    if isMe { CalYouBadge() }
                    Text(place).font(NXFont.text(CalType.size(11))).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text("\(total)").font(NXFont.text(CalType.size(11.5), .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
        }
        .padding(.leading, 14 + indent).padding(.trailing, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(weekLabel(name: name, isMe: isMe, total: total, perDay: perDay))
        .accessibilityAddTraits(.isHeader)
    }

    /// The seven days: a heading row, then one row per line of the names beside it, as tall.
    private func dayGrid(_ shown: [CalWeekLine], flexible: Bool) -> some View {
        let names = CalFormat.weekdays()
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    dayHeading(i, name: names[i])
                        .modifier(CalDayColumn(width: flexible ? nil : dayWidth, last: i == 6))
                }
            }
            .frame(height: CalType.size(headRow))
            .background(NX.muted.opacity(0.6))
            .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
            ForEach(shown) { line in
                dayRow(line.row, flexible: flexible)
                    .frame(height: rowHeight(line.row))
                    .background(rowBand(line.row))
                hairline
            }
        }
        .frame(minWidth: flexible ? nil : 7 * dayWidth)
    }

    /// "MON 6": today on the violet disc, its column tinted all the way down, a bar on top.
    private func dayHeading(_ i: Int, name: String) -> some View {
        let day = days[i]
        let isToday = day == today
        return Button { onOpenDay(day) } label: {
            HStack(spacing: 6) {
                Text(name.uppercased()).calCaps()
                    .foregroundStyle(isToday ? CalTone.accent : NX.mutedFg)
                Text("\(Int(day.suffix(2)) ?? 0)")
                    .font(NXFont.text(CalType.size(13), .bold)).monospacedDigit()
                    .foregroundStyle(isToday ? Color.white : NX.foreground)
                    .frame(minWidth: CalType.size(headerDisc), minHeight: CalType.size(headerDisc))
                    .background { if isToday { Circle().fill(CalTone.accentFill) } }
            }
            .lineLimit(1).minimumScaleFactor(0.8)
            .padding(.leading, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(isToday ? CalTone.accent.opacity(0.12) : (i >= 5 ? NX.muted.opacity(0.35) : Color.clear))
            .overlay(alignment: .top) { if isToday { Rectangle().fill(CalTone.accentFill).frame(height: 3) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(calJoin(CalFormat.day(day, "EEEEdMMMM"), isToday ? T("Today") : nil))
        .accessibilityHint(T("Opens this day in the calendar"))
    }

    @ViewBuilder private func dayRow(_ row: CalWeekRow, flexible: Bool) -> some View {
        switch row {
        case .unit, .unplaced:
            // A heading's band runs on across the days, with today's column still showing through.
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Color.clear
                        .background(days[i] == today ? CalTone.accent.opacity(0.07) : Color.clear)
                        .modifier(CalDayColumn(width: flexible ? nil : dayWidth, last: i == 6))
                }
            }
            .accessibilityHidden(true)
        case let .person(_, userId, _, perDay):
            dayCells(who: calJoin(people.name(userId), userId == auth.session?.userId ? T("You") : nil), perDay: perDay, flexible: flexible)
        case let .loose(_, _, perDay):
            dayCells(who: T("Tasks without a person"), perDay: perDay, flexible: flexible)
        }
    }

    private func dayCells(who: String, perDay: [[CalItem]], flexible: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { i in
                tableCell(who: who, day: days[i], items: perDay[i], weekend: i >= 5)
                    .modifier(CalDayColumn(width: flexible ? nil : dayWidth, last: i == 6))
            }
        }
    }

    /// One person's day: up to two tasks, each opening the task, and "+N more" opening the day in the
    /// month with its people. Every task used to be one 11 pt line cut after a few words.
    @ViewBuilder private func tableCell(who: String, day: String, items: [CalItem], weekend: Bool) -> some View {
        let isToday = day == today
        let shown = items.count > 2 ? Array(items.prefix(2)) : items
        VStack(alignment: .leading, spacing: 4) {
            ForEach(shown) { item in chip(item) }
            if items.count > shown.count {
                Button { onOpenDay(day) } label: {
                    Text(String(format: T("+%d more"), items.count - shown.count))
                        .font(NXFont.text(CalType.size(11), .semibold)).foregroundStyle(CalTone.accent)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .frame(maxWidth: .infinity, minHeight: CalType.size(moreHeight), alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(calJoin(CalFormat.day(day, "EEEEdMMMM"), who, CalFormat.tasks(items.count)))
                .accessibilityHint(T("Opens this day in the calendar"))
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(isToday ? CalTone.accent.opacity(0.07) : (weekend ? NX.muted.opacity(0.25) : Color.clear))
    }

    /// A task in a day: its status mark and up to two lines of its title, on a quiet tile; overdue on a
    /// red wash, done struck through without a tile, HIGH / URGENT flagged red.
    private func chip(_ item: CalItem) -> some View {
        let od = CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        let quiet = item.done || item.noStatus
        let urgent = !quiet && (item.priority == "HIGH" || item.priority == "URGENT")
        let fill: Color = od == .recent ? CalTone.overdue.opacity(0.09) : (quiet ? Color.clear : NX.muted.opacity(0.8))
        return Button { onOpen(item) } label: {
            HStack(alignment: .top, spacing: 5) {
                CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays, size: CalType.size(12), state: od)
                    .padding(.top, 1)
                Text(item.masked ? T("Internal task") : UntitledText.task(item.title))
                    .font(NXFont.text(CalType.size(11.5), quiet ? .regular : .medium))
                    .italic(item.masked)
                    .foregroundStyle(quiet || item.masked ? NX.mutedFg : (od == .recent ? CalTone.overdue : NX.foreground))
                    .strikethrough(item.done, color: NX.mutedFg)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if urgent {
                    Image(systemName: "flag.fill").font(NXFont.text(CalType.size(9), .bold)).foregroundStyle(CalTone.overdue)
                        .padding(.top, 2)
                        .accessibilityLabel(item.priority == "URGENT" ? T("Urgent") : T("High"))
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
            .frame(maxWidth: .infinity, minHeight: CalType.size(chipHeight), maxHeight: CalType.size(chipHeight), alignment: .topLeading)
            .background(fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityElement(children: .combine)
        .accessibilityHint(T("Opens the task"))
    }
}

/// A day column of the People table: an equal share of the width, or a fixed width when the days
/// scroll sideways; a hairline after every day but Sunday.
private struct CalDayColumn: ViewModifier {
    let width: CGFloat?
    let last: Bool

    func body(content: Content) -> some View {
        Group {
            if let width {
                content.frame(width: width)
            } else {
                content.frame(maxWidth: .infinity)
            }
        }
        .frame(maxHeight: .infinity)
        .overlay(alignment: .trailing) { if !last { Rectangle().fill(CalTone.hairline).frame(width: 1) } }
    }
}

// MARK: - Filters

/// Every filter of the Calendar; they run on what is loaded and move the dots, counts, legend, day
/// and People view together. The server only decides what may be seen.
///
/// A grouped List like the app's other settings-shaped sheets: the two switches, divisions / people /
/// projects each on a searchable page of their own, and the priorities as checkmark rows. Reset sits
/// in the toolbar, not under 50 rows.
///
/// Whose tasks (Everyone / Mine / My division) is a view, not a filter: the Calendar's header shows
/// it on every screen size, so it is not repeated here unless asked for (`showsScope`), and Reset
/// leaves it as it is.
struct CalFilterSheet: View {
    @Binding var filters: CalFilters
    let ix: CalIndex
    let items: [CalItem]
    let people: CalPeople
    let myHomes: [String]
    /// Also offer Everyone / Mine / My division here, for a screen whose header does not show them.
    var showsScope = false
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

    /// No filter at all, on the scope that is on now.
    private var cleared: CalFilters {
        var f = CalFilters()
        f.scope = filters.scope
        return f
    }

    var body: some View {
        NavigationStack {
            List {
                if showsScope {
                    Section {
                        scopeRow(.all, T("Everyone"))
                        scopeRow(.me, T("Mine"))
                        scopeRow(.division, T("My division"))
                    } header: {
                        Text(T("Show"))
                    } footer: {
                        if myHomes.isEmpty { Text(T("You are not in the chart yet, so \"My division\" is off.")) }
                    }
                }
                Section {
                    Toggle(isOn: $filters.hideDone) { Text(T("Hide done tasks")).font(NXFont.text(CalType.size(15))).foregroundStyle(NX.foreground) }
                        .tint(NX.violetText)
                    Toggle(isOn: $filters.overdueOnly) { Text(T("Only overdue")).font(NXFont.text(CalType.size(15))).foregroundStyle(NX.foreground) }
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
                                    label: Text(priorityLabel(p)).font(NXFont.text(CalType.size(15))))
                    }
                }
            }
            .navigationTitle(T("Filters"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(T("Reset filters"), role: .destructive) { filters = cleared }
                        .disabled(filters == cleared)
                }
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            }
        }
    }

    /// "My division" needs a place in the chart; without one it is shown off, and the footer says why.
    private func scopeRow(_ scope: CalScope, _ title: String) -> some View {
        let unavailable = scope == .division && myHomes.isEmpty
        return CalCheckRow(on: filters.scope == scope, action: { filters.scope = scope },
                           label: Text(title).font(NXFont.text(CalType.size(15))).foregroundStyle(unavailable ? NX.mutedFg : NX.foreground))
            .disabled(unavailable)
    }

    private func linkLabel(_ title: String, _ value: String) -> some View {
        HStack(spacing: 8) {
            Text(title).font(NXFont.text(CalType.size(15))).foregroundStyle(NX.foreground)
            Spacer(minLength: 8)
            Text(value).font(NXFont.text(CalType.size(15))).foregroundStyle(NX.mutedFg).lineLimit(1)
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
                    .font(NXFont.text(CalType.size(15), .semibold))
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
    /// A Bagan group (CREATIVE): the Calendar's uppercase label, as everywhere else.
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
                if let empty { Text(empty).font(NXFont.text(CalType.size(14))).foregroundStyle(NX.mutedFg) }
            } else if shown.isEmpty {
                Text(String(format: T("Nothing matches “%@”."), query)).font(NXFont.text(CalType.size(14))).foregroundStyle(NX.mutedFg)
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
                    CalAvatar(url: url, initial: calInitials(o.name), size: 26)
                case .swatch(let c):
                    RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 12, height: 12)
                }
            }
            .accessibilityHidden(true)
            Group {
                if o.heading {
                    Text(o.name.uppercased()).calCaps().foregroundStyle(NX.mutedFg)
                } else {
                    Text(o.name).font(NXFont.text(CalType.size(15))).foregroundStyle(NX.foreground)
                }
            }
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
// CalTaskReadOnly (CalendarTaskReadOnly.swift) since 13 Oct 2026: it reads the task through
// GET /api/calendar/task?detail=1, because /api/tasks/:id is members-only.
