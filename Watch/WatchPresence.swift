import Foundation
import WidgetKit

/// What the watch app knows about attendance, handed to its complication.
///
/// The same `AttendanceSnapshot` the phone writes for its widgets, written here by the watch app
/// into the watch's own shared container. The complication never talks to the API; it draws this.
@MainActor
enum WatchPresence {
    static func publish(today: AttendanceToday?, recent: [AttendanceCompactDay]) {
        let record = today?.today
        let checkInAt = parseISO(record?.checkInAt)
        let snapshot = AttendanceSnapshot(
            dateKey: AttendanceSnapshot.currentDateKey(),
            checkInAt: checkInAt,
            checkOutAt: parseISO(record?.checkOutAt),
            // The day's place: the address when checked in away from the office (location-free).
            officeName: record?.placeLabel,
            expectedOutAt: expectedOut(from: checkInAt, shift: today?.myShift),
            recentDays: recent.sorted { $0.date < $1.date }.suffix(7).map { .init(dateKey: $0.date, tone: $0.tone) },
            pendingCount: 0,
            queuedSince: nil,
            updatedAt: Date()
        )
        snapshot.save()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Signing out on the phone signs the watch out; the face must not keep showing that person.
    static func clear() {
        AttendanceSnapshot.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func parseISO(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: iso) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Same rule as the phone: Flexi ends nine hours after check-in; a fixed shift ends at its time.
    private static func expectedOut(from start: Date?, shift: AttendanceToday.Shift?) -> Date? {
        guard let start, let shift else { return nil }
        if shift.flexi == true { return start.addingTimeInterval(9 * 3600) }
        let parts = shift.endTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: start)
        comps.hour = parts[0]; comps.minute = parts[1]
        guard let end = Calendar.current.date(from: comps) else { return nil }
        return end > start ? end : end.addingTimeInterval(24 * 3600)
    }
}
