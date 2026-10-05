package id.znetworks.nexus.feature.admin.orgchart

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * "Done when" of the mobile spec (web final 5 Oct 2026): on the real chart (fixture = GET
 * /api/admin/org-chart on 5 Oct, e-mails replaced, no avatars), 0 overlapping legs between different
 * lines and 0 crossings in Ringkas and in every per-IP view, and PATS' row = Community, Outlet,
 * PATS Entertainment, PATS Archive.
 *
 * Sizes: the phone measures the real views; here two size models stand in for them (the app's own
 * proportions at 1× and with large text), so the routing is checked on more than one geometry.
 */
class OrgChartLayoutTest {
    private val data = NexusJson.decodeFromString(OrgChartData.serializer(),
        javaClass.classLoader!!.getResource("org-chart-2026-10-05.json")!!.readText())
    private val tree = OrgTree(data)

    /** Sizes and leader-chip spots as the Compose views produce them (card 176–232, rows 148–212, …). */
    private class Model(val k: Double) {
        fun card(u: OrgUnit, info: OrgTree.CardInfo): Size {
            val text = u.name.length * 7.2 * k + (if (u.kind == "IP") 46 else 0) + 24
            val w = min(232.0 * k, max(if (info.tone == CardTone.ROOT) 212.0 * k else 176.0 * k, text))
            val lines = if (text > 232 * k) 2 else 1
            return Size(w, (if (info.tone == CardTone.ROOT) 64.0 else 52.0) * k + (lines - 1) * 16 * k + if (info.faces.isNotEmpty()) 26 * k else 0.0)
        }
        val rowW = 180.0 * k; val rowH = 34.0 * k; val label = 20.0 * k; val pad = 6.0
        fun box(kind: String, n: Int): Pair<Size, List<Pair<Double, Double>>> {
            val horizontal = kind == "bod" || kind == "manager"
            val twoCols = !horizontal && n >= 6
            val spots = (0 until n).map { i ->
                when {
                    horizontal -> pad + i * (rowW + 4) to pad + label
                    twoCols -> pad + (i % 2) * (rowW + 4) to pad + label + (i / 2) * (rowH + 2)
                    else -> pad to pad + label + i * (rowH + 2)
                }
            }
            val cols = if (horizontal) n else if (twoCols) 2 else 1
            val rows = if (horizontal) 1 else if (twoCols) (n + 1) / 2 else n
            return Size(2 * pad + cols * rowW + (cols - 1) * 4, 2 * pad + label + rows * rowH + (rows - 1) * 2) to spots
        }
    }

    private fun measure(mode: ChartMode, m: Model): Pair<Map<String, Size>, Map<String, ChipSpot>> {
        val sizes = HashMap<String, Size>(); val chips = HashMap<String, ChipSpot>()
        for (u in tree.units) {
            val g = tree.groups.getValue(u.id)
            if (u.isGroup) { sizes["t:${u.id}"] = Size((u.name.length + 4) * 7.5 * m.k + 20, 22 * m.k); continue }
            sizes["c:${u.id}"] = m.card(u, tree.cardInfo(u, mode))
            for (kind in boxKinds(g)) {
                val list = boxPeople(g, kind)
                val (size, spots) = m.box(kind, list.size)
                val key = "b:${u.id}:$kind"
                sizes[key] = size
                list.forEachIndexed { i, p -> if (p.isLead) chips["${u.id}:${p.userId}"] = ChipSpot(key, spots[i].first, spots[i].second, m.rowW, m.rowH) }
            }
        }
        return sizes to chips
    }

    private data class Seg(val line: Int, val bundle: String, val a: Pt, val b: Pt) {
        val horizontal get() = abs(a.y - b.y) < 0.5
    }
    private fun segments(lines: List<Routed>): List<Seg> = lines.flatMapIndexed { li, l ->
        val bundle = "${l.e.from}@${jsRound(l.e.s.x)},${jsRound(l.e.s.y)}"
        l.pts.zipWithNext().filter { (a, b) -> a.x != b.x || a.y != b.y }.map { (a, b) -> Seg(li, bundle, a, b) }
    }
    /** Collinear legs of different lines (different bundles) that share more than a pixel. */
    private fun overlapping(segs: List<Seg>): List<String> {
        val out = mutableListOf<String>()
        for (i in segs.indices) for (j in i + 1 until segs.size) {
            val p = segs[i]; val q = segs[j]
            if (p.bundle == q.bundle || p.horizontal != q.horizontal) continue
            val shared = if (p.horizontal) {
                if (abs(p.a.y - q.a.y) > 0.5) continue
                min(max(p.a.x, p.b.x), max(q.a.x, q.b.x)) - max(min(p.a.x, p.b.x), min(q.a.x, q.b.x))
            } else {
                if (abs(p.a.x - q.a.x) > 0.5) continue
                min(max(p.a.y, p.b.y), max(q.a.y, q.b.y)) - max(min(p.a.y, p.b.y), min(q.a.y, q.b.y))
            }
            if (shared > 1) out += "${p.bundle} / ${q.bundle} at ${if (p.horizontal) "y=${p.a.y}" else "x=${p.a.x}"}"
        }
        return out
    }
    /** A horizontal leg of one line passing through a vertical leg of another, both strictly inside. */
    private fun crossings(segs: List<Seg>): List<String> {
        val out = mutableListOf<String>()
        for (h in segs) {
            if (!h.horizontal) continue
            for (v in segs) {
                if (v.horizontal || v.bundle == h.bundle) continue
                val x = v.a.x; val y = h.a.y
                val inH = x > min(h.a.x, h.b.x) + 0.5 && x < max(h.a.x, h.b.x) - 0.5
                val inV = y > min(v.a.y, v.b.y) + 0.5 && y < max(v.a.y, v.b.y) - 0.5
                if (inH && inV) out += "${h.bundle} × ${v.bundle} at ($x, $y)"
            }
        }
        return out
    }

