package id.znetworks.nexus.feature.social

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.JsonObject
import okhttp3.Request
import java.net.URLEncoder

class SocialApi(private val api: ApiClient, projectId: String) {
    private val base = "/api/projects/${URLEncoder.encode(projectId, "UTF-8")}/social-media"
    suspend fun month(month: String) = SocialMonth(api.get("$base?month=$month", JsonObject.serializer()))
    suspend fun config() = api.get("$base/config", JsonObject.serializer())
    suspend fun put(path: String, body: JsonObject) = api.send(
        Request.Builder().url(api.url("$base/$path")).put(body.toString().toJsonBody()).build(), JsonObject.serializer())
}
