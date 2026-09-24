package id.znetworks.nexus.feature.attendance

import android.app.Application
import android.content.pm.PackageManager
import android.location.Location
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.meansOriginUnreachable
import id.znetworks.nexus.core.net.nobodyAnswered
import id.znetworks.nexus.feature.attendance.liveness.FaceGuard
import id.znetworks.nexus.feature.push.LocalReminders
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.roundToInt

/** The capture flow card drawn over the screen (iOS `Flow`). */
sealed interface CaptureFlow {
    val kind: AttendanceKind
    data class Locating(override val kind: AttendanceKind) : CaptureFlow
    data class Sending(override val kind: AttendanceKind) : CaptureFlow
    data class Done(override val kind: AttendanceKind, val at: String, val pendingApproval: Boolean) : CaptureFlow
    data class SavedOffline(override val kind: AttendanceKind, val at: String) : CaptureFlow
    data class Failed(override val kind: AttendanceKind, val message: String, val fix: FixHint? = null) : CaptureFlow
    val busy: Boolean get() = this is Locating || this is Sending
}

/** The next step a refusal points to (REQ-ATT-00b: no dead ends). */
enum class FixHint { APP_SETTINGS, LOCATION_SETTINGS }

data class NearestOffice(val name: String, val distanceMeters: Double, val inside: Boolean, val lat: Double, val lng: Double, val radius: Double)

data class AttendanceUiState(
    val today: AttendanceToday? = null,
    val loading: Boolean = true,
    /** Nobody answered: offline check-in mode (REQ-ATT-17). */
    val serverDown: Boolean = false,
    /** The server answered with a refusal we could not read past. */
    val error: String? = null,
    /** Set when [today] came off the disk: "Saved copy from HH:mm". */
    val savedCopyAt: Long? = null,
    val flow: CaptureFlow? = null,
    val banner: Pair<String, Boolean>? = null,
    val reflection: String = "",
    /** The check-out came back OUTSIDE_RADIUS: ask for a reason and resend as offsite. */
    val offsitePrompt: Boolean = false,
    val offsiteReason: String = "",
    val nearest: NearestOffice? = null,
    /** Display-only position for the hero map. Never sent. */
    val here: LocationFix? = null,
    val locationOff: Boolean = false,
    /** No front camera or no GPS (ChromeOS, some tablets): read-only (REQ-ATT-39). */
    val canTakeAttendance: Boolean = true,
    /** Waiting for the camera (liveness) screen for this kind. */
    val capturing: AttendanceKind? = null,
)

class AttendanceViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val res get() = getApplication<Application>().resources
    private val queue = c.attendanceQueue

    private val _state = MutableStateFlow(AttendanceUiState(canTakeAttendance = deviceCanTakeAttendance(app)))
    val state: StateFlow<AttendanceUiState> = _state.asStateFlow()
    val queueState = queue.state

    /** Kept whole so the offsite resend carries the same selfie and evidence as the first try. */
    private var pendingSelfie: ByteArray? = null
    private var pendingFix: LocationFix? = null
    private var autoClose: Job? = null

    private val userId get() = c.sessionStore.current?.userId.orEmpty()

    init {
        viewModelScope.launch {
            // Drain before loading: a queued tap that lands now shows in the numbers fetched next.
            queue.flush()
            load()
        }
    }

    // region derived state (mirrors iOS AttendanceView)

    fun checkedIn(s: AttendanceUiState) = s.today?.today?.hasCheckedIn == true || queue.state.value.has(AttendanceKind.CHECK_IN)
    fun checkedOut(s: AttendanceUiState) = s.today?.today?.hasCheckedOut == true || queue.state.value.has(AttendanceKind.CHECK_OUT)
    fun forcePending(s: AttendanceUiState) = s.today?.pendingCheckout != null
    fun offsitePending(s: AttendanceUiState) = s.today?.today?.checkOutApproval == "PENDING"
    fun needsReflection(s: AttendanceUiState) = (checkedIn(s) || forcePending(s)) && !checkedOut(s)
    fun reflectionCount(s: AttendanceUiState) = s.reflection.trim().length
    fun reflectionOk(s: AttendanceUiState) = reflectionCount(s) >= REFLECTION_MIN

    // endregion

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true) }
        try {
            val today = c.attendanceApi.today()
            c.todayCache.save(userId, today)
            _state.update { it.copy(today = today, loading = false, serverDown = false, error = null, savedCopyAt = null) }
            c.workTrail.sync(today, queue.state.value.has(AttendanceKind.CHECK_OUT))
            LocalReminders.sync(getApplication(), today, c.push.deliveryActive.value)
            restoreDraft(today)
        } catch (e: ApiError) {
            if (e === ApiError.Unauthorized) return@launch
            if (e.nobodyAnswered()) {
                // Nothing answered: the saved copy is the best account of today anyone has.
                val saved = c.todayCache.load(userId)
                _state.update {
                    it.copy(loading = false, serverDown = true, error = null,
                        today = saved?.today ?: it.today, savedCopyAt = saved?.savedAtMillis ?: it.savedCopyAt)
                }
                saved?.today?.let(::restoreDraft)
            } else {
                // The server DID answer. Believe it: what is drawn stays, but it stops claiming to be live.
                _state.update { it.copy(loading = false, error = e.describe(res)) }
            }
        }
        refreshNearest()
    }

    fun onReflection(text: String) {
        _state.update { it.copy(reflection = text) }
        c.reflectionDrafts.save(userId, draftTarget(_state.value), text)
    }

    fun onLocationPermissionResult() {
        _state.update { it.copy(locationOff = !c.location.hasFine()) }
        refreshNearest()
    }

    /** PRESENCE IN / OUT. Location permission is checked first, so no face check is wasted. */
    fun startCapture(kind: AttendanceKind) {
        autoClose?.cancel()
        _state.update { it.copy(banner = null, capturing = kind, flow = null, offsitePrompt = false) }
    }

    fun cancelCapture() = _state.update { it.copy(capturing = null) }

    fun heldNoticeSeen() = queue.heldNoticeSeen()

    fun dismissFlow() {
        if (_state.value.flow?.busy == true) return
        _state.update { it.copy(flow = null) }
    }

    fun onSelfie(selfie: ByteArray) {
        val kind = _state.value.capturing ?: return
        _state.update { it.copy(capturing = null) }
        viewModelScope.launch { submit(kind, selfie) }
    }

    private suspend fun submit(kind: AttendanceKind, selfie: ByteArray) {
        // A selfie with no face is not an attendance photo: refused before the fix and the upload.
        when (FaceGuard.check(selfie)) {
            FaceGuard.Verdict.OK -> Unit
            FaceGuard.Verdict.NO_FACE -> return fail(kind, res.getString(R.string.face_guard_no_face))
            FaceGuard.Verdict.UNREADABLE -> return fail(kind, res.getString(R.string.face_guard_unreadable))
        }
        pendingSelfie = selfie
        // One id for this tap, sent live AND reused if it ends up queued: the same event to the server.
        val tapId = UUID.randomUUID().toString()
        _state.update { it.copy(flow = CaptureFlow.Locating(kind)) }
        val fix = try {
            c.location.currentFix()
        } catch (e: LocationProvider.Failure) {
            return locationFailed(kind, e)
        }
        pendingFix = fix
        val reflection = _state.value.reflection
        val sentAt = System.currentTimeMillis()
        val uptime = SystemClock.elapsedRealtime() / 1000
        _state.update { it.copy(flow = CaptureFlow.Sending(kind)) }
        try {
            val outcome = when (kind) {
                AttendanceKind.CHECK_IN -> c.attendanceApi.checkIn(selfie, fix, tapId)
                AttendanceKind.CHECK_OUT -> c.attendanceApi.checkOut(selfie, fix, reflection, offsite = false, reason = null, clientId = tapId)
            }
            handleOutcome(kind, outcome)
        } catch (e: ApiError) {
            handleSendError(kind, e, tapId, selfie, fix, sentAt, uptime, reflection, offsite = false, reason = null)
        }
    }

    fun onOffsiteReason(text: String) = _state.update { it.copy(offsiteReason = text) }
    fun cancelOffsite() = _state.update { it.copy(offsitePrompt = false, offsiteReason = "") }

    /** Same selfie and fix as the refused check-out, a NEW clientId (it is a new request). */
    fun submitOffsite() {
        val selfie = pendingSelfie ?: return
        val fix = pendingFix ?: return
        val reason = _state.value.offsiteReason.trim()
        if (reason.isEmpty()) return
        val reflection = _state.value.reflection
        _state.update { it.copy(offsitePrompt = false, flow = CaptureFlow.Sending(AttendanceKind.CHECK_OUT)) }
        viewModelScope.launch {
            val tapId = UUID.randomUUID().toString()
            val sentAt = System.currentTimeMillis()
            val uptime = SystemClock.elapsedRealtime() / 1000
            try {
                val outcome = c.attendanceApi.checkOut(selfie, fix, reflection, offsite = true, reason = reason, clientId = tapId)
                handleOutcome(AttendanceKind.CHECK_OUT, outcome)
            } catch (e: ApiError) {
                handleSendError(AttendanceKind.CHECK_OUT, e, tapId, selfie, fix, sentAt, uptime, reflection, offsite = true, reason = reason)
            }
        }
    }

    private fun handleOutcome(kind: AttendanceKind, outcome: AttendanceOutcome) {
        when (outcome) {
            is AttendanceOutcome.Success -> {
                val at = LocalNotifier.hhmm(System.currentTimeMillis())
                val bannerText = when {
                    outcome.pendingApproval -> res.getString(R.string.banner_offsite_sent)
                    kind == AttendanceKind.CHECK_IN -> res.getString(R.string.banner_checkin_ok)
                    else -> res.getString(R.string.banner_checkout_ok)
                }
                _state.update {
                    it.copy(flow = CaptureFlow.Done(kind, at, outcome.pendingApproval), banner = bannerText to true, offsiteReason = "")
                }
                if (kind == AttendanceKind.CHECK_OUT) clearReflection()
                load()
                closeSoon()
            }
            is AttendanceOutcome.OutsideRadius -> when (kind) {
                AttendanceKind.CHECK_OUT -> _state.update { it.copy(flow = null, offsitePrompt = true, offsiteReason = "") }
                // There is no offsite check-in: say how far, and what to do.
                AttendanceKind.CHECK_IN -> fail(kind, tooFar(outcome))
            }
        }
    }

    private fun handleSendError(
        kind: AttendanceKind,
        e: ApiError,
        tapId: String,
        selfie: ByteArray,
        fix: LocationFix,
        sentAt: Long,
        uptime: Long,
        reflection: String,
        offsite: Boolean,
        reason: String?,
    ) {
        when {
            e === ApiError.Unauthorized -> _state.update { it.copy(flow = null) }
            // Nobody decided anything about this tap: keep it, with the time it was sent.
            e.meansOriginUnreachable() -> {
                enqueue(kind, tapId, selfie, fix, sentAt, uptime, reflection, offsite, reason)
                _state.update {
                    it.copy(serverDown = true, flow = CaptureFlow.SavedOffline(kind, LocalNotifier.hhmm(sentAt)),
                        banner = res.getString(R.string.banner_saved_offline) to true)
                }
                c.flushQueueSoon()
            }
            // The BUILD was refused, not the tap: kept for the updated build, which sends it with
            // the original time (REQ-ATT-43). The lock screen replaces this one.
            e is ApiError.UpgradeRequired -> {
                enqueue(kind, tapId, selfie, fix, sentAt, uptime, reflection, offsite, reason)
                queue.holdForUpdate()
                _state.update { it.copy(flow = null) }
            }
            else -> fail(kind, e.describe(res))
        }
    }

    private fun enqueue(
        kind: AttendanceKind, id: String, selfie: ByteArray, fix: LocationFix, sentAt: Long, uptime: Long,
        reflection: String, offsite: Boolean, reason: String?,
    ) {
        queue.enqueue(
            id = id, kind = kind, selfie = selfie, fix = fix, deviceAtMillis = sentAt, uptimeSec = uptime,
            reflection = if (kind == AttendanceKind.CHECK_OUT) reflection.trim() else null,
            offsite = offsite, reason = reason,
        )
        if (kind == AttendanceKind.CHECK_OUT) {
            clearReflection()
            // A check-out saved offline still ends the day: the trail stops now (keeping its points).
            c.workTrail.sync(_state.value.today, queuedCheckOut = true)
        }
    }

    private fun locationFailed(kind: AttendanceKind, e: LocationProvider.Failure) {
        val (msg, hint) = when (e) {
            is LocationProvider.Failure.Denied -> res.getString(R.string.location_denied) to FixHint.APP_SETTINGS
            is LocationProvider.Failure.ApproximateOnly -> res.getString(R.string.location_approximate) to FixHint.APP_SETTINGS
            is LocationProvider.Failure.ServicesOff -> res.getString(R.string.location_services_off) to FixHint.LOCATION_SETTINGS
            is LocationProvider.Failure.Unavailable -> res.getString(R.string.location_unavailable) to null
        }
        _state.update { it.copy(locationOff = e !is LocationProvider.Failure.Unavailable) }
        fail(kind, msg, hint)
    }

    private fun fail(kind: AttendanceKind, message: String, hint: FixHint? = null) =
        _state.update { it.copy(flow = CaptureFlow.Failed(kind, message, hint), banner = message to false) }

    private fun tooFar(o: AttendanceOutcome.OutsideRadius): String {
        val d = o.distanceMeters
        val r = o.radiusMeters
        return if (d != null && r != null && o.officeName != null) {
            res.getString(R.string.checkin_too_far, d.roundToInt(), o.officeName, r.roundToInt())
        } else {
            res.getString(R.string.checkin_outside_generic)
        }
    }

    private fun closeSoon() {
        val shown = _state.value.flow
        autoClose?.cancel()
        autoClose = viewModelScope.launch {
            delay(1_600)
            if (_state.value.flow == shown) _state.update { it.copy(flow = null) }
        }
    }

    private fun clearReflection() {
        _state.update { it.copy(reflection = "") }
        c.reflectionDrafts.clearAll()
    }

    /** The record the next check-out closes: an earlier open day first, else today. */
    private fun draftTarget(s: AttendanceUiState): String =
        s.today?.pendingCheckout?.id ?: s.today?.today?.id ?: s.today?.attendanceDateKey.orEmpty()

    private fun restoreDraft(today: AttendanceToday) {
        if (_state.value.reflection.isNotEmpty()) return
        val saved = c.reflectionDrafts.load(userId, draftTarget(_state.value.copy(today = today)))
        if (saved.isNotEmpty()) _state.update { it.copy(reflection = saved) }
    }

    /**
     * Which office the person is near, before a check-in only (REQ-ATT-08). Display only: the
     * geofence verdict is always the server's.
     */
    private fun refreshNearest() = viewModelScope.launch {
        val s = _state.value
        _state.update { it.copy(locationOff = !c.location.hasFine() && !c.location.hasCoarse()) }
        val offices = runCatching { c.attendanceApi.offices() }.getOrNull().orEmpty()
            .filter { it.isActive != false && it.latitude != null && it.longitude != null }
        if (offices.isEmpty()) return@launch
        val fix = c.location.roughFix() ?: return@launch
        _state.update { it.copy(here = fix) }
        val best = offices.map { o ->
            val out = FloatArray(1)
            Location.distanceBetween(fix.lat, fix.lng, o.latitude!!, o.longitude!!, out)
            o to out[0].toDouble()
        }.minByOrNull { it.second } ?: return@launch
        _state.update {
            it.copy(nearest = NearestOffice(best.first.name.orEmpty(), best.second, best.second <= (best.first.radiusMeters ?: 100.0),
                best.first.latitude!!, best.first.longitude!!, best.first.radiusMeters ?: 100.0))
        }
    }

    companion object {
        const val REFLECTION_MIN = 200

        /**
         * A phone with a front camera and GPS. Tablets are read-only by owner decision (24 Sep 2026),
         * and so is anything without the hardware (ChromeOS).
         */
        fun deviceCanTakeAttendance(app: Application): Boolean {
            val pm = app.packageManager
            val tablet = app.resources.configuration.smallestScreenWidthDp >= 600
            return !tablet && pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT) &&
                pm.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
        }
    }
}
