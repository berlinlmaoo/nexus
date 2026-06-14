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

    struct Shift: Decodable, Sendable {
        let startTime: String
        let endTime: String
        let source: String
    }
    struct TodayRequest: Decodable, Sendable { let type: String?; let status: String? }
}

struct AttendanceRecord: Decodable, Sendable {
    let id: String
    let status: String?
    let checkInAt: String?
    let checkOutAt: String?
    let lateMinutes: Int?
    let checkOutApproval: String?   // PENDING | APPROVED | REJECTED | null
    let officeLocation: OfficeRef?

    struct OfficeRef: Decodable, Sendable { let name: String? }

    var hasCheckedIn: Bool { checkInAt != nil }
    var hasCheckedOut: Bool { checkOutAt != nil }
}

/// GET /api/attendance/history?scope=&month= — rows for the streak board.
struct AttendanceHistoryResponse: Decodable, Sendable {
    let rows: [AttendanceRow]?
    let records: [AttendanceRow]?
    var all: [AttendanceRow] { rows ?? records ?? [] }
}
struct AttendanceRow: Decodable, Identifiable, Sendable {
    let id: String?
    let attendanceDate: String?
    let attendanceDayType: String?
    let status: String?
    let checkInAt: String?
    let user: UserRef?
    struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    var idv: String { id ?? ((user?.id ?? "") + (attendanceDate ?? "")) }
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
    let type: String?
    let status: String?
    let reason: String?
    let startDate: String?
    let endDate: String?
    let user: UserRef?
    struct UserRef: Decodable, Sendable { let name: String? }
}

/// Outcome of a check-in/out attempt.
enum AttendanceOutcome: Sendable {
    case success
    case outsideRadius          // checkout from beyond the office geofence → needs a reason
}
