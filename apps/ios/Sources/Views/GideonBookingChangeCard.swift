import SwiftUI

/// GIDEON's move_room_booking / cancel_room_booking card (owner, 16 Oct 2026; web
/// components/gideon/GideonBookingChangeCard.tsx). Both show the booking as it is now; a move also shows where it
/// goes, with the book_room card's room rows and nearest-slot chips (the rooms for the new slot are read live,
/// leaving this booking out, and checked again on Apply). The new room is preselected when it is free; when it
/// could be more than one room, or is busy, the person picks. Apply sends the booking id (and for a move the room
/// and slot); the server keeps a move's card open with the reason when the slot was taken meanwhile.
struct GideonBookingChangeCard: View {
    let proposal: GideonProposal
    let readOnly: Bool
    let change: GideonBookingChange
    let onApply: (GideonBookingChoice) -> Void
    let onDiscard: () -> Void

    @State private var startsAt: String
    @State private var endsAt: String
    @State private var room: String?
    @State private var touched = false
    @State private var availability: GideonRoomAvailability?
    @State private var loadFailed = false

    init(proposal: GideonProposal, change: GideonBookingChange, readOnly: Bool = false, onApply: @escaping (GideonBookingChoice) -> Void, onDiscard: @escaping () -> Void) {
        self.readOnly = readOnly
        self.proposal = proposal
        self.change = change
        self.onApply = onApply
        self.onDiscard = onDiscard
        _startsAt = State(initialValue: change.after?.startsAt ?? change.before.startsAt)
        _endsAt = State(initialValue: change.after?.endsAt ?? change.before.endsAt)
    }

    private var rooms: [GideonRoomAvailability.Room] { availability?.rooms ?? [] }
    private var target: GideonRoomAvailability.Room? { change.after?.room.flatMap { r in rooms.first { $0.room == r } } }
    private var choice: GideonBookingChoice? {
        if !change.isMove { return .cancel(change.bookingId) }
        guard let room, rooms.contains(where: { $0.room == room && $0.free }) else { return nil }
        return GideonBookingChoice(room: room, startsAt: startsAt, endsAt: endsAt, bookingId: change.bookingId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield").font(.system(size: 12)).foregroundStyle(proposal.isPending ? NX.warning : NX.mutedFg)
                VStack(alignment: .leading, spacing: 1) {
                    Text(change.isMove ? T("Move a booking") : T("Cancel a booking")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    Text(change.title ?? "").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            slotBox(label: change.isMove ? T("Now") : nil, room: change.before.room, startsAt: change.before.startsAt, endsAt: change.before.endsAt,
                    bookedBy: change.bookedBy, highlighted: false, struck: !change.isMove && proposal.status == "APPLIED")
            if change.isMove {
                HStack { Spacer(); Image(systemName: "arrow.down").font(.system(size: 12)).foregroundStyle(NX.mutedFg); Spacer() }
                if !proposal.isPending, let landed = change.applied {
                    slotBox(label: T("Moves to"), room: landed.room, startsAt: landed.startsAt, endsAt: landed.endsAt, bookedBy: nil, highlighted: true, struck: false)
                } else {
                    slotBox(label: T("Moves to"), room: room ?? change.after?.room, startsAt: startsAt, endsAt: endsAt, bookedBy: nil, highlighted: true, struck: false)
                }
            }
            if proposal.isPending && !readOnly {
                if change.isMove {
                    if availability == nil && !loadFailed {
                        HStack(spacing: 6) { ProgressView().controlSize(.small); Text(T("Checking the rooms…")) }
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                    if loadFailed { Text(T("Couldn't check the rooms.")).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                    if let target, !target.free {
                        Text(String(format: T("%@ is booked then. Pick a free room below."), RoomBooking.label(target.room)))
                            .font(NXFont.text(12)).foregroundStyle(NX.warning).fixedSize(horizontal: false, vertical: true)
                    }
                    GideonRoomRows(rooms: rooms, selected: room) { r in touched = true; room = r }
                    if availability != nil && !rooms.contains(where: { $0.free }) {
                        GideonFreeSlotChips(slots: availability?.freeSlots ?? []) { f in room = nil; touched = false; startsAt = f.startsAt; endsAt = f.endsAt }
                    }
                } else {
                    Text(T("This frees the room for that time. A BoD can restore it from the Audit."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                }
                if let e = proposal.error, !e.isEmpty {
                    Text(e).font(NXFont.text(12, .medium)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Button(T("Discard")) { onDiscard() }.buttonStyle(.nxBordered)
                    Button { if let choice { onApply(choice) } } label: {
                        Label(change.isMove ? T("Apply") : T("Cancel booking"), systemImage: "checkmark")
                    }
                    .buttonStyle(.nxPrimary)
                    .disabled(choice == nil)
                }
            } else {
                Text(readOnly ? gideonProposalState(proposal, readOnly: true) : statusText).font(NXFont.text(12, .semibold))
                    .foregroundStyle(proposal.status == "APPLIED" ? NX.success : (proposal.status == "FAILED" ? NX.danger : NX.mutedFg))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.warning.opacity(0.3)))
        .task(id: "\(startsAt)|\(endsAt)|\(proposal.error ?? "")") { if proposal.isPending && !readOnly && change.isMove { await load() } }
    }

    private func slotBox(label: String?, room: String?, startsAt: String, endsAt: String, bookedBy: String?, highlighted: Bool, struck: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let label { Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg) }
            if let room, !room.isEmpty {
                Text(RoomBooking.label(room)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).strikethrough(struck)
            }
            Label(GideonSlotClock.when(startsAt, endsAt), systemImage: "calendar.badge.clock")
                .font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg).strikethrough(struck)
            if let bookedBy, !bookedBy.isEmpty {
                Text(String(format: T("Booked by %@"), bookedBy)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(highlighted ? NX.violetText.opacity(0.5) : NX.border))
        .opacity(struck ? 0.7 : 1)
    }

    /// Reads the rooms for the new slot (leaving this booking out), then preselects until the person picks: the
    /// new room if it is free, else the only free one among the rooms the name could mean.
    private func load() async {
        loadFailed = false
        do {
            let a = try await GideonClient.roomAvailability(startsAt: startsAt, endsAt: endsAt, excludeBookingId: change.bookingId)
            availability = a
            if !touched {
                let free = a.rooms.filter(\.free)
                let candidates = free.filter { (change.after?.candidates ?? []).contains($0.room) }
                if let r = change.after?.room, free.contains(where: { $0.room == r }) { room = r }
                else { room = candidates.count == 1 ? candidates[0].room : nil }
            }
        } catch {
            loadFailed = true
        }
    }

    private var statusText: String {
        switch proposal.status {
        case "APPLIED": return change.isMove ? T("Booking moved") : T("Booking cancelled")
        case "DISCARDED": return T("Discarded")
        case "APPLYING": return T("Applying…")
        case "FAILED": return proposal.error ?? T("Couldn't apply it.")
        default: return proposal.status.capitalized
        }
    }
}
