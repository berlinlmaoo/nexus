package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder

class GideonProjectApi(private val api: ApiClient) {
    private fun encoded(id: String) = URLEncoder.encode(id, "UTF-8")
    private suspend fun send(path: String, method: String, body: JsonObject = buildJsonObject {}) = api.send(Request.Builder().url(api.url(path)).method(method, if (method == "DELETE") null else body.toString().toJsonBody()).build(), JsonObject.serializer())
    suspend fun schedules(project: String) = api.get("/api/gideon/schedules?projectId=${encoded(project)}", JsonObject.serializer())
    suspend fun saveSchedule(project: String, id: String?, body: JsonObject) = send(if (id == null) "/api/gideon/schedules" else "/api/gideon/schedules/${encoded(id)}", if (id == null) "POST" else "PATCH", JsonObject(body + ("projectId" to JsonPrimitive(project))))
    suspend fun deleteSchedule(id: String) = send("/api/gideon/schedules/${encoded(id)}", "DELETE")
    suspend fun runSchedule(id: String) = send("/api/gideon/schedules/${encoded(id)}/run", "POST")
    suspend fun autofill(project: String) = api.get("/api/gideon/autofill?projectId=${encoded(project)}", JsonObject.serializer())
    suspend fun saveAutofill(field: String, patch: JsonObject) = send("/api/gideon/autofill", "PUT", JsonObject(patch + ("customFieldId" to JsonPrimitive(field))))
    suspend fun deleteAutofill(field: String) = send("/api/gideon/autofill?customFieldId=${encoded(field)}", "DELETE")
    suspend fun runAutofill(field: String, scope: String) = send("/api/gideon/autofill/run", "POST", buildJsonObject { put("customFieldId",field); put("scope",scope) })
}
