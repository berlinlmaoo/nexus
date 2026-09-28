import Foundation

// The decision half of "live location while checked in", with no CoreLocation, no UIKit and no
// network in it. WorkLocationTracker owns the location manager and the uploads; everything it has
// to DECIDE — are we inside or outside, is a point due, what goes into the next request, when do we
// give up — lives here as plain values, so it can be run and checked with nothing but Foundation.
//
// The rules it encodes are the owner's, and they are narrow on purpose:
//   • only between a check-in that the server has accepted and the check-out — nothing before,
//     nothing after, ever;
//   • while inside the office (owner, 25 Sep 2026): one "presence" check about once an hour, so the
//     day shows that the person stayed, not only when they left. No continuous GPS: between checks
//     only a coarse, cell/Wi-Fi-level stream runs, whose job is to keep the app alive for the next
//     check; the check itself raises the accuracy for one fix and drops it again;
//   • while outside (owner, 28 Sep 2026), the route itself: a point every time the phone has moved
//     50 m from the last one (never more often than every 10 s, so a car does not send one every
//     few seconds), and a heartbeat every 5 minutes while it stands still — only from fixes good to
//     65 m. Plus one immediately on leaving and on coming back. Uploads are batched, at most about
//     every 2 minutes, except the exit and the enter, which go at once. No presence checks outside:
//     the route already says where the phone is;
//   • leaving is announced on the phone itself at once, and again an hour in, each with the time
//     left before the automatic check-out (planOutsideAlerts); the server's 1h30 / 2h pushes follow;
//   • the server has the last word: `tracking:false` stops everything.

/// The office circle a check-in was made against.
struct WorkTrailFence: Codable, Equatable {
    let lat: Double
    let lng: Double
    let radius: Double
}

/// One position that is going to, or already went to, the server.
struct WorkTrailPoint: Codable, Equatable {
    /// `presence`: the hourly "still here" check while inside (or before the zone is known).
    /// Servers older than the presence change store it as a plain point, which is also true.
    enum Event: String, Codable { case exit, enter, point, presence }

    /// Local identity, so a batch that was sent can be removed exactly — never "the first N", which
    /// would drop the wrong points if something was appended while the request was in flight.
    var id: String = UUID().uuidString
    /// Which attendance record this belongs to. Carried on the point rather than read from the
    /// tracker at upload time: a point taken before a check-out still has to reach THAT record,
    /// even if the upload only happens after the tracker has moved on.
    var recordId: String
    var lat: Double
    var lng: Double
    var accuracy: Double?
    var at: Date
    var event: Event
}

enum WorkTrailZone: String, Codable { case unknown, inside, outside }

/// Everything the tracker must remember across a relaunch. Written whole to Application Support
/// after every change, because a region event can relaunch the app into the background with none
/// of its memory — and a flaky network must never cost a point.
struct WorkTrailState: Codable, Equatable {
    var recordId: String?
    var checkInAt: Date?
    var fence: WorkTrailFence?
    var zone: WorkTrailZone = .unknown
    var outsideSince: Date?
    /// When the last point was QUEUED (not sent). The route's rhythm is about how often a position
    /// is recorded; a slow network must not make the phone record more of them.
    var lastQueuedAt: Date?
    /// The server's own "I want the next point by then", e.g. right before the 1h30 reminder.
    var serverNextAt: Date?
    /// The freshest fix, kept even when it is not sent: the exit/enter point and the 15-minute
    /// heartbeat both reuse it rather than waking the GPS again.
    var latest: WorkTrailPoint?
    /// An exit or enter that happened with no usable fix in hand. The next fix carries it.
    var pendingTag: WorkTrailPoint.Event?
    var pending: [WorkTrailPoint] = []
    var stage: String?
    var lastFailureAt: Date?
    /// The record the server answered `tracking:false` for. Today's attendance keeps showing that
    /// record as open (an exempt member, a switched-off workspace), and without this every refresh
    /// would start it again, send an exit, and be told to stop — all day long.
    var refusedRecordId: String?
    // Presence checks. All optional: a state file written by a build before them must still decode
    // (a synthesized Decodable only tolerates a missing key for an Optional).
    /// When tracking of this record began on this phone — the presence clock's anchor when neither a
    /// point nor the check-in time is known.
    var startedAt: Date?
    /// A precise fix is wanted since then: a presence check, or a one-shot fix while the coarse
    /// keep-alive stream is running (a one-shot request must not be mixed with running updates).
    var preciseSince: Date?
    /// The best fix seen since `preciseSince`, used if no good one arrives before the timeout.
    var preciseBest: WorkTrailPoint?
    /// When a presence check last raised the accuracy. A check that got nothing (deep indoors, no
    /// signal) waits `presenceRetry` before trying again instead of keeping the GPS on.
    var presenceTriedAt: Date?
    // What the server last said about the outside clock, for the Live Activity (outsideStatus).
    // Optional for the same reason as the fields above.
    /// The server's `outsideSince` — from a trail reply or from GET /api/attendance/today — and when
    /// the server said it. Nil since = the server does not count this record as outside.
    var serverOutsideSince: Date?
    var serverOutsideSinceAt: Date?
    /// When `stage` and `serverNextAt` were last written by a trail reply.
    var serverStageAt: Date?
    // The precise route outside (28 Sep 2026). Optional for the same reason as the fields above.
    /// The last fix good enough for the route (≤ trailAccuracy). The standing-still heartbeat repeats it.
    var lastGood: WorkTrailPoint?
    /// The last point queued, for the "moved 50 m since" test (`pending` empties on every upload).
    var lastQueued: WorkTrailPoint?
    /// When a batch last went through. Route points wait for `uploadInterval` after it.
    var lastUploadAt: Date?
    // The phone's own outside alerts (planOutsideAlerts): what is scheduled with iOS right now.
    /// Clock start of the episode the alerts were planned for; nil = none planned.
    var alertFrom: Date?
    var alertHourAt: Date?
    var alertAutoAt: Date?

