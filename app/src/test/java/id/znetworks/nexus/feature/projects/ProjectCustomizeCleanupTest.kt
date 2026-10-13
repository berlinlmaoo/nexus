package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** PROJECT-CUSTOMIZE-CLEANUP (Berlin, 11 Oct): duplicate always on; P&L, Finance, proof and calendar mode gone. */
class ProjectCustomizeCleanupTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()
    private fun res(p: String) = File("src/main/res/$p").readText()

    @Test fun selectionTogglesAndKeepsBoardOrder() {
        assertEquals(setOf("a"), TaskBulkLogic.toggle(emptySet(), "a"))
        assertEquals(emptySet<String>(), TaskBulkLogic.toggle(setOf("a"), "a"))
        val lanes = listOf(Lane("l1", "To do", tasks = listOf(BoardTask("t1"), BoardTask("t2"))), Lane("l2", "Done", tasks = listOf(BoardTask("t3"))))
        assertEquals(listOf("t1", "t3"), TaskBulkLogic.ordered(lanes, setOf("t3", "t1", "gone")))
    }

    @Test fun duplicateBodyLeavesTheDateOutUnlessPicked() {
        assertEquals("{}", TaskBulkLogic.body(null).toString())
        assertEquals("""{"dueDate":"2026-10-20"}""", TaskBulkLogic.body(LocalDate.of(2026, 10, 20)).toString())
        assertTrue(src("feature/projects/ProjectsApi.kt").contains("\"/api/tasks/\$taskId/duplicate\""))
    }

    @Test fun boardAndListAlwaysOfferIt() {
        val s = src("feature/projects/ProjectDetailScreen.kt")
        assertFalse(s.contains("enableTaskBatchDuplicate"))
        val page = src("feature/projects/ProjectPage.kt")
        assertTrue(page.contains("TaskBulkMenuItems(") && page.contains("fun ProjectSelectionBar(") && s.contains("DuplicateDateDialog("))
        // List rows use the same long-press menu as Board cards.
        val list = page.substringAfter("private fun ListRow(").substringBefore("\n}\n")
        assertTrue(list.contains("TaskMenu("))
    }

    @Test fun customizeHasOnlyAutoAssign() {
        val s = src("feature/projects/ProjectSettingsScreen.kt")
        listOf("enableTaskBatchDuplicate", "requireAttachmentForDone", "enablePnlDashboard", "financeEnabled", "disableTaskStatus").forEach {
            assertFalse(it, s.contains(it))
        }
        assertTrue(s.contains("\"autoAssignEnabled\""))
    }

    @Test fun financeAndPnlAreGone() {
        assertFalse(ProjectTab.entries.any { it.name == "FINANCE" || it.name == "PNL" })
        listOf("feature/projects/ProjectTabs.kt", "feature/projects/ProjectsApi.kt", "feature/projects/ProjectDetailScreen.kt").forEach { f ->
            val s = src(f)
            assertFalse(f, s.contains("/api/finance/") || s.contains("/api/pnl/") || s.contains("FinanceTab") || s.contains("PnlTab"))
        }
        listOf("values/strings.xml", "values-in/strings.xml").forEach { f ->
            val s = res(f)
            listOf("ps_batch_dup", "ps_proof", "ps_pnl_sub", "ps_finance_sub", "ptab_finance", "ptab_pnl").forEach { assertFalse("$f $it", s.contains("name=\"$it\"")) }
            assertTrue(f, s.contains("name=\"bulk_select\"") && s.contains("name=\"bulk_dup_title\""))
        }
    }

    @Test fun oldFlagsStillDecode() {
        val d = NexusJson.decodeFromString(ProjectDetail.serializer(),
            """{"id":"p","name":"x","enableTaskBatchDuplicate":true,"enablePnlDashboard":false,"financeEnabled":false,"requireAttachmentForDone":false,"disableTaskStatus":false}""")
        assertEquals(true, d.enableTaskBatchDuplicate)
    }
}
