package id.znetworks.nexus.feature.widget

import id.znetworks.nexus.feature.attendance.AttendanceKind
import id.znetworks.nexus.feature.attendance.AttendanceRecord
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.LocationFix
import id.znetworks.nexus.feature.attendance.MyShift
import id.znetworks.nexus.feature.attendance.OfficeRef
import id.znetworks.nexus.feature.attendance.PendingAttendance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class PresenceTest {
    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test fun expectedOutFromShiftFlexiAndOvernight() {
        val start = ms("2026-09-28T01:05:00Z") // 08:05 WIB
        assertEquals(ms("2026-09-28T10:00:00Z"), PresenceLogic.expectedOut(start, MyShift("08:00", "17:00")))
        assertEquals(start + 9 * 3_600_000L, PresenceLogic.expectedOut(start, MyShift(flexi = true)))
        val night = ms("2026-09-28T14:00:00Z") // 21:00 WIB
        assertEquals(ms("2026-09-28T23:00:00Z"), PresenceLogic.expectedOut(night, MyShift("21:00", "06:00"))) // 06:00 WIB next day
        assertNull(PresenceLogic.expectedOut(null, MyShift("08:00", "17:00")))
    }

    @Test fun snapshotStates() {
        val t = "2026-09-28"
        val today = AttendanceToday(today = AttendanceRecord("r", checkInAt = "2026-09-28T01:05:00Z", officeLocation = OfficeRef(name = "HQ")), myShift = MyShift("08:00", "17:00"))
        val s = PresenceLogic.build(today, emptyList(), listOf(DayDot("2026-09-27", "P")), null, t)
        assertEquals(AttendanceSnapshot.State.Working(ms("2026-09-28T01:05:00Z")), s.state(t))
        assertEquals("HQ", s.place)
        // Yesterday's snapshot is never today's answer.
        assertEquals(AttendanceSnapshot.State.Stale, s.state("2026-09-29"))
        // A queued check-out counts as done; a queued check-in as working, with the count to send.
        val q = listOf(PendingAttendance("o", AttendanceKind.CHECK_OUT, deviceAtMillis = ms("2026-09-28T10:10:00Z"), uptimeSec = 1, fix = LocationFix(0.0, 0.0)))
        val done = PresenceLogic.build(today, q, emptyList(), "Studio", t)
        assertEquals(AttendanceSnapshot.State.Done(ms("2026-09-28T10:10:00Z")), done.state(t))
        assertEquals(1, done.pendingCount); assertEquals("Studio", done.place)
        val offline = PresenceLogic.build(AttendanceToday(), listOf(PendingAttendance("i", AttendanceKind.CHECK_IN, deviceAtMillis = 5, uptimeSec = 1, fix = LocationFix(0.0, 0.0))), emptyList(), null, t)
        assertEquals(AttendanceSnapshot.State.Working(5), offline.state(t))
        assertEquals(AttendanceSnapshot.State.NotCheckedIn, PresenceLogic.build(AttendanceToday(), emptyList(), emptyList(), null, t).state(t))
    }

    @Test fun lastSevenDotsInOrder() {
        val days = (1..9).map { CompactDay("2026-09-%02d".format(it), if (it % 2 == 0) "P" else "L") }.shuffled()
        assertEquals((3..9).map { "2026-09-%02d".format(it) }, PresenceLogic.dots(days).map { it.dateKey })
    }
}
