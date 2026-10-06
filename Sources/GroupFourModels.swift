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

// MARK: Admin (Control Room) — roster + org roles from /api/workspaces/members
struct WorkspaceRoster: Decodable, Sendable {
    let role: String?
    /// The caller belongs to the company workspace (Z Networks). Z Vault, the NAS and Threads are
    /// the company's; anyone else (a personal workspace from signing up without a code) does not
    /// see them (owner, 29 Sep 2026). Servers from 29 Sep 2026.
    let isCompany: Bool?
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
    /// "yyyy-MM-dd" day key from an ISO timestamp, as the day it is in Asia/Jakarta.
    ///
    /// This used to be the first ten characters, which is the UTC day: anything from 17:00Z on
    /// (00:00–06:59 WIB) landed on the day before. A date-only value stored at 00:00Z is 07:00 WIB on
    /// the same day, so it keeps its day either way. Text that is not an ISO instant (already a bare
    /// "yyyy-MM-dd") falls back to its first ten characters, as before.
    static func dayKey(_ iso: String) -> String {
        guard let d = ProjDate.parse(iso) else { return String(iso.prefix(10)) }
        return wibDay.string(from: d)
    }
    private static let wibDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func dayLabel(_ key: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: key) else { return key }
        let out = DateFormatter(); out.dateFormat = "EEEE, d MMM"; out.locale = Locale(identifier: "id_ID"); return out.string(from: d)
    }
    /// Called per row by lists that can run to hundreds (Submissions, tickets, agenda), so the
    /// formatters are built once instead of three per call. `ProjDate.parse` is the same
    /// fractional-then-plain ISO parse this used to do inline.
    static func timeLabel(_ iso: String) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        return hhmm.string(from: d)
    }
    private static let hhmm: DateFormatter = {
        let o = DateFormatter(); o.dateFormat = "HH:mm"; o.timeZone = TimeZone(identifier: "Asia/Jakarta"); return o
    }()
}
