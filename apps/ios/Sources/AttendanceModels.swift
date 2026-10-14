import Foundation

/// GET /api/attendance/today — only the fields the native screen needs (lenient/optional).
struct AttendanceToday: Decodable, Sendable {
    let attendanceDateKey: String?
    let activeOfficeCount: Int?
    let canManageAttendance: Bool?
    let canReviewAttendanceRequests: Bool?
    let dayOffUsedThisMonth: Int?
    let dayOffQuota: Int?
    let redDateUsedThisMonth: Int?
    let redDateQuota: Int?
    let today: AttendanceRecord?
    let pendingCheckout: AttendanceRecord?
    let todayRequest: TodayRequest?
    let myShift: Shift?
    /// Custom/Mobile attendance: this member may clock in or out anywhere, so the office
    /// geofence is not enforced for them. Sent by GET /api/attendance/today.
    let noGeofence: Bool?

    struct Shift: Decodable, Sendable {
        let startTime: String
        let endTime: String
        let source: String
        /// Flexi Time: the times above are a check-in WINDOW, not a fixed shift, and the
        /// clock-out is derived as check-in + 9h. Optional so older responses still decode.
        let flexi: Bool?
    }
    struct TodayRequest: Decodable, Sendable { let type: String?; let status: String? }

    /// Cuti tahunan: 12 months of service before it exists at all, then 12 days a calendar year.
    /// Sent by GET /api/attendance/today; optional so an older server still decodes.
    struct AnnualLeave: Decodable, Sendable {
        let eligible: Bool
        let reason: String?
        let year: Int?
        let quota: Int?
        let used: Int?
        let remaining: Int?
    }
    let annualLeave: AnnualLeave?

    /// How `dayOffQuota` is made up for the period today is in: the person's base quota plus extra
    /// days the BoD granted for that period only (28 Sep 2026). `dayOffQuota` already includes the
    /// bonus; this only explains it. Optional so an older server still decodes.
    struct DayOffAllowance: Decodable, Sendable {
        let period: String?
        let base: Int?
        let bonus: Int?
        let grants: [Grant]?
        struct Grant: Decodable, Sendable { let days: Int?; let reason: String? }
    }
    let dayOffAllowance: DayOffAllowance?
}

struct AttendanceRecord: Decodable, Sendable {
    let id: String
    let status: String?
    let checkInAt: String?
    let checkOutAt: String?
    let lateMinutes: Int?
    /// Minutes worked once checked out, as the server counts them (the web's "Worked 8h 45m").
    /// Optional so every server before it still decodes; the button falls back to out − in.
    let workedMinutes: Int?
    let checkOutApproval: String?   // PENDING | APPROVED | REJECTED | null
    let officeLocation: OfficeRef?
    /// "on" | "denied" | nil — whether Always location was granted for this record (0.1.6).
    /// Optional so every server before it still decodes.
    let locationTrackingState: String?
    /// Start of the outside-the-office episode the server is timing right now (reminder at 1h30,
    /// heads-up at 2h, and the automatic offsite check-out at 2h30 only while the remote-config
    /// switch `flags.outsideAutoCheckout` is on — off since 8 Oct 2026), nil while inside. The Live Activity quotes it so the
    /// phone and the pushes name the same time. Optional so every server before it still decodes.
    let outsideSince: String?
    /// Where the check-in was made, reverse-geocoded by the server. What a location-free member's
    /// card shows instead of an office they were never at. Optional so older servers still decode.
    let checkInAddress: String?
    /// Checked in further from `officeLocation` than its radius — only a location-free member can.
    /// Then the day's place is `checkInAddress`, not the office (owner, 28 Sep 2026). nil = unknown or
    /// a server before it; `checkedInAway` falls back to distance vs radius.
    let checkInAway: Bool?
    let checkInDistanceMeters: Double?
    let checkInLat: Double?
    let checkInLng: Double?

