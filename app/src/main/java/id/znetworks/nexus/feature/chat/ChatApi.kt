package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/** Conversations and messages (API.md §2.5). No socket on mobile: an open thread polls. */
class ChatApi(private val api: ApiClient) {
    /** Also provisions the project rooms the caller belongs to (server side effect). */
    suspend fun conversations() = api.getCached("/api/conversations", "conversations", ConversationsResponse.serializer())

    suspend fun messages(id: String) = api.getCached("/api/conversations/$id/messages?limit=50", "messages-$id", MessagesResponse.serializer())

    suspend fun earlier(id: String, beforeIso: String) =
        api.get("/api/conversations/$id/messages?limit=50&before=${URLEncoder.encode(beforeIso, "UTF-8")}", MessagesResponse.serializer())

    /** Not idempotent: never retried automatically. */
    suspend fun send(id: String, content: String, mentionIds: List<String>, attachment: ChatUpload?, replyToId: String?) =
        post("/api/conversations/$id/messages", buildJsonObject {
            put("content", content.trim())
            if (mentionIds.isNotEmpty()) putJsonArray("mentionedUserIds") { mentionIds.forEach { add(JsonPrimitive(it)) } }
            attachment?.let { put("attachmentUrl", it.url); it.type?.let { t -> put("attachmentType", t) } }
            replyToId?.let { put("replyToId", it) }
        })

    /** iOS never calls this, so iPhone reads stay unread on the web: Android does (API.md parity gap). */
    suspend fun markRead(id: String) = post("/api/conversations/$id/read", JsonObject(emptyMap()))

    /** An image part with a real image type (the server checks it); max 8 MB, no chunk route. */
    suspend fun uploadImage(conversationId: String, jpeg: ByteArray): ChatUpload {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("conversationId", conversationId)
            .addFormDataPart("file", "photo.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        return api.send(Request.Builder().url(api.url("/api/upload/chat")).post(body).build(), ChatUpload.serializer())
    }

    /** A DM with exactly that person comes back as the existing one (200), else a new room (201). */
    suspend fun create(type: String, userIds: List<String>, name: String?): Conversation =
        api.send(Request.Builder().url(api.url("/api/conversations")).post(buildJsonObject {
            put("type", type)
            putJsonArray("userIds") { userIds.forEach { add(JsonPrimitive(it)) } }
            name?.trim()?.takeIf { it.isNotEmpty() }?.let { put("name", it) }
        }.toString().toJsonBody()).build(), ConversationResponse.serializer()).conversation

    suspend fun rename(id: String, name: String) =
        api.send(Request.Builder().url(api.url("/api/conversations/$id")).patch(buildJsonObject { put("name", name.trim()) }.toString().toJsonBody()).build(),
            ConversationResponse.serializer()).conversation

    suspend fun addMembers(id: String, userIds: List<String>) = post("/api/conversations/$id/members", buildJsonObject {
        putJsonArray("userIds") { userIds.forEach { add(JsonPrimitive(it)) } }
    })

    private suspend fun post(path: String, body: JsonObject): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    companion object {
        const val MAX_IMAGE = 8L shl 20
        const val THREAD_POLL_MS = 5_000L
        const val LIST_POLL_MS = 15_000L
    }
}
