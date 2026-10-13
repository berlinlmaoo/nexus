import Foundation
import WidgetKit

/// The single funnel between "what the app knows about attendance" and everything outside the app
/// that shows it: the Dynamic Island, the Lock Screen, and the Home Screen widgets.
///
/// One funnel rather than three call sites per surface. Adding a surface later means adding a line
/// here, not hunting for every place attendance can change — which is how one of them ends up stale
/// and nobody notices for a week.
@MainActor
enum AttendancePresence {

    /// The last attendance payload seen. Kept so the offline queue — which knows nothing about
    /// shifts or offices — can trigger a refresh without fetching anything.
    private static var lastToday: AttendanceToday?
    private static var userName = ""

    /// Call whenever attendance truth might have moved: after a load, after a check-in or
    /// check-out, and after the queue drains. Cheap and idempotent.
    /// The dots the widget draws. Fetched by the Attendance screen after it loads today; kept here
    /// so every later `refresh()` (a queue change, a check-in) carries them along.
    private static var lastRecent: [AttendanceSnapshot.DayDot]?
    static func updateRecent(_ days: [AttendanceCompactDay]) {
        lastRecent = days.sorted { $0.date < $1.date }.suffix(7).map { .init(dateKey: $0.date, tone: $0.tone) }
        refresh()
    }

    /// `heardAt`: when the server gave `today` — pass the save time when it is a copy restored from
    /// the offline cache. Defaults to now for a live answer.
    static func refresh(today: AttendanceToday? = nil, userName name: String? = nil, heardAt: Date? = nil) {
        if let today { lastToday = today }
        if let name, !name.isEmpty { userName = name }

        let record = lastToday?.today
        let queue = AttendanceQueue.shared.pending
        let queuedCheckIn = queue.first { $0.kind == .checkIn }

        let checkInAt = parseISO(record?.checkInAt)
        let checkOutAt = parseISO(record?.checkOutAt)
        let start = checkInAt ?? queuedCheckIn?.deviceAt

        let snapshot = AttendanceSnapshot(
            dateKey: AttendanceSnapshot.currentDateKey(),
            checkInAt: checkInAt,
            checkOutAt: checkOutAt,
            // The day's place: the address when checked in away from the office (location-free).
            // Checked in and now standing in an office (possibly not the record's): that office.
            officeName: (WorkPlace.shared.recordId != nil && WorkPlace.shared.recordId == record?.id
                         ? WorkPlace.shared.officeName : nil) ?? record?.placeLabel,
            expectedOutAt: expectedOut(from: start, shift: lastToday?.myShift),
            recentDays: lastRecent,
            pendingCount: queue.count,
            queuedSince: queuedCheckIn?.deviceAt,
            updatedAt: Date()
        )

        snapshot.save()
        WidgetCenter.shared.reloadAllTimelines()
        LiveActivityController.apply(snapshot, userName: userName)
        // The work-hours location trail follows the same truth as the Island: it starts on a
        // check-in the server holds (live, replayed from the queue, or found on launch) and stops on
        // a check-out — including one still waiting in the queue, which the tracker reads itself.
        WorkLocationTracker.shared.sync(today: lastToday)
        // Only an answer from the server, not the remembered one: the outside clock's start and an
        // approved excuse for today, for the Live Activity's "outside the office" state.
        if let today { WorkLocationTracker.shared.heard(today: today, at: heardAt ?? Date()) }
    }

    /// A workday is running on this phone: checked in (live, or a check-in still queued) and not
    /// checked out, not even offline. Signing out then is refused (owner, 28 Sep 2026): logout stops
    /// the live location and wipes the queue, leaving a day nobody can close from this phone.
    static var workdayOpen: Bool {
        let queue = AttendanceQueue.shared.pending
        if queue.contains(where: { $0.kind == .checkOut }) { return false }
        if queue.contains(where: { $0.kind == .checkIn }) { return true }
        // Before today has been fetched this launch, the tracker restored from disk still knows.
        guard let rec = lastToday?.today else { return WorkLocationTracker.shared.isTracking }
        return rec.hasCheckedIn && !rec.hasCheckedOut
    }

    /// Logging out has to erase every trace outside the app. A widget left showing one person's
    /// hours, or a Live Activity still counting them, survives on a phone handed to somebody else.
    static func stop() {
        lastToday = nil
        userName = ""
        AttendanceSnapshot.clear()
        // The glance is the other half of what outlives the session — tasks, unread count, XP and
        // level. Erased here rather than in its own writer so there is ONE place that has to be
        // right about logging out, which is the only way it stays right.
        NexusGlance.clear()
        // And the calendar widgets' snapshots — every scope.
        CalendarWidgetPresence.stop()
        WidgetCenter.shared.reloadAllTimelines()
        LiveActivityController.stop()
    }

    // MARK: - helpers

    /// The API sends fractional seconds on some routes and not on others; both have to parse or the
    /// clock silently disappears.
    private static func parseISO(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: iso) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// When this shift is expected to end. Flexi has no fixed end — it is check-in plus nine hours,
    /// the same rule the attendance screen states.
    private static func expectedOut(from start: Date?, shift: AttendanceToday.Shift?) -> Date? {
        guard let start, let shift else { return nil }
        if shift.flexi == true { return start.addingTimeInterval(9 * 3600) }

        let parts = shift.endTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: start)
        comps.hour = parts[0]
        comps.minute = parts[1]
        guard let end = Calendar.current.date(from: comps) else { return nil }
        // A shift whose end time falls earlier in the day than the check-in finishes tomorrow.
        return end > start ? end : end.addingTimeInterval(24 * 3600)
    }
}
