package id.znetworks.nexus.feature.sheets

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import kotlin.math.abs
import kotlin.math.floor

/*
 * The project Spreadsheet as the phone reads it (GET /api/sheets/:id?computed=1; dev web lib/nexus-api.ts,
 * iOS SheetAPI.swift). Everything is read by hand from JSON so an unknown field, type or shape never breaks
 * the screen: an unknown column type is text, an unknown cell shape shows "".
 */

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
private fun JsonElement?.int(): Int? = (this as? JsonPrimitive)?.intOrNull ?: num()?.toInt()
private fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.arr(): JsonArray? = this as? JsonArray
private fun JsonElement?.strings(): List<String> = arr()?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()

/** One tab of the project's spreadsheet (`GET /api/projects/:id/sheets`). */
data class SheetTab(val id: String, val name: String, val position: Int, val hidden: Boolean, val pivot: Boolean)

data class SheetColumn(
    val id: String,
    val name: String,
    /** text | number | currency | date | select | multiselect | checkbox | task | link (unknown → text). */
    val type: String,
    val width: Int?,
    val options: List<String>,
    val optionColors: Map<String, String>,
    /** The column as the server sent it: kept whole when the column list is written back. */
    val raw: JsonObject,
)

data class SheetRow(
    val id: String,
    val position: Double,
    val cells: Map<String, JsonElement>,
    val styles: Map<String, JsonObject>,
    val height: Int?,
    val updatedAt: String?,
)

/** The server's computed view of one cell: value, final display text, number format, formula / error marks. */
data class Computed(val v: JsonElement?, val d: String, val nf: String?, val formula: Boolean, val error: Boolean)

data class SheetData(
    val id: String,
    val projectId: String?,
    val name: String,
    val columns: List<SheetColumn>,
    val rows: List<SheetRow>,
    val settings: JsonObject,
    val canEdit: Boolean,
    val canManage: Boolean,
    /** rowId → colId → computed; empty when the server sent none (client formatting then). */
    val computed: Map<String, Map<String, Computed>>,
) {
    val en: Boolean get() = settings["locale"].str() == "en-US"
    val shape: SheetFormula.Shape get() = SheetFormula.Shape(columns.map { it.id }, rows.map { it.id })
    val hiddenRows: Set<String> get() = settings["hiddenRows"].strings().toSet()
    val hiddenCols: Set<String> get() = settings["hiddenCols"].strings().toSet()
    val frozenRows: Int get() = settings["frozenRows"].int()?.coerceIn(0, 20) ?: 0
    val frozenCols: Int get() = settings["frozenCols"].int()?.coerceIn(0, 10) ?: 0
    /** A pivot tab: its cells are derived on the web; read-only here. */
    val pivot: Boolean get() = settings["pivot"] != null && settings["pivot"] !is JsonNull
}

object SheetParse {
    fun tabs(o: JsonObject): List<SheetTab> = o["sheets"].arr().orEmpty().mapNotNull { e ->
        val t = e.obj() ?: return@mapNotNull null
        val id = t["id"].str() ?: return@mapNotNull null
        SheetTab(id, t["name"].str().orEmpty(), t["position"].int() ?: 0, t["hidden"].bool() == true, t["pivot"].bool() == true)
    }.sortedBy { it.position }

    private fun computedCell(e: JsonElement?): Computed? {
        val c = e.obj() ?: return null
        return Computed(c["v"], c["d"].str() ?: c["d"]?.let { (it as? JsonPrimitive)?.contentOrNull } ?: "", c["nf"].str(),
            c["formula"].bool() == true, c["error"].bool() == true)
    }

    private fun computedRow(e: JsonElement?): Map<String, Computed> =
        e.obj()?.mapNotNull { (col, v) -> computedCell(v)?.let { col to it } }?.toMap().orEmpty()

