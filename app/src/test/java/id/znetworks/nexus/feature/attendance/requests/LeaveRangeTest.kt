package id.znetworks.nexus.feature.attendance.requests

import id.znetworks.nexus.feature.attendance.AnnualLeave
import id.znetworks.nexus.feature.attendance.AttendanceToday
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

// Berlin 29 Sep (server LIVE, iOS ed7545e): annual leave is ONE range, capped at the days left, one request.
class LeaveRangeTest {
    private fun d(day: Int, m: Int = 10) = LocalDate.of(2026, m, day)

    @Test fun lengthCountsBothEnds() {
        assertEquals(1, LeaveRange.days(d(1), d(1)))
        assertEquals(6, LeaveRange.days(d(29, 9), d(4)))   // 29 Sep – 4 Oct
    }

    @Test fun longerThanTheDaysLeftIsRefused() {
        assertNull(LeaveRange.tooLong(d(1), d(5), 5))
        assertEquals(6, LeaveRange.tooLong(d(1), d(6), 5))   // "That's 6 days — only 5 left."
        assertNull(LeaveRange.tooLong(d(1), d(30), null))    // unknown quota: the server decides
    }

    @Test fun leaveNeedsARangeFromToday() {
        val r = RequestRules(AttendanceToday(annualLeave = AnnualLeave(eligible = true, remaining = 5, quota = 12)), false)
        val today = id.znetworks.nexus.core.time.OfficeTime.today()
        assertEquals(RequestRules.Missing.DATES, r.missing("LEAVE", "liburan keluarga", false, false, today, leaveDays = 0))
        assertNull(r.missing("LEAVE", "liburan keluarga", false, false, today, leaveDays = 3))
        assertEquals(RequestRules.Missing.DATE, r.missing("LEAVE", "liburan keluarga", false, false, today.minusDays(1), leaveDays = 3))
    }

    @Test fun composerStateReadsTheRange() {
        val cs = ComposerState(type = "LEAVE", leaveStart = d(29, 9), leaveEnd = d(4))
        assertEquals(6, cs.leaveDays); assertEquals(d(29, 9), cs.dayFor())
        assertEquals(0, ComposerState(type = "LEAVE").leaveDays)
        assertFalse(ComposerState(type = "SICK").dayFor() != ComposerState(type = "SICK").date)
        assertTrue(ComposerState(type = "SICK", leaveStart = d(1)).dayFor() == ComposerState(type = "SICK").date)
    }

    @Test fun silentRefusalIsFasterThanAPerson() {
        val a = id.znetworks.nexus.feature.attendance.trail.AlwaysLocation
        assertTrue(a.refusedSilently(1_000, 1_150)); assertFalse(a.refusedSilently(1_000, 3_000))
        assertTrue(a.refusedForGood(fast = false, rationaleLeft = false)); assertFalse(a.refusedForGood(fast = false, rationaleLeft = true))
    }
}
