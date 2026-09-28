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

        var state = WorkSessionAttributes.ContentState(
            checkInAt: working ? snapshot.checkInAt : nil,
            queuedSince: snapshot.queuedSince,
            pendingCount: snapshot.pendingCount,
            officeName: snapshot.officeName,
            expectedOutAt: snapshot.expectedOutAt
        )
        // Rebuilt from the snapshot, so the outside-the-office half would be lost on every refresh
        // unless it is carried over from what the tracker last said.
        stamp(&state, outside: working ? outside : .inside)
        lastSent = state
        Task { await push(state, userName: userName) }
    }

    /// The outside-the-office state the tracker last published. Carried into every `apply`.
    private static var outside = WorkOutsideStatus.inside

    /// From WorkLocationTracker, on every fix, tick, crossing, trail reply and attendance refresh —
    /// in the background too, which is where it matters: the tracker runs continuous location while
    /// outside, and this is how the Island hears about it without a push.
    ///
    /// ActivityKit rations updates, so one is spent only when what the Island draws would change: a
    /// new stage (outside → reminded at 1h30 → warned at 2h, or back to normal), or a new start /
    /// check-out time. The countdown between those is `Text(timerInterval:)`, run by the system.
    static func updateOutside(_ status: WorkOutsideStatus) {
        outside = status
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              let activity = Activity<WorkSessionAttributes>.activities.first else { return }
        // Built on the last state this process sent — `activity.content` may not show it yet, the
        // update being asynchronous, and building on it would undo a refresh made a moment ago.
        // Only a process that has sent nothing yet (iOS relaunched it in the background for a
        // region crossing) reads what the activity shows, so a stale "outside" left there by the
        // previous process is still cleared.
        var state = lastSent ?? activity.content.state
        let shown = WorkOutsideStatus(
            stage: WorkOutsideStatus.Stage(rawValue: (state.stage ?? .inside).rawValue) ?? .inside,
            outsideSince: state.outsideSince,
            autoCheckoutAt: state.autoCheckoutAt)
        let wanted = state.startedAt == nil ? WorkOutsideStatus.inside : status
        guard !wanted.sameForDisplay(as: shown) || state.lang != currentLang else { return }
        stamp(&state, outside: wanted)
        lastSent = state
        // Looked up again inside the task rather than captured: the same shape as `push`, and an
        // activity that ended in between is simply not there to update.
        Task {
            await Activity<WorkSessionAttributes>.activities.first?.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    /// The last content state handed to ActivityKit by this process.
    private static var lastSent: WorkSessionAttributes.ContentState?

    private static var currentLang: String { AppLanguage.shared.lang.rawValue }

    private static func stamp(_ state: inout WorkSessionAttributes.ContentState, outside status: WorkOutsideStatus) {
        let out = status.stage != .inside
        state.stage = out ? WorkSessionAttributes.ContentState.OutsideStage(rawValue: status.stage.rawValue) : nil
        state.outsideSince = out ? status.outsideSince : nil
        state.autoCheckoutAt = out ? status.autoCheckoutAt : nil
        state.lang = currentLang
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
        lastSent = nil
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
    static func updateOutside(_ status: WorkOutsideStatus) {}
    static func stop() {}
}

#endif
