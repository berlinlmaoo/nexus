package id.znetworks.nexus.feature.projects

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate

// Project templates (DEV-REDESIGN.md §1; server lib/project-templates.ts, web TemplateGallery). Every
// template is data from GET /api/project-templates: a template added on the server shows up here without
// an app update. POST /api/projects { templateId, lang, starter } builds it as an ordinary Task Project.

/** Text in both languages. */
@Serializable
data class TemplateText(val en: String = "", val id: String = "")

@Serializable
data class TemplateOption(val label: TemplateText = TemplateText(), val color: String? = null)

@Serializable
data class TemplateField(val key: String = "", val name: TemplateText = TemplateText(), val type: String = "", val options: List<TemplateOption> = emptyList())

/** A section; [status] = the task status it stands for (TaskList.taskStatus), null = a plain section. */
@Serializable
data class TemplateSection(val name: TemplateText = TemplateText(), val status: String? = null, val color: String? = null)

@Serializable
data class TemplateBuiltin(val key: String = "", val name: TemplateText = TemplateText())

/** Notion's "My meetings": the header offers a chip that filters on assignee = me, on [tab]. */
@Serializable
data class TemplateMyView(val name: TemplateText = TemplateText(), val tab: String = "list")

@Serializable
data class TemplatePreviewSpec(val layout: String = "table", val columns: List<String> = emptyList())

@Serializable
data class TemplateStarterDoc(val title: TemplateText = TemplateText(), val icon: String? = null)

@Serializable
data class ProjectTemplate(
    val id: String,
    val category: String = "",
    val name: TemplateText = TemplateText(),
    val blurb: TemplateText = TemplateText(),
    /** lucide-react name; unknown ones draw the checklist. */
    val icon: String? = null,
    val tint: String? = null,
    val sections: List<TemplateSection> = emptyList(),
    val fields: List<TemplateField> = emptyList(),
    val builtins: List<TemplateBuiltin> = emptyList(),
    val tabs: List<String> = emptyList(),
    /** What the create dialog's tab cards start from. */
    val hiddenTabs: List<String> = emptyList(),
    val defaultTab: String = "board",
    /** "dueDate" or "cf:<field key>": what the Calendar plots. */
    val calendarBy: String = "dueDate",
    val myView: TemplateMyView? = null,
    val preview: TemplatePreviewSpec = TemplatePreviewSpec(),
    val starterDocs: List<TemplateStarterDoc> = emptyList(),
    val starterTasks: Int = 0,
)

@Serializable
data class ProjectTemplatesResponse(val templates: List<ProjectTemplate> = emptyList())

/** What the gallery's first step picked. */
sealed interface GalleryPick {
    data object Blank : GalleryPick
    data class Dashboard(val type: ProjectType) : GalleryPick
    data class Template(val template: ProjectTemplate) : GalleryPick
}

object TemplateLogic {
    /** The registry's categories, then the two typed projects. */
    val CATEGORY_ORDER = listOf("marketing", "projects", "docs", "planning", "operations", "dashboards")

    /** The project types offered as dashboards (Content Planner is gone: the Content Plan template replaced it). */
    fun dashboards(pipelineAccess: Boolean): List<ProjectType> =
        listOf(ProjectType.OUTLET_SALES, ProjectType.SOCIAL_MEDIA_REPORT, ProjectType.PIPELINE).filter { it != ProjectType.PIPELINE || pipelineAccess }

    /** The reader's language; Indonesian falls back to English when a text has none. */
    fun say(t: TemplateText, lang: String): String = if (lang == "en") t.en else t.id.ifBlank { t.en }

    /** Server language codes: "en" or "id" (the web's default). */
    fun lang(appLang: String?): String = if (appLang == "en") "en" else "id"

    /** The category chips: All first (drawn by the screen), then the ones that have something in them. */
    fun categories(templates: List<ProjectTemplate>, hasDashboards: Boolean): List<String> =
        CATEGORY_ORDER.filter { c -> if (c == "dashboards") hasDashboards else templates.any { it.category == c } }

