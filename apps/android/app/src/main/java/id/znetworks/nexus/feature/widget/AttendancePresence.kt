package id.znetworks.nexus.feature.widget

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceKind
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.MyShift
import id.znetworks.nexus.feature.attendance.PendingAttendance
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalTime
import java.time.ZonedDateTime

/** One day of the last seven: the server's tone (P L I C S D A, "" nothing recorded). */
@Serializable data class DayDot(val dateKey: String, val tone: String)

/** One person-day from `/api/attendance/history?compact=1`; the server decides the tone. */
@Serializable data class CompactDay(val date: String, val tone: String = "", val lateMinutes: Int? = null)
@Serializable data class CompactResponse(val records: List<CompactDay> = emptyList())

/**
 * What the home-screen widget draws (iOS AttendanceSnapshot): today only, written by the app. A
 * widget refreshes while the app sleeps, so a snapshot from another day is never shown as today's.
 */
@Serializable
data class AttendanceSnapshot(
    val dateKey: String,
    val checkInAtMillis: Long? = null,
    val checkOutAtMillis: Long? = null,
    /** The day's place: the office they are in now, or the check-in address on an away day. */
    val place: String? = null,
    val expectedOutMillis: Long? = null,
    val recent: List<DayDot> = emptyList(),
    val pendingCount: Int = 0,
    val queuedSinceMillis: Long? = null,
) {
    sealed interface State {
        data class Working(val sinceMillis: Long) : State
        data class Done(val atMillis: Long) : State
        data object NotCheckedIn : State
        /** Not today's: say "open NEXUS", never yesterday's answer. */
        data object Stale : State
    }

    fun state(today: String): State {
        if (dateKey != today) return State.Stale
        checkOutAtMillis?.let { return State.Done(it) }
        (checkInAtMillis ?: queuedSinceMillis)?.let { return State.Working(it) }
        return State.NotCheckedIn
    }
    val isPending: Boolean get() = pendingCount > 0
}

/**
 * A workday is running on this phone (owner, 28 Sep 2026; iOS b186172): checked in, live or still
 * queued, and not checked out, not even offline. Logout is refused then: it would stop the live
 * location and wipe the queue, leaving a day nobody can close from this phone. A 401 still ends the
 * session; only the person's own tap is held.
 */
object WorkdayRule {
    fun open(queue: List<PendingAttendance>, today: id.znetworks.nexus.feature.attendance.AttendanceRecord?, tracking: Boolean, todayKnown: Boolean): Boolean {
        if (queue.any { it.kind == AttendanceKind.CHECK_OUT }) return false
        if (queue.any { it.kind == AttendanceKind.CHECK_IN }) return true
        // Before today was read this launch, the work session restored from disk still knows.
        if (!todayKnown) return tracking
        return today != null && today.hasCheckedIn && !today.hasCheckedOut
    }
}

object PresenceLogic {
    /** When the shift should end: flexi = check-in + 9 h; an end earlier than the start is tomorrow. */
    fun expectedOut(startMillis: Long?, shift: MyShift?): Long? {
        if (startMillis == null || shift == null) return null
        if (shift.flexi == true) return startMillis + 9 * 3_600_000L
        val end = shift.endTime?.let { runCatching { LocalTime.parse(it.take(5)) }.getOrNull() } ?: return null
        val start = Instant.ofEpochMilli(startMillis).atZone(OfficeTime.ZONE)
        var at: ZonedDateTime = start.toLocalDate().atTime(end).atZone(OfficeTime.ZONE)
        if (!at.isAfter(start)) at = at.plusDays(1)
        return at.toInstant().toEpochMilli()
    }

