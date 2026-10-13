package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Owner, 10 Oct (iOS 7e0c34f): the whole folder row opens / closes it; the calendar button keeps its own tap, set apart. */
class FolderRowTapTest {
    @Test fun wholeRowToggles() {
        val node = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectTree.kt").readText()
            .substringAfter("internal fun FolderNode(").substringBefore("DropdownMenu(")
        val row = node.indexOf(".combinedClickable(onClickLabel")
        val calendar = node.indexOf("a.openFolderView(f.id)")
        assertTrue(row in 0 until calendar)
        assertTrue("{ a.toggleOpen(f.id) }" in node)
        assertTrue("Spacer(Modifier.size(10.dp))\n                IconButton(onClick = { a.openFolderView(f.id) }" in node)
    }
}
