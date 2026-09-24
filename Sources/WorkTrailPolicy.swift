import Foundation

// The decision half of "live location while checked in", with no CoreLocation, no UIKit and no
// network in it. WorkLocationTracker owns the location manager and the uploads; everything it has
// to DECIDE — are we inside or outside, is a point due, what goes into the next request, when do we
// give up — lives here as plain values, so it can be run and checked with nothing but Foundation.
//
// The rules it encodes are the owner's, and they are narrow on purpose:
//   • only between a check-in that the server has accepted and the check-out;
//   • while inside the office, nothing is sent and no continuous GPS runs;
//   • while outside, one point about every 15 minutes, plus one immediately on leaving and on
//     coming back;
//   • the server has the last word: `tracking:false` stops everything.

/// The office circle a check-in was made against.
struct WorkTrailFence: Codable, Equatable {
    let lat: Double
    let lng: Double
    let radius: Double
}

/// One position that is going to, or already went to, the server.
struct WorkTrailPoint: Codable, Equatable {
    enum Event: String, Codable { case exit, enter, point }

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
    /// When the last point was QUEUED (not sent). The 15-minute rhythm is about how often a
    /// position is recorded; a slow network must not make the phone record more of them.
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

    var isActive: Bool { recordId != nil }
}

/// What the tracker has to do to the outside world as a result of a decision.
enum WorkTrailEffect: Equatable {
    /// Start region monitoring on this circle and ask for its current state.
    case armRegion(WorkTrailFence)
    /// Continuous updates (outside only): background-capable, 100 m accuracy, ~50 m filter.
    case startContinuous
    case stopContinuous
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
    /// The owner's rhythm while outside.
    static let sendInterval: TimeInterval = 15 * 60
    /// No shift is this long. A record nobody checked out of must not keep a phone's GPS armed
    /// overnight; after this the tracker stands down on its own (the server's cron closes the day).
    static let maxShift: TimeInterval = 16 * 3600
    /// The contract's per-request ceiling.
    static let batchLimit = 200
    /// At 4 points an hour this is days of offline; beyond it the oldest go first, because a
    /// phone that has been offline for days is not going to be helped by its oldest positions.
    static let pendingCap = 1000
    /// A fix older than this is not "where they are now" for an exit/enter.
    static let freshFix: TimeInterval = 120
    /// A failed upload waits this long before the tick tries again. Event-driven flushes (a new
    /// point) are not held back by it: a new point is exactly when retrying makes sense.
    static let retryAfter: TimeInterval = 120
    /// A fix worse than this cannot decide inside vs outside for a ~100 m office circle.
    static let decisiveAccuracy: Double = 100

