package id.znetworks.nexus.feature.tickets

import org.junit.Assert.*
import org.junit.Test

class TicketBoardRulesTest {
    @Test fun closedAndResolvedShareDoneWithoutReopeningOnSameLaneDrop() {
        for (status in listOf("CLOSED", "RESOLVED")) {
            val ticket = Ticket("a", status = status, canManage = true)
            assertEquals("DONE", TicketBoardRules.column(status))
            assertNull(TicketBoardRules.destination(ticket, "DONE", true))
            assertEquals("OPEN", TicketBoardRules.destination(ticket, "OPEN", true))
        }
    }
    @Test fun onlyReviewerWithServerPermissionMayMove() {
        val ticket = Ticket("a", canManage = true)
        assertNull(TicketBoardRules.destination(ticket, "IN_REVIEW", false))
        assertNull(TicketBoardRules.destination(ticket.copy(canManage = false), "IN_REVIEW", true))
        assertEquals("IN_REVIEW", TicketBoardRules.destination(ticket, "IN_REVIEW", true))
        assertEquals("RESOLVED", TicketBoardRules.destination(ticket, "DONE", true))
    }
    @Test fun awaitingDecisionIsSystemOnlyButCanBeTakenOut() {
        val ticket = Ticket("a", canManage = true)
        assertNull(TicketBoardRules.destination(ticket, "AWAITING_DECISION", true))
        assertNull(TicketBoardRules.destination(ticket, "unknown", true))
        assertEquals("IN_REVIEW", TicketBoardRules.destination(ticket.copy(status = "AWAITING_DECISION"), "IN_REVIEW", true))
    }
    @Test fun staffSeesOwnTicketsOnly() {
        val ticket = Ticket("a", reporter = TPerson("reporter"))
        assertFalse(TicketBoardRules.visible(ticket, false, "other"))
        assertFalse(TicketBoardRules.visible(ticket, false, null))
        assertTrue(TicketBoardRules.visible(ticket, false, "reporter"))
        assertTrue(TicketBoardRules.visible(ticket.copy(isMine = true), false, null))
        assertTrue(TicketBoardRules.visible(ticket, true, "other"))
    }
}
