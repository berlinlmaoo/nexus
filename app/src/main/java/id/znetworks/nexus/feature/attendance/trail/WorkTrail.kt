package id.znetworks.nexus.feature.attendance.trail

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.attendance.AttendanceToday
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import okhttp3.Request
import java.io.File
import java.time.Instant

/**
 * Carries out [TrailMachine]'s decisions against the disk and the network; [WorkTrailService]
 * carries out the location half. One instance per process (AppContainer).
 */
class WorkTrail(
    private val context: Context,
    private val api: ApiClient,
    private val scope: CoroutineScope,
    private val signedIn: () -> Boolean,
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** What the service must do with the GPS right now. */
    enum class Mode { OFF, WATCH_OFFICE, OUTSIDE }

    /** Set when this record still needs the prominent disclosure (once per record, never a nag). */
    private val _disclosureFor = MutableStateFlow<String?>(null)
    val disclosureFor: StateFlow<String?> = _disclosureFor.asStateFlow()

    private val _mode = MutableStateFlow(Mode.OFF)
    val mode: StateFlow<Mode> = _mode.asStateFlow()

    /** One-shot fix requested (exit/enter with no fresh position). The service clears it. */
    val fixRequested = MutableStateFlow(false)

    private val dir = File(context.noBackupFilesDir, "worktrail")
    private val stateFile = File(dir, "state.json")
    private val prefs = context.getSharedPreferences("nexus.worktrail", Context.MODE_PRIVATE)
    private val lock = Mutex()
    private val flushLock = Mutex()
    private val machine = TrailMachine(load())

    val state: TrailState get() = machine.state

    init {
        _mode.value = modeFor(machine.state)
    }

    // region inputs from the app

    /**
     * Called whenever the app learns today's attendance (screen load, check-in/out, queue replay,
     * foreground). Idempotent: it only starts or stops something when the answer changed.
     */
    fun sync(today: AttendanceToday?, queuedCheckOut: Boolean) = scope.launch {
        if (!signedIn() || today == null) return@launch
        val fx: List<TrailEffect>
        var startedRecord: String? = null
        lock.withLock {
            val rec = today.today
            val office = rec?.officeLocation
            val lat = office?.latitude
            val lng = office?.longitude
            fx = when {
                // A check-out tapped offline is still a check-out: the day is over.
                queuedCheckOut -> if (machine.state.isActive) machine.stop(keepUnsent = true) else emptyList()
                rec == null || !rec.hasCheckedIn || rec.hasCheckedOut -> if (machine.state.isActive) machine.stop(keepUnsent = true) else emptyList()
                // Nothing to measure "outside" against; the server cannot either.
                lat == null || lng == null -> if (machine.state.isActive) machine.stop(keepUnsent = true) else emptyList()
                else -> {
                    val fence = TrailFence(lat, lng, office.radiusMeters ?: 100.0)
                    val checkIn = rec.checkInAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                    machine.start(rec.id, checkIn, fence, now()).also { if (machine.state.isActive) startedRecord = rec.id }
                }
            }
            persist()
        }
        apply(fx)
        startedRecord?.let { ensureConsent(it) }
    }

    /** Logout: stop, and whatever was not uploaded goes with the session. */
    fun stopForLogout() = scope.launch {
        lock.withLock {
            machine.stop(keepUnsent = false)
            machine.state = TrailState()
            persist()
        }
        prefs.edit().clear().apply()
        _disclosureFor.value = null
        _mode.value = Mode.OFF
        WorkTrailService.stop(context)
    }

    // endregion

    // region consent (REQ-ATT-36)

    private fun ensureConsent(recordId: String) {
        when (prefs.getString(KEY_CONSENT_PREFIX + recordId, null)) {
            CONSENT_YES -> if (hasFine()) { report("on", recordId); startService() } else report("denied", recordId)
            CONSENT_NO -> report("denied", recordId)
            // Agreed on an earlier day and the permission is still there: no second disclosure,
            // that would be a daily nag. A refusal is asked again on the next record only.
            else -> if (prefs.getBoolean(KEY_EVER_AGREED, false) && hasFine()) consentGiven(recordId, true)
            else _disclosureFor.value = recordId
        }
    }

    private fun hasFine() = androidx.core.content.ContextCompat.checkSelfPermission(
        context, android.Manifest.permission.ACCESS_FINE_LOCATION,
    ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** The person read the disclosure and agreed. */
    fun consentGiven(recordId: String, hasFineLocation: Boolean) {
        prefs.edit().putString(KEY_CONSENT_PREFIX + recordId, CONSENT_YES).putBoolean(KEY_EVER_AGREED, true).apply()
        _disclosureFor.value = null
        if (hasFineLocation) {
            report("on", recordId)
            startService()
        } else {
            report("denied", recordId)
        }
    }

    /** "Not now": the board shows "location off" for this day instead of an empty trail. */
    fun consentDeclined(recordId: String) {
        prefs.edit().putString(KEY_CONSENT_PREFIX + recordId, CONSENT_NO).apply()
        _disclosureFor.value = null
        report("denied", recordId)
    }

    /** Permission revoked or location switched off mid-session (seen by the service). */
    fun permissionLost() {
        machine.state.recordId?.let { report("denied", it) }
    }

    private fun report(state: String, recordId: String) {
        val key = "$recordId|$state"
        if (prefs.getString(KEY_REPORTED, null) == key) return
        scope.launch {
            runCatching {
                val body = NexusJson.encodeToString(StatusBody.serializer(), StatusBody(recordId, state)).toJsonBody()
                api.send(Request.Builder().url(api.url("/api/attendance/location-status")).post(body).build(), JsonObject.serializer())
                prefs.edit().putString(KEY_REPORTED, key).apply()
            }
        }
    }

    // endregion

    // region inputs from the service

    fun onFix(p: TrailPoint) = scope.launch {
        val fx = lock.withLock { machine.fix(p, now()).also { persist() } }
        apply(fx)
    }

    fun tick() = scope.launch {
        val fx = lock.withLock { machine.tick(now()).also { persist() } }
        apply(fx)
    }

    // endregion

    private fun apply(fx: List<TrailEffect>) {
        for (e in fx) {
            when (e) {
                TrailEffect.Flush -> scope.launch { flush() }
                TrailEffect.RequestFix -> fixRequested.value = true
                is TrailEffect.Arm, TrailEffect.StartContinuous, TrailEffect.StopContinuous -> Unit
                TrailEffect.DisarmAll -> Unit
            }
        }
        _mode.value = modeFor(machine.state)
        if (_mode.value == Mode.OFF && machine.state.pending.isEmpty()) WorkTrailService.stop(context)
    }

    private fun modeFor(s: TrailState): Mode = when {
        !s.isActive -> Mode.OFF
        s.zone == TrailZone.OUTSIDE -> Mode.OUTSIDE
        else -> Mode.WATCH_OFFICE
    }

    private fun startService() {
        if (machine.state.isActive) WorkTrailService.start(context)
    }

    /** One batch at a time, oldest record first. Stops at the first failure and keeps the rest. */
    suspend fun flush() {
        if (!signedIn()) return
        if (!flushLock.tryLock()) return
        try {
            while (true) {
                val (recordId, points) = lock.withLock { machine.nextBatch() } ?: break
                val ids = points.map { it.id }.toSet()
                try {
                    val reply = post(recordId, points)
                    val fx = lock.withLock { machine.sent(ids, recordId, reply, now()).also { persist() } }
                    apply(fx.filterNot { it == TrailEffect.Flush })
                } catch (e: ApiError) {
                    val refusedOnMerits = e is ApiError.Http && e.status in setOf(400, 403, 409, 410, 422)
                    lock.withLock { machine.failed(ids, dropBatch = refusedOnMerits, now = now()); persist() }
                    if (!refusedOnMerits) return
                }
            }
        } finally {
            flushLock.unlock()
        }
    }

    private suspend fun post(recordId: String, points: List<TrailPoint>): TrailReply {
        val body = TrailBody(recordId, points.map {
            WirePoint(it.lat, it.lng, it.accuracy?.takeIf { a -> a >= 0 }, Instant.ofEpochMilli(it.atMillis).toString(), it.event.name)
        })
        val res = api.send(
            Request.Builder().url(api.url("/api/attendance/location-trail"))
                .post(NexusJson.encodeToString(TrailBody.serializer(), body).toJsonBody()).build(),
            JsonObject.serializer(),
        )
        return parseReply(res)
    }

    private fun persist() {
        runCatching {
            dir.mkdirs()
            val tmp = File(dir, "state.json.tmp")
            tmp.writeText(NexusJson.encodeToString(TrailState.serializer(), machine.state))
            if (!tmp.renameTo(stateFile)) { stateFile.delete(); tmp.renameTo(stateFile) }
        }
    }

    private fun load(): TrailState =
        runCatching { NexusJson.decodeFromString(TrailState.serializer(), stateFile.readText()) }.getOrElse { TrailState() }

    @Serializable private data class StatusBody(val recordId: String, val state: String)
    @Serializable private data class WirePoint(val lat: Double, val lng: Double, val accuracy: Double? = null, val at: String, val event: String)
    @Serializable private data class TrailBody(val recordId: String, val points: List<WirePoint>)

    companion object {
        private const val KEY_REPORTED = "reported"
        private const val KEY_CONSENT_PREFIX = "consent:"
        private const val KEY_EVER_AGREED = "everAgreed"
        private const val CONSENT_YES = "yes"
        private const val CONSENT_NO = "no"

        /** Lenient: a reply that says nothing about `tracking` means carry on; only an explicit stop stops. */
        fun parseReply(o: JsonObject): TrailReply {
            fun str(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
            fun instant(k: String) = str(k)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
            return TrailReply(
                tracking = (o["tracking"] as? JsonPrimitive)?.booleanOrNull ?: true,
                stage = str("stage"),
                outsideSinceMillis = instant("outsideSince"),
                nextAtMillis = instant("nextAt"),
            )
        }
    }
}