    private fun views(): List<Pair<String, String?>> = listOf("Ringkas" to null) + tree.topUnits.map { it.name to it.id }

    @Test fun fixtureIsTheRealChart() {
        assertEquals(26, data.units.size); assertEquals(48, data.people.size)
        assertEquals(listOf("PT. The Z Networks"), tree.roots.map { it.name })
    }

    @Test fun noOverlapsNoCrossingsInRingkasAndEveryIp() {
        for (k in listOf(1.0, 1.3)) for ((name, focus) in views()) {
            val mode = if (focus == null) ChartMode.RINGKAS else ChartMode.FOKUS
            val (sizes, chips) = measure(mode, Model(k))
            val l = layoutChart(tree, mode, focus, sizes, chips)
            val segs = segments(l.lines)
            assertEquals("overlapping legs in $name (×$k)", emptyList<String>(), overlapping(segs))
            assertEquals("crossings in $name (×$k)", emptyList<String>(), crossings(segs))
            // Cards and boxes never sit on each other in an automatic view (group frames contain theirs).
            val solid = l.rects.filterKeys { !(it.startsWith("c:") && tree.byId[it.substring(2)]?.isGroup == true) && !it.startsWith("t:") }.entries.toList()
            for (i in solid.indices) for (j in i + 1 until solid.size) assertTrue("${solid[i].key} on ${solid[j].key} in $name", !overlaps(solid[i].value, solid[j].value))
        }
    }

    @Test fun patsRowOrder() {
        val pats = data.units.first { it.name == "PATS" }
        val row = rowOf(pats, tree.groups.getValue(pats.id)).filter { it.startsWith("u:") }.map { tree.byId.getValue(it.substring(2)).name }
        assertEquals(listOf("Community", "Outlet", "PATS Entertainment", "PATS Archive"), row)
        // And drawn left to right in that order in its own view.
        val (sizes, chips) = measure(ChartMode.FOKUS, Model(1.0))
        val l = layoutChart(tree, ChartMode.FOKUS, pats.id, sizes, chips)
        val drawn = row.map { n -> n to l.rects.getValue("c:${data.units.first { it.name == n && it.parentId == pats.id }.id}").x }.sortedBy { it.second }.map { it.first }
        assertEquals(row, drawn)
    }

    @Test fun ringkasShowsOnlyTheTopAndTheCardsUnderIt() {
        val (sizes, chips) = measure(ChartMode.RINGKAS, Model(1.0))
        val l = layoutChart(tree, ChartMode.RINGKAS, null, sizes, chips)
        val cards = l.rects.keys.filter { it.startsWith("c:") }.map { tree.byId.getValue(it.substring(2)) }.filterNot { it.isGroup }.map { it.name }.toSet()
        assertEquals(setOf("PT. The Z Networks") + tree.topUnits.map { it.name }, cards)
        val fa = tree.cardInfo(data.units.first { it.name == "Framework Agency" }, ChartMode.RINGKAS)
        assertTrue(fa.people > 0 && fa.parts > 0)
    }

    @Test fun lengkapPutsSavedCardsExactlyThere() {
        val (sizes, chips) = measure(ChartMode.LENGKAP, Model(1.0))
        val l = layoutChart(tree, ChartMode.LENGKAP, null, sizes, chips)
        // A placed card whose row was not levelled (no sibling within 28px) sits exactly at its saved place.
        val placed = data.units.filter { it.layoutX != null && !tree.inGroup(it.id) }
        assertTrue(placed.isNotEmpty())
        val exact = placed.count { u -> val r = l.rects.getValue("c:${u.id}"); r.x == u.layoutX && abs(r.y - u.layoutY!!) <= 28 }
        assertEquals(placed.size, exact)
    }

    @Test fun theCheckersCatchBadLines() {
        fun line(from: String, vararg p: Pair<Int, Int>) = Routed(EdgeSpec(from, "x", Pt(p[0].first.toDouble(), p[0].second.toDouble()), Pt(0.0, 0.0), 0.0),
            p.map { Pt(it.first.toDouble(), it.second.toDouble()) }.toMutableList())
        val crossing = listOf(line("a", 0 to 0, 0 to 50, 100 to 50, 100 to 100), line("b", 50 to 0, 50 to 100))
        assertEquals(1, crossings(segments(crossing)).size)
        val alongside = listOf(line("a", 0 to 0, 0 to 50, 100 to 50, 100 to 100), line("b", 20 to 0, 20 to 50, 80 to 50, 80 to 100))
        assertEquals(1, overlapping(segments(alongside)).size)
        // One bundle (a crossbar's stem shared by its lines) is not an overlap.
        val bus = listOf(line("a", 50 to 0, 50 to 30, 0 to 30, 0 to 60), line("a", 50 to 0, 50 to 30, 100 to 30, 100 to 60))
        assertEquals(0, overlapping(segments(bus)).size)
    }
}
