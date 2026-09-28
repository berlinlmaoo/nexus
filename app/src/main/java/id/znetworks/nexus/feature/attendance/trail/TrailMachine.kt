package id.znetworks.nexus.feature.attendance.trail

import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

// The decision half of "live location while checked in" (PRD §2.9), ported from iOS
// WorkTrailPolicy.swift (64b1bfb hourly presence, 13e7784 resume) with the same rules and numbers.
// No Android types in here: the service carries the effects out, this decides them, and every rule
// is a JVM test.
//
//   • only between a check-in the server accepted and the check-out: nothing before, nothing after;
//   • inside the office (owner, 25 Sep 2026): one "presence" check about once an hour, so the day
//     shows that the person stayed. Between checks only a low-power stream runs; the check raises
//     the accuracy for one fix (≤ 45 s) and drops it again;
//   • outside (UPDATES §10), a precise route: a point every ~50 m moved, or every 5 min standing
//     still, plus one on leaving and one on coming back; uploaded in batches about every 2 min
//     (leaving and coming back go at once: the server's clock starts on them);
//   • the server has the last word: `tracking:false` stops everything.

@Serializable
data class TrailFence(val lat: Double, val lng: Double, val radius: Double)

@Serializable
data class TrailPoint(
    /** Local identity, so a sent batch is removed exactly. */
    val id: String = UUID.randomUUID().toString(),
    /** Carried on the point: a point taken before a check-out still goes to THAT record. */
    val recordId: String,
    val lat: Double,
    val lng: Double,
    val accuracy: Double? = null,
    val atMillis: Long,
    val event: Event = Event.point,
) {
    /** `presence`: the hourly "still here" check while inside (or before the zone is known). */
    @Suppress("EnumEntryName")
    enum class Event { exit, enter, point, presence }
}

@Serializable
enum class TrailZone { UNKNOWN, INSIDE, OUTSIDE }

/** Everything that must survive process death, written whole after every change. */
@Serializable
data class TrailState(
    val recordId: String? = null,
    val checkInAtMillis: Long? = null,
    val fence: TrailFence? = null,
    val zone: TrailZone = TrailZone.UNKNOWN,
    val outsideSinceMillis: Long? = null,
    /** When the last point was QUEUED (not sent): the rhythm is about recording, not the network. */
    val lastQueuedAtMillis: Long? = null,
    /** The server's "I want the next point by then". */
    val serverNextAtMillis: Long? = null,
    val latest: TrailPoint? = null,
    /** An exit/enter that happened with no usable fix in hand; the next fix carries it. */
    val pendingTag: TrailPoint.Event? = null,
    val pending: List<TrailPoint> = emptyList(),
    val stage: String? = null,
    val lastFailureAtMillis: Long? = null,
    /** The record the server said `tracking:false` for: never restarted for it. */
    val refusedRecordId: String? = null,
    // Presence checks (defaults, so a state file from before them still decodes).
    /** When tracking of this record began here: the presence clock's anchor of last resort. */
    val startedAtMillis: Long? = null,
    /** A precise fix is wanted since then (a presence check, or a one-shot fix while inside). */
    val preciseSinceMillis: Long? = null,
    /** The best fix seen since [preciseSinceMillis], used if no good one arrives in time. */
    val preciseBest: TrailPoint? = null,
    /** When a presence check last raised the accuracy; one that got nothing waits 15 min. */
    val presenceTriedAtMillis: Long? = null,
    /** The last point queued, for the 50 m step outside. */
    val lastQueued: TrailPoint? = null,
    /** When a batch last went up (success), for the ~2 min upload rhythm outside. */
    val lastUploadAtMillis: Long? = null,
    /** The server's outsideSince (location-trail reply or GET today): the clock both sides agree on. */
    val serverOutsideSinceMillis: Long? = null,
    /** A PENDING/APPROVED excuse covers today: the outside clock is paused. */
    val excusedToday: Boolean = false,
) {
    val isActive: Boolean get() = recordId != null
}