    /// The office the check-in was made against. `serializeAttendanceRecord` has always sent the
    /// geofence too; only the name was decoded until the work-hours trail needed the circle itself.
    struct OfficeRef: Decodable, Sendable {
        let name: String?
        let id: String?
        let latitude: Double?
        let longitude: Double?
        let radiusMeters: Double?   // Double, not Int: an integer decodes into it, a fraction would not decode the other way and would take all of today down with it
    }

    var hasCheckedIn: Bool { checkInAt != nil }
    var hasCheckedOut: Bool { checkOutAt != nil }

    /// true = this day's check-in was made away from the office; nil = unknown.
    var checkedInAway: Bool? {
        AttendancePlace.isAway(flag: checkInAway, distance: checkInDistanceMeters, radius: officeLocation?.radiusMeters)
    }
    /// "Which office" for this day: the short check-in address when away, else the office name.
    var placeLabel: String? {
        AttendancePlace.label(away: checkedInAway, address: checkInAddress, lat: checkInLat, lng: checkInLng,
                              office: officeLocation?.name)
    }
}

/// Where a day's check-in happened, as text (owner decision, owner, 28 Sep 2026): per record, a
/// check-in made outside the office radius (location-free members) shows the ADDRESS it was made at,
/// not the office the record is filed under; inside the radius it stays the office. Same rule as the
/// server (src/lib/attendance-place.ts) and the web. No T() here: the watch compiles this file too.
enum AttendancePlace {
    static func isAway(flag: Bool?, distance: Double?, radius: Double?) -> Bool? {
        if let flag { return flag }
        guard let distance, let radius else { return nil }
        return distance > radius
    }
    /// The first two comma parts of a reverse-geocoded address.
    static func shortAddress(_ address: String?) -> String? {
        guard let address else { return nil }
        let parts = address.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.prefix(2).joined(separator: ", ")
    }
    /// Away → the short address, else the coordinates; never the office name. nil when away with
    /// neither (callers then say "away from the office"). Not away → the office name.
    static func label(away: Bool?, address: String?, lat: Double?, lng: Double?, office: String?) -> String? {
        guard away == true else { return (office?.isEmpty == false) ? office : nil }
        if let a = shortAddress(address) { return a }
        if let lat, let lng { return String(format: "%.5f, %.5f", lat, lng) }
        return nil
    }
}

/// GET /api/attendance/history?scope=&month= — rows for the streak board.
struct AttendanceHistoryResponse: Decodable, Sendable {
    let rows: [AttendanceRow]?
    let records: [AttendanceRow]?
    /// Everyone the board lists, rows or not (workspace scope; servers from 28 Sep 2026). On the first
    /// day of a period most people have no row yet — without this the board showed a handful of names.
    let roster: [RosterEntry]?
    var all: [AttendanceRow] { rows ?? records ?? [] }
    /// `leftAt`: the last working day of someone who left (offboarded, 8 Oct 2026); nil otherwise.
    /// `owed` (servers from 13 Oct 2026): what this person's Score is out of — the same rule as the record.
    struct RosterEntry: Decodable, Sendable { let id: String; let name: String?; let dayOffQuota: Int?; let leftAt: String?; var owed: AttendanceOwed? = nil }
}

