package id.znetworks.nexus.feature.home

import id.znetworks.nexus.feature.projects.BoardTask
import id.znetworks.nexus.feature.projects.dueDate
import kotlinx.serialization.Serializable
import java.time.LocalDate

// GET /api/gamification/me (API.md, Gamification). Tolerant like every model.

@Serializable
data class XpInfo(
    val totalXp: Int = 0,
    val level: Int = 0,
    val levelName: String? = null,
    val floor: Int? = null,
    val nextFloor: Int? = null,
    val pct: Double? = null,
)

@Serializable
data class Streak(val current: Int = 0, val longest: Int = 0)

@Serializable
data class Quest(
    val key: String,
    val title: String = "",
    val description: String? = null,
    val progress: Int = 0,
    val target: Int = 0,
    val xpReward: Int = 0,
    val deadline: String? = null,
    val claimed: Boolean? = null,
    val claimable: Boolean? = null,
)

@Serializable
data class Gamification(val xp: XpInfo = XpInfo(), val streak: Streak = Streak(), val quests: List<Quest> = emptyList()) {
    val questsDone: Int get() = quests.count { it.claimed == true }
    /** 0..1 for the bar; the server's pct may be 0..1 or 0..100. */
    val levelFraction: Float get() {
        val p = xp.pct ?: run {
            val floor = xp.floor ?: return 0f
            val next = xp.nextFloor ?: return 1f
            if (next <= floor) return 1f
            (xp.totalXp - floor).toDouble() / (next - floor)
        }
        return (if (p > 1.0) p / 100.0 else p).toFloat().coerceIn(0f, 1f)
    }
}

@Serializable
data class ClaimResult(val xp: XpInfo? = null)

object HomeLogic {
    enum class Greeting { MORNING, AFTERNOON, EVENING }

    /** By the office clock (iOS: 04–11 morning, 11–18 afternoon, else evening). */
    fun greeting(hour: Int) = when (hour) {
        in 4..10 -> Greeting.MORNING
        in 11..17 -> Greeting.AFTERNOON
        else -> Greeting.EVENING
    }

    /** The agenda strip: [days] days from [today], and each day's tasks by due date. */
    fun agenda(tasks: List<BoardTask>, today: LocalDate, days: Int = 14): Map<LocalDate, List<BoardTask>> {
        val range = (0 until days).map { today.plusDays(it.toLong()) }.toSet()
        return tasks.mapNotNull { t -> dueDate(t.dueDate)?.takeIf { it in range }?.let { it to t } }
            .groupBy({ it.first }, { it.second })
    }
}

/** The XP policy as the web's XpRulesCard shows it. Policy, not config: no endpoint has it. */
object XpRules {
    data class Row(val xp: String, val rule: Int, val note: Int, val auto: Boolean)
}
