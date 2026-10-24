package id.znetworks.nexus.feature.calendar.widget

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.calendar.CalGlance
import id.znetworks.nexus.feature.calendar.GlanceScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.io.File

/** One scope's /api/calendar/glance answer as the widgets read it: who it belongs to and when it was saved. */
@Serializable
data class SavedGlance(val savedAt: Long, val userId: String, val snapshot: CalGlance)

/**
 * The three glance snapshots (me / division / all) the calendar widgets draw from (plan 4.2, rule 10.x
 * "widget data"). One JSON file per scope in app-private storage, written tmp + rename.
 *
 * - [refresh] asks only the scopes the placed widgets use ([scopes]; none placed = no request at all,
 *   audit #20); never saves a snapshot whose userId is not the signed-in person's (a sign-out landing
 *   during the request), and skips when the last pass was under 5 minutes ago unless forced. Scopes no
 *   widget uses any more are deleted.
 * - [clear] (sign-out, `flags.calendarWidgets == false`) deletes all three: no previous person's tasks
 *   survive on a phone handed over.
 * - [load] re-checks the owner on every read, so a file left by somebody else is never drawn.
 *
 * [changed] runs after anything that changes what a widget would draw (update every widget, schedule
 * the next redraw).
 */
class CalendarSnapshots(
    private val dir: File,
    private val fetch: suspend (GlanceScope) -> CalGlance,
    private val currentUserId: () -> String?,
    private val widgetsOn: () -> Boolean,
    private val changed: suspend () -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    /** The scopes the widgets on the home screen show; empty when none is placed. */
    private val scopes: suspend () -> Set<GlanceScope> = { GlanceScope.entries.toSet() },
) {
    private val lock = Mutex()
    @Volatile private var lastPass = 0L
    private val _revision = MutableStateFlow(0L)
    /** Live Glance sessions observe this as well as auth: updateAll does not restart provideGlance. */
    val revision = _revision.asStateFlow()

    /** Also invalidated for clock, language and per-widget scope changes without a new snapshot. */
    fun invalidate() { _revision.update { it + 1 } }

    private fun file(scope: GlanceScope) = File(dir, "${scope.wire}.json")

    fun load(scope: GlanceScope): SavedGlance? {
        val me = currentUserId() ?: return null
        if (!widgetsOn()) return null
        val saved = runCatching { NexusJson.decodeFromString(SavedGlance.serializer(), file(scope).readText()) }.getOrNull() ?: return null
        return saved.takeIf { it.userId == me && it.snapshot.userId == me && currentUserId() == me && widgetsOn() }
    }

    /** What [refresh] did, for tests and logs. */
    enum class Pass { SAVED, THROTTLED, SIGNED_OUT, DISABLED, FAILED, NO_WIDGETS }

    suspend fun refresh(force: Boolean = false): Pass {
        val result = lock.withLock {
            val me = currentUserId() ?: return@withLock Pass.SIGNED_OUT.also { wipe() }
            if (!widgetsOn()) return@withLock Pass.DISABLED.also { wipe() }
            val wanted = scopes()
            // Scopes no widget shows any more are not kept.
            val removed = GlanceScope.entries.filter { it !in wanted }.map { file(it).delete() }.any { it }
            if (removed) invalidate()
            if (wanted.isEmpty()) return@withLock Pass.NO_WIDGETS
            if (!force && now() - lastPass < THROTTLE_MS) return@withLock Pass.THROTTLED
            lastPass = now()
            var any = false
            for (scope in GlanceScope.entries.filter { it in wanted }) {
                val s = runCatching { fetch(scope) }.getOrNull() ?: continue
                // The person may have signed out (or another signed in) while the request was out.
                if (s.userId != me || currentUserId() != me) continue
                write(scope, SavedGlance(now(), me, s))
                any = true
            }
            if (any) { invalidate(); Pass.SAVED } else Pass.FAILED
        }
        if (result != Pass.THROTTLED && result != Pass.NO_WIDGETS) changed()
        return result
    }

    suspend fun clear() {
        lock.withLock { wipe(); lastPass = 0L }
        changed()
    }

    /** Synchronous delete, for the sign-out listener: the files go before anything else runs. */
    fun wipe() { GlanceScope.entries.forEach { file(it).delete() }; invalidate() }

    private fun write(scope: GlanceScope, saved: SavedGlance) {
        dir.mkdirs()
        val tmp = File(dir, "${scope.wire}.json.tmp")
        tmp.writeText(NexusJson.encodeToString(SavedGlance.serializer(), saved))
        if (!tmp.renameTo(file(scope))) { file(scope).delete(); tmp.renameTo(file(scope)) }
    }

    companion object {
        const val THROTTLE_MS = 5 * 60_000L
    }
}