    var isActive: Bool { recordId != nil }
}

/// What the tracker has to do to the outside world as a result of a decision.
enum WorkTrailEffect: Equatable {
    /// Start region monitoring on this circle and ask for its current state.
    case armRegion(WorkTrailFence)
    /// Continuous updates (outside only): background-capable, ~10 m accuracy, 50 m filter.
    case startContinuous
    case stopContinuous
    /// The precise window opened or closed: CoreLocation's accuracy should follow `setup.precise`.
    case preciseChanged
    /// One fix, for an exit/enter that happened with no recent position in hand.
    case requestFix
    /// Upload whatever is pending.
    case flush
    /// Stop every location service this feature started.
    case disarmAll
}

/// What the server said back to a batch.
struct WorkTrailReply: Equatable {
    var tracking: Bool
    var stage: String?
    var outsideSince: Date?
    var nextAt: Date?
}

struct WorkTrailMachine {
    /// Outside, standing still: at a 50 m distance filter no fix arrives, so the last good one is
    /// repeated this often — the server's "phone went quiet" is 30 minutes.
    static let heartbeatInterval: TimeInterval = 5 * 60
    /// Outside, moving: a point once the phone is this far from the last one queued.
    static let trailSpacing: Double = 50
    /// Outside, moving fast: never two moved-points closer together in time than this. Walking and
    /// cycling never hit it (50 m takes them over 10 s); a car at 60 km/h gets one point per ~170 m
    /// instead of one every 3 s — a few hundred points an hour at most, which is what the trail
    /// screens and the upload are sized for.
    static let minPointGap: TimeInterval = 10
    /// Only a fix at least this good goes into the route (horizontalAccuracy, metres).
    static let trailAccuracy: Double = 65
    /// Route points are uploaded in batches, at most about this often. Exit / enter (and the first
    /// point after a relaunch) go at once, and a full batch goes at once.
    static let uploadInterval: TimeInterval = 120
    /// No shift is this long. A record nobody checked out of must not keep a phone's GPS armed
    /// overnight; after this the tracker stands down on its own (the server's cron closes the day).
    static let maxShift: TimeInterval = 16 * 3600
    /// The contract's per-request ceiling.
    static let batchLimit = 200
    /// Hours of offline even at a car's rate (~360 an hour), a whole day of standing still or walking;
    /// beyond it the oldest go first, because a phone that has been offline that long is not going
    /// to be helped by its oldest positions. (The queue is written to disk on every change: 3000
    /// points is well under a megabyte.)
    static let pendingCap = 3000
    /// A fix older than this is not "where they are now" for an exit/enter.
    static let freshFix: TimeInterval = 120
    /// A failed upload waits this long before the tick (or a new route point) tries again. An exit,
    /// an enter or a presence check is not held back by it: it goes at once.
    static let retryAfter: TimeInterval = 120
    /// A fix worse than this cannot decide inside vs outside for a ~100 m office circle.
    static let decisiveAccuracy: Double = 100
    /// Presence rhythm while inside. "About once an hour", kept under 60 minutes on purpose: the trail
    /// shows one chip per clock hour, and any gap shorter than an hour between checks lands at least
    /// one check in every hour even when iOS runs the timer a few minutes late.
    static let presenceInterval: TimeInterval = 50 * 60
    /// How long a presence check may keep the accuracy raised. After it, the best fix seen counts.
    static let preciseTimeout: TimeInterval = 45
    /// A fix this good ends a presence check at once.
    static let presenceAccuracy: Double = 50
    /// A presence check that got no fix waits this long before raising the accuracy again.
    static let presenceRetry: TimeInterval = 15 * 60
    /// Coarser than this is a cell-tower position — the keep-alive stream's usual answer. It cannot
    /// place anyone relative to a circle of a hundred metres, so it is not used for anything.
    static let usableAccuracy: Double = 1000

    var state: WorkTrailState
    /// Set by `resume` when the app comes back from not running while outside: the first fresh
    /// fix after that goes to the server at once, whatever the route's rhythm says. Deliberately
    /// NOT part of the persisted state — it describes this process, not the shift, and a stale
    /// `true` on disk must never make a later launch send a point it has no reason to send.
    var sendNextFix = false

    init(state: WorkTrailState = WorkTrailState()) { self.state = state }

    // MARK: - what CoreLocation should be doing

