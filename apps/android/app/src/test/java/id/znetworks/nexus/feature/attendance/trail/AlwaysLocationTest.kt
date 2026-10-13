package id.znetworks.nexus.feature.attendance.trail

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlwaysLocationTest {
    @Test fun preciseFirstThenAllTheTime() {
        assertEquals(AlwaysLocation.Missing.PRECISE, AlwaysLocation.missing(fine = false, background = true, sdk = 34)) // approximate only
        assertEquals(AlwaysLocation.Missing.ALL_THE_TIME, AlwaysLocation.missing(fine = true, background = false, sdk = 29))
        assertEquals(AlwaysLocation.Missing.ALL_THE_TIME, AlwaysLocation.missing(fine = true, background = false, sdk = 34))
        assertNull(AlwaysLocation.missing(fine = true, background = true, sdk = 34))
        // Android 9 and older: "all the time" comes with the location permission itself.
        assertNull(AlwaysLocation.missing(fine = true, background = false, sdk = 28))
    }
}
