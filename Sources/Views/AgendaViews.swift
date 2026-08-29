import SwiftUI

/// Port of room-booking.tsx: day-grouped agenda of room bookings.
/// Upcoming *and* past — the old version only ever queried `now … now+14d`, so there was no way to
/// see anything that already happened.
struct RoomBookingView: View {
    @Environment(AuthStore.self) private var auth
    @State private var bookings: [RoomBooking] = []
    @State private var loading = true
    @State private var error: String?
    @State private var scope: Scope = .upcoming

    enum Scope: String, CaseIterable, Identifiable {
        case upcoming, past
        var id: String { rawValue }
        var label: String { self == .upcoming ? T("Upcoming") : T("History") }
        var empty: String {
            self == .upcoming ? T("No bookings in the next 14 days.")
                              : T("No bookings in the last 30 days.")
        }
    }

    private var byDay: [(key: String, items: [RoomBooking])] {
        let groups = Dictionary(grouping: bookings, by: { AgendaRange.dayKey($0.startsAt) })
        // History reads newest-first; upcoming reads soonest-first.
        let keys = scope == .past ? groups.keys.sorted(by: >) : groups.keys.sorted()
        return keys.map { ($0, groups[$0]!.sorted { $0.startsAt < $1.startsAt }) }
    }

    var body: some View {
        AgendaScaffold(title: T("Room Booking"), subtitle: T("Room bookings — VIP, Meeting, Studio."),
                       loading: loading, error: error, isEmpty: bookings.isEmpty,
                       emptyIcon: "calendar.badge.clock", emptyText: scope.empty,
                       retry: { await load() },
                       toolbar: AnyView(scopePicker)) {
            ForEach(byDay, id: \.key) { day in
                AgendaDay(label: AgendaRange.dayLabel(day.key)) {
                    ForEach(day.items) { b in
                        // Colour the chip by room, not by scope. Greying out History made the whole
                        // screen read as one flat grey sheet, and the segmented control already
                        // says which scope you're in. Same room = same colour, every launch.
                        AgendaRow(time: "\(AgendaRange.timeLabel(b.startsAt))–\(AgendaRange.timeLabel(b.endsAt))",
                                  title: b.title, chip: b.room, sub: b.createdBy?.name,
                                  tone: ChipTone.forLabel(b.room))
                    }
                }
            }
        }
        .task(id: scope) { await load() }
    }

    private var scopePicker: some View {
        Picker("", selection: $scope) {
            ForEach(Scope.allCases) { s in Text(s.label).tag(s) }
        }
        .pickerStyle(.segmented)
        .frame(width: 170)
    }

    private func load() async {
        loading = true
        error = nil
        let r = scope == .upcoming ? AgendaRange.nowToDays(14) : AgendaRange.daysAgo(30)
        do { bookings = try await APIClient.shared.roomBookings(start: r.start, end: r.end) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load bookings.") }
        loading = false
    }
}

/// Port of master-calendar.tsx ("Team Calendar"): team selector + day-grouped event agenda.
struct TeamCalendarView: View {
    @Environment(AuthStore.self) private var auth
    @State private var teams: [Team] = []
    @State private var teamId: String?
    @State private var events: [CalendarEvent] = []
    @State private var loading = true
    @State private var error: String?

    // Month grid (the web's shape) instead of a flat 14-day list.
    @State private var monthOffset = 0
    @State private var selectedDay: Int?

