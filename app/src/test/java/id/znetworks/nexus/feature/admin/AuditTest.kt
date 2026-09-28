package id.znetworks.nexus.feature.admin

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class AuditTest {
    @Test fun kindsAndOfficeDayGroups() {
        assertEquals("create", AuditLogic.kind("CREATE_TASK")); assertEquals("login", AuditLogic.kind("logout")); assertEquals("other", AuditLogic.kind("approve"))
        val g = AuditLogic.byDay(listOf(AuditLog("a", createdAt = "2026-09-27T18:00:00Z"), AuditLog("b", createdAt = "2026-09-27T10:00:00Z")))
        assertEquals(listOf(LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 27)), g.map { it.first }) // 01:00 WIB on the 28th
    }
}
