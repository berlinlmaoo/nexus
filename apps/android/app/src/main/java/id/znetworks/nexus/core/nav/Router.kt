package id.znetworks.nexus.core.nav

import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.feature.legal.LegalLogic
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.net.URLDecoder

/** Where a link, a push or an inbox row wants to go (API.md §3.3, PRD §4.6). */
sealed interface Target {
    data object Gideon : Target
    data object GideonMemory : Target
    /** The Attendance screen, optionally focused on one request / offsite check-out, or the permit composer. */
    data class Attendance(val requestId: String? = null, val offsiteId: String? = null, val permitToday: Boolean = false) : Target
    data object Inbox : Target
    data object Reminders : Target
    data class Meetings(val projectId: String? = null) : Target
    data class Meeting(val id: String) : Target
    data class NewMeeting(val projectId: String? = null) : Target
    /** A top-level tab by route ("tasks", "projects"). */
    data class Tab(val route: String) : Target
    /** [view]: a link's `?view=` (board, list, table, calendar, timeline, overview, forms…). */
    data class Project(val id: String, val view: String? = null, val date: String? = null) : Target
    data class Task(val id: String) : Target
    /** Messages: the list, or one conversation. */
    data class Chat(val conversationId: String?) : Target
    /** The company feed, optionally one post (its comments). */
    data class Threads(val postId: String?) : Target
    /** Tickets to the BoD, optionally one ticket. */
    data class Tickets(val ticketId: String?) : Target
    /** A form to fill (`/f/<slug-or-id>`), or my submissions ([legalId]: one of my Legal requests, `?legal=`). */
    data class Form(val idOrSlug: String) : Target
    data class Submissions(val submissionId: String?, val legalId: String? = null) : Target
    /** Legal (invitation only): a tab (`?tab=requests`), a request on the board, or a document. */
    data class Legal(val tab: String? = null, val requestId: String? = null, val docId: String? = null) : Target
    /** A Legal request link (`/f/legal-<24 letters/digits>`): the request form, not a project form. */
    data class LegalRequestForm(val linkId: String) : Target
    /** The Knowledge Library, or one doc. */
    data class Docs(val docId: String?) : Target
    /** Z Vault (a folder), and a `/v/<slug>` share link (members only). `/s/` is never claimed. */
    data class Vault(val folderId: String?, val itemId: String? = null) : Target
    data class VaultShare(val slug: String) : Target
    /** Reports: mine / my team, or one person's. */
    data class Reports(val userId: String?) : Target
    data object Leaderboard : Target
    data class Profile(val userId: String) : Target
    data object RoomBooking : Target
    /** The master Calendar (replaces Team Calendar): `/calendar?date=&view=&lens=&focus=&scope=&task=`. */
    data class Calendar(val date: String? = null, val view: String? = null, val lens: String? = null, val focus: String? = null, val scope: String? = null, val task: String? = null, val q: String? = null, val folder: String? = null, val unit: String? = null, val person: String? = null, val project: String? = null, val prio: String? = null, val done: String? = null, val overdue: String? = null) : Target
    /** Control Room (manager and above). */
    data object Admin : Target
    data object GideonPerformance : Target
    data class Announcement(val id: String) : Target
    data object Settings : Target
    /** Signed-out screens: the invite email's "set your password" link and a sign-up with a workspace code. */
    /** [invited]: the invite email's "set your password" link (`invited=1`), not a forgotten one. */
    data class ResetPassword(val email: String?, val invited: Boolean = false) : Target
    data class Register(val workspaceCode: String?) : Target
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
    fun forNotification(type: String?, link: String?, taskId: String?, projectId: String?, meetingId: String? = null): Target {
        if (!meetingId.isNullOrBlank()) return Target.Meeting(meetingId)
        if (type?.startsWith("meeting_notes_") == true && !link.isNullOrBlank()) parse(link)?.let { return it }
        if (!taskId.isNullOrBlank()) return Target.Task(taskId)
        if (!projectId.isNullOrBlank()) return Target.Project(projectId)
        if (!link.isNullOrBlank()) {
            parse(link)?.let { return it }
        }
        val t = type.orEmpty().lowercase()
        return when {
            "attendance" in t || "offsite" in t || "checkout" in t -> Target.Attendance()
            "announcement" in t -> Target.Tab("home")
            "message" in t -> Target.Chat(null)
            "complaint" in t -> Target.Tickets(null)
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
        val rest = link.substringAfter("://").substringBefore('#')
        val screen = rest.substringBefore('?').substringBefore('/').lowercase()
        val query = rest.substringAfter('?', "").takeIf { '?' in rest }
        // nexus://projects/<id>?view=board (iOS TourDriver routes): the project, on that view.
        val sub = rest.substringBefore('?').substringAfter('/', "").trimEnd('/')
        if (screen == "projects" && sub.isNotEmpty() && '/' !in sub) return Target.Project(sub, queryMap(query)["view"], queryMap(query)["date"])
        if (screen in setOf("meetings", "folders", "people") && sub.isNotEmpty() && '/' !in sub) return parsePath("/$screen/$sub", query)
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
            Regex("^/projects/([^/]+)$").matches(p) -> Target.Project(path.trimEnd('/').substringAfterLast('/'), q["v"] ?: q["view"], q["date"])
            p == "/dashboard" && q["announcement"] != null -> Target.Announcement(q["announcement"]!!)
            p == "/dashboard" -> Target.Tab("home")
            Regex("^/people/([^/]+)$").matches(p) -> Target.Profile(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/folders/([^/]+)$").matches(p) -> Target.Calendar(date = q["date"], folder = path.trimEnd('/').substringAfterLast('/'))
            p == "/settings" -> if (q["section"] == "gideon-memory") Target.GideonMemory else Target.Settings
            p == "/gideon" -> Target.Gideon
            p == "/messages" -> Target.Chat(q["c"])
            p == "/threads" || p == "/social" -> Target.Threads(q["post"])
            p == "/complaints" -> Target.Tickets(q["id"] ?: q["c"])
            Regex("^/f/([^/]+)$").matches(p) -> path.trimEnd('/').substringAfterLast('/').let { slug ->
                if (LegalLogic.isRequestLinkId(slug)) Target.LegalRequestForm(slug) else Target.Form(slug)
            }
            p == "/submissions" -> Target.Submissions(q["id"], q["legal"])
            p == "/legal" -> Target.Legal(q["tab"], q["request"], q["doc"])
            p == "/docs" -> Target.Docs(null)
            p == "/vault" -> Target.Vault(q["folder"] ?: q["id"], q["item"]?.takeIf { it.isNotBlank() })
            p == "/reports" -> Target.Reports(null)
            p == "/leaderboard" -> Target.Leaderboard
            p == "/room-booking" -> Target.RoomBooking
            p == "/calendar" -> Target.Calendar(q["date"], q["view"], q["lens"], q["focus"], q["scope"], q["task"], q["q"], q["folder"], q["unit"], q["person"], q["project"], q["prio"], q["done"], q["overdue"])
            // The old page: a booking link goes to Room booking, anything else to the Calendar (web aa9ecdc).
            p == "/master-calendar" -> if (q["booking"] != null) Target.RoomBooking else Target.Calendar(q["date"])
            p == "/admin" -> if (q["tab"] == "gideon" && q["gideon"] == "performance") Target.GideonPerformance else Target.Admin
            p == "/reminders" -> Target.Reminders
            p == "/meetings" -> Target.Meetings(q["projectId"])
            p == "/meetings/new" -> Target.NewMeeting(q["projectId"])
            Regex("^/meetings/([^/]+)$").matches(p) -> Target.Meeting(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/reports/([^/]+)$").matches(p) -> Target.Reports(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/v/([^/]+)$").matches(p) -> Target.VaultShare(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/docs/([^/]+)$").matches(p) -> Target.Docs(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/complaints/([^/]+)$").matches(p) -> Target.Tickets(path.trimEnd('/').substringAfterLast('/'))
            Regex("^/messages/([^/]+)$").matches(p) -> Target.Chat(path.trimEnd('/').substringAfterLast('/'))
            p == "/forgot-password" -> Target.ResetPassword(q["email"], invited = q["invited"] == "1" || q["invited"].equals("true", ignoreCase = true))
            p == "/register" -> Target.Register(q["code"])
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
