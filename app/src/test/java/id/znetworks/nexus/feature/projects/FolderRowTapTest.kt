package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Owner, 10 Oct (iOS 7e0c34f): the whole folder row opens / closes it; the calendar button keeps its own tap, set apart. */
class FolderRowTapTest {
    @Test fun wholeRowToggles() {
        val node = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
            .substringAfter("private fun FolderNode(").substringBefore("DropdownMenu(")
        val row = node.indexOf(".clickable(onClickLabel")
        val calendar = node.indexOf("onCalendar(f.id)")
        assertTrue(row in 0 until calendar)
        assertTrue("{ open = !open }" in node)
        assertTrue("Spacer(Modifier.size(10.dp))\n                IconButton(onClick = { onCalendar(f.id) }" in node)
    }
}
