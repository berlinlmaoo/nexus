package id.znetworks.nexus.feature.admin.orgchart

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable private data class UnitReply(val unit: OrgUnit)

/**
 * `/api/admin/org-chart` (spec 5 Oct 2026). Read: Manager and above; every write: BoD / One Above All
 * (the server answers 403 "Hanya BoD / One Above All yang bisa mengubah bagan."). Positions
 * (layoutX/Y, boxLayout, POST …/layout) are the web's: this client reads them and never writes them —
 * there is deliberately no way to send them from here.
 */
class OrgChartApi(private val api: ApiClient) {
    suspend fun chart() = api.get("/api/admin/org-chart", OrgChartData.serializer())

    suspend fun create(name: String, kind: String, parentId: String?): OrgUnit =
        api.send(Request.Builder().url(api.url("/api/admin/org-chart")).post(buildJsonObject {
            put("name", name.trim()); put("kind", kind); put("parentId", parentId?.let(::JsonPrimitive) ?: JsonNull)
        }.toString().toJsonBody()).build(), UnitReply.serializer()).unit

    /** The editable fields only. [logoRemoved] sends `logoUrl: null`; a new logo goes through [uploadLogo]. */
    suspend fun update(id: String, name: String? = null, kind: String? = null, parentId: String? = null, setParent: Boolean = false,
                       leadUserId: String? = null, setLead: Boolean = false, logoRemoved: Boolean = false) {
        val body = buildJsonObject {
            name?.let { put("name", it.trim()) }
            kind?.let { put("kind", it) }
            if (setParent) put("parentId", parentId?.let(::JsonPrimitive) ?: JsonNull)
            if (setLead) put("leadUserId", leadUserId?.let(::JsonPrimitive) ?: JsonNull)
            if (logoRemoved) put("logoUrl", JsonNull)
        }
        api.send(Request.Builder().url(unitUrl(id)).patch(body.toString().toJsonBody()).build(), JsonObject.serializer())
    }

    suspend fun delete(id: String) = api.send(Request.Builder().url(unitUrl(id)).delete().build(), JsonObject.serializer())

    suspend fun addMember(userId: String, unitId: String) = members("POST", buildJsonObject { put("userId", userId); put("unitId", unitId) })
    suspend fun removeMember(userId: String, unitId: String) =
        api.send(Request.Builder().url(api.url("/api/admin/org-chart/members").newBuilder().addQueryParameter("userId", userId).addQueryParameter("unitId", unitId).build())
            .delete().build(), JsonObject.serializer())
    /** Empty = no title. */
    suspend fun setTitle(userId: String, unitId: String, title: String?) =
        members("PATCH", buildJsonObject { put("userId", userId); put("unitId", unitId); put("title", title?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull) })
    /** null = under nobody. */
    suspend fun setReportsTo(userId: String, unitId: String, leaderId: String?) =
        members("PATCH", buildJsonObject { put("userId", userId); put("unitId", unitId); put("reportsToUserId", leaderId?.let(::JsonPrimitive) ?: JsonNull) })

    /** PNG/JPG/WebP ≤ 2 MB. */
    suspend fun uploadLogo(unitId: String, bytes: ByteArray, mime: String, name: String): OrgUnit {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("unitId", unitId)
            .addFormDataPart("file", name.replace("\"", ""), bytes.toRequestBody(mime.toMediaType())).build()
        return api.send(Request.Builder().url(api.url("/api/admin/org-chart/logo")).post(body).build(), UnitReply.serializer()).unit
    }

    /** The unit id as one encoded path segment. */
    fun unitUrl(id: String) = api.url("/api/admin/org-chart/units").newBuilder().addPathSegment(id).build()

    private suspend fun members(method: String, body: JsonObject) =
        api.send(Request.Builder().url(api.url("/api/admin/org-chart/members")).method(method, body.toString().toJsonBody()).build(), JsonObject.serializer())
}
