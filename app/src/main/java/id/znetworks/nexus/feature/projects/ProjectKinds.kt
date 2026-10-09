package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.R
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

// Project types, per-project tabs, Finance opt-in, named icons (Berlin, 9 Oct; PROJECT-TYPES-TABS, server 12db577/76d1ae4).

object ProjectTabsLogic {
    /** The server's tab keys, in tab-bar order. "table" is web-only: never drawn here, kept when saving. */
    val KEYS = listOf("overview", "board", "list", "table", "sheet", "calendar", "timeline", "sprints", "automations", "pages", "forms", "chat")

    fun key(t: ProjectTab): String? = when (t) {
        ProjectTab.OVERVIEW -> "overview"; ProjectTab.BOARD -> "board"; ProjectTab.LIST -> "list"; ProjectTab.SHEET -> "sheet"
        ProjectTab.CALENDAR -> "calendar"; ProjectTab.TIMELINE -> "timeline"; ProjectTab.SPRINTS -> "sprints"
        ProjectTab.AUTOMATIONS -> "automations"; ProjectTab.PAGES -> "pages"; ProjectTab.FORMS -> "forms"; ProjectTab.CHAT -> "chat"
        ProjectTab.FINANCE, ProjectTab.PNL -> null // flags, not tab keys
        ProjectTab.PIPELINE -> null // the project's type, not a tab key
    }

    /** `hiddenTabs` read leniently: anything but a list of strings hides nothing. */
    fun hidden(raw: JsonElement?): Set<String> =
        (raw as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }?.toSet() ?: emptySet()

    /** `financeEnabled`; an older server (no field) keeps the old rule: the name says "finance". */
    fun financeOn(raw: JsonElement?, name: String?): Boolean =
        (raw as? JsonPrimitive)?.booleanOrNull ?: name.orEmpty().contains("finance", ignoreCase = true)

    /**
     * [isPipeline]: a Pipeline Dashboard shows Pipeline, Chat, and Finance / P&L when on — none of the task tabs
     * (its default task sections stay on the server only so older apps open it as an empty task project).
     */
    fun visible(hidden: Set<String>, financeOn: Boolean, pnlOn: Boolean, isBoD: Boolean, isPipeline: Boolean = false): List<ProjectTab> = ProjectTab.entries.filter {
        when (it) {
            ProjectTab.PIPELINE -> isPipeline
            ProjectTab.FINANCE -> financeOn
            ProjectTab.PNL -> pnlOn && isBoD
            ProjectTab.CHAT -> key(it) !in hidden
            else -> !isPipeline && key(it) !in hidden
        }
    }

    /** The open tab hidden (a refresh, another device): Board, else List, else the first one shown. */
    fun fallback(current: ProjectTab, visible: List<ProjectTab>): ProjectTab = when {
        current in visible -> current
        ProjectTab.PIPELINE in visible -> ProjectTab.PIPELINE
        ProjectTab.BOARD in visible -> ProjectTab.BOARD
        ProjectTab.LIST in visible -> ProjectTab.LIST
        else -> visible.firstOrNull() ?: ProjectTab.BOARD
    }

    /** Board or List stays on: the last visible of the two can't be switched off. */
    fun locked(key: String, hidden: Set<String>) = (key == "board" && "list" in hidden) || (key == "list" && "board" in hidden)

    /** The WHOLE hidden set after one switch, in tab-bar order, unknown keys kept (at the end). */
    fun toggle(hidden: Set<String>, key: String, show: Boolean): List<String> {
        val next = if (show) hidden - key else hidden + key
        return KEYS.filter { it in next } + next.filter { it !in KEYS }.sorted()
    }
}

/** The four project types (only TASK is built). Names stay English in both languages. */
enum class ProjectType(val code: String, val title: String, val description: Int, val ready: Boolean) {
    TASK("TASK", "Task Project", R.string.pt_task_sub, true),
    FINANCE("FINANCE", "Finance Dashboard", R.string.pt_finance_sub, false),
    CONTENT("CONTENT", "Content Planner", R.string.pt_content_sub, false),
    PIPELINE("PIPELINE", "Pipeline Dashboard", R.string.pt_pipeline_sub, true),
}

object ProjectIcon {
    private val NAMES = mapOf(
        "folder" to "📁", "rocket" to "🚀", "star" to "⭐", "zap" to "⚡", "target" to "🎯", "briefcase" to "💼", "code" to "💻",
        "globe" to "🌍", "heart" to "❤️", "shield" to "🛡️", "layers" to "📚", "box" to "📦", "cpu" to "🔧", "database" to "🗄️",
        "feather" to "✏️", "flag" to "🏁", "megaphone" to "📢", "grid" to "🔲",
    )

    /** True for an uploaded picture (`/api/files/…`). */
    fun isPicture(icon: String?) = icon?.startsWith("/") == true

    /**
     * The emoji to draw: a value starting with a non-ASCII character is the emoji itself; a name
     * ("briefcase") is looked up, any other name is 📁; a picture or nothing is null.
     */
    fun emoji(icon: String?): String? {
        val v = icon?.trim()?.takeIf { it.isNotEmpty() && !isPicture(it) } ?: return null
        if (v.first().code > 127) return v
        return NAMES[v.lowercase()] ?: "📁"
    }
}
