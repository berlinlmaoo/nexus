package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROJECT-SETUP-MEMBERS (Berlin, 11 Oct; server eecca18): tabs + members on create, multi-add without a team step. */
class ProjectSetupMembersTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun tabsOfferedAreTheSettingsOnes() {
        val keys = ProjectSetupLogic.TABS.map { ProjectTabsLogic.key(it) }
        assertEquals(listOf("overview", "board", "list", "sheet", "calendar", "timeline", "sprints", "automations", "pages", "forms", "chat"), keys)
        assertFalse(ProjectSetupLogic.TABS.any { it == ProjectTab.PIPELINE || it.name.startsWith("OUTLET_") })
    }

    @Test fun whatIsSent() {
        assertNull(ProjectSetupLogic.hiddenToSend(emptySet()))
        // Tab-bar order, whatever order they were switched off in.
        assertEquals(listOf("sprints", "chat"), ProjectSetupLogic.hiddenToSend(setOf("chat", "sprints")))
        assertNull(ProjectSetupLogic.membersToSend(emptySet(), "me"))
        assertNull(ProjectSetupLogic.membersToSend(setOf("me"), "me"))
        assertEquals(listOf("a", "b"), ProjectSetupLogic.membersToSend(setOf("b", "me", "a"), "me"))
        // Board or List stays on.
        assertTrue(ProjectTabsLogic.locked("list", setOf("board")))
    }

    @Test fun searchByNameOrEmail() {
        val r = listOf(RosterMember(userId = "1", name = "Rina", email = "rina@z.id"), RosterMember(userId = "2", name = "andi", email = "ops@z.id"))
        assertEquals(listOf("2", "1"), ProjectSetupLogic.filter(r, "").map { it.userId })
        assertEquals(listOf("2"), ProjectSetupLogic.filter(r, "OPS@").map { it.userId })
    }

    @Test fun createSendsTheShapes() {
        val api = src("feature/projects/ProjectsApi.kt").substringAfter("suspend fun createProject(").substringBefore("\n    }")
        assertTrue(api.contains("put(\"hiddenTabs\"") && api.contains("if (type == ProjectType.TASK)"))
        assertTrue(api.contains("put(\"memberIds\""))
        val screen = src("feature/projects/ProjectsScreen.kt")
        val dialog = screen.substringAfter("private fun CreateProjectDialog(").substringBefore("private fun FolderDialog(")
        assertTrue(dialog.contains("if (type == ProjectType.TASK) StartingTabs(") && dialog.contains("StartingMembers(") && dialog.contains("PeoplePickerDialog("))
        listOf("MEMBER_NOT_IN_WORKSPACE", "TOO_MANY_MEMBERS", "TASK_VIEW_REQUIRED").forEach { assertTrue(it, screen.contains("\"$it\"")) }
    }

    @Test fun addPeopleHasNoTeamStepAndChatAddsInOneGo() {
        val settings = src("feature/projects/ProjectSettingsScreen.kt")
        assertTrue(settings.contains("PeoplePickerDialog(")); assertFalse(settings.contains("teamId"))
        val chat = src("feature/chat/ChatThreadScreen.kt")
        assertTrue(chat.contains("projects.addMembers(pid, userIds)")); assertFalse(chat.contains("projects.addMember(pid, uid)"))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("setup_tabs", "setup_members", "setup_add_members", "setup_pick_n", "setup_done", "setup_err_outside").forEach { assertTrue("$v $it", s.contains("name=\"$it\"")) }
        }
    }

    @Test fun tabPickerIsPreviewCards() {
        assertEquals(2, TabPreviewLogic.columns(411)); assertEquals(3, TabPreviewLogic.columns(800))
        // Every offered tab has a description, in both languages.
        ProjectSetupLogic.TABS.forEach { t -> assertTrue(t.name, TabPreviewLogic.description(ProjectTabsLogic.key(t)!!) != null) }
        val setup = src("feature/projects/ProjectSetup.kt")
        assertTrue(setup.contains("TabPreviewCards(hidden, enabled, onChange)")); assertFalse(setup.contains("FilterChip("))
        val cards = src("feature/projects/TabPreview.kt")
        listOf("overview", "board", "list", "table", "sheet", "calendar", "timeline", "sprints", "automations", "pages", "forms", "chat").forEach {
            assertTrue(it, cards.contains("\"$it\" ->") || cards.contains("\"$it\", "))
        }
        assertTrue(cards.contains("height(56.dp)") && cards.contains("alpha(if (on) 1f else 0.6f)"))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("tp_overview", "tp_board", "tp_chat", "tp_on", "tp_off").forEach { assertTrue("$v $it", s.contains("name=\"$it\"")) }
        }
    }
}
