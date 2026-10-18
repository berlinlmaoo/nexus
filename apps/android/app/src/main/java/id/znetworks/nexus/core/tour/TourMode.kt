package id.znetworks.nexus.core.tour

import android.content.Intent
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app's half of the Android UI tour (scripts/ui-tour-android.sh; iOS TourDriver.swift, docs/UI-TOUR.md).
 * DEBUG builds only. The script relaunches the app once per step with intent extras:
 *
 *   --es nexusTour 1                           the tour is driving; nothing here happens without it
 *   --es nexusServer dev                       this tour talks to the DEV server
 *   --es nexusTourStep signout|login|screen    what this launch is for
 *   --es nexusTourScreen <id>                  a screen id from scripts/ui-tour-screens-android.json
 *   --es nexusTourEmail / nexusTourPassword    the QA account (login step only; from the Mac's Keychain)
 *   --es nexusTourProject / nexusTourForm      the project / form the project screens open
 *
 * and reads back how it went from logcat lines tagged NEXUS_TOUR ("status=…"). Nothing is tapped to get
 * anywhere: every screen is opened by its navigation route.
 */
object TourMode {
    const val TAG = "NEXUS_TOUR"

    @Volatile var active = false
        private set
    var step: String = "screen"; private set
    var screen: String? = null; private set
    var email: String? = null; private set
    var password: String? = null; private set
    var wantsDev = false; private set
    private var project: String? = null
    private var form: String? = null

    /** The screen the shell should open (a navigation route + the id it is for). */
    data class Go(val id: String, val route: String, val tab: Boolean)
    private val _go = MutableStateFlow<Go?>(null)
    val go: StateFlow<Go?> = _go.asStateFlow()

    fun read(intent: Intent?, debug: Boolean) {
        if (!debug || intent?.getStringExtra("nexusTour") != "1") return
        active = true
        step = intent.getStringExtra("nexusTourStep") ?: "screen"
        screen = intent.getStringExtra("nexusTourScreen")
        email = intent.getStringExtra("nexusTourEmail")
        password = intent.getStringExtra("nexusTourPassword")
        wantsDev = intent.getStringExtra("nexusServer") == "dev"
        project = intent.getStringExtra("nexusTourProject")
        form = intent.getStringExtra("nexusTourForm")
        if (step == "screen") screen?.let { id ->
            val route = intent.getStringExtra("nexusTourRoute")?.let { it to false } ?: routeFor(id, project, form)
            route?.let { _go.value = Go(id, it.first, it.second) } ?: status("unknown-screen $id")
        }
    }

    fun consumed() { _go.value = null }

    fun status(s: String) = Log.i(TAG, "status=$s")

    /** The tour's screen ids (same as iOS scripts/ui-tour-screens.json) → Android route, and whether it is a bottom-bar tab. */
    fun routeFor(id: String, project: String?, form: String?): Pair<String, Boolean>? {
        val p = project.orEmpty()
        return when (id) {
            "dashboard" -> "home" to true
            "my-tasks" -> "tasks" to false
            "calendar" -> "calendar" to true
            "messages" -> "messages" to true
            "gideon" -> "gideon" to false
            "notifications" -> "inbox" to false
            "threads" -> "threads" to false
            "vault" -> "vault?folder=&trash=" to false
            "submissions" -> "submissions" to false
            "room-booking" -> "rooms" to false
            "projects" -> "projects" to true
            "project-templates" -> "projects" to true
            "outlet-overview", "outlet-calendar", "outlet-day", "outlet-settings" ->
                if (p.isEmpty()) null else "project/$p?view=${if (id == "outlet-overview" || id == "outlet-settings") "overview" else "calendar"}" to false
            "legal-archive" -> "legal?tab=documents" to false
            "legal-templates" -> "legal?tab=templates" to false
            "legal-requests" -> "legal?tab=requests" to false
            "legal-settings" -> "legal?tab=settings" to false
            "project-overview", "project-board", "project-list", "project-table", "project-calendar", "project-timeline", "project-sheet" ->
                if (p.isEmpty()) null else "project/$p?view=${id.removePrefix("project-")}" to false
            "form-builder" -> if (p.isEmpty() || form.isNullOrEmpty()) null else "form-builder/$p?form=$form" to false
            "leaderboard" -> "leaderboard" to false
            "attendance" -> "attendance" to false
            "tickets" -> "tickets" to false
            "settings" -> "account" to false
            "settings-security" -> "account" to false
            "more" -> "more" to true
            else -> null
        }
    }
}
