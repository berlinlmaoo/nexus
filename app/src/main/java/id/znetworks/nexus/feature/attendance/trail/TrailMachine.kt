package id.znetworks.nexus.feature.attendance.trail

import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

// The decision half of "live location while checked in" (PRD §2.9), ported from iOS
// WorkTrailPolicy.swift with the same rules and numbers. No Android types in here: the service
// carries the effects out, this decides them, and every rule is a JVM test.
//
//   • only between a check-in the server accepted and the check-out;
//   • inside the office nothing is sent;
//   • outside, one point about every 15 minutes, plus one on leaving and one on coming back;
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
    @Suppress("EnumEntryName")
    enum class Event { exit, enter, point }
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
) {
    val isActive: Boolean get() = recordId != null
}

sealed interface TrailEffect {
    /** Start watching this office (low-power updates while inside). */
    data class Arm(val fence: TrailFence) : TrailEffect
    /** Outside: frequent balanced-accuracy updates. */
    data object StartContinuous : TrailEffect
    data object StopContinuous : TrailEffect
    /** One fix, for an exit/enter that happened with no recent position. */
    data object RequestFix : TrailEffect
    data object Flush : TrailEffect
    data object DisarmAll : TrailEffect
}

data class TrailReply(val tracking: Boolean, val stage: String?, val outsideSinceMillis: Long?, val nextAtMillis: Long?)

class TrailMachine(var state: TrailState = TrailState()) {

