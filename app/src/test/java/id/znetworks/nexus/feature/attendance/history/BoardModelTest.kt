package id.znetworks.nexus.feature.attendance.history

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.attendance.requests.PersonRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class BoardModelTest {
    private fun row(day: String, dayType: String? = null, checkIn: String? = null, status: String? = null, user: String = "u1", name: String = "A") =
        HistoryRow(id = "r$day$user", attendanceDate = "${day}T00:00:00.000Z", attendanceDayType = dayType, checkInAt = checkIn,
            status = status, user = PersonRef(id = user, name = name))

    @Test fun tonesFollowTheBodPalette() {
        assertEquals(AttTone.ABSENT, AttTone.of(row("2026-09-01", "ABSENT")))
        assertEquals(AttTone.SICK, AttTone.of(row("2026-09-01", "SICK_APPROVED")))
        assertEquals(AttTone.DAYOFF, AttTone.of(row("2026-09-01", "DAY_OFF_APPROVED")))
        assertEquals(AttTone.PERMIT, AttTone.of(row("2026-09-01", "PERMIT_APPROVED")))
        assertEquals(AttTone.PRESENT, AttTone.of(row("2026-09-01", "PRESENT", checkIn = "2026-09-01T02:00:00Z", status = "COMPLETED")))
        assertEquals(AttTone.NONE, AttTone.of(row("2026-09-06")))
    }

    @Test fun periodIs28thTo27th() {
        val d = BoardModel.days("2026-10")
        assertEquals(LocalDate.of(2026, 9, 28), d.first())
        assertEquals(LocalDate.of(2026, 10, 27), d.last())
        assertEquals(30, d.size)
        assertEquals("2026-09", BoardModel.periodKey(-1, LocalDate.of(2026, 9, 30)))
    }

    @Test fun periodFlipsAtMidnightWibOnThe28th() {
        // iOS 8838eec used the calendar month. 27 Sep 23:59 WIB is still "2026-09"; 28 Sep 00:00 WIB
        // (= 27 Sep 17:00 UTC, while it is still the 27th in UTC) is already "2026-10".
        val before = id.znetworks.nexus.core.time.OfficeTime.today(java.time.Instant.parse("2026-09-27T16:59:00Z"))
        val after = id.znetworks.nexus.core.time.OfficeTime.today(java.time.Instant.parse("2026-09-27T17:00:00Z"))
        assertEquals("2026-09", BoardModel.periodKey(0, before))
        assertEquals("2026-10", BoardModel.periodKey(0, after))
        assertEquals(LocalDate.of(2026, 9, 28), BoardModel.days(BoardModel.periodKey(0, after)).first())
        assertEquals("2026-09", BoardModel.periodKey(-1, after)) // previous period from the 28th
    }

    @Test fun membersAreAToZLikeIosAndTheWeb() {
        val m = BoardModel.members(listOf(row("2026-09-01", user = "u2", name = "Zed"), row("2026-09-02", user = "me", name = "Bagas"),
            row("2026-09-01", user = "u3", name = "ana")), viewerId = "me", selfName = "x")
        assertEquals(listOf("ana", "Bagas", "Zed"), m.map { it.name })
    }

    @Test fun rosterShowsEveryoneEvenWithoutRows() {
        // First day of a period: only Zed has checked in; the other two must still be on the board.
        val roster = listOf(PersonRef("u1", "Citra", dayOffQuota = 6), PersonRef("u2", "Zed"), PersonRef("u3", null, email = "ana@x.id"))
        val m = BoardModel.members(listOf(row("2026-09-28", user = "u2", name = "Zed")), viewerId = "u2", selfName = "x", roster = roster)
        assertEquals(listOf("ana@x.id", "Citra", "Zed"), m.map { it.name })
        assertEquals(6, m.first { it.id == "u1" }.quota)
        assertTrue(m.first { it.id == "u1" }.rows.isEmpty())
        assertEquals(1, m.first { it.id == "u2" }.rows.size)
    }

    @Test fun scoreCountsPresentPermitWfhAgainstTheEffectiveQuota() {
        val rows = (1..25).map { d -> row("2026-09-%02d".format(d), "PRESENT", checkIn = "2026-09-%02dT02:00:00Z".format(d)) } +
            row("2026-09-26", "PERMIT_APPROVED") + row("2026-09-27", "SICK_APPROVED")
        val withQuota = rows.map { it.copy(user = it.user?.copy(dayOffQuota = 9)) }
        val m = BoardModel.members(withQuota, viewerId = "u1", selfName = "x").single()
        assertEquals(9, m.quota)
        assertEquals(26, m.worked) // 25 present + 1 permit; sick is not worked
        // 31-day period, quota 9 → 22 working days: shown capped, surplus beside it.
        assertEquals(Score(22, 22, 4), BoardModel.score(m.worked, 31, m.quota))
        assertEquals("22/22", BoardModel.score(m.worked, 31, m.quota).text)
        // No quota from the server: 4.
        assertEquals(4, BoardModel.members(rows, "u1", "x").single().quota)
        assertEquals(Score(10, 27, 0), BoardModel.score(10, 31, 4))
    }

    @Test fun overrideResponseDecodes() {
        val r = NexusJson.decodeFromString(OverrideResponse.serializer(),
            """{"ok":true,"action":"PERMIT","date":"2026-09-26","refunded":true,"multiDayRequestsLeft":1,"new":"x"}""")
        assertTrue(r.ok); assertEquals(true, r.refunded); assertEquals(1, r.multiDayRequestsLeft)
        assertEquals("""{"userId":"u","date":"2026-09-26","action":"PERMIT"}""",
            NexusJson.encodeToString(OverrideBody.serializer(), OverrideBody("u", "2026-09-26", "PERMIT")).replace(",\"note\":null", ""))
    }

    @Test fun historyDecodesServerShape() {
        val rows = NexusJson.decodeFromString(HistoryResponse.serializer(),
            """{"scope":"me","records":[{"id":"a","attendanceDate":"2026-09-24T00:00:00.000Z","recordKind":"ATTENDANCE","checkInAt":"2026-09-24T02:00:00.000Z","officeLocation":{"id":"o","name":"HQ","latitude":-6.2,"longitude":106.8,"radiusMeters":150,"workdays":[1,2]}},
               {"recordKind":"ABSENT","attendanceDate":"2026-09-23T00:00:00.000Z","attendanceDayType":"ABSENT"}]}""").records
        assertTrue(rows[0].isRecord)
        assertFalse(rows[1].isRecord)
        assertEquals("2026-09-24", rows[0].dayKey)
    }

    // Audit T6: another period's rows are never drawn under this period's dates.
    @Test fun rowsShowOnlyUnderTheirOwnPeriod() {
        val rows = listOf(HistoryRow(id = "r"))
        assertEquals(rows, BoardModel.rowsFor("2026-09", "2026-09", rows))
        assertEquals(emptyList<HistoryRow>(), BoardModel.rowsFor("2026-08", "2026-09", rows))
        assertEquals(emptyList<HistoryRow>(), BoardModel.rowsFor("2026-09", null, rows))
    }

    // Audit S6: the member record's days open like iOS MemberProfileView.
    @Test fun memberRecordDaysOpenAsIos() {
        assertEquals(true, BoardModel.dayOpens(HistoryRow(id = "r"), canManage = false, future = false))
        assertEquals(false, BoardModel.dayOpens(HistoryRow(id = null), canManage = false, future = false))
        assertEquals(true, BoardModel.dayOpens(HistoryRow(id = null), canManage = true, future = false))
        assertEquals(false, BoardModel.dayOpens(null, canManage = false, future = false))
        assertEquals(true, BoardModel.dayOpens(null, canManage = true, future = false))
        assertEquals(false, BoardModel.dayOpens(HistoryRow(id = "r"), canManage = true, future = true))
    }

    // Audit R6: an unnamed roster entry never gets the viewer's name.
    @Test fun unnamedPeopleAreNotTheViewer() {
        val m = BoardModel.members(emptyList(), "me-id", "Viewer", listOf(PersonRef(id = "x"), PersonRef(id = "me-id")))
        assertEquals("—", m.first { it.id == "x" }.name)
        assertEquals("Viewer", m.first { it.id == "me-id" }.name)
    }
}