    fun parse(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    fun build(today: AttendanceToday?, queue: List<PendingAttendance>, recent: List<DayDot>, hereName: String?, nowDateKey: String): AttendanceSnapshot {
        val rec = today?.today
        val queuedIn = queue.filter { it.kind == AttendanceKind.CHECK_IN }.minByOrNull { it.deviceAtMillis }
        val checkIn = parse(rec?.checkInAt)
        val checkOut = parse(rec?.checkOutAt) ?: queue.filter { it.kind == AttendanceKind.CHECK_OUT }.minOfOrNull { it.deviceAtMillis }
        val start = checkIn ?: queuedIn?.deviceAtMillis
        return AttendanceSnapshot(
            dateKey = nowDateKey,
            checkInAtMillis = checkIn,
            checkOutAtMillis = checkOut,
            // Working in an office now (maybe not the record's): that office; else the day's place.
            place = hereName ?: rec?.placeLabel,
            expectedOutMillis = expectedOut(start, today?.myShift),
            recent = recent.sortedBy { it.dateKey }.takeLast(7),
            pendingCount = queue.size,
            queuedSinceMillis = queuedIn?.deviceAtMillis,
        )
    }

    fun dots(days: List<CompactDay>) = days.sortedBy { it.date }.takeLast(7).map { DayDot(it.date, it.tone) }
}

/**
 * The single funnel between what the app knows about attendance and the home-screen widget (iOS
 * AttendancePresence). Called when today is read, when the queue or the trail changes; wiped on
 * sign-out so a widget never keeps one person's hours on a phone handed to somebody else.
 */
class AttendancePresence internal constructor(
    private val scope: CoroutineScope,
    private val queue: () -> List<PendingAttendance>,
    private val hereName: () -> String?,
    private val currentSession: () -> Session?,
    private val server: () -> String,
    private val fetchRecent: suspend () -> List<DayDot>,
    private val readSnapshot: () -> String?,
    private val writeSnapshot: (String?) -> Unit,
    private val redraw: suspend () -> Unit,
) {
    constructor(context: Context, api: ApiClient, scope: CoroutineScope,
        queue: () -> List<PendingAttendance>, hereName: () -> String?, currentSession: () -> Session?,
    ) : this(scope, queue, hereName, currentSession, server = { api.url("/").toString() },
        fetchRecent = {
            val to = OfficeTime.today()
            val from = to.minusDays(6)
            PresenceLogic.dots(api.get("/api/attendance/history?scope=me&dateFrom=$from&dateTo=$to&compact=1", CompactResponse.serializer()).records)
        },
        readSnapshot = { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) },
        writeSnapshot = { raw -> context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
            if (raw == null) clear() else putString(KEY, raw)
        }.apply() },
        redraw = { AttendanceWidget.updateAll(context) })

    private val lock = Mutex()
    private val stateLock = Any()
    private var generation = 0L
    private var memoryOwner: Owner? = null
    private val _revision = MutableStateFlow(0L)
    /** A running Glance session must discard its captured value after a save or sign-out. */
    val revision = _revision.asStateFlow()
    fun invalidate() { _revision.update { it + 1 } }
    /** The last today the app read (null before the first read this launch). */
    @Volatile var lastToday: AttendanceToday? = null
        private set
    private var recent: List<DayDot> = emptyList()
    private var recentAt = 0L
    private var recentKey: String? = null

    fun refresh(today: AttendanceToday? = null, forceRecent: Boolean = false): kotlinx.coroutines.Job {
        // Capture before launch too: queued work from the previous login cannot adopt the next one.
        val ticket = synchronized(stateLock) { owner()?.let { Request(it, generation) } }
        return scope.launch {
            if (ticket == null) return@launch
            val saved = lock.withLock {
                val request = synchronized(stateLock) {
                    if (!current(ticket)) return@withLock false
                    if (!ticket.owner.sameAs(memoryOwner)) {
                        resetMemory()
                        memoryOwner = ticket.owner
                    }
                    if (today != null) lastToday = today
                    val rec = lastToday?.today
                    val key = "${OfficeTime.today()}|${rec?.checkInAt}|${rec?.checkOutAt}"
                    val now = System.currentTimeMillis()
                    Triple(key, now, forceRecent || key != recentKey || now - recentAt > 15 * 60_000L)
                }
                val fetched = if (request.third) try { fetchRecent() }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { null }
                else null
                synchronized(stateLock) {
                    if (!current(ticket)) return@withLock false
                    fetched?.let { recent = it; recentAt = request.second; recentKey = request.first }
                    val snapshot = PresenceLogic.build(lastToday, queue(), recent, hereName(), OfficeTime.today().toString())
                    if (!current(ticket)) return@withLock false
                    writeSnapshot(NexusJson.encodeToString(SavedAttendance.serializer(),
                        SavedAttendance(ticket.owner.userId, ticket.owner.server, snapshot)))
                    invalidate()
                    true
                }
            }
            if (saved) redraw()
        }
    }

    fun stop(): kotlinx.coroutines.Job {
        // Do not wait behind an in-flight history request to remove private data or notify Glance.
        synchronized(stateLock) {
            generation++
            memoryOwner = null
            resetMemory()
            writeSnapshot(null)
            invalidate()
        }
        return scope.launch { redraw() }
    }

    /** Recheck auth after the read; old unowned snapshots are deliberately not migrated. */
    fun load(): AttendanceSnapshot? = synchronized(stateLock) {
        val before = owner() ?: return@synchronized null
        val saved = readSnapshot()?.let {
            runCatching { NexusJson.decodeFromString(SavedAttendance.serializer(), it) }.getOrNull()
        } ?: return@synchronized null
        saved.snapshot.takeIf { saved.userId == before.userId && saved.server == before.server && before.sameAs(owner()) }
    }

    private fun resetMemory() { lastToday = null; recent = emptyList(); recentAt = 0L; recentKey = null }
    private fun owner() = currentSession()?.let { Owner(server(), it) }
    private fun current(request: Request) = request.generation == generation && request.owner.sameAs(owner())

    // Credentials only participate in in-memory equality; never serialize or log them.
    private class Owner(val server: String, session: Session) {
        val userId = session.userId
        private val token = session.token
        private val cookieName = session.cookieName
        fun sameAs(other: Owner?) = other != null && server == other.server && userId == other.userId &&
            token == other.token && cookieName == other.cookieName
    }
    private class Request(val owner: Owner, val generation: Long)

    companion object {
        private const val PREFS = "nexus.widget"
        private const val KEY = "snapshot"
    }
}

@Serializable
private data class SavedAttendance(val userId: String, val server: String, val snapshot: AttendanceSnapshot)

