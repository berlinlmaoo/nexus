import Foundation

// MARK: Room Booking
struct RoomBooking: Decodable, Identifiable, Sendable {
    let id: String
    let room: String
    let title: String
    let startsAt: String
    let endsAt: String
    let status: String?
    let createdBy: UserRef?
    struct UserRef: Decodable, Sendable { let name: String? }
}
struct RoomBookingsResponse: Decodable, Sendable { let bookings: [RoomBooking]? }

// MARK: Team Calendar
struct CalendarEvent: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let startsAt: String
    let endsAt: String?
    let isAllDay: Bool?
    let location: String?
}
struct CalendarResponse: Decodable, Sendable { let events: [CalendarEvent]? }

// MARK: Social (Buffer)
struct BufferDraft: Decodable, Identifiable, Sendable {
    let id: String
    let text: String
    let status: String
    let dueAt: String?
    let channel: Channel?
    struct Channel: Decodable, Sendable { let name: String?; let service: String? }
}
struct BufferResponse: Decodable, Sendable {
    let configured: Bool
    let drafts: [BufferDraft]?
    let error: String?
}

// MARK: Admin (Control Room) — roster + org roles from /api/workspaces/members
struct WorkspaceRoster: Decodable, Sendable {
    let role: String?
    let members: [Member]?
    struct Member: Decodable, Identifiable, Sendable {
        let id: String?
        let userId: String?
        let role: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let name: String?; let email: String?; let avatar: String? }
        var idv: String { userId ?? id ?? UUID().uuidString }
        var displayName: String { user?.name ?? user?.email ?? "—" }
        var initial: String { String((user?.name ?? user?.email ?? "?").first ?? "?").uppercased() }
    }
}

/// Shared ISO range helpers for the agenda screens.
enum AgendaRange {
    static func nowToDays(_ days: Int) -> (start: String, end: String) {
        let f = ISO8601DateFormatter()
        return (f.string(from: Date()), f.string(from: Date().addingTimeInterval(Double(days) * 86400)))
    }
    /// "yyyy-MM-dd" day key from an ISO timestamp (Asia/Jakarta).
    static func dayKey(_ iso: String) -> String { String(iso.prefix(10)) }
    static func dayLabel(_ key: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: key) else { return key }
        let out = DateFormatter(); out.dateFormat = "EEEE, d MMM"; out.locale = Locale(identifier: "id_ID"); return out.string(from: d)
    }
    static func timeLabel(_ iso: String) -> String {
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }()
        guard let d else { return "" }
        let o = DateFormatter(); o.dateFormat = "HH:mm"; o.timeZone = TimeZone(identifier: "Asia/Jakarta"); return o.string(from: d)
    }
}
