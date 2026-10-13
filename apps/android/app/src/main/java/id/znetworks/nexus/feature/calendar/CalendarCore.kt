package id.znetworks.nexus.feature.calendar

import java.text.Collator
import java.time.Instant
import java.time.LocalDate
import java.util.Locale

/**
 * Calendar — the rules every client applies to what /api/calendar/… returns: filters, dots, the day
 * panel's tree (per division / per person), the week "People" table and overdue. A 1:1 port of the web's
 * `lib/calendar/client/core.ts` (web live 5–6 Oct 2026, d867ae2 + aa9ecdc); CalendarCoreTest runs it on
 * the server's golden files and compares with the web's golden-client files. Pure: no Android imports.
 * The server decides who may see what and where a task sits (placements); nothing here changes that.
 *
 * Owner's decisions (plan "Rencana Kalender NEXUS", section 10):
 *   - a task is under the Bagan cards of its PICs; without a PIC in the Bagan, under its project's
 *     division (placedBy "project") — no "no PIC" corner and no grey dot (10.5, 10.8);
 *   - overdue up to `overdueWindowDays` is shown as overdue; older stays on its date, grey (10.17);
 *   - counts are unique tasks: a task under two divisions counts once in the total (10.7);
 *   - order everywhere = Bagan canvas order (`rank`) (10.9).
 */
object CalendarCore {

    // ── Days ───────────────────────────────────────────────────────────────────────────────────────

