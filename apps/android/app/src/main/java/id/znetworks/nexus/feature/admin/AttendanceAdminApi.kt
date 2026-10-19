package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.net.URLEncoder

// API.md §2.3 attendance administration. Red dates/holidays: calendar month; day-offs: period key.

@Serializable data class Holiday(val id: String, val date: String = "", val name: String = "")
@Serializable data class Holidays(val month: String? = null, val canManage: Boolean = false, val holidays: List<Holiday> = emptyList())
@Serializable data class RedQuota(val month: String? = null, val quota: Int = 0, val canManage: Boolean = false)

@Serializable data class DayOffReq(val id: String, val startDate: String? = null, val status: String? = null, val reason: String? = null)
@Serializable data class DayOffs(val month: String? = null, val quota: Int = 4, val quotaOverride: Int? = null, val defaultQuota: Int = 4, val used: Int = 0,
                                 val dayoffs: List<DayOffReq> = emptyList())

@Serializable
data class Office(val id: String, val name: String = "", val address: String? = null, val latitude: Double = 0.0, val longitude: Double = 0.0,
                  val radiusMeters: Int = 100, val workdays: List<Int> = emptyList(), val shiftStartTime: String? = null, val shiftEndTime: String? = null,
                  val lateGraceMinutes: Int = 0, val isActive: Boolean = true)
@Serializable data class Offices(val offices: List<Office> = emptyList(), val canManage: Boolean = false)

@Serializable data class ReflectionDay(val date: String = "", val reflection: String = "", val summary: String? = null)
@Serializable data class MonthlySummary(val summary: String = "", val sourceDays: Int = 0, val updatedAt: String? = null)
@Serializable data class Reflections(val userId: String? = null, val month: String? = null, val days: List<ReflectionDay> = emptyList(), val monthly: MonthlySummary? = null)
@Serializable data class Summarized(val summary: String = "", val sourceDays: Int = 0, val cached: Boolean = false)

object ShiftRules {
    private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    fun valid(t: String?) = t != null && HHMM.matches(t)
    /** Both set or both empty, and not the same minute (overnight is allowed). */
    fun pairOk(start: String?, end: String?) = (start == null && end == null) || (valid(start) && valid(end) && start != end)
}

class AttendanceAdminApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private suspend fun send(method: String, path: String, body: JsonObject?): JsonObject =
        api.send(Request.Builder().url(api.url(path)).method(method, body?.toString()?.toJsonBody()).build(), JsonObject.serializer())

    suspend fun employment() = api.get("/api/attendance/employment-start", JsonObject.serializer())
    suspend fun setEmployment(userId: String, date: String?) = send("PATCH", "/api/attendance/employment-start", buildJsonObject {
        put("userId", userId); put("date", date?.let(::JsonPrimitive) ?: JsonNull)
    })
    suspend fun deductions(month: String, userId: String? = null) = api.get("/api/attendance/deductions?month=${enc(month)}" +
        (userId?.let { "&userId=${enc(it)}" } ?: ""), JsonObject.serializer())
    suspend fun clearDeduction(userId: String, date: String) = send("POST", "/api/attendance/override", buildJsonObject {
        put("userId", userId); put("date", date); put("action", "CLEAR_PENALTY")
    })
    suspend fun deductAbsences() = send("POST", "/api/attendance/deduct-absences", buildJsonObject { })
    suspend fun outageRefund(date: String, dryRun: Boolean) = send("POST", "/api/attendance/outage-refund", buildJsonObject {
        put("date", date); put("dryRun", dryRun)
    })

    suspend fun holidays(month: String) = api.get("/api/attendance/holidays?month=$month", Holidays.serializer())
    suspend fun addHoliday(date: String, name: String) = send("POST", "/api/attendance/holidays", buildJsonObject { put("date", date); put("name", name.trim()) })
    suspend fun deleteHoliday(id: String) = send("DELETE", "/api/attendance/holidays?id=${enc(id)}", null)
    suspend fun redQuota(month: String) = api.get("/api/attendance/red-date-quota?month=$month", RedQuota.serializer())
    suspend fun setRedQuota(month: String, quota: Int) = send("POST", "/api/attendance/red-date-quota", buildJsonObject { put("month", month); put("quota", quota) })

    suspend fun dayoffs(userId: String, period: String) = api.get("/api/attendance/dayoffs?userId=${enc(userId)}&month=$period", DayOffs.serializer())
    suspend fun grantDayoff(userId: String, date: String, reason: String?) = send("POST", "/api/attendance/dayoffs", buildJsonObject {
        put("userId", userId); put("date", date); reason?.trim()?.takeIf { it.isNotEmpty() }?.let { put("reason", it) }
    })
    /** null resets to the default (4). */
    suspend fun setDayoffQuota(userId: String, quota: Int?) = send("PATCH", "/api/attendance/dayoffs",
        JsonObject(mapOf("userId" to JsonPrimitive(userId), "quota" to (quota?.let { JsonPrimitive(it) } ?: JsonNull))))
    suspend fun deleteDayoff(id: String) = send("DELETE", "/api/attendance/dayoffs?id=${enc(id)}", null)

    suspend fun offices() = api.get("/api/attendance/offices", Offices.serializer())
    suspend fun createOffice(fields: Map<String, JsonElement>) = send("POST", "/api/attendance/offices",
        JsonObject(fields + mapOf("shiftStartTime" to JsonPrimitive("09:00"), "shiftEndTime" to JsonPrimitive("18:00"))))
    /** Never the shift on edit: it would silently reset an office's custom shift. */
    suspend fun updateOffice(id: String, fields: Map<String, JsonElement>) = send("PATCH", "/api/attendance/offices/$id", JsonObject(fields))
    suspend fun deleteOffice(id: String) = send("DELETE", "/api/attendance/offices/$id", null)

    suspend fun reflections(userId: String?, month: String) =
        api.get("/api/attendance/reflections?month=$month" + (userId?.let { "&userId=${enc(it)}" } ?: ""), Reflections.serializer())
    /** Slow (GIDEON): a long timeout; a 503 is GIDEON's sentence, not an outage. */
    suspend fun summarize(userId: String?, month: String, force: Boolean): Summarized {
        val body = buildJsonObject { put("month", month); userId?.let { put("userId", it) }; if (force) put("force", true) }
        return api.json.decodeFromString(Summarized.serializer(), api.sendText(Request.Builder().url(api.url("/api/attendance/reflections/summarize"))
            .post(body.toString().toJsonBody()).build(), readTimeoutMs = 300_000))
    }

    suspend fun exportXlsx(period: String, userId: String?) =
        api.bytes("/api/attendance/history?scope=workspace&month=$period&format=xlsx" + (userId?.let { "&userId=${enc(it)}" } ?: ""))
}
