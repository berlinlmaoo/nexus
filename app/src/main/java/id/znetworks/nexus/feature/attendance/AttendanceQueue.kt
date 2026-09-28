package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.net.meansOriginUnreachable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.io.File

/**
 * A check-in or check-out the server never decided on (PRD §2.4, API.md §2.2.1).
 *
 * Attendance is the one dataset that cannot be honestly recreated later, so the tap is written to
 * disk with everything the server will need, and replayed under the SAME id when NEXUS is back.
 */
@Serializable
data class PendingAttendance(
    /** Also the server's idempotency key: the id already sent on the live attempt. */
    val id: String,
    val kind: AttendanceKind,
    /** When the tap was sent live. Becomes the recorded time, not the moment the queue drains. */
    val deviceAtMillis: Long,
    val uptimeSec: Long,
    val fix: LocationFix,
    val reflection: String? = null,
    val offsite: Boolean = false,
    val reason: String? = null,
    val attempts: Int = 0,
    /** Whose tap this is. A different person signing in on this phone never replays it. */
    val ownerId: String? = null,
)

/** Why the last replay did not land, kept typed so the screen can say it in the user's language. */
@Serializable
sealed interface QueueProblem {
    /** Replayed check-in (or offsite check-out) refused for being outside the radius; entry dropped. */
    @Serializable
    data class RefusedOutsideRadius(val kind: AttendanceKind, val atMillis: Long) : QueueProblem

    /** The server keeps refusing with this sentence; dropped after [AttendanceQueue.MAX_ATTEMPTS]. */
    @Serializable
    data class ServerRefused(val message: String?, val status: Int?, val dropped: Boolean) : QueueProblem
}

@Serializable
private data class QueueFile(
    val entries: List<PendingAttendance> = emptyList(),
    val heldForUpdate: Boolean = false,
    val problem: QueueProblem? = null,
)

/** What sends a replay. [AttendanceApi] in the app; a fake in tests. */
interface QueueSender {
    suspend fun checkIn(selfie: ByteArray, entry: PendingAttendance): AttendanceOutcome
    suspend fun checkOut(selfie: ByteArray, entry: PendingAttendance, offsite: Boolean, reason: String?): AttendanceOutcome
}

