package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Owner, 10 Oct (iOS bf64885): HIGH is red like URGENT again, on the pill, the chip and the timeline bar. */
class PriorityHighRedTest {
    @Test fun highIsDanger() {
        val ui = File("src/main/java/id/znetworks/nexus/feature/projects/TaskUi.kt").readText()
        assertTrue("\"URGENT\", \"HIGH\" -> Nx.colors.danger" in ui)
        assertFalse("\"HIGH\" -> Nx.colors.warning" in ui)
        assertTrue("\"HIGH\" -> Color(0xFFEF4444)" in File("src/main/java/id/znetworks/nexus/feature/projects/ProjectTabs.kt").readText())
    }
}
