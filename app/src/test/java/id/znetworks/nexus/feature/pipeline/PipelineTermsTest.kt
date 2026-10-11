package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.admin.RestoreKinds
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PIPELINE-DASHBOARD §11 (Berlin, 9 Oct evening): members-only board, payments per term. */
class PipelineTermsTest {
    private fun deal(json: String) = PipelineDeal(NexusJson.parseToJsonElement(json).jsonObject)

    private val withTerms = deal("""{"id":"a","invoiceValue":100000000,"contractValue":120000000,"outstandingReceivable":999,"paymentStatus":"Not Yet",
        "paymentDueDate":"2026-12-01","daysOverdue":4,
        "terms":[
          {"id":"t2","position":2,"label":"Pelunasan","amount":60000000,"dueDate":"2026-11-01","paidAmount":0,"status":"Not Invoiced","outstanding":60000000,"daysOverdue":0},
          {"id":"t1","position":1,"label":"DP","amount":30000000,"dueDate":"2026-10-05T00:00:00.000Z","invoiceNo":"INV-1","paidAmount":10000000,"status":"Overdue","outstanding":20000000,"daysOverdue":4},
          {"label":"no id"}],
        "termSummary":{"count":2,"paidCount":0,"totalAmount":90000000,"totalPaid":10000000,"outstanding":80000000,"overdueOutstanding":20000000,
          "maxDaysOverdue":4,"paymentStatus":"Overdue","nextDueDate":"2026-10-05"}}""")

    @Test fun termsReplaceTheManualFields() {
        val t = withTerms.terms
        assertEquals(listOf("t1", "t2"), t.map { it.id }) // ordered by position; a term without id is dropped
        assertEquals("2026-10-05", t[0].dueDate); assertEquals("INV-1", t[0].invoiceNo); assertEquals(4, t[0].daysOverdue); assertFalse(t[0].isPaid)
        assertEquals(80000000.0, withTerms.receivable, 0.0); assertEquals("Overdue", withTerms.paymentStatusShown); assertEquals("2026-10-05", withTerms.paymentDueShown)
        // Σ terms 90 Jt vs the invoice value 100 Jt: warn, and "Add term" starts at what is left.
        assertTrue(PipelineTerms.mismatch(withTerms)); assertEquals(10000000.0, PipelineTerms.suggestedAmount(withTerms), 0.0)
    }

    @Test fun olderServerAndNoTerms() {
        val d = deal("""{"id":"b","contractValue":50000000,"outstandingReceivable":7000000,"paymentStatus":"Partial","paymentDueDate":"2026-10-20"}""")
        assertTrue(d.terms.isEmpty()); assertNull(d.termSummary)
        assertEquals(7000000.0, d.receivable, 0.0); assertEquals("Partial", d.paymentStatusShown); assertEquals("2026-10-20", d.paymentDueShown)
        assertFalse(PipelineTerms.mismatch(d)); assertEquals(50000000.0, PipelineTerms.suggestedAmount(d), 0.0) // contract value when no invoice value
        // A term missing its derived fields still reads (outstanding = amount − paid; status defaults).
        val t = PipelineTerm(NexusJson.parseToJsonElement("""{"id":"x","amount":"5000","paidAmount":2000}""").jsonObject)
        assertEquals(3000.0, t.outstanding, 0.0); assertEquals("Not Invoiced", t.status)
    }

    @Test fun wordsAndHistory() {
        assertEquals(R.string.pl_t_partial, PipelineText.termStatus("Partial")); assertNull(PipelineText.termStatus("Future"))
        assertEquals(R.string.pl_t_paid_at, PipelineText.termField("paidAt"))
        assertEquals("amount", PipelineChange("1", "term.amount", null, null, null, null, "t1", "DP").termField)
        assertNull(PipelineChange("2", "stage", null, null, null, null).termField)
        assertEquals(R.string.au_rb_term, RestoreKinds.button("pipeline_term")); assertEquals(R.string.au_note_term, RestoreKinds.note("pipeline_term", false))
    }

    @Test fun membersOnlyAccess() {
        val projects = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
        // No PIPELINE_FORBIDDEN (and since §16 no PIPELINE_EXISTS either).
        assertFalse(projects.contains("PIPELINE_FORBIDDEN"))
        val api = File("src/main/java/id/znetworks/nexus/feature/pipeline/PipelineApi.kt").readText()
        assertTrue(api.contains("\"/api/projects/\${enc(projectId)}/members\""))
        // The "BoD, Agency, IT, Legal, Finance" copy is gone in both languages.
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            assertFalse(s.contains("pl_no_access")); assertFalse(s.contains("Agency, IT"))
        }
    }
}
