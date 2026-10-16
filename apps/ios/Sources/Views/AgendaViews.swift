import SwiftUI

/// Port of room-booking.tsx: the bookings of one month, grouped by day, with ‹ Today › to move
/// between months (web, UI tour run 4). It used to be an Upcoming (14 days) | History (30 days) switch,
/// which the web never had: the two clients showed different bookings for the same question, and the
/// iPhone's empty screen offered no way to book.
struct RoomBookingView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    /// Regular width, as the sidebar's selection: the web's page header (room-booking.tsx) with the
    /// room picker and a near-black "New booking". The phone, and the screen pushed elsewhere, keep
    /// the bar.
    private var pageRoot: Bool { NXSidebarPage.isRoot(.roomBooking, hSize: hSize, router: router) }
    /// The web header's room filter ("" = all rooms). Only applies under the page header.
    @State private var roomFilter = ""
    @State private var bookings: [RoomBooking] = []
    @State private var loading = true
    @State private var error: String?
    /// The first day of the month on screen (Asia/Jakarta), as the web's viewMonth.
    @State private var month: Date = RoomBookingView.monthStart(Date())
    /// The composer: a new booking (nil booking) or one to edit (web BookingComposer, QA 13 Oct 2026).
    @State private var composing: ComposerTarget?
    @State private var viewer = Viewer.shared

    struct ComposerTarget: Identifiable {
        let id = UUID()
        let booking: RoomBooking?
    }
    /// The person who booked it, or a Manager and above (the server's canManageBooking).
    private func canEdit(_ b: RoomBooking) -> Bool {
        if let me = auth.session?.userId, b.createdBy?.id == me { return true }
        return viewer.canAdminister
    }

    private static func monthStart(_ d: Date) -> Date {
        let c = ProjDate.cal.dateComponents([.year, .month], from: d)
        return ProjDate.cal.date(from: c) ?? d
    }
    private func shiftMonth(_ n: Int) {
        month = Self.monthStart(ProjDate.cal.date(byAdding: .month, value: n, to: month) ?? month)
    }
    private var isThisMonth: Bool { month == Self.monthStart(Date()) }

    /// The room filter applies on every width now: the phone has the web's "All rooms" picker too (UI tour run 7).
    private var shown: [RoomBooking] {
        guard !roomFilter.isEmpty else { return bookings }
        return bookings.filter { $0.room == roomFilter }
    }

    /// Elapsed days of this month are folded behind "Show N earlier bookings this month" (web room-booking.tsx).
    @State private var showEarlier = false
    private var todayKey: String { AgendaRange.dayKey(ISO8601DateFormatter().string(from: Date())) }
    private var earlierCount: Int {
        guard isThisMonth else { return 0 }
        let today = todayKey
        return shown.filter { AgendaRange.dayKey($0.startsAt) < today }.count
    }

    /// Soonest first; in the current month the elapsed days stay folded until asked for, as on web.
    private var byDay: [(key: String, items: [RoomBooking])] {
        let today = todayKey
        let hidePast = isThisMonth && !showEarlier
        let groups = Dictionary(grouping: shown, by: { AgendaRange.dayKey($0.startsAt) })
        return groups.keys.sorted().filter { !hidePast || $0 >= today }
            .map { ($0, groups[$0]!.sorted { $0.startsAt < $1.startsAt }) }
    }

    private var emptyTitle: String {
        let name = ProjDate.fmt("MMMM").string(from: month)
        return String(format: T(earlierCount > 0 && !showEarlier ? "Nothing else booked in %@" : "Nothing booked in %@"), name)
    }

    var body: some View {
        AgendaScaffold(title: T("Room Booking"), subtitle: T("Book a meeting room and see who has it when."),
                       loading: loading, error: error, isEmpty: byDay.isEmpty,
                       emptyIcon: "calendar",
                       emptyText: T("Book meeting rooms here so two teams never turn up for the same room. Pick a room, a date and a time."),
                       emptyTitle: emptyTitle,
                       emptyActionTitle: T("New booking"),
                       emptyAction: { composing = ComposerTarget(booking: nil) },
                       retry: { await load() },
                       toolbar: pageRoot ? nil : AnyView(newBookingButton),
                       header: AnyView(monthBar),
                       pageRoot: pageRoot) {
            ForEach(byDay, id: \.key) { day in
                AgendaDay(label: AgendaRange.dayLabel(day.key)) {
                    ForEach(day.items) { b in
                        // Colour the chip by room. Same room = same colour, every launch.
                        // 24-hour times (HH:mm, WIB) and the room as the app names it (web roomLabel).
                        let row = AgendaRow(time: "\(AgendaRange.timeLabel(b.startsAt))–\(AgendaRange.timeLabel(b.endsAt))",
                                            title: b.title, chip: b.roomLabel,
                                            sub: (b.createdBy?.name).flatMap { $0.isEmpty ? nil : String(format: T("by %@"), $0) },
                                            tone: ChipTone.forLabel(b.room))
                        if canEdit(b) {
                            Button { composing = ComposerTarget(booking: b) } label: { row.contentShape(Rectangle()) }
                                .buttonStyle(.plain)
                                .accessibilityHint(T("Edit booking"))
                        } else {
                            row
                        }
                    }
                }
            }
        }
        .nxSidebarPageChrome(pageRoot) {
            NXPageHeader(title: T("Room Booking"), subtitle: T("Book a meeting room and see who has it when.")) {
                roomMenu
                Button { composing = ComposerTarget(booking: nil) } label: { Label(T("New booking"), systemImage: "plus") }
                    .buttonStyle(.nxPrimary)
            }
        }
        .task(id: month) { showEarlier = false; await load() }
        .task { await viewer.loadIfNeeded() }
        .sheet(item: $composing) { target in
            RoomBookingComposer(booking: target.booking) { await load() }
        }
    }

    /// The web's month row: "October 2026" on the left, ‹ Today › on the right; below it, on the phone,
    /// the room picker, and the "Show N earlier bookings" toggle while the elapsed days are folded.
    private var monthBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            monthRow
            if !pageRoot || (!loading && error == nil && earlierCount > 0 && !showEarlier) {
                HStack(spacing: 8) {
                    if !pageRoot { roomMenu }
                    if !loading, error == nil, earlierCount > 0, !showEarlier {
                        Button(String(format: T(earlierCount == 1 ? "Show %d earlier booking this month" : "Show %d earlier bookings this month"), earlierCount)) {
                            showEarlier = true
                        }
                        .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var monthRow: some View {
        HStack(spacing: 4) {
            Text(AppDateLocale.monthTitle(month))
                .font(NXFont.display(pageRoot ? 20 : 18, .bold)).foregroundStyle(NX.foreground)
                .lineLimit(1).minimumScaleFactor(0.8)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Button { shiftMonth(-1) } label: {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(NX.mutedFg)
            .accessibilityLabel(T("Previous month"))
            // Always enabled, as on web: a disabled-looking Today read as broken (UI tour run 7).
            Button(T("Today")) { month = Self.monthStart(Date()) }
                .buttonStyle(.nxBordered)
            Button { shiftMonth(1) } label: {
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(NX.mutedFg)
            .accessibilityLabel(T("Next month"))
        }
    }

    /// The web's room picker: All rooms, or one of the three.
    private var roomMenu: some View {
        Menu {
            Picker(T("Room"), selection: $roomFilter) {
                Text(T("All rooms")).tag("")
                ForEach(RoomBooking.rooms, id: \.self) { r in Text(RoomBooking.label(r)).tag(r) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(roomFilter.isEmpty ? T("All rooms") : RoomBooking.label(roomFilter)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
        }
        .menuStyle(.button)
        .buttonStyle(.nxBordered)
        .fixedSize()
        .accessibilityLabel(T("Room"))
    }

    private var newBookingButton: some View {
        Button { composing = ComposerTarget(booking: nil) } label: { Image(systemName: "plus") }
            .accessibilityLabel(T("New booking"))
    }

    private func load() async {
        loading = true
        error = nil
        // The month's first instant to the last second of its last day (WIB), as the web asks.
        let start = month
        let next = ProjDate.cal.date(byAdding: .month, value: 1, to: start) ?? start.addingTimeInterval(31 * 86400)
        let f = ISO8601DateFormatter()
        do { bookings = try await APIClient.shared.roomBookings(start: f.string(from: start), end: f.string(from: next.addingTimeInterval(-1))) }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load bookings.") }
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
    /// With a title the empty state is the app's EmptyState (title, why, next step) near the top, as the
    /// web draws it; without one, the old centred icon and line.
    var emptyTitle: String? = nil
    var emptyActionTitle: String? = nil
    var emptyAction: (() -> Void)? = nil
    let retry: () async -> Void
    var toolbar: AnyView? = nil
    /// A control row under the navigation bar, above every state (loading, empty, list), so a choice
    /// like Upcoming | History stays reachable when the list it picks is empty.
    var header: AnyView? = nil
    /// Under the web's page header (regular width, sidebar root): the header carries the subtitle,
    /// and the page takes the web's 32 pt gutters.
    var pageRoot: Bool = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            // The subtitle sits right under the title, above the controls and every state (UI tour run 7);
            // under the page header (regular width) the header carries it.
            if !pageRoot {
                Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, NXSidebarPage.gutter(pageRoot))
                    .padding(.top, 4)
            }
            if let header {
                header
                    .padding(.horizontal, NXSidebarPage.gutter(pageRoot))
                    .padding(.top, pageRoot ? 20 : 8)
            }
            states
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if let toolbar { ToolbarItem(placement: .topBarTrailing) { toolbar } } }
    }

    private var states: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                ErrorState(message: error) { Task { await retry() } }
            } else if isEmpty, let emptyTitle {
                ScrollView {
                    EmptyState(icon: emptyIcon, title: emptyTitle, subtitle: emptyText,
                               // The secondary (outline) style, as web: the header "+" is the primary action
                               // (decision 13 of run 20, R20-I-10 / R20-B-14; web WB-5).
                               actionTitle: emptyActionTitle, actionIcon: nil, action: emptyAction)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, NXSidebarPage.gutter(pageRoot))
                        .padding(.top, 48)
                }
            } else if isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: emptyIcon).font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                    Text(emptyText).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        content()
                    }
                    .padding(NXSidebarPage.gutter(pageRoot))
                }
            }
        }
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


