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
                        // 24-hour times (HH:mm, WIB) and the room as the app names it (web roomLabel).
                        let row = AgendaRow(time: "\(AgendaRange.timeLabel(b.startsAt))–\(AgendaRange.timeLabel(b.endsAt))",
                                            title: b.title, chip: b.roomLabel, sub: b.createdBy?.name,
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
        .task(id: scope) { await load() }
        .task { await viewer.loadIfNeeded() }
        .sheet(item: $composing) { target in
            RoomBookingComposer(booking: target.booking) { await load() }
        }
    }

    private var scopePicker: some View {
        // Not .pickerStyle(.segmented): since iOS 26 the system style renders as Liquid Glass,
        // which is translucent and reflective over a light background - the control nearly
        // disappears and reads as foreign next to the solid cards on this screen. Ours is a solid
        // capsule with one moving pill, painted from the app's own palette.
        HStack(spacing: 8) {
            NXSegmented(selection: $scope, options: Scope.allCases, label: { $0.label }).frame(width: 190)
            Button { composing = ComposerTarget(booking: nil) } label: { Image(systemName: "plus") }
                .accessibilityLabel(T("New booking"))
        }
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
                ErrorState(message: error) { Task { await retry() } }
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
