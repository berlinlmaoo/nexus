package id.znetworks.nexus.feature.attendance.requests

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

// Berlin 29 Sep (server + iOS 22c4ecb): annual leave as several dates, capped at the days left,
// one request per run of consecutive dates.
class LeaveMultiDateTest {
    private fun d(day: Int, m: Int = 10) = LocalDate.of(2026, m, day)

    @Test fun consecutiveDatesBecomeOneRun() {
        val runs = MultiDateLogic.blocks(setOf(d(7), d(1), d(2), d(3), d(31, 10), d(1, 11), d(5)))
        assertEquals(listOf(d(1) to d(3), d(5) to d(5), d(7) to d(7), d(31) to d(1, 11)), runs)
        assertEquals(emptyList<Pair<LocalDate, LocalDate>>(), MultiDateLogic.blocks(emptySet()))
    }

    @Test fun capAtTheDaysLeft() {
        var (set, capped) = MultiDateLogic.toggle(emptySet(), d(1), 2)
        assertFalse(capped)
        set = MultiDateLogic.toggle(set, d(2), 2).first
        val third = MultiDateLogic.toggle(set, d(3), 2)
        assertTrue(third.second); assertEquals(setOf(d(1), d(2)), third.first)   // N+1 refused
        val removed = MultiDateLogic.toggle(set, d(1), 2)
        assertFalse(removed.second); assertEquals(setOf(d(2)), removed.first)     // a picked day can always go
    }

    @Test fun monthGridStartsMonday() {
        val g = MultiDateLogic.grid(YearMonth.of(2026, 10)) // 1 Oct 2026 is a Thursday
        assertEquals(listOf(null, null, null), g[0].take(3)); assertEquals(d(1), g[0][3])
        assertTrue(g.all { it.size == 7 }); assertEquals(31, g.flatten().count { it != null })
    }

    @Test fun leaveNeedsAtLeastOneDate() {
        val today = id.znetworks.nexus.feature.attendance.AttendanceToday(
            annualLeave = id.znetworks.nexus.feature.attendance.AnnualLeave(eligible = true, remaining = 5, quota = 12))
        val r = RequestRules(today, false)
        assertEquals(RequestRules.Missing.DATES, r.missing("LEAVE", "liburan keluarga", false, false, d(1), leaveDays = 0))
        assertEquals(null, r.missing("LEAVE", "liburan keluarga", false, false, d(1), leaveDays = 3))
    }

    @Test fun silentRefusalIsFasterThanAPerson() {
        assertTrue(id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.refusedSilently(1_000, 1_150))
        assertFalse(id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.refusedSilently(1_000, 3_000))
        val a = id.znetworks.nexus.feature.attendance.trail.AlwaysLocation
        assertTrue(a.refusedForGood(fast = false, rationaleLeft = false))  // slow phone, "Don't ask again"
        assertFalse(a.refusedForGood(fast = false, rationaleLeft = true))  // a first "Deny": not yet Settings
    }
}
