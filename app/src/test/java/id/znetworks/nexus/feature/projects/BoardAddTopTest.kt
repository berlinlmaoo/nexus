package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Berlin, 10 Oct: a lane's "Add task" sits under its header, above (outside) the scrolled card list. */
class BoardAddTopTest {
    @Test fun addTaskAboveLaneList() {
        val src = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectDetailScreen.kt").readText()
        val board = src.substringAfter("private fun Board(").substringBefore("private fun MovableTask(")
        val add = board.indexOf("InlineAdd(")
        val list = board.indexOf("LazyColumn(")
        assertTrue(add in 0 until list)
        assertTrue("dashPathEffect" in src.substringAfter("private fun InlineAdd(").substringBefore("private fun ListTab("))
    }
}