/// What an attendance Score is out of (server lib/attendance-score.ts, QA S-20, 13 Oct 2026): someone who
/// joined during the period owes only the days from their first day, with the day-off allowance prorated.
/// One rule for the crew board and the person record, so the two never disagree.
struct AttendanceOwed: Decodable, Sendable, Equatable {
    let days: Int
    let allowance: Int
    /// yyyy-MM-dd: the day they owe attendance from (the period's first day for everyone else).
    let from: String?
    /// Working days owed = days − allowance, never below 0.
    var working: Int { max(0, days - allowance) }
}
struct AttendanceRow: Decodable, Identifiable, Sendable {
    let id: String?
    let attendanceDate: String?
    let attendanceDayType: String?
    let status: String?
    let checkInAt: String?
    let checkOutAt: String?
    let user: UserRef?
    /// `dayOffQuota`: that person's weekly-rest quota (servers from 28 Sep 2026; absent → 4).
    /// `leftAt` (ISO): the last working day of someone who left the company (offboarding, 8 Oct
    /// 2026). The recaps keep them for the periods they were part of; nil for everyone else.
    struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String?; let dayOffQuota: Int?; let leftAt: String?; var owed: AttendanceOwed? = nil }
    var idv: String { id ?? ((user?.id ?? "") + (attendanceDate ?? "")) }

    // The rest of what the history endpoint has always sent and the board never read — the
    // evidence a BoD taps a cell to see: where, when, how late, and the selfies.
    let recordKind: String?            // ATTENDANCE | REQUEST | ABSENT
    let checkInStatus: String?
    let checkOutStatus: String?
    let lateMinutes: Int?
    let earlyLeaveMinutes: Int?
    let workedMinutes: Int?
    let checkInAddress: String?
    let checkOutAddress: String?
    let checkInPhotoUrl: String?
    let checkOutPhotoUrl: String?
    let checkInDistanceMeters: Double?
    let checkOutDistanceMeters: Double?
    /// Checked in outside the office radius (location-free); null on synthetic rows. 28 Sep 2026+.
    let checkInAway: Bool?
    let checkInLat: Double?
    let checkInLng: Double?
    let checkOutOffsite: Bool?
    let checkOutApproval: String?
    let checkOutReason: String?
    let notes: String?
    let isCorrected: Bool?
    let correctionReason: String?
    let officeLocation: OfficeRef?
    struct OfficeRef: Decodable, Sendable { let id: String?; let name: String?; let radiusMeters: Double? }
    let effectiveShiftStartTime: String?
    let effectiveShiftEndTime: String?
    let requestType: String?
    let requestStatus: String?
    let reviewedBy: UserRef?
    let supportingDocumentUrl: String?
    let supportingDocumentName: String?
    /// "denied" when the person refused Always location for this record — drawn as a "location
    /// off" badge so an empty trail is not mistaken for a day spent inside. Optional (0.1.6).
    let locationTrackingState: String?
    /// Start of the outside-the-office episode the person is in right now, while the record is open;
    /// null inside, after check-out and on synthetic rows. Absent from older servers. Only TODAY's
    /// open record means "outside right now": the crew board marks that one cell (owner, 8 Oct 2026;
    /// the web board applies the same test).
    let outsideSince: String?

    /// Files are served by the API behind the session cookie; a relative path needs the base.
    static func fileURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path)
    }
}

extension AttendanceRow {
    /// true = this day's check-in was made away from the office; nil = unknown / no check-in.
    var checkedInAway: Bool? {
        guard checkInAt != nil else { return nil }
        return AttendancePlace.isAway(flag: checkInAway, distance: checkInDistanceMeters, radius: officeLocation?.radiusMeters)
    }
    /// "Which office" for this day: the short check-in address when away, else the office name.
    var placeLabel: String? {
        AttendancePlace.label(away: checkedInAway, address: checkInAddress, lat: checkInLat, lng: checkInLng,
                              office: officeLocation?.name)
    }

    /// A stand-in for a board cell the server sent no row for (a workday with nothing on it), so a
    /// BoD can still open the day and set its status. Built through the decoder because the row is
    /// Decodable-only; every other field stays nil. `recordKind` "EMPTY" tells the sheet what it is.
    static func emptyDay(userId: String, name: String, dateKey: String) -> AttendanceRow? {
        let json: [String: Any] = [
            "attendanceDate": dateKey,
            "recordKind": "EMPTY",
            "user": ["id": userId, "name": name],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return nil }
        return try? JSONDecoder().decode(AttendanceRow.self, from: data)
    }
}

/// POST /api/attendance/override — the BoD's "Change status" on one member-day.
struct AttendanceOverrideResponse: Decodable, Sendable {
    let ok: Bool?
    let action: String?
    let date: String?
    /// True when a penalty (XP and/or an auto-cut day-off) was actually refunded.
    let refunded: Bool?
    let alreadyCovered: Bool?
    let closedAttendance: Int?
    /// PRESENT only: multi-day requests still covering this date (left alone on purpose).
    let multiDayRequestsLeft: Int?
}

