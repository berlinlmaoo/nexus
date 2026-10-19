package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** DEV-REDESIGN.md §1 (12 Oct 2026): the New project template gallery, section status, Calendar "Plot by", "My …". */
class ProjectTemplatesTest {
    // GET /api/project-templates as the dev registry answers it (server d806968: 7 templates).
    private val templates = NexusJson.decodeFromString(ProjectTemplatesResponse.serializer(),
        javaClass.classLoader!!.getResource("project-templates.json")!!.readText()).templates
    private fun t(id: String) = templates.first { it.id == id }

    @Test fun theRegistryDecodes() {
        assertEquals(listOf("content-plan", "social-media", "event", "meetings", "notes", "brainstorm", "tasks"), templates.map { it.id })
        val cp = t("content-plan")
        assertEquals("Idea → In progress → In review → Published", TemplateLogic.sectionsLine(cp, "en"))
        assertEquals("Ide → Sedang dikerjakan → Direview → Terbit", TemplateLogic.sectionsLine(cp, "id"))
        assertEquals(listOf("TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"), cp.sections.map { it.status })
        assertEquals("cf:publicationDate", cp.calendarBy)
        assertTrue(TemplateLogic.hasStarter(cp))
        assertFalse(TemplateLogic.hasStarter(t("notes")))
        assertEquals("My meetings", t("meetings").myView?.name?.en)
    }

    @Test fun languageAndSearch() {
        assertEquals("en", TemplateLogic.lang("en")); assertEquals("id", TemplateLogic.lang("in")); assertEquals("id", TemplateLogic.lang(null))
        assertEquals("Hello", TemplateLogic.say(TemplateText("Hello", ""), "id"))
        // Field names in either language are searched too.
        assertEquals(listOf("content-plan"), TemplateLogic.shown(templates, "all", "tanggal tayang").map { it.id })
        assertEquals(listOf("content-plan", "social-media"), TemplateLogic.shown(templates, "marketing", "").map { it.id })
        assertTrue(TemplateLogic.shown(templates, "all", "zzz").isEmpty())
        assertEquals(listOf("marketing", "projects", "docs", "planning", "operations", "dashboards"), TemplateLogic.categories(templates, true))
        assertEquals(listOf(ProjectType.OUTLET_SALES, ProjectType.SOCIAL_MEDIA_REPORT), TemplateLogic.dashboards(pipelineAccess = false))
        assertEquals(listOf(ProjectType.OUTLET_SALES, ProjectType.SOCIAL_MEDIA_REPORT, ProjectType.PIPELINE), TemplateLogic.dashboards(pipelineAccess = true))
    }

    @Test fun tabsTheTemplateOpensOn() {
        val all = ProjectTabsLogic.visible(emptySet())
        assertEquals(ProjectTab.BOARD, TemplateLogic.openingTab(t("content-plan"), all))
        assertEquals(ProjectTab.CALENDAR, TemplateLogic.openingTab(t("social-media"), all))
        // Table is the web's; here it opens List.
        assertEquals(ProjectTab.LIST, TemplateLogic.openingTab(t("tasks"), all))
        assertNull(TemplateLogic.openingTab(t("social-media"), all - ProjectTab.CALENDAR))
        assertEquals(ProjectTab.LIST, TemplateLogic.myViewTab(t("meetings"), all))
        assertNull(TemplateLogic.myViewTab(t("notes"), all))
    }

