package id.znetworks.nexus.feature.projects

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.time.DayOfWeek
import java.time.LocalDate

/**
 * Saved views (dev web lib/project-views.ts, iOS ProjectViews.swift): `GET/POST/PATCH/DELETE
 * /api/projects/:id/views`. Every view is a tab; its config holds filter, sort and grouping.
 */
@Serializable
data class ProjectView(
    val id: String,
    val name: String? = null,
    /** board | list | table | calendar | timeline | gallery (unknown → board). */
    val layout: String = "board",
    /** board | list | table | calendar | timeline | mine | category | null (a custom view). */
    val builtin: String? = null,
    val position: Int? = null,
    val shared: Boolean = true,
    val ownerId: String? = null,
    val config: JsonObject? = null,
) {
    val isFallback: Boolean get() = id.startsWith("fallback:")
}

@Serializable
data class ProjectViewsResponse(val views: List<ProjectView> = emptyList(), val canEditShared: Boolean = false)

@Serializable
data class ProjectViewResponse(val view: ProjectView? = null)

/** One simple filter rule: `{id, prop, op, value?}`. */
data class ViewRule(val id: String, val prop: String, val op: String, val values: List<String>, val number: Int? = null)

data class ViewSort(val prop: String, val desc: Boolean)

/** A view's config with the layout's defaults filled in (web resolveConfig). */
data class ViewConfig(
    val rules: List<ViewRule> = emptyList(),
    /** An advanced (nested) filter made on the web: kept, never edited or overwritten here. */
    val advanced: JsonElement? = null,
    val sort: List<ViewSort> = emptyList(),
    val groupBy: String? = null,
    val hiddenGroups: Set<String> = emptySet(),
    val hideEmptyGroups: Boolean = false,
    /** count | done | percent_done | sum | avg */
    val calc: String = "count",
    val visibleProps: List<String>? = null,
    val dateProp: String = "due",
    val startProp: String = "start",
    val endProp: String = "due",
) {
    val filtered: Boolean get() = rules.isNotEmpty() || advanced != null
    val sorted: Boolean get() = sort.isNotEmpty()
}

/** A drawn group: a section, a priority, a person or a select field's option. */
data class TaskGroup(
    val key: String,
    /** Null = take the label from [laneName] / the prop (the UI words priorities and "No …"). */
    val label: String,
    val colorKey: String?,
    /** The section behind it when grouped by section: drops and "New task" go there. */
    val laneId: String? = null,
    val tasks: List<BoardTask> = emptyList(),
    /** For the List header: To-do / In progress / Complete. */
    val statusGroup: StatusOptions.Group? = null,
)

object ViewsLogic {
    const val ME = "__me__"
    const val NONE = "__none__"
    val LAYOUTS = listOf("board", "list", "table", "calendar", "timeline")

    fun layoutOf(v: ProjectView): String = v.layout.lowercase().takeIf { it in LAYOUTS } ?: "board"

    /** Built-in views of the project's visible layouts, used when the views API can't be read. */
    fun fallbacks(hidden: Set<String>): List<ProjectView> =
        LAYOUTS.filter { it !in hidden }.mapIndexed { i, l -> ProjectView("fallback:$l", null, l, l, i, shared = true) }

    /** The views to draw as tabs: by position; a built-in whose key is hidden is left out. */
    fun visible(views: List<ProjectView>, hidden: Set<String>): List<ProjectView> =
        views.withIndex().filter { (_, v) -> v.builtin == null || v.builtin !in hidden || v.builtin == "mine" || v.builtin == "category" }
            .sortedWith(compareBy({ it.value.position ?: Int.MAX_VALUE }, { it.index })).map { it.value }

    fun canEditView(v: ProjectView, access: ProjectAccess, canEditShared: Boolean): Boolean =
        access.canEdit && !v.isFallback && (if (v.shared) canEditShared else true)

    /** Delete only custom views (iOS rule: no built-in, `category` and `mine` included). */
    fun canDeleteView(v: ProjectView, access: ProjectAccess, canEditShared: Boolean) = v.builtin == null && canEditView(v, access, canEditShared)

