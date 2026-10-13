package id.znetworks.nexus.ui.shell

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellLayoutTest {
    @Test fun railFromMediumWidth() {
        assertFalse(ShellLayout.useRail(411)) // a phone
        assertTrue(ShellLayout.useRail(600))  // a small tablet or an unfolded phone
        assertTrue(ShellLayout.useRail(1280))
    }
}
