package id.znetworks.nexus.core.nav

import id.znetworks.nexus.core.net.NexusConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.net.URLDecoder

/** Where a link, a push or an inbox row wants to go (API.md §3.3, PRD §4.6). */
sealed interface Target {
    /** The Attendance screen, optionally focused on one request / offsite check-out, or the permit composer. */
    data class Attendance(val requestId: String? = null, val offsiteId: String? = null, val permitToday: Boolean = false) : Target
    data object Inbox : Target
    /** A top-level tab by route ("tasks", "projects"). */
    data class Tab(val route: String) : Target
    data class Project(val id: String) : Target
    data class Task(val id: String) : Target
    data class Announcement(val id: String) : Target
    data object Settings : Target
    /** A screen Android does not have yet: opened on the web instead of doing nothing. */
    data class Web(val path: String) : Target
    /** Not a NEXUS page: opened outside the app. */
    data class External(val url: String) : Target
}

object Links {
    /**
     * Push/inbox precedence (iOS AppRouter.openNotification): taskId → projectId → http link →
     * link path → keyword fallback on `type`, finally Inbox. Unknown types never break routing.
     */
    fun forNotification(type: String?, link: String?, taskId: String?, projectId: String?): Target {
        if (!taskId.isNullOrBlank()) return Target.Task(taskId)
        if (!projectId.isNullOrBlank()) return Target.Project(projectId)
        if (!link.isNullOrBlank()) {
            parse(link)?.let { return it }
        }
        val t = type.orEmpty().lowercase()
        return when {
            "attendance" in t || "offsite" in t || "checkout" in t -> Target.Attendance()
            "announcement" in t -> Target.Web("/dashboard")
            "message" in t -> Target.Web("/messages")
            "complaint" in t -> Target.Web("/complaints")
            else -> Target.Inbox
        }
    }

    /** A `link` path, a NEXUS URL, a `nexus://` URL, or anything external. Null = not understood. */
    fun parse(raw: String): Target? {
        val link = raw.trim()
        if (link.isEmpty()) return null
        if (link.startsWith("nexus://", ignoreCase = true)) return parseScheme(link)
        if (link.startsWith("http://", true) || link.startsWith("https://", true)) {
            val uri = runCatching { URI(link) }.getOrNull() ?: return Target.External(link)
            if (!NexusConfig.isNexusHost(uri.host)) return Target.External(link)
            return parsePath(uri.rawPath.orEmpty(), uri.rawQuery)
        }
        val path = link.substringBefore('?').substringBefore('#')
        val query = link.substringAfter('?', "").substringBefore('#').takeIf { '?' in link }
        return parsePath(path, query)
    }

    private fun parseScheme(link: String): Target? {
        // nexus://attendance?request=… → host is the screen.
        val rest = link.substringAfter("://")
        val screen = rest.substringBefore('?').substringBefore('/').lowercase()
        val query = rest.substringAfter('?', "").takeIf { '?' in rest }
        return parsePath("/$screen", query)
    }

    private fun parsePath(path: String, query: String?): Target? {
        val q = queryMap(query)
        val p = path.trimEnd('/').lowercase().ifEmpty { "/" }
        return when {
            p == "/attendance" -> when {
                q["request"] != null -> Target.Attendance(requestId = q["request"])
                q["offsite"] != null -> Target.Attendance(offsiteId = q["offsite"])
                q["permit"] == "today" -> Target.Attendance(permitToday = true)
                else -> Target.Attendance()
            }
            p == "/inbox" -> Target.Inbox
            p == "/projects" -> Target.Tab("projects")
            p == "/tasks" || p == "/my-tasks" -> Target.Tab("tasks")
            // The deeper id wins: /projects/<p>/tasks/<t> is the task.
            Regex("^/projects/[^/]+/tasks/([^/]+)$").matches(p) -> Target.Task(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/tasks/([^/]+)$").matches(p) -> Target.Task(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/projects/([^/]+)$").matches(p) -> Target.Project(path.trimEnd('/').substringAfterLast('/'))
            p == "/dashboard" && q["announcement"] != null -> Target.Announcement(q["announcement"]!!)
            p == "/settings" -> Target.Settings
            // Everything else exists on the web: open it there rather than landing nowhere.
            else -> Target.Web(path + (query?.let { "?$it" } ?: ""))
        }
    }

    private fun queryMap(query: String?): Map<String, String> = query.orEmpty().split('&').mapNotNull { kv ->
        val k = kv.substringBefore('=')
        if (k.isEmpty()) null else k to URLDecoder.decode(kv.substringAfter('=', "").replace("+", "%20"), "UTF-8")
    }.toMap()
}

/**
 * Holds a target until its screen claims it, across a cold start and a sign-in (API.md §3.3:
 * "a focus target is held until its screen claims it").
 */
class Router {
    private val _pending = MutableStateFlow<Target?>(null)
    val pending: StateFlow<Target?> = _pending.asStateFlow()

    fun open(t: Target) {
        _pending.value = t
    }

    /** The screen took it. Only clears if nothing newer arrived meanwhile. */
    fun consumed(t: Target) {
        _pending.compareAndSet(t, null)
    }
}
