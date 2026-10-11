package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.time.OfficeTime
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * A task project's Overview (Berlin, 11 Oct; SPRINTS-OVERVIEW §3, web fc81517 ProjectOverview.tsx). Everything is
 * computed from the project's own tasks, never the board's search, so filtering the board doesn't change the
 * numbers. Top-level tasks only, as the header progress. Days are office days (WIB): overdue = due before today,
 * next 7 days = today and the six after it. Open = not Done and not Cancelled.
 */
data class OverviewDrill(
    /** "OVERDUE" | "NEXT7" | "NONE" (no due date). */
    val due: String? = null,
    /** A person's id, or "NONE" = nobody assigned. */
    val assigneeId: String? = null,
    /** URGENT / HIGH / MEDIUM / LOW / NONE. */
    val priority: String? = null,
    /** A section (lane) id. */
    val section: String? = null,
)

data class OverviewPerson(val id: String, val name: String, val avatar: String?, val lead: Boolean, val open: Int, val overdue: Int, val doneMonth: Int)
data class OverviewSection(val id: String, val name: String, val total: Int, val open: Int, val done: Int)

data class OverviewMetrics(
    val total: Int,
    val done: Int,
    val doneLast7: Int,
    /** TODO / IN_PROGRESS / IN_REVIEW / DONE / CANCELLED → count. */
    val byStatus: Map<String, Int>,
    /** Open tasks only: URGENT / HIGH / MEDIUM / LOW / NONE → count. */
    val byPriority: Map<String, Int>,
    val open: Int,
    /** Oldest due first. */
    val overdue: List<BoardTask>,
    /** Due today..+13, soonest first. */
    val upcoming: List<BoardTask>,
    val next7: Int,
    val noDue: Int,
    val unassigned: Int,
    /** Latest first. */
    val completed: List<BoardTask>,
    /** Most open first; members with nothing still listed. */
    val people: List<OverviewPerson>,
    val sections: List<OverviewSection>,
) {
    val pct: Int get() = if (total == 0) 0 else Math.round(done * 100f / total)
}

object OverviewLogic {
    val STATUSES = listOf("TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED")
    val PRIORITIES = listOf("URGENT", "HIGH", "MEDIUM", "LOW", "NONE")
    private val DONE = setOf("DONE", "COMPLETED", "COMPLETE")
    private val CLOSED = DONE + setOf("CANCELLED", "CANCELED")

    fun status(t: BoardTask) = (t.status ?: "TODO").uppercase()
    fun isDone(t: BoardTask) = status(t) in DONE
    fun isClosed(t: BoardTask) = status(t) in CLOSED
    fun assignees(t: BoardTask) = t.assignees.mapNotNull { it.user?.id ?: it.userId }.distinct()

    /** Days from [today] to the due day (negative = late); null without one. */
    fun dueIn(t: BoardTask, today: LocalDate): Long? = dueDate(t.dueDate)?.let { ChronoUnit.DAYS.between(today, it) }

    private fun instant(s: String?): Instant? = s?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun completedOn(t: BoardTask): Instant? = instant(t.completedAt) ?: instant(t.updatedAt)

