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

/// The navy of the Bagan (selected / today), light and dark.
enum CalTone {
    static let navy = Color(light: 0x1e3a5f, dark: 0x9fb6d6)
    static let onNavy = Color(light: 0xffffff, dark: 0x0f1b2d)
    static let unknown = Color(light: 0x75839A, dark: 0x94A3B8)
    static let overdue = Color(light: 0xe11d48, dark: 0xfb7185)
    static let group = Color(light: 0xedf2f9, dark: 0x1a2a41)
    static let groupLine = Color(light: 0xc6d4e7, dark: 0x2e4565)
}

func calUnitColor(_ unit: CalUnit?) -> Color {
    guard let unit else { return CalTone.unknown }
    return Color(lightHex: unit.color, darkHex: unit.colorDark)
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

// MARK: - Unit mark, status glyph, priority

/// An IP's logo on a neutral tile, or the unit's initial on its own colour.
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
                CachedImage(url: logoURL) { img in img.resizable().scaledToFit() } placeholder: { initial(tint) }
                    .padding(2)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
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

/// ○ to do, ✓ done, ! overdue (red within the window, grey after it), ◆ project without status.
struct CalStatusGlyph: View {
    let item: CalItem
    let today: String
    let now: Date
    let windowDays: Int
    var size: CGFloat = 16

    var body: some View {
        let od = CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        Group {
            if item.done {
                Image(systemName: "checkmark.circle.fill").resizable().foregroundStyle(NX.success)
            } else if item.noStatus {
                Image(systemName: "diamond.fill").resizable().scaleEffect(0.5).foregroundStyle(NX.mutedFg)
            } else if od == .recent {
                Image(systemName: "exclamationmark.circle.fill").resizable().foregroundStyle(CalTone.overdue)
            } else {
                Circle().strokeBorder(od == .stale ? NX.mutedFg.opacity(0.5) : NX.mutedFg, lineWidth: 2)
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

// MARK: - Month grid

/// Monday first, always six weeks. One dot per unit at the focus level (filled = still something to
/// do, ring = only done / status-less), in Bagan order; a red bar = overdue within the window; days
/// of other months are faded and carry no dots.
struct CalMonthGrid: View {
    let days: [String]
    let month: String
    let cells: [String: CalDayCell]
    let selected: String
    let today: String
    let holidays: [String: String]
    let ix: CalIndex
    let wide: Bool
    let onSelect: (String) -> Void

    var body: some View {
        let names = CalFormat.weekdays()
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(names[i].uppercased())
                        .font(NXFont.text(10.5, .bold)).tracking(0.4)
                        .foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .background(NX.muted.opacity(0.5))
            Divider().overlay(NX.border)
            ForEach(0..<6, id: \.self) { w in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { d in
                        dayCell(days[w * 7 + d], weekend: d >= 5)
                    }
                }
                if w < 5 { Divider().overlay(NX.border.opacity(0.7)) }
            }
        }
        .background(NX.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
    }

    private func dayCell(_ day: String, weekend: Bool) -> some View {
        let inMonth = day.hasPrefix(month)
        let cell = inMonth ? cells[day] : nil
        let isToday = day == today
        let isSel = day == selected
        let holiday = holidays[day]
        let dots = cell?.dots ?? []
        let maxDots = wide ? 4 : 3
        let shown = Array(dots.prefix(maxDots))
        return VStack(spacing: 3) {
            HStack(alignment: .top, spacing: 0) {
                Text("\(Int(day.suffix(2)) ?? 0)")
                    .font(NXFont.text(13, .semibold)).monospacedDigit()
                    .foregroundStyle(isToday ? CalTone.onNavy : (holiday != nil ? CalTone.overdue : NX.foreground))
                    .frame(minWidth: 26, minHeight: 26)
                    .background { if isToday { Circle().fill(CalTone.navy) } }
                if wide {
                    Spacer(minLength: 0)
                    if let cell, cell.count > 0 {
                        Text("\(cell.count)").font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
            if cell?.overdue == true {
                Capsule().fill(CalTone.overdue).frame(width: 14, height: 2)
                    .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
            }
            if wide, let holiday {
                Text(holiday).font(NXFont.text(9.5, .medium)).foregroundStyle(CalTone.overdue).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer(minLength: 0)
            HStack(spacing: 3) {
                ForEach(shown, id: \.unitId) { dot in
                    let tint = calUnitColor(ix.byId[dot.unitId])
                    Circle()
                        .fill(dot.filled ? tint : Color.clear)
                        .overlay(Circle().strokeBorder(tint, lineWidth: 1.5))
                        .frame(width: 6, height: 6)
                }
                if dots.count > shown.count {
                    Text("+\(dots.count - shown.count)").font(NXFont.text(9, .bold)).foregroundStyle(NX.mutedFg)
                }
            }
            .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
            .frame(height: 8)
        }
        .padding(wide ? 7 : 4)
        .frame(maxWidth: .infinity)
        .frame(height: wide ? 84 : 54)
        .background(weekend ? NX.muted.opacity(0.3) : Color.clear)
        .overlay { if isSel { Rectangle().strokeBorder(CalTone.navy, lineWidth: 2) } }
        .opacity(inMonth ? 1 : 0.38)
        .contentShape(Rectangle())
        .onTapGesture { Haptics.tap(); onSelect(day) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cellLabel(day, cell, holiday, isToday))
        .accessibilityAddTraits(isSel ? [.isButton, .isSelected] : [.isButton])
    }

    private func cellLabel(_ day: String, _ cell: CalDayCell?, _ holiday: String?, _ isToday: Bool) -> String {
        var parts = [CalFormat.day(day, "EEEEdMMMM")]
        parts.append(cell.map { $0.count > 0 ? CalFormat.tasks($0.count) : T("No tasks") } ?? T("No tasks"))
        if cell?.overdue == true { parts.append(T("Overdue")) }
        if let holiday { parts.append(holiday) }
        if isToday { parts.append(T("Today")) }
        return parts.joined(separator: ", ")
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
/// "with …". A masked row says "Internal task · <division>" and cannot be opened.
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

    var body: some View {
        let od = CalendarCore.overdueState(item, today: today, now: now, windowDays: windowDays)
        let openable = !item.masked && item.taskId != nil
        Button { onOpen(item) } label: {
            HStack(alignment: .top, spacing: 10) {
                CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays, size: compact ? 14 : 16)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        if item.masked {
                            Label(maskedTitle, systemImage: "lock.fill")
                                .font(NXFont.text(13).italic()).foregroundStyle(NX.mutedFg).lineLimit(1)
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
                    if !compact { meta(od) }
                    if showPeople, !compact, !item.assigneeIds.isEmpty { peopleLine }
                }
            }
            .padding(.horizontal, 10).padding(.vertical, compact ? 6 : 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!openable)
        .opacity(od == .stale ? 0.8 : 1)
    }

    private var maskedTitle: String {
        guard let unitId, let unit = ix.byId[unitId] else { return T("Internal task") }
        let section = ix.byId[unit.sectionId]?.name ?? unit.name
        return String(format: T("Internal task · %@"), section)
    }

    @ViewBuilder private func meta(_ od: CalOverdue) -> some View {
        HStack(spacing: 6) {
            if let p = item.project {
                RoundedRectangle(cornerRadius: 2).fill(Color(hex: p.color)).frame(width: 8, height: 8)
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
        let othersText = others.map { "\(people.name($0)) (\(unitOf($0)))" }.joined(separator: ", ")
        return VStack(alignment: .leading, spacing: 3) {
            if !here.isEmpty {
                HStack(spacing: 6) {
                    HStack(spacing: -6) {
                        ForEach(here.prefix(3), id: \.self) { id in
                            AvatarView(url: people.avatar(id), initial: calInitials(people.name(id)), size: 18)
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                        }
                    }
                    Text(here.map { people.name($0) }.joined(separator: ", "))
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

    var body: some View {
        let also = (ix.person[row.userId]?.homeUnitIds ?? []).filter { $0 != unitId }.compactMap { ix.byId[$0]?.name }
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                AvatarView(url: people.avatar(row.userId), initial: calInitials(people.name(row.userId)), size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(people.name(row.userId)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if !also.isEmpty {
                        Text(String(format: T("also in %@"), also.joined(separator: ", "))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    } else if !people.inChart(row.userId) {
                        Text(T("not in the chart")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
                Spacer(minLength: 0)
                Text("\(row.items.count)").font(NXFont.text(11.5, .bold)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
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
                    if mine {
                        Text(T("You").uppercased()).font(NXFont.text(9.5, .bold))
                            .foregroundStyle(CalTone.onNavy)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(CalTone.navy, in: RoundedRectangle(cornerRadius: 5))
                    }
                    Text("\(count)").font(NXFont.text(11.5, .bold)).monospacedDigit()
                        .padding(.horizontal, 8).padding(.vertical, 2).background(NX.muted, in: Capsule())
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(collapsed ? -90 : 0))
                }
                .padding(.horizontal, 12).padding(.vertical, 11)
                .overlay(alignment: .leading) { Rectangle().fill(tint).frame(width: 3) }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
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
                    .font(NXFont.text(10, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.top, 6)
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
                CalNodeBody(node: node, includeChildren: true, ctx: ctx)
                    .padding(.leading, 6)
            }
        }
    }
}

// MARK: - Week "People"

/// One week: a row per person under their Bagan card, a column per day. Phone = list (card › person ›
/// up to three tasks with the day in front); iPad/Mac = a table that fits the width (no sideways scroll).
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
    @State private var expanded: Set<String> = []

    var body: some View {
        if rows.isEmpty {
            EmptyState(icon: "person.2", title: T("Nobody has a task this week"), subtitle: T("Pick another week, or reset the filters."), compact: true)
        } else if wide {
            table
        } else {
            list
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                switch row {
                case let .unit(unit, depth, count):
                    if unit.isGroup {
                        Text("\(unit.name.uppercased()) · \(count)").font(NXFont.text(10, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg)
                            .padding(.leading, CGFloat(depth) * 10 + 4).padding(.top, 4)
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
                    }
                case let .unplaced(_, count):
                    Text(String(format: T("Not in the chart yet · %d"), count).uppercased()).font(NXFont.text(10, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg).padding(.top, 4)
                case let .person(unitId, userId, depth, perDay):
                    personCard(key: "p|\(unitId ?? "-")|\(userId)", name: people.name(userId), avatar: people.avatar(userId), depth: depth, perDay: perDay)
                case let .loose(unitId, depth, perDay):
                    personCard(key: "l|\(unitId)", name: nil, avatar: nil, depth: depth, perDay: perDay)
                }
            }
        }
    }

    private func personCard(key: String, name: String?, avatar: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        let entries: [(day: String, item: CalItem)] = perDay.enumerated().flatMap { i, list in list.map { (days[i], $0) } }
        let open = expanded.contains(key)
        let shown = open ? entries : Array(entries.prefix(3))
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if let name { AvatarView(url: avatar, initial: calInitials(name), size: 24) }
                Text(name ?? T("Tasks without a person")).font(NXFont.text(13, name == nil ? .regular : .semibold))
                    .italic(name == nil).foregroundStyle(name == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                Spacer(minLength: 0)
                HStack(spacing: 2) {
                    ForEach(0..<7, id: \.self) { i in
                        let n = perDay[i].count
                        RoundedRectangle(cornerRadius: 2)
                            .fill(n == 0 ? NX.muted : CalTone.navy.opacity(n <= 2 ? 0.3 : n <= 4 ? 0.6 : 1))
                            .frame(width: 8, height: 8)
                    }
                }
                .accessibilityHidden(true)
                Text("\(entries.count)").font(NXFont.text(11.5, .bold)).monospacedDigit().foregroundStyle(NX.mutedFg)
            }
            ForEach(Array(shown.enumerated()), id: \.offset) { _, e in
                HStack(spacing: 6) {
                    Text(CalFormat.day(e.day, "EEEd")).font(NXFont.text(11, .semibold)).monospacedDigit().foregroundStyle(NX.mutedFg)
                        .frame(width: 52, alignment: .leading)
                    CalItemRow(item: e.item, unitId: nil, ix: ix, people: people, today: today, now: now, windowDays: windowDays, showPeople: false, compact: true, onOpen: onOpen)
                }
            }
            if entries.count > 3 {
                Button(open ? T("Show less") : String(format: T("+%d more"), entries.count - 3)) {
                    if open { expanded.remove(key) } else { expanded.insert(key) }
                }
                .font(NXFont.text(12, .semibold)).foregroundStyle(CalTone.navy)
            }
        }
        .padding(10)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .padding(.leading, CGFloat(depth) * 10)
    }

    private var table: some View {
        let names = CalFormat.weekdays()
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text(T("Person").uppercased()).font(NXFont.text(10.5, .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 180, alignment: .leading).padding(.leading, 12)
                ForEach(0..<7, id: \.self) { i in
                    Button { onOpenDay(days[i]) } label: {
                        Text("\(names[i].uppercased()) \(Int(days[i].suffix(2)) ?? 0)")
                            .font(NXFont.text(10.5, .bold)).foregroundStyle(days[i] == today ? CalTone.navy : NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 6)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 8)
            .background(NX.muted.opacity(0.6))
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                tableRow(row)
                Divider().overlay(NX.border.opacity(0.6))
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
                Text(unit.name.uppercased()).font(NXFont.text(unit.isGroup ? 10 : 11.5, .bold)).tracking(0.5)
                    .foregroundStyle(unit.isGroup ? NX.mutedFg : NX.foreground)
                Text("\(count)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
            }
            .padding(.leading, 12 + CGFloat(depth) * 14).padding(.vertical, 6)
            .background(unit.isGroup ? CalTone.group.opacity(0.4) : NX.muted.opacity(0.3))
        case let .unplaced(_, count):
            Text(String(format: T("Not in the chart yet · %d"), count).uppercased()).font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 12).padding(.vertical, 6)
        case let .person(_, userId, depth, perDay):
            dayCells(name: people.name(userId), avatar: people.avatar(userId), depth: depth, perDay: perDay)
        case let .loose(_, depth, perDay):
            dayCells(name: nil, avatar: nil, depth: depth, perDay: perDay)
        }
    }

    private func dayCells(name: String?, avatar: String?, depth: Int, perDay: [[CalItem]]) -> some View {
        HStack(alignment: .top, spacing: 0) {
            HStack(spacing: 6) {
                if let name { AvatarView(url: avatar, initial: calInitials(name), size: 20) }
                Text(name ?? T("Tasks without a person")).font(NXFont.text(12, name == nil ? .regular : .semibold))
                    .italic(name == nil).foregroundStyle(name == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
            }
            .frame(width: 180 - CGFloat(depth) * 14, alignment: .leading)
            .padding(.leading, 12 + CGFloat(depth) * 14).padding(.vertical, 6)
            ForEach(0..<7, id: \.self) { i in
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(perDay[i].prefix(2)) { item in
                        Button { onOpen(item) } label: {
                            HStack(spacing: 4) {
                                CalStatusGlyph(item: item, today: today, now: now, windowDays: windowDays, size: 11)
                                Text(item.masked ? T("Internal task") : (item.title ?? ""))
                                    .font(NXFont.text(11)).lineLimit(1)
                                    .foregroundStyle(item.masked || item.done ? NX.mutedFg : NX.foreground)
                                    .strikethrough(item.done, color: NX.mutedFg)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(item.masked || item.taskId == nil)
                    }
                    if perDay[i].count > 2 {
                        Button(String(format: T("+%d more"), perDay[i].count - 2)) { onOpenDay(days[i]) }
                            .font(NXFont.text(11, .semibold)).foregroundStyle(CalTone.navy)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
                .background(days[i] == today ? CalTone.navy.opacity(0.05) : Color.clear)
                .overlay(alignment: .leading) { Rectangle().fill(NX.border.opacity(0.6)).frame(width: 0.5) }
            }
        }
    }
}

// MARK: - Filters

/// Every filter of the Calendar; they run on what is loaded and move the dots, counts, legend, day
/// and People view together. The server only decides what may be seen.
struct CalFilterSheet: View {
    @Binding var filters: CalFilters
    let ix: CalIndex
    let items: [CalItem]
    let people: CalPeople
    let myHomes: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var personQuery = ""
    @State private var projectQuery = ""

    private var personIds: [String] {
        Array(Set(items.flatMap(\.assigneeIds))).sorted { CalendarCore.nameOrder(people.name($0), people.name($1)) }
    }
    private var projects: [CalProjectRef] {
        var seen: [String: CalProjectRef] = [:]
        for i in items { if let p = i.project { seen[p.id] = p } }
        return seen.values.sorted { CalendarCore.nameOrder($0.name, $1.name) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(T("Show"))
                        NXSegmented(selection: Binding(get: { filters.scope }, set: { s in
                            if s == .division && myHomes.isEmpty { return }
                            filters.scope = s
                        }), options: [CalScope.all, .me, .division], label: { s in
                            s == .all ? T("Everyone") : s == .me ? T("Mine") : T("My division")
                        })
                        if myHomes.isEmpty {
                            Text(T("You are not in the chart yet, so \"My division\" is off.")).font(NXFont.text(11.5)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    group(T("Divisions"), count: filters.units.count) {
                        ForEach(ix.units) { u in
                            checkRow(on: filters.units.contains(u.id), indent: u.depth) {
                                toggle(&filters.units, u.id)
                            } label: {
                                Circle().fill(calUnitColor(u)).frame(width: 8, height: 8)
                                Text(u.isGroup ? u.name.uppercased() : u.name)
                                    .font(NXFont.text(u.isGroup ? 11 : 13, u.isGroup ? .bold : .medium))
                                    .foregroundStyle(u.isGroup ? NX.mutedFg : NX.foreground).lineLimit(1)
                            }
                        }
                    }
                    group(T("People"), count: filters.people.count) {
                        TextField(T("Search people…"), text: $personQuery).font(NXFont.text(13))
                            .padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10))
                        ForEach(personIds.filter { personQuery.isEmpty || people.name($0).localizedCaseInsensitiveContains(personQuery) }, id: \.self) { id in
                            checkRow(on: filters.people.contains(id), indent: 0) { toggle(&filters.people, id) } label: {
                                AvatarView(url: people.avatar(id), initial: calInitials(people.name(id)), size: 20)
                                Text(people.name(id)).font(NXFont.text(13, .medium)).lineLimit(1)
                            }
                        }
                        if personIds.isEmpty { Text(T("Nobody has a task this month.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }
                    group(T("Projects"), count: filters.projects.count) {
                        TextField(T("Search projects…"), text: $projectQuery).font(NXFont.text(13))
                            .padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10))
                        ForEach(projects.filter { projectQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(projectQuery) }, id: \.id) { p in
                            checkRow(on: filters.projects.contains(p.id), indent: 0) { toggle(&filters.projects, p.id) } label: {
                                RoundedRectangle(cornerRadius: 2).fill(Color(hex: p.color)).frame(width: 10, height: 10)
                                Text(p.name).font(NXFont.text(13, .medium)).lineLimit(1)
                            }
                        }
                        if projects.isEmpty { Text(T("No project has a task this month.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }
                    group(T("Priority"), count: filters.priorities.count) {
                        HStack(spacing: 6) {
                            ForEach(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"], id: \.self) { p in
                                let on = filters.priorities.contains(p)
                                Button(priorityLabel(p)) { toggle(&filters.priorities, p) }
                                    .font(NXFont.text(12, .semibold))
                                    .foregroundStyle(on ? CalTone.onNavy : NX.mutedFg)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(on ? CalTone.navy : NX.muted, in: Capsule())
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    VStack(spacing: 10) {
                        Toggle(T("Hide done tasks"), isOn: $filters.hideDone)
                        Toggle(T("Only overdue"), isOn: $filters.overdueOnly)
                    }
                    .font(NXFont.text(13.5, .medium))
                    .tint(CalTone.navy)
                    .nexusCard(padding: 14, radius: 16)
                    Button(T("Reset filters")) { filters = CalFilters() }
                        .font(NXFont.text(14, .semibold)).frame(maxWidth: .infinity)
                        .padding(.vertical, 10).background(NX.muted, in: RoundedRectangle(cornerRadius: 12))
                        .buttonStyle(.plain)
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Filters"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
        }
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

    private func group<C: View>(_ title: String, count: Int, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                SectionLabel(title)
                if count > 0 {
                    Text("\(count)").font(NXFont.text(10, .bold)).foregroundStyle(CalTone.onNavy)
                        .padding(.horizontal, 6).background(CalTone.navy, in: Capsule())
                }
            }
            VStack(alignment: .leading, spacing: 2) { content() }
                .nexusCard(padding: 10, radius: 16)
        }
    }

    private func checkRow<L: View>(on: Bool, indent: Int, action: @escaping () -> Void, @ViewBuilder label: () -> L) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .foregroundStyle(on ? CalTone.navy : NX.mutedFg)
                label()
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .padding(.leading, CGFloat(indent) * 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
    @State private var task: TaskDetail?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label(projectName != nil && notMember ? String(format: T("Read only · you are not a member of %@"), projectName ?? "") : T("Read only"), systemImage: "eye")
                        .font(NXFont.text(12.5)).foregroundStyle(Color(light: 0x92400e, dark: 0xfcd34d))
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(light: 0xfffbeb, dark: 0x3a2a0a), in: RoundedRectangle(cornerRadius: 12))
                    if masked {
                        EmptyState(icon: "lock", title: T("Internal task"), subtitle: T("This is an internal task of a private project. Only its members can open it."), compact: true)
                    } else if let task {
                        content(task)
                    } else if failed {
                        EmptyState(icon: "exclamationmark.triangle", title: T("This task could not be loaded."), compact: true)
                    } else {
                        SkeletonList(count: 3)
                    }
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Task"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
        }
        .task {
            guard !masked, task == nil else { return }
            do { task = try await APIClient.shared.taskDetail(taskId) } catch { failed = true }
        }
    }

    @ViewBuilder private func content(_ t: TaskDetail) -> some View {
        if let parent = t.parent {
            Label(String(format: T("from %@"), parent.title ?? ""), systemImage: "arrow.turn.down.right")
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        Text(t.title).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
        VStack(alignment: .leading, spacing: 8) {
            field(T("Status"), statusLabel(t.status))
            field(T("Due"), dueLabel(t.dueDate))
            field(T("Priority"), priorityLabel(t.priority))
            if let projectName { field(T("Project"), projectName) }
            HStack(alignment: .top, spacing: 10) {
                Text(T("People")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).frame(width: 90, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    let users = (t.assignees ?? []).compactMap(\.user)
                    if users.isEmpty { Text(T("Nobody yet")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
                    ForEach(Array(users.enumerated()), id: \.offset) { _, u in
                        HStack(spacing: 6) {
                            AvatarView(url: u.avatar, initial: calInitials(u.name ?? "?"), size: 20)
                            Text(u.name ?? "?").font(NXFont.text(13))
                        }
                    }
                }
            }
        }
        .nexusCard(padding: 14, radius: 16)
        let description = blockText(t.description)
        if !description.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Description"))
                Text(description).font(NXFont.text(13.5)).foregroundStyle(NX.foreground).frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard(padding: 14, radius: 16)
            }
        }
        if let subs = t.subtasks, !subs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Subtasks"))
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(subs) { s in
                        HStack(spacing: 8) {
                            Image(systemName: s.isDone ? "checkmark.circle.fill" : "circle").foregroundStyle(s.isDone ? NX.success : NX.mutedFg)
                            Text(s.title ?? "").font(NXFont.text(13.5)).strikethrough(s.isDone, color: NX.mutedFg)
                                .foregroundStyle(s.isDone ? NX.mutedFg : NX.foreground)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
        if let comments = t.comments, !comments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Comments"))
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(comments) { c in
                        HStack(alignment: .top, spacing: 8) {
                            AvatarView(url: c.user?.avatar, initial: calInitials(c.user?.name ?? "?"), size: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.user?.name ?? "?").font(NXFont.text(12, .semibold))
                                Text(blockText(c.content)).font(NXFont.text(13.5)).foregroundStyle(NX.foreground)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .nexusCard(padding: 14, radius: 16)
            }
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).frame(width: 90, alignment: .leading)
            Text(value).font(NXFont.text(13)).foregroundStyle(NX.foreground)
            Spacer(minLength: 0)
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
