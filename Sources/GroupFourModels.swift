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

// MARK: Admin (Control Room) — roster + org roles from /api/workspaces/members
struct WorkspaceRoster: Decodable, Sendable {
    let role: String?
    let workspaceId: String?
    let workspaceName: String?
    let members: [Member]?
    /// Akun yang mendaftar sendiri tanpa kode workspace — terdaftar, tapi tidak di mana pun.
    /// Hanya dikirim server untuk Manager ke atas dan hanya kalau diminta (`includeRegistered=1`).
    let availableUsers: [Registered]?
    struct Registered: Decodable, Identifiable, Sendable {
        let id: String
        let name: String?
        let email: String
        let avatar: String?
        var displayName: String { (name?.isEmpty == false ? name : nil) ?? email }
        var initial: String { String(displayName.first ?? "?").uppercased() }
    }
    struct Member: Decodable, Identifiable, Sendable {
        let id: String?
        let userId: String?
        let role: String?
        // /api/workspaces/members returns these FLAT (name/email/avatar at member level).
        let name: String?
        let email: String?
        let avatar: String?
        /// Akun Google Workspace yang ditautkan BoD dari Control Room.
        ///
        /// nil adalah keadaan NORMAL, bukan data yang hilang: tidak semua orang di NEXUS punya
        /// email kantor — saat ini tiga dari empat puluh sembilan. Tampilkan dengan tenang.
        let googleWorkspaceEmail: String?
        let attendanceRole: String?
        let attendanceShiftStartTime: String?
        let attendanceShiftEndTime: String?
        let attendanceShiftByDay: [String: ShiftDay]?
        /// Flexi Time: masuk kapan saja 12:00-15:00, pulang = masuk + 9 jam. Saat menyala, jam
        /// shift tetap di atas DIABAIKAN — jadi menggambar keduanya sama terangnya berbohong.
        let flexiTimeEnabled: Bool?
        /// Mode Mobile: absen dari mana saja (geofence mati, checkout luar kantor tanpa approval).
        let noGeofenceMode: Bool?
        /// Fixed weekly rest days, ISO 1=Mon..7=Sun. Empty/nil = works every office day.
        let restDays: [Int]?
        /// Atasan langsung di Bagan Approval — hanya bermakna untuk STAFF. nil = belum ditaruh:
        /// request orang ini masih jatuh ke BoD. Itu pekerjaan yang belum selesai, bukan galat.
        let approverId: String?
        let approver: ApproverRef?
        struct ApproverRef: Decodable, Sendable { let id: String; let name: String?; let avatar: String? }
        let joinedAt: String?
        // Some other endpoints nest under `user` — kept as a fallback.
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let name: String?; let email: String?; let avatar: String? }
        struct ShiftDay: Decodable, Sendable { let start: String?; let end: String? }

        var idv: String { userId ?? id ?? email ?? name ?? "member" }   // stable identity (was a fresh UUID per access → broke ForEach diffing)
        var displayName: String { name ?? user?.name ?? email ?? user?.email ?? "—" }
        var emailText: String? { email ?? user?.email }
        var avatarURL: String? { avatar ?? user?.avatar }
        var initial: String { String((name ?? user?.name ?? email ?? user?.email ?? "?").first ?? "?").uppercased() }
        /// "09:00–18:00" when a personal default shift override is set, else nil (= inherit team/office).
        var shiftLabel: String? {
            guard let s = attendanceShiftStartTime, let e = attendanceShiftEndTime, !s.isEmpty, !e.isEmpty else { return nil }
            return "\(s)–\(e)"
        }
    }
}

/// Shared ISO range helpers for the agenda screens.
enum AgendaRange {
    static func nowToDays(_ days: Int) -> (start: String, end: String) {
        let f = ISO8601DateFormatter()
        return (f.string(from: Date()), f.string(from: Date().addingTimeInterval(Double(days) * 86400)))
    }
    /// Backwards window, for "history" views.
    static func daysAgo(_ days: Int) -> (start: String, end: String) {
        let f = ISO8601DateFormatter()
        return (f.string(from: Date().addingTimeInterval(-Double(days) * 86400)), f.string(from: Date()))
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
