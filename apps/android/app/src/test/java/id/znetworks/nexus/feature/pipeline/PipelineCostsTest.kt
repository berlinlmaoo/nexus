package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Real cost & margin (Control Tower v4–v6, owner 14 Oct 2026). */
class PipelineCostsTest {
    private fun json(s: String) = NexusJson.parseToJsonElement(s).jsonObject
    private fun deal(s: String) = PipelineDeal(json(s))

    @Test fun linesAndMarginFromTheDeal() {
        val d = deal("""{"id":"a","netValue":100000000,"costTotal":1,"margin":1,"marginPct":1,"costs":[
            {"id":"c_1","label":"Vendor sound","amount":30000000},{"id":"c_2","amount":"x"},{"label":"no id","amount":5},"junk",{"id":"c_3","label":"Talent","amount":45000000}]}""")
        assertEquals(listOf("c_1", "c_2", "c_3"), d.costs.map { it.id }) // a line without id is dropped
        assertEquals("", d.costs[1].label); assertEquals(0.0, d.costs[1].amount, 0.0)
        // Worked out from the lines, as the server does (so an optimistic edit shows at once).
        assertEquals(75000000.0, d.costTotal, 0.0); assertEquals(25000000.0, d.margin!!, 0.0); assertEquals(0.25, d.marginPct!!, 1e-9)
        assertEquals(25000000.0 to 0.25, PipelineCosts.cardMargin(d))
    }

    @Test fun noNetValueMeansNoMargin() {
        val d = deal("""{"id":"a","netValue":0,"contractValue":90000000,"costs":[{"id":"c_1","label":"x","amount":10}]}""")
        assertNull(d.margin); assertNull(d.marginPct); assertNull(PipelineCosts.cardMargin(d))
        assertNull(PipelineCosts.margin(-5.0, 1.0))
        // A net value but no lines: the sheet shows a margin, the card does not.
        val none = deal("""{"id":"b","netValue":50}""")
        assertTrue(none.costs.isEmpty()); assertEquals(50.0, none.margin!!, 0.0); assertNull(PipelineCosts.cardMargin(none))
        // An older server: no costs at all, or not a list.
        assertTrue(deal("""{"id":"c","costs":"nope"}""").costs.isEmpty())
    }

    @Test fun tones() {
        assertEquals(PipelineCosts.Tone.NEGATIVE, PipelineCosts.tone(-1.0))
        assertEquals(PipelineCosts.Tone.POSITIVE, PipelineCosts.tone(1.0))
        assertEquals(PipelineCosts.Tone.NEUTRAL, PipelineCosts.tone(0.0))
        assertEquals(PipelineCosts.Tone.NEUTRAL, PipelineCosts.tone(null))
        val loss = deal("""{"id":"a","netValue":100,"costs":[{"id":"c_1","amount":130}]}""")
        assertEquals(-30.0, loss.margin!!, 0.0); assertEquals(-0.3, loss.marginPct!!, 1e-9)
        assertEquals("-30%", PipelineFormat.pct(loss.marginPct!!))
    }

    @Test fun newIdHasTheServersShape() {
        repeat(50) { assertTrue(Regex("^c_[0-9a-f]{16}$").matches(PipelineCosts.newId())) }
        assertTrue(PipelineCosts.newId() != PipelineCosts.newId())
    }