    /**
     * The sheet. The computed view's exact key is not pinned down yet: read a top-level `computed`
     * (rowId → colId → cell) and a per-row `computed` object, whichever the server sends.
     */
    fun sheet(o: JsonObject): SheetData? {
        val id = o["id"].str() ?: return null
        val columns = o["columns"].arr().orEmpty().mapNotNull { e ->
            val c = e.obj() ?: return@mapNotNull null
            val cid = c["id"].str() ?: return@mapNotNull null
            SheetColumn(cid, c["name"].str().orEmpty(), (c["type"].str() ?: "text").lowercase().takeIf { it in TYPES } ?: "text",
                c["width"].int(), c["options"].strings(),
                c["optionColors"].obj()?.mapNotNull { (k, v) -> v.str()?.let { k to it } }?.toMap().orEmpty(), c)
        }
        val top = o["computed"].obj()?.mapValues { (_, v) -> computedRow(v) }.orEmpty().toMutableMap()
        val rows = o["rows"].arr().orEmpty().mapIndexedNotNull { i, e ->
            val r = e.obj() ?: return@mapIndexedNotNull null
            val rid = r["id"].str() ?: return@mapIndexedNotNull null
            r["computed"]?.let { pr -> val m = computedRow(pr); if (m.isNotEmpty()) top[rid] = (top[rid].orEmpty() + m) }
            row(r, rid, i)
        }.sortedBy { it.position }
        return SheetData(id, o["projectId"].str(), o["name"].str().orEmpty(), columns, rows, o["settings"].obj() ?: JsonObject(emptyMap()),
            o["canEdit"].bool() ?: false, o["canManage"].bool() ?: false, top)
    }

    fun row(r: JsonObject, rid: String = r["id"].str().orEmpty(), index: Int = 0): SheetRow = SheetRow(
        rid, r["position"].num() ?: index.toDouble(),
        r["cells"].obj()?.filterValues { it !is JsonNull }.orEmpty(),
        r["styles"].obj()?.mapNotNull { (k, v) -> v.obj()?.let { k to it } }?.toMap().orEmpty(),
        r["height"].int(), r["updatedAt"].str(),
    )

    /** `{ rows: [{ id, cells, styles?, updatedAt }] }` of a save reply or a `sheet-cells` event. */
    fun rows(o: JsonObject): List<SheetRow> = o["rows"].arr().orEmpty().mapNotNull { e -> e.obj()?.let { r -> r["id"].str()?.let { row(r, it) } } }

    val TYPES = setOf("text", "number", "currency", "date", "select", "multiselect", "checkbox", "task", "link")
}

/** Reading and writing one cell (web components/sheets/sheet-types.ts). */
object SheetCells {
    fun isFormula(raw: JsonElement?): Boolean = raw.obj()?.get("f").str() != null
    fun formula(raw: JsonElement?): String? = raw.obj()?.get("f").str()
    private fun typed(raw: JsonElement?): Pair<Double, String>? {
        val o = raw.obj() ?: return null
        val v = o["v"].num() ?: return null
        val nf = o["nf"].str() ?: return null
        return if (nf in setOf("num", "idr", "pct", "date")) v to nf else null
    }
    private fun link(raw: JsonElement?): Pair<String, String>? {
        val o = raw.obj() ?: return null
        val u = o["u"].str() ?: return null
        return (o["t"].str() ?: "") to u
    }
    fun linkUrl(raw: JsonElement?): String? = link(raw)?.second

    /** A JSON number: whole numbers without ".0", so a no-op edit compares equal. */
    fun number(v: Double): JsonPrimitive = if (v == floor(v) && abs(v) < 1e15) JsonPrimitive(v.toLong()) else JsonPrimitive(v)

    /** What a stored value reads as under its column type (web formatScalar), when the server gave no display text. */
    fun display(type: String, raw: JsonElement?, en: Boolean): String {
        if (raw == null || raw is JsonNull) return ""
        if (raw is JsonArray) return raw.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
        typed(raw)?.let { (v, nf) -> return SheetFormula.formatNumber(v, nf, en) }
        link(raw)?.let { (t, u) -> return t.ifEmpty { u } }
        if (raw is JsonObject) return ""
        val p = raw as JsonPrimitive
        if (p.isString && p.content.isEmpty()) return ""
        return when (type) {
            "currency" -> p.num()?.let { SheetFormula.formatRupiah(it, en) } ?: p.content
            "number" -> p.num()?.let { SheetFormula.formatGrouped(it, 2, en) } ?: p.content
            "date" -> p.num()?.let { SheetFormula.formatDateSerial(it, en) }
                ?: SheetFormula.parseDateText(p.content, en)?.let { SheetFormula.formatDateSerial(it.toDouble(), en) } ?: p.content
            "checkbox" -> if (p.bool() == true || p.content == "true") "✓" else ""
            else -> p.num()?.let { SheetFormula.formatNumber(it, null, en) } ?: p.bool()?.let { if (it) "TRUE" else "FALSE" } ?: p.content
        }
    }

