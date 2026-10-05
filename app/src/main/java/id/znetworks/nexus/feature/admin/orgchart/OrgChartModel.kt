package id.znetworks.nexus.feature.admin.orgchart

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.Collator
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Bagan IP & Divisi (web final 5 Oct 2026, OrgChart.tsx): the model and everything the layout is built
// from — a port of the component's pure parts. The chart grants NOTHING (no project access, no attendance).

@Serializable
data class OrgUnit(
    val id: String,
    val name: String = "",
    /** "IP" | "DIVISION" | "GROUP" */
    val kind: String = "DIVISION",
    val logoUrl: String? = null,
    val parentId: String? = null,
    val position: Int = 0,
    val leadUserId: String? = null,
    val layoutX: Double? = null,
    val layoutY: Double? = null,
    /** { [boxKind]: { x, y } } — web-only positions, read here, never written. */
    val boxLayout: JsonElement? = null,
) {
    val isGroup get() = kind == "GROUP"
    /** The saved places of single boxes; entries that are null or broken are skipped. */
    fun boxPlaces(): Map<String, Pt> {
        val o = boxLayout as? JsonObject ?: return emptyMap()
        val out = LinkedHashMap<String, Pt>()
        for ((k, v) in o) {
            if (v is JsonNull) continue
            val p = runCatching { v.jsonObject }.getOrNull() ?: continue
            val x = p["x"]?.jsonPrimitive?.doubleOrNull ?: continue
            val y = p["y"]?.jsonPrimitive?.doubleOrNull ?: continue
            out[k] = Pt(x, y)
        }
        return out
    }
}

@Serializable
data class OrgPerson(
    val userId: String,
    val name: String? = null,
    val email: String = "",
    val avatar: String? = null,
    /** "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF" */
    val role: String = "STAFF",
    val unitIds: List<String> = emptyList(),
    val titles: Map<String, String> = emptyMap(),
    val reportsTo: Map<String, String> = emptyMap(),
) {
    val label get() = name ?: email
    val isBoD get() = role == "BOD" || role == "ONE_ABOVE_ALL"
    val isLead get() = role in LEAD_ROLES
}

@Serializable data class OrgStats(val units: Int = 0, val groups: Int = 0, val people: Int = 0, val placed: Int = 0)
@Serializable data class OrgChartData(val workspaceId: String? = null, val units: List<OrgUnit> = emptyList(), val people: List<OrgPerson> = emptyList(), val stats: OrgStats = OrgStats())

val LEAD_ROLES = setOf("ONE_ABOVE_ALL", "BOD", "MANAGER")
val ROLE_SUB = mapOf("ONE_ABOVE_ALL" to "One Above All", "BOD" to "BoD", "MANAGER" to "Manager", "STAFF" to "Staff")

private val collator: Collator = Collator.getInstance(Locale.forLanguageTag("id")).apply { strength = Collator.SECONDARY }
/** The web's `a.localeCompare(b, "id")`. */
fun idCompare(a: String, b: String) = collator.compare(a, b)
val byPos = Comparator<OrgUnit> { a, b -> if (a.position != b.position) a.position.compareTo(b.position) else idCompare(a.name, b.name) }

fun initialsOf(name: String?): String {
    if (name.isNullOrBlank()) return "?"
    return name.trim().split(Regex("\\s+")).take(2).joinToString("") { it.firstOrNull()?.uppercase() ?: "" }.ifEmpty { "?" }
}

/** How one card's people and sub-units are arranged: BoD box, Manager box, staff box, one box per leader
 *  for the people who sit under them ("di bawah"), sub-units led by one of the card's leaders (first, in
 *  the order of their leaders) and the rest. */
class Group(
    val bods: List<OrgPerson>, val managers: List<OrgPerson>, val staff: List<OrgPerson>,
    val rt: List<Pair<String, List<OrgPerson>>>, val led: List<OrgUnit>, val free: List<OrgUnit>, val leaderIdx: Map<String, Int>,
)

