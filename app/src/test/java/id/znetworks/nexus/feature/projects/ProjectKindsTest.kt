package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROJECT-TYPES-TABS (Berlin, 9 Oct): tabs per project, Finance opt-in, types, named icons. */
class ProjectKindsTest {
    private fun detail(json: String) = NexusJson.decodeFromString(ProjectDetail.serializer(), json)

    @Test fun fieldsReadLeniently() {
        val d = detail("""{"id":"p","name":"Ops","type":"TASK","hiddenTabs":["sprints","automations","mystery"],"financeEnabled":true}""")
        assertEquals(setOf("sprints", "automations", "mystery"), ProjectTabsLogic.hidden(d.hiddenTabs))
        assertTrue(ProjectTabsLogic.financeOn(d.financeEnabled, d.name))
        // Odd shapes never break the project: they hide nothing / fall back to the old rule.
        val odd = detail("""{"id":"p","name":"Finance HQ","hiddenTabs":"board","financeEnabled":"yes please"}""")
        assertEquals(emptySet<String>(), ProjectTabsLogic.hidden(odd.hiddenTabs))
        assertTrue(ProjectTabsLogic.financeOn(odd.financeEnabled, odd.name))
        // An older server: no fields at all.
        val old = detail("""{"id":"p","name":"Ops"}""")
        assertFalse(ProjectTabsLogic.financeOn(old.financeEnabled, old.name)); assertNull(old.type)
        // Opted out explicitly beats the name.
        assertFalse(ProjectTabsLogic.financeOn(detail("""{"id":"p","name":"Finance","financeEnabled":false}""").financeEnabled, "Finance"))
    }

    @Test fun visibleTabsAndFallback() {
        val v = ProjectTabsLogic.visible(setOf("board", "sheet"), financeOn = false, pnlOn = true, isBoD = false)
        assertFalse(ProjectTab.BOARD in v); assertFalse(ProjectTab.SHEET in v); assertFalse(ProjectTab.FINANCE in v); assertFalse(ProjectTab.PNL in v)
        assertTrue(ProjectTab.LIST in v)
        assertTrue(ProjectTab.PNL in ProjectTabsLogic.visible(emptySet(), false, pnlOn = true, isBoD = true))
        assertEquals(ProjectTab.LIST, ProjectTabsLogic.fallback(ProjectTab.BOARD, v))
        assertEquals(ProjectTab.CHAT, ProjectTabsLogic.fallback(ProjectTab.CHAT, v))
        assertEquals(ProjectTab.BOARD, ProjectTabsLogic.fallback(ProjectTab.SHEET, ProjectTabsLogic.visible(setOf("sheet"), false, false, false)))
    }

    @Test fun switchingSendsTheWholeSetInOrder() {
        // Unknown keys (and the web-only "table") stay; order is the tab bar's.
        assertEquals(listOf("table", "sprints", "zz-future"), ProjectTabsLogic.toggle(setOf("zz-future", "sprints", "table"), "chat", show = true))
        assertEquals(listOf("board", "chat"), ProjectTabsLogic.toggle(setOf("chat"), "board", show = false))
        assertEquals(listOf<String>(), ProjectTabsLogic.toggle(setOf("pages"), "pages", show = true))
        // Board or List stays on.
        assertTrue(ProjectTabsLogic.locked("list", setOf("board"))); assertTrue(ProjectTabsLogic.locked("board", setOf("list")))
        assertFalse(ProjectTabsLogic.locked("board", emptySet())); assertFalse(ProjectTabsLogic.locked("sheet", setOf("board")))
        // Every tab drawn here has a server key, except the two flags.
        ProjectTab.entries.forEach { t -> assertEquals(t.name, t == ProjectTab.FINANCE || t == ProjectTab.PNL, ProjectTabsLogic.key(t) == null) }
    }

    @Test fun namedIcons() {
        assertEquals("💼", ProjectIcon.emoji("briefcase")); assertEquals("🗄️", ProjectIcon.emoji("database"))
        assertEquals("📁", ProjectIcon.emoji("something-else"))
        assertEquals("🎬", ProjectIcon.emoji("🎬")); assertEquals("⭐️", ProjectIcon.emoji("⭐️"))
        assertNull(ProjectIcon.emoji("/api/files/abc.png")); assertNull(ProjectIcon.emoji(null)); assertNull(ProjectIcon.emoji(" "))
    }

    @Test fun onlyTaskProjectIsBuiltAndCreateSendsIt() {
        assertEquals(listOf(true, false, false, false), ProjectType.entries.map { it.ready })
        val api = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsApi.kt").readText()
        assertTrue(api.contains("put(\"type\", ProjectType.TASK.code)"))
    }
}
