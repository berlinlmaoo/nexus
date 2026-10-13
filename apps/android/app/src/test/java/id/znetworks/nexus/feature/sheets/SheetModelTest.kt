package id.znetworks.nexus.feature.sheets

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spreadsheet v1: tolerant reading, typing to stored values, the save queue and the merge/echo rules. */
class SheetModelTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s) as JsonObject
    private val shape = SheetFormula.Shape(listOf("ca", "cb"), listOf("r1", "r2", "r3"))

    @Test fun readsTheSheetWhateverItSends() {
        val d = SheetParse.sheet(obj("""{"id":"s1","name":"Budget","columns":[{"id":"ca","name":"Item","type":"text"},{"id":"cb","type":"weird","width":200}],
            "rows":[{"id":"r2","position":2,"cells":{"ca":"b","cb":{"f":"=SUM({cb!r1})"}},"updatedAt":"2026-10-13T01:00:00Z"},
                    {"id":"r1","position":1,"cells":{"ca":"a","cb":5,"zz":{"odd":true}},"styles":{"ca":{"b":1}},"height":null,"computed":{"cb":{"v":5,"d":"5"}}}],
            "settings":{"locale":"en-US","frozenRows":1,"hiddenCols":["cb"]},"canEdit":true,"canManage":false,
            "computed":{"r2":{"cb":{"v":5,"d":"5","formula":true}}},"brandNew":{"x":1}}"""))!!
        assertEquals(listOf("r1", "r2"), d.rows.map { it.id }) // position order
        assertEquals("text", d.columns[1].type) // unknown type → text
        assertTrue(d.en); assertEquals(1, d.frozenRows); assertEquals(setOf("cb"), d.hiddenCols)
        assertEquals("5", d.computed["r2"]?.get("cb")?.d); assertTrue(d.computed["r2"]?.get("cb")?.formula == true)
        assertEquals("5", d.computed["r1"]?.get("cb")?.d) // per-row computed read too
        assertEquals("", SheetCells.display("text", d.rows[0].cells["zz"], false)) // unknown shape shows nothing
        assertNull(SheetParse.sheet(obj("""{"name":"no id"}""")))
        assertEquals(listOf("a", "b"), SheetParse.tabs(obj("""{"sheets":[{"id":"b","name":"B","position":1},{"id":"a","name":"A","position":0,"hidden":false},{"x":1}]}""")).map { it.id })
    }

    @Test fun typingToStoredValues() {
        fun cell(type: String, text: String, prev: kotlinx.serialization.json.JsonElement? = null) = SheetCells.inputToCell(type, text, shape, prev, false).toString()
        assertEquals("""{"f":"=SUM({cb!r1}:{cb!r2})"}""", cell("text", "=SUM(B1:B2)"))
        assertEquals("true", cell("checkbox", "ya")); assertEquals("false", cell("checkbox", "nope"))
        assertEquals("1500000", cell("number", "1.500.000")); assertEquals("""{"v":0.15,"nf":"pct"}""", cell("currency", "15%"))
        assertEquals("7", cell("number", "007")) // a number column reads "007" as 7
        assertEquals("\"2026-10-11\"", cell("date", "11/10/2026")); assertEquals("\"someday\"", cell("date", "someday"))
        assertEquals("""{"v":1500000,"nf":"idr"}""", cell("text", "Rp 1.500.000")); assertEquals("\"0812\"", cell("text", "0812"))
        assertEquals("1500", cell("text", "1500"))
        assertEquals("""{"t":"Site","u":"https://x.id"}""", cell("link", "Site", obj("""{"t":"Old","u":"https://x.id"}""")))
        assertEquals("null", cell("text", "   "))
        assertTrue(SheetCells.sameCell(JsonPrimitive(""), null)); assertTrue(SheetCells.sameCell(JsonNull, null))
        assertFalse(SheetCells.sameCell(JsonPrimitive(1), JsonPrimitive("1")))
        // The edit bar starts with the formula in A1, Indonesian separators.
        assertEquals("=SUM(B1;B2*1,5)", SheetCells.editText("text", obj("""{"f":"=SUM({cb!r1},{cb!r2}*1.5)"}"""), shape, false))
        assertEquals("11/10/2026", SheetCells.editText("date", JsonPrimitive("2026-10-11"), shape, false))
        assertEquals("Rp 2.500", SheetCells.display("currency", JsonPrimitive(2500), false))
        assertEquals("11 Okt 2026", SheetCells.display("date", JsonPrimitive("2026-10-11"), false))
    }

    @Test fun saveQueue() {
        val q = SheetQueue()
        q.put("r1", "ca", JsonPrimitive("a")); q.put("r1", "ca", JsonPrimitive("b")); q.put("r2", "ca", JsonPrimitive(1))
        assertEquals(2, q.count) // newest value per cell
        val batch = q.take()!!
        assertEquals("\"b\"", batch["r1"]!!["ca"].toString())
        assertNull(q.take()) // one in flight
        q.put("r1", "ca", JsonPrimitive("typed later")); q.put("r1", "cb", JsonPrimitive("x"))
        q.putBack() // network failure: under what was typed since
        assertEquals("\"typed later\"", q.valuesFor("r1")["ca"].toString()); assertEquals("1", q.valuesFor("r2")["ca"].toString())
        assertEquals(3, q.count)
        val again = SheetQueue.fromJson(q.toJson())
        assertEquals(q.all().mapValues { it.value.mapValues { v -> v.value.toString() } }, again.all().mapValues { it.value.mapValues { v -> v.value.toString() } })
        again.take(); again.dropped(); assertTrue(again.isEmpty)
    }

    @Test fun mergeAndEchoRules() {
        assertTrue(SheetMerge.newerOrSame("2026-10-13T01:00:01Z", "2026-10-13T01:00:00Z"))
        assertTrue(SheetMerge.newerOrSame("2026-10-13T01:00:00Z", "2026-10-13T01:00:00.000Z"))
        assertFalse(SheetMerge.newerOrSame("2026-10-13T00:59:59Z", "2026-10-13T01:00:00Z"))
        assertTrue(SheetMerge.newerOrSame(null, "2026-10-13T01:00:00Z"))
        assertTrue(SheetMerge.isEcho("android-ab", "u2", "android-ab", "u1"))
        assertFalse(SheetMerge.isEcho("web-1", "u1", "android-ab", "u1")) // our own account in another tab is not an echo
        assertTrue(SheetMerge.isEcho(null, "u1", "android-ab", "u1")) // an older server: the actor decides
        val local = SheetRow("r1", 1.0, mapOf("ca" to JsonPrimitive("mine"), "cb" to JsonPrimitive("x")), emptyMap(), null, "2026-10-13T01:00:00Z")
        val incoming = SheetRow("r1", 1.0, mapOf("ca" to JsonPrimitive("theirs"), "cb" to JsonPrimitive("y")), emptyMap(), null, "2026-10-13T01:00:05Z")
        val merged = SheetMerge.apply(local, incoming, keep = setOf("ca"))
        assertEquals("\"mine\"", merged.cells["ca"].toString()); assertEquals("\"y\"", merged.cells["cb"].toString())
        assertEquals("2026-10-13T01:00:05Z", merged.updatedAt)
    }

    @Test fun rangesAndProtection() {
        val settings = obj("""{"protections":[{"id":"p","range":"{ca!r1}:{cb!r2}","except":["{cb!r2}"],"mode":"restrict","editors":["u2"],"by":"u9"}],
            "validations":[{"id":"v","ranges":["{cb!*}"],"kind":"list","values":["Yes","No"]},{"id":"c","ranges":["{ca!r3}"],"kind":"checkbox"}],
            "merges":[{"r":"r1","c":"ca","rs":2,"cs":1}]}""")
        val ps = SheetRanges.protections(settings)
        val p = SheetRanges.protectionAt(ps, 0, 0, shape)
        assertNotNull(p); assertTrue(p!!.restrict)
        assertNull(SheetRanges.protectionAt(ps, 1, 1, shape)) // the exception
        assertNull(SheetRanges.protectionAt(ps, 2, 0, shape)) // outside
        assertFalse(SheetRanges.mayEdit(p, "u1", canManage = false)); assertTrue(SheetRanges.mayEdit(p, "u2", false)); assertTrue(SheetRanges.mayEdit(p, "u1", true))
        assertEquals(listOf("Yes", "No"), SheetRanges.listValues(settings, 2, 1, shape)); assertNull(SheetRanges.listValues(settings, 2, 0, shape))
        assertTrue(SheetRanges.isCheckbox(settings, 2, 0, shape))
        assertEquals(setOf("r2" to "ca"), SheetRanges.mergedAway(settings, shape))
    }
}