    /// The location setup the current state calls for, derived from the state alone. The tracker
    /// makes CoreLocation match this on every launch, return to the foreground, permission change
    /// and attendance refresh — level-triggered, so a setup that was missed once (permission not
    /// known yet at launch, a force-quit, a relaunch into the background) is put right the next
    /// time any of those happens, instead of waiting for a transition that may never come.
    struct Setup: Equatable {
        /// The office circle to monitor, or nil for none.
        var region: WorkTrailFence?
        /// Continuous background updates plus significant-change monitoring: outside only.
        var continuous: Bool
        /// Inside, or not known yet: the low-power stream that keeps the app running so the hourly
        /// presence check can happen at all (a suspended app runs no timer). Needs Always; the
        /// tracker decides what the permission allows.
        var keepAlive: Bool = false
        /// A precise fix is wanted right now (never while outside: continuous updates are precise).
        var precise: Bool = false
    }

    var setup: Setup {
        guard state.isActive, let fence = state.fence else { return Setup(region: nil, continuous: false) }
        let outside = state.zone == .outside
        return Setup(region: fence, continuous: outside, keepAlive: !outside,
                     precise: !outside && state.preciseSince != nil)
    }

    // MARK: - lifecycle

    /// A check-in landed (live, from the queue, or discovered on launch). Idempotent for the same
    /// record, so every refresh of today's attendance can call it without restarting anything.
    mutating func start(recordId: String, checkInAt: Date?, fence: WorkTrailFence, now: Date) -> [WorkTrailEffect] {
        if let checkInAt, now.timeIntervalSince(checkInAt) > Self.maxShift { return [] }
        if state.refusedRecordId == recordId { return [] }
        if state.recordId == recordId && state.fence == fence { return [] }
        let sameRecord = state.recordId == recordId
        state.recordId = recordId
        state.checkInAt = checkInAt
        state.fence = fence
        if !sameRecord {
            // A new day starts clean. Points of an earlier record stay queued — they carry their
            // own recordId and still go to the record they belong to.
            sendNextFix = false
            state.zone = .unknown
            state.outsideSince = nil
            state.lastQueuedAt = nil
            state.serverNextAt = nil
            state.latest = nil
            state.pendingTag = nil
            state.stage = nil
            state.startedAt = now
            state.preciseSince = nil
            state.preciseBest = nil
            state.presenceTriedAt = nil
            state.serverOutsideSince = nil
            state.serverOutsideSinceAt = nil
            state.serverStageAt = nil
            state.lastGood = nil
            state.lastQueued = nil
            // The alerts of an earlier record are cancelled by the tracker (it cancels on every
            // stop, and a new record is always preceded by the old one's check-out or a new day).
            state.alertFrom = nil
            state.alertHourAt = nil
            state.alertAutoAt = nil
        }
        return [.armRegion(fence)]
    }

    /// Check-out, `tracking:false`, logout, or the shift cap.
    ///
    /// `keepUnsent` is true for a check-out: what was recorded before it is still that record's
    /// evidence. It is false at logout (the next person must not upload the last one's trail) and
    /// on `tracking:false` (the server has said it does not want them).
    mutating func stop(keepUnsent: Bool) -> [WorkTrailEffect] {
        let wasActive = state.isActive
        sendNextFix = false
        let pending = keepUnsent ? state.pending : []
        let refused = state.refusedRecordId
        state = WorkTrailState()
        state.pending = pending
        state.refusedRecordId = refused
        var fx: [WorkTrailEffect] = []
        if wasActive { fx.append(.disarmAll) }
        if !pending.isEmpty { fx.append(.flush) }
        return fx
    }

    /// The app is running again after it was not — a launch by hand after a force-quit, or a
    /// relaunch by iOS. Nothing watched the phone in between, so:
    ///   • the last fix proves nothing about where the phone is now and must not be re-sent as a
    ///     heartbeat stamped with the current time — it is dropped unless it is fresh;
    ///   • one new fix is asked for, which also settles a zone that went stale while nobody looked
    ///     (a region can report "inside" long after a fix saw the phone leave);
    ///   • while outside, that first fresh fix is sent at once, so the server's record of the
    ///     trail resumes the moment the app does rather than at the next heartbeat.
    ///   • inside, the fix comes through the precise window (the keep-alive stream is coarse), and a
    ///     presence check that fell due while the app was not running is taken with it.
    mutating func resume(now: Date) -> [WorkTrailEffect] {
        guard state.isActive else { return [] }
        if let p = state.latest, now.timeIntervalSince(p.at) > Self.freshFix { state.latest = nil }
        if let p = state.lastGood, now.timeIntervalSince(p.at) > Self.freshFix { state.lastGood = nil }
        sendNextFix = state.zone == .outside
        // A window left open by the process that died is not this one's: it starts again from now.
        state.preciseSince = nil
        state.preciseBest = nil
        return askForFix(now: now)
    }

    // MARK: - inputs

