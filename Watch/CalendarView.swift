import SwiftUI

// The watch is always dark, so every colour here is the Calendar's dark one: a unit's `colorDark`,
// and the web's dark tokens for the status glyphs (components/calendar/bits.tsx). Today's violet and
// overdue's red are the shared palette's (GlanceColor), so the wrist names today in the app's colour.
private let wcalAccent = wcalColor(hex: GlanceColor.violetText.dark)
private let wcalNeutral = wcalColor(hex: "#94A3B8")
private let wcalOpen = wcalColor(hex: "#9FB0C8")
private let wcalStale = wcalColor(hex: "#5D6878")
private let wcalGreen = wcalColor(hex: "#10B981")
private let wcalRed = wcalColor(hex: GlanceColor.red.dark)

/// "#rrggbb" (also "#rgb" and "#rrggbbaa", alpha ignored) as the Calendar API sends unit colours.
/// The phone's version lives in Theme.swift, which the watch does not compile (UIKit appearance).
private func wcalColor(hex raw: String) -> Color {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    if s.count == 8 { s = String(s.prefix(6)) }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return .gray }
    return Color(red: Double((v >> 16) & 0xFF) / 255,
                 green: Double((v >> 8) & 0xFF) / 255,
                 blue: Double(v & 0xFF) / 255)
}

/// A unit's colour: its section's (the card right under the top, which for a top-level card is the
/// card itself). A group is the exception — the server makes the TOP its section, so it keeps its
/// own colour, which is its first card's. "other" (a task placed nowhere) is neutral.
private func wcalUnitColor(_ unitId: String, _ ix: CalIndex) -> Color {
    guard let unit = ix.byId[unitId] else { return wcalNeutral }
    let section = unit.isGroup ? unit : (ix.byId[unit.sectionId] ?? unit)
    return wcalColor(hex: section.colorDark)
}

/// A WIB day ("YYYY-MM-DD") in the phone's language: "Mon 6" / "Sen 6". Formatted in UTC because
/// `CalDays.date` is that day's UTC midnight, so the day can never shift through a time zone.
private func wcalDayLabel(_ day: String, format: String) -> String {
    let locale = WatchLang.locale
    let key = locale.identifier + "|" + format
    if let f = wcalFormatters[key] { return f.string(from: CalDays.date(day)) }
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = locale
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = format
    wcalFormatters[key] = f
    return f.string(from: CalDays.date(day))
}

/// The formatters `wcalDayLabel` made, one per language and format: every row used to set one up
/// (impeccable audit, 6 Oct 2026). Read and written from the views' main thread only.
private var wcalFormatters: [String: DateFormatter] = [:]

/// "5 tasks" / "5 tugas", for VoiceOver.
private func wcalTaskCount(_ n: Int) -> String {
    n == 1 ? wt("1 task", "1 tugas") : wt("\(n) tasks", "\(n) tugas")
}

/// "19.00" in Indonesian, "19:00" in English (the server sends "HH:MM", WIB).
private func wcalTime(_ time: String) -> String {
    WatchLang.isIndonesian ? time.replacingOccurrences(of: ":", with: ".") : time
}

/// The Calendar's next seven days, one row per day; a tap opens that day by division.
///
/// Read-only, and no task opens from here in this version. Where a task sits, what counts as
/// overdue and the order all come from CalendarCore — the same file the phone and the golden test
/// use — so the wrist cannot drift from the web.
struct CalendarView: View {
    @Environment(WatchAuth.self) private var auth

    @State private var ix: CalIndex?
    @State private var me: CalMe?
    @State private var items: [CalItem] = []
    @State private var windowDays = 14
    /// The first of the seven days: today in WIB when the week was loaded.
    @State private var startDay = AttendanceSnapshot.currentDateKey()
    /// "none" (not a company member) or "off" (outside the rollout); nil when the Calendar is open.
    @State private var blocked: String?
    @State private var loading = true
    @State private var error: String?
    @State private var scope = CalendarView.savedScope()
    /// Follows the phone's language, so a page that is open re-renders when it changes — `wt()`
    /// reads the defaults directly and SwiftUI would not otherwise know.
    @State private var indonesian = WatchLang.isIndonesian

