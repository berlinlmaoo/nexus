package id.znetworks.nexus.feature.attendance.requests

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.LocationFix
import id.znetworks.nexus.feature.attendance.LocationProvider
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

data class ComposerState(
    val type: String = "DAY_OFF",
    val date: LocalDate = OfficeTime.today(),
    val reason: String = "",
    val attachment: Attachment? = null,
    val attachmentError: String? = null,
    val location: LocationFix? = null,
    val locating: Boolean = false,
    val locationError: String? = null,
    val sending: Boolean = false,
    val error: String? = null,
    /** Opened from "File a permit" (push / 1 h 30 outside): the reason is started, not finished. */
    val prefillReason: String? = null,
)

data class RequestsUiState(
    val requests: List<AttendanceRequest> = emptyList(),
    val offsite: List<OffsiteCheckout> = emptyList(),
    val loading: Boolean = true,
    val loadError: String? = null,
    /** null = the default for this viewer (reviewers: PENDING, everyone else: ALL). */
    val statusFilter: String? = null,
    val window: SubmissionWindow = SubmissionWindow.RECENT,
    val query: String = "",
    val busyId: String? = null,
    val actionError: String? = null,
    val rejecting: AttendanceRequest? = null,
    val composer: ComposerState? = null,
    /** Opened from a push / inbox row: that one request or offsite check-out, with its actions. */
    val focus: SubmissionEntry? = null,
    val focusMissing: Boolean = false,
)

class RequestsViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = RequestsApi(c.api)
    private val res get() = getApplication<Application>().resources

    private val _state = MutableStateFlow(RequestsUiState())
    val state: StateFlow<RequestsUiState> = _state.asStateFlow()

    var today: AttendanceToday? = null
        private set

    val canReview get() = today?.canReviewAttendanceRequests == true || today?.canManageAttendance == true
    val canGrant get() = today?.canManageAttendance == true
    val viewerId get() = today?.viewerId ?: c.sessionStore.current?.userId
    fun activeFilter(s: RequestsUiState) = s.statusFilter ?: if (canReview) "PENDING" else "ALL"
    fun rules() = RequestRules(today, canGrant)

    private var loadedFor: Boolean? = null
    private var wanted: Pair<String?, String?>? = null
    private var permitWanted = false
    private var loadedOnce = false

    /** Called whenever Attendance has a fresh `today`: the permissions may have just arrived. */
    fun onToday(t: AttendanceToday?) {
        today = t
        if (t != null && permitWanted) claimFocus()
        if (t != null && loadedFor != canReview) {
            loadedFor = canReview
            load()
        }
    }

    fun load() = viewModelScope.launch {
        val scope = if (canReview) "workspace" else "me"
        try {
            // The nightly cron's own penalties are not submissions (filtered here too, not trusted).
            val list = api.list(scope).filterNot { it.isAutoDeduction }
            _state.update { it.copy(requests = list, loading = false, loadError = null) }
        } catch (e: ApiError) {
            if (e === ApiError.Unauthorized) return@launch
            _state.update { it.copy(loading = false, loadError = e.describe(res)) }
        }
        // Separately: a 403 or an outage here must leave the requests on screen alone. The server
        // allows BoD and managers with direct reports (their reports only).
        val offsite = if (canReview) runCatching { api.offsite() }.getOrElse { emptyList() } else emptyList()
        _state.update { it.copy(offsite = offsite) }
        loadedOnce = true
        claimFocus()
    }

    /** `/attendance?request=` / `?offsite=`: held until the list is in, then shown or said missing. */
    fun focus(requestId: String?, offsiteId: String?) {
        wanted = requestId to offsiteId
        if (loadedOnce) load() else claimFocus()
    }

    /** `/attendance?permit=today` ("File a permit" on the outside-office push). */
    fun openPermitToday() {
        permitWanted = true
        if (today != null) { permitWanted = false; openComposer(permitToday = true) }
    }

    private fun claimFocus() {
        if (permitWanted && today != null) { permitWanted = false; openComposer(permitToday = true) }
        val (req, off) = wanted ?: return
        if (!loadedOnce) return
        wanted = null
        val s = _state.value
        val entry = req?.let { id -> s.requests.firstOrNull { it.id == id }?.let { SubmissionEntry.Req(it) } }
            ?: off?.let { id -> s.offsite.firstOrNull { it.id == id }?.let { SubmissionEntry.Offsite(it) } }
        _state.update { it.copy(focus = entry, focusMissing = entry == null) }
    }

    fun closeFocus() = _state.update { it.copy(focus = null, focusMissing = false) }

    fun setFilter(f: String) = _state.update { it.copy(statusFilter = f) }
    fun setWindow(w: SubmissionWindow) = _state.update { it.copy(window = w) }
    fun setQuery(q: String) = _state.update { it.copy(query = q) }
    fun dismissActionError() = _state.update { it.copy(actionError = null) }

    fun review(r: AttendanceRequest, action: String, note: String? = null, done: () -> Unit = {}) = viewModelScope.launch {
        _state.update { it.copy(busyId = r.id, actionError = null) }
        try {
            api.review(r.id, action, note)
            _state.update { it.copy(rejecting = null) }
            done()
        } catch (e: ApiError) {
            _state.update { it.copy(actionError = e.describe(res)) }
        }
        _state.update { it.copy(busyId = null, focus = null) }
        load()
    }

    fun startReject(r: AttendanceRequest) = _state.update { it.copy(rejecting = r, actionError = null) }
    fun cancelReject() = _state.update { it.copy(rejecting = null) }

    fun reviewOffsite(o: OffsiteCheckout, action: String) = viewModelScope.launch {
        _state.update { it.copy(busyId = o.id, actionError = null) }
        try {
            api.reviewOffsite(o.id, action)
        } catch (e: ApiError) {
            _state.update { it.copy(actionError = e.describe(res)) }
        }
        _state.update { it.copy(busyId = null, focus = null) }
        load()
    }

    // region composer

    fun openComposer(permitToday: Boolean = false) {
        val types = rules().types
        val start = if (permitToday) "PERMIT" else types.firstOrNull { it == "DAY_OFF" } ?: types.first()
        val prefill = if (permitToday) res.getString(R.string.permit_prefill) else null
        _state.update { it.copy(composer = ComposerState(type = start, reason = prefill.orEmpty(), prefillReason = prefill)) }
        if (start == "PERMIT") pickType("PERMIT")
    }

    fun closeComposer() = _state.update { it.copy(composer = null) }

    private fun updateComposer(change: (ComposerState) -> ComposerState) =
        _state.update { s -> s.composer?.let { s.copy(composer = change(it)) } ?: s }

    /** Switching type is not only a label: the date floor and the location follow at once. */
    fun pickType(type: String) {
        val rules = rules()
        updateComposer { cs ->
            val floor = rules.earliest(type)
            cs.copy(
                type = type,
                error = null,
                attachment = if (rules.showsAttachment(type)) cs.attachment else null,
                date = if (floor != null && cs.date.isBefore(floor)) floor else cs.date,
            )
        }
        // Asked the moment izin is picked, not at submit (REQ-ATT-28).
        if (rules.needsLocation(type) && _state.value.composer?.location == null) lockLocation()
    }

    fun setDate(d: LocalDate) = updateComposer { it.copy(date = d, error = null) }
    fun setReason(r: String) = updateComposer { it.copy(reason = r, error = null) }
    fun clearAttachment() = updateComposer { it.copy(attachment = null) }

    fun attach(uri: Uri) = viewModelScope.launch {
        val type = _state.value.composer?.type ?: return@launch
        val name = rules().cameraFileName(type)
        val result = withContext(Dispatchers.IO) { AttachmentReader.read(getApplication(), uri, name) }
        updateComposer {
            when (result) {
                is AttachmentReader.Result.Ok -> it.copy(attachment = result.attachment, attachmentError = null)
                AttachmentReader.Result.TooBig -> it.copy(attachmentError = res.getString(R.string.attach_too_big))
                AttachmentReader.Result.Unsupported -> it.copy(attachmentError = res.getString(R.string.attach_unsupported))
                AttachmentReader.Result.Unreadable -> it.copy(attachmentError = res.getString(R.string.attach_unreadable))
            }
        }
    }

    fun lockLocation() = viewModelScope.launch {
        updateComposer { it.copy(locating = true, locationError = null) }
        try {
            val fix = c.location.currentFix()
            updateComposer { it.copy(location = fix, locating = false) }
        } catch (e: LocationProvider.Failure) {
            val msg = res.getString(
                when (e) {
                    is LocationProvider.Failure.Denied -> R.string.location_denied
                    is LocationProvider.Failure.ApproximateOnly -> R.string.location_approximate
                    is LocationProvider.Failure.ServicesOff -> R.string.location_services_off
                    is LocationProvider.Failure.Unavailable -> R.string.location_unavailable
                },
            )
            updateComposer { it.copy(locating = false, locationError = msg) }
        }
    }

    fun submit(onFiled: () -> Unit) {
        val cs = _state.value.composer ?: return
        val rules = rules()
        if (rules.missing(cs.type, cs.reason, cs.attachment != null, cs.location != null, cs.date, prefillReason = cs.prefillReason) != null) return
        updateComposer { it.copy(sending = true, error = null) }
        viewModelScope.launch {
            try {
                val loc = if (rules.needsLocation(cs.type) || cs.type == "PERMIT") cs.location else null
                api.create(cs.type, cs.date.toString(), cs.reason, cs.attachment, loc?.lat, loc?.lng)
                // A request for today holds the outside-the-office clock on the server the moment it
                // exists (PENDING counts): the countdown in the notification goes now (iOS 8a36fd2).
                if (cs.date == OfficeTime.today()) c.workTrail.excuseFiled()
                _state.update { it.copy(composer = null) }
                load()
                onFiled()
            } catch (e: ApiError) {
                // The server's own sentence (PERMIT_NOT_DAYOFF, quota…), and the form stays filled.
                updateComposer { it.copy(sending = false, error = e.describe(res)) }
            }
        }
    }

    // endregion
}
