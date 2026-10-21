package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PipelineDetailV8Test {
    @Test fun realtimeRefreshAdoptsCleanFieldsWithoutSendingTheOldValueBack() {
        val field = PipelineFieldDraft("0812").refresh("0899")
        assertEquals("0899", field.text)
        assertNull(field.pending())
    }

    @Test fun anEarlierSaveResponseKeepsTypingDoneAfterEnter() {
        val entered = PipelineFieldDraft("Budi").edit("Budi Santoso")
        assertEquals("Budi Santoso", entered.pending())
        val laterTyping = entered.edit("Budi Santoso, Finance")
        val responseToEarlierSave = laterTyping.refresh("Budi Santoso")
        assertEquals("Budi Santoso, Finance", responseToEarlierSave.text)
        assertEquals("Budi Santoso, Finance", responseToEarlierSave.pending())
        assertNull(responseToEarlierSave.refresh("Budi Santoso, Finance").pending())
    }

    @Test fun enterThenBlurNeverDropsAnUnacknowledgedField() {
        val field = PipelineFieldDraft("Client").edit("Broker")
        val enterPayload = field.pending()
        val blurPayload = field.pending()
        assertEquals("Broker", enterPayload)
        assertEquals(enterPayload, blurPayload)
        assertNull(field.refresh("Broker").pending())
    }

    @Test fun cashbackAndBudgetLifecycleSnapshotsMaskTheirWholeAmount() {
        val snapshot = NexusJson.parseToJsonElement("""{"name":"Venue","amount":987654321}""").jsonObject
        for (kind in listOf("cashback", "budget")) {
            for (lifecycle in listOf("created", "deleted", "restored")) {
                val change = PipelineChange("qa", "$kind.$lifecycle", snapshot, snapshot, null, null)
                val visibleSnapshot = (if (change.itemField == "deleted") change.before else change.after)?.jsonObject
                assertEquals(PipelinePresentation.MASK,
                    PipelinePresentation.itemHistoryAmount(change.itemKind!!, visibleSnapshot?.get("amount").num(), hidden = true))
                assertEquals("Rp 987.654.321",
                    PipelinePresentation.itemHistoryAmount(change.itemKind!!, visibleSnapshot?.get("amount").num(), hidden = false))
            }
        }
    }

    @Test fun contactsNeverRenderMoneyEvenIfTheirSnapshotContainsAnAmount() {
        for (hidden in listOf(false, true)) {
            assertNull(PipelinePresentation.itemHistoryAmount("contact", 987654321.0, hidden))
            assertNull(PipelinePresentation.itemHistoryAmount("contact", null, hidden))
        }
        assertEquals(PipelinePresentation.MASK, PipelinePresentation.itemHistoryAmount("cashback", -123456.0, hidden = true))
        assertEquals(PipelinePresentation.MASK, PipelinePresentation.itemHistoryAmount("budget", 0.0, hidden = true))
    }
}
