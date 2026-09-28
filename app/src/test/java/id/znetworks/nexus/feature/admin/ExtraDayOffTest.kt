package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExtraDayOffTest {
    @Test fun submitNeedsPeriodPeopleDaysAndReason() {
        assertTrue(ExtraDayOffLogic.canSubmit("2026-09", 1, 1, "Event", false))
        assertFalse(ExtraDayOffLogic.canSubmit(null, 1, 1, "Event", false))
        assertFalse(ExtraDayOffLogic.canSubmit("2026-09", 0, 1, "Event", false))
        assertFalse(ExtraDayOffLogic.canSubmit("2026-09", 201, 1, "Event", false))
        assertFalse(ExtraDayOffLogic.canSubmit("2026-09", 1, 32, "Event", false))
        assertFalse(ExtraDayOffLogic.canSubmit("2026-09", 1, 1, "  ab  ", false)) // trimmed below 3
        assertFalse(ExtraDayOffLogic.canSubmit("2026-09", 1, 1, "Event", true))
    }

    @Test fun activeFirstAndRevokedFallback() {
        val l = NexusJson.decodeFromString(DayOffBonusList.serializer(), """{"periodKey":"2026-09","currentPeriodKey":"2026-09",
            "grants":[{"id":"a","days":2,"revokedAt":"2026-09-28T01:00:00Z"},{"id":"b","days":1,"active":true},{"id":"c","days":3}]}""")
        assertEquals(listOf("b", "c", "a"), ExtraDayOffLogic.ordered(l.grants).map { it.id })
        assertEquals(-1, ExtraDayOffLogic.tag("2026-08", l.currentPeriodKey)); assertEquals(0, ExtraDayOffLogic.tag("2026-09", "2026-09"))
        assertEquals(1, ExtraDayOffLogic.tag("2026-10", "2026-09")); assertNull(ExtraDayOffLogic.tag("2026-10", null))
    }

    @Test fun searchIsAzByNameOrEmail() {
        val m = listOf(WsMember("1", "u1", name = "zed"), WsMember("2", "u2", name = "Ana", email = "x@z.id"), WsMember("3", "u3", email = "bob@z.id"))
        assertEquals(listOf("Ana", "bob@z.id", "zed"), ExtraDayOffLogic.search(m, "").map { it.displayName })
        assertEquals(listOf("Ana"), ExtraDayOffLogic.search(m, " X@Z ").map { it.displayName })
    }
}
