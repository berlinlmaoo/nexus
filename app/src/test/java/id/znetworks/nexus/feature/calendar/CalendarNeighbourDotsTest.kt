package id.znetworks.nexus.feature.calendar

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Month grid (iOS / web QA 13 Oct): one dot per division, neighbouring-month days quieter but tappable, "No division". */
class CalendarNeighbourDotsTest {
    @Test fun neighbourDaysAreQuieterAndTappable() {
        val src = File("src/main/java/id/znetworks/nexus/feature/calendar/CalendarScreen.kt").readText()
        val cell = src.substringAfter("RowScope.DayCell(").substringBefore("/** How much quieter")
        assertTrue(cell.contains("if (inMonth) it else it.copy(alpha = it.alpha * QUIET_OUT_OF_MONTH)"))
        assertTrue(cell.contains(".clickable(onClickLabel = showLabel, role = Role.Button) { onPick(day) }")) // every day, not only this month's
        assertTrue(!src.contains("R.string.cal_other") && src.contains("R.string.cal_no_division"))
    }
}