/// GET /api/attendance/requests?scope= — leave/sick/permit/day-off/red-date requests.
/// Response is either `{requests:[…]}` or a bare array.
struct AttendanceRequestsResponse: Decodable, Sendable {
    let requests: [AttendanceRequest]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([AttendanceRequest].self) { requests = arr }
        else if let c = try? decoder.container(keyedBy: K.self), let r = try? c.decode([AttendanceRequest].self, forKey: .requests) { requests = r }
        else { requests = [] }
    }
    enum K: String, CodingKey { case requests }
}
struct AttendanceRequest: Decodable, Identifiable, Sendable {
    let id: String
    /// Who filed it. `serializeAttendanceRequest` has always sent this; nothing decoded it, which
    /// is why the watch drew Approve/Reject on the reviewer's OWN requests and the server answered
    /// 403 SELF_REVIEW. Optional so a reply from a server that predates this still decodes.
    let userId: String?
    let type: String?
    let status: String?
    let reason: String?
    let startDate: String?
    let endDate: String?
    let user: UserRef?
    /// The sick note / permit evidence, already carried by this very endpoint
    /// (`serializeAttendanceRequest` in src/lib/attendance.ts). The app uploaded these and then
    /// never showed one back, which left a reviewer approving a sick day they could not look at.
    let supportingDocumentUrl: String?
    let supportingDocumentName: String?
    /// The approver's reason, and who gave it. Both have always been in this endpoint's payload
    /// (`serializeAttendanceRequest`); the app decoded neither, so a rejected request showed the
    /// requester a red chip and nothing whatsoever about why.
    let reviewNote: String?
    let reviewedBy: UserRef?
    /// When it was decided. In this payload all along, like the two above it, and read for the
    /// same kind of reason: it is what puts a settled row where the person who settled it will look
    /// for it. See `SubmissionEntry.decidedKey`.
    let reviewedAt: String?
    /// "ADMIN" when the row was written by something other than a review screen — including the
    /// nightly penalty cron. Only meaningful together with `reviewedBy`; see `isAutoDeduction`.
    let approvalSource: String?
    /// Last write to the row. Read for one reason: withdrawing your own request is not a review, so
    /// it leaves `reviewedAt` empty, and this is then the only record of when it was withdrawn —
    /// which is what the Canceled chip's date window has to go on. Optional like its neighbours.
    let updatedAt: String?
    struct UserRef: Decodable, Sendable { let name: String? }

    /// The nightly cron's own penalty row, NOT something a person filed: ">120 min late" and
    /// "no check-in/out" both land as an APPROVED DAY_OFF that eats a day-off token. Mirrors
    /// `isAutoDeduction` in src/lib/attendance-absence.ts exactly — the three conditions together,
    /// because a real admin-granted day-off also has `approvalSource == "ADMIN"` and would be
    /// swallowed by the reason prefix alone.
    ///
    /// The server filters these out of the requests list; this is the same test on our side, so a
    /// build running against a server that predates that filter (or a scope it does not cover) does
    /// not put penalties back into a list of things people asked for.
    var isAutoDeduction: Bool {
        (approvalSource ?? "") == "ADMIN" && reviewedBy == nil && (reason ?? "").hasPrefix("Auto:")
    }

