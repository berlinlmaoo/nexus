package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.math.BigDecimal
import java.time.Instant

/** The only code that talks to the attendance write endpoints. */
open class AttendanceApi(private val api: ApiClient) {

    open suspend fun today(): AttendanceToday = api.get("/api/attendance/today", AttendanceToday.serializer())

    open suspend fun offices(): List<OfficeRef> = api.get("/api/attendance/offices", OfficesResponse.serializer()).offices

    open suspend fun checkIn(selfie: ByteArray, fix: LocationFix, clientId: String, replay: ReplayStamp? = null): AttendanceOutcome =
        upload("/api/attendance/check-in", buildParts(selfie, fix, clientId, replay))

    /**
     * [reflection] is required by the server (min 200 characters, trimmed); an empty one is left out
     * so the server answers `REFLECTION_REQUIRED` instead of a validation error.
     */
    open suspend fun checkOut(
        selfie: ByteArray,
        fix: LocationFix,
        reflection: String,
        offsite: Boolean,
        reason: String?,
        clientId: String,
        replay: ReplayStamp? = null,
    ): AttendanceOutcome {
        val extra = buildList {
            reflection.trim().takeIf { it.isNotEmpty() }?.let { add("reflection" to it) }
            if (offsite) {
                add("offsite" to "1")
                reason?.trim()?.takeIf { it.isNotEmpty() }?.let { add("reason" to it) }
            }
        }
        return upload("/api/attendance/check-out", buildParts(selfie, fix, clientId, replay, extra))
    }

    private suspend fun upload(path: String, body: MultipartBody): AttendanceOutcome {
        val request = Request.Builder().url(api.url(path)).post(body).build()
        return try {
            val res = api.send(request, CheckResponse.serializer())
            AttendanceOutcome.Success(res.record, res.pendingApproval, res.duplicate)
        } catch (e: ApiError.Http) {
            outsideRadius(e) ?: throw e
        }
    }

    companion object {
        private val JPEG = "image/jpeg".toMediaType()

        /**
         * Text parts carry no Content-Type (like a browser's FormData); the selfie is `selfie.jpg`,
         * `image/jpeg` (API.md §1.10).
         */
        internal fun buildParts(
            selfie: ByteArray,
            fix: LocationFix,
            clientId: String,
            replay: ReplayStamp?,
            extra: List<Pair<String, String>> = emptyList(),
        ): MultipartBody {
            val b = MultipartBody.Builder().setType(MultipartBody.FORM)
            fields(fix, clientId, replay).forEach { (k, v) -> b.addFormDataPart(k, v) }
            extra.forEach { (k, v) -> b.addFormDataPart(k, v) }
            b.addFormDataPart("selfie", "selfie.jpg", selfie.toRequestBody(JPEG))
            return b.build()
        }

        internal fun fields(fix: LocationFix, clientId: String, replay: ReplayStamp?): List<Pair<String, String>> = buildList {
            add("lat" to plain(fix.lat))
            add("lng" to plain(fix.lng))
            fix.accuracyM?.let { add("accuracyM" to plain(it)) }
            fix.altitudeM?.let { add("altitudeM" to plain(it)) }
            fix.speedMps?.let { add("speedMps" to plain(it)) }
            add("simulated" to if (fix.simulated) "1" else "0")
            // iOS-only concept (external GPS accessory); always 0 on Android.
            add("fromAccessory" to "0")
            add("clientId" to clientId)
            if (replay != null) {
                add("deviceAt" to Instant.ofEpochMilli(replay.deviceAtMillis).toString())
                add("uptimeSec" to replay.uptimeSec.toString())
            }
        }

        /** No scientific notation ("1.0E-4") in a form field, whatever the number. */
        private fun plain(d: Double): String = BigDecimal.valueOf(d).stripTrailingZeros().toPlainString()

        /** 422 outside the radius, for check-in (no code, has distance) and check-out (OUTSIDE_RADIUS). */
        internal fun outsideRadius(e: ApiError.Http): AttendanceOutcome.OutsideRadius? {
            if (e.status != 422) return null
            val body = e.body
            val distance = (body?.get("distanceMeters") as? JsonPrimitive)?.doubleOrNull
            if (e.code != "OUTSIDE_RADIUS" && distance == null) return null
            return AttendanceOutcome.OutsideRadius(
                officeName = (body?.get("officeName") as? JsonPrimitive)?.contentOrNull,
                distanceMeters = distance,
                radiusMeters = (body?.get("radiusMeters") as? JsonPrimitive)?.doubleOrNull,
            )
        }
    }
}
