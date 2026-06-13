import Foundation

/// GET /api/attendance/today — only the fields the native screen needs (lenient/optional).
struct AttendanceToday: Decodable, Sendable {
    let attendanceDateKey: String?
    let activeOfficeCount: Int?
    let today: AttendanceRecord?
    let pendingCheckout: AttendanceRecord?
    let myShift: Shift?

    struct Shift: Decodable, Sendable {
        let startTime: String
        let endTime: String
        let source: String
    }
}

struct AttendanceRecord: Decodable, Sendable {
    let id: String
    let status: String?
    let checkInAt: String?
    let checkOutAt: String?
    let lateMinutes: Int?
    let checkOutApproval: String?   // PENDING | APPROVED | REJECTED | null

    var hasCheckedIn: Bool { checkInAt != nil }
    var hasCheckedOut: Bool { checkOutAt != nil }
}

/// Outcome of a check-in/out attempt.
enum AttendanceOutcome: Sendable {
    case success
    case outsideRadius          // checkout from beyond the office geofence → needs a reason
}
