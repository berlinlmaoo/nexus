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

    /** Null = the normal (inside) notification. */
    fun present(s: TrailState, now: Long): Outside? {
        if (!s.isActive || s.zone != TrailZone.OUTSIDE || s.excusedToday || s.stage == "paused_permit") return null
        // The server's start wins so the phone and the server show the same time; ours until it answers.
        val since = s.serverOutsideSinceMillis ?: s.outsideSinceMillis ?: return null
        val elapsed = now - since
        // Once warned the server names the exact moment (nextAt = autoAt); before that it is projected.
        val autoAt = s.serverNextAtMillis?.takeIf { s.stage == "warned" } ?: (since + AUTO_MS)
        val level = when {
            elapsed >= WARN_MS || s.stage == "warned" -> Level.WARN
            elapsed >= REMIND_MS || s.stage == "reminded" -> Level.REMIND
            else -> Level.OUTSIDE
        }
        return Outside(since, autoAt, level)
    }
}
