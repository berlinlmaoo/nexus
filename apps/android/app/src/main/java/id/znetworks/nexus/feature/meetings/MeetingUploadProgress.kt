package id.znetworks.nexus.feature.meetings

import kotlin.math.roundToInt

/** A single reading drives both the bar and byte label; WorkManager may be newer than the API poll. */
data class MeetingUploadProgress(val received: Long, val total: Long) {
    val fraction: Float get() = if (total > 0) received.toFloat() / total else 0f
    val percent: Int get() = (fraction * 100).roundToInt().coerceIn(0, 100)

    companion object {
        fun resolve(audio: MeetingAudio, workReceived: Long? = null, workTotal: Long? = null, completed: Boolean = false): MeetingUploadProgress {
            val total = audio.bytes.coerceAtLeast(0)
            // Ignore another/stale file's progress, including invalid values after a retry.
            val live = workReceived?.takeIf { workTotal == total && it in 0..total } ?: 0
            // WorkManager clears progress on success before the next API poll changes the screen's step.
            return MeetingUploadProgress(if (completed) total else maxOf(audio.received, live).coerceIn(0, total), total)
        }
    }
}