    private static let scopeKey = "nexus.watch.calendar.scope"

    private var days: [String] { (0..<7).map { CalDays.addDays(startDay, $0) } }
    private var myHomes: [String] { me?.homeUnitIds ?? [] }
    /// "My division" needs a card in the Bagan; without one it reads as Everyone, as on the web.
    private var effectiveScope: CalScope { scope == .division && myHomes.isEmpty ? .all : scope }

    var body: some View {
        let _ = indonesian
        NavigationStack {
            List {
                content
            }
            .navigationTitle(wt("Calendar", "Kalender"))
            .toolbar {
                // watchOS has no Menu, so one button walks through the three scopes.
                ToolbarItem(placement: .topBarTrailing) {
                    if ix != nil && blocked == nil {
                        Button { cycleScope() } label: {
                            Image(systemName: scopeIcon(effectiveScope))
                        }
                        .accessibilityLabel(wt("Scope", "Cakupan"))
                        .accessibilityValue(scopeLabel(effectiveScope))
                        .accessibilityHint(wt("Switches between Mine, My division and Everyone",
                                              "Beralih antara Saya, Divisi saya, dan Semua orang"))
                    }
                }
            }
        }
        .task { await load() }
        .refreshable { await load(pulled: true) }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
            let now = WatchLang.isIndonesian
            if now != indonesian { indonesian = now }
            // A complication's link (`nexus://calendar?scope=me`) saves its scope; follow it.
            let saved = Self.savedScope()
            if saved != scope { scope = saved }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let blocked {
            Text(blocked == "none"
                 ? wt("This calendar is for members of the company.", "Kalender ini khusus anggota perusahaan.")
                 : wt("The Calendar is on its way.", "Kalender segera hadir."))
                .font(.caption2)
                .foregroundStyle(.secondary)
        } else if let ix {
            // A failed refresh keeps the week it already has and says so above it.
            if let error {
                Text(error).font(.caption2).foregroundStyle(.secondary)
            }
            week(ix)
        } else if loading {
            ProgressView().frame(maxWidth: .infinity)
        } else {
            Text(error ?? wt("Couldn't load the calendar.", "Gagal memuat kalender."))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func week(_ ix: CalIndex) -> some View {
        let now = Date()
        let context = CalFilterContext(ix: ix, meId: me?.userId, myHomes: myHomes,
                                       today: startDay, now: now, windowDays: windowDays)
        let shown = CalendarCore.filterItems(items, CalFilters(scope: effectiveScope), context)
        let byDay = CalendarCore.byDay(shown)
        return Section {
            if shown.isEmpty {
                Text(wt("Nothing due in the next 7 days.", "Tidak ada tugas bertenggat dalam 7 hari ke depan."))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(days, id: \.self) { day in
                    dayRow(day, items: byDay[day] ?? [], ix: ix, now: now)
                }
            }
        } header: {
            Text(scopeLabel(effectiveScope)).textCase(nil)
        }
    }

    @ViewBuilder
    private func dayRow(_ day: String, items: [CalItem], ix: CalIndex, now: Date) -> some View {
        let cell = CalendarCore.dayCell(day, items, ix, focus: ix.top?.id ?? "",
                                        today: startDay, now: now, windowDays: windowDays)
        if items.isEmpty {
            WCalDayRow(day: day, isToday: day == startDay, cell: cell, ix: ix, indonesian: indonesian)
        } else {
            NavigationLink {
                WCalDayView(day: day, items: items, ix: ix, today: startDay,
                            windowDays: windowDays, indonesian: indonesian)
            } label: {
                WCalDayRow(day: day, isToday: day == startDay, cell: cell, ix: ix, indonesian: indonesian)
            }
        }
    }

    /// `pulled`: a pull to refresh, which also refreshes the complications past their throttle.
    private func load(pulled: Bool = false) async {
        guard let session = auth.session else { return }
        error = nil
        let from = AttendanceSnapshot.currentDateKey()
        let to = CalDays.addDays(from, 6)
        do {
            async let structureCall = WatchAPI.calendarStructure(session)
            async let weekCall = WatchAPI.calendarItems(session, from: from, to: to)
            let (structure, response) = try await (structureCall, weekCall)
            // Both endpoints answer 200 with the same verdict; either one saying no is enough.
            if structure.access == "none" || response.access == "none" {
                blocked = "none"
            } else if structure.access == "off" || response.access == "off" {
                blocked = "off"
            } else {
                blocked = nil
            }
            startDay = from
            me = structure.me
            ix = blocked == nil ? CalIndex(units: structure.units, people: structure.people) : nil
            items = blocked == nil ? response.items : []
            windowDays = response.rules?.overdueWindowDays ?? 14
            // The week just loaded, so the server is reachable: let the complications catch up too.
            // Not awaited — the list must not wait on three more requests.
            Task { @MainActor in await WatchCalendarGlance.refresh(force: pulled) }
        } catch {
            self.error = message(for: error)
        }
        loading = false
    }

    private func message(for error: Error) -> String {
        switch error as? WatchAPI.Failure {
        case .offline?: return wt("No connection", "Tidak ada koneksi")
        case .unauthorized?: return wt("Sign in on your iPhone", "Masuk di iPhone kamu")
        // Anything else is a reply that did not decode or a server error; WatchAPI's text for those
        // is English-only, so the Calendar says it in the wearer's language instead.
        default: return wt("Couldn't load the calendar.", "Gagal memuat kalender.")
        }
    }

    // MARK: - Scope

    private static func savedScope() -> CalScope {
        CalScope(rawValue: UserDefaults.standard.string(forKey: scopeKey) ?? "") ?? .all
    }

    /// A calendar complication's link names the scope it shows (`&scope=me|division|all`). Saved as
    /// this page's scope, so the tap opens on the tasks the complication drew, not on whatever the
    /// watch app last showed. Anything else is ignored.
    static func adoptScope(from url: URL) {
        let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "scope" }?.value
        guard let scope = value.flatMap({ CalScope(rawValue: $0.lowercased()) }) else { return }
        UserDefaults.standard.set(scope.rawValue, forKey: scopeKey)
    }

    /// Mine → My division → Everyone → Mine. My division is skipped without a card in the Bagan.
    private func cycleScope() {
        let next: CalScope
        switch effectiveScope {
        case .me: next = myHomes.isEmpty ? .all : .division
        case .division: next = .all
        case .all: next = .me
        }
        scope = next
        UserDefaults.standard.set(next.rawValue, forKey: Self.scopeKey)
    }

    private func scopeLabel(_ s: CalScope) -> String {
        switch s {
        case .me: return wt("Mine", "Saya")
        case .division: return wt("My division", "Divisi saya")
        case .all: return wt("Everyone", "Semua orang")
        }
    }

    private func scopeIcon(_ s: CalScope) -> String {
        switch s {
        case .me: return "person"
        case .division: return "person.2"
        case .all: return "person.3"
        }
    }
}

// MARK: - A day in the week

/// One day: weekday and date, up to three division dots, "+N" for the rest, a red mark when a task
/// due that day is overdue, and the number of tasks — unique, so a task under two divisions counts once.
private struct WCalDayRow: View {
    let day: String
    let isToday: Bool
    let cell: CalDayCell
    let ix: CalIndex
    /// Not drawn: a change re-renders the row in the phone's new language.
    let indonesian: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text(wcalDayLabel(day, format: "EEE d"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(isToday ? wcalAccent : (cell.count == 0 ? Color.secondary : Color.primary))
                .lineLimit(1)
            HStack(spacing: 3) {
                ForEach(Array(cell.dots.prefix(3)), id: \.unitId) { dot in
                    WCalDotMark(color: wcalUnitColor(dot.unitId, ix), filled: dot.filled, size: 8)
                }
                if cell.dots.count > 3 {
                    Text(verbatim: "+\(cell.dots.count - 3)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            if cell.overdue {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(wcalRed)
            }
            Text(verbatim: "\(cell.count)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(cell.count == 0 ? Color.secondary : Color.primary)
        }
        .padding(.vertical, 2)
        // "Mon 6, 5 tasks, overdue" rather than "Mon 6, +2, Overdue, 5".
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private var spoken: String {
        var parts = [wcalDayLabel(day, format: "EEEE d MMMM")]
        if isToday { parts.insert(wt("Today", "Hari ini"), at: 0) }
        parts.append(wcalTaskCount(cell.count))
        if cell.overdue { parts.append(wt("overdue", "lewat tenggat")) }
        return parts.joined(separator: ", ")
    }
}

/// Filled = something still to do; a tick = only done or status-less tasks (`CalDot.filled`).
private struct WCalDotMark: View {
    let color: Color
    let filled: Bool
    let size: CGFloat

    var body: some View {
        ZStack {
            if filled {
                Circle().fill(color)
            } else {
                Image(systemName: "checkmark").font(.system(size: size, weight: .black)).foregroundStyle(color)
            }
        }
        .frame(width: size + 1, height: size + 1)
    }
}

// MARK: - One day, by division

/// One day, one section per top-level division of the Bagan, with the tasks placed on the top card
/// itself first. A task with PICs in two divisions shows under both, and every header counts unique
/// tasks. Rows do not open: there is no task detail on the watch yet, and a masked row never opens.
private struct WCalDayView: View {
    let day: String
    let items: [CalItem]
    let ix: CalIndex
    let today: String
    let windowDays: Int
    /// Not drawn: a change re-renders the page in the phone's new language.
    let indonesian: Bool

    var body: some View {
        let now = Date()
        List {
            ForEach(WCalSection.build(items, ix, today: today, now: now, windowDays: windowDays)) { section in
                Section {
                    ForEach(section.rows) { row in
                        WCalTaskRow(row: row, state: CalendarCore.overdueState(row.item, today: today, now: now, windowDays: windowDays), indonesian: indonesian)
                    }
                } header: {
                    WCalSectionHeader(section: section, ix: ix, indonesian: indonesian)
                }
            }
        }
        .navigationTitle(wcalDayLabel(day, format: "EEE d MMM"))
    }
}

private struct WCalRow: Identifiable {
    let item: CalItem
    /// What a masked row names: the section of the card it is shown under, as on the web.
    let division: String?
    var id: String { item.key }
}

private struct WCalSection: Identifiable {
    let id: String
    /// nil = tasks the chart has no place for ("Other").
    let unit: CalUnit?
    let rows: [WCalRow]
    var count: Int { rows.count }

    static func build(_ items: [CalItem], _ ix: CalIndex, today: String, now: Date, windowDays: Int) -> [WCalSection] {
        let cmp = CalendarCore.compareInDay(today: today, now: now, windowDays: windowDays)
        func division(_ item: CalItem, in units: Set<String>) -> String? {
            guard let unitId = item.placements.first(where: { units.contains($0.unitId) })?.unitId else { return nil }
            return ix.byId[ix.byId[unitId]?.sectionId ?? ""]?.name ?? ix.byId[unitId]?.name
        }
        // A division's tasks are those of its whole subtree, each once.
        func collect(_ node: CalTreeNode, _ seen: inout Set<String>, _ out: inout [CalItem]) {
            for item in node.items where !seen.contains(item.key) {
                seen.insert(item.key)
                out.append(item)
            }
            for child in node.children { collect(child, &seen, &out) }
        }

        var sections: [WCalSection] = []
        var placed: Set<String> = []
        if let top = ix.top,
           let root = CalendarCore.dayTree(items, ix, focus: top.id, today: today, now: now, windowDays: windowDays).root {
            if !root.items.isEmpty {
                let here: Set<String> = [root.unit.id]
                sections.append(WCalSection(id: root.unit.id, unit: root.unit,
                                            rows: root.items.map { WCalRow(item: $0, division: division($0, in: here)) }))
                for item in root.items { placed.insert(item.key) }
            }
            for child in root.children {
                var seen: Set<String> = []
                var list: [CalItem] = []
                collect(child, &seen, &list)
                placed.formUnion(seen)
                let subtree = ix.subtree([child.unit.id])
                sections.append(WCalSection(id: child.unit.id, unit: child.unit,
                                            rows: list.sorted(by: cmp).map { WCalRow(item: $0, division: division($0, in: subtree)) }))
            }
        }
        // Whatever the tree had no place for (no placement at all, or a card outside the top),
        // so the day never shows fewer tasks than the row that opened it.
        let rest = items.filter { !placed.contains($0.key) }.sorted(by: cmp)
        if !rest.isEmpty {
            sections.append(WCalSection(id: "other", unit: nil, rows: rest.map { WCalRow(item: $0, division: nil) }))
        }
        return sections
    }
}

private struct WCalSectionHeader: View {
    let section: WCalSection
    let ix: CalIndex
    /// Not drawn: a change re-renders the header in the phone's new language.
    let indonesian: Bool

    var body: some View {
        HStack(spacing: 5) {
            WCalDotMark(color: section.unit.map { wcalUnitColor($0.id, ix) } ?? wcalNeutral, filled: true, size: 7)
            Text(section.unit?.name ?? wt("No division", "Tanpa divisi"))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(verbatim: "\(section.count)")
                .monospacedDigit()
        }
        .textCase(nil)
    }
}

/// ○ to do, ✓ done, ! overdue within the window (red), ○ grey once older, ◆ a project without status.
private struct WCalTaskRow: View {
    let row: WCalRow
    let state: CalOverdue
    /// Not drawn: a change re-renders the row in the phone's new language.
    let indonesian: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            glyph
                .frame(width: 14, height: 14)
                .padding(.top, 1)
            title
                .frame(maxWidth: .infinity, alignment: .leading)
            if let time = row.item.time {
                Text(wcalTime(time))
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var title: some View {
        if row.item.masked {
            // A private project the wearer is not in: no title, and it never opens.
            HStack(spacing: 3) {
                Image(systemName: "lock.fill").font(.system(size: 9))
                Text(row.division.map { wt("Internal task · \($0)", "Tugas internal · \($0)") }
                     ?? wt("Internal task", "Tugas internal"))
                    .italic()
                    .lineLimit(2)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        } else {
            Text(row.item.title ?? "")
                .strikethrough(row.item.done)
                .font(.caption2)
                .foregroundStyle(row.item.done || state == .stale ? Color.secondary : Color.primary)
                .lineLimit(2)
        }
    }

    @ViewBuilder
    private var glyph: some View {
        if row.item.done {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(wcalGreen)
                .accessibilityLabel(wt("Done", "Selesai"))
        } else if row.item.noStatus {
            Image(systemName: "diamond.fill")
                .font(.system(size: 7))
                .foregroundStyle(wcalOpen)
                .accessibilityLabel(wt("No status", "Tanpa status"))
        } else if state == .recent {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(wcalRed)
                .accessibilityLabel(wt("Overdue", "Lewat tenggat"))
        } else {
            Image(systemName: "circle")
                .font(.system(size: 13))
                .foregroundStyle(state == .stale ? wcalStale : wcalOpen)
                .accessibilityLabel(state == .stale ? wt("Overdue", "Lewat tenggat") : wt("To do", "Belum dikerjakan"))
        }
    }
}