    private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun strings(e: JsonElement?): List<String> = when (e) {
        is JsonArray -> e.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        is JsonPrimitive -> listOfNotNull(e.contentOrNull)
        else -> emptyList()
    }

    fun config(v: ProjectView): ViewConfig {
        val c = v.config ?: JsonObject(emptyMap())
        val layout = layoutOf(v)
        val filter = c["filter"] as? JsonObject
        val rules = (filter?.get("simple") as? JsonArray)?.mapNotNull { r ->
            val o = r as? JsonObject ?: return@mapNotNull null
            val prop = str(o["prop"]) ?: return@mapNotNull null
            val op = str(o["op"]) ?: return@mapNotNull null
            ViewRule(str(o["id"]) ?: "$prop-$op", prop, op, strings(o["value"]), (o["value"] as? JsonPrimitive)?.intOrNull)
        }.orEmpty()
        val sort = (c["sort"] as? JsonArray)?.mapNotNull { s ->
            val o = s as? JsonObject ?: return@mapNotNull null
            ViewSort(str(o["prop"]) ?: return@mapNotNull null, str(o["dir"]) == "desc")
        }.orEmpty()
        val groupDefault = if (layout in setOf("board", "list", "table", "timeline")) "section" else null
        val groupBy = if (c.containsKey("groupBy")) (c["groupBy"] as? JsonPrimitive)?.contentOrNull else groupDefault
        val calc = ((c["groupCalc"] as? JsonObject)?.get("kind") as? JsonPrimitive)?.contentOrNull ?: if (layout == "list") "done" else "count"
        return ViewConfig(
            rules = rules,
            advanced = filter?.get("advanced")?.takeIf { it !is JsonNull },
            sort = sort,
            groupBy = groupBy,
            hiddenGroups = strings(c["hiddenGroups"]).toSet(),
            hideEmptyGroups = (c["hideEmptyGroups"] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull() ?: (layout == "list"),
            calc = calc,
            visibleProps = (c["visibleProps"] as? JsonArray)?.let { strings(it) },
            dateProp = str(c["dateProp"]) ?: "due",
            startProp = str(c["startProp"]) ?: "start",
            endProp = str(c["endProp"]) ?: "due",
        )
    }

    /** The `patch` body for a filter / sort / group change (top-level keys merged by the server). */
    fun patchFor(rules: List<ViewRule>, sort: List<ViewSort>, groupBy: String?, keepAdvanced: JsonElement?): JsonObject = buildJsonObject {
        put("filter", buildJsonObject {
            put("simple", buildJsonArray {
                rules.forEach { r ->
                    add(buildJsonObject {
                        put("id", JsonPrimitive(r.id)); put("prop", JsonPrimitive(r.prop)); put("op", JsonPrimitive(r.op))
                        when {
                            r.number != null -> put("value", JsonPrimitive(r.number))
                            r.op in MULTI_OPS -> put("value", buildJsonArray { r.values.forEach { add(JsonPrimitive(it)) } })
                            r.values.isNotEmpty() -> put("value", JsonPrimitive(r.values.first()))
                        }
                    })
                }
            })
            // Never overwrite a web-made advanced filter from here.
            put("advanced", keepAdvanced ?: JsonNull)
        })
        put("sort", buildJsonArray { sort.forEach { s -> add(buildJsonObject { put("prop", JsonPrimitive(s.prop)); put("dir", JsonPrimitive(if (s.desc) "desc" else "asc")) }) } })
        put("groupBy", groupBy?.let { JsonPrimitive(it) } ?: JsonNull)
    }

    private val MULTI_OPS = setOf("any_of", "none_of", "all_of")

    // region filter

    private fun date(iso: String?): LocalDate? = dueDate(iso)

    private fun cfValues(t: BoardTask, fieldId: String): List<String> =
        t.customFieldValues.firstOrNull { it.customFieldId == fieldId }?.value.let { v ->
            when (v) {
                null -> emptyList()
                is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                is JsonPrimitive -> v.contentOrNull?.let { s ->
                    // Multi values may arrive as JSON text.
                    if (s.startsWith("[")) runCatching { id.znetworks.nexus.core.net.NexusJson.parseToJsonElement(s) as JsonArray }.getOrNull()
                        ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: listOf(s)
                    else listOf(s)
                }.orEmpty().filter { it.isNotBlank() }
                is JsonObject -> listOfNotNull((v["label"] as? JsonPrimitive)?.contentOrNull)
            }
        }

    /** The task's values for a prop, as the keys rules compare against ([NONE] when empty). */
    fun values(t: BoardTask, prop: String, me: String?): List<String> = when {
        prop == "section" -> listOfNotNull(t.taskListId)
        prop == "status" -> listOfNotNull(t.status?.uppercase())
        prop == "priority" -> listOf(t.priority?.uppercase()?.takeIf { it.isNotBlank() } ?: "NONE")
        prop == "assignee" -> t.assignees.mapNotNull { it.user?.id ?: it.userId }
        prop == "title" -> listOf(t.title)
        prop.startsWith("cf:") -> cfValues(t, prop.removePrefix("cf:"))
        else -> emptyList()
    }

    /** One rule against one task. An unknown op or prop never hides a task (web rule). */
    fun matches(t: BoardTask, r: ViewRule, me: String?, today: LocalDate): Boolean {
        val wanted = r.values.map { if (it == ME) me ?: it else it }
        return when (r.prop) {
            "due", "start" -> {
                val d = date(if (r.prop == "due") t.dueDate else t.startDate)
                when (r.op) {
                    "empty", "is_empty" -> d == null
                    "not_empty", "is_not_empty" -> d != null
                    "overdue" -> d != null && d.isBefore(today) && !t.isDone
                    "today" -> d == today
                    "this_week" -> d != null && !d.isBefore(today.with(DayOfWeek.MONDAY)) && !d.isAfter(today.with(DayOfWeek.SUNDAY))
                    "next_days" -> d != null && !d.isBefore(today) && !d.isAfter(today.plusDays((r.number ?: wanted.firstOrNull()?.toIntOrNull() ?: 7).toLong()))
                    else -> true
                }
            }
            "title" -> when (r.op) {
                "contains" -> wanted.firstOrNull().isNullOrBlank() || t.title.contains(wanted.first(), true)
                "not_contains" -> wanted.firstOrNull().isNullOrBlank() || !t.title.contains(wanted.first(), true)
                "is_empty", "empty" -> t.title.isBlank()
                "not_empty", "is_not_empty" -> t.title.isNotBlank()
                else -> true
            }
            "section", "status", "priority", "assignee" -> setOp(values(t, r.prop, me), wanted, r.op)
            else -> if (r.prop.startsWith("cf:")) setOp(values(t, r.prop, me), wanted, r.op) else true
        }
    }

    private fun setOp(have: List<String>, wanted: List<String>, op: String): Boolean {
        val noneWanted = NONE in wanted
        return when (op) {
            "any_of", "is" -> wanted.isEmpty() || have.any { it in wanted } || (noneWanted && have.isEmpty())
            "none_of", "is_not" -> have.none { it in wanted } && !(noneWanted && have.isEmpty())
            "all_of" -> wanted.all { it in have }
            "empty", "is_empty" -> have.isEmpty()
            "not_empty", "is_not_empty" -> have.isNotEmpty()
            else -> true
        }
    }

    fun filter(tasks: List<BoardTask>, cfg: ViewConfig, me: String?, today: LocalDate): List<BoardTask> =
        if (cfg.rules.isEmpty()) tasks else tasks.filter { t -> cfg.rules.all { matches(t, it, me, today) } }

    // endregion

    private val PRIORITY_RANK = mapOf("URGENT" to 0, "HIGH" to 1, "MEDIUM" to 2, "LOW" to 3, "NONE" to 4)

    /** The view's sort; none = manual order (as given). Stable, so equal keys keep the server's order. */
    fun sort(tasks: List<BoardTask>, cfg: ViewConfig): List<BoardTask> {
        if (cfg.sort.isEmpty()) return tasks
        var cmp: Comparator<BoardTask>? = null
        for (s in cfg.sort.reversed()) {
            // Empty values stay last in both directions.
            fun <T : Comparable<T>> key(f: (BoardTask) -> T?): Comparator<BoardTask> =
                compareBy(if (s.desc) nullsLast(reverseOrder<T>()) else nullsLast(naturalOrder<T>()), f)
            val one: Comparator<BoardTask> = when (s.prop) {
                "due" -> key { date(it.dueDate) }
                "start" -> key { date(it.startDate) }
                "priority" -> key { PRIORITY_RANK[it.priority?.uppercase() ?: "NONE"] ?: 4 }
                "title" -> key { it.title.lowercase() }
                "updated" -> key { it.updatedAt }
                else -> continue
            }
            cmp = cmp?.let { prev -> one.then(prev) } ?: one
        }
        return cmp?.let { tasks.sortedWith(it) } ?: tasks
    }

    /**
     * The groups to draw for [groupBy]: sections in status order (every section, even empty ones), priorities
     * high → none, people A–Z then "No assignee", a select field's options in order, extra values A–Z, then "No value".
     */
    fun group(tasks: List<BoardTask>, lanes: List<Lane>, groupBy: String?, fields: List<CustomFieldDef>, noneLabel: String = ""): List<TaskGroup> {
        when {
            groupBy == null -> return listOf(TaskGroup("all", "", null, StatusOptions.defaultOption(lanes)?.id, tasks))
            groupBy == "section" || groupBy == "status" -> {
                val by = tasks.groupBy { it.taskListId }
                val ordered = StatusOptions.ordered(lanes)
                val known = ordered.map { it.id }.toSet()
                val out = ordered.map { l ->
                    TaskGroup(l.id, l.name, if (StatusOptions.inUse(lanes)) StatusOptions.colorKey(l.color, l.taskStatus) else null, l.id, by[l.id].orEmpty(),
                        if (StatusOptions.inUse(lanes)) StatusOptions.groupOf(l.taskStatus) else null)
                }
                val strays = tasks.filter { it.taskListId !in known }
                return if (strays.isEmpty()) out else out + TaskGroup(NONE, noneLabel, null, null, strays)
            }
            groupBy == "priority" -> {
                val by = tasks.groupBy { it.priority?.uppercase()?.takeIf { p -> p in PRIORITY_RANK } ?: "NONE" }
                return TaskEnums.PRIORITIES.map { p -> TaskGroup(p, p, null, null, by[p].orEmpty()) }
            }
            groupBy == "assignee" -> {
                val people = tasks.flatMap { t -> t.assignees.mapNotNull { a -> (a.user?.id ?: a.userId)?.let { it to (a.user?.name ?: it) } } }.toMap()
                val out = people.entries.sortedBy { it.value.lowercase() }.map { (id, name) ->
                    TaskGroup(id, name, null, null, tasks.filter { t -> t.assignees.any { (it.user?.id ?: it.userId) == id } })
                }
                return out + TaskGroup(NONE, noneLabel, null, null, tasks.filter { it.assignees.isEmpty() })
            }
            groupBy.startsWith("cf:") -> {
                val fid = groupBy.removePrefix("cf:")
                val f = fields.firstOrNull { it.id == fid }
                val opts = f?.choices.orEmpty()
                val used = tasks.flatMap { cfValues(it, fid) }.distinct()
                val extra = used.filter { it !in opts }.sortedBy { it.lowercase() }
                val out = (opts + extra).map { o ->
                    TaskGroup(o, o, f?.let { StatusOptions.optionColor(it, o) }, null, tasks.filter { o in cfValues(it, fid) })
                }
                return out + TaskGroup(NONE, noneLabel, null, null, tasks.filter { cfValues(it, fid).isEmpty() })
            }
            else -> return listOf(TaskGroup("all", "", null, StatusOptions.defaultOption(lanes)?.id, tasks))
        }
    }

    /** The group header's number: done/total for List by default, else a count. */
    fun calc(g: TaskGroup, kind: String): String = when (kind) {
        "done" -> "${g.tasks.count { it.isDone }}/${g.tasks.size}"
        "percent_done" -> if (g.tasks.isEmpty()) "0%" else "${g.tasks.count { it.isDone } * 100 / g.tasks.size}%"
        else -> "${g.tasks.size}"
    }

    /** A view's tab label; null = word it from the layout in the UI. */
    fun name(v: ProjectView): String? = v.name?.takeIf { it.isNotBlank() }
}
