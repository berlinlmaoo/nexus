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

    @Test fun membersGroupedViewerFirst() {
        val m = BoardModel.members(listOf(row("2026-09-01", user = "u2", name = "Zed"), row("2026-09-02", user = "me", name = "Bagas"),
            row("2026-09-01", user = "u3", name = "Ana")), viewerId = "me", selfName = "x")
        assertEquals(listOf("Bagas", "Ana", "Zed"), m.map { it.name })
    }

    @Test fun historyDecodesServerShape() {
        val rows = NexusJson.decodeFromString(HistoryResponse.serializer(),
            """{"scope":"me","records":[{"id":"a","attendanceDate":"2026-09-24T00:00:00.000Z","recordKind":"ATTENDANCE","checkInAt":"2026-09-24T02:00:00.000Z","officeLocation":{"id":"o","name":"HQ","latitude":-6.2,"longitude":106.8,"radiusMeters":150,"workdays":[1,2]}},
               {"recordKind":"ABSENT","attendanceDate":"2026-09-23T00:00:00.000Z","attendanceDayType":"ABSENT"}]}""").records
        assertTrue(rows[0].isRecord)
        assertFalse(rows[1].isRecord)
        assertEquals("2026-09-24", rows[0].dayKey)
    }
}
