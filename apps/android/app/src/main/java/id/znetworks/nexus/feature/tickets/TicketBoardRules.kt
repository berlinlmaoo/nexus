package id.znetworks.nexus.feature.tickets

object TicketBoardRules {
    val columns = listOf("OPEN", "AWAITING_DECISION", "IN_REVIEW", "DONE")
    fun column(status: String) = if (status == "RESOLVED" || status == "CLOSED") "DONE" else status
    fun visible(ticket: Ticket, reviewer: Boolean, meId: String?) = reviewer || ticket.isMine || (meId != null && ticket.reporter?.id == meId)
    fun destination(ticket: Ticket, column: String, reviewer: Boolean): String? {
        if (!reviewer || !ticket.canManage || column(ticket.status) == column) return null
        // AWAITING_DECISION is set only by the server's attendance decision workflow.
        return when (column) { "OPEN", "IN_REVIEW" -> column; "DONE" -> "RESOLVED"; else -> null }
    }
}
