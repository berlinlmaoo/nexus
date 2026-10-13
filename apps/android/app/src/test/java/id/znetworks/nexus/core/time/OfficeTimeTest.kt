package id.znetworks.nexus.core.time

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class OfficeTimeTest {
    @Test fun periodRollsOverOnThe28th() {
        assertEquals("2026-09", OfficeTime.periodKey(LocalDate.of(2026, 9, 27)))
        assertEquals("2026-10", OfficeTime.periodKey(LocalDate.of(2026, 9, 28)))
        assertEquals("2026-10", OfficeTime.periodKey(LocalDate.of(2026, 9, 30)))
        assertEquals("2027-01", OfficeTime.periodKey(LocalDate.of(2026, 12, 31)))
    }

    @Test fun periodRangeIs28thTo27th() {
        val r = OfficeTime.periodRange("2026-10")
        assertEquals(LocalDate.of(2026, 9, 28), r.start)
        assertEquals(LocalDate.of(2026, 10, 27), r.endInclusive)
        val jan = OfficeTime.periodRange("2027-01")
        assertEquals(LocalDate.of(2026, 12, 28), jan.start)
    }

    @Test fun todayIsJakartaNotDeviceZone() {
        // 2026-09-24T18:30Z is already 25 Sep 01:30 in Jakarta.
        assertEquals(LocalDate.of(2026, 9, 25), OfficeTime.today(Instant.parse("2026-09-24T18:30:00Z")))
    }
}
