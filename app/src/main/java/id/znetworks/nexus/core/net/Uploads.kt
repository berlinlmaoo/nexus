package id.znetworks.nexus.core.net

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.serialization.KSerializer
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.InputStream
import java.util.UUID

/**
 * Uploads for destinations with a chunk route (task attachments, Z Vault): one request up to
 * 64 MiB, 16 MiB raw chunks above, sent sequentially under one uploadId (API.md §1.10, §2.4).
 * Files are streamed from disk and never held whole in memory.
 */
class Uploads(private val context: Context, private val api: ApiClient) {
    data class Picked(val uri: Uri, val name: String, val mime: String, val size: Long)

    fun describe(uri: Uri): Picked? {
        val cr = context.contentResolver
        var name = "file"
        var size = -1L
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    if (!c.isNull(0)) name = c.getString(0)
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        }
        if (size < 0) size = runCatching { cr.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull() ?: -1L
        if (size <= 0) return null
        // `"`, CR and LF break a multipart header.
        val clean = name.replace("\"", "").replace("\r", "").replace("\n", "").ifBlank { "file" }
        return Picked(uri, clean, cr.getType(uri) ?: "application/octet-stream", size)
    }

    /**
     * Sends [file] with the extra text [fields] (e.g. taskId, kind) to [singlePath] when small, or
     * to the chunk route with [chunkQuery] (e.g. taskId=… / target=vault) when large. Returns the
     * final response decoded with [serializer].
     */
    suspend fun <T> send(
        file: Picked,
        singlePath: String,
        fields: List<Pair<String, String>>,
        chunkQuery: List<Pair<String, String>>,
        serializer: KSerializer<T>,
        onProgress: (Long, Long) -> Unit,
    ): T = if (file.size <= SINGLE_MAX) single(file, singlePath, fields, serializer, onProgress)
    else chunked(file, chunkQuery, serializer, onProgress)

    private suspend fun <T> single(f: Picked, path: String, fields: List<Pair<String, String>>, serializer: KSerializer<T>, onProgress: (Long, Long) -> Unit): T {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            // A real type on the part: some routes check it (API.md §4 E3).
            addFormDataPart("file", f.name, StreamBody(f.mime.toMediaTypeOrNull(), f.size, { context.contentResolver.openInputStream(f.uri)!! }, 0, f.size) { done ->
                onProgress(done, f.size)
            })
        }.build()
        return api.send(Request.Builder().url(api.url(path)).post(body).build(), serializer)
    }

    private suspend fun <T> chunked(f: Picked, query: List<Pair<String, String>>, serializer: KSerializer<T>, onProgress: (Long, Long) -> Unit): T {
        val uploadId = UUID.randomUUID().toString()
        val total = ((f.size + CHUNK - 1) / CHUNK).toInt()
        var result: T? = null
        for (i in 0 until total) {
            val offset = i * CHUNK
            val len = minOf(CHUNK, f.size - offset)
            val url: HttpUrl = api.url("/api/attachments/chunk").newBuilder().apply {
                addQueryParameter("uploadId", uploadId)
                addQueryParameter("chunkIndex", "$i")
                addQueryParameter("totalChunks", "$total")
                addQueryParameter("totalSize", "${f.size}")
                addQueryParameter("filename", f.name)
                query.forEach { (k, v) -> addQueryParameter(k, v) }
            }.build()
            val body = StreamBody("application/octet-stream".toMediaTypeOrNull(), len, { context.contentResolver.openInputStream(f.uri)!! }, offset, len) { done ->
                onProgress(offset + done, f.size)
            }
            if (i < total - 1) {
                api.send(Request.Builder().url(url).post(body).build(), kotlinx.serialization.json.JsonObject.serializer())
            } else {
                result = api.send(Request.Builder().url(url).post(body).build(), serializer)
            }
        }
        return result!!
    }

    /** A slice of a stream as a request body, reporting bytes written; re-openable for retries. */
    private class StreamBody(
        private val type: MediaType?,
        private val length: Long,
        private val open: () -> InputStream,
        private val offset: Long,
        private val count: Long,
        private val progress: (Long) -> Unit,
    ) : RequestBody() {
        override fun contentType() = type
        override fun contentLength() = length
        override fun writeTo(sink: BufferedSink) {
            open().use { input ->
                var skip = offset
                while (skip > 0) {
                    val s = input.skip(skip)
                    if (s <= 0) break
                    skip -= s
                }
                val src = input.source()
                var written = 0L
                val buf = okio.Buffer()
                while (written < count) {
                    val n = src.read(buf, minOf(64 * 1024L, count - written))
                    if (n < 0) break
                    sink.write(buf, n)
                    written += n
                    progress(written)
                }
            }
        }
    }

    companion object {
        const val SINGLE_MAX = 64L shl 20
        const val CHUNK = 16L shl 20
        const val MAX_FILE = 1L shl 30
    }
}