    /// The region said where the phone is (didDetermineState / didEnter / didExit), or a fix did.
    /// `lastKnown` is the location manager's cached fix, used for the event point when fresh.
    mutating func determined(inside: Bool, lastKnown: WorkTrailPoint?, now: Date) -> [WorkTrailEffect] {
        guard state.isActive else { return [] }
        let target: WorkTrailZone = inside ? .inside : .outside
        guard state.zone != target else { return [] }
        // A region answer that a fresh, clear fix contradicts is iOS's stale idea of the region, not
        // a crossing: iOS only flips a region's state after the phone is well past the edge, so a
        // phone sitting just outside the circle can be told "inside" by `requestState` for as long
        // as it stays there. Believing that would switch continuous updates off and leave the
        // phone outside with nothing watching it. The fix's answer is taken instead (it always
        // agrees with itself, so this recurses once at most).
        if let lk = lastKnown, now.timeIntervalSince(lk.at) <= Self.freshFix, let fence = state.fence,
           let fixSays = Self.decisive(lk, fence: fence), fixSays != inside {
            return determined(inside: fixSays, lastKnown: lk, now: now)
        }
        let previous = state.zone
        state.zone = target
        // The exit/enter point (or, inside, nothing) replaces the point a resume was waiting for.
        sendNextFix = false
        if inside {
            state.outsideSince = nil
            // First answer after a check-in is "inside": the normal case, nothing to report.
            if previous == .unknown { return [.stopContinuous] }
            return [.stopContinuous] + tag(.enter, lastKnown: lastKnown, now: now)
        } else {
            // Outside from the very first answer counts as leaving: the server starts its clock
            // from the exit point, and a check-in made at the edge of the circle is still one.
            state.outsideSince = now
            // Continuous updates take over; a presence check in progress has nothing left to do.
            state.preciseSince = nil
            state.preciseBest = nil
            return [.startContinuous] + tag(.exit, lastKnown: lastKnown, now: now)
        }
    }

    /// A position from continuous updates or a one-shot request.
    mutating func fix(_ raw: WorkTrailPoint, now: Date) -> [WorkTrailEffect] {
        guard let recordId = state.recordId else { return [] }
        // The first delivery after updates start can be CoreLocation's cached position, possibly
        // from hours ago or from before the app stopped running. "Where the phone was then" may not
        // decide the zone, carry an exit/enter tag, or become the heartbeat's position.
        guard now.timeIntervalSince(raw.at) <= Self.freshFix else { return [] }
        guard Self.usable(raw) else { return [] }
        var p = raw
        p.recordId = recordId
        p.event = .point
        state.latest = p
        if Self.routeQuality(p) { state.lastGood = p }
        if let since = state.preciseSince, p.at >= since, Self.better(p, than: state.preciseBest) { state.preciseBest = p }

        // The fix itself may settle the zone faster than the region does: iOS reports a region
        // crossing late and only after a margin, while a clear fix is unambiguous. (This is also how
        // a presence check that finds the phone outside reveals a region exit iOS never reported.)
        if let fence = state.fence, let inside = Self.decisive(p, fence: fence), (inside ? WorkTrailZone.inside : .outside) != state.zone {
            let fx = determined(inside: inside, lastKnown: p, now: now)
            return state.zone == .outside ? fx : fx + presence(p, now: now)
        }
        if let tagged = state.pendingTag {
            state.pendingTag = nil
            p.event = tagged
            enqueue(p, now: now)
            return [.flush] + (state.zone == .outside ? [] : endPrecise(ifSatisfiedBy: p))
        }
        guard state.zone == .outside else { return presence(p, now: now) }
        // Outside: the route. A vague fix (> trailAccuracy) is not drawn — it would zig-zag the line.
        guard Self.routeQuality(p) else { return [] }
        // Right after a resume the first fresh fix goes out without waiting for the rhythm.
        if sendNextFix {
            sendNextFix = false
            enqueue(p, now: now)
            return [.flush]
        }
        guard isRoutePointDue(p, now: now) else { return [] }
        enqueue(p, now: now)
        return uploadIfDue(now)
    }

    /// Outside: does this (good) fix become a route point? Moved `trailSpacing` from the last point
    /// (and not within `minPointGap` of it), or `heartbeatInterval` since it, or the server asked.
    func isRoutePointDue(_ p: WorkTrailPoint, now: Date) -> Bool {
        guard let lastAt = state.lastQueuedAt else { return true }
        let since = now.timeIntervalSince(lastAt)
        if since >= Self.heartbeatInterval { return true }
        if let asked = state.serverNextAt, asked > lastAt, now >= asked { return true }
        guard since >= Self.minPointGap else { return false }
        guard let q = state.lastQueued else { return true }
        return Self.distance(p.lat, p.lng, q.lat, q.lng) >= Self.trailSpacing
    }

    /// A route point was queued: upload now only if the last upload is `uploadInterval` old (or the
    /// batch is full), and not straight after a failure. Otherwise the tick sends it with the next ones.
    func uploadIfDue(_ now: Date) -> [WorkTrailEffect] {
        if state.pending.count >= Self.batchLimit { return [.flush] }
        return uploadAllowed(now) ? [.flush] : []
    }

    private func uploadAllowed(_ now: Date) -> Bool {
        if let failed = state.lastFailureAt, now.timeIntervalSince(failed) < Self.retryAfter { return false }
        if let last = state.lastUploadAt, now.timeIntervalSince(last) < Self.uploadInterval { return false }
        return true
    }

    /// Inside or not known yet: the fix becomes the hourly presence check when one is due, and a
    /// precise window it satisfies is closed.
    private mutating func presence(_ p: WorkTrailPoint, now: Date) -> [WorkTrailEffect] {
        guard state.zone != .outside else { return [] }
        var fx: [WorkTrailEffect] = []
        let good = (p.accuracy ?? Self.decisiveAccuracy) <= Self.presenceAccuracy
        // Inside a window only a fix taken after it opened counts: the first delivery after the
        // accuracy goes up can be the old coarse position.
        let inWindow = state.preciseSince.map { p.at >= $0 } ?? true
        if good, inWindow, isPresenceDue(now) {
            enqueue(presencePoint(from: p), now: now)
            fx.append(.flush)
        }
        return fx + endPrecise(ifSatisfiedBy: p)
    }

