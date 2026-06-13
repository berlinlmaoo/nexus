import Foundation

/// GET /api/attendance/today — only the fields the native screen needs (lenient/optional).
struct AttendanceToday: Decodable, Sendable {
    let attendanceDateKey: String?
    let activeOfficeCount: Int?
    let canManageAttendance: Bool?
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

/// Outcome of a check-in/out attempt.
enum AttendanceOutcome: Sendable {
    case success
    case outsideRadius          // checkout from beyond the office geofence → needs a reason
}