/// The app's own segmented control.
///
/// Replaces `.pickerStyle(.segmented)`, which since iOS 26 renders as Liquid Glass: translucent,
/// reflecting whatever is behind it, and effectively unreadable on a light screen. This one is
/// solid, uses the NX colour tokens, and moves its pill with matchedGeometryEffect.
///
/// It looks custom but behaves like the system control (impeccable audit, 6 Oct 2026). Each option
/// is a real Button, so it takes the pointer's hover on iPad and Mac and keyboard focus, and its
/// whole 44 pt row answers a tap (the old text-plus-tap-gesture was about 30 pt and invisible to
/// VoiceOver as a control). VoiceOver is handed an actual segmented Picker through
/// `accessibilityRepresentation`, so it hears "Month, selected, 1 of 2" instead of plain text.
struct NXSegmented<T: Hashable>: View {
    @Binding var selection: T
    let options: [T]
    let label: (T) -> String
    /// What the choice is about ("View", "Group by"), read by VoiceOver before the options. Last
    /// and optional, so every existing call site keeps compiling unchanged.
    var title: String? = nil
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { option in
                segment(option)
            }
        }
        // Inset sideways only: vertically the pill is inset inside each 44 pt button instead, so the
        // track's own padding still takes taps.
        .padding(.horizontal, 4)
        .background(NX.muted, in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(NX.border.opacity(0.6)))
        .accessibilityRepresentation {
            Picker(title ?? "", selection: $selection) {
                ForEach(options, id: \.self) { option in
                    Text(label(option)).tag(option)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private func segment(_ option: T) -> some View {
        let active = option == selection
        return Button {
            guard !active else { return }
            withAnimation(.snappy(duration: 0.22)) { selection = option }
        } label: {
            Text(label(option))
                .font(NXFont.text(13, .semibold))
                .foregroundStyle(active ? NX.foreground : NX.mutedFg)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background {
                    if active {
                        Capsule(style: .continuous)
                            .fill(NX.card)
                            .overlay(Capsule(style: .continuous).strokeBorder(NX.border))
                            .padding(.vertical, 4)
                            .matchedGeometryEffect(id: "nx.segment", in: ns)
                    }
                }
                .contentShape(Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
