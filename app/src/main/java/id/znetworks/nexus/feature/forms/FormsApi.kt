package id.znetworks.nexus.feature.forms

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.session.SessionStore
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.net.URLEncoder

/** The form is closed by its schedule right now: show the sentence, do not fall back. */
class FormClosed(message: String) : Exception(message)

class FormsApi(private val context: Context, private val api: ApiClient, private val sessions: SessionStore) {

    suspend fun projectForms(projectId: String) = api.get("/api/forms?projectId=$projectId", ListSerializer(FormSummary.serializer()))

    /**
     * Public route first; a 403 WITH `accessSchedule` is "closed now" (said, no fallback), a 403
     * without it is a private form, read through the member route.
     */
    suspend fun load(idOrSlug: String): FormDef {
        val key = URLEncoder.encode(idOrSlug, "UTF-8")
        return try {
            api.get("/api/forms/$key/public", FormDef.serializer())
        } catch (e: ApiError.Http) {
            if (e.status != 403) throw e
            if (e.body?.containsKey("accessSchedule") == true) throw FormClosed(e.serverMessage ?: "")
            api.get("/api/forms/$key", FormDef.serializer())
        }
    }

    /**
     * Multipart: `data` (JSON of answers) + `file:<fieldId>` / `attachment:<fieldId>` parts with
     * real types. Not replayable. A 401 LOGIN_REQUIRED keeps the filled form and signs nobody out.
     */
    suspend fun submit(idOrSlug: String, data: Map<String, Any>, uploads: List<FormUpload>, onProgress: (Long, Long) -> Unit): SubmitResult {
        val json = JsonObject(data.mapValues { (_, v) ->
            when (v) {
                is Boolean -> JsonPrimitive(v)
                is List<*> -> JsonArray(v.map { JsonPrimitive(it.toString()) })
                else -> JsonPrimitive(v.toString())
            }
        })
        val total = uploads.sumOf { it.size }
        var sent = 0L
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            addFormDataPart("data", json.toString())
            uploads.forEach { u ->
                val base = sent
                addFormDataPart(u.partName, FormLogic.safeName(u.filename), UriBody(context, u, u.mime.toMediaTypeOrNull()) { done -> onProgress(base + done, total) })
                sent += u.size
            }
        }.build()
        val req = Request.Builder().url(api.url("/api/forms/${URLEncoder.encode(idOrSlug, "UTF-8")}/submit")).post(body).build()
        return api.send(req, SubmitResult.serializer(), asSession = sessions.current)
    }

    suspend fun mySubmissions() = api.getCached("/api/forms/my-submissions", "my-submissions", Submissions.serializer())

    suspend fun submission(id: String) = api.get("/api/forms/my-submissions/$id", Submission.serializer())

    private class UriBody(private val context: Context, private val u: FormUpload, private val type: MediaType?, private val progress: (Long) -> Unit) : RequestBody() {
        override fun contentType() = type
        override fun contentLength() = u.size
        override fun writeTo(sink: BufferedSink) {
            context.contentResolver.openInputStream(u.uri)!!.source().use { src ->
                val buf = okio.Buffer()
                var done = 0L
                while (true) {
                    val n = src.read(buf, 64 * 1024L)
                    if (n < 0) break
                    sink.write(buf, n); done += n; progress(done)
                }
            }
        }
    }
}
