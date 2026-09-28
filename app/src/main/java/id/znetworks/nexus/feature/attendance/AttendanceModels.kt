package id.znetworks.nexus.feature.attendance

import kotlinx.serialization.Serializable

// Shapes from API.md §2.2. Everything optional: a field the server drops or renames must cost one
// label, never the whole Attendance screen.

@Serializable
data class OfficeRef(
    val id: String? = null,
    val name: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val radiusMeters: Double? = null,
    val isActive: Boolean? = null,
)

@Serializable
data class AttendanceRecord(
    val id: String,
    val attendanceDate: String? = null,
    val checkInAt: String? = null,
    val checkOutAt: String? = null,
    val checkInStatus: String? = null,
    val checkOutStatus: String? = null,
    val lateMinutes: Int? = null,
    val status: String? = null,
    val checkOutOffsite: Boolean? = null,
    /** "PENDING" | "APPROVED" | "REJECTED" | null */
    val checkOutApproval: String? = null,
    val officeLocation: OfficeRef? = null,
    val locationTrackingState: String? = null,
    /** Start of the current outside-the-office episode (server), null when inside. */
    val outsideSince: String? = null,
    /** Where the check-in was made, reverse-geocoded by the server (older servers omit it). */
    val checkInAddress: String? = null,
    /** Checked in outside the office radius (location-free); servers from 28 Sep 2026. */
    val checkInAway: Boolean? = null,
    val checkInDistanceMeters: Double? = null,
    val checkInLat: Double? = null,
    val checkInLng: Double? = null,
    /** The server's worked minutes for the day, when it sends them. */
    val workedMinutes: Int? = null,
) {
    /** Per record, not per person: a location-free member who checked in inside the radius is at the office. */
    val checkedInAway: Boolean? get() = AttendancePlace.isAway(checkInAway, checkInDistanceMeters, officeLocation?.radiusMeters)
    val placeLabel: String? get() = AttendancePlace.label(checkedInAway, checkInAddress, checkInLat, checkInLng, officeLocation?.name)
    val hasCheckedIn: Boolean get() = !checkInAt.isNullOrBlank()
    val hasCheckedOut: Boolean get() = !checkOutAt.isNullOrBlank()
}

/**
 * Where a day was worked (iOS a0f1de4, server `lib/attendance-place.ts`): a check-in away from the
 * office shows the address it was made at, one inside the radius the office, location-free or not.
 */
object AttendancePlace {
    /** The server's flag first; an older server's answer from distance vs radius; null when unknown. */
    fun isAway(flag: Boolean?, distance: Double?, radius: Double?): Boolean? =
        flag ?: if (distance != null && radius != null) distance > radius else null

    /** The first two comma parts of a reverse-geocoded address. */
    fun shortAddress(address: String?): String? =
        address?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }?.take(2)?.joinToString(", ")

    /** Away → short address, else coordinates, never the office; null when away with neither. Not away → the office. */
    fun label(away: Boolean?, address: String?, lat: Double?, lng: Double?, office: String?): String? {
        if (away != true) return office?.takeIf { it.isNotEmpty() }
        shortAddress(address)?.let { return it }
        if (lat != null && lng != null) return String.format(java.util.Locale.US, "%.5f, %.5f", lat, lng)
        return null
    }
}

@Serializable
data class MyShift(
    val startTime: String? = null,
    val endTime: String? = null,
    val source: String? = null,
    val flexi: Boolean? = null,
)

@Serializable
data class AnnualLeave(
    val eligible: Boolean? = null,
    val reason: String? = null,
    val quota: Int? = null,
    val used: Int? = null,
    val remaining: Int? = null,
)

/** Extra day off (UPDATES §5, server e910294): `dayOffQuota` already includes [bonus]. */
@Serializable
data class DayOffAllowance(
    val period: String? = null,
    val base: Int? = null,
    val bonus: Int? = null,
    val grants: List<DayOffGrant> = emptyList(),
)

@Serializable
data class DayOffGrant(val days: Int? = null, val reason: String? = null)

@Serializable
data class TodayRequest(
    val id: String? = null,
    val type: String? = null,
    val status: String? = null,
)

@Serializable
data class WorkspaceRef(val id: String? = null, val name: String? = null, val slug: String? = null)

@Serializable
data class AttendanceToday(
    val attendanceDateKey: String? = null,
    val workspace: WorkspaceRef? = null,
    val today: AttendanceRecord? = null,
    /** An EARLIER day still open: the next check-out closes it, and check-in is blocked until then. */
    val pendingCheckout: AttendanceRecord? = null,
    val todayRequest: TodayRequest? = null,
    val dayOffQuota: Int? = null,
    val dayOffUsedThisMonth: Int? = null,
    val dayOffAllowance: DayOffAllowance? = null,
    val restDays: List<Int>? = null,
    val isRestDayToday: Boolean? = null,
    val redDateQuota: Int? = null,
    val redDateUsedThisMonth: Int? = null,
    val myShift: MyShift? = null,
    val noGeofence: Boolean? = null,
    val canManageAttendance: Boolean? = null,
    val canReviewAttendanceRequests: Boolean? = null,
    val annualLeave: AnnualLeave? = null,
    val viewerId: String? = null,
)

@Serializable
data class OfficesResponse(val offices: List<OfficeRef> = emptyList())

@Serializable
internal data class CheckResponse(
    val record: AttendanceRecord? = null,
    val pendingApproval: Boolean = false,
    val duplicate: Boolean = false,
)

/**
 * One GPS fix with the signals the server's layer-2 check reads (REQ-ATT-09). Honest values only:
 * the phone reports, the server judges.
 */
@Serializable
data class LocationFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double? = null,
    val altitudeM: Double? = null,
    val speedMps: Double? = null,
    val simulated: Boolean = false,
    val capturedAtMillis: Long = 0,
)

enum class AttendanceKind { CHECK_IN, CHECK_OUT }

/** What a check-in/out came back with, when the server made a decision about the tap itself. */
sealed interface AttendanceOutcome {
    data class Success(val record: AttendanceRecord?, val pendingApproval: Boolean, val duplicate: Boolean) : AttendanceOutcome

    /**
     * Outside the office radius. On check-out this is `code: OUTSIDE_RADIUS` and opens the offsite
     * flow. On check-in the server sends no code, only `officeName/distanceMeters/radiusMeters`.
     */
    data class OutsideRadius(val officeName: String?, val distanceMeters: Double?, val radiusMeters: Double?) : AttendanceOutcome
}

/** Replay-only fields: their presence is what marks a record `offline` on the server. */
data class ReplayStamp(val deviceAtMillis: Long, val uptimeSec: Long)