class AttendanceQueue(
    private val dir: File,
    private val sender: QueueSender,
    private val currentUserId: () -> String?,
    /** True while the version gate is up: every replay would just meet 426 again. */
    private val isLocked: () -> Boolean,
    /** A replayed tap was refused and dropped: say it outside the app too (REQ-ATT-14). */
    private val onRefused: (QueueProblem.RefusedOutsideRadius) -> Unit = {},
    /** A queued check-in just landed: today and the location tracker need a fresh look. */
    private val onCheckInLanded: () -> Unit = {},
) {
    data class State(
        val entries: List<PendingAttendance> = emptyList(),
        val heldForUpdate: Boolean = false,
        val problem: QueueProblem? = null,
        /** The "saved on this phone, needs an update" popup is owed (not persisted, like iOS). */
        val heldNoticeDue: Boolean = false,
    ) {
        val count: Int get() = entries.size
        fun has(kind: AttendanceKind) = entries.any { it.kind == kind }
        val isHeldForUpdate: Boolean get() = heldForUpdate && entries.isNotEmpty()
    }

    enum class FlushResult { EMPTY, DRAINED, UNREACHABLE, SIGNED_OUT, LOCKED, STOPPED }

    private val mutex = Mutex()
    private val indexFile = File(dir, "queue.json")
    private fun selfieFile(id: String) = File(dir, "$id.jpg")

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        dir.mkdirs()
        val loaded = runCatching { NexusJson.decodeFromString(QueueFile.serializer(), indexFile.readText()) }.getOrNull()
        if (loaded != null) _state.value = State(loaded.entries, loaded.heldForUpdate, loaded.problem)
    }

    /**
     * Stores a tap the server never decided on. [id] MUST be the clientId already sent live: a tap
     * that reached the server but whose reply was lost is then recognised on replay
     * (`duplicate: true`) instead of becoming a second check-in.
     */
    @Synchronized
    fun enqueue(
        id: String,
        kind: AttendanceKind,
        selfie: ByteArray,
        fix: LocationFix,
        deviceAtMillis: Long,
        uptimeSec: Long,
        reflection: String? = null,
        offsite: Boolean = false,
        reason: String? = null,
    ) {
        // The selfie first: an index entry without its photo can never be sent.
        writeAtomically(selfieFile(id), selfie)
        val entry = PendingAttendance(
            id = id, kind = kind, deviceAtMillis = deviceAtMillis, uptimeSec = uptimeSec, fix = fix,
            reflection = reflection, offsite = offsite, reason = reason, ownerId = currentUserId(),
        )
        mutate { it.copy(entries = it.entries.filterNot { e -> e.id == id } + entry) }
    }

    /** Called when a live tap or a replay met 426: kept untouched, replay paused until updated. */
    @Synchronized
    fun holdForUpdate() = mutate { it.copy(heldForUpdate = true, heldNoticeDue = true) }

    fun heldNoticeSeen() = _state.value.let { s -> _state.value = s.copy(heldNoticeDue = false) }

    /**
     * Replays the signed-in person's taps, oldest first, one at a time (a check-out must never land
     * before its check-in). Stops at the first sign that nobody is answering.
     */
    suspend fun flush(): FlushResult = mutex.withLock {
        if (_state.value.entries.isEmpty()) return FlushResult.EMPTY
        if (isLocked()) return FlushResult.LOCKED
        val me = currentUserId() ?: return FlushResult.SIGNED_OUT

        val mine = _state.value.entries
            // Only this person's: an entry with no owner can't be proven theirs (Android never shipped one).
            .filter { it.ownerId == me }
            .sortedBy { it.deviceAtMillis }
        for (entry in mine) {
            val selfie = runCatching { selfieFile(entry.id).readBytes() }.getOrNull()
            if (selfie == null) {
                // Nothing sendable is left; retrying forever helps nobody.
                remove(entry.id)
                continue
            }
            val outcome = try {
                send(entry, selfie)
            } catch (e: ApiError) {
                when {
                    e is ApiError.UpgradeRequired -> {
                        // The BUILD was refused, not the tap: never counted as an attempt.
                        holdForUpdate()
                        return FlushResult.STOPPED
                    }
                    e === ApiError.Unauthorized -> return FlushResult.SIGNED_OUT
                    e.meansOriginUnreachable() -> return FlushResult.UNREACHABLE
                    // The day already has its check-in (web, another phone, an earlier replay):
                    // this tap's job is done. Dropped without a word, and the check-out behind it goes on.
                    alreadyCheckedIn(entry.kind, e) -> {
                        remove(entry.id)
                        onCheckInLanded()
                        continue
                    }
                    else -> {
                        bumpAttempts(entry.id, e)
                        return FlushResult.STOPPED
                    }
                }
            }
            remove(entry.id)
            when (outcome) {
                is AttendanceOutcome.Success -> {
                    mutate { it.copy(problem = null, heldForUpdate = false, heldNoticeDue = false) }
                    if (entry.kind == AttendanceKind.CHECK_IN) onCheckInLanded()
                }
                is AttendanceOutcome.OutsideRadius -> {
                    val problem = QueueProblem.RefusedOutsideRadius(entry.kind, entry.deviceAtMillis)
                    mutate { it.copy(problem = problem) }
                    onRefused(problem)
                }
            }
        }
        FlushResult.DRAINED
    }

    private suspend fun send(entry: PendingAttendance, selfie: ByteArray): AttendanceOutcome = when (entry.kind) {
        AttendanceKind.CHECK_IN -> sender.checkIn(selfie, entry)
        AttendanceKind.CHECK_OUT -> {
            val first = sender.checkOut(selfie, entry, entry.offsite, entry.reason)
            // The server judges the stored coordinates, so a plain retry cannot change the answer.
            // Resent once as offsite for approval: what the live sheet would have offered.
            if (first is AttendanceOutcome.OutsideRadius && !entry.offsite) {
                sender.checkOut(selfie, entry, offsite = true, reason = OFFSITE_REPLAY_REASON)
            } else {
                first
            }
        }
    }

    /** Logout: everything goes, selfies included. A queued tap belongs to the person who made it. */
    @Synchronized
    fun clearAll() {
        _state.value.entries.forEach { selfieFile(it.id).delete() }
        indexFile.delete()
        _state.value = State()
    }

    /**
     * The session ended on its own (401). Taps are KEPT for the same person's next sign-in; any
     * without an owner are stamped with the session that is ending.
     */
    @Synchronized
    fun holdForSignIn(ownerId: String?) {
        ownerId ?: return
        if (_state.value.entries.none { it.ownerId == null }) return
        mutate { s -> s.copy(entries = s.entries.map { if (it.ownerId == null) it.copy(ownerId = ownerId) else it }) }
    }

    /** A sign-in succeeded: somebody else's taps are deleted, never replayed under this cookie. */
    @Synchronized
    fun keepOnly(ownerId: String) {
        // Ownerless entries go too: nobody can say whose tap it was, so it is never sent under this cookie.
        val foreign = _state.value.entries.filter { it.ownerId != ownerId }
        if (foreign.isEmpty()) return
        foreign.forEach { selfieFile(it.id).delete() }
        mutate { s -> s.copy(entries = s.entries.filterNot { it in foreign }) }
    }

    @Synchronized
    private fun remove(id: String) {
        selfieFile(id).delete()
        mutate { s -> s.copy(entries = s.entries.filterNot { it.id == id }) }
    }

    @Synchronized
    private fun bumpAttempts(id: String, error: ApiError) {
        val entry = _state.value.entries.firstOrNull { it.id == id } ?: return
        val attempts = entry.attempts + 1
        val dropped = attempts >= MAX_ATTEMPTS
        val problem = QueueProblem.ServerRefused(
            message = (error as? ApiError.Http)?.serverMessage,
            status = (error as? ApiError.Http)?.status,
            dropped = dropped,
        )
        if (dropped) {
            // The server is answering and refusing; replaying a rejection forever helps nobody.
            selfieFile(id).delete()
            mutate { s -> s.copy(entries = s.entries.filterNot { it.id == id }, problem = problem) }
        } else {
            mutate { s -> s.copy(entries = s.entries.map { if (it.id == id) it.copy(attempts = attempts) else it }, problem = problem) }
        }
    }

    @Synchronized
    private fun mutate(change: (State) -> State) {
        val next = change(_state.value)
        val file = QueueFile(next.entries, next.heldForUpdate, next.problem)
        writeAtomically(indexFile, NexusJson.encodeToString(QueueFile.serializer(), file).toByteArray())
        _state.value = next
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        dir.mkdirs()
        val tmp = File(dir, target.name + ".tmp")
        tmp.outputStream().use { out ->
            out.write(bytes)
            out.fd.sync()
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            check(tmp.renameTo(target)) { "Could not write ${target.name}" }
        }
    }

    companion object {
        /**
         * Check-in 409 "You have already checked in today." (no `code`): the only 409 that means the
         * tap landed. PENDING_CHECKOUT (a code) and "an approved … request already covers today"
         * are real refusals and keep their attempts and message.
         */
        fun alreadyCheckedIn(kind: AttendanceKind, e: ApiError): Boolean =
            kind == AttendanceKind.CHECK_IN && e is ApiError.Http && e.status == 409 && e.code == null &&
                e.serverMessage.orEmpty().contains("already checked in", ignoreCase = true)

        const val MAX_ATTEMPTS = 5
        /** Sent to the server as-is (the approver reads it), so English like the iOS source string. */
        const val OFFSITE_REPLAY_REASON =
            "Checked out while NEXUS was unreachable; the phone was outside the office radius at the time."
    }
}

/** Replays through the real API, with the stored evidence and the original tap time. */
class ApiQueueSender(private val api: AttendanceApi) : QueueSender {
    override suspend fun checkIn(selfie: ByteArray, entry: PendingAttendance) =
        api.checkIn(selfie, entry.fix, entry.id, ReplayStamp(entry.deviceAtMillis, entry.uptimeSec))

    override suspend fun checkOut(selfie: ByteArray, entry: PendingAttendance, offsite: Boolean, reason: String?) =
        api.checkOut(selfie, entry.fix, entry.reflection.orEmpty(), offsite, reason, entry.id,
            ReplayStamp(entry.deviceAtMillis, entry.uptimeSec))
}
