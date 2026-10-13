import SwiftUI

/// New / edit room booking — the web's BookingComposer (room-booking.tsx, QA S-13 / B43, 13 Oct 2026):
///  • times are 24-hour, every 15 minutes (never 03:00 PM);
///  • a new booking for today starts at the next quarter hour once 09:00 has gone;
///  • a booking that has already ended can't be made (one under way can; editing an old one keeps working);
///  • the server's refusals (its text is Indonesian) are said in the app's language: ROOM_TAKEN names the
///    room the way the app does and the booking in the way, BOOKING_IN_PAST says the time has passed.
/// Editing and deleting are for the person who booked it or a Manager and above (the server re-checks).
struct RoomBookingComposer: View {
    var booking: RoomBooking? = nil
    var initialDay: String? = nil
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var room = RoomBooking.rooms[0]
    @State private var title = ""
    @State private var day = Date()
    @State private var startTime = "09:00"
    @State private var endTime = "10:00"
    @State private var notes = ""
    @State private var saving = false
    @State private var err: String?
    @State private var confirmDelete = false
    @State private var hydrated = false
    @State private var initialKey = ""

    private var editing: Bool { booking != nil }
    private static let wib = TimeZone(identifier: "Asia/Jakarta") ?? .current
    /// "00:00" … "23:45".
    static let times: [String] = (0..<96).map { String(format: "%02d:%02d", $0 / 4, ($0 % 4) * 15) }

