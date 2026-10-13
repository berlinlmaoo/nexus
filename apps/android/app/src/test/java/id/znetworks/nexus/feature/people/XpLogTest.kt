package id.znetworks.nexus.feature.people

import org.junit.Assert.assertEquals
import org.junit.Test

class XpLogTest {
    @Test fun reasonsMapToRecordKindsAndZeroRowsDrop() {
        val log = XpLog(rows = listOf(
            XpLogRow("a", -30, "attendance:late", lateMinutes = 45), XpLogRow("b", 0, "attendance:waiver"),
            XpLogRow("c", 10, "peer:report:x:bounty"), XpLogRow("d", -5, "peer:report:y"),
            XpLogRow("e", 20, "admin:adjust:event bonus"), XpLogRow("f", 50, "quest:q1"), XpLogRow("g", 3, "task:done")))
        val e = XpLogLogic.entries(log)
        assertEquals(listOf("a", "c", "d", "e", "f", "g"), e.map { it.id })
        assertEquals(listOf("late", "peer_bounty", "peer_penalty", "admin_adjust", "quest", null), e.map { it.kind })
        assertEquals("event bonus", e[3].detail); assertEquals(45, e[0].lateMinutes); assertEquals("task:done", e[5].label)
    }
}