    private var cal: Calendar { ProjDate.cal }
    private var monthDate: Date { cal.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date() }
    private var comps: DateComponents { cal.dateComponents([.year, .month], from: monthDate) }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthDate)?.count ?? 30 }
    private var leadingBlanks: Int {
        let first = cal.date(from: comps) ?? monthDate
        return (cal.component(.weekday, from: first) + 5) % 7   // Monday = 0
    }
    private var eventsByDay: [Int: [CalendarEvent]] {
        var map: [Int: [CalendarEvent]] = [:]
        for e in events {
            guard let d = ProjDate.parse(e.startsAt) else { continue }
            let c = cal.dateComponents([.year, .month, .day], from: d)
            if c.year == comps.year, c.month == comps.month, let day = c.day { map[day, default: []].append(e) }
        }
        return map
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText)
            } else if let error {
                ErrorState(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    VStack(spacing: 14) {
                        header
                        weekdayRow
                        grid
                        dayDetail
                    }
                    .padding(16)
                }
                .refreshable { await load() }
            }
        }
        .navigationTitle(T("Team Calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { teamMenu } }
        .task { await load() }
    }

    private var header: some View {
        HStack {
            Button { monthOffset -= 1; selectedDay = nil; Task { await loadEvents() } } label: {
                Image(systemName: "chevron.left").foregroundStyle(NX.foreground)
            }
            Spacer()
            Text(ProjDate.fmt("MMMM yyyy").string(from: monthDate).capitalized)
                .font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            Button { monthOffset += 1; selectedDay = nil; Task { await loadEvents() } } label: {
                Image(systemName: "chevron.right").foregroundStyle(NX.foreground)
            }
        }
    }

    private var weekdayRow: some View {
        HStack(spacing: 4) {
            ForEach(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], id: \.self) { d in
                Text(T(d)).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let map = eventsByDay
        return LazyVGrid(columns: cols, spacing: 4) {
            ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 44) }
            ForEach(1...daysInMonth, id: \.self) { day in
                let has = !(map[day]?.isEmpty ?? true)
                let on = selectedDay == day
                Button { selectedDay = day } label: {
                    VStack(spacing: 3) {
                        Text("\(day)").font(NXFont.text(13, on ? .bold : .regular))
                            .foregroundStyle(on ? Color.white : NX.foreground)
                        Circle().fill(has ? (on ? Color.white : NX.violet) : Color.clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(on ? NX.violet : (has ? NX.violet.opacity(0.08) : Color.clear),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var dayDetail: some View {
        if let sel = selectedDay {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("\(sel) \(ProjDate.fmt("MMMM").string(from: monthDate).capitalized)")
                let items = eventsByDay[sel] ?? []
                if items.isEmpty {
                    Text(T("No events on this date.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(items) { e in
                        AgendaRow(time: (e.isAllDay ?? false) ? T("All day") : AgendaRange.timeLabel(e.startsAt),
                                  title: e.title, chip: nil, sub: e.location, tone: .info)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(T("Pick a date to see its events.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
    }

    @ViewBuilder private var teamMenu: some View {
        if teams.count > 1 {
            Menu {
                Button(T("All teams")) { teamId = nil; Task { await loadEvents() } }
                ForEach(teams) { t in Button(t.name) { teamId = t.id; Task { await loadEvents() } } }
            } label: {
                Text(teams.first(where: { $0.id == teamId })?.name ?? T("All teams"))
                    .font(NXFont.text(13, .semibold)).lineLimit(1)
            }
        }
    }

    private func load() async {
        error = nil
        teams = (try? await APIClient.shared.teams()) ?? []
        // One team = no menu is drawn, so nothing would ever set `teamId` and every request would
        // go out team-less (400). Pick it here.
        if teams.count == 1 { teamId = teams[0].id }
        await loadEvents()
    }

    /// `/api/master-calendar` needs a teamId, so "All teams" is fanned out into one request per team
    /// and merged (deduped by id — an event shared by two teams comes back twice). Sequential on
    /// purpose: a workspace has a handful of teams, and this keeps the error handling in one place.
    private func loadEvents() async {
        let start = cal.date(from: comps) ?? monthDate
        let end = cal.date(byAdding: .month, value: 1, to: start) ?? start
        let f = ISO8601DateFormatter()
        let ids = teamId.map { [$0] } ?? teams.map(\.id)

        // No team at all → nothing to ask for. Empty calendar, not an error.
        guard !ids.isEmpty else { events = []; error = nil; loading = false; return }

        var merged: [String: CalendarEvent] = [:]
        do {
            for id in ids {
                for e in try await APIClient.shared.masterCalendar(teamId: id,
                                                                   start: f.string(from: start),
                                                                   end: f.string(from: end)) {
                    merged[e.id] = e
                }
            }
            events = merged.values.sorted { $0.startsAt < $1.startsAt }
            error = nil
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the calendar.") }
        loading = false
    }
}

// MARK: - shared agenda UI

struct AgendaScaffold<Content: View>: View {
    let title: String
    let subtitle: String
    let loading: Bool
    let error: String?
    let isEmpty: Bool
    let emptyIcon: String
    let emptyText: String
    let retry: () async -> Void
    var toolbar: AnyView? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                    Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    Button(T("Try again")) { Task { await retry() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
            } else if isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: emptyIcon).font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                    Text(emptyText).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(subtitle).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        content()
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if let toolbar { ToolbarItem(placement: .topBarTrailing) { toolbar } } }
    }
}

struct AgendaDay<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label).padding(.leading, 4)
            VStack(spacing: 0) { content() }
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                        .nexusShadowSoft()
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                }
        }
    }
}

struct AgendaRow: View {
    let time: String
    let title: String
    let chip: String?
    let sub: String?
    let tone: ChipTone
    var body: some View {
        HStack(spacing: 12) {
            // Time rail carries the row's tone so each entry is colour-coded end to end, instead of
            // every row being the same violet on near-black.
            Text(time).font(NXFont.text(12, .bold)).foregroundStyle(tone.fg).frame(width: 56, alignment: .leading)
            Rectangle().fill(tone.fg.opacity(0.35)).frame(width: 1, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                if let sub, !sub.isEmpty { Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 4)
            if let chip { NexusChip(text: chip, tone: tone) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}
