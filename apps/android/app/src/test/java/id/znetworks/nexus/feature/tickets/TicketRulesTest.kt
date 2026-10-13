package id.znetworks.nexus.feature.tickets

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TicketRulesTest {
    private fun t(status: String, category: String = "ATTENDANCE") = Ticket("x", category = category, status = status)

    @Test fun inReviewFilterHoldsAwaitingDecision() {
        assertTrue(TicketRules.inFilter(t("AWAITING_DECISION"), "IN_REVIEW"))
        assertFalse(TicketRules.inFilter(t("OPEN"), "IN_REVIEW"))
        assertTrue(TicketRules.inFilter(t("CLOSED"), "ALL"))
    }

    @Test fun correctionsOnlyOnAttendanceAndXp() {
        assertTrue(TicketRules.canPropose(t("OPEN", "EXP")))
        assertFalse(TicketRules.canPropose(t("OPEN", "DAY_OFF")))
    }

    @Test fun decodesListAndDetailLeniently() {
        val l = NexusJson.decodeFromString(TicketList.serializer(), """{"complaints":[{"id":"a","category":"ATTENDANCE","subject":"Telat","status":"OPEN",
            "reporter":null,"attachments":[{"id":"1","url":"/api/files/x.jpg","mimeType":"image/jpeg","size":3}],"isMine":true}],"counts":{"OPEN":1,"INBOX":1},"viewerIsBod":false}""")
        assertEquals(listOf("/api/files/x.jpg"), l.complaints.single().photos)
        val c = NexusJson.decodeFromString(Corrections.serializer(), """{"corrections":[{"id":"c","status":"PENDING","kind":"PENALTY_CANCELLATION","date":"2026-09-20",
            "before":{"recordId":null,"checkInAt":null},"beforePenaltyXp":150}],"canDecide":true}""")
        assertEquals(150, c.corrections.single().beforePenaltyXp)
        assertEquals("08:05", TicketRules.hhmm("2026-09-20T01:05:00Z"))
    }
}