    @Test fun editsAndLimits() {
        val one = PipelineCosts.add(emptyList(), "c_a")!!
        assertEquals(listOf(PipelineCost("c_a", "", 0.0)), one)
        val labelled = PipelineCosts.relabel(one, "c_a", "  Vendor   sound ")
        assertEquals("Vendor sound", labelled[0].label)
        assertEquals(120, PipelineCosts.relabel(one, "c_a", "x".repeat(200))[0].label.length)
        assertEquals(12000000.0, PipelineCosts.reprice(labelled, "c_a", 11999999.6)!![0].amount, 0.0)
        assertNull(PipelineCosts.reprice(labelled, "c_a", -1.0)); assertNull(PipelineCosts.reprice(labelled, "c_a", null))
        assertTrue(PipelineCosts.remove(labelled, "c_a").isEmpty())
        val full = (1..100).map { PipelineCost("c_$it", "", 0.0) }
        assertNull(PipelineCosts.add(full)); assertTrue(PipelineCosts.valid(full))
        assertFalse(PipelineCosts.valid(full + PipelineCost("c_x", "", 0.0)))
        assertFalse(PipelineCosts.valid(listOf(PipelineCost("c_x", "", -1.0))))
        assertFalse(PipelineCosts.valid(listOf(PipelineCost("c_x", "", 1.5))))
        assertFalse(PipelineCosts.valid(listOf(PipelineCost("c_x", "y".repeat(121), 1.0))))
    }

    @Test fun patchIsTheWholeList() {
        val p = PipelineCosts.patch(listOf(PipelineCost("c_1", "Sound", 12000000.0), PipelineCost("c_2", "", 0.0)))
        assertEquals("""{"costs":[{"id":"c_1","label":"Sound","amount":12000000},{"id":"c_2","label":"","amount":0}]}""", p.toString())
        // Laid over the deal (the optimistic edit), it reads back the same.
        val d = deal("""{"id":"a","netValue":20000000}""").with(p)
        assertEquals(2, d.costs.size); assertEquals(8000000.0, d.margin!!, 0.0)
    }

    @Test fun historyText() {
        val before = NexusJson.parseToJsonElement("""[{"id":"c_1","label":"a","amount":1000},{"id":"c_2","label":"b","amount":2500}]""")
        assertEquals(2 to 3500.0, PipelineCosts.historyLines(before))
        assertNull(PipelineCosts.historyLines(JsonArray(emptyList()))); assertNull(PipelineCosts.historyLines(JsonNull)); assertNull(PipelineCosts.historyLines(null))
        assertEquals(id.znetworks.nexus.R.string.pc_real_cost, PipelineText.field("costs"))
    }

    @Test fun accessAndSummaryFromTheServer() {
        val d = PipelineData.of(json("""{"deals":[],"summary":{"realCost":40,"realProfit":-10,"costDealCount":2,"costEligibleCount":5,"costNoNetCount":1},
            "viewerAccessLevel":"COMMENT","canEdit":false}"""))
        assertFalse(d.canEdit); assertEquals("COMMENT", d.viewerAccessLevel)
        assertEquals(-10.0, d.summary.n("realProfit"), 0.0); assertEquals(40.0, d.summary.n("realCost"), 0.0)
        assertEquals(2, d.summary.i("costDealCount")); assertEquals(5, d.summary.i("costEligibleCount")); assertEquals(1, d.summary.i("costNoNetCount"))
        assertTrue(PipelineData.of(json("""{"deals":[],"viewerAccessLevel":"FULL","canEdit":true}""")).canEdit)
        // An older server says nothing: editable, the new KPIs read 0.
        val old = PipelineData.of(json("""{"deals":[],"summary":{}}"""))
        assertTrue(old.canEdit); assertNull(old.viewerAccessLevel); assertEquals(0.0, old.summary.n("realProfit"), 0.0)
    }

    /** Every pc_ string and plural exists in EN and ID, and nowhere else. */
    @Test fun stringsInBothLanguages() {
        val res = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }
        fun names(dir: String) = File(res, dir).listFiles()!!.filter { it.extension == "xml" }.flatMap { f ->
            Regex("""<(?:string|plurals) name="(pc_[a-z_]+)"""").findAll(f.readText()).map { f.name to it.groupValues[1] }.toList()
        }
        val en = names("values"); val id = names("values-in")
        assertTrue(en.isNotEmpty())
        assertTrue(en.all { it.first == "strings_pipeline_cost.xml" }); assertTrue(id.all { it.first == "strings_pipeline_cost.xml" })
        assertEquals(en.map { it.second }.sorted(), id.map { it.second }.sorted())
        assertEquals(en.size, en.map { it.second }.toSet().size)
    }
}