sealed interface TrailEffect {
    /** Start watching this office (low-power updates while inside). */
    data class Arm(val fence: TrailFence) : TrailEffect
    /** Outside: frequent high-accuracy updates. */
    data object StartContinuous : TrailEffect
    data object StopContinuous : TrailEffect
    /** The precise window opened or closed: the service follows [TrailMachine.setup]. */
    data object PreciseChanged : TrailEffect
    /** One fix, for an exit/enter (or a resume) with no fresh position in hand. */
    data object RequestFix : TrailEffect
    data object Flush : TrailEffect
    data object DisarmAll : TrailEffect
}

data class TrailReply(val tracking: Boolean, val stage: String?, val outsideSinceMillis: Long?, val nextAtMillis: Long?)

class TrailMachine(var state: TrailState = TrailState()) {

    /**
     * Set by [resume] when the app runs again after it was not, while outside: the first fresh fix
     * is sent at once, whatever the 15-minute rhythm says. Deliberately not persisted (it describes
     * this process, not the shift).
     */
    var sendNextFix = false

    /** What the GPS should be doing, derived from the state alone (level-triggered, iOS 13e7784). */
    data class Setup(val active: Boolean, val outside: Boolean, val precise: Boolean)

    val setup: Setup
        get() {
            if (!state.isActive || state.fence == null) return Setup(active = false, outside = false, precise = false)
            val outside = state.zone == TrailZone.OUTSIDE
            return Setup(active = true, outside = outside, precise = !outside && state.preciseSinceMillis != null)
        }