    fun addDays(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    fun dayDiff(a: String, b: String): Int = (LocalDate.parse(b).toEpochDay() - LocalDate.parse(a).toEpochDay()).toInt()
    /** 0 = Monday … 6 = Sunday. */
    fun mondayIndex(day: String): Int = LocalDate.parse(day).dayOfWeek.value - 1
    fun mondayOf(day: String): String = addDays(day, -mondayIndex(day))
    /** The 42 days (6 weeks, Monday first) of the month grid that holds `day`. */
    fun monthGrid(day: String): List<String> {
        val start = mondayOf("${day.substring(0, 8)}01")
        return List(42) { addDays(start, it) }
    }
    /** First and last day of the grid — the range to ask /items for (≤ 42 days). */
    fun gridRange(day: String): Pair<String, String> = monthGrid(day).let { it.first() to it.last() }
    fun sameMonth(a: String, b: String) = a.substring(0, 7) == b.substring(0, 7)
    fun shiftMonth(day: String, n: Int): String {
        val d = LocalDate.parse(day)
        val first = d.withDayOfMonth(1).plusMonths(n.toLong())
        return first.withDayOfMonth(minOf(d.dayOfMonth, first.lengthOfMonth())).toString()
    }

    // ── Overdue ────────────────────────────────────────────────────────────────────────────────────

    enum class Overdue { NONE, RECENT, STALE }

    private fun dueMs(item: CalItem): Long? = item.due?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    /**
     * NONE, RECENT (overdue for at most `windowDays` — drawn as overdue) or STALE (older — stays on its
     * date, drawn grey until done) (10.17). A date-only task is overdue once its WIB day is over; a timed
     * one from that moment. Done, status-less and cancelled tasks are never overdue.
     */
    fun overdueState(item: CalItem, today: String, nowMs: Long, windowDays: Int): Overdue {
        if (item.done || item.noStatus || item.status == "CANCELLED") return Overdue.NONE
        val over = if (item.time == null) item.day < today else (dueMs(item)?.let { it < nowMs } ?: false)
        if (!over) return Overdue.NONE
        return if (dayDiff(item.day, today) > windowDays) Overdue.STALE else Overdue.RECENT
    }

    /** Still work to do: not done and in a project that has a status. */
    fun isOpen(i: CalItem) = !i.done && !i.noStatus

    // ── The Bagan, indexed ─────────────────────────────────────────────────────────────────────────

    class Index(units: List<CalUnit>, people: List<CalPerson>) {
        val units: List<CalUnit> = units.sortedBy { it.rank }
        val byId: Map<String, CalUnit> = LinkedHashMap<String, CalUnit>().apply { this@Index.units.forEach { put(it.id, it) } }
        /** Children in Bagan order (groups included). */
        val children: Map<String, List<CalUnit>> = LinkedHashMap<String, MutableList<CalUnit>>().apply {
            for (u in this@Index.units) if (u.parentId != null && byId.containsKey(u.parentId)) getOrPut(u.parentId) { mutableListOf() } += u
        }
        /** The top card (rank order), or null for an empty Bagan. */
        val top: CalUnit? = this.units.firstOrNull { it.parentId == null && it.kind != "GROUP" } ?: this.units.firstOrNull()
        val person: Map<String, CalPerson> = people.associateBy { it.userId }

        fun ancestors(id: String): List<String> {
            val out = mutableListOf<String>()
            val seen = mutableSetOf(id)
            var p = byId[id]?.parentId
            while (p != null && byId.containsKey(p) && seen.add(p)) { out += p; p = byId[p]?.parentId }
            return out
        }
        fun subtree(ids: List<String>): Set<String> {
            val out = LinkedHashSet<String>()
            val stack = ArrayDeque(ids)
            while (stack.isNotEmpty()) {
                val id = stack.removeLast()
                if (id in out || !byId.containsKey(id)) continue
                out += id
                children[id].orEmpty().forEach { stack.addLast(it.id) }
            }
            return out
        }
    }

    fun indexStructure(units: List<CalUnit>, people: List<CalPerson>) = Index(units, people)

    /**
     * Where a unit shows at a focus level: the child of `focusId` on the way down to it (a group counts
     * as one), `focusId` itself when the unit IS the focus, null when it is not under the focus.
     */
    fun bucketOf(ix: Index, unitId: String, focusId: String): String? {
        if (unitId == focusId) return focusId
        val up = ix.ancestors(unitId)
        val at = up.indexOf(focusId)
        if (at < 0) return null
        return if (at == 0) unitId else up[at - 1]
    }

    // ── Filters ────────────────────────────────────────────────────────────────────────────────────

    enum class Scope { ALL, ME, DIVISION }

    data class Filters(
        val scope: Scope = Scope.ALL,
        /** Units picked (a group = everything in it); a task matches when one of its placements is under one. */
        val units: List<String> = emptyList(),
        val people: List<String> = emptyList(),
        val projects: List<String> = emptyList(),
        val priorities: List<String> = emptyList(),
        val hideDone: Boolean = false,
        val overdueOnly: Boolean = false,
    )
    val NO_FILTERS = Filters()

    fun activeFilterCount(f: Filters): Int =
        (if (f.scope != Scope.ALL) 1 else 0) + (if (f.units.isNotEmpty()) 1 else 0) + (if (f.people.isNotEmpty()) 1 else 0) +
            (if (f.projects.isNotEmpty()) 1 else 0) + (if (f.priorities.isNotEmpty()) 1 else 0) + (if (f.hideDone) 1 else 0) + (if (f.overdueOnly) 1 else 0)

    class FilterContext(val ix: Index, val meId: String?, val myHomes: List<String>, val today: String, val nowMs: Long, val windowDays: Int)

    fun filterItems(items: List<CalItem>, f: Filters, c: FilterContext): List<CalItem> {
        val mine = if (f.scope == Scope.DIVISION) c.ix.subtree(c.myHomes) else null
        val picked = if (f.units.isNotEmpty()) c.ix.subtree(f.units) else null
        val people = f.people.takeIf { it.isNotEmpty() }?.toSet()
        val projects = f.projects.takeIf { it.isNotEmpty() }?.toSet()
        val prios = f.priorities.takeIf { it.isNotEmpty() }?.toSet()
        return items.filter { i ->
            if (f.scope == Scope.ME && !(c.meId != null && c.meId in i.assigneeIds)) return@filter false
            if (mine != null && i.placements.none { it.unitId in mine }) return@filter false
            if (picked != null && i.placements.none { it.unitId in picked }) return@filter false
            if (people != null && i.assigneeIds.none { it in people }) return@filter false
            if (projects != null && !(i.project != null && (i.project.id in projects || i.linkedProjectIds.any { it in projects }))) return@filter false
            if (prios != null && !(i.priority != null && i.priority in prios)) return@filter false
            if (f.hideDone && i.done) return@filter false
            if (f.overdueOnly && overdueState(i, c.today, c.nowMs, c.windowDays) == Overdue.NONE) return@filter false
            true
        }
    }

    /** Items with at least one placement under the focus (all of them at the top). */
    fun underFocus(items: List<CalItem>, ix: Index, focusId: String): List<CalItem> {
        if (ix.top != null && focusId == ix.top.id) return items
        val sub = ix.subtree(listOf(focusId))
        return items.filter { i -> i.placements.any { it.unitId in sub } }
    }

    // ── Grid ───────────────────────────────────────────────────────────────────────────────────────

    const val OTHER = "other"

    /** [unitId] = the unit at the focus level (or "other" for a task placed nowhere); filled = something still to do. */
    data class Dot(val unitId: String, val filled: Boolean, val count: Int)
    /** [count] = unique tasks that day; [overdue] = a task overdue within the window is due that day. */
    data class DayCell(val day: String, val count: Int, val dots: List<Dot>, val overdue: Boolean)

    fun byDay(items: List<CalItem>): Map<String, List<CalItem>> = items.groupBy { it.day }

    private fun bucketsOf(i: CalItem, ix: Index, focusId: String): Set<String> {
        val b = LinkedHashSet<String>()
        i.placements.forEach { p -> bucketOf(ix, p.unitId, focusId)?.let(b::add) }
        if (b.isEmpty() && i.placements.isEmpty()) b += OTHER
        return b
    }
    private fun rankOf(ix: Index, id: String): Long = if (id == OTHER) Long.MAX_VALUE else (ix.byId[id]?.rank ?: 0).toLong()

    fun dayCell(day: String, items: List<CalItem>, ix: Index, focusId: String, today: String, nowMs: Long, windowDays: Int): DayCell {
        val dots = LinkedHashMap<String, Dot>()
        for (i in items) for (b in bucketsOf(i, ix, focusId)) {
            val d = dots[b] ?: Dot(b, false, 0)
            dots[b] = d.copy(count = d.count + 1, filled = d.filled || isOpen(i))
        }
        return DayCell(day, items.size, dots.values.sortedBy { rankOf(ix, it.unitId) },
            items.any { overdueState(it, today, nowMs, windowDays) == Overdue.RECENT })
    }

    data class LegendEntry(val unitId: String, val count: Int)

    /** One chip per unit at the focus level with tasks in `items` (unique count), in Bagan order. */
    fun legend(items: List<CalItem>, ix: Index, focusId: String): List<LegendEntry> {
        val count = LinkedHashMap<String, Int>()
        for (i in items) for (b in bucketsOf(i, ix, focusId)) count[b] = (count[b] ?: 0) + 1
        return count.entries.map { LegendEntry(it.key, it.value) }.sortedBy { rankOf(ix, it.unitId) }
    }

    // ── Day panel ──────────────────────────────────────────────────────────────────────────────────

    private val PRIORITY = mapOf("URGENT" to 0, "HIGH" to 1, "MEDIUM" to 2, "LOW" to 3, "NONE" to 4)
    /** `a.localeCompare(b, "id")` (ICU, default sensitivity). */
    private val collator: Collator = Collator.getInstance(Locale.forLanguageTag("id")).apply { strength = Collator.TERTIARY }
    fun localeCompare(a: String, b: String): Int = collator.compare(a, b)

    /**
     * Inside one unit: work still to do first (overdue first), then done; within each, timed by time,
     * then date-only; then priority URGENT → NONE; titled before masked; title A–Z; key.
     */
    fun compareInDay(today: String, nowMs: Long, windowDays: Int): Comparator<CalItem> = Comparator { a, b ->
        val oa = if (isOpen(a)) 0 else 1; val ob = if (isOpen(b)) 0 else 1
        if (oa != ob) return@Comparator oa - ob
        val la = if (overdueState(a, today, nowMs, windowDays) == Overdue.NONE) 1 else 0
        val lb = if (overdueState(b, today, nowMs, windowDays) == Overdue.NONE) 1 else 0
        if (la != lb) return@Comparator la - lb
        if ((a.time == null) != (b.time == null)) return@Comparator if (a.time == null) 1 else -1
        if (a.time != b.time) return@Comparator if ((a.time ?: "") < (b.time ?: "")) -1 else 1
        val pa = PRIORITY[a.priority ?: "MEDIUM"] ?: 2; val pb = PRIORITY[b.priority ?: "MEDIUM"] ?: 2
        if (pa != pb) return@Comparator pa - pb
        if (a.masked != b.masked) return@Comparator if (a.masked) 1 else -1
        val ta = a.title ?: ""; val tb = b.title ?: ""
        if (ta != tb) return@Comparator localeCompare(ta, tb)
        a.key.compareTo(b.key).coerceIn(-1, 1)
    }

    data class PersonRow(val userId: String, val items: List<CalItem>)

    class TreeNode(
        val unit: CalUnit,
        /** Unique tasks in this unit and everything below it. */
        val count: Int,
        /** Tasks placed exactly here (lens "division"). */
        val items: List<CalItem>,
        /** People placed exactly here with their tasks (lens "person"), in Bagan box order. */
        val people: List<PersonRow>,
        /** Tasks placed here without a person (no PIC → its project's division). */
        val loose: List<CalItem>,
        val children: List<TreeNode>,
    )

    /** [total] unique tasks shown; [people] distinct people with a task; [unplaced] PICs not in the Bagan (lens "person" lists them last). */
    class DayTree(val root: TreeNode?, val total: Int, val people: Int, val unplaced: List<PersonRow>)

    /** BoD / One Above All, Manager, Staff, then people "di bawah" a leader of that card; A–Z within. */
    fun personOrder(ix: Index, unitId: String): Comparator<String> {
        fun tier(id: String): Int {
            val p = ix.person[id] ?: return 4
            if (p.reportsTo[unitId] != null) return 3
            return when (p.role) { "ONE_ABOVE_ALL", "BOD" -> 0; "MANAGER" -> 1; else -> 2 }
        }
        fun name(id: String) = ix.person[id]?.name ?: ""
        return Comparator { a, b ->
            val t = tier(a) - tier(b)
            if (t != 0) return@Comparator t
            val n = localeCompare(name(a), name(b))
            if (n != 0) return@Comparator n
            if (a < b) -1 else 1
        }
    }

    private class Slot {
        val items = LinkedHashMap<String, CalItem>()
        val people = LinkedHashMap<String, LinkedHashMap<String, CalItem>>()
        val loose = LinkedHashMap<String, CalItem>()
    }

    fun dayTree(items: List<CalItem>, ix: Index, focusId: String, today: String, nowMs: Long, windowDays: Int): DayTree {
        val focus = ix.byId[focusId] ?: return DayTree(null, 0, 0, emptyList())
        val sub = ix.subtree(listOf(focusId))
        val at = HashMap<String, Slot>()
        val shown = LinkedHashSet<String>()
        val who = LinkedHashSet<String>()
        val unplaced = LinkedHashMap<String, LinkedHashMap<String, CalItem>>()
        for (i in items) {
            var inside = false
            for (p in i.placements) {
                if (p.unitId !in sub) continue
                inside = true
                val s = at.getOrPut(p.unitId) { Slot() }
                s.items[i.key] = i
                if (p.userIds.isEmpty()) s.loose[i.key] = i
                for (u in p.userIds) { s.people.getOrPut(u) { LinkedHashMap() }[i.key] = i; who += u }
            }
            if (!inside) continue
            shown += i.key
            if (i.placement == PlacedBy.PIC) for (u in i.unplacedIds) { unplaced.getOrPut(u) { LinkedHashMap() }[i.key] = i; who += u }
        }
        val cmp = compareInDay(today, nowMs, windowDays)
        fun build(u: CalUnit): TreeNode? {
            val s = at[u.id]
            val kids = ix.children[u.id].orEmpty().mapNotNull(::build)
            val keys = LinkedHashSet<String>(s?.items?.keys ?: emptySet())
            fun collect(n: TreeNode) { n.items.forEach { keys += it.key }; n.children.forEach(::collect) }
            kids.forEach(::collect)
            if (keys.isEmpty()) return null
            val order = personOrder(ix, u.id)
            return TreeNode(
                unit = u,
                count = keys.size,
                items = s?.items?.values?.sortedWith(cmp) ?: emptyList(),
                people = s?.people?.entries?.sortedWith { a, b -> order.compare(a.key, b.key) }?.map { PersonRow(it.key, it.value.values.sortedWith(cmp)) } ?: emptyList(),
                loose = s?.loose?.values?.sortedWith(cmp) ?: emptyList(),
                children = kids,
            )
        }
        fun name(id: String) = ix.person[id]?.name ?: ""
        return DayTree(
            root = build(focus),
            total = shown.size,
            people = who.size,
            unplaced = unplaced.entries.sortedWith { a, b -> localeCompare(name(a.key), name(b.key)).takeIf { it != 0 } ?: if (a.key < b.key) -1 else 1 }
                .map { PersonRow(it.key, it.value.values.sortedWith(cmp)) },
        )
    }

    // ── Week "People" table ────────────────────────────────────────────────────────────────────────

    sealed interface WeekRow {
        val depth: Int
        data class Unit(val unit: CalUnit, override val depth: Int, val count: Int) : WeekRow
        /** "Not in the chart yet": PICs outside the Bagan, beside PICs who are in it. */
        data class Unplaced(override val depth: Int, val count: Int) : WeekRow
        data class Person(val unitId: String?, val userId: String, override val depth: Int, val days: List<List<CalItem>>) : WeekRow
        data class Loose(val unitId: String, override val depth: Int, val days: List<List<CalItem>>) : WeekRow
    }

    /**
     * Rows of the week table: unit headers in Bagan order (indented by depth under the focus), each with
     * its people (Bagan box order) and a row for tasks without a person; columns = Monday…Sunday.
     */
    fun weekRows(items: List<CalItem>, ix: Index, focusId: String, monday: String, today: String, nowMs: Long, windowDays: Int): List<WeekRow> {
        val days = List(7) { addDays(monday, it) }
        val week = items.filter { it.day in days }
        val tree = dayTree(week, ix, focusId, today, nowMs, windowDays)
        fun split(list: List<CalItem>) = days.map { d -> list.filter { it.day == d } }
        val out = mutableListOf<WeekRow>()
        fun walk(n: TreeNode, depth: Int) {
            out += WeekRow.Unit(n.unit, depth, n.count)
            for (p in n.people) out += WeekRow.Person(n.unit.id, p.userId, depth + 1, split(p.items))
            if (n.loose.isNotEmpty()) out += WeekRow.Loose(n.unit.id, depth + 1, split(n.loose))
            for (k in n.children) walk(k, depth + 1)
        }
        tree.root?.let { walk(it, 0) }
        if (tree.root != null && tree.unplaced.isNotEmpty()) {
            out += WeekRow.Unplaced(0, tree.unplaced.size)
            for (p in tree.unplaced) out += WeekRow.Person(null, p.userId, 1, split(p.items))
        }
        return out
    }

    // ── Overdue rail ───────────────────────────────────────────────────────────────────────────────

    /** Overdue within the window, newest day first — from /overdue plus today's timed tasks whose time has passed. */
    fun overdueRail(overdue: List<CalItem>, todays: List<CalItem>, today: String, nowMs: Long, windowDays: Int): List<CalItem> {
        val seen = HashSet<String>()
        val out = mutableListOf<CalItem>()
        for (i in todays + overdue) {
            if (i.key in seen || overdueState(i, today, nowMs, windowDays) != Overdue.RECENT) continue
            seen += i.key; out += i
        }
        val cmp = compareInDay(today, nowMs, windowDays)
        return out.sortedWith { a, b -> if (a.day != b.day) (if (a.day < b.day) 1 else -1) else cmp.compare(a, b) }
    }
}
