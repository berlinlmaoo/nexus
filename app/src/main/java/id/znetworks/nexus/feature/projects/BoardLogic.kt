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
}
