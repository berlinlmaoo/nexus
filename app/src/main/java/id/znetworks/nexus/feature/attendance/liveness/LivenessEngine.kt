package id.znetworks.nexus.feature.attendance.liveness

import kotlin.math.abs
import kotlin.math.min

/**
 * The face check's decisions, ported from iOS `LivenessCaptureView` (the engine half) with the same
 * thresholds (PRD REQ-ATT-02): look straight → turn one way → turn the other way → blink → hold
 * still → capture. Pure: frames in, state out, so every rule is tested on the JVM.
 *
 * It proves a live person was in front of the phone. It does not check WHO (REQ-ATT-03).
 */
class LivenessEngine(private val now: () -> Long = System::currentTimeMillis) {

    enum class Step { CENTER, SIDE_A, SIDE_B, BLINK, CAPTURE }
    enum class Presence { NONE, SMALL, OFF_CENTRE, OK }
    enum class Notice { FACE_LOST }

    /** One analysed frame. Geometry is relative to the upright frame; yaw in degrees (ML Kit). */
    data class Frame(
        val faceFound: Boolean,
        val yawDeg: Float = 0f,
        /** 0..1, null when the classifier could not tell. */
        val leftEyeOpen: Float? = null,
        val rightEyeOpen: Float? = null,
        /** Face's longer side over the frame's shorter side. */
        val sizeFraction: Float = 0f,
        /** Face centre minus frame centre, as fractions of the frame (−0.5..0.5). */
        val offsetX: Float = 0f,
        val offsetY: Float = 0f,
    )

    data class State(
        val step: Step = Step.CENTER,
        val presence: Presence = Presence.NONE,
        val turnProgress: Float = 0f,
        val eyesClosed: Boolean = false,
        val notice: Notice? = null,
        /** Stuck on one step for 15 s: the screen shows the longer hint. */
        val stalled: Boolean = false,
        /** Every step passed on a steady, frontal, open-eyed face: take the photo now. */
        val readyToCapture: Boolean = false,
    )

    var state = State()
        private set

    private var holdFrames = 0
    private var lostFrames = 0
    private var side = 0
    private var blinkSeen = false
    private val openness = ArrayDeque<Float>()
    private var cooldownUntil = 0L
    private var stepStart = now()

    /** Frames since the last face, exposed for the dark-room heuristic. */
    val framesWithoutFace: Int get() = lostFrames

    fun onFrame(f: Frame): State {
        if (state.readyToCapture) return state
        val t = now()
        if (!f.faceFound) {
            lostFrames++
            // Gone for ~1.5 s after the first move: whoever comes back starts over, so a photo
            // cannot be swapped in between moves.
            if (lostFrames > LOST_FRAMES_LIMIT && state.step > Step.CENTER) {
                reset(t)
                state = state.copy(notice = Notice.FACE_LOST)
            }
            holdFrames = 0
            state = state.copy(presence = Presence.NONE, turnProgress = 0f, eyesClosed = false)
            return state
        }
        lostFrames = 0

        val presence = when {
            f.sizeFraction < MIN_FACE_FRACTION -> Presence.SMALL
            abs(f.offsetX) > MAX_OFFSET || abs(f.offsetY) > MAX_OFFSET -> Presence.OFF_CENTRE
            else -> Presence.OK
        }
        val yaw = f.yawDeg

        // Blink reference: the widest the eyes have been in the last ~1.5 s, so narrow and wide
        // eyes both work; a blink is a dip well below that, then a recovery.
        val open = eyeOpenness(f)
        var closed = false
        if (open != null) {
            openness.addLast(open)
            if (openness.size > OPENNESS_WINDOW) openness.removeFirst()
        }
        val ref = openness.maxOrNull()
        if (open != null && ref != null && ref > MIN_REF) closed = open < ref * BLINK_CLOSED

        val progress = when (state.step) {
            Step.SIDE_A -> min(1f, abs(yaw) / TURNED_DEG)
            Step.SIDE_B -> if (sign(yaw) == -side) min(1f, abs(yaw) / TURNED_DEG) else 0f
            else -> 0f
        }
        val stalled = t - stepStart > STALL_MS
        state = state.copy(presence = presence, turnProgress = progress, eyesClosed = closed, stalled = stalled)

        if (presence != Presence.OK || t < cooldownUntil) {
            holdFrames = 0
            return state
        }

        when (state.step) {
            Step.CENTER -> if (abs(yaw) < FRONTAL_DEG) { if (held(6)) advance(t) } else holdFrames = 0
            Step.SIDE_A -> if (abs(yaw) >= TURNED_DEG) {
                side = sign(yaw)
                if (held(3)) advance(t)
            } else holdFrames = 0
            // The first turn may go either way (yaw sign depends on mirroring); the second must be
            // the opposite one.
            Step.SIDE_B -> if (abs(yaw) >= TURNED_DEG && sign(yaw) == -side) { if (held(3)) advance(t) } else holdFrames = 0
            Step.BLINK -> {
                if (abs(yaw) < FRONTAL_DEG + BLINK_YAW_SLACK_DEG && open != null && ref != null && ref > MIN_REF) {
                    if (!blinkSeen) {
                        if (open < ref * BLINK_CLOSED) blinkSeen = true
                    } else if (open > ref * BLINK_REOPENED) {
                        advance(t)
                    }
                }
            }
            Step.CAPTURE -> if (abs(yaw) < FRONTAL_DEG && !closed) {
                if (held(4)) state = state.copy(readyToCapture = true)
            } else holdFrames = 0
        }
        return state
    }

    /** The captured photo turned out unusable: go back to the last step and hold still again. */
    fun retryCapture() {
        holdFrames = 0
        state = state.copy(readyToCapture = false, step = Step.CAPTURE)
    }

    fun clearNotice() {
        state = state.copy(notice = null)
    }

    private fun held(frames: Int): Boolean {
        holdFrames++
        return holdFrames >= frames
    }

    private fun advance(t: Long) {
        holdFrames = 0
        blinkSeen = false
        stepStart = t
        cooldownUntil = t + COOLDOWN_MS
        val next = Step.entries.getOrElse(state.step.ordinal + 1) { Step.CAPTURE }
        state = state.copy(step = next, turnProgress = 0f, notice = null, stalled = false)
    }

    private fun reset(t: Long) {
        holdFrames = 0
        side = 0
        blinkSeen = false
        openness.clear()
        stepStart = t
        cooldownUntil = t + COOLDOWN_MS
        state = state.copy(step = Step.CENTER, turnProgress = 0f, stalled = false)
    }

    private fun sign(yaw: Float) = if (yaw > 0) 1 else -1

    private fun eyeOpenness(f: Frame): Float? {
        val l = f.leftEyeOpen
        val r = f.rightEyeOpen
        return when {
            l != null && r != null -> (l + r) / 2
            else -> l ?: r
        }
    }

    companion object {
        /** iOS: 0.20 rad. */
        const val FRONTAL_DEG = 11.5f
        /** iOS: 0.38 rad. */
        const val TURNED_DEG = 21.8f
        /** iOS allows frontal + 0.12 rad during the blink. */
        const val BLINK_YAW_SLACK_DEG = 6.9f
        const val BLINK_CLOSED = 0.70f
        const val BLINK_REOPENED = 0.85f
        const val MIN_REF = 0.05f
        const val OPENNESS_WINDOW = 45
        const val LOST_FRAMES_LIMIT = 45
        const val MIN_FACE_FRACTION = 0.30f
        const val MAX_OFFSET = 0.2f
        const val COOLDOWN_MS = 500L
        const val STALL_MS = 15_000L
    }
}