    var state: WorkTrailState
    /// Set by `resume` when the app comes back from not running while outside: the first fresh
    /// fix after that goes to the server at once, whatever the 15-minute rhythm says. Deliberately
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
    }

    var setup: Setup {
        guard state.isActive, let fence = state.fence else { return Setup(region: nil, continuous: false) }
        return Setup(region: fence, continuous: state.zone == .outside)
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
    ///     trail resumes the moment the app does rather than up to 15 minutes later.
    mutating func resume(now: Date) -> [WorkTrailEffect] {
        guard state.isActive else { return [] }
        if let p = state.latest, now.timeIntervalSince(p.at) > Self.freshFix { state.latest = nil }
        sendNextFix = state.zone == .outside
        return [.requestFix]
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
        var p = raw
        p.recordId = recordId
        p.event = .point
        state.latest = p

        // The fix itself may settle the zone faster than the region does: iOS reports a region
        // crossing late and only after a margin, while a clear fix is unambiguous.
        if let fence = state.fence, let inside = Self.decisive(p, fence: fence), (inside ? WorkTrailZone.inside : .outside) != state.zone {
            return determined(inside: inside, lastKnown: p, now: now)
        }
        if let tagged = state.pendingTag {
            state.pendingTag = nil
            p.event = tagged
            enqueue(p, now: now)
            return [.flush]
        }
        // Right after a resume the first fresh fix goes out without waiting for the rhythm.
        if state.zone == .outside && (isDue(now) || sendNextFix) {
            sendNextFix = false
            enqueue(p, now: now)
            return [.flush]
        }
        return []
    }

    /// Called about once a minute while tracking (and on every wake): the heartbeat while outside,
    /// the retry for a failed upload, and the shift cap.
    mutating func tick(now: Date) -> [WorkTrailEffect] {
        if state.isActive, let checkInAt = state.checkInAt, now.timeIntervalSince(checkInAt) > Self.maxShift {
            return stop(keepUnsent: true)
        }
        var fx: [WorkTrailEffect] = []
        if state.isActive, state.zone == .outside, isDue(now) {
            if var p = state.latest {
                // Standing still outside delivers no fixes at a 50 m distance filter — and no fix
                // means the phone has not moved more than 50 m from the last one. Re-sending that
                // position with the current time is true to within the filter, and it is what keeps
                // a person sitting in a café from looking like a phone that went silent.
                p.id = UUID().uuidString
                p.at = now
                p.event = .point
                enqueue(p, now: now)
                fx.append(.flush)
            } else {
                fx.append(.requestFix)
            }
        }
        if !fx.contains(.flush), !state.pending.isEmpty {
            if let failed = state.lastFailureAt, now.timeIntervalSince(failed) < Self.retryAfter { return fx }
            fx.append(.flush)
        }
        return fx
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
            if !rest.isEmpty { fx.append(.flush) }
            return fx
        }
        state.stage = reply.stage
        state.serverNextAt = reply.nextAt
        return state.pending.isEmpty ? [] : [.flush]
    }

    /// The upload did not go through. `dropBatch` is for a refusal that retrying cannot change
    /// (a malformed body, a record that is not yours): keeping it would block the queue forever.
    mutating func failed(_ ids: Set<String>, dropBatch: Bool, now: Date) {
        state.lastFailureAt = now
        if dropBatch { state.pending.removeAll { ids.contains($0.id) } }
    }

    // MARK: - helpers

    func isDue(_ now: Date) -> Bool {
        guard let last = state.lastQueuedAt else { return true }
        var due = last.addingTimeInterval(Self.sendInterval)
        if let asked = state.serverNextAt, asked > last, asked < due { due = asked }
        return now >= due
    }

    private mutating func tag(_ event: WorkTrailPoint.Event, lastKnown: WorkTrailPoint?, now: Date) -> [WorkTrailEffect] {
        guard let recordId = state.recordId else { return [] }
        if var p = lastKnown ?? state.latest, now.timeIntervalSince(p.at) <= Self.freshFix {
            p.id = UUID().uuidString
            p.recordId = recordId
            p.event = event
            state.pendingTag = nil
            enqueue(p, now: now)
            return [.flush]
        }
        state.pendingTag = event
        return [.requestFix]
    }

    private mutating func enqueue(_ p: WorkTrailPoint, now: Date) {
        state.pending.append(p)
        if state.pending.count > Self.pendingCap { state.pending.removeFirst(state.pending.count - Self.pendingCap) }
        state.lastQueuedAt = now
    }

    /// Inside, outside, or nil when the fix is too vague to say. A margin of the fix's own accuracy
    /// on the way OUT keeps GPS jitter at the edge of the circle from inventing exits.
    static func decisive(_ p: WorkTrailPoint, fence: WorkTrailFence) -> Bool? {
        let acc = p.accuracy ?? decisiveAccuracy
        guard acc >= 0, acc <= decisiveAccuracy else { return nil }
        let d = distance(p.lat, p.lng, fence.lat, fence.lng)
        if d <= fence.radius { return true }
        if d > fence.radius + max(acc, 30) { return false }
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
