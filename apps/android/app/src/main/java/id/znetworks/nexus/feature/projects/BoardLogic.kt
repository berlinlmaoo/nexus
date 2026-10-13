package id.znetworks.nexus.feature.projects

/** The board's pure rules, ported from iOS ProjectBoardView (mergeSubtasks, matches). */
object BoardLogic {

    /**
     * Subtasks (from `GET /api/tasks?projectId=`) placed right under their parent in their own lane;
     * orphans (parent in another lane) at the lane's end. Each gets its parent's title.
     */
    fun mergeSubtasks(lanes: List<Lane>, all: List<BoardTask>): List<Lane> {
        val titles = all.associate { it.id to it.title } + lanes.flatMap { it.tasks }.associate { it.id to it.title }
        val subsByLane = all.filter { it.isSubtask && !it.taskListId.isNullOrBlank() }
            .map { it.copy(parentTitle = titles[it.parentId]) }
            .groupBy { it.taskListId!! }
        if (subsByLane.isEmpty()) return lanes
        return lanes.map { lane ->
            val subs = subsByLane[lane.id].orEmpty()
            if (subs.isEmpty()) return@map lane
            val parents = lane.tasks.filterNot { it.isSubtask }
            val parentIds = parents.map { it.id }.toSet()
            val byParent = subs.filter { it.parentId in parentIds }.groupBy { it.parentId }
            val orphans = subs.filterNot { it.parentId in parentIds }
            lane.copy(tasks = parents.flatMap { listOf(it) + byParent[it.id].orEmpty() } + orphans)
        }
    }

    fun tokens(query: String) = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }

    /** Every word must match, in any order: "budi invoice" finds Budi's task about an invoice. */
    fun matches(t: BoardTask, laneName: String, tokens: List<String>): Boolean {
        if (tokens.isEmpty()) return true
        val hay = buildList {
            add(t.title); add(laneName); add(t.status.orEmpty()); add(t.priority.orEmpty()); add(t.parentTitle.orEmpty())
            t.assignees.mapNotNullTo(this) { it.user?.name }
            t.customFieldValues.mapNotNullTo(this) { valueText(it.value) }
        }.joinToString(" ").lowercase()
        return tokens.all { it in hay }
    }

    fun filter(lanes: List<Lane>, query: String): List<Lane> {
        val tk = tokens(query)
        if (tk.isEmpty()) return lanes
        return lanes.map { l -> l.copy(tasks = l.tasks.filter { matches(it, l.name, tk) }) }
    }

    /** A read-only board lane of tasks linked in from another project (web `linkedLanes`). [name] null = unknown project. */
    data class LinkedLane(val sourceId: String, val name: String?, val tasks: List<BoardTask>)

    /**
     * Tasks other projects linked into this one (`taskLists[].taskProjects`), one lane per source project, each task
     * once, open before done (web $projectId.tsx linkedLanes). [keep] is the view's filter and the search.
     */
    fun linkedLanes(lanes: List<Lane>, projectId: String, keep: (BoardTask) -> Boolean = { true }): List<LinkedLane> {
        val bySource = linkedMapOf<String, Pair<String?, MutableList<BoardTask>>>()
        for (lane in lanes) for (link in lane.taskProjects) {
            val t = link.task ?: continue
            val source = t.projectId ?: "linked"
            if (source == projectId || !keep(t)) continue
            val g = bySource.getOrPut(source) { t.taskList?.project?.name to mutableListOf() }
            if (g.second.none { it.id == t.id }) g.second += t
        }
        return bySource.map { (id, g) -> LinkedLane(id, g.first, g.second.sortedBy { if (it.isDone) 1 else 0 }) }
    }

    /** Moves a card to another lane locally, before the server confirms (it reloads after). */
    fun move(lanes: List<Lane>, taskId: String, toLane: String): List<Lane> {
        val task = lanes.flatMap { it.tasks }.firstOrNull { it.id == taskId } ?: return lanes
        return lanes.map { l ->
            when (l.id) {
                toLane -> if (l.tasks.any { it.id == taskId }) l else l.copy(tasks = l.tasks + task.copy(taskListId = toLane))
                else -> l.copy(tasks = l.tasks.filterNot { it.id == taskId })
            }
        }
    }

    /** A gantt bar (web taskWindow): start→due; ±3 days when one is missing; today+3 when both are. */
    data class Window(val start: java.time.LocalDate, val end: java.time.LocalDate)

    fun window(t: BoardTask, today: java.time.LocalDate): Window {
        var s = dueDate(t.startDate)
        var e = dueDate(t.dueDate)
        if (s != null && e == null) e = s.plusDays(3)
        if (s == null && e != null) s = e.minusDays(3)
        if (s == null || e == null) { s = today; e = today.plusDays(3) }
        return Window(s, if (e.isBefore(s)) s else e)
    }

    /** The bar of a dated task (start→due, one date = one day); none for an undated one (web: never a bar from today). */
    fun windowOrNull(t: BoardTask): Window? {
        val s = dueDate(t.startDate); val e = dueDate(t.dueDate)
        if (s == null && e == null) return null
        val start = s ?: e!!; val end = e ?: s!!
        return Window(start, if (end.isBefore(start)) start else end)
    }

    /** Tasks with a due date in [month], by day of month (dated subtasks included). */
    /** [dateOf]: the day a task sits on (its due date, or a plotted Date field, DEV-REDESIGN §1). */
    fun byDay(tasks: List<BoardTask>, month: java.time.YearMonth, dateOf: (BoardTask) -> java.time.LocalDate? = { dueDate(it.dueDate) }): Map<Int, List<BoardTask>> =
        tasks.mapNotNull { t -> dateOf(t)?.takeIf { java.time.YearMonth.from(it) == month }?.let { it.dayOfMonth to t } }
            .groupBy({ it.first }, { it.second })
}
