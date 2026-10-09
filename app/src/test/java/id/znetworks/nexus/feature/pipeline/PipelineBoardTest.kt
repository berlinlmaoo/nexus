package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PIPELINE-DASHBOARD §10 (Berlin + GM, 9 Oct): one board, who sees it, won → execution project. */
class PipelineBoardTest {
    private fun deal(json: String) = PipelineDeal(NexusJson.parseToJsonElement(json).jsonObject)

    @Test fun executionProject() {
        val linked = deal("""{"id":"a","stage":"Won – In Execution","executionProjectId":"p9","executionProject":{"id":"p9","name":"Gala Acme"}}""")
        assertEquals("p9", linked.executionProjectId); assertEquals("Gala Acme", linked.executionProjectName); assertTrue(linked.isWon)
        // Imported won deals have none until someone makes it; a pipeline deal is not won.
        val imported = deal("""{"id":"b","stage":"Won – Contract Pending","vregStatus":"Not Assessed","bdName":"BD 1"}""")
        assertNull(imported.executionProjectId); assertTrue(imported.isWon)
        assertEquals("Not Assessed", imported.text("vregStatus")); assertEquals("BD 1", imported.bdShown) // shown as-is
        assertFalse(deal("""{"id":"c","stage":"Negotiation"}""").isWon)
    }

    @Test fun oneBoardAndAccess() {
        val viewer = File("src/main/java/id/znetworks/nexus/core/Viewer.kt").readText()
        assertTrue(viewer.contains("o[\"canAccessPipeline\"]")); assertTrue(viewer.contains("o[\"pipelineProjectId\"]"))
        val projects = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
        // 409 PIPELINE_EXISTS opens the board; no access = no Pipeline type to pick; an existing board opens directly.
        assertTrue(projects.contains("h?.code == \"PIPELINE_EXISTS\" && existing != null -> existing"))
        assertTrue(projects.contains("it != ProjectType.PIPELINE || pipelineAccess"))
        assertTrue(projects.contains("onOpenBoard(pipelineId)"))
        val shell = File("src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()
        // §12.1: no Pipeline entry in More — the board is opened from Projects like any project.
        assertFalse(shell.contains("MoreItem(R.string.pl_tab"))
    }
}
