package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** SPRINTS-OVERVIEW §1–2 (Berlin, 11 Oct): no Sprints tab anywhere; Automations starts off in a new project. */
class SprintsRemovedTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun noSprintsTabAnywhere() {
        assertFalse(ProjectTab.entries.any { it.name == "SPRINTS" })
        assertFalse("sprints" in ProjectTabsLogic.KEYS)
        assertFalse(ProjectSetupLogic.TABS.any { ProjectTabsLogic.key(it) == "sprints" })
        listOf("feature/projects/ProjectTabs.kt", "feature/projects/ProjectsApi.kt", "feature/projects/ProjectTabModels.kt", "core/realtime/Realtime.kt").forEach { f ->
            val s = src(f); assertFalse(f, s.contains("SprintsTab") || s.contains("/api/sprints") || s.contains("data class Sprint") || s.contains("sprint-updated"))
        }
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            assertFalse(v, s.contains("name=\"ptab_sprints\"") || s.contains("name=\"pt_sprint_") || s.contains("name=\"tp_sprints\""))
        }
    }

    @Test fun anOldHiddenSprintsIsIgnoredAndKept() {
        val d = NexusJson.decodeFromString(ProjectDetail.serializer(), """{"id":"p","name":"x","hiddenTabs":["sprints","pages"]}""")
        val hidden = ProjectTabsLogic.hidden(d.hiddenTabs)
        assertTrue(ProjectTab.PAGES !in ProjectTabsLogic.visible(hidden))
        // Switching another tab keeps it, as an unknown key at the end.
        assertEquals(listOf("chat", "sprints"), ProjectTabsLogic.toggle(hidden, "pages", show = true).let { ProjectTabsLogic.toggle(it.toSet(), "chat", show = false) })
        assertFalse(RealtimeEvents.LISTENED.contains("sprint-updated"))
    }

    @Test fun newProjectStartsWithoutAutomations() {
        val dialog = src("feature/projects/ProjectsScreen.kt").substringAfter("private fun CreateProjectDialog(").substringBefore("private fun FolderDialog(")
        assertTrue(dialog.contains("mutableStateOf(ProjectSetupLogic.DEFAULT_HIDDEN.toList())"))
    }
}