    /// Called about once a minute while tracking (and on every wake): the heartbeat while outside,
    /// the retry for a failed upload, and the shift cap.
    mutating func tick(now: Date) -> [WorkTrailEffect] {
        if state.isActive, let checkInAt = state.checkInAt, now.timeIntervalSince(checkInAt) > Self.maxShift {
            return stop(keepUnsent: true)
        }
        var fx: [WorkTrailEffect] = []
        if state.isActive, state.zone == .outside, isDue(now) {
            if var p = state.lastGood, state.latest.map({ $0.at <= p.at }) ?? true {
                // Standing still outside delivers no fixes at a 50 m distance filter — and no fix
                // means the phone has not moved more than 50 m from the last one. Re-sending that
                // position with the current time is true to within the filter, and it is what keeps
                // a person sitting in a café from looking like a phone that went silent. Only while
                // no vaguer fix has come in since: that one would say the good one is no longer sure.
                p.id = UUID().uuidString
                p.at = now
                p.event = .point
                enqueue(p, now: now)
                fx += uploadIfDue(now)
            } else {
                // Continuous updates are running: the next good fix is the heartbeat (it is due).
                fx.append(.requestFix)
            }
        }
        if state.isActive, state.zone != .outside {
            fx += presenceTick(now: now)
        }
        if !fx.contains(.flush), !state.pending.isEmpty, uploadAllowed(now) {
            fx.append(.flush)
        }
        return fx
    }

    /// The presence clock, once a minute while inside (or while the zone is not known yet).
    private mutating func presenceTick(now: Date) -> [WorkTrailEffect] {
        if let since = state.preciseSince {
            guard now.timeIntervalSince(since) >= Self.preciseTimeout else { return [] }
            // Timed out without a good fix. The best one seen still says something (the server
            // marks a vague one "unclear"); with none at all, nothing is invented.
            var fx: [WorkTrailEffect] = []
            if let best = state.preciseBest, isPresenceDue(now) {
                enqueue(presencePoint(from: best), now: now)
                fx.append(.flush)
            }
            state.preciseSince = nil
            state.preciseBest = nil
            return fx + [.preciseChanged]
        }
        guard isPresenceDue(now) else { return [] }
        if let tried = state.presenceTriedAt, now.timeIntervalSince(tried) < Self.presenceRetry { return [] }
        // A fix that is fresh and good already needs no GPS at all (the stream delivers a Wi-Fi fix
        // now and then, and While Using delivers precise ones while the app is open).
        if let p = state.latest, now.timeIntervalSince(p.at) <= Self.freshFix,
           (p.accuracy ?? Self.decisiveAccuracy) <= Self.presenceAccuracy {
            enqueue(presencePoint(from: p), now: now)
            return [.flush]
        }
        state.presenceTriedAt = now
        state.preciseSince = now
        state.preciseBest = nil
        return [.preciseChanged]
    }

    /// Whether the hourly presence check is due: inside or zone unknown, and no point queued for
    /// `presenceInterval` — any point counts (an enter, a check), since each says where the phone was.
    func isPresenceDue(_ now: Date) -> Bool {
        guard state.isActive, state.zone != .outside else { return false }
        guard let anchor = state.lastQueuedAt ?? state.checkInAt ?? state.startedAt else { return true }
        return now.timeIntervalSince(anchor) >= Self.presenceInterval
    }

    // MARK: - upload bookkeeping

    /// The next request body: the oldest record's points, at most `batchLimit` of them.
    func nextBatch() -> (recordId: String, points: [WorkTrailPoint])? {
        guard let first = state.pending.first else { return nil }
        let batch = state.pending.filter { $0.recordId == first.recordId }.prefix(Self.batchLimit)
        return (first.recordId, Array(batch))
    }

    /// The server took these points.
    mutating func sent(_ ids: Set<String>, recordId: String, reply: WorkTrailReply, now: Date) -> [WorkTrailEffect] {
        state.pending.removeAll { ids.contains($0.id) }
        state.lastFailureAt = nil
        state.lastUploadAt = now
        // A reply about an older record says nothing about the one being tracked now.
        guard recordId == state.recordId else { return state.pending.isEmpty ? [] : [.flush] }
        if !reply.tracking {
            // The server's word is final — checked out elsewhere, auto checked out, exempt, or the
            // feature is switched off. Whatever is still queued for this record is not wanted.
            state.pending.removeAll { $0.recordId == recordId }
            let rest = state.pending
            var fx = stop(keepUnsent: false)
            state.pending = rest
            state.refusedRecordId = recordId
            state.lastUploadAt = now
            if !rest.isEmpty { fx.append(.flush) }
            return fx
        }
        state.stage = reply.stage
        state.serverNextAt = reply.nextAt
        state.serverStageAt = now
        state.serverOutsideSince = reply.outsideSince
        state.serverOutsideSinceAt = now
        return state.pending.isEmpty ? [] : [.flush]
    }

    /// The upload did not go through. `dropBatch` is for a refusal that retrying cannot change
    /// (a malformed body, a record that is not yours): keeping it would block the queue forever.
    mutating func failed(_ ids: Set<String>, dropBatch: Bool, now: Date) {
        state.lastFailureAt = now
        if dropBatch { state.pending.removeAll { ids.contains($0.id) } }
    }