    companion object {
        /** Outside, standing still: the last position again this often. */
        const val SEND_INTERVAL_MS = 5 * 60_000L
        /** Outside, moving: a point once this far from the last one queued. */
        const val STEP_METERS = 50.0
        /** Outside points wait for one upload about this often (exit/enter never wait). */
        const val UPLOAD_EVERY_MS = 120_000L
        const val MAX_SHIFT_MS = 16 * 3_600_000L
        const val BATCH_LIMIT = 200
        const val PENDING_CAP = 1000
        const val FRESH_FIX_MS = 120_000L
        const val RETRY_AFTER_MS = 120_000L
        const val DECISIVE_ACCURACY = 100.0
        /** Under an hour on purpose: every clock hour gets a check even when the timer runs late. */
        const val PRESENCE_INTERVAL_MS = 50 * 60_000L
        const val PRECISE_TIMEOUT_MS = 45_000L
        /** A fix this good ends a presence check at once. */
        const val PRESENCE_ACCURACY = 50.0
        const val PRESENCE_RETRY_MS = 15 * 60_000L
        /** Coarser than this is a cell-tower position: never used for anything. */
        const val USABLE_ACCURACY = 1000.0

        /**
         * Inside, outside, or null when the fix is too vague. A margin of the fix's own accuracy on
         * the way OUT keeps GPS jitter at the edge from inventing exits.
         */
        fun decisive(p: TrailPoint, fence: TrailFence): Boolean? {
            val acc = p.accuracy ?: DECISIVE_ACCURACY
            if (acc < 0 || acc > DECISIVE_ACCURACY) return null
            val d = distance(p.lat, p.lng, fence.lat, fence.lng)
            if (d <= fence.radius) return true
            if (d > fence.radius + max(acc, 30.0)) return false
            return null
        }

        fun usable(p: TrailPoint): Boolean {
            val acc = p.accuracy ?: return true
            return acc >= 0 && acc <= USABLE_ACCURACY
        }

        fun better(p: TrailPoint, than: TrailPoint?): Boolean =
            than == null || (p.accuracy ?: DECISIVE_ACCURACY) < (than.accuracy ?: DECISIVE_ACCURACY)

        /** Haversine, metres. */
        fun distance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val r = 6_371_000.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
            return 2 * r * atan2(sqrt(a), sqrt(1 - a))
        }
    }

    // region lifecycle

    /** A check-in landed (live, queued, or found on launch). Idempotent for the same record. */
    fun start(recordId: String, checkInAtMillis: Long?, fence: TrailFence, now: Long): List<TrailEffect> {
        if (checkInAtMillis != null && now - checkInAtMillis > MAX_SHIFT_MS) return emptyList()
        if (state.refusedRecordId == recordId) return emptyList()
        if (state.recordId == recordId && state.fence == fence) return emptyList()
        val same = state.recordId == recordId
        state = if (same) {
            state.copy(checkInAtMillis = checkInAtMillis, fence = fence)
        } else {
            // A new day starts clean; an earlier record's points stay queued for that record.
            sendNextFix = false
            state.copy(
                recordId = recordId, checkInAtMillis = checkInAtMillis, fence = fence, zone = TrailZone.UNKNOWN,
                outsideSinceMillis = null, lastQueuedAtMillis = null, lastQueued = null, serverNextAtMillis = null, latest = null,
                pendingTag = null, stage = null, startedAtMillis = now, preciseSinceMillis = null, preciseBest = null,
                presenceTriedAtMillis = null, serverOutsideSinceMillis = null, excusedToday = false,
            )
        }
        return listOf(TrailEffect.Arm(fence))
    }

    /** What GET today says about the outside clock (its outsideSince, and whether an excuse pauses it). */
    fun noteToday(recordId: String, outsideSinceMillis: Long?, excused: Boolean) {
        if (state.recordId != recordId) return
        state = state.copy(
            excusedToday = excused,
            // Only while we agree the person is out: a stale value must not restart an ended episode.
            serverOutsideSinceMillis = if (state.zone == TrailZone.OUTSIDE) outsideSinceMillis ?: state.serverOutsideSinceMillis else state.serverOutsideSinceMillis,
        )
    }

    /**
     * Check-out, `tracking:false`, logout, or the shift cap. [keepUnsent]: true for a check-out
     * (still that record's evidence), false at logout and on `tracking:false`.
     */
    fun stop(keepUnsent: Boolean): List<TrailEffect> {
        val wasActive = state.isActive
        sendNextFix = false
        val pending = if (keepUnsent) state.pending else emptyList()
        state = TrailState(pending = pending, refusedRecordId = state.refusedRecordId)
        return buildList {
            if (wasActive) add(TrailEffect.DisarmAll)
            if (pending.isNotEmpty()) add(TrailEffect.Flush)
        }
    }

    /**
     * The app runs again after it was not (reopened after a kill, service restarted, boot). Nothing
     * watched the phone in between: a stale last fix is dropped (never re-sent stamped "now"), one
     * new fix is asked for, and outside that first fresh fix goes out at once (iOS 13e7784).
     */
    fun resume(now: Long): List<TrailEffect> {
        if (!state.isActive) return emptyList()
        val latest = state.latest
        if (latest != null && now - latest.atMillis > FRESH_FIX_MS) state = state.copy(latest = null)
        sendNextFix = state.zone == TrailZone.OUTSIDE
        // A window left open by the process that died is not this one's.
        state = state.copy(preciseSinceMillis = null, preciseBest = null)
        return askForFix(now)
    }

    // endregion

    // region inputs

    fun determined(inside: Boolean, lastKnown: TrailPoint?, now: Long): List<TrailEffect> {
        if (!state.isActive) return emptyList()
        val target = if (inside) TrailZone.INSIDE else TrailZone.OUTSIDE
        if (state.zone == target) return emptyList()
        // A zone answer that a fresh, clear fix contradicts is stale, not a crossing: take the fix's.
        val fence = state.fence
        if (lastKnown != null && now - lastKnown.atMillis <= FRESH_FIX_MS && fence != null) {
            val fixSays = decisive(lastKnown, fence)
            if (fixSays != null && fixSays != inside) return determined(fixSays, lastKnown, now)
        }
        val previous = state.zone
        state = state.copy(zone = target)
        // The exit/enter point replaces the point a resume was waiting for.
        sendNextFix = false
        return if (inside) {
            // Back inside: the episode ends and the next one starts from nothing.
            state = state.copy(outsideSinceMillis = null, serverOutsideSinceMillis = null, stage = null, serverNextAtMillis = null)
            // First answer after a check-in is "inside": the normal case, nothing to report.
            if (previous == TrailZone.UNKNOWN) listOf(TrailEffect.StopContinuous)
            else listOf(TrailEffect.StopContinuous) + tag(TrailPoint.Event.enter, lastKnown, now)
        } else {
            // Outside from the very first answer counts as leaving: the server's clock starts here.
            // Continuous updates take over; a presence check in progress has nothing left to do.
            state = state.copy(outsideSinceMillis = now, preciseSinceMillis = null, preciseBest = null)
            listOf(TrailEffect.StartContinuous) + tag(TrailPoint.Event.exit, lastKnown, now)
        }
    }

    /** A position from continuous updates or a one-shot request. */
    fun fix(raw: TrailPoint, now: Long): List<TrailEffect> {
        val recordId = state.recordId ?: return emptyList()
        // A cached first delivery can be from hours ago: it may not decide the zone, carry a tag,
        // or become the heartbeat's position.
        if (now - raw.atMillis > FRESH_FIX_MS) return emptyList()
        if (!usable(raw)) return emptyList()
        var p = raw.copy(recordId = recordId, event = TrailPoint.Event.point)
        state = state.copy(latest = p)
        val since = state.preciseSinceMillis
        if (since != null && p.atMillis >= since && better(p, state.preciseBest)) state = state.copy(preciseBest = p)

        // A clear fix settles the zone (also how a presence check finds a missed exit).
        val fence = state.fence
        val inside = fence?.let { decisive(p, it) }
        if (inside != null && (if (inside) TrailZone.INSIDE else TrailZone.OUTSIDE) != state.zone) {
            val fx = determined(inside, p, now)
            return if (state.zone == TrailZone.OUTSIDE) fx else fx + presence(p, now)
        }
        val tagged = state.pendingTag
        if (tagged != null) {
            state = state.copy(pendingTag = null)
            p = p.copy(event = tagged)
            enqueue(p, now)
            return listOf(TrailEffect.Flush) + if (state.zone == TrailZone.OUTSIDE) emptyList() else endPrecise(p)
        }
        // Right after a resume the first fresh fix goes out without waiting for the rhythm.
        if (state.zone == TrailZone.OUTSIDE && (isDue(now) || sendNextFix || moved(p))) {
            // Right after a resume the point goes up at once; otherwise it joins the next batch.
            val urgent = sendNextFix
            sendNextFix = false
            enqueue(p, now)
            return if (urgent || uploadDue(now)) listOf(TrailEffect.Flush) else emptyList()
        }
        return if (state.zone == TrailZone.OUTSIDE) emptyList() else presence(p, now)
    }

    /** Inside or unknown: a good fix becomes the hourly check when one is due; closes a satisfied window. */
    private fun presence(p: TrailPoint, now: Long): List<TrailEffect> {
        if (state.zone == TrailZone.OUTSIDE) return emptyList()
        val fx = mutableListOf<TrailEffect>()
        val good = (p.accuracy ?: DECISIVE_ACCURACY) <= PRESENCE_ACCURACY
        // Inside a window only a fix taken after it opened counts.
        val inWindow = state.preciseSinceMillis?.let { p.atMillis >= it } ?: true
        if (good && inWindow && isPresenceDue(now)) {
            enqueue(presencePoint(p), now)
            fx += TrailEffect.Flush
        }
        return fx + endPrecise(p)
    }

    /** About once a minute: the heartbeat outside, the presence clock inside, retries, the shift cap. */
    fun tick(now: Long): List<TrailEffect> {
        val checkIn = state.checkInAtMillis
        if (state.isActive && checkIn != null && now - checkIn > MAX_SHIFT_MS) return stop(keepUnsent = true)
        val fx = mutableListOf<TrailEffect>()
        if (state.isActive && state.zone == TrailZone.OUTSIDE && isDue(now)) {
            val latest = state.latest
            if (latest != null) {
                // Standing still outside delivers no fixes past the distance filter; re-sending that
                // position with the current time is true to within the filter.
                enqueue(latest.copy(id = UUID.randomUUID().toString(), atMillis = now, event = TrailPoint.Event.point), now)
                if (uploadDue(now)) fx += TrailEffect.Flush
            } else {
                fx += TrailEffect.RequestFix
            }
        }
        if (state.isActive && state.zone != TrailZone.OUTSIDE) fx += presenceTick(now)
        if (TrailEffect.Flush !in fx && state.pending.isNotEmpty() && uploadDue(now)) {
            val failed = state.lastFailureAtMillis
            if (failed != null && now - failed < RETRY_AFTER_MS) return fx
            fx += TrailEffect.Flush
        }
        return fx
    }

    private fun presenceTick(now: Long): List<TrailEffect> {
        val since = state.preciseSinceMillis
        if (since != null) {
            if (now - since < PRECISE_TIMEOUT_MS) return emptyList()
            // Timed out without a good fix: the best one still says something (the server calls a
            // vague one "unclear"); with none at all, nothing is invented.
            val fx = mutableListOf<TrailEffect>()
            val best = state.preciseBest
            if (best != null && isPresenceDue(now)) {
                enqueue(presencePoint(best), now)
                fx += TrailEffect.Flush
            }
            state = state.copy(preciseSinceMillis = null, preciseBest = null)
            return fx + TrailEffect.PreciseChanged
        }
        if (!isPresenceDue(now)) return emptyList()
        val tried = state.presenceTriedAtMillis
        if (tried != null && now - tried < PRESENCE_RETRY_MS) return emptyList()
        // A fresh, good fix already in hand needs no GPS at all.
        val latest = state.latest
        if (latest != null && now - latest.atMillis <= FRESH_FIX_MS && (latest.accuracy ?: DECISIVE_ACCURACY) <= PRESENCE_ACCURACY) {
            enqueue(presencePoint(latest), now)
            return listOf(TrailEffect.Flush)
        }
        state = state.copy(presenceTriedAtMillis = now, preciseSinceMillis = now, preciseBest = null)
        return listOf(TrailEffect.PreciseChanged)
    }

    /** Due when inside/unknown and no point was queued for [PRESENCE_INTERVAL_MS] (any point counts). */
    fun isPresenceDue(now: Long): Boolean {
        if (!state.isActive || state.zone == TrailZone.OUTSIDE) return false
        val anchor = state.lastQueuedAtMillis ?: state.checkInAtMillis ?: state.startedAtMillis ?: return true
        return now - anchor >= PRESENCE_INTERVAL_MS
    }

    // endregion

    // region upload bookkeeping

    /** The oldest record's points, at most [BATCH_LIMIT]. */
    fun nextBatch(): Pair<String, List<TrailPoint>>? {
        val first = state.pending.firstOrNull() ?: return null
        return first.recordId to state.pending.filter { it.recordId == first.recordId }.take(BATCH_LIMIT)
    }

    fun sent(ids: Set<String>, recordId: String, reply: TrailReply, now: Long): List<TrailEffect> {
        state = state.copy(pending = state.pending.filterNot { it.id in ids }, lastFailureAtMillis = null, lastUploadAtMillis = now)
        // A reply about an older record says nothing about the one being tracked now.
        if (recordId != state.recordId) return if (state.pending.isEmpty()) emptyList() else listOf(TrailEffect.Flush)
        if (!reply.tracking) {
            // Final: checked out elsewhere, auto checked out, exempt, or switched off.
            val rest = state.pending.filterNot { it.recordId == recordId }
            val fx = stop(keepUnsent = false).toMutableList()
            state = state.copy(pending = rest, refusedRecordId = recordId)
            if (rest.isNotEmpty()) fx += TrailEffect.Flush
            return fx
        }
        state = state.copy(stage = reply.stage, serverNextAtMillis = reply.nextAtMillis, serverOutsideSinceMillis = reply.outsideSinceMillis)
        return if (state.pending.isEmpty()) emptyList() else listOf(TrailEffect.Flush)
    }

    /** [dropBatch]: a refusal retrying cannot change (malformed, not yours), or it blocks the queue. */
    fun failed(ids: Set<String>, dropBatch: Boolean, now: Long) {
        state = state.copy(
            lastFailureAtMillis = now,
            pending = if (dropBatch) state.pending.filterNot { it.id in ids } else state.pending,
        )
    }

    // endregion

    /** Moved a clear [STEP_METERS] from the last queued point (a vague fix never counts as moving). */
    private fun moved(p: TrailPoint): Boolean {
        val last = state.lastQueued ?: return false
        if ((p.accuracy ?: DECISIVE_ACCURACY) > DECISIVE_ACCURACY) return false
        return distance(p.lat, p.lng, last.lat, last.lng) >= STEP_METERS
    }

    /** Outside, points go up about every [UPLOAD_EVERY_MS]; inside anything pending goes at once. */
    fun uploadDue(now: Long): Boolean {
        if (state.zone != TrailZone.OUTSIDE || !state.isActive) return true
        val last = state.lastUploadAtMillis ?: return true
        return now - last >= UPLOAD_EVERY_MS
    }

    fun isDue(now: Long): Boolean {
        val last = state.lastQueuedAtMillis ?: return true
        var due = last + SEND_INTERVAL_MS
        val asked = state.serverNextAtMillis
        if (asked != null && asked > last && asked < due) due = asked
        return now >= due
    }

    private fun tag(event: TrailPoint.Event, lastKnown: TrailPoint?, now: Long): List<TrailEffect> {
        val recordId = state.recordId ?: return emptyList()
        // A cell-level cached fix is skipped, so an exit/enter is never placed kilometres off.
        val candidate = listOfNotNull(lastKnown, state.latest).firstOrNull { now - it.atMillis <= FRESH_FIX_MS && usable(it) }
        if (candidate != null) {
            state = state.copy(pendingTag = null)
            enqueue(candidate.copy(id = UUID.randomUUID().toString(), recordId = recordId, event = event), now)
            return listOf(TrailEffect.Flush)
        }
        state = state.copy(pendingTag = event)
        return askForFix(now)
    }

    /** Outside a one-shot fix; inside the precise window, which the tick closes after 45 s. */
    private fun askForFix(now: Long): List<TrailEffect> {
        if (state.zone == TrailZone.OUTSIDE) return listOf(TrailEffect.RequestFix)
        val opened = state.preciseSinceMillis == null
        if (opened) state = state.copy(preciseSinceMillis = now, preciseBest = null)
        return if (opened) listOf(TrailEffect.RequestFix, TrailEffect.PreciseChanged) else listOf(TrailEffect.RequestFix)
    }

    private fun endPrecise(p: TrailPoint): List<TrailEffect> {
        val since = state.preciseSinceMillis ?: return emptyList()
        if (p.atMillis < since || (p.accuracy ?: DECISIVE_ACCURACY) > PRESENCE_ACCURACY) return emptyList()
        state = state.copy(preciseSinceMillis = null, preciseBest = null)
        return listOf(TrailEffect.PreciseChanged)
    }

    private fun presencePoint(p: TrailPoint) =
        p.copy(id = UUID.randomUUID().toString(), recordId = state.recordId ?: p.recordId, event = TrailPoint.Event.presence)

    private fun enqueue(p: TrailPoint, now: Long) {
        var pending = state.pending + p
        if (pending.size > PENDING_CAP) pending = pending.drop(pending.size - PENDING_CAP)
        state = state.copy(pending = pending, lastQueuedAtMillis = now, lastQueued = p)
    }
}