fun groupUnit(u: OrgUnit, kids: List<OrgUnit>, all: List<OrgPerson>): Group {
    val bods = all.filter { it.isBoD }
    val allManagers = all.filter { it.role == "MANAGER" }
    val leaderIdx = LinkedHashMap<String, Int>().apply { (bods + allManagers).forEachIndexed { i, p -> put(p.userId, i) } }
    fun rtOf(p: OrgPerson): String? {
        val to = p.reportsTo[u.id]
        return if (to != null && to != p.userId && leaderIdx.containsKey(to) && !p.isBoD) to else null
    }
    val rtMap = LinkedHashMap<String, MutableList<OrgPerson>>()
    for (p in all) rtOf(p)?.let { rtMap.getOrPut(it) { mutableListOf() } += p }
    val rt = rtMap.entries.map { it.key to it.value.toList() }.sortedBy { leaderIdx.getValue(it.first) }
    fun isLed(k: OrgUnit) = !k.isGroup && k.leadUserId != null && leaderIdx.containsKey(k.leadUserId)
    val led = kids.filter(::isLed).sortedWith { a, b -> leaderIdx.getValue(a.leadUserId!!).compareTo(leaderIdx.getValue(b.leadUserId!!)).takeIf { it != 0 } ?: byPos.compare(a, b) }
    return Group(bods, allManagers.filter { rtOf(it) == null }, all.filter { it.role !in LEAD_ROLES && rtOf(it) == null }, rt, led, kids.filterNot(::isLed), leaderIdx)
}

fun boxPeople(g: Group, kind: String): List<OrgPerson> = when (kind) {
    "bod" -> g.bods
    "manager" -> g.managers
    "staff" -> g.staff
    else -> g.rt.firstOrNull { "rt:${it.first}" == kind }?.second ?: emptyList()
}
fun boxTitle(g: Group, kind: String, people: List<OrgPerson>): String {
    val n = boxPeople(g, kind).size
    return when (kind) {
        "bod" -> "BoD · $n"
        "manager" -> "Manager · $n"
        "staff" -> "$n orang"
        else -> "Di bawah ${(people.firstOrNull { "rt:${it.userId}" == kind }?.name ?: "?").split(" ")[0]} · $n"
    }
}

/** A card with its BoD and Manager boxes under it, top to bottom. */
fun stackOf(id: String, g: Group): List<String> =
    listOf("c:$id") + (if (g.bods.isNotEmpty()) listOf("b:$id:bod") else emptyList()) + (if (g.managers.isNotEmpty()) listOf("b:$id:manager") else emptyList())

/** Groups side by side: every group moves up next to the first one; the other cards keep their order around them. */
fun groupsTogether(list: List<OrgUnit>): List<OrgUnit> {
    val first = list.indexOfFirst { it.isGroup }
    if (first < 0) return list
    return list.subList(0, first).filterNot { it.isGroup } + list.filter { it.isGroup } + list.subList(first, list.size).filterNot { it.isGroup }
}

/** Left to right under a card: led sub-units and "di bawah" boxes in the order of their leaders, then
 *  the other sub-units, with the staff box in the middle (never between two groups). Inside a group: its cards. */
fun rowOf(u: OrgUnit, g: Group): List<String> {
    if (u.isGroup) return (g.led + groupsTogether(g.free)).map { "u:${it.id}" }
    data class K(val key: String, val at: Int, val box: Int)
    val byLeader = (g.led.map { K("u:${it.id}", g.leaderIdx[it.leadUserId] ?: 0, 0) } + g.rt.map { (id, _) -> K("b:${u.id}:rt:$id", g.leaderIdx[id] ?: 0, 1) })
        .sortedWith(compareBy<K>({ it.at }, { it.box })).map { it.key }
    val row = (byLeader + groupsTogether(g.free).map { "u:${it.id}" }).toMutableList()
    if (g.staff.isNotEmpty()) {
        val groupKeys = g.free.filter { it.isGroup }.map { "u:${it.id}" }.toSet()
        fun splits(i: Int) = i > 0 && i < row.size && row[i - 1] in groupKeys && row[i] in groupKeys
        val mid = row.size / 2
        val at = (0..row.size).sortedWith(compareBy<Int>({ abs(it - mid) }, { it })).firstOrNull { !splits(it) } ?: mid
        row.add(at, "b:${u.id}:staff")
    }
    return row
}

