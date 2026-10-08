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

    /** Older messages: `before` = the server's `nextCursor` when it sent one, else the oldest createdAt (older servers). */
    suspend fun earlier(id: String, before: String) =
        api.get("/api/conversations/$id/messages?limit=50&before=${URLEncoder.encode(before, "UTF-8")}", MessagesResponse.serializer())

    /**
     * Only messages newer than [afterId], oldest first (CHAT-CONTRACT). An older server ignores `after` and
     * sends its latest page: ChatMerge unions by id, so nothing is ever dropped either way.
     */
    suspend fun newer(id: String, afterId: String) =
        api.get("/api/conversations/$id/messages?limit=100&after=${URLEncoder.encode(afterId, "UTF-8")}", MessagesResponse.serializer())

    /** Badges: `{ totalUnread, mentions }`; null when the server has no such route yet (the caller sums the list). */
    suspend fun unread(): UnreadResponse? = runCatching { api.get("/api/conversations/unread", UnreadResponse.serializer()) }.getOrNull()

    /** [until] = ISO time, "forever", or null to unmute. A 404 means the server has no mute yet. */
    suspend fun mute(id: String, until: String?): MuteResponse =
        api.send(Request.Builder().url(api.url("/api/conversations/$id/mute")).patch(buildJsonObject {
            if (until == null) put("mutedUntil", kotlinx.serialization.json.JsonNull) else put("mutedUntil", until)
        }.toString().toJsonBody()).build(), MuteResponse.serializer())

    /** Not idempotent: never retried automatically. */
    suspend fun send(id: String, content: String, mentionIds: List<String>, attachment: ChatUpload?, replyToId: String?) =
        post("/api/conversations/$id/messages", buildJsonObject {
            put("content", content.trim())
            if (mentionIds.isNotEmpty()) putJsonArray("mentionedUserIds") { mentionIds.forEach { add(JsonPrimitive(it)) } }
            attachment?.let { put("attachmentUrl", it.url); it.type?.let { t -> put("attachmentType", t) } }
            replyToId?.let { put("replyToId", it) }
        })

    /**
     * Read up to the last message shown (`upToMessageId`, CHAT-CONTRACT): never past what the person saw.
     * Older servers ignore the field and mark "now", as before.
     */
    suspend fun markRead(id: String, upToMessageId: String?) =
        post("/api/conversations/$id/read", buildJsonObject { upToMessageId?.let { put("upToMessageId", it) } })

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

    /** Add people to a GROUP (Manager and above since 8 Oct; anyone else gets 403 MANAGER_REQUIRED, see [ChatRules]). */
    suspend fun addMembers(id: String, userIds: List<String>): Conversation =
        api.send(Request.Builder().url(api.url("/api/conversations/$id/members")).post(buildJsonObject {
            putJsonArray("userIds") { userIds.forEach { add(JsonPrimitive(it)) } }
        }.toString().toJsonBody()).build(), ConversationResponse.serializer()).conversation

    private suspend fun post(path: String, body: JsonObject): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    companion object {
        const val MAX_IMAGE = 8L shl 20
        const val THREAD_POLL_MS = 5_000L
        const val LIST_POLL_MS = 15_000L
        /** While the socket is up (ANDROID-REALTIME): pings bring the news, these only catch a missed one. */
        const val THREAD_POLL_LIVE_MS = 30_000L
        const val LIST_POLL_LIVE_MS = 60_000L
    }
}
