package id.znetworks.nexus.feature.attendance.trail

/**
 * What the ongoing "Work session" notification says while outside the office (UPDATES §9, the
 * Android side of the iOS Live Activity). Mirrors the server's clock (lib/attendance-outside.ts):
 * reminder at 90 min, warning at 120, automatic offsite check-out at the later of +150 min and
 * warning +30; an excuse for today (PENDING/APPROVED) pauses it; going back inside resets it.
 * Computed on the phone from the tracker's state, so it holds when a push is lost.
 */
object OutsideClock {
    const val REMIND_MS = 90 * 60_000L
    const val WARN_MS = 120 * 60_000L
    const val AUTO_MS = 150 * 60_000L

    enum class Level { OUTSIDE, REMIND, WARN }

    data class Outside(val sinceMillis: Long, val autoAtMillis: Long, val level: Level)

    const val PAUSED = "paused_permit"
    /** A server outsideSince this much earlier than the phone's own exit is an older episode. */
    const val SERVER_SINCE_SLACK_MS = 30 * 60_000L

    /**
     * Null = the normal (inside) notification. Port of iOS WorkTrailMachine.outsideStatus (8a36fd2):
     *   • inside by the phone's reckoning, not tracking, an excuse holding the clock, or already
     *     checked out by it → normal;
     *   • the episode starts at the server's outsideSince when the server has heard of THIS exit
     *     (same times as the pushes), else the phone's exit;
     *   • the clock runs from that start, or from a later restart the server's nextAt reveals (an
     *     excuse rejected or withdrawn mid-episode restarts it); never a stage below the server's;
     *   • the automatic check-out is the server's own time once warned, else start + 150 min.
     */
    fun present(s: TrailState, now: Long): Outside? {
        if (!s.isActive || s.zone == TrailZone.INSIDE) return null
        if (s.stage == PAUSED || s.stage == "auto_checked_out") return null
        val local = if (s.zone == TrailZone.OUTSIDE) s.outsideSinceMillis else null
        var since = local
        val server = s.serverOutsideSinceMillis
        val heard = s.serverOutsideSinceAtMillis
        if (server != null && heard != null && server <= now + 5 * 60_000L) {
            since = if (local == null) server // zone not known here yet: the server's word is all there is
            else if (heard >= local && server >= local - SERVER_SINCE_SLACK_MS) server else local
        }
        since ?: return null

        var clockFrom = since
        var serverRank = 0
        var warnedAutoAt: Long? = null
        val stageAt = s.serverStageAtMillis
        val next = s.serverNextAtMillis
        if (stageAt != null && stageAt >= since && next != null) {
            when (s.stage) {
                "outside" -> clockFrom = maxOf(since, next - REMIND_MS)
                "reminded" -> { clockFrom = maxOf(since, next - WARN_MS); serverRank = 1 }
                "warned" -> { warnedAutoAt = next; serverRank = 2 }
            }
        }
        clockFrom = minOf(clockFrom, now)
        val elapsed = now - clockFrom
        val rank = maxOf(serverRank, if (elapsed >= WARN_MS) 2 else if (elapsed >= REMIND_MS) 1 else 0)
        val level = when (rank) { 2 -> Level.WARN; 1 -> Level.REMIND; else -> Level.OUTSIDE }
        return Outside(since, warnedAutoAt ?: (clockFrom + AUTO_MS), level)
    }

    const val HOUR_ALERT_MS = 60 * 60_000L

    enum class Alert { LEFT, HOUR }

    /**
     * The two local notifications of UPDATES §10: one on leaving, one at minute 60 with the time
     * left. Each once per episode ([posted] holds what already went out for [episode]); none while
     * paused or inside, and whatever was shown is taken back then ([cancel]).
     */
    data class AlertStep(val post: Alert?, val cancel: Boolean)

    fun alertStep(s: TrailState, now: Long, posted: Set<Alert>): AlertStep {
        val o = present(s, now) ?: return AlertStep(null, cancel = true)
        return when {
            // Found out late (phone off for an hour): only the hour one, it says everything.
            now - o.sinceMillis >= HOUR_ALERT_MS -> AlertStep(if (Alert.HOUR in posted) null else Alert.HOUR, cancel = false)
            Alert.LEFT !in posted -> AlertStep(Alert.LEFT, cancel = false)
            else -> AlertStep(null, cancel = false)
        }
    }

    /** One key per episode: the phone's own exit time (the server's may arrive later and differ). */
    fun episode(s: TrailState): Long? = s.outsideSinceMillis ?: s.serverOutsideSinceMillis
}