/** The people boxes a card has. */
fun boxKinds(g: Group): List<String> =
    (if (g.bods.isNotEmpty()) listOf("bod") else emptyList()) + (if (g.managers.isNotEmpty()) listOf("manager") else emptyList()) +
        (if (g.staff.isNotEmpty()) listOf("staff") else emptyList()) + g.rt.map { "rt:${it.first}" }

enum class ChartMode { RINGKAS, LENGKAP, FOKUS }
enum class CardTone { ROOT, IP, DIVISION, SUB }

/** The chart's tree with every derived lookup the layout and the screen need. */
class OrgTree(val data: OrgChartData) {
    val units = data.units
    val people = data.people
    val byId: Map<String, OrgUnit> = units.associateBy { it.id }
    val childUnits: Map<String, List<OrgUnit>> = units.filter { it.parentId != null }.groupBy { it.parentId!! }.mapValues { (_, v) -> v.sortedWith(byPos) }
    val membersOf: Map<String, List<OrgPerson>> = buildMap<String, MutableList<OrgPerson>> {
        for (p in people) for (id in p.unitIds) getOrPut(id) { mutableListOf() } += p
    }.mapValues { (_, v) -> v.sortedWith { a, b -> idCompare(a.label, b.label) } }

    private fun parentOf(id: String) = byId[id]?.parentId
    /** Parents of a unit, nearest first. */
    fun ancestors(id: String): List<String> {
        val out = mutableListOf<String>()
        val seen = mutableSetOf(id)
        var p = parentOf(id)
        while (p != null && byId.containsKey(p) && p !in seen) { out += p; seen += p; p = parentOf(p) }
        return out
    }
    fun effParentOf(id: String): String? = ancestors(id).firstOrNull { byId[it]?.isGroup != true }
    fun groupDepth(id: String) = ancestors(id).count { byId[it]?.isGroup == true }
    fun depthOf(id: String) = ancestors(id).size
    /** Cards (not groups) above a unit: 0 = the top. */
    fun levelOf(id: String) = ancestors(id).count { byId[it]?.isGroup != true }
    fun inGroup(id: String) = groupDepth(id) > 0
    fun descendantsOf(id: String): MutableSet<String> {
        val out = LinkedHashSet<String>()
        val stack = ArrayDeque(childUnits[id].orEmpty())
        while (stack.isNotEmpty()) { val c = stack.removeLast(); if (out.add(c.id)) stack.addAll(childUnits[c.id].orEmpty()) }
        return out
    }
    private fun leaderOrder(unitId: String): Map<String, Int> {
        val all = membersOf[unitId].orEmpty()
        val ordered = all.filter { it.isBoD } + all.filter { it.role == "MANAGER" }
        return ordered.mapIndexed { i, p -> p.userId to i }.toMap()
    }
    fun validLead(k: OrgUnit): Boolean {
        if (k.isGroup || k.leadUserId == null) return false
        val p = effParentOf(k.id) ?: return false
        return leaderOrder(p).containsKey(k.leadUserId)
    }
    val groups: Map<String, Group> = units.associate { u ->
        val kids = childUnits[u.id].orEmpty()
        if (!u.isGroup) u.id to groupUnit(u, kids, membersOf[u.id].orEmpty())
        else {
            // Inside a group: the cards led from the card above it first, in the order of their leaders there.
            val idx = effParentOf(u.id)?.let(::leaderOrder) ?: emptyMap()
            val led = kids.filter(::validLead).sortedWith { a, b -> (idx[a.leadUserId] ?: 0).compareTo(idx[b.leadUserId] ?: 0).takeIf { it != 0 } ?: byPos.compare(a, b) }
            u.id to Group(emptyList(), emptyList(), emptyList(), emptyList(), led, kids.filterNot(::validLead), emptyMap())
        }
    }
    val roots: List<OrgUnit> = units.filter { it.parentId == null || !byId.containsKey(it.parentId) }.sortedWith(byPos)

