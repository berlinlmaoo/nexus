package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** MEMBER-PICKER.md (Berlin, 9 Oct): search + multi-select, everyone picked in one request. */
class MemberPickerTest {
    @Test fun oneRequestAndFullHeightPicker() {
        val api = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsApi.kt").readText()
        assertTrue(api.contains("put(\"userIds\""))
        val screen = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectSettingsScreen.kt").readText()
        assertTrue(screen.contains("api.addMembers(projectId, ids)")); assertFalse(screen.contains("ids.forEach { api.addMember("))
        assertTrue(screen.contains("usePlatformDefaultWidth = false")); assertTrue(screen.contains("focusRequester(focus)"))
        assertTrue(screen.contains("PipelineViewModel.membersChanged()"))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("ps_add_n", "ps_n_selected", "ps_no_match", "ps_everyone_hint", "ps_only_managers_add", "ps_already_in", "ps_n_added").forEach { assertTrue("$v $it", s.contains("name=\"$it\"")) }
        }
    }
}
