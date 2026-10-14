package id.znetworks.nexus.feature.attendance.history

import id.znetworks.nexus.feature.attendance.AttendancePlace
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.feature.attendance.OfficeRef
import id.znetworks.nexus.feature.attendance.requests.PersonRef
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.Request

/** One row of `GET /api/attendance/history` (API.md §2.2): a record, a synthesised request day, or an absence. */
@Serializable
data class HistoryRow(
    val id: String? = null,
    val attendanceDate: String? = null,
    val checkInAt: String? = null,
    val checkOutAt: String? = null,
    val checkInStatus: String? = null,
    val checkOutStatus: String? = null,
    val lateMinutes: Int? = null,
    val workedMinutes: Int? = null,
    val status: String? = null,
    val recordKind: String? = null,
    val attendanceDayType: String? = null,
    val requestType: String? = null,
    val requestStatus: String? = null,
    val checkInAddress: String? = null,
    val checkOutAddress: String? = null,
    val checkInDistanceMeters: Double? = null,
    val checkOutDistanceMeters: Double? = null,
    val checkInAway: Boolean? = null,
    val checkInLat: Double? = null,
    val checkInLng: Double? = null,
    val checkInPhotoUrl: String? = null,
    val checkOutPhotoUrl: String? = null,
    val checkOutOffsite: Boolean? = null,
    val checkOutApproval: String? = null,
    val checkOutReason: String? = null,
    val checkOutReflection: String? = null,
    val effectiveShiftStartTime: String? = null,
    val effectiveShiftEndTime: String? = null,
    val isCorrected: Boolean? = null,
    val correctionReason: String? = null,
    val supportingDocumentUrl: String? = null,
    val supportingDocumentName: String? = null,
    val locationTrackingState: String? = null,
    /** When the person left the office (still outside while there is no check-out); servers before 8 Oct send none. */
    val outsideSince: String? = null,
    val officeLocation: OfficeRef? = null,
    val user: PersonRef? = null,
    val reviewedBy: PersonRef? = null,
) {
    val checkedInAway: Boolean? get() = AttendancePlace.isAway(checkInAway, checkInDistanceMeters, officeLocation?.radiusMeters)
    /** A real check-in record (only these can be edited or have a trail). */
    val isRecord: Boolean get() = (recordKind ?: if (checkInAt != null) "ATTENDANCE" else "") == "ATTENDANCE" && id != null
    val dayKey: String get() = attendanceDate.orEmpty().take(10)
}

/**
 * [roster] (scope=workspace, server 28 Sep 2026): everyone who belongs on the board, with or
 * without a row yet. Absent on older servers and on scope=me.
 */
@Serializable
data class HistoryResponse(val records: List<HistoryRow> = emptyList(), val roster: List<PersonRef> = emptyList())

@Serializable
data class TrailResponse(
    val record: TrailRecord? = null,
    val points: List<TrailPointDto> = emptyList(),
    val outsideSpans: List<TrailSpan> = emptyList(),
    /** One entry per clock hour of the shift (server presenceHours); absent on older servers. */
    val presence: List<PresenceHour> = emptyList(),
)

/** status: inside | outside | unclear | pending | gap (anything else draws as unclear). */
@Serializable
data class PresenceHour(val from: String, val to: String? = null, val label: String? = null, val status: String = "unclear", val at: String? = null)

@Serializable
data class TrailRecord(
    val id: String? = null,
    val userName: String? = null,
    val date: String? = null,
    val checkInAt: String? = null,
    val checkOutAt: String? = null,
    val checkOutOffsite: Boolean? = null,
    val office: TrailOffice? = null,
    val locationTrackingState: String? = null,
    /** Servers from 28 Sep 2026: away check-in, its address, and the day's place as text. */
    val checkInAway: Boolean? = null,
    val checkInAddress: String? = null,
    val placeLabel: String? = null,
)

@Serializable
data class TrailOffice(val name: String? = null, val lat: Double, val lng: Double, val radiusMeters: Double? = null)

@Serializable
data class TrailPointDto(val lat: Double, val lng: Double, val accuracy: Double? = null, val at: String, val inside: Boolean? = null, val event: String? = null)

@Serializable
data class TrailSpan(val from: String, val to: String? = null)

@Serializable
data class OverrideBody(val userId: String, val date: String, val action: String, val note: String? = null)

@Serializable
data class OverrideResponse(
    val ok: Boolean = false,
    val action: String? = null,
    val date: String? = null,
    val refunded: Boolean? = null,
    val alreadyCovered: Boolean? = null,
    val closedAttendance: Boolean? = null,
    val multiDayRequestsLeft: Int? = null,
)

class HistoryApi(private val api: ApiClient) {
    /**
     * BoD "Change status" on one member-day (web StatusOverridePanel, iOS 461cb65). Every action
     * refunds that day's auto day-off cut and XP penalties; a multi-day request conflict is a 409.
     */
    suspend fun override(userId: String, date: String, action: String, note: String? = null): OverrideResponse =
        api.postJson("/api/attendance/override", OverrideBody(userId, date, action, note), OverrideBody.serializer(), OverrideResponse.serializer())

    /** [period] is the 28→27 period key `YYYY-MM`; `workspace` needs BoD or direct reports. */
    /** Cached (saved copy offline), like iOS: the board opens with no signal. */
    /** When the last [history] answer is a saved copy, when it was saved (audit S4); null = live. */
    var historySavedAtMillis: Long? = null

    suspend fun history(scope: String, period: String, userId: String? = null): HistoryResponse =
        api.getCached("/api/attendance/history?scope=$scope&month=$period" + (userId?.takeIf { scope != "me" }?.let { "&userId=$it" } ?: ""),
            "history-$scope-$period" + (userId?.takeIf { scope != "me" }?.let { "-$it" } ?: ""), HistoryResponse.serializer())
            .also { historySavedAtMillis = it.savedAtMillis }.value

    suspend fun trail(recordId: String): TrailResponse =
        api.get("/api/attendance/records/$recordId/trail", TrailResponse.serializer())

    /** BoD cleanup: the whole record, or only its check-out (reopens the day). Audited server-side. */
    suspend fun deleteRecord(recordId: String, checkoutOnly: Boolean) {
        val q = if (checkoutOnly) "?part=checkout" else ""
        api.send(Request.Builder().url(api.url("/api/attendance/records/$recordId$q")).delete().build(), JsonObject.serializer())
    }

    suspend fun exportXlsx(period: String): ByteArray = api.bytes("/api/attendance/history?scope=workspace&month=$period&format=xlsx")
}
