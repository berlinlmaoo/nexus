package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.admin.RestoreKinds
import id.znetworks.nexus.feature.projects.ProjectTab
import id.znetworks.nexus.feature.projects.ProjectTabsLogic
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PIPELINE-DASHBOARD §8 (Berlin, 9 Oct): read leniently, server-computed health, tabs, filters, words. */
class PipelineTest {
    private fun data(json: String) = PipelineData.of(NexusJson.parseToJsonElement(json).jsonObject)
    private val sample = """{"project":{"id":"p","workspaceId":"w"},"today":"2026-10-09",
      "summary":{"openValue":950000000,"openCount":3,"weightedValue":250000000.5,"criticalCount":1},
      "vocab":{"stages":["Incoming","Proposal / Quotation","Negotiation","Won – Contract Pending","Won – In Execution","Closing","Closed","Lost / Cancelled","Future stage"]},
      "deals":[
        {"id":"a","code":"TZN-26001","name":"Gala","brand":"Acme","stage":"Won – In Execution","netValue":500000000,"pm":{"id":"u1","name":"Rina"},"pmUserId":"u1",
         "health":{"key":"CRITICAL","reasons":[{"code":"RECEIVABLE_OVERDUE","days":9},{"code":"BLOCKER","text":"No PO"},{"code":"SOMETHING_NEW"}]},
         "phases":[{"key":"commercial","state":"done"},{"key":"contract","state":"bad"}],"daysOverdue":9,"outstandingReceivable":10000000,
         "nextAction":"Call client","nextActionDate":"2026-10-12","blocker":"No PO","links":[{"type":"SPK","url":"https://x.test/spk"}]},
        {"id":"b","name":"Expo","stage":"Incoming","contractValue":"oops","probability":0.25,"bdName":"Freelancer","health":{"key":"NOT_STARTED"},"nextActionDate":"2026-11-30"},
        {"id":"c","name":"Lost one","stage":"Lost / Cancelled","health":{"key":"NONE"},"nextActionDate":"2026-10-01","blocker":"gone"}]}"""

    @Test fun readsLeniently() {
        val d = data(sample)
        assertEquals(3, d.deals.size); assertEquals("w", d.workspaceId); assertEquals("2026-10-09", d.today)
        val a = d.deals[0]
        assertEquals("Rina", a.pmShown); assertEquals(500000000.0, a.value, 0.0); assertEquals("Execution", a.stageGroup)
        assertEquals(listOf("RECEIVABLE_OVERDUE", "BLOCKER", "SOMETHING_NEW"), a.reasons.map { it.code })
        assertEquals("commercial" to "done", a.phases[0]); assertEquals("https://x.test/spk", a.links[0].url); assertEquals("https://x.test/spk", a.links[0].id)
        // A number sent as text never breaks the deal; a typed name stands in for a non-user.
        val b = d.deals[1]
        assertEquals(0.0, b.contractValue, 0.0); assertEquals("Freelancer", b.bdShown); assertEquals("Pipeline", b.stageGroup)
        // The server's own option list wins (a new stage shows up without a release).
        assertTrue("Future stage" in d.vocab.stages); assertEquals(listOf("SPK", "Kontrak", "MOU", "Invoice", "Lainnya"), d.vocab.linkTypes)
        assertEquals(250000000.5, d.summary.n("weightedValue"), 0.0); assertEquals(1, d.summary.i("criticalCount"))
        // An empty response still draws.
        assertEquals(PipelineVocab.STAGES, data("{}").vocab.stages)
    }

    @Test fun optimisticEditKeepsTheRest() {
        val a = data(sample).deals[0]
        val e = a.with(JsonObject(mapOf("stage" to JsonPrimitive("Closing"))))
        assertEquals("Closing", e.stage); assertEquals("Gala", e.name)
    }

    @Test fun filtersAndAgenda() {
        val d = data(sample)
        assertEquals(listOf("a"), PipelineFilter.apply(d.deals, "acme", null, null, null).map { it.id })
        assertEquals(listOf("a"), PipelineFilter.apply(d.deals, "", "u1", null, null).map { it.id })
        assertEquals(listOf("b"), PipelineFilter.apply(d.deals, "", null, "Freelancer", null).map { it.id })
        assertEquals(listOf("a"), PipelineFilter.apply(d.deals, "", null, null, "CRITICAL").map { it.id })
        // Next 7 days only, Lost left out.
        assertEquals(listOf("a"), PipelineFilter.nextActions(d.deals, d.today).map { it.id })
        // Most urgent first, then the biggest.
        assertEquals(listOf("a", "b", "c"), d.deals.sortedWith(PipelineDeal.bySeverity).map { it.id })
    }

    @Test fun rupiah() {
        assertEquals("Rp950Jt", PipelineFormat.idr(950_000_000.0, id = true)); assertEquals("Rp950M", PipelineFormat.idr(950_000_000.0, id = false))
        assertEquals("Rp1,2M", PipelineFormat.idr(1_200_000_000.0, id = true)); assertEquals("Rp1.2B", PipelineFormat.idr(1_200_000_000.0, id = false))
        assertEquals("-Rp5Rb", PipelineFormat.idr(-5000.0, id = true)); assertEquals("Rp950.000.000", PipelineFormat.idrFull(950_000_000.0, id = true))
        assertEquals(950000000.0, PipelineFormat.parseMoney("Rp 950.000.000")!!, 0.0); assertEquals(-5000.0, PipelineFormat.parseMoney("-5,000")!!, 0.0)
        assertEquals(0.0, PipelineFormat.parseMoney(" ")!!, 0.0); assertNull(PipelineFormat.parseMoney("abc")); assertEquals("25%", PipelineFormat.pct(0.25))
    }

    @Test fun words() {
        val r = data(sample).deals[0].reasons
        assertEquals(PipelineText.Words.Plural(R.plurals.pl_r_overdue, 9), PipelineText.reason(r[0]))
        assertEquals(PipelineText.Words.Str(R.string.pl_r_blocker, "No PO"), PipelineText.reason(r[1]))
        assertEquals(PipelineText.Words.Raw("SOMETHING_NEW"), PipelineText.reason(r[2]))
        assertEquals(R.string.pl_stage_won_exec, PipelineText.stage("Won – In Execution")); assertNull(PipelineText.stage("Incoming"))
        assertEquals(R.string.pl_on_track, PipelineText.risk("Aman")); assertEquals(R.string.pl_link_contract, PipelineText.link("Kontrak"))
    }

    @Test fun pipelineProjectTabs() {
        val v = ProjectTabsLogic.visible(emptySet(), financeOn = true, pnlOn = false, isBoD = true, isPipeline = true)
        assertEquals(listOf(ProjectTab.PIPELINE, ProjectTab.CHAT, ProjectTab.FINANCE), v)
        assertEquals(ProjectTab.PIPELINE, ProjectTabsLogic.fallback(ProjectTab.BOARD, v))
        assertFalse(ProjectTab.PIPELINE in ProjectTabsLogic.visible(emptySet(), false, false, false))
    }

    @Test fun liveAndRestorable() {
        val e = RealtimeEvents.parse("pipeline-changed", """{"projectId":"p","dealId":"d","actorId":"u"}""")
        assertEquals("p", e.projectId); assertEquals("d", e.taskId)
        assertEquals(R.string.au_rb_deal, RestoreKinds.button("pipeline_deal")); assertEquals(R.string.au_note_deal, RestoreKinds.note("pipeline_deal", false))
    }
}