    fun compute(lanes: List<Lane>, members: List<ProjectMemberRef>, now: Instant = Instant.now()): OverviewMetrics {
        val today = OfficeTime.today(now)
        val weekAgo = today.minusDays(6).atStartOfDay(OfficeTime.ZONE).toInstant()
        val monthStart = today.withDayOfMonth(1).atStartOfDay(OfficeTime.ZONE).toInstant()
        val tasks = lanes.flatMap { l -> l.tasks.filter { !it.isSubtask }.map { it to l } }
        val byStatus = mutableMapOf<String, Int>(); val byPriority = mutableMapOf<String, Int>()
        val overdue = mutableListOf<BoardTask>(); val upcoming = mutableListOf<BoardTask>(); val completed = mutableListOf<BoardTask>()
        var open = 0; var next7 = 0; var noDue = 0; var unassigned = 0; var done = 0; var doneLast7 = 0
        data class Load(var open: Int = 0, var overdue: Int = 0, var doneMonth: Int = 0)
        val load = linkedMapOf<String, Load>()
        members.forEach { m -> m.uid.takeIf { it.isNotBlank() }?.let { load.getOrPut(it) { Load() } } }
        tasks.forEach { (t, _) ->
            val s = status(t)
            val key = when { s in STATUSES -> s; s in DONE -> "DONE"; s == "CANCELED" -> "CANCELLED"; else -> "TODO" }
            byStatus[key] = (byStatus[key] ?: 0) + 1
            val ids = assignees(t)
            if (s in DONE) {
                done++; completed += t
                val at = instant(t.completedAt)
                if (at != null && !at.isBefore(weekAgo)) doneLast7++
                if (at != null && !at.isBefore(monthStart)) ids.forEach { load.getOrPut(it) { Load() }.doneMonth++ }
                return@forEach
            }
            if (s in CLOSED) return@forEach
            open++
            val pr = t.priority?.uppercase()?.takeIf { it in PRIORITIES } ?: "NONE"
            byPriority[pr] = (byPriority[pr] ?: 0) + 1
            val d = dueIn(t, today)
            when {
                d == null -> noDue++
                d < 0 -> overdue += t
                else -> { if (d <= 6) next7++; if (d <= 13) upcoming += t }
            }
            if (ids.isEmpty()) unassigned++
            ids.forEach { id -> load.getOrPut(id) { Load() }.also { it.open++; if (d != null && d < 0) it.overdue++ } }
        }
        val byDue = compareBy<BoardTask> { dueDate(it.dueDate) ?: LocalDate.MAX }
        val names = mutableMapOf<String, Pair<String?, String?>>()
        members.forEach { m -> names[m.uid] = (m.user?.name ?: m.user?.email) to m.user?.avatar }
        tasks.forEach { (t, _) -> t.assignees.forEach { a -> val id = a.user?.id ?: a.userId ?: return@forEach; if (id !in names) names[id] = (a.user?.name ?: a.user?.email) to a.user?.avatar } }
        val leads = members.filter { it.role.equals("LEAD", true) }.map { it.uid }.toSet()
        val people = load.map { (id, l) -> OverviewPerson(id, names[id]?.first ?: "—", names[id]?.second, id in leads, l.open, l.overdue, l.doneMonth) }
            .sortedWith(compareByDescending<OverviewPerson> { it.open }.thenByDescending { it.overdue }.thenByDescending { it.doneMonth }.thenBy { it.name.lowercase() })
        val sections = lanes.map { l ->
            val own = l.tasks.filter { !it.isSubtask }
            OverviewSection(l.id, l.name, own.size, own.count { !isClosed(it) }, own.count { isDone(it) })
        }
        return OverviewMetrics(tasks.size, done, doneLast7, byStatus, byPriority, open, overdue.sortedWith(byDue), upcoming.sortedWith(byDue),
            next7, noDue, unassigned, completed.sortedByDescending { completedOn(it) ?: Instant.EPOCH }, people, sections)
    }

    /** The Board / List after a tap on the Overview: done and cancelled hidden, then the drill's own rule. */
    fun filter(lanes: List<Lane>, drill: OverviewDrill?, now: Instant = Instant.now()): List<Lane> {
        if (drill == null) return lanes
        val today = OfficeTime.today(now)
        return lanes.filter { drill.section == null || it.id == drill.section }.map { l ->
            l.copy(tasks = l.tasks.filter { t ->
                if (isClosed(t)) return@filter false
                val d = dueIn(t, today)
                val dueOk = when (drill.due) { "OVERDUE" -> d != null && d < 0; "NEXT7" -> d != null && d in 0..6; "NONE" -> d == null; else -> true }
                val ids = assignees(t)
                val whoOk = when (drill.assigneeId) { null -> true; "NONE" -> ids.isEmpty(); else -> drill.assigneeId in ids }
                val prOk = drill.priority == null || (t.priority?.uppercase()?.takeIf { it in PRIORITIES } ?: "NONE") == drill.priority
                dueOk && whoOk && prOk
            })
        }
    }
}
