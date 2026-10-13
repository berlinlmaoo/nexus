package id.znetworks.nexus.feature.admin.orgchart

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Bagan IP & Divisi — layout engine, a 1:1 port of the web's `lib/org-chart-layout.ts` (web final 5 Oct
 * 2026, commit 070c9f8). Pure: no Compose, no Android, so it is unit-tested on its own. Units are the
 * web's CSS pixels; the screen uses them as dp.
 *
 * 1. tidyLayout: a tidy tree built bottom-up from MEASURED sizes. A card's own block is the card with
 *    its BoD and Manager boxes stacked under it; its row (sub-units, the staff box in the middle, the
 *    "di bawah" boxes) sits under that block, side by side and centred; a group is a frame around its
 *    own row. Blocks never overlap by construction.
 * 2. applyManual: manual positions move a card's whole subtree (or one box).
 * 3. route: right-angled connectors that go round cards and boxes instead of through them.
 */
data class Size(val w: Double, val h: Double)
data class Rect(val x: Double, val y: Double, val w: Double, val h: Double)
data class Pt(var x: Double, var y: Double)

/** JavaScript's Math.round: halves go up (towards +∞), unlike Kotlin's roundToInt for negatives. */
internal fun jsRound(v: Double): Double = floor(v + 0.5)

object LAYOUT {
    const val margin = 24.0
    const val rootGap = 56.0
    const val gapX = 28.0
    const val vOwn = 20.0
    const val bandMin = 48.0
    const val gPadX = 22.0
    const val gPadTop = 12.0
    const val gBand = 38.0
    const val gPadBottom = 20.0
    const val gEmpty = 46.0
    const val gMinW = 200.0
    const val snap = 8.0
    /** Room kept between a moved item and everything else. */
    const val clear = 16.0
}

class TreeSpec(
    val roots: List<String>,
    val isGroup: (String) -> Boolean,
    /** Non-group: its card and BoD/Manager boxes, top to bottom ("c:<id>", "b:<id>:bod", "b:<id>:manager"). */
    val stack: (String) -> List<String>,
    /** Items of the row under a card ("u:<childId>" or a box key) or inside a group ("u:<childId>"), left to right. */
    val row: (String) -> List<String>,
    /** Vertical room between a card's own block and its row, for the connectors. */
    val band: (String) -> Double,
    /** Measured size of "c:<id>" (cards), "b:…" (boxes) and "t:<groupId>" (group titles). */
    val size: (String) -> Size,
)

class Placement(
    /** "c:<id>" is a card, or a group's frame; "t:<id>" a group's title; "b:…" a people box. Insertion-ordered. */
    val rects: LinkedHashMap<String, Rect>,
    /** Unit id → every element key of its block (itself and everything below it). */
    val subtree: Map<String, List<String>>,
    val width: Double,
    val height: Double,
)

private class Block(val w: Double, val h: Double, val items: List<Pair<String, Rect>>)