    /** What the edit bar starts with: a formula in A1 with the locale's separators, typed numbers as typed. */
    fun editText(type: String, raw: JsonElement?, shape: SheetFormula.Shape, en: Boolean): String {
        if (raw == null || raw is JsonNull) return ""
        formula(raw)?.let { return SheetFormula.toDisplay(it, shape, en) }
        typed(raw)?.let { (v, nf) -> return SheetFormula.editTyped(v, nf, en) }
        link(raw)?.let { (t, u) -> return t.ifEmpty { u } }
        if (raw is JsonArray) return raw.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
        if (raw is JsonObject) return ""
        val p = raw as JsonPrimitive
        if (type == "date") { SheetFormula.isoToSerial(p.content)?.let { return SheetFormula.editDateSerial(it.toDouble(), en) } }
        p.num()?.let { return SheetFormula.numberText(it, 10, false, en) }
        return p.content
    }

    /** Typed text → the value to store for this column (web inputToCell): the one path for typing. */
    fun inputToCell(type: String, text: String, shape: SheetFormula.Shape, prevRaw: JsonElement?, en: Boolean): JsonElement {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return JsonNull
        if (trimmed.startsWith("=") && trimmed.length > 1 && type != "checkbox") return JsonObject(mapOf("f" to JsonPrimitive(SheetFormula.toStored(trimmed, shape))))
        return when (type) {
            "checkbox" -> JsonPrimitive(trimmed.lowercase() in setOf("true", "1", "ya", "yes", "y", "✓", "x"))
            "link" -> link(prevRaw)?.second?.takeIf { it.isNotEmpty() }?.let { u -> JsonObject(mapOf("t" to JsonPrimitive(trimmed), "u" to JsonPrimitive(u))) } ?: JsonPrimitive(trimmed)
            "multiselect", "select", "task" -> JsonPrimitive(trimmed)
            "number", "currency" -> when (val d = SheetFormula.detectInput(trimmed, en)) {
                is SheetFormula.Detected.Number -> if (d.nf == "pct" || d.nf == "date") typedCell(d.v, d.nf) else number(d.v)
                else -> SheetFormula.parseLocaleNumber(trimmed, en)?.let { number(it.n) } ?: JsonPrimitive(text)
            }
            "date" -> SheetFormula.parseDateText(trimmed, en)?.let { JsonPrimitive(SheetFormula.serialToIso(it.toDouble())) } ?: JsonPrimitive(text)
            else -> when (val d = SheetFormula.detectInput(text, en)) {
                is SheetFormula.Detected.Number -> if (d.nf != null) typedCell(d.v, d.nf) else number(d.v)
                else -> JsonPrimitive(text)
            }
        }
    }

    private fun typedCell(v: Double, nf: String) = JsonObject(mapOf("v" to number(v), "nf" to JsonPrimitive(nf)))

    /** Same content (a no-op edit spends no request): "" and missing are null. */
    fun sameCell(a: JsonElement?, b: JsonElement?): Boolean {
        fun norm(e: JsonElement?): JsonElement = when {
            e == null || e is JsonNull -> JsonNull
            e is JsonPrimitive && e.isString && e.content.isEmpty() -> JsonNull
            else -> e
        }
        return norm(a).toString() == norm(b).toString()
    }

    fun checked(raw: JsonElement?): Boolean = (raw as? JsonPrimitive)?.let { it.bool() ?: (it.content.lowercase() in setOf("true", "1", "ya", "yes", "y", "✓", "x")) } ?: false
}

/** Ranges are stored in id-space: `{colId!rowId}:{colId!rowId}`, a whole column `{colId!*}`. */
object SheetRanges {
    data class Rect(val top: Int, val left: Int, val bottom: Int, val right: Int) {
        fun contains(r: Int, c: Int) = r in top..bottom && c in left..right
    }

    private val REF = Regex("\\{\\$?([^!}]+)!\\$?([^}]+)\\}")

    fun rect(range: String, shape: SheetFormula.Shape): Rect? {
        val refs = REF.findAll(range).toList()
        if (refs.isEmpty()) return null
        fun pos(m: MatchResult): Pair<Int?, Int?> {
            val c = shape.columnIds.indexOf(m.groupValues[1]).takeIf { it >= 0 }
            val r = if (m.groupValues[2] == "*") null else shape.rowIds.indexOf(m.groupValues[2]).takeIf { it >= 0 } ?: -2
            return r to c
        }
        val (r1, c1) = pos(refs[0]); val (r2, c2) = pos(refs.getOrElse(1) { refs[0] })
        if (c1 == null || c2 == null || r1 == -2 || r2 == -2) return null
        val whole = r1 == null || r2 == null
        return Rect(if (whole) 0 else minOf(r1!!, r2!!), minOf(c1, c2), if (whole) Int.MAX_VALUE else maxOf(r1!!, r2!!), maxOf(c1, c2))
    }

    /** A protected part of the sheet (settings.protections). */
    data class Protection(val ranges: List<String>, val sheet: Boolean, val except: List<String>, val restrict: Boolean, val editors: Set<String>, val by: String?)