    companion object {
        const val SEND_INTERVAL_MS = 15 * 60_000L
        const val MAX_SHIFT_MS = 16 * 3_600_000L
        const val BATCH_LIMIT = 200
        const val PENDING_CAP = 1000
        const val FRESH_FIX_MS = 120_000L
        const val RETRY_AFTER_MS = 120_000L
        const val DECISIVE_ACCURACY = 100.0

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
            state.copy(
                recordId = recordId, checkInAtMillis = checkInAtMillis, fence = fence, zone = TrailZone.UNKNOWN,
                outsideSinceMillis = null, lastQueuedAtMillis = null, serverNextAtMillis = null, latest = null,
                pendingTag = null, stage = null,
            )
        }
        return listOf(TrailEffect.Arm(fence))
    }

    /**
     * Check-out, `tracking:false`, logout, or the shift cap. [keepUnsent]: true for a check-out
     * (still that record's evidence), false at logout (the next person must not upload the last
     * one's trail) and on `tracking:false`.
     */
    fun stop(keepUnsent: Boolean): List<TrailEffect> {
        val wasActive = state.isActive
        val pending = if (keepUnsent) state.pending else emptyList()
        state = TrailState(pending = pending, refusedRecordId = state.refusedRecordId)
        return buildList {
            if (wasActive) add(TrailEffect.DisarmAll)
            if (pending.isNotEmpty()) add(TrailEffect.Flush)
        }
    }

    // endregion

    // region inputs

    fun determined(inside: Boolean, lastKnown: TrailPoint?, now: Long): List<TrailEffect> {
        if (!state.isActive) return emptyList()
        val target = if (inside) TrailZone.INSIDE else TrailZone.OUTSIDE
        if (state.zone == target) return emptyList()
        val previous = state.zone
        state = state.copy(zone = target)
        return if (inside) {
            state = state.copy(outsideSinceMillis = null)
            // First answer after a check-in is "inside": the normal case, nothing to report.
            if (previous == TrailZone.UNKNOWN) listOf(TrailEffect.StopContinuous)
            else listOf(TrailEffect.StopContinuous) + tag(TrailPoint.Event.enter, lastKnown, now)
        } else {
            // Outside from the very first answer counts as leaving: the server's clock starts here.
            state = state.copy(outsideSinceMillis = now)
            listOf(TrailEffect.StartContinuous) + tag(TrailPoint.Event.exit, lastKnown, now)
        }
    }

    /** A position from continuous updates or a one-shot request. */
    fun fix(raw: TrailPoint, now: Long): List<TrailEffect> {
        val recordId = state.recordId ?: return emptyList()
        var p = raw.copy(recordId = recordId, event = TrailPoint.Event.point)
        state = state.copy(latest = p)

        val fence = state.fence
        val inside = fence?.let { decisive(p, it) }
        if (inside != null && (if (inside) TrailZone.INSIDE else TrailZone.OUTSIDE) != state.zone) {
            return determined(inside, p, now)
        }
        val tagged = state.pendingTag
        if (tagged != null) {
            state = state.copy(pendingTag = null)
            p = p.copy(event = tagged)
            enqueue(p, now)
            return listOf(TrailEffect.Flush)
        }
        if (state.zone == TrailZone.OUTSIDE && isDue(now)) {
            enqueue(p, now)
            return listOf(TrailEffect.Flush)
        }
        return emptyList()
    }

    /** About once a minute: the heartbeat while outside, the upload retry, the shift cap. */
    fun tick(now: Long): List<TrailEffect> {
        val checkIn = state.checkInAtMillis
        if (state.isActive && checkIn != null && now - checkIn > MAX_SHIFT_MS) return stop(keepUnsent = true)
        val fx = mutableListOf<TrailEffect>()
        if (state.isActive && state.zone == TrailZone.OUTSIDE && isDue(now)) {
            val latest = state.latest
            if (latest != null) {
                // Standing still outside delivers no fixes past the distance filter; re-sending that
                // position with the current time is true to within the filter, and keeps a person
                // sitting in a café from looking like a phone that went silent.
                enqueue(latest.copy(id = UUID.randomUUID().toString(), atMillis = now, event = TrailPoint.Event.point), now)
                fx += TrailEffect.Flush
            } else {
                fx += TrailEffect.RequestFix
            }
        }
        if (TrailEffect.Flush !in fx && state.pending.isNotEmpty()) {
            val failed = state.lastFailureAtMillis
            if (failed != null && now - failed < RETRY_AFTER_MS) return fx
            fx += TrailEffect.Flush
        }
        return fx
    }

    // endregion

    // region upload bookkeeping

    /** The oldest record's points, at most [BATCH_LIMIT]. */
    fun nextBatch(): Pair<String, List<TrailPoint>>? {
        val first = state.pending.firstOrNull() ?: return null
        return first.recordId to state.pending.filter { it.recordId == first.recordId }.take(BATCH_LIMIT)
    }

    fun sent(ids: Set<String>, recordId: String, reply: TrailReply, now: Long): List<TrailEffect> {
        state = state.copy(pending = state.pending.filterNot { it.id in ids }, lastFailureAtMillis = null)
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
        state = state.copy(stage = reply.stage, serverNextAtMillis = reply.nextAtMillis)
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

    fun isDue(now: Long): Boolean {
        val last = state.lastQueuedAtMillis ?: return true
        var due = last + SEND_INTERVAL_MS
        val asked = state.serverNextAtMillis
        if (asked != null && asked > last && asked < due) due = asked
        return now >= due
    }

    private fun tag(event: TrailPoint.Event, lastKnown: TrailPoint?, now: Long): List<TrailEffect> {
        val recordId = state.recordId ?: return emptyList()
        val p = lastKnown ?: state.latest
        if (p != null && now - p.atMillis <= FRESH_FIX_MS) {
            state = state.copy(pendingTag = null)
            enqueue(p.copy(id = UUID.randomUUID().toString(), recordId = recordId, event = event), now)
            return listOf(TrailEffect.Flush)
        }
        state = state.copy(pendingTag = event)
        return listOf(TrailEffect.RequestFix)
    }

    private fun enqueue(p: TrailPoint, now: Long) {
        var pending = state.pending + p
        if (pending.size > PENDING_CAP) pending = pending.drop(pending.size - PENDING_CAP)
        state = state.copy(pending = pending, lastQueuedAtMillis = now)
    }
}