fun tidyLayout(spec: TreeSpec): Placement {
    val subtree = HashMap<String, List<String>>()
    val visiting = HashSet<String>()
    fun put(items: MutableList<Pair<String, Rect>>, b: Block, dx: Double, dy: Double) {
        for ((k, r) in b.items) items += k to Rect(r.x + dx, r.y + dy, r.w, r.h)
    }
    fun leaf(key: String): Block {
        val s = spec.size(key)
        return Block(s.w, s.h, listOf(key to Rect(0.0, 0.0, s.w, s.h)))
    }
    fun unit(id: String): Block {
        if (id in visiting) return Block(0.0, 0.0, emptyList()) // a loop in the data: drawn once
        visiting += id
        val kids = spec.row(id).map { k -> if (k.startsWith("u:")) unit(k.substring(2)) else leaf(k) }.filter { it.w > 0 }
        val rowW = kids.sumOf { it.w } + LAYOUT.gapX * max(0, kids.size - 1)
        val rowH = kids.fold(0.0) { m, b -> max(m, b.h) }
        val items = mutableListOf<Pair<String, Rect>>()
        val w: Double
        val h: Double
        val rowTop: Double
        if (spec.isGroup(id)) {
            val t = spec.size("t:$id")
            w = maxOf(t.w, rowW, LAYOUT.gMinW - 2 * LAYOUT.gPadX) + 2 * LAYOUT.gPadX
            rowTop = LAYOUT.gPadTop + t.h + LAYOUT.gBand
            h = if (kids.isNotEmpty()) rowTop + rowH + LAYOUT.gPadBottom else LAYOUT.gPadTop + t.h + LAYOUT.gEmpty
            items += "c:$id" to Rect(0.0, 0.0, w, h)
            items += "t:$id" to Rect((w - t.w) / 2, LAYOUT.gPadTop, t.w, t.h)
        } else {
            val stack = spec.stack(id).map { it to spec.size(it) }
            val ownW = stack.fold(0.0) { m, (_, s) -> max(m, s.w) }
            val ownH = stack.sumOf { it.second.h } + LAYOUT.vOwn * max(0, stack.size - 1)
            w = max(ownW, rowW)
            var y = 0.0
            for ((k, s) in stack) {
                items += k to Rect((w - s.w) / 2, y, s.w, s.h)
                y += s.h + LAYOUT.vOwn
            }
            rowTop = ownH + if (kids.isNotEmpty()) max(LAYOUT.bandMin, spec.band(id)) else 0.0
            h = if (kids.isNotEmpty()) rowTop + rowH else ownH
        }
        var x = (w - rowW) / 2
        for (b in kids) {
            put(items, b, x, rowTop)
            x += b.w + LAYOUT.gapX
        }
        visiting -= id
        subtree[id] = items.map { it.first }
        return Block(w, h, items)
    }
    val rects = LinkedHashMap<String, Rect>()
    var x = LAYOUT.margin
    var height = 0.0
    for (id in spec.roots) {
        val b = unit(id)
        if (b.w <= 0) continue
        for ((k, r) in b.items) rects[k] = Rect(jsRound(r.x + x), jsRound(r.y + LAYOUT.margin), r.w, r.h)
        x += b.w + LAYOUT.rootGap
        height = max(height, b.h)
    }
    return Placement(rects, subtree, max(0.0, x - LAYOUT.rootGap) + LAYOUT.margin, height + 2 * LAYOUT.margin)
}

// ── manual positions ────────────────────────────────────────────────────────────────────────────

data class ManualItem(
    /** Id this item is reported under (the card's unit id, or the box key). */
    val id: String,
    /** Elements that move together (a card's whole subtree, or one box). */
    val keys: List<String>,
    /** The element whose top-left is `pos`. */
    val anchor: String,
    val pos: Pt,
    /** Push it to the nearest free place when it lands on something. */
    val resolve: Boolean,
)

fun overlaps(a: Rect, b: Rect, gap: Double = 0.0): Boolean =
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

fun bboxOf(rs: List<Rect>): Rect {
    val x1 = rs.minOf { it.x }; val y1 = rs.minOf { it.y }
    val x2 = rs.maxOf { it.x + it.w }; val y2 = rs.maxOf { it.y + it.h }
    return Rect(x1, y1, x2 - x1, y2 - y1)
}
private fun up8(v: Double) = ceil(v / LAYOUT.snap) * LAYOUT.snap
private fun down8(v: Double) = floor(v / LAYOUT.snap) * LAYOUT.snap

/**
 * The nearest top-left for `box` (8px grid, never left of / above the margin) where it keeps
 * LAYOUT.clear away from every rect in `others`.
 */
fun nearestFree(box: Rect, others: List<Rect>): Pt {
    val g = LAYOUT.clear
    val xs = linkedSetOf(max(LAYOUT.margin, jsRound(box.x)))
    val ys = linkedSetOf(max(LAYOUT.margin, jsRound(box.y)))
    for (o in others) {
        xs += up8(o.x + o.w + g); xs += down8(o.x - box.w - g)
        ys += up8(o.y + o.h + g); ys += down8(o.y - box.h - g)
    }
    data class C(val x: Double, val y: Double, val d: Double)
    val cands = mutableListOf<C>()
    for (x in xs) {
        if (x < LAYOUT.margin) continue
        for (y in ys) {
            if (y < LAYOUT.margin) continue
            cands += C(x, y, (x - box.x) * (x - box.x) + (y - box.y) * (y - box.y))
        }
    }
    for (c in cands.sortedBy { it.d }) {
        val r = Rect(c.x, c.y, box.w, box.h)
        if (others.none { overlaps(r, it, g - 1) }) return Pt(c.x, c.y)
    }
    val right = max(LAYOUT.margin, others.maxOfOrNull { it.x + it.w } ?: LAYOUT.margin)
    return Pt(up8(right + g), max(LAYOUT.margin, jsRound(box.y)))
}

