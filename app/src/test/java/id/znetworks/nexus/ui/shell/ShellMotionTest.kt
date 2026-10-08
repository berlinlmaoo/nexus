package id.znetworks.nexus.ui.shell

import id.znetworks.nexus.core.Badges
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellMotionTest {
    // Point 7: tab to tab has no animation; anything pushed slides (never zooms).
    @Test fun tabsDoNotAnimateScreensSlide() {
        assertTrue(ShellMotion.betweenTabs("home", "more"))
        assertFalse(ShellMotion.betweenTabs("more", "attendance"))
        assertFalse(ShellMotion.betweenTabs("task/{id}", "home"))
    }

    // Berlin, 8 Oct: Calendar takes Inbox's tab; Inbox comes back when flags.calendar is off.
    @Test fun calendarTakesInboxTab() {
        assertEquals(listOf("home", "messages", "calendar", "projects", "more"), ShellTabs.routes(calendarOn = true))
        assertEquals(listOf("home", "messages", "inbox", "projects", "more"), ShellTabs.routes(calendarOn = false))
        assertEquals("calendar", ShellTabs.tabOf("calendar?date={date}&view={view}&n={n}"))
        assertTrue(ShellMotion.betweenTabs("calendar?date={date}&view={view}&n={n}", "home"))
    }

    @Test fun badgeLabels() {
        assertNull(Badges.label(0))
        assertEquals("7", Badges.label(7))
        assertEquals("99+", Badges.label(140))
    }
}