    /// The note, or nil when there is nothing to read. The column is nullable AND the route writes
    /// `trim() || null`, but a note typed on an older client can still arrive as whitespace.
    var reviewNoteText: String? {
        let t = (reviewNote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// Who to credit for `reviewNoteText`, or nil when nobody wrote it. The cron leaves
    /// `reviewedById` null and still writes a note ("Auto-deducted: bolos …"), so a note is only
    /// the approver's word when there is an approver to attach it to.
    /// True when the signed-in person filed this themselves, and therefore may not decide it.
    /// The four-eyes rule lives on the server and stays there — this only stops the app from
    /// offering a button whose only possible outcome is a refusal.
    func isOwn(viewerId: String?) -> Bool {
        guard let viewerId, !viewerId.isEmpty, let userId else { return false }
        return userId == viewerId
    }

    var reviewerName: String? {
        let n = (reviewedBy?.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? nil : n
    }

    /// Absolute URL for the attachment. The server hands out an app-relative path, and the route
    /// behind it (`/api/files/...`) refuses anyone without the session cookie — so it can only be
    /// fetched through the app's own image loader, never handed to Safari.
    var attachmentURL: URL? {
        guard let path = supportingDocumentUrl, !path.isEmpty else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path)
    }

    // Whether the attachment is a picture or a document is decided where it is drawn
    // (`RequestAttachmentView` in AttendanceRequestsView.swift), on the phone's own
    // `AttachmentKind` — this file is also compiled into the watch, which has neither.
}

/// GET /api/attendance/offsite-checkouts?status=ALL — check-outs taken outside the office geofence,
/// held for BoD approval. Shape mirrors the web review row: approval / user / attendanceDate /
/// checkOutAt / reason / distanceMeters / officeName / lat / lng / photoUrl / approverName.
struct OffsiteCheckout: Decodable, Identifiable, Sendable {
    let id: String
    let approval: String?           // PENDING | APPROVED | REJECTED
    let attendanceDate: String?
    let checkOutAt: String?
    let reason: String?
    /// Reverse-geocoded street address of the check-out point. A reviewer deciding this reads a
    /// place name far faster than "±420 m", and the map link is a whole context switch away.
    let address: String?
    let distanceMeters: Double?
    let officeName: String?
    let lat: Double?
    let lng: Double?
    let photoUrl: String?
    let approverName: String?
    /// When the BoD decided. The offsite half of `AttendanceRequest.reviewedAt`.
    let approvedAt: String?
    let user: UserRef?

    struct UserRef: Decodable, Sendable { let id: String?; let name: String? }

    var isPending: Bool { (approval ?? "").uppercased() == "PENDING" }
    /// Same link the web offers ("view map") so a reviewer can check where the person actually was.
    var mapURL: URL? {
        guard let lat, let lng else { return nil }
        return URL(string: "https://www.google.com/maps?q=\(lat),\(lng)")
    }
}

struct OffsiteCheckoutsResponse: Decodable, Sendable { let items: [OffsiteCheckout]? }

/// Outcome of a check-in/out attempt.
enum AttendanceOutcome: Sendable {
    case success
    case outsideRadius          // checkout from beyond the office geofence → needs a reason
}


// MARK: - Compact days (watch faces, widgets, the crew board on the wrist)

/// One person-day from `/api/attendance/history?compact=1`. The server decides the tone so every
/// surface colours a day the same way: P present, L late, I permit, C leave, S sick, D day off,
/// A absent, "" nothing recorded.
struct AttendanceCompactDay: Decodable, Hashable, Sendable {
    let userId: String?
    let name: String?
    let date: String
    let tone: String
    let checkInAt: String?
    let checkOutAt: String?
    let lateMinutes: Int?
    let kind: String?

    var label: String {
        switch tone {
        case "P": return "Present"
        case "L": return lateMinutes.map { "Late \($0) min" } ?? "Late"
        case "I": return "Permit"
        case "C": return "Leave"
        case "S": return "Sick"
        case "D": return "Day off"
        case "A": return "Absent"
        default:  return "No record"
        }
    }
}
struct AttendanceCompactResponse: Decodable, Sendable { let records: [AttendanceCompactDay] }

/// POST /api/attendance/location-trail reply. Lenient: every field optional, because the one that
/// matters (`tracking`) must be read as "carry on" unless the server explicitly says stop.
struct LocationTrailPostReply: Decodable, Sendable {
    let ok: Bool?
    let tracking: Bool?
    let outsideSince: String?
    let stage: String?
    let nextAt: String?
}
