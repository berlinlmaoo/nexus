package id.znetworks.nexus.core.version

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVersionTest {
    private fun v(s: String) = AppVersion.parse(s)!!

    @Test fun comparesNumericallyPerComponent() {
        assertTrue(v("0.1.10") > v("0.1.9"))
        assertTrue(v("1.0.0") > v("0.99.99"))
        assertTrue(v("0.1.6") < v("0.1.7"))
    }

    @Test fun missingPartsCountAsZero() {
        assertEquals(v("0.1"), v("0.1.0"))
        assertTrue(v("0.1.1") > v("0.1"))
    }

    @Test fun unreadableIsNullNotZero() {
        assertNull(AppVersion.parse(""))
        assertNull(AppVersion.parse(null))
        assertNull(AppVersion.parse("0.1.x"))
        assertNull(AppVersion.parse("-1.0"))
    }
}
