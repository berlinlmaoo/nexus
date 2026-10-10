package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** FOLDERS-DND (10 Oct): the server's folder-tree rules, mirrored; drop keys; who sees what. */
class FolderTreeTest {
    // a › b › c › d (4 levels), e at the top, x in a missing parent (shows at the top).
    private val folders = listOf(
        ProjectFolder("a", "Clients"), ProjectFolder("b", "ANKER", parentFolderId = "a"),
        ProjectFolder("c", "Launch", parentFolderId = "b"), ProjectFolder("d", "Week 1", parentFolderId = "c"),
        ProjectFolder("e", "Internal"), ProjectFolder("x", "Orphan", parentFolderId = "gone"),
    )
    private val projects = listOf(Project("p1", "Event", folderId = "c"), Project("p2", "Loose"), Project("p3", "Lost", folderId = "gone"))
    private val t = FolderTree(folders, projects)

    @Test fun depthHeightAndPath() {
        assertEquals(1, t.depth("a")); assertEquals(4, t.depth("d")); assertEquals(1, t.depth("x"))
        assertEquals(4, t.height("a")); assertEquals(1, t.height("d"))
        assertEquals("Clients › ANKER › Launch", t.path("c"))
        assertEquals(listOf("a", "b", "c", "d", "e", "x"), t.inOrder().map { it.id })
        assertEquals(listOf("p2", "p3"), t.loose().map { it.id })
    }

    @Test fun folderMoves() {
        assertFalse(t.canMoveFolder("a", "a")); assertFalse(t.canMoveFolder("a", "c"))   // itself / its own subfolder
        assertFalse(t.canMoveFolder("e", "d"))                                           // would be level 5
        assertTrue(t.canMoveFolder("e", "c"))                                            // level 4
        assertTrue(t.canMoveFolder("b", "e"))                                            // level 1 + b's 3 levels = 4
        assertFalse(t.canMoveFolder("a", "e"))                                           // level 1 + a's 4 levels = 5
        assertFalse(t.canMoveFolder("c", "b"))                                           // already there
        assertTrue(t.canMoveFolder("c", null)); assertFalse(t.canMoveFolder("a", null))
        assertEquals(emptyList<String>(), t.folderTargets("a").map { it.id })                // 4 levels already: fits nowhere
        assertEquals(listOf("a", "b", "c", "x"), t.folderTargets("e").map { it.id })      // not d: that would be level 5
        assertTrue(t.canHaveSubfolder("c")); assertFalse(t.canHaveSubfolder("d"))
    }

    @Test fun projectMovesAndVisibility() {
        val p1 = projects[0]
        assertFalse(t.canMoveProject(p1, "c")); assertTrue(t.canMoveProject(p1, "d")); assertTrue(t.canMoveProject(p1, null))
        assertFalse(t.canMoveProject(projects[1], null))
        assertFalse(t.projectTargets(p1).any { it.id == "c" })
        assertTrue(t.hasProjects("a")); assertFalse(t.hasProjects("e")); assertFalse(t.hasProjects("d"))
        assertEquals(2, t.count("c"))                                                   // d + p1
    }

    @Test fun dropKeys() {
        assertEquals("pin/f:a", TreeDrag.key("pin", "a"))
        assertEquals("a", TreeDrag.folderOf("pin/f:a")); assertNull(TreeDrag.folderOf(TreeDrag.ROOT))
    }

    @Test fun menusAndRoles() {
        val tree = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectTree.kt").readText()
        listOf("fm_open_view", "fm_new_project", "fm_new_sub", "fm_edit", "fm_move", "fm_pin", "fm_delete", "pm_open", "pm_move", "pm_remove", "pm_settings")
            .forEach { assertTrue(it, "R.string.$it" in tree) }
        assertTrue("if (s.canManage) DragHandle(" in tree)
        assertTrue("if (!s.canManage && !a.tree.hasProjects(f.id)) return" in tree)
        val vm = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
        assertTrue("c.viewer.canAdminister" in vm)
    }
}
