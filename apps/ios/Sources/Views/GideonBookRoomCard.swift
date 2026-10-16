import SwiftUI

/// GIDEON's book_room card (owner, 16 Oct 2026; web components/gideon/GideonBookRoomCard.tsx). GIDEON never
/// guesses a room: every room is listed with its availability for that exact slot (read live), free ones
/// selectable, busy ones disabled with who holds them until when. A named room is preselected when it is free;
/// otherwise, with exactly one room free, that one is. With none free, the nearest free slots (same day, ±2 h)
/// are chips that move the card to that time. Apply stays disabled until a free room is chosen; the server
/// checks the room and slot again and, if taken meanwhile, keeps the card open with the reason.
struct GideonBookRoomCard: View {
    let proposal: GideonProposal
    let booking: GideonBooking
    let onApply: (GideonBookingChoice) -> Void
    let onDiscard: () -> Void

    @State private var startsAt: String
    @State private var endsAt: String
    @State private var room: String?
    @State private var touched = false
    @State private var availability: GideonRoomAvailability?
    @State private var loadFailed = false

    init(proposal: GideonProposal, booking: GideonBooking, onApply: @escaping (GideonBookingChoice) -> Void, onDiscard: @escaping () -> Void) {
        self.proposal = proposal
        self.booking = booking
        self.onApply = onApply
        self.onDiscard = onDiscard
        _startsAt = State(initialValue: booking.startsAt ?? "")
        _endsAt = State(initialValue: booking.endsAt ?? "")
    }

