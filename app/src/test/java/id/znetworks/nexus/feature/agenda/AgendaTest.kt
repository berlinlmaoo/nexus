package id.znetworks.nexus.feature.agenda

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class AgendaTest {
    @Test fun bookingsGroupByOfficeDay() {
        val b = listOf(Booking("1", startsAt = "2026-09-28T17:30:00Z", endsAt = "2026-09-28T18:00:00Z"), // 00:30 WIB on the 29th
            Booking("2", startsAt = "2026-09-28T02:00:00Z", endsAt = "2026-09-28T03:00:00Z"))
        val up = AgendaLogic.byDay(b, past = false)
        assertEquals(listOf(LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 29)), up.map { it.first })
        assertEquals(LocalDate.of(2026, 9, 29), AgendaLogic.byDay(b, past = true).first().first)
        assertEquals("09:00", AgendaLogic.hhmm("2026-09-28T02:00:00Z"))
    }

    @Test fun teamsMergeWithoutDuplicates() {
        val m = AgendaLogic.merge(listOf(listOf(CalEvent("a", startsAt = "2026-09-02T00:00:00Z"), CalEvent("b", startsAt = "2026-09-01T00:00:00Z")), listOf(CalEvent("a", startsAt = "2026-09-02T00:00:00Z"))))
        assertEquals(listOf("b", "a"), m.map { it.id })
    }
}