    @Test fun calendarPlotsTheTemplateField() {
        val fields = listOf(CustomFieldDef("f1", "Tipe", "MULTI_SELECT"), CustomFieldDef("f2", "Tanggal tayang", "DATE"))
        assertEquals("f2", TemplateLogic.calendarFieldId(t("content-plan"), fields))
        assertNull(TemplateLogic.calendarFieldId(t("content-plan"), listOf(CustomFieldDef("f2", "Renamed", "DATE"))))
        assertNull(TemplateLogic.calendarFieldId(t("content-plan"), listOf(CustomFieldDef("f2", "Publication date", "TEXT"))))
        assertNull(TemplateLogic.calendarFieldId(t("notes"), fields))
        assertNull(TemplateLogic.calendarFieldId(null, fields))
        val task = BoardTask("a", dueDate = "2026-10-20T00:00:00.000Z", customFieldValues = listOf(CustomFieldValue("f2", JsonPrimitive("2026-10-14"))))
        assertEquals(LocalDate.of(2026, 10, 20), TemplateLogic.plotDate(task, null))
        assertEquals(LocalDate.of(2026, 10, 14), TemplateLogic.plotDate(task, "f2"))
        assertNull(TemplateLogic.plotDate(task, "f9"))
        val byDay = BoardLogic.byDay(listOf(task), java.time.YearMonth.of(2026, 10)) { TemplateLogic.plotDate(it, "f2") }
        assertEquals(listOf(14), byDay.keys.toList())
    }

    @Test fun myChipKeepsOnlyMyTasks() {
        val lanes = listOf(Lane("l", tasks = listOf(
            BoardTask("a", assignees = listOf(Assignee(userId = "me"))),
            BoardTask("b", assignees = listOf(Assignee(user = UserRef(id = "me")))),
            BoardTask("c", assignees = listOf(Assignee(userId = "you"))), BoardTask("d"))))
        assertEquals(listOf("a", "b"), TemplateLogic.mine(lanes, "me").single().tasks.map { it.id })
        assertEquals(4, TemplateLogic.mine(lanes, null).single().tasks.size)
        assertEquals(listOf("TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"), TemplateLogic.SECTION_STATUSES)
    }

    @Test fun wiring() {
        val dir = "src/main/java/id/znetworks/nexus/feature/projects"
        val api = File("$dir/ProjectsApi.kt").readText()
        assertTrue(api.contains("\"/api/project-templates\""))
        assertTrue(api.contains("if (template != null && type == ProjectType.TASK) { put(\"templateId\", template.id); put(\"lang\", lang); put(\"starter\", starter) }"))
        // A new task takes its section's status: the app names none.
        assertFalse(api.contains("put(\"status\", \"TODO\")"))
        assertTrue(api.contains("patch(\"/api/projects/\$projectId/sections\""))
        val screen = File("$dir/ProjectsScreen.kt").readText()
        assertTrue(screen.contains("TemplateGalleryDialog(pipelineAccess")); assertTrue(screen.contains("TemplateChosen(chosen"))
        assertTrue(screen.contains("R.string.tg_starter")); assertFalse(screen.contains("TypeCard("))
        assertTrue(screen.contains("\"UNKNOWN_TEMPLATE\""))
        val detail = File("$dir/ProjectDetailScreen.kt").readText()
        assertTrue(detail.contains("TemplateLogic.openingTab(t, tabs)")); assertTrue(detail.contains("MineChip("))
        assertTrue(detail.contains("CalendarPlot(s.dateFields.orEmpty(), s.plotBy, vm::setPlotBy)"))
        assertTrue(detail.substringAfter("private fun SectionStatusDialog").contains("AlertDialog("))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("tg_search", "tg_clear_search", "tg_all", "tg_cat_marketing", "tg_cat_projects", "tg_cat_docs", "tg_cat_planning", "tg_cat_operations",
                "tg_cat_dashboards", "tg_blank", "tg_blank_sub", "tg_failed", "tg_retry", "tg_no_match", "tg_show_all", "tg_col_name", "tg_col_status",
                "tg_col_assignee", "tg_col_due", "tg_col_priority", "tg_change", "tg_sections", "tg_fields", "tg_starter", "tg_starter_tasks", "tg_err_unknown",
                "sec_status", "sec_status_title", "sec_status_hint", "sec_status_none", "cal_plot_by", "cal_plot_due")
                .forEach { assertEquals("$v $it", 1, Regex("name=\"$it\"").findAll(s).count()) }
        }
    }
}