    /** Search on both languages' names, blurbs and field names, as the web. */
    fun matches(t: ProjectTemplate, query: String): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        val texts = listOf(t.name.en, t.name.id, t.blurb.en, t.blurb.id) + t.fields.flatMap { listOf(it.name.en, it.name.id) }
        return texts.any { it.lowercase().contains(q) }
    }

    fun shown(templates: List<ProjectTemplate>, category: String, query: String): List<ProjectTemplate> =
        templates.filter { (category == "all" || it.category == category) && matches(it, query) }

    /** "Idea → In progress → In review → Published". */
    fun sectionsLine(t: ProjectTemplate, lang: String) = t.sections.joinToString(" → ") { say(it.name, lang) }

    fun fieldsLine(t: ProjectTemplate, lang: String) = t.fields.joinToString(", ") { say(it.name, lang) }

    /** The "Add starter pages" switch is offered only when the template has some. */
    fun hasStarter(t: ProjectTemplate) = t.starterDocs.isNotEmpty() || t.starterTasks > 0

    /** A tab key from the registry as this app's tab; the web-only Table opens List here. */
    fun tab(key: String): ProjectTab? = if (key == "table") ProjectTab.LIST else ProjectTab.entries.firstOrNull { ProjectTabsLogic.key(it) == key }

    /** Where a project built from [t] opens, if that tab is shown. */
    fun openingTab(t: ProjectTemplate, visible: List<ProjectTab>): ProjectTab? = tab(t.defaultTab)?.takeIf { it in visible }

    /** Where the "My …" chip takes the person, if shown. */
    fun myViewTab(t: ProjectTemplate, visible: List<ProjectTab>): ProjectTab? = t.myView?.let { tab(it.tab) }?.takeIf { it in visible }

    /**
     * The template's calendar field among the project's own: found by its name in either language (the
     * project was built in one of them). Renamed, deleted or not a Date field → null, i.e. the due date.
     */
    fun calendarFieldId(t: ProjectTemplate?, fields: List<CustomFieldDef>): String? {
        if (t == null || !t.calendarBy.startsWith("cf:")) return null
        val f = t.fields.firstOrNull { "cf:${it.key}" == t.calendarBy } ?: return null
        return fields.firstOrNull { it.kind == "DATE" && (it.name == f.name.en || it.name == f.name.id) }?.id
    }

    /** What a section can stand for (server SECTION_TASK_STATUSES), in this order after "None". */
    val SECTION_STATUSES = listOf("TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED")

    /** The "My …" chip: only tasks [meId] is assigned to; null = everything. */
    fun mine(lanes: List<Lane>, meId: String?): List<Lane> =
        if (meId == null) lanes else lanes.map { l -> l.copy(tasks = l.tasks.filter { t -> t.assignees.any { (it.userId ?: it.user?.id) == meId } }) }

    /** The day a task sits on in the Calendar: its due date, or the plotted Date field's value. */
    fun plotDate(task: BoardTask, fieldId: String?): LocalDate? =
        if (fieldId == null) dueDate(task.dueDate)
        else dueDate((task.customFieldValues.firstOrNull { it.customFieldId == fieldId }?.value as? JsonPrimitive)?.takeIf { it.isString }?.content)
}

/** The gallery's list, held for 5 minutes like the web's query (the registry changes with a deploy only). */
object ProjectTemplatesCache {
    private const val TTL_MS = 5 * 60_000L
    @Volatile private var held: Pair<Long, List<ProjectTemplate>>? = null

    suspend fun get(api: ProjectsApi, now: Long = System.currentTimeMillis()): List<ProjectTemplate> {
        held?.let { (at, list) -> if (now - at < TTL_MS) return list }
        return api.projectTemplates().also { held = now to it }
    }
}