/**
 * Apply manual positions in order. An item with `resolve` that ends up closer than half the clearance
 * to anything outside itself moves, as a whole, to the nearest free place.
 */
fun applyManual(base: Map<String, Rect>, items: List<ManualItem>): Pair<LinkedHashMap<String, Rect>, Map<String, Pt>> {
    val rects = LinkedHashMap(base)
    val resolved = HashMap<String, Pt>()
    fun shift(keys: List<String>, dx: Double, dy: Double) {
        if (dx == 0.0 && dy == 0.0) return
        for (k in keys) rects[k]?.let { r -> rects[k] = Rect(r.x + dx, r.y + dy, r.w, r.h) }
    }
    for (it in items) {
        val a = rects[it.anchor] ?: continue
        val keys = it.keys.filter { k -> rects.containsKey(k) }
        shift(keys, jsRound(it.pos.x - a.x), jsRound(it.pos.y - a.y))
        if (it.resolve && keys.isNotEmpty()) {
            val mine = keys.toSet()
            val others = rects.filterKeys { k -> k !in mine }.values.toList()
            val moved = keys.map { k -> rects.getValue(k) }
            val half = LAYOUT.clear / 2
            if (moved.any { m -> m.x < 0 || m.y < 0 || others.any { o -> overlaps(m, o, half) } }) {
                val box = bboxOf(moved)
                val to = nearestFree(box, others)
                shift(keys, to.x - box.x, to.y - box.y)
            }
        }
        val fa = rects.getValue(it.anchor)
        resolved[it.id] = Pt(fa.x, fa.y)
    }
    return rects to resolved
}

// ── connectors ──────────────────────────────────────────────────────────────────────────────────

/** Does the axis-parallel segment a–b run through the inside of `r` (touching an edge is fine)? */
fun segmentHits(a: Pt, b: Pt, r: Rect): Boolean {
    val e = 1.0
    if (abs(a.x - b.x) < 0.5) {
        if (a.x <= r.x + e || a.x >= r.x + r.w - e) return false
        return max(a.y, b.y) > r.y + e && min(a.y, b.y) < r.y + r.h - e
    }
    if (a.y <= r.y + e || a.y >= r.y + r.h - e) return false
    return max(a.x, b.x) > r.x + e && min(a.x, b.x) < r.x + r.w - e
}
private fun hitsOf(pts: List<Pt>, obstacles: List<Rect>): Int {
    var n = 0
    for (i in 1 until pts.size) for (o in obstacles) if (segmentHits(pts[i - 1], pts[i], o)) n++
    return n
}
private fun lengthOf(pts: List<Pt>): Double {
    var n = 0.0
    for (i in 1 until pts.size) n += abs(pts[i].x - pts[i - 1].x) + abs(pts[i].y - pts[i - 1].y)
    return n
}
private fun tidyPath(pts: List<Pt>): MutableList<Pt> {
    val out = mutableListOf<Pt>()
    for (p in pts) {
        val q = Pt(jsRound(p.x), jsRound(p.y))
        val last = out.lastOrNull()
        if (last != null && last.x == q.x && last.y == q.y) continue
        val prev = if (out.size >= 2) out[out.size - 2] else null
        if (last != null && prev != null && ((prev.x == last.x && last.x == q.x) || (prev.y == last.y && last.y == q.y))) out[out.size - 1] = q
        else out += q
    }
    return out
}

/**
 * Right-angled path from s (the bottom of the source) to t (the top of the target). First choice: down,
 * across at `prefY`, down. When that runs through something: other heights, then a detour down–across–
 * (up or down)–across–down along a free column. `quick` skips the search.
 */
