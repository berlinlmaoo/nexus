package id.znetworks.nexus.feature.vault

import kotlinx.serialization.json.JsonPrimitive
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.Uploads
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.net.URLEncoder

// API.md §2.6 Z Vault. Server sentences (Indonesian) are shown verbatim.

@Serializable data class VaultPerson(val id: String? = null, val name: String? = null)

@Serializable
data class VaultItem(
    val id: String,
    val kind: String = "FILE",
    val name: String = "",
    val mimeType: String? = null,
    val size: Long? = null,
    val parentId: String? = null,
    val url: String? = null,
    val downloadUrl: String? = null,
    val uploader: VaultPerson? = null,
    val childCount: Int? = null,
    val shareCount: Int? = null,
    val trashed: Boolean? = null,
    val deletedAt: String? = null,
    val updatedAt: String? = null,
    val canModify: Boolean? = null,
    /** `/api/vault/items/:id/thumb?v=…` for pictures the server can shrink (9 Oct); null for the rest. Add `&w=`. */
    val thumbUrl: String? = null,
) {
    val isFolder: Boolean get() = kind == "FOLDER"
    val isImage: Boolean get() = mimeType.orEmpty().startsWith("image/")
    val isVideo: Boolean get() = mimeType.orEmpty().startsWith("video/")
    /** Pictures and films: the gallery grid and the viewer. */
    val isMedia: Boolean get() = !isFolder && (isImage || isVideo)
}

@Serializable data class Crumb(val id: String, val name: String = "")
@Serializable data class Quota(val usedBytes: Long = 0, val totalBytes: Long = 0)

@Serializable
data class VaultList(
    val items: List<VaultItem> = emptyList(),
    val breadcrumb: List<Crumb> = emptyList(),
    val parentId: String? = null,
    val canWrite: Boolean = false,
    val canManageAccess: Boolean = false,
    val quota: Quota? = null,
)

@Serializable
data class VaultShare(
    val id: String,
    val slug: String = "",
    val url: String = "",
    val requireAuth: Boolean = true,
    val allowDownload: Boolean = true,
    val expiresAt: String? = null,
    val status: String = "active",
    val viewCount: Int = 0,
)

@Serializable data class VaultShares(val shares: List<VaultShare> = emptyList())

@Serializable data class PublicFile(val name: String = "", val mimeType: String? = null, val size: Long? = null)

@Serializable
data class VaultPublic(val slug: String = "", val requireAuth: Boolean = true, val allowDownload: Boolean = true,
                       val file: PublicFile = PublicFile(), val previewUrl: String? = null, val downloadUrl: String? = null)

object VaultRules {
    /** The workspace's shelf (13 Oct): 5 GB, used when the server sends no total. */
    const val CAP_BYTES = 5L * 1024 * 1024 * 1024

    /** Used / total for the bar: the server's numbers, its total else the 5 GB cap; percent 0–100 (web quotaPct). */
    data class Usage(val used: Long, val total: Long) {
        val percent: Int get() = if (total <= 0) 0 else Math.round(used.toDouble() / total * 100).toInt().coerceIn(0, 100)
        /** Past 90 %: the bar turns red (web). */
        val nearlyFull: Boolean get() = percent > 90
    }
    fun usage(q: Quota?): Usage? = q?.let { Usage(it.usedBytes.coerceAtLeast(0), if (it.totalBytes > 0) it.totalBytes else CAP_BYTES) }

    /** Web humanSize: "512 B", "1.5 MB", "12 MB", "4.7 GB". */
    fun humanSize(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val units = listOf("KB", "MB", "GB", "TB")
        var n = bytes / 1024.0; var i = 0
        while (n >= 1024 && i < units.size - 1) { n /= 1024; i++ }
        return (if (n < 10) String.format(java.util.Locale.ROOT, "%.1f", n) else Math.round(n).toString()) + " " + units[i]
    }
    /** 3d / 7d / 14d / 30d / permanent, the server's accepted values. */
    val EXPIRES = listOf("permanent", "3d", "7d", "14d", "30d")
    const val MAX_FILE = 1L shl 30

    /** Folders first, then by name (the server already sorts; kept stable here after local edits). */
    fun sorted(items: List<VaultItem>) = items.sortedWith(compareBy({ !it.isFolder }, { it.name.lowercase() }))

    /** The gallery's three parts, in order: folders (rows), pictures and films (grid), other files (rows). */
    data class Gallery(val folders: List<VaultItem>, val media: List<VaultItem>, val files: List<VaultItem>)
    fun gallery(items: List<VaultItem>): Gallery {
        val s = sorted(items)
        return Gallery(s.filter { it.isFolder }, s.filter { it.isMedia }, s.filter { !it.isFolder && !it.isMedia })
    }

