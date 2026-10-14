package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PIPELINE-DASHBOARD §10 (owner + GM, 9 Oct): one board, who sees it, won → execution project. */
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

    @Test fun manyBoardsAndAccess() {
        // §16 (11 Oct): picking Pipeline always creates a new board; nothing opens an existing one instead.
        val viewer = File("src/main/java/id/znetworks/nexus/core/Viewer.kt").readText()
        assertTrue(viewer.contains("o[\"canAccessPipeline\"]")); assertFalse(viewer.contains("o[\"pipelineProjectId\"]"))
        val projects = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
        assertFalse(projects.contains("PIPELINE_EXISTS")); assertFalse(projects.contains("onOpenBoard"))
        // The gallery offers Pipeline only to people with access (DEV-REDESIGN §1 moved the gate to TemplateLogic).
        assertTrue(File("src/main/java/id/znetworks/nexus/feature/projects/ProjectTemplates.kt").readText().contains("it != ProjectType.PIPELINE || pipelineAccess"))
        assertTrue(projects.contains("h?.code == \"PIPELINE_COMPANY_ONLY\""))
        val shell = File("src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()
        // §12.1: no Pipeline entry in More — the board is opened from Projects like any project.
        assertFalse(shell.contains("MoreItem(R.string.pl_tab"))
    }
}
