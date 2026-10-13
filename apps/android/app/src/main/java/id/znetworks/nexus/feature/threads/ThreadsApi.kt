package id.znetworks.nexus.feature.threads

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// API.md §2.5 Threads (company feed). Limits from src/lib/feed.ts.

@Serializable data class FeedAuthor(val id: String? = null, val name: String? = null, val avatar: String? = null)
@Serializable data class FeedImage(val id: String? = null, val url: String, val width: Int? = null, val height: Int? = null, val position: Int? = null)
@Serializable data class FeedMention(val userId: String? = null, val name: String? = null)

@Serializable
data class Post(
    val id: String,
    val text: String = "",
    val createdAt: String? = null,
    val editedAt: String? = null,
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    val author: FeedAuthor? = null,
    val images: List<FeedImage> = emptyList(),
    val mentions: List<FeedMention> = emptyList(),
    val likedByMe: Boolean = false,
    val canDelete: Boolean = false,
    val canEdit: Boolean = false,
)

@Serializable data class FeedPage(val posts: List<Post> = emptyList(), val nextCursor: String? = null, val hasMore: Boolean = false)
@Serializable data class LikeResult(val liked: Boolean = false, val likeCount: Int = 0)
@Serializable data class FeedComment(val id: String, val text: String = "", val createdAt: String? = null, val author: FeedAuthor? = null)
@Serializable data class FeedComments(val comments: List<FeedComment> = emptyList())

object FeedRules {
    const val MAX_TEXT = 280
    const val MAX_IMAGES = 4
    const val MAX_IMAGE_BYTES = 8L shl 20
    const val MAX_COMMENT = 1000
    const val EDIT_WINDOW_MS = 15 * 60_000L
}

/** Who a post or comment mentions (THREADS-TASK-FOLDERS): every "@Name" tag still in the text, picked from the list OR typed by hand. */
object FeedMentions {
    /** [roster]: (userId, name). A tag counts only as a whole word: "@Ali" is not in "@Alia". */
    fun ids(text: String, picked: Map<String, String>, roster: List<Pair<String, String>>): List<String> {
        fun has(tag: String) = Regex(Regex.escape(tag) + "(?![\\p{L}\\p{N}_])", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val fromPicked = picked.filterValues(::has).keys
        val typed = roster.filter { (_, n) -> n.isNotBlank() && has(id.znetworks.nexus.feature.chat.Mentions.tag(n)) }.map { it.first }
        return (fromPicked + typed).distinct()
    }
}

class ThreadsApi(private val api: ApiClient) {
    /** Who can be @mentioned: everyone in the caller's workspaces (/api/members, as the web composer and iOS). `id` is the user id. */
    suspend fun members() = api.get("/api/members", ListSerializer(id.znetworks.nexus.feature.projects.RosterMember.serializer()))

    /** One post (THREADS-TASK-FOLDERS): a notification's post that isn't on the first page; 410 = deleted. */
    suspend fun post(id: String) = api.get("/api/feed/posts/${java.net.URLEncoder.encode(id, "UTF-8")}", Post.serializer())

    suspend fun page(cursor: String?, mentionsMe: Boolean = false): FeedPage {
        val q = buildList {
            add("limit=20"); cursor?.let { add("cursor=${java.net.URLEncoder.encode(it, "UTF-8")}") }; if (mentionsMe) add("mentions=me")
        }.joinToString("&")
        return if (cursor == null && !mentionsMe) api.getCached("/api/feed/posts?$q", "feed", FeedPage.serializer()).value
        else api.get("/api/feed/posts?$q", FeedPage.serializer())
    }

    /** Multipart, not JSON: `mentions` is a JSON-encoded string; `images` repeats; `imageMeta` keeps aspect ratios. */
    suspend fun create(text: String, mentions: List<String>, images: List<Triple<ByteArray, Int, Int>>): Post {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            addFormDataPart("text", text.trim())
            addFormDataPart("mentions", api.json.encodeToString(ListSerializer(String.serializer()), mentions))
            addFormDataPart("imageMeta", "[" + images.joinToString(",") { (_, w, h) -> if (w > 0 && h > 0) "{\"w\":$w,\"h\":$h}" else "{}" } + "]")
            images.forEachIndexed { i, (bytes, _, _) -> addFormDataPart("images", "photo-$i.jpg", bytes.toRequestBody("image/jpeg".toMediaType())) }
        }.build()
        return api.send(Request.Builder().url(api.url("/api/feed/posts")).post(body).build(), Post.serializer())
    }

    suspend fun edit(id: String, text: String, mentions: List<String>): Post =
        api.send(Request.Builder().url(api.url("/api/feed/posts/$id")).patch(buildJsonObject {
            put("text", text.trim()); putJsonArray("mentions") { mentions.forEach { add(JsonPrimitive(it)) } }
        }.toString().toJsonBody()).build(), Post.serializer())

    suspend fun delete(id: String) = api.send(Request.Builder().url(api.url("/api/feed/posts/$id")).delete().build(), JsonObject.serializer())

    suspend fun like(id: String) = api.send(Request.Builder().url(api.url("/api/feed/posts/$id/like")).post("".toJsonBody()).build(), LikeResult.serializer())

    suspend fun comments(id: String) = api.get("/api/feed/posts/$id/comments", FeedComments.serializer()).comments

    suspend fun comment(id: String, text: String, mentions: List<String>) =
        api.send(Request.Builder().url(api.url("/api/feed/posts/$id/comments")).post(buildJsonObject {
            put("text", text.trim()); putJsonArray("mentions") { mentions.forEach { add(JsonPrimitive(it)) } }
        }.toString().toJsonBody()).build(), FeedComment.serializer())
}
