package id.znetworks.nexus.feature.calendar

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant

enum class CalView { MONTH, PEOPLE }
enum class CalLens { DIVISION, PERSON }

/** What opening a task leads to. Masked rows are never opened (decision 1). */
sealed interface CalOpen {
    data class Edit(val taskId: String) : CalOpen
    data class Preview(val taskId: String, val projectName: String?) : CalOpen
    data object Masked : CalOpen
    /** The server says there is no such task for this person (deleted, moved out of reach). */
    data object Gone : CalOpen
    /** Could not ask (offline, server down): the reason with Retry, never "not found" (audit 2 #25). */
    data class Offline(val taskId: String) : CalOpen
}

/** Everything the Calendar screen draws from (one source; the screen only arranges it). */
data class CalState(
    val structure: CalStructure? = null,
    /** Items of the range on screen (month grid, or the week in People). */
    val items: CalItems? = null,
    val overdue: List<CalItem> = emptyList(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
    val day: String = OfficeTime.today().toString(),
    val view: CalView = CalView.MONTH,
    val lens: CalLens = CalLens.DIVISION,
    /** The unit zoomed into; null = the top of the Bagan. */
    val focusId: String? = null,
    val filters: CalendarCore.Filters = CalendarCore.NO_FILTERS,
    val collapsed: Set<String> = emptySet(),
    val opening: CalOpen? = null,
    /** The range [items] answers for. Dots and "no tasks" are only true of this range (audit P1). */
    val itemsRange: Pair<String, String>? = null,
    /** When [items] was last loaded (WIB clock in "Data as of 14.05"). */
    val loadedAt: Long? = null,
    /** What is on screen is not confirmed by the server right now (from the disk cache, or the last refresh failed). */
    val offline: Boolean = false,
    /** The range on screen failed to load: the reason, with Try again. */
    val rangeError: String? = null,
    /** Bumped when a refresh of data already on screen fails: one snackbar each time. */
    val refreshFailures: Int = 0,
    /** "My division" was asked for by someone without a Bagan card: shown as Mine, with the note (contract 3). */
    val divisionFallback: Boolean = false,
    /** Bumped when the person asks to see a day (a cell, Today, the day arrows): the screen brings its tasks into view and focus (audit 2 #3, #12). */
    val dayRequests: Int = 0,
    /** The overdue rail shows all its rows. */
    val railAll: Boolean = false,
    /** The person has used focus once: the hint under the legend has done its job (audit 2 #12). */
    val hintSeen: Boolean = false,
    val itemsFolder: String? = null,
) {
    /** [items] belongs to the range on screen; otherwise it is loading or failed, never "empty". */
    val folderKey get() = CalendarCore.folderKey(filters.folders)
    val current get() = items != null && itemsRange == range && itemsFolder == folderKey
    val access get() = items?.accessLevel ?: structure?.accessLevel
    /** The server's today (WIB) once it answered; the phone's office day before that. */
    val today get() = items?.today ?: OfficeTime.today().toString()
    val nowMs get() = items?.nowInstant()?.toEpochMilli() ?: Instant.now().toEpochMilli()
    val windowDays get() = items?.rulesOrDefault?.overdueWindowDays ?: 14
    /**
     * The day on screen; [reveal] (the person asked for it: cell, Today, day arrows) counts a request even
     * when that day is already selected, so Today and a second tap still bring its tasks into view.
     */
    fun withDay(day: String, reveal: Boolean) = copy(day = day, dayRequests = if (reveal) dayRequests + 1 else dayRequests)

    /** The days asked from /items: the 6-week grid of the month, or the Monday–Sunday week in People. */
    val range: Pair<String, String> get() = if (view == CalView.PEOPLE) CalendarCore.mondayOf(day).let { it to CalendarCore.addDays(it, 6) } else CalendarCore.gridRange(day)
}

/** Remembered per device (rule: filters and collapsed sections survive a restart). */
@Serializable private data class Saved(
    val scope: String = "ALL", val units: List<String> = emptyList(), val people: List<String> = emptyList(), val projects: List<String> = emptyList(),
    val priorities: List<String> = emptyList(), val hideDone: Boolean = false, val overdueOnly: Boolean = false, val collapsed: List<String> = emptyList(),
    val folders: List<String> = emptyList(),
)

/**
 * The last structure and items per range on disk (audit #21): the Calendar paints them at once on a cold
 * open or offline, marked "Updated 14.05", and refreshes in place. Per user, under cacheDir/calendar
 * (SignOutFiles: deleted at sign-out).
 */
class CalendarDiskCache(private val root: File) {
    @Serializable data class Entry<T>(val savedAt: Long, val value: T)

    private fun dir(userId: String) = File(root, userId.filter { it.isLetterOrDigit() || it == '_' || it == '-' })
    private fun <T> write(file: File, value: T, ser: KSerializer<T>, now: Long) = runCatching {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(NexusJson.encodeToString(Entry.serializer(ser), Entry(now, value)))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }
    private fun <T> read(file: File, ser: KSerializer<T>): Entry<T>? =
        runCatching { NexusJson.decodeFromString(Entry.serializer(ser), file.readText()) }.getOrNull()

    fun saveStructure(userId: String, s: CalStructure, now: Long = System.currentTimeMillis()) { write(File(dir(userId), "structure.json"), s, CalStructure.serializer(), now) }
    fun structure(userId: String): Entry<CalStructure>? = read(File(dir(userId), "structure.json"), CalStructure.serializer())
    private fun itemsFile(userId: String, range: Pair<String, String>, folder: String?): File {
        val suffix = folder?.let { "-" + java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }.orEmpty()
        return File(dir(userId), "items-${range.first}-${range.second}$suffix.json")
    }
    fun saveItems(userId: String, range: Pair<String, String>, items: CalItems, now: Long = System.currentTimeMillis(), folder: String? = null) {
        write(itemsFile(userId, range, folder), items, CalItems.serializer(), now)
        // Keep the 6 ranges looked at last.
        dir(userId).listFiles { f -> f.name.startsWith("items-") && f.name.endsWith(".json") }?.sortedByDescending { it.lastModified() }?.drop(6)?.forEach { it.delete() }
    }
    fun items(userId: String, range: Pair<String, String>, folder: String? = null): Entry<CalItems>? = read(itemsFile(userId, range, folder), CalItems.serializer())
}

/**
 * The Calendar (master calendar, phase 3; web d867ae2 + aa9ecdc). Data: /api/calendar/structure, /items
 * for the range on screen and /overdue for today's rail, each with If-None-Match (CalendarApi) so polling
 * every `calendarPollSeconds` while visible costs a header. The structure is fetched again whenever an
 * items answer names another `structureVersion`. Structure + items paint as soon as they arrive; /overdue
 * runs beside them and only when today is in the range (audit #21).
 */
class CalendarViewModel(app: Application, private val handle: SavedStateHandle) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = c.calendar
    private val res = app.resources
    private val prefs = app.getSharedPreferences("nexus.calendar", Context.MODE_PRIVATE)
    private val cache = CalendarDiskCache(File(app.cacheDir, "calendar"))
    private val _state = MutableStateFlow(CalState())
    val state: StateFlow<CalState> = _state.asStateFlow()
    private val lock = Mutex()
    private val linkGate = CalendarLinkGate(handle)
    /** A failed background poll says so once; a pull always does. Reset by a success. */
    private var failedSinceSuccess = false
    /** The structure on screen came from disk: ask the server for it on the next pass. */
    private var structureFromDisk = false
    /** When the server last confirmed what is on screen (a 304 counts), for "Data as of 14.05". */
    private var confirmedAt: Long? = null

    init {
        val saved = runCatching { NexusJson.decodeFromString(Saved.serializer(), prefs.getString("saved", null) ?: "{}") }.getOrDefault(Saved())
        _state.update {
            it.copy(filters = CalendarCore.Filters(runCatching { CalendarCore.Scope.valueOf(saved.scope) }.getOrDefault(CalendarCore.Scope.ALL),
                saved.units, saved.people, saved.projects, saved.priorities, saved.hideDone, saved.overdueOnly, saved.folders), collapsed = saved.collapsed.toSet(),
                // Zoom, day, view and lens survive rotation and process death (audit #32).
                focusId = handle.get<String>(FOCUS), day = handle.get<String>(DAY) ?: it.day,
                view = handle.get<String>(VIEW)?.let { v -> runCatching { CalView.valueOf(v) }.getOrNull() } ?: it.view,
                lens = handle.get<String>(LENS)?.let { v -> runCatching { CalLens.valueOf(v) }.getOrNull() } ?: it.lens,
                hintSeen = prefs.getBoolean("hintSeen", false))
        }
    }

    private fun save() {
        val s = _state.value
        val f = s.filters
        runCatching {
            prefs.edit().putString("saved", NexusJson.encodeToString(Saved.serializer(),
                Saved(f.scope.name, f.units, f.people, f.projects, f.priorities, f.hideDone, f.overdueOnly, s.collapsed.toList(), f.folders))).apply()
        }
    }

    private fun keep() {
        val s = _state.value
        handle[FOCUS] = s.focusId; handle[DAY] = s.day; handle[VIEW] = s.view.name; handle[LENS] = s.lens.name
    }

    /**
     * Deep link / arguments: `?date=&view=people&lens=person&focus=&scope=&task=&n=`. Applied ONCE per
     * back-stack entry (audit P0): coming back from the task, rotating, or the process being restored
     * must not open the task again, or Back could never leave it. A new link carries a new `n`.
     */
    fun applyLink(date: String?, view: String?, lens: String?, focus: String?, scope: String?, task: String?, nonce: String? = null,
                  folder: String? = null, unit: String? = null, person: String? = null, project: String? = null, prio: String? = null, done: String? = null, overdue: String? = null) {
        if (!linkGate.take(CalendarLinkGate.key(date, view, lens, focus, scope, task, nonce, folder, unit, person, project, prio, done, overdue))) return
        _state.update { s ->
            s.copy(
                day = date?.takeIf(CalDays::isDayKey) ?: s.day,
                view = if (view == "people") CalView.PEOPLE else if (view != null) CalView.MONTH else s.view,
                lens = if (lens == "person") CalLens.PERSON else if (lens != null) CalLens.DIVISION else s.lens,
                focusId = focus ?: s.focusId,
                divisionFallback = if (scope != null) scope == "division" && s.structure?.me?.homeUnitIds?.isEmpty() == true else s.divisionFallback,
                filters = (when (scope) {
                    "me" -> s.filters.copy(scope = CalendarCore.Scope.ME)
                    // Without a Bagan card this becomes Mine with the note (settleScope, contract 3).
                    "division" -> s.filters.copy(scope = if (s.structure?.me?.homeUnitIds?.isEmpty() == true) CalendarCore.Scope.ME else CalendarCore.Scope.DIVISION)
                    // A widget on "Everyone" opens everyone (audit #33).
                    "all" -> s.filters.copy(scope = CalendarCore.Scope.ALL)
                    else -> s.filters
                }).let { f -> f.copy(folders = folder?.let(CalendarCore::linkIds) ?: f.folders,
                    units = unit?.let(CalendarCore::linkIds) ?: f.units, people = person?.let(CalendarCore::linkIds) ?: f.people,
                    projects = project?.let(CalendarCore::linkIds) ?: f.projects, priorities = prio?.let(CalendarCore::linkIds) ?: f.priorities,
                    hideDone = done?.let { it == "0" } ?: f.hideDone, overdueOnly = overdue?.let { it == "1" } ?: f.overdueOnly) },
                overdue = if (folder != null) emptyList() else s.overdue,
            )
        }
        if (listOf(scope, folder, unit, person, project, prio, done, overdue).any { it != null }) save()
        keep()
        val loading = refresh()
        // The task is looked up after the cache and the first answer, so a task already on the phone opens (audit 2 #25).
        if (task != null) viewModelScope.launch { loading.join(); openById(task) }
    }

    /** On show, on foreground, on pull, and every poll interval while visible. */
    fun refresh(pulled: Boolean = false) = viewModelScope.launch {
        lock.withLock {
            if (pulled) _state.update { it.copy(refreshing = true) }
            val uid = c.sessionStore.current?.userId
            val asked = _state.value.range
            val askedFolder = _state.value.folderKey
            // Cold open, or a range not loaded this session: what the disk has, at once.
            if (uid != null && !_state.value.current) {
                val st = if (_state.value.structure == null) withContext(Dispatchers.IO) { cache.structure(uid) } else null
                val it = withContext(Dispatchers.IO) { cache.items(uid, asked, askedFolder) }
                if (st != null) { structureFromDisk = true; settleScope(st.value) }
                if (st != null || it != null) _state.update { s ->
                    val take = it != null && !s.current && s.range == asked && s.folderKey == askedFolder
                    s.copy(structure = s.structure ?: st?.value,
                        items = if (take) it!!.value else s.items,
                        itemsRange = if (take) asked else s.itemsRange,
                        itemsFolder = if (take) askedFolder else s.itemsFolder,
                        loadedAt = if (take) it!!.savedAt else s.loadedAt,
                        offline = if (take) true else s.offline,
                        loading = false)
                }
            }
            try {
                coroutineScope {
                    var structureChanged = false
                    var structure = _state.value.structure?.takeIf { !structureFromDisk } ?: api.structure().also { structureChanged = true }.value
                    structureFromDisk = false
                    val today = _state.value.today
                    // Today's rail only: fetched beside /items, and only when today is in the range.
                    val overdueJob = if (today >= asked.first && today <= asked.second) async { runCatching { api.overdue(askedFolder).value.items }.getOrNull() } else null
                    val (from, to) = asked
                    val fetched = api.items(from, to, askedFolder)
                    val items = fetched.value
                    if (_state.value.range != asked || _state.value.folderKey != askedFolder) return@coroutineScope
                    if (items.structureVersion != null && items.structureVersion != structure.version) { structure = api.structure().value; structureChanged = true }
                    failedSinceSuccess = false
                    val now = System.currentTimeMillis()
                    confirmedAt = now
                    val st = _state.value
                    // Nothing changed (a 304 on a range already on screen): no disk write, no new state (audit 2 #21).
                    if (!fetched.changed && !structureChanged && st.current && st.itemsRange == asked && !st.offline && st.rangeError == null) {
                        if (st.loading || st.refreshing) _state.update { it.copy(loading = false, refreshing = false) }
                        val overdue = overdueJob?.await()
                        if (overdue != null && items.accessLevel.hasData && overdue != st.overdue && _state.value.folderKey == askedFolder && _state.value.range == asked) _state.update { it.copy(overdue = overdue) }
                        return@coroutineScope
                    }
                    settleScope(structure)
                    _state.update { it.copy(structure = structure, items = items, loading = false, refreshing = false, error = null,
                        itemsRange = asked, itemsFolder = askedFolder, loadedAt = now, offline = false, rangeError = null,
                        overdue = if (items.accessLevel.hasData) it.overdue else emptyList()) }
                    if (uid != null) withContext(Dispatchers.IO) { cache.saveStructure(uid, structure, now); cache.saveItems(uid, asked, items, now, askedFolder) }
                    // What the screen just saw, the widgets see too (throttled to 5 min).
                    c.refreshCalendarWidgets()
                    val overdue = overdueJob?.await()
                    if (overdue != null && items.accessLevel.hasData && _state.value.folderKey == askedFolder) _state.update { it.copy(overdue = overdue) }
                }
            } catch (e: ApiError) {
                if (_state.value.range != asked || _state.value.folderKey != askedFolder) return@withLock
                // Data of the range on screen stays, with a snackbar ("Data as of 14.05"); a range never
                // loaded says why, with Try again — never "no tasks".
                val reason = e.describe(res)
                val tell = pulled || !failedSinceSuccess
                failedSinceSuccess = true
                _state.update {
                    it.copy(loading = false, refreshing = false, error = if (it.structure == null) reason else null, loadedAt = confirmedAt ?: it.loadedAt,
                        rangeError = if (it.current) null else reason, offline = it.current,
                        refreshFailures = if (it.current && tell) it.refreshFailures + 1 else it.refreshFailures)
                }
            }
        }
    }

    /** [reveal]: the person asked for this day (cell, Today, day arrows), so the screen shows its tasks. */
    fun selectDay(day: String, reveal: Boolean = false) {
        val before = _state.value.range
        _state.update { it.withDay(day, reveal) }
        keep()
        if (_state.value.range != before) { _state.update { it.copy(loading = true, rangeError = null) }; refresh() }
    }
    fun shiftMonth(n: Int) = selectDay(if (_state.value.view == CalView.PEOPLE) CalendarCore.addDays(_state.value.day, 7 * n) else CalendarCore.shiftMonth(_state.value.day, n))
    /** Today, and its tasks in view — also when today is already selected. */
    fun today() = selectDay(_state.value.today, reveal = true)
    fun toggleRail() = _state.update { it.copy(railAll = !it.railAll) }
    fun setView(v: CalView) {
        val before = _state.value.range
        _state.update { it.copy(view = v) }
        keep()
        if (_state.value.range != before) { _state.update { it.copy(loading = true, rangeError = null) }; refresh() }
    }
    fun setLens(l: CalLens) { _state.update { it.copy(lens = l) }; keep() }
    fun focus(unitId: String?) {
        _state.update { it.copy(focusId = unitId, hintSeen = it.hintSeen || unitId != null) }
        if (unitId != null) prefs.edit().putBoolean("hintSeen", true).apply()
        keep()
    }
    fun setFilters(f: CalendarCore.Filters) {
        val changed = _state.value.folderKey != CalendarCore.folderKey(f.folders)
        _state.update { it.copy(filters = f, loading = if (changed) true else it.loading, rangeError = if (changed) null else it.rangeError, overdue = if (changed) emptyList() else it.overdue) }
        save()
        if (changed) refresh()
    }
    /** Reset clears the filters, never the scope: the scope is a view, not a filter (contract 2). */
    fun resetFilters() = setFilters(CalendarCore.NO_FILTERS.copy(scope = _state.value.filters.scope))
    /** "My division" without a Bagan card is Mine plus a note; a disabled scope is never saved (contract 3). */
    fun setScope(scope: CalendarCore.Scope, inChart: Boolean = true) {
        val fallback = scope == CalendarCore.Scope.DIVISION && !inChart
        _state.update { it.copy(filters = it.filters.copy(scope = if (fallback) CalendarCore.Scope.ME else scope), divisionFallback = fallback) }
        save()
    }
    /** Once the structure is known: a "My division" saved or linked earlier, for someone with no card, becomes Mine. */
    private fun settleScope(structure: CalStructure) {
        if (_state.value.filters.scope == CalendarCore.Scope.DIVISION && structure.me?.homeUnitIds.orEmpty().isEmpty()) setScope(CalendarCore.Scope.DIVISION, inChart = false)
    }
    fun toggleCollapsed(unitId: String) { _state.update { it.copy(collapsed = if (unitId in it.collapsed) it.collapsed - unitId else it.collapsed + unitId) }; save() }

    /**
     * Opening a task: `canEdit && editProjectId == project.id` → the task screen; anything else that is
     * not masked → the read-only preview. A masked row says why it does not open (audit #37).
     */
    fun open(item: CalItem) {
        if (item.masked) { _state.update { it.copy(opening = CalOpen.Masked) }; return }
        val id = item.id ?: return
        _state.update { it.copy(opening = if (item.canEdit && item.editProjectId != null && item.editProjectId == item.project?.id) CalOpen.Edit(id) else CalOpen.Preview(id, item.project?.name)) }
    }

    /** A task that is not in the loaded data asks /api/calendar/task. */
    fun openById(id: String) = viewModelScope.launch {
        _state.value.items?.items?.firstOrNull { it.id == id }?.let { open(it); return@launch }
        val r = runCatching { api.task(id) }.getOrNull()
        _state.update {
            it.copy(opening = when {
                r == null -> CalOpen.Offline(id)
                !r.found -> CalOpen.Gone
                r.masked -> CalOpen.Masked
                r.canEdit && r.editProjectId != null && r.editProjectId == r.projectId -> CalOpen.Edit(id)
                else -> CalOpen.Preview(id, null)
            })
        }
    }
    fun opened() = _state.update { it.copy(opening = null) }

    /** Try again on a range that failed. */
    fun retry() { _state.update { it.copy(loading = true, rangeError = null) }; refresh() }

    private companion object {
        const val FOCUS = "calendar.focus"
        const val DAY = "calendar.day"
        const val VIEW = "calendar.view"
        const val LENS = "calendar.lens"
    }
}

/**
 * Remembers, in the back-stack entry's SavedStateHandle, the last Calendar link applied, so the same
 * arguments are never applied twice (recomposition, return from the task, rotation, process restore).
 */
class CalendarLinkGate(private val handle: SavedStateHandle) {
    /** True the first time [key] is seen by this entry. */
    fun take(key: String): Boolean {
        if (handle.get<String>(KEY) == key) return false
        handle[KEY] = key
        return true
    }

    companion object {
        private const val KEY = "calendar.lastAppliedLink"
        fun key(vararg parts: String?) = parts.joinToString("\u0001") { it ?: "" }
    }
}
