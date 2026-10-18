package id.znetworks.nexus.feature.inbox

import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.Request

/** One language's wording of a notification (`Notification.texts`, 13 Oct 2026). */
@Serializable
data class InboxText(val title: String? = null, val message: String? = null)

/** The sender of a notification (`actor`). */
@Serializable
data class InboxActor(val id: String? = null, val name: String? = null, val avatar: String? = null)

@Serializable
data class InboxItem(
    val id: String,
    val type: String? = null,
    /** The server's single pair: the recipient's chosen language, else English. */
    @kotlinx.serialization.SerialName("title") val rawTitle: String? = null,
    @kotlinx.serialization.SerialName("message") val rawMessage: String? = null,
    /** Both languages when the notifier wrote both (keyed `en` / `id`); older rows have none. */
    val texts: Map<String, InboxText>? = null,
    /** Who caused it (servers since 13 Oct); null = the system or an older row. */
    val actor: InboxActor? = null,
    val read: Boolean = false,
    val link: String? = null,
    val createdAt: String? = null,
    val taskId: String? = null,
    val projectId: String? = null,
) {
    /** Shown in the app's language when the server sent both, else as stored. */
    fun title(lang: String = AppLanguage.serverCode(AppLanguage.current)): String? =
        texts?.get(lang)?.title?.takeIf { it.isNotBlank() } ?: InboxLegacyText.translate(rawTitle, lang)
    fun message(lang: String = AppLanguage.serverCode(AppLanguage.current)): String? =
        texts?.get(lang)?.message?.takeIf { it.isNotBlank() } ?: InboxLegacyText.translate(rawMessage, lang)
    val title: String? get() = title()
    val message: String? get() = message()
}

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

    /** One notification gone (web deleteNotification: DELETE with a JSON body). */
    suspend fun delete(id: String) {
        api.send(Request.Builder().url(api.url("/api/notifications")).delete(JsonObject(mapOf("id" to kotlinx.serialization.json.JsonPrimitive(id))).toString().toJsonBody()).build(), JsonObject.serializer())
    }

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
