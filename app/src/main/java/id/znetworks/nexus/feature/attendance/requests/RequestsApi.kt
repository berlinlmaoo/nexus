package id.znetworks.nexus.feature.attendance.requests

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// API.md §2.2 (requests) and §2.3 (offsite review). Tolerant like every other model.

@Serializable
data class PersonRef(
    val id: String? = null,
    val name: String? = null,
    val email: String? = null,
    val avatar: String? = null,
    /** On history rows (server c2ba2a1): that person's EFFECTIVE day-off quota for the period. */
    val dayOffQuota: Int? = null,
)

@Serializable
data class AttendanceRequest(
    val id: String,
    val userId: String? = null,
    /** LEAVE | SICK | PERMIT | DAY_OFF | RED_DATE (unknown values are shown as-is). */
    val type: String? = null,
    /** PENDING | APPROVED | REJECTED | CANCELED */
    val status: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val reason: String? = null,
    val reviewNote: String? = null,
    val approvalSource: String? = null,
    val supportingDocumentUrl: String? = null,
    val supportingDocumentName: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val reviewedAt: String? = null,
    val user: PersonRef? = null,
    val reviewedBy: PersonRef? = null,
) {
    val statusKey: String get() = status.orEmpty().uppercase()
    val isPending: Boolean get() = statusKey == "PENDING"
    /** The nightly cron's own day-off penalty: not something anybody filed. */
    val isAutoDeduction: Boolean
        get() = approvalSource == "ADMIN" && reviewedBy == null && reason.orEmpty().startsWith("Auto:")
    fun isOwn(viewerId: String?) = viewerId != null && (userId ?: user?.id) == viewerId
}

@Serializable
data class RequestsResponse(val requests: List<AttendanceRequest> = emptyList())

@Serializable
data class OffsiteCheckout(
    /** The attendance record id. */
    val id: String,
    val attendanceDate: String? = null,
    val checkOutAt: String? = null,
    val reason: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val distanceMeters: Double? = null,
    val photoUrl: String? = null,
    /** PENDING | APPROVED | REJECTED */
    val approval: String? = null,
    val approvedAt: String? = null,
    val approverName: String? = null,
    val officeName: String? = null,
    val user: PersonRef? = null,
) {
    val isPending: Boolean get() = approval.orEmpty().uppercase() == "PENDING"
}

@Serializable
data class OffsiteResponse(val items: List<OffsiteCheckout> = emptyList(), val pendingCount: Int = 0)

@Serializable
private data class ReviewBody(val action: String, val reviewNote: String? = null)

@Serializable
private data class OffsiteReviewBody(val action: String)

/** A file picked or shot for a request, already sized and typed. */
class Attachment(val bytes: ByteArray, val fileName: String, val mime: String)

open class RequestsApi(private val api: ApiClient) {

    /** `workspace` when the viewer can review (managers see direct reports only), else `me`. */
    open suspend fun list(scope: String): List<AttendanceRequest> =
        api.get("/api/attendance/requests?scope=$scope", RequestsResponse.serializer()).requests

    open suspend fun offsite(): List<OffsiteCheckout> =
        api.get("/api/attendance/offsite-checkouts?status=ALL", OffsiteResponse.serializer()).items

    /**
     * One date per request, every type (REQ-ATT-25): `endDate` is always `startDate`. [lat]/[lng]
     * go together or not at all.
     */
    open suspend fun create(
        type: String,
        date: String,
        reason: String,
        attachment: Attachment?,
        lat: Double?,
        lng: Double?,
    ) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("type", type)
            .addFormDataPart("startDate", date)
            .addFormDataPart("endDate", date)
            .addFormDataPart("reason", reason.trim())
            .apply {
                if (lat != null && lng != null) {
                    addFormDataPart("lat", lat.toBigDecimal().toPlainString())
                    addFormDataPart("lng", lng.toBigDecimal().toPlainString())
                }
                if (attachment != null) {
                    // A real type and a name that says what it is (REQ-ATT-30).
                    addFormDataPart("supportingDocument", safeName(attachment.fileName),
                        attachment.bytes.toRequestBody(attachment.mime.toMediaTypeOrNull()))
                }
            }
            .build()
        api.send(Request.Builder().url(api.url("/api/attendance/requests")).post(body).build(), JsonObject.serializer())
    }

    /** approve | reject (needs a note ≥ 3) | cancel (own only). */
    open suspend fun review(id: String, action: String, note: String? = null) {
        val payload = ReviewBody(action, note?.trim()?.takeIf { it.isNotEmpty() })
        api.send(
            Request.Builder().url(api.url("/api/attendance/requests/$id"))
                .patch(api.json.encodeToString(ReviewBody.serializer(), payload).toJsonBody()).build(),
            JsonObject.serializer(),
        )
    }

    open suspend fun reviewOffsite(recordId: String, action: String) {
        api.send(
            Request.Builder().url(api.url("/api/attendance/offsite-checkouts/$recordId"))
                .patch(api.json.encodeToString(OffsiteReviewBody.serializer(), OffsiteReviewBody(action)).toJsonBody()).build(),
            JsonObject.serializer(),
        )
    }

    companion object {
        /** `"`, CR and LF break a multipart header (API.md §1.10). */
        fun safeName(name: String) = name.replace("\"", "").replace("\r", "").replace("\n", "").ifBlank { "file" }
    }
}