    /** A grid tile's picture: the thumbnail at [px] (server rounds to 160/320/640/1280); none → the type icon. */
    fun thumb(i: VaultItem, px: Int = 320): String? = i.thumbUrl?.let { it + (if ('?' in it) "&" else "?") + "w=$px" }

    /** Logos are often white on transparent: PNG, GIF and WebP are shown whole on a checkerboard; the rest cropped. */
    fun showWhole(i: VaultItem) = i.mimeType.orEmpty().lowercase() in setOf("image/png", "image/gif", "image/webp")

    /** Move here? Not where it already is, not where the caller can't add. Null = allowed, else the reason. */
    fun moveBlock(currentParent: String?, target: String?, canWrite: Boolean): Int? = when {
        currentParent == target -> R.string.vm_already_here
        !canWrite -> R.string.vm_cant_add
        else -> null
    }
}

class VaultApi(private val api: ApiClient, private val uploads: Uploads) {
    suspend fun list(parentId: String?, trash: Boolean = false, q: String? = null): VaultList {
        val params = buildList {
            parentId?.let { add("parentId=${URLEncoder.encode(it, "UTF-8")}") }
            if (trash) add("trash=1")
            q?.takeIf { it.isNotBlank() }?.let { add("q=${URLEncoder.encode(it.take(100), "UTF-8")}") }
        }.joinToString("&")
        val path = "/api/vault/items" + if (params.isEmpty()) "" else "?$params"
        return if (!trash && q.isNullOrBlank()) api.getCached(path, "vault-${parentId ?: "root"}", VaultList.serializer()).value
        else api.get(path, VaultList.serializer())
    }

    suspend fun createFolder(name: String, parentId: String?) = send("POST", "/api/vault/items", buildJsonObject { put("name", name.trim()); parentId?.let { put("parentId", it) } }, VaultItem.serializer())
    suspend fun rename(id: String, name: String) = send("PATCH", "/api/vault/items/$id", buildJsonObject { put("name", name.trim()) }, VaultItem.serializer())
    /** Move into [parentId], or to the top level with null (sent as an explicit JSON null; VAULT-MOVE-DND). */
    suspend fun move(id: String, parentId: String?) =
        send("PATCH", "/api/vault/items/$id", JsonObject(mapOf("parentId" to (parentId?.let(::JsonPrimitive) ?: kotlinx.serialization.json.JsonNull))), VaultItem.serializer())
    suspend fun restore(id: String) = send("PATCH", "/api/vault/items/$id", buildJsonObject { put("restore", true) }, VaultItem.serializer())
    suspend fun delete(id: String, purge: Boolean) =
        api.send(Request.Builder().url(api.url("/api/vault/items/$id" + if (purge) "?purge=1" else "")).delete().build(), JsonObject.serializer())
    suspend fun emptyTrash() = send("POST", "/api/vault/trash/empty", JsonObject(emptyMap()), JsonObject.serializer())

    /** ≤ 64 MiB in one request, above that the attachment chunk route with target=vault. */
    suspend fun upload(file: Uploads.Picked, parentId: String?, onProgress: (Long, Long) -> Unit): VaultItem =
        uploads.send(file, "/api/vault/upload", listOfNotNull(parentId?.let { "parentId" to it }),
            listOf("target" to "vault") + listOfNotNull(parentId?.let { "parentId" to it }), VaultItem.serializer(), onProgress)

    suspend fun shares(itemId: String) = api.get("/api/vault/shares?itemId=$itemId", VaultShares.serializer()).shares
    suspend fun share(itemId: String, requireAuth: Boolean, allowDownload: Boolean, expires: String) =
        send("POST", "/api/vault/shares", buildJsonObject { put("itemId", itemId); put("requireAuth", requireAuth); put("allowDownload", allowDownload); put("expires", expires) }, VaultShare.serializer())
    suspend fun revoke(shareId: String) = api.send(Request.Builder().url(api.url("/api/vault/shares/$shareId")).delete().build(), VaultShare.serializer())

    suspend fun public(slug: String) = api.get("/api/vault/public/${URLEncoder.encode(slug, "UTF-8")}", VaultPublic.serializer())

    private suspend fun <T> send(method: String, path: String, body: JsonObject, ser: kotlinx.serialization.KSerializer<T>): T =
        api.send(Request.Builder().url(api.url(path)).method(method, body.toString().toJsonBody()).build(), ser)
}