fun route(s: Pt, t: Pt, obstacles: List<Rect>, prefY: Double, quick: Boolean = false): MutableList<Pt> {
    fun elbow(my: Double) = listOf(s, Pt(s.x, my), Pt(t.x, my), t)
    val below = t.y > s.y + 8
    fun clampY(y: Double) = min(t.y - 4, max(s.y + 4, y))
    if (quick) return tidyPath(if (below) elbow(clampY(prefY)) else listOf(s, Pt(s.x, s.y + 12), Pt(t.x, s.y + 12), t))

    val first = mutableListOf<List<Pt>>()
    if (below) {
        val mys = mutableListOf(prefY, t.y - 16, s.y + 12, (s.y + t.y) / 2)
        for (o in obstacles) {
            if (o.y > s.y && o.y < t.y) mys += o.y - 10
            val ob = o.y + o.h
            if (ob > s.y && ob < t.y) mys += ob + 10
        }
        for (my in mys) if (my > s.y + 3 && my < t.y - 3) first += elbow(my)
    }
    for (p in first) if (hitsOf(p, obstacles) == 0) return tidyPath(p)

    val around = mutableListOf<List<Pt>>()
    val yas = listOf(s.y + 12, s.y + 8, s.y + 18)
    val ybs = listOf(prefY, t.y - 12, t.y - 18, t.y - 8).filter { it < t.y - 3 }
    val xcs = linkedSetOf(s.x, t.x)
    for (o in obstacles) { xcs += o.x - 12; xcs += o.x + o.w + 12 }
    for (ya in yas) for (yb in ybs) for (xc in xcs) {
        around += listOf(s, Pt(s.x, ya), Pt(xc, ya), Pt(xc, yb), Pt(t.x, yb), t)
    }
    val sortedAround = around.sortedBy { lengthOf(it) }
    for (p in sortedAround) if (hitsOf(p, obstacles) == 0) return tidyPath(p)

    mazeRoute(s, t, obstacles)?.let { return tidyPath(it) }

    val all = first + sortedAround
    var best = all.firstOrNull() ?: elbow((s.y + t.y) / 2)
    var bestHits = Int.MAX_VALUE
    for (p in all) {
        val h = hitsOf(p, obstacles)
        if (h < bestHits || (h == bestHits && lengthOf(p) < lengthOf(best))) { best = p; bestHits = h }
    }
    return tidyPath(best)
}

/**
 * Last resort when no simple shape is clear: the shortest right-angled path (few bends preferred) over
 * a grid made of the obstacles' edges, leaving the source downwards and entering the target from above.
 */