    private var dayKey: String { Self.dayFmt.string(from: day) }
    private var endsAt: Date? { Self.instant(dayKey, endTime) }
    private var timesChanged: Bool { !editing || "\(dayKey)|\(startTime)|\(endTime)" != initialKey }
    private var inPast: Bool { timesChanged && (endsAt.map { $0 <= Date() } ?? false) }
    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && endTime > startTime && !inPast && !saving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(T("Room"), selection: $room) {
                        ForEach(RoomBooking.rooms, id: \.self) { r in Text(RoomBooking.label(r)).tag(r) }
                    }
                    TextField(T("e.g. Client meeting"), text: $title)
                }
                Section {
                    DatePicker(T("Date"), selection: $day, displayedComponents: .date)
                        .environment(\.timeZone, Self.wib)
                    Picker(T("Start"), selection: $startTime) {
                        ForEach(options(startTime), id: \.self) { Text($0).monospacedDigit().tag($0) }
                    }
                    .onChange(of: startTime) { _, v in
                        guard endTime <= v, let i = Self.times.firstIndex(of: v) else { return }
                        endTime = Self.times[min(i + 4, Self.times.count - 1)]
                    }
                    Picker(T("End"), selection: $endTime) {
                        ForEach(options(endTime), id: \.self) { Text($0).monospacedDigit().tag($0) }
                    }
                } footer: { footer }
                Section(T("Notes (optional)")) {
                    TextField(T("Notes (optional)"), text: $notes, axis: .vertical).lineLimit(2...4)
                }
                if let err {
                    Section { Text(err).foregroundStyle(NX.danger) }
                }
                if editing {
                    Section {
                        Button(T("Delete booking"), role: .destructive) { confirmDelete = true }.disabled(saving)
                    }
                }
            }
            .navigationTitle(editing ? T("Edit booking") : T("New booking"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(editing ? T("Update") : T("Book room")) }
                    }
                    .disabled(!canSave)
                }
            }
            .alert(T("Delete this booking?"), isPresented: $confirmDelete) {
                Button(T("Delete"), role: .destructive) { Task { await remove() } }
                Button(T("Cancel"), role: .cancel) {}
            }
            .interactiveDismissDisabled(saving)
            .onAppear(perform: hydrate)
        }
    }

    @ViewBuilder private var footer: some View {
        if endTime <= startTime {
            Text(T("End time has to be after the start time.")).foregroundStyle(NX.danger)
        } else if inPast {
            Text(T("That time has already passed. Pick a time later today or another day.")).foregroundStyle(NX.danger)
        } else if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(T("Add a title to book the room."))
        }
    }

    /// The quarter hours, plus an odd stored time (an old booking at 10:10) so it can still be shown.
    private func options(_ current: String) -> [String] {
        Self.times.contains(current) ? Self.times : (Self.times + [current]).sorted()
    }

    private func hydrate() {
        guard !hydrated else { return }
        hydrated = true
        if let b = booking {
            room = b.room
            title = b.title
            notes = b.description ?? ""
            if let s = ProjDate.parse(b.startsAt) { day = s; startTime = Self.hm.string(from: s) }
            if let e = ProjDate.parse(b.endsAt) { endTime = Self.hm.string(from: e) }
        } else {
            if let k = initialDay, let d = Self.dayFmt.date(from: k) { day = d }
            // Today after 09:00: the next quarter hour, for an hour (it defaulted to 09:00–10:00 at any hour).
            if dayKey == Self.dayFmt.string(from: Date()) {
                let parts = Self.hm.string(from: Date()).split(separator: ":").compactMap { Int($0) }
                if parts.count == 2 {
                    let q = Int((Double(parts[0] * 60 + parts[1]) / 15).rounded(.up))
                    if q > 36 && q < 95 {
                        startTime = Self.times[q]
                        endTime = Self.times[min(q + 4, 95)]
                    }
                }
            }
        }
        initialKey = "\(dayKey)|\(startTime)|\(endTime)"
    }

    private func save() async {
        guard canSave, let start = Self.instant(dayKey, startTime), let end = endsAt else { return }
        saving = true
        err = nil
        let iso = ISO8601DateFormatter()
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let b = booking {
                try await APIClient.shared.updateRoomBooking(id: b.id, fields: [
                    "room": room, "title": trimmed, "startsAt": iso.string(from: start), "endsAt": iso.string(from: end),
                    "description": note.isEmpty ? (NSNull() as Any) : (note as Any),
                ])
            } else {
                try await APIClient.shared.createRoomBooking(room: room, title: trimmed, startsAt: iso.string(from: start),
                                                             endsAt: iso.string(from: end), description: note.isEmpty ? nil : note)
            }
            saving = false
            await onDone()
            dismiss()
        } catch {
            // What was typed stays; the line says why, in the app's language.
            saving = false
            err = Self.refusal(error, room: room, fallback: T("Couldn't save the booking."))
        }
    }

    private func remove() async {
        guard let b = booking else { return }
        saving = true
        err = nil
        do {
            try await APIClient.shared.deleteRoomBooking(id: b.id)
            saving = false
            await onDone()
            dismiss()
        } catch {
            saving = false
            err = Self.refusal(error, room: room, fallback: T("Couldn't delete the booking."))
        }
    }

    /// The server's refusal said in the app's language (web bookingError).
    static func refusal(_ error: Error, room: String, fallback: String) -> String {
        guard let api = error as? APIError else { return fallback }
        if api.nobodyAnswered { return APIError.unreachableText }
        guard case let .http(code, message) = api else { return FailureText.text(error) }
        let msg = message ?? ""
        if code == 409 {
            // "<room> sudah dibooking pada jam itu (<title>)." — the booking in the way is in brackets.
            if let open = msg.range(of: "(", options: .backwards), let close = msg.range(of: ")", options: .backwards),
               open.upperBound < close.lowerBound {
                let other = String(msg[open.upperBound..<close.lowerBound])
                return String(format: T("%@ is already booked at that time (%@)."), RoomBooking.label(room), other)
            }
            return String(format: T("%@ is already booked at that time."), RoomBooking.label(room))
        }
        if code == 400 && msg.hasPrefix("That time has already passed") {
            return T("That time has already passed. Pick a time later today or another day.")
        }
        if code == 403 { return T("Only the person who booked it or a manager can change this booking.") }
        if code == 400 { return T("Check the date and times, then try again.") }
        return fallback
    }

    private static let dayFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = wib; return f
    }()
    private static let hm: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = wib; return f
    }()
    private static let instantFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = wib; return f
    }()
    /// The WIB wall-clock time on a day as an instant.
    static func instant(_ day: String, _ time: String) -> Date? { instantFmt.date(from: "\(day) \(time)") }
}