    /** The view chips: the cards right under the top (through any groups), in chart order. */
    val topUnits: List<OrgUnit> = buildList {
        val seen = HashSet<String>()
        fun walk(id: String) {
            for (k in childUnits[id].orEmpty()) {
                if (!seen.add(k.id)) continue
                if (k.isGroup) walk(k.id) else add(k)
            }
        }
        roots.forEach { walk(it.id) }
    }

    /** Is `id` somewhere below `above`? */
    fun isUnder(id: String, above: String): Boolean {
        val seen = HashSet<String>()
        var p = byId[id]?.parentId
        while (p != null && seen.add(p)) { if (p == above) return true; p = byId[p]?.parentId }
        return false
    }

    /** "PATS Group › PATS X" */
    fun pathOf(u: OrgUnit): String {
        val names = mutableListOf(u.name)
        val seen = mutableSetOf(u.id)
        var cur = u.parentId?.let(byId::get)
        while (cur != null && seen.add(cur.id)) { names.add(0, cur.name); cur = cur.parentId?.let(byId::get) }
        return names.joinToString(" › ")
    }
    /** "PT. The Z Networks › Framework Agency" — the path ABOVE a unit. */
    fun parentTrail(u: OrgUnit): String { val full = pathOf(u); val i = full.lastIndexOf(" › "); return if (i >= 0) full.substring(0, i) else "" }

    class CardInfo(val tone: CardTone, val meta: String, val faces: List<OrgPerson>)
    /** How a card looks: its tone by kind and level, the line under its name and, in Ringkas, the faces of its BoD/Manager. */
    fun cardInfo(u: OrgUnit, mode: ChartMode): CardInfo {
        val level = levelOf(u.id)
        val above = effParentOf(u.id)
        val tone = if (u.kind == "IP") (if (level == 0) CardTone.ROOT else CardTone.IP) else if (above != null && byId[above]?.kind == "DIVISION") CardTone.SUB else CardTone.DIVISION
        val own = membersOf[u.id].orEmpty()
        if (mode == ChartMode.RINGKAS && level >= 1) {
            val below = descendantsOf(u.id).toList()
            val all = HashSet<String>()
            for (id in listOf(u.id) + below) for (p in membersOf[id].orEmpty()) all += p.userId
            val parts = below.count { byId[it]?.isGroup != true }
            val meta = listOfNotNull(if (all.isNotEmpty()) "${all.size} orang" else "belum ada orang", if (parts > 0) "$parts bagian" else null).joinToString(" · ")
            return CardInfo(tone, meta, own.filter { it.isLead })
        }
        return CardInfo(tone, if (own.isNotEmpty()) "${own.size} orang" else "belum ada orang", emptyList())
    }
}

/** Where a leader's chip sits inside its box (measured), for the leader lines. */
data class ChipSpot(val box: String, val dx: Double, val dy: Double, val w: Double, val h: Double)

class ChartLayout(val rects: LinkedHashMap<String, Rect>, val lines: List<Routed>, val width: Double, val height: Double)

/** Every element the chart draws in a view, measured or not: cards, people boxes, group titles. */
fun elementKeys(tree: OrgTree): List<String> = buildList {
    for (u in tree.units) {
        val g = tree.groups[u.id] ?: continue
        if (u.isGroup) add("t:${u.id}") else { add("c:${u.id}"); boxKinds(g).forEach { add("b:${u.id}:$it") } }
    }
}

/**
 * The whole chart for one view, from measured sizes (the web's `layout` memo without the dragging):
 * Ringkas = the top card(s) with their people + only the cards right under them; Fokus = one card as the
 * root; Lengkap = everything, with the web's saved places (exactly there) and rows levelled.
 */
