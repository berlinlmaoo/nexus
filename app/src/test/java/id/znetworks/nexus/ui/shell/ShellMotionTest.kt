package id.znetworks.nexus.ui.shell

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellMotionTest {
    // Point 7: tab to tab has no animation; anything pushed slides (never zooms).
    @Test fun tabsDoNotAnimateScreensSlide() {
        assertTrue(ShellMotion.betweenTabs("home", "more"))
        assertFalse(ShellMotion.betweenTabs("more", "attendance"))
        assertFalse(ShellMotion.betweenTabs("task/{id}", "home"))
    }
}
