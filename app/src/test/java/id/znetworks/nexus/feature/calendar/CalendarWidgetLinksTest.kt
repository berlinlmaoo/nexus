package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.feature.calendar.CalendarGlance.Bar
import id.znetworks.nexus.feature.calendar.CalendarGlance.Overdue
import id.znetworks.nexus.feature.calendar.CalendarGlance.Quadrant
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgetLinks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Widget taps carry the widget's scope (audit #33: a tap on the "Mine" widget used to open Everyone),
 * masked rows open only the day (decision 1), "+N" opens the whole list (audit #40). Every link must parse
 * back to the Calendar target the app routes on.
 */
class CalendarWidgetLinksTest {
    private fun bar(id: String?, day: String?, masked: Boolean = false) =
        Bar(id ?: "x_1", id, if (masked) null else "T", day, null, "#000000", null, null, dim = false, done = false, masked = masked, overdue = Overdue.NONE)

    @Test fun everyLinkKeepsTheScope() {
        for (scope in listOf("me", "division", "all")) {
            val links = listOf(CalendarWidgetLinks.calendar(scope), CalendarWidgetLinks.day("2026-10-06", scope),
                CalendarWidgetLinks.task(bar("t1", "2026-10-06"), scope), CalendarWidgetLinks.task(bar("t2", null), scope),
                CalendarWidgetLinks.task(bar(null, "2026-10-06", masked = true), scope), CalendarWidgetLinks.quadrant(Quadrant.ACT, scope))
            links.forEach { l -> assertEquals(l, scope, (Links.parse(l) as Target.Calendar).scope) }
        }
    }

    @Test fun maskedOpensOnlyTheDay() {
        val t = Links.parse(CalendarWidgetLinks.task(bar(null, "2026-10-06", masked = true), "me")) as Target.Calendar
        assertEquals("2026-10-06", t.date); assertEquals(null, t.task)
        val open = Links.parse(CalendarWidgetLinks.task(bar("t1", "2026-10-06"), "all")) as Target.Calendar
        assertEquals("t1", open.task); assertEquals("2026-10-06", open.date)
        // Undated → the task itself.
        assertEquals("t2", (Links.parse(CalendarWidgetLinks.task(bar("t2", null), "me")) as Target.Calendar).task)
    }

    @Test fun plusMoreOpensTheQuadrantList() {
        val t = Links.parse(CalendarWidgetLinks.quadrant(Quadrant.LATER, "division")) as Target.Calendar
        assertEquals("quadrant", t.view); assertEquals("later", t.q)
    }

    @Test fun widgetsDeclareSizesTheLayoutHolds() {
        // Audit #13, #20: no resize below what the layout draws; WorkManager is the only scheduler.
        val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "app/src/main").isDirectory }
        fun info(n: String) = File(root, "app/src/main/res/xml/cal_${n}_widget_info.xml").readText()
        assertTrue("minResizeWidth=\"250dp\"" in info("month_upcoming"))
        assertTrue("minResizeWidth=\"250dp\"" in info("week"))
        assertTrue("minResizeHeight=\"180dp\"" in info("month"))
        listOf("month", "month_upcoming", "week", "do", "plan", "act", "later").forEach {
            assertTrue(it, "updatePeriodMillis=\"0\"" in info(it))
            // A real preview in the widget picker, in both languages (audit #42).
            assertTrue(it, "android:previewImage=\"@drawable/cal_preview_$it\"" in info(it))
            assertTrue(it, File(root, "app/src/main/res/drawable-nodpi/cal_preview_$it.png").isFile && File(root, "app/src/main/res/drawable-in-nodpi/cal_preview_$it.png").isFile)
        }
        // Widget text is at least 10 sp (audit #14).
        val src = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/widget/CalendarWidgets.kt").readText()
        assertFalse(Regex("""fontSize = [0-9]\.sp""").containsMatchIn(src))
        assertFalse(Regex("""fontSize = fs\([0-9]f\)""").containsMatchIn(src))
        assertTrue("WIDGET_MAX_FONT_SCALE = 1.3f" in src)
        // Audit 2 #27: the system background element and radius; #6: day numbers never wrap.
        assertTrue("appWidgetBackground()" in src && "system_app_widget_background_radius" in src)
        assertFalse("GlanceModifier.size(circle)" in src)
    }
}