fun layoutChart(tree: OrgTree, mode: ChartMode, focusId: String?, sizes: Map<String, Size>, chips: Map<String, ChipSpot>): ChartLayout {
    val sizeOf = { k: String -> sizes[k] ?: Size(0.0, 0.0) }
    val shallow = mode == ChartMode.RINGKAS
    val base = tidyLayout(TreeSpec(
        roots = if (focusId != null) listOf(focusId) else tree.roots.map { it.id },
        isGroup = { tree.byId[it]?.isGroup == true },
        stack = { id -> if (shallow && tree.levelOf(id) >= 1) listOf("c:$id") else stackOf(id, tree.groups.getValue(id)) },
        row = { id ->
            val u = tree.byId.getValue(id)
            if (shallow && (if (u.isGroup) tree.levelOf(id) > 1 else tree.levelOf(id) >= 1)) emptyList() else rowOf(u, tree.groups.getValue(id))
        },
        // Room for one elbow per led sub-unit / "di bawah" box above the shared crossbar.
        band = { id -> val g = tree.groups.getValue(id); 46.0 + 12 * (g.led.size + g.rt.size) },
        size = sizeOf,
    ))
    val items = manualItems(tree, base, useSaved = mode == ChartMode.LENGKAP)
    var rects = applyManual(base.rects, items).first
    if (mode == ChartMode.LENGKAP) {
        val rows = mutableListOf<List<String>>()
        for (u in tree.units) {
            if (u.isGroup || tree.inGroup(u.id)) continue // laid out automatically, already level
            val keys = rowOf(u, tree.groups.getValue(u.id)).filter { it.startsWith("u:") }.map { "c:${it.substring(2)}" }
            if (keys.size > 1) rows += keys
        }
        rects = alignRows(rects, rows, { k -> base.subtree[k.substring(2)] ?: emptyList() })
    }
    val edges = buildEdges(tree, rects, chips)
    val isFrame = { k: String -> k.startsWith("c:") && tree.byId[k.substring(2)]?.isGroup == true }
    val lines = routeAll(edges, rects, isFrame)
    var width = 0.0; var height = 0.0
    for (r in rects.values) { width = max(width, r.x + r.w); height = max(height, r.y + r.h) }
    for (l in lines) for (p in l.pts) { width = max(width, p.x); height = max(height, p.y) }
    return ChartLayout(rects, lines, width + LAYOUT.margin, height + LAYOUT.margin)
}

/**
 * The web's saved places (Lengkap only), in the order they are applied: cards outside groups, shallow
 * first (a card takes its whole subtree along; a deeper card with a place of its own then moves again),
 * then people boxes. Each stays exactly where it was put. Mobile never drags, so no temp/shift here.
 */
fun manualItems(tree: OrgTree, base: Placement, useSaved: Boolean): List<ManualItem> {
    if (!useSaved) return emptyList()
    val cards = mutableListOf<Pair<Int, ManualItem>>()
    val boxes = mutableListOf<ManualItem>()
    for (u in tree.units) {
        val key = "c:${u.id}"
        if (!base.rects.containsKey(key)) continue
        val grouped = tree.inGroup(u.id)
        if (!grouped && u.layoutX != null && u.layoutY != null) {
            cards += tree.depthOf(u.id) to ManualItem(key, base.subtree[u.id] ?: listOf(key), key, Pt(u.layoutX, u.layoutY), false)
        }
        if (grouped || u.isGroup) continue
        for ((kind, p) in u.boxPlaces()) {
            val bk = "b:${u.id}:$kind"
            if (base.rects.containsKey(bk)) boxes += ManualItem(bk, listOf(bk), bk, p, false)
        }
    }
    return cards.sortedBy { it.first }.map { it.second } + boxes
}

/** Every connector, between ACTUAL positions: card → BoD box → Manager box; the last of those (a group:
 *  its title) → the staff box and the unled sub-units on one crossbar; a leader's chip → the sub-unit
 *  they lead and the box of the people under them, each elbow at its own height. */
