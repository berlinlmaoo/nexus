package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class PipelinePresentationTest {
    @Test fun maskedAmountsNeverExposeMagnitudeSignOrLocale() {
        for (value in listOf(0.0, 123456789.0, -87654321.0, 1.5))
            for (full in listOf(false, true)) for (id in listOf(false, true))
                assertEquals("Rp ••••", PipelinePresentation.amount(value, true, full, id))
    }

    @Test fun ordinaryAmountsKeepExistingFormattingAndSourceValues() {
        val deal = PipelineDeal(NexusJson.parseToJsonElement("""{"id":"qa","contractValue":987654321,"netCash":-1234567}""").jsonObject)
        for (id in listOf(false, true)) {
            assertEquals(PipelineFormat.idr(deal.contractValue, id), PipelinePresentation.amount(deal.contractValue, false, id = id))
            assertEquals(PipelineFormat.idrFull(deal.netCash, id), PipelinePresentation.amount(deal.netCash, false, full = true, id = id))
            PipelinePresentation.amount(deal.netCash, true, id = id)
            assertEquals(-1234567.0, deal.netCash, 0.0)
        }
    }

    @Test fun historyMasksDealTermAndCostMoneyButKeepsNonMoneyProperties() {
        listOf("contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash", "costs", "amount", "paidAmount", "margin", "marginPct").forEach {
            assertTrue(it, PipelinePresentation.isMoney(it))
        }
        listOf("name", "probability", "stage", "maxDaysOverdue", "nextActionDate", "label", "note", "services").forEach {
            assertFalse(it, PipelinePresentation.isMoney(it))
        }
    }
}
