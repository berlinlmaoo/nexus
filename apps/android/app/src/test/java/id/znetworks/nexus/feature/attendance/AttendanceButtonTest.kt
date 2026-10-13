package id.znetworks.nexus.feature.attendance

import org.junit.Assert.assertEquals
import org.junit.Test

class AttendanceButtonTest {
    private fun mode(inn: Boolean = false, out: Boolean = false, force: Boolean = false, offsite: Boolean = false, count: Int = 0) =
        AttendanceButtonLogic.mode(inn, out, force, offsite, count, 200, "2026-09-28T02:00:00Z", if (out) "2026-09-28T10:45:00Z" else null)

    @Test fun readyIsCheckIn() = assertEquals(ButtonMode.CheckIn, mode())

    @Test fun approvedRequestCoveringTodayHidesCheckIn() {
        fun m(r: TodayRequest?, inn: Boolean = false, out: Boolean = false, force: Boolean = false) =
            AttendanceButtonLogic.mode(inn, out, force, false, 0, 200, null, null, coveredBy = r)
        assertEquals(ButtonMode.CoveredByRequest("SICK"), m(TodayRequest("r", "SICK", "APPROVED")))
        assertEquals(ButtonMode.CoveredByRequest("LEAVE"), m(TodayRequest("r", "LEAVE", null)))
        assertEquals(ButtonMode.CheckIn, m(TodayRequest("r", "PERMIT", "PENDING")))
        // A forgotten check-out or a day already started still needs its check-out.
        assertEquals(ButtonMode.CheckOut(0, 200, unlocked = false, waiting = false), m(TodayRequest("r", "PERMIT", "APPROVED"), force = true))
        assertEquals(ButtonMode.CheckOut(0, 200, unlocked = false, waiting = false), m(TodayRequest("r", "PERMIT", "APPROVED"), inn = true))
    }

    @Test fun checkedInIsCheckOutLockedUntil200Characters() {
        assertEquals(ButtonMode.CheckOut(120, 200, unlocked = false, waiting = false), mode(inn = true, count = 120))
        assertEquals(ButtonMode.CheckOut(200, 200, unlocked = true, waiting = false), mode(inn = true, count = 200))
    }

    @Test fun forgottenCheckOutComesFirst() {
        // An earlier day still open: check-out, even though today shows nothing yet.
        assertEquals(ButtonMode.CheckOut(0, 200, unlocked = false, waiting = false), mode(force = true))
    }

    @Test fun doneShowsWorkedTime() = assertEquals(ButtonMode.DoneForToday(525), mode(inn = true, out = true))

    @Test fun offsiteWaitingStaysOnALockedCheckOut() {
        assertEquals(ButtonMode.CheckOut(250, 200, unlocked = true, waiting = true), mode(inn = true, out = true, offsite = true, count = 250))
    }

    // Audit R2: the server's worked minutes first; a queued check-out says so.
    @Test fun doneUsesServerMinutesAndSaysWhenOnlyOnThePhone() {
        fun m(worked: Int?, queued: Boolean) = AttendanceButtonLogic.mode(true, true, false, false, 200, 200,
            "2026-09-28T02:00:00Z", "2026-09-28T10:45:00Z", workedMinutes = worked, checkOutQueued = queued)
        assertEquals(ButtonMode.DoneForToday(480), m(480, false))
        assertEquals(ButtonMode.DoneForToday(525), m(null, false))
        assertEquals(ButtonMode.DoneForToday(null, savedOnPhone = true), m(480, true))
    }
}