private fun mazeRoute(s: Pt, t: Pt, obstacles: List<Rect>): List<Pt>? {
    val pad = 10.0
    val sy = s.y + pad; val ty = t.y - pad
    val xsSet = linkedSetOf(s.x, t.x)
    val ysSet = linkedSetOf(sy, ty)
    for (o in obstacles) {
        xsSet += o.x - pad; xsSet += o.x + o.w + pad
        ysSet += o.y - pad; ysSet += o.y + o.h + pad
    }
    val xs = xsSet.sorted()
    val ys = ysSet.sorted()
    val xi = HashMap<Double, Int>().apply { xs.forEachIndexed { i, v -> put(v, i) } }
    val yi = HashMap<Double, Int>().apply { ys.forEachIndexed { i, v -> put(v, i) } }
    fun inside(x: Double, y: Double) = obstacles.any { o -> x > o.x + 1 && x < o.x + o.w - 1 && y > o.y + 1 && y < o.y + o.h - 1 }
    if (!(segmentClear(Pt(s.x, s.y), Pt(s.x, sy), obstacles) && segmentClear(Pt(t.x, ty), t, obstacles))) return null
    val memo = HashMap<String, Boolean>()
    fun clear(a: Pt, b: Pt, key: String) = memo.getOrPut(key) { segmentClear(a, b, obstacles) }
    val w = xs.size; val h = ys.size
    val start = xi.getValue(s.x) + yi.getValue(sy) * w
    val goal = xi.getValue(t.x) + yi.getValue(ty) * w
    val bend = 40.0
    // state = node * 4 + dir (0 right, 1 left, 2 down, 3 up); entering the start going down.
    val dist = HashMap<Int, Double>()
    val prev = HashMap<Int, Int>()
    val heap = ArrayList<Pair<Double, Int>>()
    fun push(d: Double, st: Int) {
        heap += d to st
        var i = heap.size - 1
        while (i > 0) {
            val p = (i - 1) shr 1
            if (heap[p].first <= heap[i].first) break
            val tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p
        }
    }
    fun pop(): Pair<Double, Int>? {
        if (heap.isEmpty()) return null
        val top = heap[0]
        val last = heap.removeAt(heap.size - 1)
        if (heap.isNotEmpty()) {
            heap[0] = last
            var i = 0
            while (true) {
                val l = 2 * i + 1; val r = l + 1
                var m = i
                if (l < heap.size && heap[l].first < heap[m].first) m = l
                if (r < heap.size && heap[r].first < heap[m].first) m = r
                if (m == i) break
                val tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m
            }
        }
        return top
    }
    // A*: priority = cost so far + straight-line (Manhattan) distance left.
    fun hOf(node: Int): Double { val cx = node % w; return abs(xs[cx] - t.x) + abs(ys[(node - cx) / w] - ty) }
    val s0 = start * 4 + 2
    dist[s0] = 0.0
    push(hOf(start), s0)
    var found = -1
    var guard = 0
    while (heap.isNotEmpty() && guard++ < 250000) {
        val (f, st) = pop()!!
        val node = st shr 2; val dir = st and 3
        val d = dist[st] ?: Double.POSITIVE_INFINITY
        if (f > d + hOf(node) + 1e-6) continue
        if (node == goal) { found = st; break }
        val cx = node % w; val cy = (node - cx) / w
        val steps = arrayOf(intArrayOf(cx + 1, cy, 0), intArrayOf(cx - 1, cy, 1), intArrayOf(cx, cy + 1, 2), intArrayOf(cx, cy - 1, 3))
        for ((nx, ny, nd) in steps.map { Triple(it[0], it[1], it[2]) }) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            if ((dir xor nd) == 1 && dir / 2 == nd / 2) continue // no U-turn
            val a = Pt(xs[cx], ys[cy]); val b = Pt(xs[nx], ys[ny])
            if (inside(b.x, b.y)) continue
            val key = if (nd < 2) "h${min(cx, nx)}:$cy" else "v$cx:${min(cy, ny)}"
            if (!clear(a, b, key)) continue
            val nst = (nx + ny * w) * 4 + nd
            val nd2 = d + abs(b.x - a.x) + abs(b.y - a.y) + if (nd == dir) 0.0 else bend
            if (nd2 < (dist[nst] ?: Double.POSITIVE_INFINITY)) { dist[nst] = nd2; prev[nst] = st; push(nd2 + hOf(nx + ny * w), nst) }
        }
    }
    if (found < 0) return null
    val pts = mutableListOf(t)
    var st: Int? = found
    while (st != null) {
        val node = st shr 2
        val cx = node % w
        pts += Pt(xs[cx], ys[(node - cx) / w])
        st = prev[st]
    }
    pts += s
    return pts.reversed()
}
private fun segmentClear(a: Pt, b: Pt, obstacles: List<Rect>): Boolean = obstacles.none { segmentHits(a, b, it) }

/**
 * The same right-angled path with its bends rounded (radius r, smaller where a leg is short), as drawing
 * steps: a line to a point, or a quadratic curve through a control point to a point.
 */
sealed interface PathStep {
    data class Move(val x: Double, val y: Double) : PathStep
    data class Line(val x: Double, val y: Double) : PathStep
    data class Quad(val cx: Double, val cy: Double, val x: Double, val y: Double) : PathStep
}
fun pathRounded(pts: List<Pt>, r: Double = 8.0): List<PathStep> {
    if (pts.isEmpty()) return emptyList()
    val out = mutableListOf<PathStep>(PathStep.Move(pts[0].x, pts[0].y))
    if (pts.size < 3) { pts.drop(1).forEach { out += PathStep.Line(it.x, it.y) }; return out }
    for (i in 1 until pts.size - 1) {
        val a = pts[i - 1]; val b = pts[i]; val c = pts[i + 1]
        val l1 = hypot(b.x - a.x, b.y - a.y); val l2 = hypot(c.x - b.x, c.y - b.y)
        val rr = minOf(r, l1 / 2, l2 / 2)
        if (rr < 0.5) { out += PathStep.Line(b.x, b.y); continue }
        out += PathStep.Line(b.x + ((a.x - b.x) / l1) * rr, b.y + ((a.y - b.y) / l1) * rr)
        out += PathStep.Quad(b.x, b.y, b.x + ((c.x - b.x) / l2) * rr, b.y + ((c.y - b.y) / l2) * rr)
    }
    val z = pts.last()
    out += PathStep.Line(z.x, z.y)
    return out
}

/**
 * Rows placed by hand are rarely exactly level. Siblings whose tops are within `tol` of each other,
 * chained, are lined up on the highest of them, each one moving with its whole block — unless that
 * would land it on something.
 */
