package id.znetworks.nexus.feature.agenda

import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

/** Room booking composer like the web (room-booking.tsx, QA S-13). */
class BookingLogicTest {
    private val day = LocalDate.of(2026, 10, 14)

    @Test fun firstSlotFollowsTheClock() {
        assertEquals("09:00" to "10:00", BookingLogic.defaultSlot(day, Instant.parse("2026-10-14T01:00:00Z")))   // 08:00 WIB
        assertEquals("13:15" to "14:15", BookingLogic.defaultSlot(day, Instant.parse("2026-10-14T06:07:00Z")))   // 13:07 WIB
        assertEquals("09:00" to "10:00", BookingLogic.defaultSlot(day.plusDays(1), Instant.parse("2026-10-14T06:07:00Z")))
        assertEquals("09:00" to "10:00", BookingLogic.defaultSlot(day, Instant.parse("2026-10-14T16:50:00Z")))   // 23:50 WIB
    }

    @Test fun endFollowsTheStart() {
        assertEquals("15:00", BookingLogic.endAfter("14:00", "11:00"))
        assertEquals("16:00", BookingLogic.endAfter("14:00", "16:00"))
        assertEquals("23:45", BookingLogic.endAfter("23:30", "10:00"))
    }

    @Test fun timesAreWib() = assertEquals(Instant.parse("2026-10-14T07:30:00Z"), BookingLogic.instant(day, "14:30"))

    @Test fun whatStopsSave() {
        val now = Instant.parse("2026-10-14T06:00:00Z") // 13:00 WIB
        assertEquals(BookingLogic.Problem.END_BEFORE_START, BookingLogic.problem("x", day, "14:00", "14:00", true, now))
        assertEquals(BookingLogic.Problem.IN_PAST, BookingLogic.problem("x", day, "11:00", "12:00", true, now))
        // A meeting already under way can still be booked; an old booking whose times weren't touched can be edited.
        assertNull(BookingLogic.problem("x", day, "12:00", "14:00", true, now))
        assertNull(BookingLogic.problem("x", day, "11:00", "12:00", false, now))
        assertEquals(BookingLogic.Problem.NO_TITLE, BookingLogic.problem("  ", day, "14:00", "15:00", true, now))
    }

    @Test fun refusals() {
        val body = NexusJson.parseToJsonElement("""{"error":"Ruangan sudah dibooking","conflict":{"title":"Weekly sync"}}""").jsonObject
        assertEquals(BookingLogic.Refusal.TAKEN to "Weekly sync", BookingLogic.refusal(ApiError.Http(409, "x", null, body)))
        assertEquals(BookingLogic.Refusal.IN_PAST to null, BookingLogic.refusal(ApiError.Http(400, "x", "BOOKING_IN_PAST", null)))
        assertEquals(BookingLogic.Refusal.NOT_YOURS to null, BookingLogic.refusal(ApiError.Http(403, "x", null, null)))
        assertEquals(BookingLogic.Refusal.BAD_TIMES to null, BookingLogic.refusal(ApiError.Http(400, "x", null, null)))
    }

    @Test fun monthInWibAndWhoMayEdit() {
        val (from, to) = AgendaLogic.monthRange(java.time.YearMonth.of(2026, 10))
        assertEquals(Instant.parse("2026-09-30T17:00:00Z"), from)
        assertEquals(Instant.parse("2026-10-31T16:59:59Z"), to)
        val mine = Booking("b1", createdBy = Booker("me", "Budi"))
        assertEquals(true, AgendaLogic.canEdit(mine, "me", false))
        assertEquals(false, AgendaLogic.canEdit(mine, "other", false))
        assertEquals(true, AgendaLogic.canEdit(mine, "other", true))
    }
}
