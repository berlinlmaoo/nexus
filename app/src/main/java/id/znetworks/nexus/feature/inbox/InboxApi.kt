package id.znetworks.nexus.feature.inbox

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.Request

@Serializable
data class InboxItem(
    val id: String,
    val type: String? = null,
    val title: String? = null,
    val message: String? = null,
    val read: Boolean = false,
    val link: String? = null,
    val createdAt: String? = null,
    val taskId: String? = null,
    val projectId: String? = null,
)

@Serializable
data class InboxResponse(val notifications: List<InboxItem> = emptyList(), val unreadCount: Int = 0)

@Serializable
data class Announcement(
    val id: String,
    val title: String? = null,
    val body: String? = null,
    /** info | success | warning */
    val tone: String? = null,
    val imageUrl: String? = null,
    val createdAt: String? = null,
    val authorName: String? = null,
    /** "announcement" | "warning" (Absen Monitor) | "sp" (warning letter with a PDF) — Batch 2. */
    val kind: String? = null,
    val attachmentUrl: String? = null,
    val attachmentName: String? = null,
    /** Sent to selected people (this viewer among them), not everyone. */
    val targeted: Boolean? = null,
)

@Serializable
data class AnnouncementsResponse(val announcements: List<Announcement> = emptyList())

@Serializable
data class AnnouncementResponse(val announcement: Announcement? = null)

@Serializable
private data class MarkBody(val id: String? = null, val markAllRead: Boolean? = null)

class InboxApi(private val api: ApiClient) {
    suspend fun list(): InboxResponse = api.get("/api/notifications", InboxResponse.serializer())

    suspend fun markRead(id: String) = patch(MarkBody(id = id))
    suspend fun markAllRead() = patch(MarkBody(markAllRead = true))

    private suspend fun patch(body: MarkBody) {
        api.send(
            Request.Builder().url(api.url("/api/notifications"))
                .patch(api.json.encodeToString(MarkBody.serializer(), body).toJsonBody()).build(),
            JsonObject.serializer(),
        )
    }

    /** Active, not yet seen by the caller, ≤ 5, newest first. */
    suspend fun activeAnnouncements(): List<Announcement> =
        api.get("/api/announcements/active", AnnouncementsResponse.serializer()).announcements

    /** One announcement even if already seen (a tapped `/dashboard?announcement=<id>`). */
    suspend fun announcement(id: String): Announcement? =
        api.get("/api/announcements/$id", AnnouncementResponse.serializer()).announcement

    suspend fun seen(id: String) {
        api.send(Request.Builder().url(api.url("/api/announcements/$id/seen")).post("{}".toJsonBody()).build(), JsonObject.serializer())
    }
}