fun alignRows(base: Map<String, Rect>, rows: List<List<String>>, blockOf: (String) -> List<String>, tol: Double = 28.0): LinkedHashMap<String, Rect> {
    val rects = LinkedHashMap(base)
    for (row in rows) {
        val items = row.mapNotNull { k -> rects[k]?.let { k to it } }.sortedBy { it.second.y }
        var i = 0
        while (i < items.size) {
            var j = i
            while (j + 1 < items.size && items[j + 1].second.y - items[j].second.y <= tol) j++
            val target = items[i].second.y
            for (k in i + 1..j) {
                val (key, r) = items[k]
                val dy = target - r.y
                if (dy == 0.0) continue
                val keys = linkedSetOf(key).apply { addAll(blockOf(key).filter { rects.containsKey(it) }) }
                val moved = keys.map { x -> val q = rects.getValue(x); x to q.copy(y = q.y + dy) }
                val others = rects.filterKeys { it !in keys }.values
                if (moved.any { (_, m) -> m.y < 0 || others.any { o -> overlaps(m, o, 4.0) } }) continue
                for ((x, m) in moved) rects[x] = m
            }
            i = j + 1
        }
    }
    return rects
}

class SepLine(val bundle: String, val pts: MutableList<Pt>, val minY: Double)

/**
 * Lines that run along each other are pulled apart. A horizontal leg between two vertical ones is a
 * track; the legs of one bundle (lines leaving the same point) at one height are one track and move
 * together, and a bundle's tracks that nearly meet are merged into one. Tracks of different bundles
 * that overlap and sit closer than `gap` are spread `gap` apart around their middle — each within the
 * room its neighbouring vertical legs leave, never above `minY` and never through a card. Moves `pts`
 * in place.
 */
fun separateLines(lines: List<SepLine>, blocked: (Int, Pt, Pt) -> Boolean, gap: Double = 12.0) {
    class Leg(val li: Int, val i: Int)
    class Track(val bundle: String, var y: Double, val legs: MutableList<Leg>, var x1: Double, var x2: Double, var lo: Double, var hi: Double)
    val m6 = 6.0
    fun tracksNow(): List<Track> {
        val m = LinkedHashMap<String, Track>()
        lines.forEachIndexed { li, ln ->
            val p = ln.pts
            var i = 1
            while (i + 2 < p.size) {
                if (abs(p[i].y - p[i + 1].y) > 0.5 || abs(p[i - 1].x - p[i].x) > 0.5 || abs(p[i + 1].x - p[i + 2].x) > 0.5) { i++; continue }
                val y = p[i].y
                var lo = ln.minY; var hi = Double.POSITIVE_INFINITY
                if (p[i - 1].y < y) lo = max(lo, p[i - 1].y + m6) else hi = min(hi, p[i - 1].y - m6)
                if (p[i + 2].y > y) hi = min(hi, p[i + 2].y - m6) else lo = max(lo, p[i + 2].y + m6)
                val x1 = min(p[i].x, p[i + 1].x); val x2 = max(p[i].x, p[i + 1].x)
                val key = "${ln.bundle}|${jsRound(y).toLong()}"
                val t = m[key]
                if (t != null) { t.legs += Leg(li, i); t.x1 = min(t.x1, x1); t.x2 = max(t.x2, x2); t.lo = max(t.lo, lo); t.hi = min(t.hi, hi) }
                else m[key] = Track(ln.bundle, y, mutableListOf(Leg(li, i)), x1, x2, lo, hi)
                i++
            }
        }
        return m.values.toList()
    }
    fun overlapX(a: Track, b: Track) = min(a.x2, b.x2) - max(a.x1, b.x1)
    fun canMove(t: Track, ny: Double): Boolean {
        if (ny < t.lo || ny > t.hi) return false
        for (leg in t.legs) {
            val p = lines[leg.li].pts
            val a = Pt(p[leg.i].x, ny); val b = Pt(p[leg.i + 1].x, ny)
            if (blocked(leg.li, a, b) || blocked(leg.li, p[leg.i - 1], a) || blocked(leg.li, b, p[leg.i + 2])) return false
        }
        return true
    }
    fun move(t: Track, ny: Double) {
        for (leg in t.legs) { lines[leg.li].pts[leg.i].y = ny; lines[leg.li].pts[leg.i + 1].y = ny }
        t.y = ny
    }

    // 1. One bundle, one height: legs of the same bundle that nearly meet join the busier one.
    val byBundle = LinkedHashMap<String, MutableList<Track>>()
    for (t in tracksNow()) byBundle.getOrPut(t.bundle) { mutableListOf() } += t
    for (list in byBundle.values) {
        list.sortBy { it.y }
        for (k in 1 until list.size) {
            val a = list[k - 1]; val b = list[k]
            if (b.y - a.y < gap && b.y - a.y > 0.5 && overlapX(a, b) > -gap) {
                val (from, to) = if (b.legs.size > a.legs.size) a to b else b to a
                if (canMove(from, to.y)) move(from, to.y)
            }
        }
    }

    // 2. Different bundles: spread every cluster of too-close, overlapping tracks `gap` apart.
    repeat(3) {
        val ts = tracksNow()
        val up = IntArray(ts.size) { it }
        fun find(i: Int): Int { if (up[i] == i) return i; up[i] = find(up[i]); return up[i] }
        var any = false
        for (i in ts.indices) for (j in i + 1 until ts.size) {
            if (ts[i].bundle != ts[j].bundle && abs(ts[i].y - ts[j].y) < gap - 0.5 && overlapX(ts[i], ts[j]) > 2) { up[find(i)] = find(j); any = true }
        }
        if (!any) return
        val clusters = LinkedHashMap<Int, MutableList<Track>>()
        ts.forEachIndexed { i, t -> clusters.getOrPut(find(i)) { mutableListOf() } += t }
        var moved = false
        for (c in clusters.values) {
            if (c.size < 2) continue
            c.sortWith(compareBy<Track>({ it.y }, { it.x1 }))
            val mean = c.sumOf { it.y } / c.size
            val want = DoubleArray(c.size) { k -> mean - (gap * (c.size - 1)) / 2 + k * gap }
            for (k in c.indices) {
                want[k] = min(c[k].hi, max(c[k].lo, want[k]))
                if (k > 0) want[k] = max(want[k], want[k - 1] + gap)
            }
            for (k in c.size - 2 downTo 0) want[k] = max(c[k].lo, min(want[k], want[k + 1] - gap))
            for (k in c.indices) {
                val ny = jsRound(want[k])
                if (abs(ny - c[k].y) > 0.5 && canMove(c[k], ny)) { move(c[k], ny); moved = true }
            }
        }
        if (!moved) return
    }
}