fun buildEdges(tree: OrgTree, rects: Map<String, Rect>, chips: Map<String, ChipSpot>): List<EdgeSpec> {
    val edges = mutableListOf<EdgeSpec>()
    fun bottom(r: Rect) = Pt(r.x + r.w / 2, r.y + r.h)
    fun top(r: Rect) = Pt(r.x + r.w / 2, r.y)
    fun chipAt(key: String): Pair<String, Rect>? {
        val c = chips[key] ?: return null
        val b = rects[c.box] ?: return null
        return c.box to Rect(b.x + c.dx, b.y + c.dy, c.w, c.h)
    }
    for (u in tree.units) {
        val g = tree.groups[u.id] ?: continue
        if (!rects.containsKey("c:${u.id}")) continue
        var srcKey = "t:${u.id}"
        if (!u.isGroup) {
            val stack = stackOf(u.id, g)
            for (i in 1 until stack.size) {
                val a = rects[stack[i - 1]]; val b = rects[stack[i]]
                if (a != null && b != null) edges += EdgeSpec(stack[i - 1], stack[i], bottom(a), top(b), (a.y + a.h + b.y) / 2)
            }
            srcKey = stack.last()
        }
        val src = rects[srcKey] ?: continue
        val s = bottom(src)
        // Led cards inside a group are led from the card above the group.
        val fromChip = g.led.map { k -> "${if (u.isGroup) tree.effParentOf(k.id) else u.id}:${k.leadUserId}" to "c:${k.id}" } +
            g.rt.map { (id, _) -> "${u.id}:$id" to "b:${u.id}:rt:$id" }
        class Led(val from: String, val to: String, val s: Pt, val t: Pt)
        val led = fromChip.mapNotNull { (chipKey, to) ->
            val c = chipAt(chipKey); val r = rects[to]
            if (c != null && r != null) Led(c.first, to, bottom(c.second), top(r)) else null
        }
        // One 12px track per leader line, the one going farthest out highest; left-going first, then right-going.
        val out = led.filter { it.t.x < it.s.x }.sortedBy { it.t.x } + led.filter { it.t.x >= it.s.x }.sortedByDescending { it.t.x }
        out.forEachIndexed { k, e -> edges += EdgeSpec(e.from, e.to, e.s, e.t, s.y + 12 + 12 * k) }
        val bus = ((if (g.staff.isNotEmpty()) listOf("b:${u.id}:staff") else emptyList()) + g.free.map { "c:${it.id}" }).filter { rects.containsKey(it) }
        if (bus.isNotEmpty()) {
            val tops = bus.map { rects.getValue(it).y }.filter { it > s.y + 8 }
            val busY = if (tops.isNotEmpty()) tops.min() - 18 else s.y + 14
            val xs = bus.map { val r = rects.getValue(it); r.x + r.w / 2 }
            var x = if (u.isGroup) s.x else min(src.x + src.w - 18, max(src.x + 18, (xs.min() + xs.max()) / 2))
            // Only leader lines are a reason to leave the middle; without them it stays under the card.
            if (led.isEmpty() || abs(x - s.x) < 24) x = s.x
            else {
                // Off the middle it leaves through a gap between two people, never from under one of them.
                val inBox = chips.keys.filter { chips.getValue(it).box == srcKey }.mapNotNull { chipAt(it)?.second }.sortedBy { it.x }
                val gaps = inBox.drop(1).mapIndexed { i, r -> (inBox[i].x + inBox[i].w + r.x) / 2 }
                if (gaps.isNotEmpty()) x = gaps.fold(gaps[0]) { best, gx -> if (abs(gx - x) < abs(best - x)) gx else best }
            }
            var k = 0
            while (k < 6 && led.any { abs(it.s.x - x) < 10 }) { x = if (x + 12 <= src.x + src.w - 12) x + 12 else x - 12; k++ }
            val stem = Pt(x, s.y)
            for (b in bus) edges += EdgeSpec(srcKey, b, stem, top(rects.getValue(b)), busY)
        }
    }
    return edges
}
