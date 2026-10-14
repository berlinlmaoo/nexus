package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** owner, 10 Oct: a lane's "Add task" sits under its header, above (outside) the scrolled card list. */
class BoardAddTopTest {
    @Test fun addTaskAboveLaneList() {
        // Redesign (13 Oct): the board lives in ProjectPage.kt; "+ New task" still sits above the cards.
        val src = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectPage.kt").readText()
        // The status columns (the read-only Linked lanes before them take no new tasks, 14 Oct).
        val board = src.substringAfter("private fun BoardColumn(").substringBefore("private fun SectionStatusButton(")
        val add = board.indexOf("InlineNewTask(")
        val list = board.indexOf("LazyColumn(")
        assertTrue(add in 0 until list)
    }
}
