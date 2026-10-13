package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.feature.attendance.history.MapFrame
import org.junit.Assert.assertEquals
import org.junit.Test

class HeroMapTest {
    @Test fun officeIsFramedSevenRadiiAcrossNeverUnder300m() {
        assertEquals(700.0, MapFrame.office(-6.2, 106.8, 100.0).spanMeters, 0.0)
        assertEquals(300.0, MapFrame.office(-6.2, 106.8, 30.0).spanMeters, 0.0)
        assertEquals(400.0, MapFrame.person(-6.2, 106.8).spanMeters, 0.0)
    }

    @Test fun locationFreeCardShowsTheFirstTwoAddressParts() {
        assertEquals("Jl. Sudirman 5, Senayan", shortAddress("Jl. Sudirman 5, Senayan, Jakarta Selatan, DKI Jakarta"))
        assertEquals("Kopi Kenangan", shortAddress("Kopi Kenangan"))
        assertEquals("", shortAddress(" , "))
    }
}
