package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PIPELINE-DASHBOARD §12 (Berlin, 9 Oct night): no nav entry, cards show only what is known. */
class PipelineLayoutTest {
    private fun deal(json: String) = PipelineDeal(NexusJson.parseToJsonElement(json).jsonObject)

    @Test fun cardShowsOnlyWhatIsKnown() {
        val critical = deal("""{"id":"a","stage":"Won – In Execution","health":{"key":"CRITICAL","reasons":[{"code":"BLOCKER","text":"x"},{"code":"NEGATIVE_CASH"},{"code":"VREG_PENDING"}]},"nextActionDate":"2026-10-08"}""")
        assertEquals("BLOCKER" to 2, PipelineCard.firstReason(critical)!!.let { it.first.code to it.second })
        assertTrue(PipelineCard.showPhases(critical)); assertTrue(PipelineCard.needsPm(critical))
        assertEquals(PipelineCard.Tone.PAST, PipelineCard.dateTone(PipelineCard.nextDate(critical)!!, "2026-10-09"))
        val fresh = deal("""{"id":"b","stage":"Incoming","health":{"key":"NOT_STARTED","reasons":[{"code":"X"}]},"nextActionDate":"2026-10-09"}""")
        assertNull(PipelineCard.firstReason(fresh)); assertFalse(PipelineCard.showPhases(fresh)); assertFalse(PipelineCard.needsPm(fresh))
        assertFalse("NOT_STARTED" in PipelineCard.DOTTED)
        assertEquals(PipelineCard.Tone.TODAY, PipelineCard.dateTone("2026-10-09", "2026-10-09"))
        assertNull(PipelineCard.nextDate(deal("""{"id":"c","stage":"Closed","nextActionDate":"2026-10-01"}""")))
        assertFalse(PipelineCard.needsPm(deal("""{"id":"d","stage":"Closed"}""")))
        assertEquals("4 Okt", PipelineCard.shortDay("2026-10-04", id = true)); assertEquals("4 Oct", PipelineCard.shortDay("2026-10-04", id = false))
    }

    @Test fun noNavEntryAndFold() {
        val shell = File("src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()
        assertFalse(shell.contains("pipelineProjectId")); assertFalse(shell.contains("R.string.pl_tab"))
        val sheet = File("src/main/java/id/znetworks/nexus/feature/pipeline/PipelineDealSheet.kt").readText()
        assertTrue(sheet.contains("if (deal.isWon) PhaseTrack")); assertTrue(sheet.contains("if (deal.isWon || laterOpen) {"))
    }
}