    // MARK: - helpers

    /// Outside: the standing-still heartbeat is due (or the server's `nextAt` has come).
    func isDue(_ now: Date) -> Bool {
        guard let last = state.lastQueuedAt else { return true }
        var due = last.addingTimeInterval(Self.heartbeatInterval)
        if let asked = state.serverNextAt, asked > last, asked < due { due = asked }
        return now >= due
    }

    private mutating func tag(_ event: WorkTrailPoint.Event, lastKnown: WorkTrailPoint?, now: Date) -> [WorkTrailEffect] {
        guard let recordId = state.recordId else { return [] }
        // The manager's cached fix can now be the keep-alive stream's cell-level one: skipped, so the
        // exit/enter point is never placed kilometres off (the server would call it unclear).
        let candidate = [lastKnown, state.latest].compactMap { $0 }
            .first { now.timeIntervalSince($0.at) <= Self.freshFix && Self.usable($0) }
        if var p = candidate {
            p.id = UUID().uuidString
            p.recordId = recordId
            p.event = event
            state.pendingTag = nil
            enqueue(p, now: now)
            return [.flush]
        }
        state.pendingTag = event
        return askForFix(now: now)
    }

    /// One fix, however the current setup gets it: outside, continuous updates are already precise;
    /// inside, the precise window raises the keep-alive stream's accuracy until a good fix arrives.
    private mutating func askForFix(now: Date) -> [WorkTrailEffect] {
        guard state.zone != .outside else { return [.requestFix] }
        let opened = state.preciseSince == nil
        if opened { state.preciseSince = now; state.preciseBest = nil }
        return opened ? [.requestFix, .preciseChanged] : [.requestFix]
    }

    /// Closes the precise window when `p` is the good, post-opening fix it was waiting for.
    private mutating func endPrecise(ifSatisfiedBy p: WorkTrailPoint) -> [WorkTrailEffect] {
        guard let since = state.preciseSince, p.at >= since,
              (p.accuracy ?? Self.decisiveAccuracy) <= Self.presenceAccuracy else { return [] }
        state.preciseSince = nil
        state.preciseBest = nil
        return [.preciseChanged]
    }

    private func presencePoint(from p: WorkTrailPoint) -> WorkTrailPoint {
        var q = p
        q.id = UUID().uuidString
        q.recordId = state.recordId ?? p.recordId
        q.event = .presence
        return q
    }

    /// Good enough to be drawn as the route outside (and to be repeated as the heartbeat).
    static func routeQuality(_ p: WorkTrailPoint) -> Bool {
        guard let acc = p.accuracy else { return true }
        return acc >= 0 && acc <= trailAccuracy
    }

    static func usable(_ p: WorkTrailPoint) -> Bool {
        guard let acc = p.accuracy else { return true }
        return acc >= 0 && acc <= usableAccuracy
    }

    static func better(_ p: WorkTrailPoint, than q: WorkTrailPoint?) -> Bool {
        guard let q else { return true }
        return (p.accuracy ?? decisiveAccuracy) < (q.accuracy ?? decisiveAccuracy)
    }

    private mutating func enqueue(_ p: WorkTrailPoint, now: Date) {
        state.pending.append(p)
        if state.pending.count > Self.pendingCap { state.pending.removeFirst(state.pending.count - Self.pendingCap) }
        state.lastQueuedAt = now
        state.lastQueued = p
    }

    /// Inside, outside, or nil when the fix is too vague to say. A margin of the fix's own accuracy
    /// on the way OUT keeps GPS jitter at the edge of the circle from inventing exits. The margin is
    /// the SERVER's (radius + max(accuracy, 50 m), `classifyPoint` in lib/attendance-outside.ts): with
    /// a smaller one the phone announced "you're outside" 30–50 m past the edge while the server's
    /// clock never started (28 Sep 2026).
    static let outsideMargin: Double = 50
    static func decisive(_ p: WorkTrailPoint, fence: WorkTrailFence) -> Bool? {
        let acc = p.accuracy ?? decisiveAccuracy
        guard acc >= 0, acc <= decisiveAccuracy else { return nil }
        let d = distance(p.lat, p.lng, fence.lat, fence.lng)
        if d <= fence.radius { return true }
        if d > fence.radius + max(acc, outsideMargin) { return false }
        return nil
    }

