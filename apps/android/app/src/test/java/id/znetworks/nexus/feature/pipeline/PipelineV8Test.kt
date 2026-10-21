package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

/** v8 compatibility, per-item data and lossless cost category edits. */
class PipelineV8Test {
    private fun json(s: String) = NexusJson.parseToJsonElement(s).jsonObject
    private fun deal(s: String) = PipelineDeal(json(s))

    @Test fun olderServersLeaveNewDataEmptyAndKeepPartialPatchesSmall() {
        val old = deal("""{"id":"d","name":"Gala","netValue":100000000,"mainDate":"2026-11-02","costs":[{"id":"c","amount":43000000}]}""")
        assertEquals(0.0, old.barterValue, 0.0)
        assertEquals("", old.barterCompensation)
        assertTrue(old.cashback.isEmpty()); assertTrue(old.contacts.isEmpty()); assertTrue(old.budgets.isEmpty())
        assertEquals(0.0, old.cashbackTotal, 0.0); assertEquals(0.0, old.budgetTotal, 0.0)
        assertNull(old.eventYear); assertNull(old.source); assertNull(old.costs.single().budgetId)
        val patch = json("""{"name":"New gala"}""")
        assertEquals(setOf("name"), patch.keys)
        val edited = old.with(patch)
        assertEquals("New gala", edited.name); assertEquals(old.costs, edited.costs)
    }

    @Test fun itemRowsAreOrderedAndBudgetDoesNotChangeProfit() {
        val d = deal("""{"id":"d","netValue":100000000,"barterValue":5000000,"barterCompensation":"2 TV ad slots","eventYear":2026,
            "source":{"projectId":"p","name":"Pipeline Suwara"},
            "costs":[{"id":"c","label":"Venue","amount":43000000,"budgetId":"b"}],
            "cashback":[{"id":"late","position":2048,"name":"Sari","amount":500000},{"id":"first","position":1024,"name":"Budi","amount":1500000}],
            "contacts":[{"id":"contact","role":"PM (client side)","name":"Rina","phone":"0813-3333"}],
            "budgets":[{"id":"b","name":"Venue","amount":25000000,"spent":31000000,"remaining":-6000000},{"id":"unused","position":2048,"name":"Talent","amount":15000000,"spent":10000000,"remaining":5000000}]}""")
        assertEquals(5000000.0, d.barterValue, 0.0); assertEquals("2 TV ad slots", d.barterCompensation)
        assertEquals(2026, d.eventYear); assertEquals("p", d.source?.projectId)
        assertEquals(listOf("first", "late"), d.cashback.map { it.id })
        assertEquals(2000000.0, d.cashbackTotal, 0.0); assertEquals(40000000.0, d.budgetTotal, 0.0)
        assertEquals("contact", d.contacts.single().kind); assertEquals("PM (client side)", d.contacts.single().role)
        assertEquals("0813-3333", d.contacts.single().phone)
        assertEquals(-6000000.0, d.budgets.first().remaining, 0.0)
        assertEquals(5000000.0, d.budgets.last().remaining, 0.0)
        assertEquals(43000000.0, d.costTotal, 0.0); assertEquals(57000000.0, d.margin!!, 0.0)
        // A snapshot total from the server takes precedence over a local fallback.
        assertEquals(9.0, d.with(json("""{"cashbackTotal":9}""")).cashbackTotal, 0.0)
    }

    @Test fun costCategoryCanBeClearedWithoutDroppingOtherCostFieldsOrMergeBase() {
        val before = PipelineCosts.of(NexusJson.parseToJsonElement("""[{"id":"c","label":"Venue","amount":31000000,"budgetId":"deleted-id","futureField":"keep"}]"""))
        val cleared = PipelineCosts.recategorize(before, "c", null)
        val patch = PipelineCosts.patch(cleared, before)
        val line = (patch["costs"] as JsonArray).single().jsonObject
        val base = (patch["costsBase"] as JsonArray).single().jsonObject
        assertEquals(JsonNull, line["budgetId"])
        assertEquals(JsonPrimitive("deleted-id"), base["budgetId"])
        assertEquals(JsonPrimitive("keep"), line["futureField"])
        assertTrue(PipelineCosts.valid(cleared))
        assertFalse(PipelineCosts.valid(listOf(PipelineCost("c", "", 0.0, "bad budget id"))))
        assertEquals(JsonNull, PipelineCost("new", "", 0.0).json()["budgetId"])
        val assigned = PipelineCosts.recategorize(cleared, "c", "new-budget")
        assertEquals("new-budget", assigned.single().budgetId)
        assertEquals("new-budget", PipelineCosts.relabel(assigned, "c", "Hall").single().budgetId)
    }

    @Test fun serverVocabAndCombinedBoardMetadataAreReadLeniently() {
        val data = PipelineData.of(json("""{"workspaceId":"w","boards":[{"id":"p","name":"Pipeline Suwara","dealCount":3}],
            "years":[2025,2027,2026],"year":2026,"source":"p","vocab":{"contactRoles":["Client","Future role"],"linkTypes":["Deck","Future document"]}}"""))
        assertEquals("w", data.workspaceId); assertEquals("p", data.source)
        assertEquals(listOf(2027,2026,2025), data.years); assertEquals(2026, data.year)
        assertEquals(3, data.boards.single().dealCount); assertEquals("ACTIVE", data.boards.single().status)
        assertEquals(listOf("Client", "Future role"), data.vocab.contactRoles)
        assertEquals(listOf("Deck", "Future document"), data.vocab.linkTypes)
        val old = PipelineData.of(JsonObject(emptyMap()))
        assertTrue(old.years.isEmpty()); assertTrue(old.boards.isEmpty()); assertNull(old.year); assertNull(old.source)
        assertEquals(listOf("Client","Vendor","Broker","PM (client side)","Finance","Admin","Other"), old.vocab.contactRoles)
    }

    @Test fun itemHistoryKindsAndWholeRupiahKeepTheirMeaning() {
        val row = PipelineChange("h", "budget.amount", JsonPrimitive(1), JsonPrimitive(2), null, null, "item", "Venue")
        assertEquals("budget", row.itemKind); assertEquals("amount", row.itemField); assertNull(row.termField)
        assertNull(row.copy(field = "netValue").itemKind)
        assertNull(row.copy(field = "document.added").itemKind)
        assertEquals("Rp 6.000.000", PipelineFormat.idrFull(6000000.0, id = false))
        assertEquals("Rp 6.000.000", PipelineFormat.idrFull(6000000.0, id = true))
        assertEquals("-Rp 6.000.000", PipelineFormat.idrFull(-6000000.0, id = false))
    }

    @Test fun presentationRecognizesV8MoneyWithoutMaskingContactDetails() {
        listOf("barterValue", "cashback.amount", "budget.amount", "cashbackTotal", "budgetTotal").forEach {
            assertTrue("$it must be masked", PipelinePresentation.isMoney(it))
        }
        listOf("contact.phone", "contact.role", "contact.name", "cashback.name", "budget.name", "barterCompensation", "eventYear").forEach {
            assertFalse("$it is not a monetary field", PipelinePresentation.isMoney(it))
        }
        assertEquals(PipelinePresentation.MASK, PipelinePresentation.amount(7000000.0, hidden = true, full = true))
    }
}
