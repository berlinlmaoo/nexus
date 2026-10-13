package id.znetworks.nexus.feature.tickets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** BoD ticket queues (web complaints.tsx, iOS 13 Oct): Inbox / In review / All, landing on the first non-empty. */
class TicketQueuesTest {
    private fun t(id: String, status: String, pending: Boolean = false) = Ticket(id, status = status, pendingCorrection = pending)

    @Test fun queues() {
        assertTrue(TicketRules.inQueue(t("a", "OPEN"), TicketRules.Queue.INBOX))
        // Answered by GIDEON = not the inbox any more: In review.
        assertFalse(TicketRules.inQueue(t("b", "AWAITING_DECISION"), TicketRules.Queue.INBOX))
        assertTrue(TicketRules.inQueue(t("b", "AWAITING_DECISION"), TicketRules.Queue.REVIEW))
        assertTrue(TicketRules.inQueue(t("c", "CLOSED"), TicketRules.Queue.ALL))
    }

    @Test fun closedTicketWithAFixWaitingStaysInReview() {
        // Dev server 14 Oct: two CLOSED tickets with a pending correction made the web say 10, Android 8.
        assertTrue(TicketRules.inQueue(t("d", "CLOSED", pending = true), TicketRules.Queue.REVIEW))
        assertTrue(TicketRules.inQueue(t("e", "RESOLVED", pending = true), TicketRules.Queue.REVIEW))
        assertFalse(TicketRules.inQueue(t("f", "CLOSED"), TicketRules.Queue.REVIEW))
        assertFalse(TicketRules.inQueue(t("g", "OPEN", pending = true), TicketRules.Queue.REVIEW))
    }

    @Test fun badgesUseTheServerCounts() {
        val counts = mapOf("RESOLVED" to 10, "AWAITING_DECISION" to 2, "IN_REVIEW" to 6, "CLOSED" to 19, "INBOX" to 0, "REVIEW" to 10)
        val list = listOf(t("a", "IN_REVIEW"))
        assertEquals(0, TicketRules.queueCount(counts, list, TicketRules.Queue.INBOX))
        assertEquals(10, TicketRules.queueCount(counts, list, TicketRules.Queue.REVIEW))
        assertEquals(37, TicketRules.queueCount(counts, list, TicketRules.Queue.ALL))
        // An older server without counts: counted from the list.
        assertEquals(1, TicketRules.queueCount(emptyMap(), list, TicketRules.Queue.REVIEW))
        assertEquals(1, TicketRules.queueCount(emptyMap(), list, TicketRules.Queue.ALL))
    }

    @Test fun landsOnTheFirstNonEmptyQueue() {
        assertEquals(TicketRules.Queue.INBOX, TicketRules.landing(listOf(t("a", "OPEN"), t("b", "IN_REVIEW"))))
        assertEquals(TicketRules.Queue.REVIEW, TicketRules.landing(listOf(t("b", "IN_REVIEW"), t("c", "RESOLVED"))))
        assertEquals(TicketRules.Queue.ALL, TicketRules.landing(listOf(t("c", "RESOLVED"))))
        assertEquals(TicketRules.Queue.ALL, TicketRules.landing(emptyList()))
    }

    @Test fun decisionsWaitingFloatUpStably() {
        assertEquals(listOf("c", "a", "b"), TicketRules.ordered(listOf(t("a", "OPEN"), t("b", "OPEN"), t("c", "OPEN", pending = true))).map { it.id })
    }

    @Test fun threadSaysWhyItCannotOpen() {
        val src = File("src/main/java/id/znetworks/nexus/feature/tickets/TicketDetailScreen.kt").readText()
        assertTrue(src.contains("missing = st == 404, notYours = st == 403"))
        assertTrue(src.contains("R.string.tq_gone") && src.contains("R.string.tq_not_yours") && src.contains("R.string.tq_back"))
    }
}
