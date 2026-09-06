import Foundation

#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit

/// Starts, updates and ends the work-session Live Activity.
///
/// Deliberately driven by STATE, not by taps. Starting the activity inside the check-in button
/// would leave the Island lying in three ordinary situations: a check-in made on the web, a queued
/// tap that lands minutes later, and a check-out that fails after the button was pressed. Every
/// path that can change attendance ends up calling `refresh`, so the Island can only ever show what
/// the app itself believes.
@MainActor
enum LiveActivityController {

    /// The last attendance payload seen. Kept so the queue — which knows nothing about shifts or
    /// offices — can trigger a refresh without having to fetch anything.
    private static var lastToday: AttendanceToday?
    private static var userName = ""

    /// Call whenever attendance truth might have moved: after a load, after a check-in or
    /// check-out, and after the offline queue drains. Cheap and idempotent.
    static func refresh(today: AttendanceToday? = nil, userName name: String? = nil) {
        if let today { lastToday = today }
        if let name, !name.isEmpty { userName = name }

        // Someone who has switched Live Activities off in Settings gets nothing, silently. That is
        // their decision, and it is not an error worth surfacing anywhere.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let record = lastToday?.today
        let working = record?.hasCheckedIn == true && record?.hasCheckedOut == false
        let queue = AttendanceQueue.shared.pending
        let queuedCheckIn = queue.first { $0.kind == .checkIn }

        // Not at work and nothing in flight: there is nothing to show.
        guard working || !queue.isEmpty else {
            Task { await endAll() }
            return
        }

        let confirmedIn = working ? parseISO(record?.checkInAt) : nil
        let start = confirmedIn ?? queuedCheckIn?.deviceAt

        let state = WorkSessionAttributes.ContentState(
            checkInAt: confirmedIn,
            queuedSince: queuedCheckIn?.deviceAt,
            pendingCount: queue.count,
            officeName: record?.officeLocation?.name,
            expectedOutAt: expectedOut(from: start, shift: lastToday?.myShift)
        )
        Task { await push(state) }
    }

    /// A session that ends with the app must not leave a Live Activity behind on the Lock Screen —
    /// it would keep counting somebody else's hours on a phone that has been handed over.
    static func stop() {
        lastToday = nil
        Task { await endAll() }
    }

    // MARK: - ActivityKit

    private static func push(_ state: WorkSessionAttributes.ContentState) async {
        let content = ActivityContent(state: state, staleDate: nil)
        if let existing = Activity<WorkSessionAttributes>.activities.first {
            await existing.update(content)
        } else {
            // A refused request (too many activities, or the setting flipped between the check
            // above and here) is not worth reporting: the app works exactly as before without it.
            _ = try? Activity.request(
                attributes: WorkSessionAttributes(userName: userName),
                content: content,
                pushType: nil
            )
        }
    }

    private static func endAll() async {
        for activity in Activity<WorkSessionAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    // MARK: - helpers

    /// The API sends fractional seconds on some routes and not on others; both have to parse or the
    /// Island silently loses its clock.
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
    /// the same rule the attendance screen shows.
    private static func expectedOut(from start: Date?, shift: AttendanceToday.Shift?) -> Date? {
        guard let start, let shift else { return nil }
        if shift.flexi == true { return start.addingTimeInterval(9 * 3600) }

        let parts = shift.endTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: start)
        comps.hour = parts[0]
        comps.minute = parts[1]
        guard let end = Calendar.current.date(from: comps) else { return nil }
        // A shift whose end time is earlier in the day than the check-in finishes tomorrow.
        return end > start ? end : end.addingTimeInterval(24 * 3600)
    }
}

#else

/// Mac Catalyst has no ActivityKit. The call sites stay identical rather than sprouting their own
/// `#if` blocks, which is how one platform quietly ends up with different attendance logic.
@MainActor
enum LiveActivityController {
    static func refresh(today: AttendanceToday? = nil, userName name: String? = nil) {}
    static func stop() {}
}

#endif
