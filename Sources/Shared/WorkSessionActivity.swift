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

        // Outside the office (work-hours location, 0.1.6). All optional, and decoded leniently
        // below: a state encoded by a build without them — or carrying a stage this build does not
        // know — must still decode, as the normal session look, rather than drop the whole update.

        /// Where the outside-the-office clock stands. Mirrors WorkOutsideStatus.Stage in the app.
        enum OutsideStage: String, Codable, Hashable { case inside, outside, reminded, warned }

        /// Start of the episode, as the server's pushes quote it ("di luar kantor sejak 20:59").
        var outsideSince: Date? = nil
        /// When the server will check the person out offsite if nothing changes. The countdown. Nil
        /// while the server's automatic check-out is switched off (remote config, off since 8 Oct
        /// 2026): the outside look stays, with no check-out time and nothing counting down.
        var autoCheckoutAt: Date? = nil
        /// Nil or `.inside`: the normal session look.
        var stage: OutsideStage? = nil
        /// The app's language ("en" / "id"). The extension cannot read the app's own UserDefaults,
        /// where the in-app language switch lives, so it travels with the state. Nil = English.
        var lang: String? = nil

        /// Outside the office, with or without a countdown (`autoCheckoutAt`). A queued tap still in
        /// flight takes precedence (`isPending`): that is the more urgent thing to know.
        var isOutside: Bool {
            guard let stage, stage != .inside, outsideSince != nil else { return false }
            return !isPending
        }

        enum CodingKeys: String, CodingKey {
            case checkInAt, queuedSince, pendingCount, officeName, expectedOutAt
            case outsideSince, autoCheckoutAt, stage, lang
        }
    }

    /// Fixed for the life of the activity.
    var userName: String
}

extension WorkSessionAttributes.ContentState {
    /// Written out so the fields added later are read with `decodeIfPresent` and a stage this build
    /// does not know is read as nil, never as a failure. Kept in an extension so the memberwise
    /// initialiser the app uses still exists.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checkInAt = try c.decodeIfPresent(Date.self, forKey: .checkInAt)
        queuedSince = try c.decodeIfPresent(Date.self, forKey: .queuedSince)
        pendingCount = try c.decodeIfPresent(Int.self, forKey: .pendingCount) ?? 0
        officeName = try c.decodeIfPresent(String.self, forKey: .officeName)
        expectedOutAt = try c.decodeIfPresent(Date.self, forKey: .expectedOutAt)
        outsideSince = try? c.decodeIfPresent(Date.self, forKey: .outsideSince)
        autoCheckoutAt = try? c.decodeIfPresent(Date.self, forKey: .autoCheckoutAt)
        stage = (try? c.decodeIfPresent(String.self, forKey: .stage)).flatMap(OutsideStage.init(rawValue:))
        lang = try? c.decodeIfPresent(String.self, forKey: .lang)
    }
}
#endif
