import Foundation

// ActivityKit does not exist on macOS, and a Mac Catalyst build that imports it fails to compile
// rather than degrading. The guard is here rather than around the call sites so the app, the widget
// extension and the Mac build can all read the same file.
#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit

/// The work session as the Dynamic Island and the Lock Screen see it.
///
/// Shared verbatim between the app (which starts and updates it) and the widget extension (which
/// draws it). ActivityKit encodes ContentState across a process boundary, so both targets must
/// compile the SAME declaration — a field added on one side only decodes to nothing on the other,
/// silently, with the Island simply showing stale values.
struct WorkSessionAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Check-in the server has confirmed. Nil while the only thing that exists is a queued tap.
        var checkInAt: Date?

        /// When a queued check-in was tapped. This is the time the person will be credited with, so
        /// it is the time the Island counts from — not the moment the queue happens to drain.
        var queuedSince: Date?

        /// Taps still waiting for a reachable server. Zero once everything has landed.
        var pendingCount: Int

        var officeName: String?

        /// Filled for a fixed shift. Nil on Flexi, where the end is derived from the check-in.
        var expectedOutAt: Date?

        /// The clock the Island counts from: the confirmed check-in if there is one, otherwise the
        /// queued tap. Nil only in the moment before the first state arrives.
        var startedAt: Date? { checkInAt ?? queuedSince }

        /// True while the server has not yet acknowledged everything. The Island says so plainly:
        /// somebody who tapped at 09:00 with no signal needs to see that it is still on its way,
        /// not a screen that looks identical to a confirmed check-in.
        var isPending: Bool { pendingCount > 0 }

        /// A queued check-in with nothing confirmed behind it. Drawn differently from a confirmed
        /// session that merely has a check-out waiting to send.
        var isUnconfirmed: Bool { checkInAt == nil && queuedSince != nil }
    }

    /// Fixed for the life of the activity.
    var userName: String
}
#endif
