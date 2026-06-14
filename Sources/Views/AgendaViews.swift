import SwiftUI

/// Port of room-booking.tsx: day-grouped agenda of room bookings (next 14 days).
struct RoomBookingView: View {
    @Environment(AuthStore.self) private var auth
    @State private var bookings: [RoomBooking] = []
    @State private var loading = true
    @State private var error: String?

    private var byDay: [(key: String, items: [RoomBooking])] {
        let groups = Dictionary(grouping: bookings, by: { AgendaRange.dayKey($0.startsAt) })
        return groups.keys.sorted().map { ($0, groups[$0]!.sorted { $0.startsAt < $1.startsAt }) }
    }

    var body: some View {
        AgendaScaffold(title: "Room Booking", subtitle: "Booking ruangan — VIP, Meeting, Studio.",
                       loading: loading, error: error, isEmpty: bookings.isEmpty,
                       emptyIcon: "calendar.badge.clock", emptyText: "Belum ada booking dalam 14 hari ke depan.",
                       retry: { await load() }) {
            ForEach(byDay, id: \.key) { day in
                AgendaDay(label: AgendaRange.dayLabel(day.key)) {
                    ForEach(day.items) { b in
                        AgendaRow(time: "\(AgendaRange.timeLabel(b.startsAt))–\(AgendaRange.timeLabel(b.endsAt))",
                                  title: b.title, chip: b.room, sub: b.createdBy?.name, tone: .accent)
                    }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        error = nil
        let r = AgendaRange.nowToDays(14)
        do { bookings = try await APIClient.shared.roomBookings(start: r.start, end: r.end) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat booking." }
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

    private var byDay: [(key: String, items: [CalendarEvent])] {
        let groups = Dictionary(grouping: events, by: { AgendaRange.dayKey($0.startsAt) })
        return groups.keys.sorted().map { ($0, groups[$0]!.sorted { ($1.isAllDay ?? false ? 1 : 0, $0.startsAt) < ($0.isAllDay ?? false ? 1 : 0, $1.startsAt) }) }
    }

    var body: some View {
        AgendaScaffold(title: "Team Calendar", subtitle: "Jadwal & meeting tim — live per team.",
                       loading: loading, error: error, isEmpty: events.isEmpty,
                       emptyIcon: "calendar", emptyText: "Belum ada event dalam 14 hari ke depan.",
                       retry: { await load() },
                       toolbar: AnyView(teamMenu)) {
            ForEach(byDay, id: \.key) { day in
                AgendaDay(label: AgendaRange.dayLabel(day.key)) {
                    ForEach(day.items) { e in
                        AgendaRow(time: (e.isAllDay ?? false) ? "All day" : AgendaRange.timeLabel(e.startsAt),
                                  title: e.title, chip: nil, sub: e.location, tone: .info)
                    }
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder private var teamMenu: some View {
        if teams.count > 1 {
            Menu {
                ForEach(teams) { t in Button(t.name) { teamId = t.id; Task { await loadEvents() } } }
            } label: {
                Text(teams.first(where: { $0.id == teamId })?.name ?? "Team").font(NXFont.text(13, .semibold)).lineLimit(1)
            }
        }
    }

    private func load() async {
        error = nil
        do {
            teams = try await APIClient.shared.teams()
            teamId = teamId ?? teams.first?.id
            await loadEvents()
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = "Gagal memuat tim."; loading = false }
    }
    private func loadEvents() async {
        guard let tid = teamId else { events = []; loading = false; return }
        let r = AgendaRange.nowToDays(14)
        events = (try? await APIClient.shared.masterCalendar(teamId: tid, start: r.start, end: r.end)) ?? []
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
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                    Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    Button("Coba lagi") { Task { await retry() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
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
            Text(time).font(NXFont.text(12, .bold)).foregroundStyle(NX.violet).frame(width: 56, alignment: .leading)
            Rectangle().fill(NX.border).frame(width: 1, height: 32)
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