    private var rooms: [GideonRoomAvailability.Room] { availability?.rooms ?? [] }
    private var named: GideonRoomAvailability.Room? { booking.room.flatMap { r in rooms.first { $0.room == r } } }
    private var choice: GideonBookingChoice? {
        guard let room, rooms.contains(where: { $0.room == room && $0.free }) else { return nil }
        return GideonBookingChoice(room: room, startsAt: startsAt, endsAt: endsAt)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield").font(.system(size: 12)).foregroundStyle(proposal.isPending ? NX.warning : NX.mutedFg)
                Text(booking.title ?? T("Book a room")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Label(whenText, systemImage: "calendar.badge.clock").font(NXFont.text(12, .medium)).foregroundStyle(NX.foreground)
            if proposal.isPending {
                if availability == nil && !loadFailed {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text(T("Checking the rooms…")) }
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                if loadFailed { Text(T("Couldn't check the rooms.")).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                if let named, !named.free {
                    Text(String(format: T("%@ is booked then. Pick a free room below."), RoomBooking.label(named.room)))
                        .font(NXFont.text(12)).foregroundStyle(NX.warning).fixedSize(horizontal: false, vertical: true)
                }
                GideonRoomRows(rooms: rooms, selected: room) { r in touched = true; room = r }
                if availability != nil && !rooms.contains(where: { $0.free }) {
                    GideonFreeSlotChips(slots: availability?.freeSlots ?? []) { f in room = nil; touched = false; startsAt = f.startsAt; endsAt = f.endsAt }
                }
                if let e = proposal.error, !e.isEmpty {
                    Text(e).font(NXFont.text(12, .medium)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Button(T("Discard")) { onDiscard() }.buttonStyle(.nxBordered)
                    Button { if let choice { onApply(choice) } } label: { Label(T("Apply"), systemImage: "checkmark") }
                        .buttonStyle(.nxPrimary)
                        .disabled(choice == nil)
                }
            } else {
                if proposal.status == "APPLIED", let r = booking.room {
                    Text(RoomBooking.label(r)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                }
                Text(statusText).font(NXFont.text(12, .semibold))
                    .foregroundStyle(proposal.status == "APPLIED" ? NX.success : (proposal.status == "FAILED" ? NX.danger : NX.mutedFg))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.warning.opacity(0.3)))
        .task(id: "\(startsAt)|\(endsAt)|\(proposal.error ?? "")") { if proposal.isPending { await load() } }
    }

    /// Reads the rooms for the slot on the card, then preselects (until the person picks): the named room if it
    /// is free, else the only free room.
    private func load() async {
        loadFailed = false
        do {
            let a = try await GideonClient.roomAvailability(startsAt: startsAt, endsAt: endsAt)
            availability = a
            if !touched {
                let free = a.rooms.filter(\.free)
                if let r = booking.room, free.contains(where: { $0.room == r }) { room = r }
                else { room = free.count == 1 ? free[0].room : nil }
            }
        } catch {
            loadFailed = true
        }
    }

    private var whenText: String {
        guard let s = Self.date(startsAt), let e = Self.date(endsAt) else { return "" }
        let day = AppDateLocale.formatter("EEE d MMM", timeZone: Self.wib).string(from: s)
        return "\(day) · \(clock(startsAt))–\(Self.hm.string(from: e))"
    }

    private var statusText: String {
        switch proposal.status {
        case "APPLIED": return T("Room booked")
        case "DISCARDED": return T("Discarded")
        case "APPLYING": return T("Applying…")
        case "FAILED": return proposal.error ?? T("Couldn't apply it.")
        default: return proposal.status.capitalized
        }
    }

    private func clock(_ iso: String?) -> String {
        guard let iso, let d = Self.date(iso) else { return "" }
        return Self.hm.string(from: d)
    }

    private static let wib = TimeZone(identifier: "Asia/Jakarta") ?? .current
    private static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = wib
        f.dateFormat = "HH:mm"
        return f
    }()
    private static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }
}

/// Every room for one slot, as rows (the book_room card and the move card): free ones selectable, busy ones
/// disabled with who holds them until when, the capacity when it is known.
struct GideonRoomRows: View {
    let rooms: [GideonRoomAvailability.Room]
    let selected: String?
    let onPick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rooms) { r in row(r) }
        }
    }

    private func row(_ r: GideonRoomAvailability.Room) -> some View {
        let isSelected = selected == r.room && r.free
        return Button { onPick(r.room) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 13)).foregroundStyle(isSelected ? NX.violetText : NX.mutedFg)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(RoomBooking.label(r.room)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                        if let n = r.capacity { Text("· " + String(format: T("%d seats"), n)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }
                    if let busy = r.busy {
                        Text(String(format: T("Booked by %@ until %@"), busy.by ?? T("someone"), GideonSlotClock.clock(busy.endsAt)))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(isSelected ? NX.violetText.opacity(0.06) : NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(isSelected ? NX.violetText : NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!r.free)
        .opacity(r.free ? 1 : 0.6)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The nearest free slots (same day, ±2 h) when no room is free: a chip moves the card to that time.
struct GideonFreeSlotChips: View {
    let slots: [GideonRoomAvailability.Slot]
    let onPick: (GideonRoomAvailability.Slot) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(T("No room is free then. Nearest free times:")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(slots) { f in
                        Button { onPick(f) } label: {
                            Text("\(GideonSlotClock.clock(f.startsAt))–\(GideonSlotClock.clock(f.endsAt))").font(NXFont.text(12, .medium)).monospacedDigit()
                                .foregroundStyle(NX.foreground)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(NX.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(NX.border))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// WIB clock and day text for the booking cards.
enum GideonSlotClock {
    static let wib = TimeZone(identifier: "Asia/Jakarta") ?? .current
    static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = wib
        f.dateFormat = "HH:mm"
        return f
    }()

    static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    static func clock(_ iso: String?) -> String {
        guard let iso, let d = date(iso) else { return "" }
        return hm.string(from: d)
    }

    /// "Mon 19 Oct · 14:00–15:00" (WIB).
    static func when(_ startsAt: String, _ endsAt: String) -> String {
        guard let s = date(startsAt), let e = date(endsAt) else { return "" }
        let day = AppDateLocale.formatter("EEE d MMM", timeZone: wib).string(from: s)
        return "\(day) · \(hm.string(from: s))–\(hm.string(from: e))"
    }
}
