package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Approved web parity, 18 Oct: High uses orange; Urgent uses red. */
class PriorityHighRedTest {
    @Test fun highIsDanger() {
        val ui = File("src/main/java/id/znetworks/nexus/feature/projects/TaskUi.kt").readText()
        assertTrue("\"URGENT\" -> Nx.colors.danger" in ui)
        assertTrue("\"HIGH\" -> Nx.colors.priorityHighText" in ui)
        assertFalse("\"HIGH\" -> Nx.colors.warning" in ui)
        assertTrue("\"HIGH\" -> Color(0xFFF97316)" in File("src/main/java/id/znetworks/nexus/feature/projects/ProjectTabs.kt").readText())
    }
}
