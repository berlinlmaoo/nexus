package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.YearMonth

class FolderLogicTest {
    private val folders = listOf(ProjectFolder("a"), ProjectFolder("b", parentFolderId = "a"), ProjectFolder("c", parentFolderId = "b"), ProjectFolder("x"))
    private val projects = listOf(Project("p1", folderId = "a"), Project("p2", folderId = "c"), Project("p3", folderId = "x"), Project("p4"))

    @Test fun subFoldersAtAnyDepthCount() {
        assertEquals(setOf("b", "c"), FolderLogic.descendants("a", folders))
        assertEquals(listOf("p1", "p2"), FolderLogic.folderProjects("a", folders, projects).map { it.id })
    }

    @Test fun emptyMeansAllAndAllIsSavedAsEmpty() {
        val inA = FolderLogic.folderProjects("a", folders, projects)
        assertEquals(listOf("p1", "p2"), FolderLogic.selected(emptyList(), inA))
        assertEquals(listOf("p2"), FolderLogic.selected(listOf("p2", "p3"), inA)) // a project moved out drops out
        assertEquals(emptyList<String>(), FolderLogic.toSave(setOf("p1", "p2"), inA))
        assertEquals(listOf("p1"), FolderLogic.toSave(setOf("p1"), inA))
    }

    @Test fun tasksGroupByDueDayOfTheMonth() {
        val t = listOf(BoardTask("t1", dueDate = "2026-09-03T00:00:00.000Z"), BoardTask("t2", dueDate = "2026-09-03"), BoardTask("t3", dueDate = "2026-10-01"), BoardTask("t4"))
        val m = FolderLogic.byDay(t, YearMonth.of(2026, 9))
        assertEquals(setOf(3), m.keys); assertEquals(listOf("t1", "t2"), m[3]!!.map { it.id })
    }
}