    /// Haversine, metres. Plenty for a circle of a few hundred metres.
    static func distance(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLng = (lng2 - lng1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}

// MARK: - the outside clock, as the Live Activity shows it

/// "Outside the office since 20:59 · auto check-out 23:29" — what the work-session Live Activity
/// draws while the person is out. The pushes at 1h30 and 2h are banners, and iOS never puts a banner
/// into a Live Activity, so the Island and the Lock Screen have to be told separately, by the app.
struct WorkOutsideStatus: Equatable {
    /// `inside` is also "nothing to show": back inside, an excuse on file, or not tracking at all.
    enum Stage: String { case inside, outside, reminded, warned }
    var stage: Stage
    /// Start of the episode — the time the server's pushes and the automatic check-out quote.
    var outsideSince: Date?
    /// When the server will check the person out offsite if nothing changes.
    var autoCheckoutAt: Date?
    /// When the clock of this episode started: `outsideSince`, or a later restart (an excuse
    /// rejected or withdrawn). The phone's own alerts count from it. Not part of the display.
    var clockFrom: Date? = nil

    static let inside = WorkOutsideStatus(stage: .inside, outsideSince: nil, autoCheckoutAt: nil)

    /// Whether redrawing the Live Activity would change anything the person can see. The times are
    /// shown to the minute and the countdown is drawn by the system, so the local exit time being
    /// replaced by the server's a few seconds off is not worth one of ActivityKit's rationed updates.
    func sameForDisplay(as other: WorkOutsideStatus) -> Bool {
        func close(_ a: Date?, _ b: Date?) -> Bool {
            switch (a, b) {
            case (nil, nil): return true
            case let (x?, y?): return abs(x.timeIntervalSince(y)) < 60
            default: return false
            }
        }
        return stage == other.stage && close(outsideSince, other.outsideSince) && close(autoCheckoutAt, other.autoCheckoutAt)
    }
}

extension WorkTrailMachine {
    // The server's clock (src/lib/attendance-outside.ts): reminder at 90 min, warning at 120, the
    // automatic offsite check-out at the later of 150 min and warning + 30 min.
    static let remindAfter: TimeInterval = 90 * 60
    static let warnAfter: TimeInterval = 120 * 60
    static let autoAfter: TimeInterval = 150 * 60
    /// The trail reply's stage while a PENDING/APPROVED excuse for today holds the clock.
    static let pausedStage = "paused_permit"
    /// A server `outsideSince` more than this much earlier than the phone's own exit belongs to an
    /// earlier episode (a GET /today answered before the person came back in and went out again).
    static let serverSinceSlack: TimeInterval = 30 * 60

    /// GET /api/attendance/today answered. `heardAt` is when the server said it — earlier than now
    /// for a copy restored from the offline cache, which must not override a fresher trail reply.
    /// `excused`: an APPROVED request covers today (`todayRequest`). A PENDING one is not in that
    /// response; the trail reply's `paused_permit` carries it instead.
    mutating func heardToday(recordId: String, outsideSince: Date?, excused: Bool, heardAt: Date) {
        guard state.recordId == recordId else { return }
        if state.serverOutsideSinceAt.map({ heardAt >= $0 }) ?? true {
            state.serverOutsideSince = outsideSince
            state.serverOutsideSinceAt = heardAt
        }
        // Only ever sets the pause: an absent todayRequest does not mean no PENDING excuse exists.
        if excused { state.stage = Self.pausedStage }
    }

    /// The person just filed a request covering today from this phone. The server pauses the clock
    /// for a PENDING one at once; the next trail reply confirms it (or, withdrawn, lifts it).
    mutating func excuseFiled() {
        guard state.isActive else { return }
        state.stage = Self.pausedStage
    }

    /// What the Live Activity should show right now. Pure; called on every fix, tick and reply.
    ///
    ///   • inside by the phone's own reckoning, not tracking, an excuse holding the clock, or already
    ///     checked out by it → `.inside` (the normal session look);
    ///   • otherwise the episode starts at the server's `outsideSince` when the server has heard of
    ///     this episode (so the phone quotes the same time as the pushes), else the phone's exit;
    ///   • the clock runs from that start, or from a later restart the server's `nextAt` reveals (an
    ///     excuse rejected or withdrawn mid-episode restarts it); 90 min → reminded, 120 → warned,
    ///     and never a stage below the one the server reports;
    ///   • the automatic check-out is the server's own time once it has warned, else start + 150 min.
    func outsideStatus(now: Date) -> WorkOutsideStatus {
        let s = state
        guard s.isActive, s.zone != .inside else { return .inside }
        if s.stage == Self.pausedStage || s.stage == "auto_checked_out" { return .inside }

        let local = s.zone == .outside ? s.outsideSince : nil
        var since = local
        if let server = s.serverOutsideSince, let heard = s.serverOutsideSinceAt, server <= now.addingTimeInterval(300) {
            if let local {
                // Heard after this exit, and plausibly the same episode.
                if heard >= local && server >= local.addingTimeInterval(-Self.serverSinceSlack) { since = server }
            } else {
                // Zone not known on the phone yet (a relaunch, While Using before the first fix):
                // the server's word is the only one there is.
                since = server
            }
        }
        guard let since else { return .inside }

        var clockFrom = since
        var serverRank = 0
        var warnedAutoAt: Date?
        if let at = s.serverStageAt, at >= since, let next = s.serverNextAt {
            switch s.stage {
            case "outside":  clockFrom = max(since, next.addingTimeInterval(-Self.remindAfter))
            case "reminded": clockFrom = max(since, next.addingTimeInterval(-Self.warnAfter)); serverRank = 1
            case "warned":   warnedAutoAt = next; serverRank = 2
            default: break
            }
        }
        clockFrom = min(clockFrom, now)

        let elapsed = now.timeIntervalSince(clockFrom)
        let rank = max(serverRank, elapsed >= Self.warnAfter ? 2 : elapsed >= Self.remindAfter ? 1 : 0)
        let stage: WorkOutsideStatus.Stage = rank == 2 ? .warned : rank == 1 ? .reminded : .outside
        return WorkOutsideStatus(stage: stage, outsideSince: since,
                                 autoCheckoutAt: warnedAutoAt ?? clockFrom.addingTimeInterval(Self.autoAfter),
                                 clockFrom: clockFrom)
    }
}

// MARK: - the phone's own outside alerts

/// Local notifications the phone schedules for itself while outside (owner, 28 Sep 2026): one the
/// moment it leaves, one an hour in, each with the time left before the automatic check-out. The
/// server's pushes at 1h30 and 2h are not repeated here. The tracker turns each into a
/// UNNotificationRequest with a fixed identifier per record, so re-planning replaces, never adds.
enum WorkOutsideAlert: Equatable {
    /// "Outside the office since HH:mm · 2 h 30 min left before the automatic check-out (HH:mm)".
    /// `fireAt` is the clock start, or now when the phone learns of the episode late.
    case left(fireAt: Date, since: Date, autoAt: Date)
    /// "1 hour outside the office · 1 h 30 min left · automatic check-out HH:mm", at clock start + 1 h.
    case hour(fireAt: Date, since: Date, autoAt: Date)
    /// The hour alert is no longer right and its moment has passed: drop the pending one.
    case cancelHour
    /// Back inside, an excuse holds the clock, or the clock is over: drop both, pending and shown.
    case cancelAll
}

extension WorkTrailMachine {
    static let hourAlertAfter: TimeInterval = 60 * 60

    /// What to change about the phone's own alerts, given the state now. Level-triggered like
    /// `setup`: called on every fix, tick, reply and refresh; it remembers what it planned
    /// (`alertFrom` …) and only answers with a change.
    ///
    ///   • inside, an excuse on file, auto checked out → cancel whatever was planned;
    ///   • zone not known and the server has not said "outside" → nothing (a relaunch must not
    ///     cancel alerts only to announce the same exit again a minute later);
    ///   • a new episode → the "left" alert now (skipped when found out only after 1h30, the
    ///     server's reminder has it by then) and the hour alert, unless its time has passed;
    ///   • the same episode with a clock start or auto check-out time that moved (the server's
    ///     `outsideSince` replacing the phone's exit time, a late warning) → the pending hour alert
    ///     is replaced. The "left" alert is never sent twice for one episode.
    /// A stop (check-out, logout, `tracking:false`, auto check-out, the shift cap) resets the state,
    /// so nothing is answered here for it: the tracker cancels every alert on each stop itself.
    mutating func planOutsideAlerts(now: Date) -> [WorkOutsideAlert] {
        let s = state
        let over = !s.isActive || s.zone == .inside || s.stage == Self.pausedStage || s.stage == "auto_checked_out"
        let status = outsideStatus(now: now)
        guard !over, status.stage != .inside,
              let since = status.outsideSince, let autoAt = status.autoCheckoutAt else {
            guard over, state.alertFrom != nil else { return [] }
            state.alertFrom = nil
            state.alertHourAt = nil
            state.alertAutoAt = nil
            return [.cancelAll]
        }
        let from = status.clockFrom ?? since
        let hourAt = from.addingTimeInterval(Self.hourAlertAfter)
        func moved(_ a: Date?, _ b: Date) -> Bool { a.map { abs($0.timeIntervalSince(b)) >= 60 } ?? true }

        guard state.alertFrom != nil else {
            state.alertFrom = from
            state.alertHourAt = hourAt
            state.alertAutoAt = autoAt
            var out: [WorkOutsideAlert] = []
            if now < from.addingTimeInterval(Self.remindAfter) { out.append(.left(fireAt: max(from, now), since: since, autoAt: autoAt)) }
            if hourAt > now { out.append(.hour(fireAt: hourAt, since: since, autoAt: autoAt)) }
            return out
        }
        guard moved(state.alertHourAt, hourAt) || moved(state.alertAutoAt, autoAt) else { return [] }
        let wasPending = state.alertHourAt.map { $0 > now } ?? false
        state.alertFrom = from
        state.alertHourAt = hourAt
        state.alertAutoAt = autoAt
        if hourAt > now { return [.hour(fireAt: hourAt, since: since, autoAt: autoAt)] }
        return wasPending ? [.cancelHour] : []
    }

    /// Whole minutes left from `from` to `autoAt`, rounded up: "sisa 2 jam 30 menit" at the exit.
    static func minutesLeft(from: Date, to autoAt: Date) -> Int {
        // Less a hair, so an exact 150 minutes computed with a rounding error stays 150, not 151.
        max(0, Int((autoAt.timeIntervalSince(from) / 60 - 0.001).rounded(.up)))
    }
}

/// The wire format: `{ recordId, points: [{ lat, lng, accuracy?, at, event }] }`.
enum WorkTrailWire {
    static func body(recordId: String, points: [WorkTrailPoint]) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return [
            "recordId": recordId,
            "points": points.map { p -> [String: Any] in
                var o: [String: Any] = ["lat": p.lat, "lng": p.lng, "at": iso.string(from: p.at), "event": p.event.rawValue]
                if let a = p.accuracy, a >= 0 { o["accuracy"] = a }
                return o
            },
        ]
    }

    /// Lenient: a reply that says nothing about `tracking` is taken as "carry on", because the
    /// only safe reading of a stop is an explicit one.
    static func reply(_ data: Data) -> WorkTrailReply? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return WorkTrailReply(
            tracking: (obj["tracking"] as? Bool) ?? true,
            stage: obj["stage"] as? String,
            outsideSince: parseISO(obj["outsideSince"] as? String),
            nextAt: parseISO(obj["nextAt"] as? String))
    }

    static func parseISO(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
