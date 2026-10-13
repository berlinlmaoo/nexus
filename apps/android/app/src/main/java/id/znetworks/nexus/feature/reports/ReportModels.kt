package id.znetworks.nexus.feature.reports

import id.znetworks.nexus.core.net.ApiClient
import kotlinx.serialization.Serializable

// API.md §2.6 Reports (people): the attendance period 28th→27th; staff see only themselves,
// managers their direct reports (decision of 24 Sep 2026).

@Serializable data class Ratio(val num: Int = 0, val den: Int = 0) {
    /** 0..100, or null when there is nothing to divide by. */
    val pct: Int? get() = if (den > 0) Math.round(num * 100f / den) else null
}

@Serializable
data class ReportPeriod(val key: String? = null, val from: String? = null, val to: String? = null, val isCurrent: Boolean = false,
                        val days: Int? = null, val daysElapsed: Int? = null)

@Serializable
data class Headline(
    val assigned: Int = 0, val completed: Int = 0, val onTime: Ratio = Ratio(), val overdue: Int = 0, val medianCycleDays: Double? = null,
    val present: Int = 0, val late: Int = 0, val lateMinutes: Int = 0, val earlyLeave: Int = 0, val absent: Int = 0,
    val leave: Int = 0, val sick: Int = 0, val permit: Int = 0, val dayOff: Int = 0, val avgWorkedMinutes: Int? = null,
    val attendanceRate: Ratio = Ratio(), val lateRate: Ratio = Ratio(), val reflectionRate: Ratio = Ratio(),
    val xpScore: Int = 0, val xpPenalty: Int = 0,
)

@Serializable data class TeamRef(val id: String? = null, val name: String? = null)
@Serializable data class Flags(val overdue3: Boolean = false, val late3: Boolean = false, val lowReflections: Boolean = false)

@Serializable
data class RosterRow(val userId: String, val name: String? = null, val email: String? = null, val avatar: String? = null, val role: String? = null,
                     val teams: List<TeamRef> = emptyList(), val headline: Headline = Headline(), val previous: Headline? = null,
                     val flags: Flags = Flags(), val flagCount: Int = 0, val leftAt: String? = null)

@Serializable
data class ReportRoster(val scope: String? = null, val period: ReportPeriod? = null, val previousPeriod: ReportPeriod? = null,
                        val team: TeamRef? = null, val rows: List<RosterRow> = emptyList())

@Serializable data class OverdueTask(val id: String, val title: String? = null, val projectName: String? = null, val dueDate: String? = null,
                                     val daysOverdue: Int? = null, val priority: String? = null)
@Serializable data class Week(val from: String? = null, val to: String? = null, val completed: Int = 0, val onTime: Int = 0)
@Serializable data class PerProject(val projectId: String? = null, val projectName: String? = null, val completed: Int = 0, val open: Int = 0, val overdue: Int = 0)

@Serializable
data class Work(val assigned: Int = 0, val completed: Int = 0, val overdueNow: Int = 0, val overdueList: List<OverdueTask> = emptyList(),
                val openTotal: Int = 0, val dueNext7: Int = 0, val medianCycleDays: Double? = null,
                val weekly: List<Week> = emptyList(), val perProject: List<PerProject> = emptyList())

@Serializable data class Level(val level: Int = 0, val name: String? = null, val isMax: Boolean = false)
@Serializable data class StreakInfo(val current: Int = 0, val longest: Int = 0)
@Serializable data class Penalty(val kind: String = "", val count: Int = 0, val xp: Int = 0)
@Serializable
data class XpBlock(val periodScore: Int = 0, val level: Level? = null, val streak: StreakInfo? = null, val penalties: List<Penalty> = emptyList(), val penaltyTotal: Int = 0)

@Serializable
data class PersonRef(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null, val isSelf: Boolean = false,
                     /** Left the workspace (offboarding, 8 Oct): last working day. */
                     val leftAt: String? = null)

@Serializable
data class PersonReport(val person: PersonRef = PersonRef(), val period: ReportPeriod? = null, val previousPeriod: ReportPeriod? = null,
                        val headline: Headline = Headline(), val previous: Headline? = null, val work: Work = Work(), val xp: XpBlock? = null)

object ReportLogic {
    /** Filter the crew list by name, email or team (iOS "Search crew"). */
    fun filter(rows: List<RosterRow>, q: String): List<RosterRow> {
        val t = q.trim().lowercase()
        if (t.isEmpty()) return rows
        return rows.filter { r -> listOfNotNull(r.name, r.email).plus(r.teams.mapNotNull { it.name }).any { it.lowercase().contains(t) } }
    }

    /** Up is good for most numbers; for overdue, late and penalties it is bad. */
    fun delta(now: Int, before: Int?): Int? = before?.let { now - it }

    fun hours(min: Int?): String? = min?.let { "%d:%02d".format(it / 60, it % 60) }
}

class ReportsApi(private val api: ApiClient) {
    suspend fun person(userId: String, period: String?) =
        api.getCached("/api/reports/people/$userId" + (period?.let { "?period=$it" } ?: ""), "report-person-$userId-${period ?: "current"}", PersonReport.serializer())
    suspend fun roster(period: String?) =
        api.getCached("/api/reports/people" + (period?.let { "?period=$it" } ?: ""), "report-roster-${period ?: "current"}-all", ReportRoster.serializer())
}