    fun protections(settings: JsonObject): List<Protection> = settings["protections"].arr().orEmpty().mapNotNull { e ->
        val p = e.obj() ?: return@mapNotNull null
        val ranges = p["range"].str()?.let { listOf(it) } ?: p["ranges"].strings()
        Protection(ranges, p["sheet"].bool() == true, p["except"].strings(), p["mode"].str() == "restrict", p["editors"].strings().toSet(), p["by"].str())
    }

    /** The protection covering a cell, if any (inside its range or the whole sheet, and not in its exceptions). */
    fun protectionAt(list: List<Protection>, row: Int, col: Int, shape: SheetFormula.Shape): Protection? = list.firstOrNull { p ->
        val inside = p.sheet || p.ranges.any { rect(it, shape)?.contains(row, col) == true }
        inside && p.except.none { rect(it, shape)?.contains(row, col) == true }
    }

    /** May this person change a cell under [p]: its owner, a listed editor, or Full access. */
    fun mayEdit(p: Protection, me: String?, canManage: Boolean) = canManage || (me != null && (p.by == me || me in p.editors))

    /** The dropdown values of a cell: a `list` validation covering it, else the select column's options. */
    fun listValues(settings: JsonObject, row: Int, col: Int, shape: SheetFormula.Shape): List<String>? =
        settings["validations"].arr().orEmpty().firstNotNullOfOrNull { e ->
            val v = e.obj() ?: return@firstNotNullOfOrNull null
            if (v["kind"].str() != "list") return@firstNotNullOfOrNull null
            if (v["ranges"].strings().none { rect(it, shape)?.contains(row, col) == true }) return@firstNotNullOfOrNull null
            v["values"].strings()
        }

    /** A `checkbox` validation covering the cell. */
    fun isCheckbox(settings: JsonObject, row: Int, col: Int, shape: SheetFormula.Shape): Boolean =
        settings["validations"].arr().orEmpty().any { e ->
            val v = e.obj() ?: return@any false
            v["kind"].str() == "checkbox" && v["ranges"].strings().any { rect(it, shape)?.contains(row, col) == true }
        }

    /** Cells hidden under a merge (every cell of a merged block but its top-left one). */
    fun mergedAway(settings: JsonObject, shape: SheetFormula.Shape): Set<Pair<String, String>> {
        val out = HashSet<Pair<String, String>>()
        settings["merges"].arr().orEmpty().forEach { e ->
            val m = e.obj() ?: return@forEach
            val r0 = shape.rowIds.indexOf(m["r"].str() ?: return@forEach); val c0 = shape.columnIds.indexOf(m["c"].str() ?: return@forEach)
            if (r0 < 0 || c0 < 0) return@forEach
            val rs = m["rs"].int() ?: 1; val cs = m["cs"].int() ?: 1
            for (r in r0 until minOf(r0 + rs, shape.rowIds.size)) for (c in c0 until minOf(c0 + cs, shape.columnIds.size)) {
                if (r != r0 || c != c0) out += shape.rowIds[r] to shape.columnIds[c]
            }
        }
        return out
    }
}

/** Ordering and echo rules shared by saves, realtime and refetches (web f661bfb, iOS SheetStore). */
object SheetMerge {
    private fun instant(s: String?): Instant? = s?.let { runCatching { Instant.parse(it) }.getOrNull() }

    /** An incoming row replaces the local one only when it is not older (parsed instants; unknown = take it). */
    fun newerOrSame(incoming: String?, local: String?): Boolean {
        val i = instant(incoming) ?: return true
        val l = instant(local) ?: return true
        return !i.isBefore(l)
    }

    /** Our own change coming back: `originTab` names this app; an older server sends none, then the actor is me. */
    fun isEcho(originTab: String?, actorId: String?, myTab: String, me: String?): Boolean =
        if (originTab != null) originTab == myTab else (me != null && actorId == me)

    /**
     * A server row laid over the local one: its cells, except the cell being edited and every pending value, which
     * stay as they are on screen.
     */
    fun apply(local: SheetRow, incoming: SheetRow, keep: Set<String>): SheetRow {
        val cells = incoming.cells.toMutableMap()
        keep.forEach { col -> local.cells[col]?.let { cells[col] = it } ?: cells.remove(col) }
        // A row without styles (an event that sent none) keeps the ones on screen.
        return local.copy(cells = cells, styles = incoming.styles.ifEmpty { local.styles }, height = incoming.height ?: local.height,
            updatedAt = incoming.updatedAt ?: local.updatedAt)
    }
}
