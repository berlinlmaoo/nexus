package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.feature.attendance.history.TrailRecord
import id.znetworks.nexus.feature.attendance.history.trailPlace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttendancePlaceTest {
    private val office = OfficeRef(name = "HQ", radiusMeters = 150.0)

    @Test fun flagFirstThenDistanceVsRadius() {
        assertEquals(true, AttendancePlace.isAway(true, 10.0, 150.0))
        assertEquals(false, AttendancePlace.isAway(false, 900.0, 150.0))
        assertEquals(true, AttendancePlace.isAway(null, 151.0, 150.0))
        assertEquals(false, AttendancePlace.isAway(null, 150.0, 150.0))
        assertNull(AttendancePlace.isAway(null, null, 150.0))
    }

    @Test fun awayShowsAddressThenCoordinatesNeverTheOffice() {
        assertEquals("Jl. Kemang Raya 8, Bangka", AttendancePlace.label(true, " Jl. Kemang Raya 8 , Bangka, Mampang, Jakarta", 1.0, 2.0, "HQ"))
        assertEquals("-6.26000, 106.81235", AttendancePlace.label(true, null, -6.26, 106.812345, "HQ"))
        assertNull(AttendancePlace.label(true, null, null, null, "HQ"))
        assertEquals("HQ", AttendancePlace.label(false, "Jl. X", 1.0, 2.0, "HQ"))
        assertEquals("HQ", AttendancePlace.label(null, null, null, null, "HQ"))
    }

    @Test fun perRecordNotPerPerson() {
        // A location-free member who checked in inside the radius is at the office.
        val inside = AttendanceRecord("r", checkInAt = "2026-09-28T02:00:00Z", officeLocation = office, checkInDistanceMeters = 40.0, checkInAddress = "Jl. X, Y")
        assertEquals(false, inside.checkedInAway); assertEquals("HQ", inside.placeLabel)
        val away = inside.copy(checkInAway = true)
        assertEquals("Jl. X, Y", away.placeLabel)
    }

    @Test fun trailHeaderPlace() {
        assertNull(trailPlace(TrailRecord(checkInAt = null), "Away"))
        assertEquals("Away · Jl. X, Y", trailPlace(TrailRecord(checkInAt = "t", checkInAway = true, checkInAddress = "Jl. X, Y, Z"), "Away"))
        assertEquals("Away · Kemang", trailPlace(TrailRecord(checkInAt = "t", checkInAway = true, placeLabel = "Kemang"), "Away"))
        assertEquals("HQ", trailPlace(TrailRecord(checkInAt = "t", office = id.znetworks.nexus.feature.attendance.history.TrailOffice("HQ", 0.0, 0.0)), "Away"))
    }
}
