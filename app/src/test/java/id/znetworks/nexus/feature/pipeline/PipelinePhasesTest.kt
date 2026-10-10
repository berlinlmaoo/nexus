package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** PIPELINE-DASHBOARD §14 (Berlin, 9 Oct late night): blocker on its phase, the GM's phase lines. */
class PipelinePhasesTest {
    private fun deal(json: String) = PipelineDeal(NexusJson.parseToJsonElement(json).jsonObject)
    private val six = """[{"key":"commercial","state":"done"},{"key":"contract","state":"done"},{"key":"readiness","state":"active"},
        {"key":"deliverable","state":"pending"},{"key":"payment","state":"pending"},{"key":"closing","state":"pending"}]"""

    /** 10 Oct (server 3eb63d6): the server's flag decides, whatever the blocker's words say. */
    @Test fun serverFlagBeatsWords() {
        val d = deal("""{"id":"w","blocker":"Invoice belum dibayar, somasi","phases":[{"key":"commercial","state":"done"},{"key":"contract","state":"bad","blocked":true},{"key":"payment","state":"pending"}]}""")
        assertEquals("contract", d.progressPhases.single { it.blocked }.key)
        // Older server, same words: the current phase, never the "payment" the words suggest.
        val old = deal("""{"id":"o","blocker":"Invoice belum dibayar","phases":[{"key":"commercial","state":"done"},{"key":"contract","state":"active"},{"key":"payment","state":"pending"}]}""")
        assertEquals("contract", old.progressPhases.single { it.blocked }.key)
    }

    @Test fun blockerPhase() {
        // The server marks it: read as sent.
        val marked = deal("""{"id":"a","blocker":"MASIH DITAGIH - PROSES SOMASI","phases":[{"key":"commercial","state":"done"},{"key":"payment","state":"bad","blocked":true}]}""")
        assertEquals(listOf(false, true), marked.progressPhases.map { it.blocked })
        // An older server: the blocker goes on the active phase, which turns bad.
        val old = deal("""{"id":"b","blocker":"Nunggu vendor","phases":$six}""")
        assertEquals("readiness", old.progressPhases.single { it.blocked }.key); assertEquals("bad", old.progressPhases[2].state)
        // No blocker: nothing marked; a blank blocker is none.
        assertEquals(0, deal("""{"id":"c","blocker":"  ","phases":$six}""").progressPhases.count { it.blocked })
        // All done → the last phase.
        val done = deal("""{"id":"d","blocker":"x","phases":[{"key":"commercial","state":"done"},{"key":"closing","state":"done"}]}""")
        assertEquals("closing", done.progressPhases.single { it.blocked }.key)
    }

    @Test fun phaseLines() {
        fun w(json: String, key: String) = PipelineText.phaseDetail(deal(json), key)
        assertEquals(PipelineText.Words.Str(R.string.pl_d_won), w("""{"id":"a","stage":"Won – In Execution"}""", "commercial"))
        assertEquals(PipelineText.Words.Str(R.string.pl_stage_negotiation), w("""{"id":"a","stage":"Negotiation"}""", "commercial"))
        assertEquals(PipelineText.Words.Raw("Incoming"), w("""{"id":"a","stage":"Incoming"}""", "commercial"))
        assertEquals(PipelineText.Words.Raw("Legal Drafting"), w("""{"id":"a","contractStatus":"Legal Drafting"}""", "contract"))
        assertEquals(PipelineText.Words.Str(R.string.pl_not_started), w("""{"id":"a"}""", "contract"))
        assertEquals(PipelineText.Words.Str(R.string.pl_d_not_relevant), w("""{"id":"a","readiness":"N/A"}""", "readiness"))
        assertEquals(PipelineText.Words.Str(R.string.pl_r_at_risk), w("""{"id":"a","deliverableStatus":"In Progress","deliverableRisk":"At Risk"}""", "deliverable"))
        // Never "Overdue 0 days"; terms' status wins over the typed one.
        assertEquals(PipelineText.Words.Plural(R.plurals.pl_d_overdue_days, 12), w("""{"id":"a","paymentStatus":"Overdue","daysOverdue":12}""", "payment"))
        assertEquals(PipelineText.Words.Str(R.string.pl_d_payment_overdue), w("""{"id":"a","paymentStatus":"Overdue","daysOverdue":0}""", "payment"))
        assertEquals(PipelineText.Words.Str(R.string.pl_d_fully_paid), w("""{"id":"a","paymentStatus":"Not Yet","termSummary":{"paymentStatus":"Paid"}}""", "payment"))
        assertEquals(PipelineText.Words.Str(R.string.pl_d_not_billed), w("""{"id":"a"}""", "payment"))
        assertEquals(PipelineText.Words.Raw("Waiting BAST"), w("""{"id":"a","closingStatus":"Waiting BAST"}""", "closing"))
    }
}