class EdgeSpec(
    /** Source element (a card, box or group title) — the line may start inside it. */
    val from: String,
    /** Target element — the line ends on its top edge. */
    val to: String,
    val s: Pt,
    val t: Pt,
    val prefY: Double,
)
class Routed(val e: EdgeSpec, val pts: MutableList<Pt>)

/** Everything a line has to go round: all elements except its own two ends and the group frames it
 *  starts or ends inside (a line has to cross those to get in). */
fun obstaclesOf(e: EdgeSpec, rects: Map<String, Rect>, isFrame: (String) -> Boolean): List<Rect> {
    fun inside(r: Rect, p: Pt) = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    val out = mutableListOf<Rect>()
    for ((k, r) in rects) if (k != e.from && k != e.to && !(isFrame(k) && (inside(r, e.s) || inside(r, e.t)))) out += r
    return out
}

/**
 * Route every edge around every element except its own two ends and the group frames it starts or
 * ends inside, then pull lines that run along each other apart.
 */
fun routeAll(edges: List<EdgeSpec>, rects: Map<String, Rect>, isFrame: (String) -> Boolean, quick: Boolean = false): List<Routed> {
    val routed = edges.map { e -> Routed(e, route(e.s, e.t, if (quick) emptyList() else obstaclesOf(e, rects, isFrame), e.prefY, quick)) }
    if (quick) return routed
    val obstacles = routed.map { obstaclesOf(it.e, rects, isFrame) }
    separateLines(
        routed.map { r ->
            val src = rects[r.e.from]
            SepLine("${r.e.from}@${jsRound(r.e.s.x).toLong()},${jsRound(r.e.s.y).toLong()}", r.pts, (src?.let { it.y + it.h } ?: r.e.s.y) + 6)
        },
        { li, a, b -> obstacles[li].any { o -> segmentHits(a, b, o) } },
    )
    return routed
}
