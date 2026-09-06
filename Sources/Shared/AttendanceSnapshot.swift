import Foundation

/// The one description of "where attendance stands right now", written by the app and read by the
/// widgets and the Live Activity.
///
/// Foundation only, on purpose: this file is compiled into the widget extension, which must not
/// drag in the app's UIKit appearance work or its networking.
struct AttendanceSnapshot: Codable, Hashable {
    /// The day this describes, stamped locally at write time.
    ///
    /// Deliberately NOT the server's `attendanceDateKey`. Comparing against a string whose format
    /// belongs to somebody else means a format change turns every widget permanently stale, with
    /// nothing in the app to explain why. Ours is compared against a value produced by the same
    /// function, so it can only ever disagree about the actual day.
    var dateKey: String

    var checkInAt: Date?
    var checkOutAt: Date?
    var officeName: String?
    /// Filled for a fixed shift; nil on Flexi, where the end follows from the check-in.
    var expectedOutAt: Date?

    /// Taps still waiting for a reachable server.
    var pendingCount: Int
    /// When a queued check-in was tapped — the time the person will be credited with.
    var queuedSince: Date?

    var updatedAt: Date

    var isPending: Bool { pendingCount > 0 }

    // MARK: - what a widget should draw

    /// Refuses to answer for a day other than the one it describes.
    ///
    /// A widget only updates while the app runs. Without this, someone who checked out at 18:00 and
    /// did not open NEXUS again would see "Done 18:00" on their Home Screen all through the next
    /// morning — a confident, wrong answer. `stale` says "open me" instead, which is true.
    enum State: Hashable {
        case stale
        case notCheckedIn
        case working(since: Date)
        case done(at: Date)
    }

    func state(today: String = AttendanceSnapshot.currentDateKey()) -> State {
        guard dateKey == today else { return .stale }
        if let out = checkOutAt { return .done(at: out) }
        if let start = checkInAt ?? queuedSince { return .working(since: start) }
        return .notCheckedIn
    }

    // MARK: - storage

    /// Shared with the widget extension. Absent on Mac Catalyst by design — nothing reads it there,
    /// and declaring it would pull in the team-prefixed macOS form of the group for no benefit.
    static let appGroup = "group.id.znetworks.nexus"
    private static let key = "attendance.snapshot"

    static func currentDateKey(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }

    static func load() -> AttendanceSnapshot? {
        guard let store = UserDefaults(suiteName: appGroup),
              let data = store.data(forKey: key)
        else { return nil }
        return try? JSONDecoder().decode(AttendanceSnapshot.self, from: data)
    }

    func save() {
        // A nil suite is normal, not an error: it is what Mac Catalyst sees.
        guard let store = UserDefaults(suiteName: Self.appGroup),
              let data = try? JSONEncoder().encode(self)
        else { return }
        store.set(data, forKey: Self.key)
    }

    static func clear() {
        UserDefaults(suiteName: appGroup)?.removeObject(forKey: key)
    }
}
