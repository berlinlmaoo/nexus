import Foundation

#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit

/// Starts, updates and ends the work-session Live Activity.
///
/// Driven by the snapshot, never by a tap. Starting it inside the check-in button would leave the
/// Island lying in three ordinary cases: a check-in made on the web, a queued tap that lands
/// minutes later, and a check-out that fails after the button was pressed. `AttendancePresence`
/// owns the state; this file only draws conclusions from it.
@MainActor
enum LiveActivityController {

    static func apply(_ snapshot: AttendanceSnapshot, userName: String) {
        // Somebody who has switched Live Activities off in Settings gets nothing, silently. That is
        // their decision, not an error worth surfacing anywhere.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let working = snapshot.checkInAt != nil && snapshot.checkOutAt == nil

        // Not at work and nothing in flight: there is nothing to show.
        guard working || snapshot.isPending else {
            Task { await endAll() }
            return
        }

        let state = WorkSessionAttributes.ContentState(
            checkInAt: working ? snapshot.checkInAt : nil,
            queuedSince: snapshot.queuedSince,
            pendingCount: snapshot.pendingCount,
            officeName: snapshot.officeName,
            expectedOutAt: snapshot.expectedOutAt
        )
        Task { await push(state, userName: userName) }
    }

    static func stop() {
        Task { await endAll() }
    }

    // MARK: - ActivityKit

    private static func push(_ state: WorkSessionAttributes.ContentState, userName: String) async {
        let content = ActivityContent(state: state, staleDate: nil)
        if let existing = Activity<WorkSessionAttributes>.activities.first {
            await existing.update(content)
        } else {
            // A refused request (too many activities, or the setting flipped between the check above
            // and here) is not worth reporting: the app works exactly as before without it.
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
}

#else

/// Mac Catalyst has no ActivityKit. The call site stays identical rather than sprouting its own
/// `#if`, which is how one platform quietly ends up with different attendance logic.
@MainActor
enum LiveActivityController {
    static func apply(_ snapshot: AttendanceSnapshot, userName: String) {}
    static func stop() {}
}

#endif
