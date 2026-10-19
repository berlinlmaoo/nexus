package id.znetworks.nexus.feature.outlet

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Request
import java.net.URLEncoder

/**
 * /api/projects/:id/outlet-sales and below (OUTLET-SALES §4). Read = VIEWER, events = MEMBER, targets = the
 * project's lead or a workspace manager (403 TARGETS_FORBIDDEN otherwise). Errors carry `field` on a bad value.
 */
class OutletApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun base(projectId: String) = "/api/projects/${enc(projectId)}/outlet-sales"

    /** [month] "YYYY-MM"; null = this month in WIB. */
    suspend fun month(projectId: String, month: String?) =
        OutletMonth(api.get(base(projectId) + (month?.let { "?month=${enc(it)}" } ?: ""), JsonObject.serializer()))

    /** One event (another month's, a deep link). */
    suspend fun event(projectId: String, eventId: String): OutletEvent? =
        (api.get("${base(projectId)}/events/${enc(eventId)}", JsonObject.serializer())["event"] as? JsonObject)?.let(::OutletEvent)

    /** `name` and `date` required; the rest may be left out. */
    suspend fun create(projectId: String, fields: JsonObject) =
        OutletEvent(api.send(Request.Builder().url(api.url("${base(projectId)}/events")).post(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** Only the keys that changed: JSON null clears a number, "" a text. */
    suspend fun update(projectId: String, eventId: String, fields: JsonObject) =
        OutletEvent(api.send(Request.Builder().url(api.url("${base(projectId)}/events/${enc(eventId)}")).patch(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** Restorable from Control Room › Audit ("outlet_sales_event"). */
    suspend fun delete(projectId: String, eventId: String) =
        api.send(Request.Builder().url(api.url("${base(projectId)}/events/${enc(eventId)}")).delete().build(), JsonObject.serializer())

    suspend fun config(projectId: String) = api.get("${base(projectId)}/config", JsonObject.serializer())
    suspend fun put(projectId: String, path: String, body: JsonObject) = api.send(Request.Builder().url(api.url("${base(projectId)}/$path")).put(body.toString().toJsonBody()).build(), JsonObject.serializer())

    /** The month's own targets; null clears one. */
    suspend fun setTarget(projectId: String, month: String, sales: Double?, pax: Double?) {
        fun n(v: Double?): JsonElement = v?.let { JsonPrimitive(it.toLong()) } ?: JsonNull
        val body = JsonObject(mapOf("month" to JsonPrimitive(month), "salesTarget" to n(sales), "paxTarget" to n(pax)))
        api.send(Request.Builder().url(api.url("${base(projectId)}/targets")).put(body.toString().toJsonBody()).build(), JsonObject.serializer())
    }
}
