package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.Request

// API.md §2.6 GIDEON. Sent through the common client (headers, cookie, LAN, 426), unlike iOS.

@Serializable data class GAttachment(val kind: String? = null, val url: String? = null, val name: String? = null, val mime: String? = null)
@Serializable data class GMessage(val role: String, val content: String = "", val tools: List<String> = emptyList(), val attachments: List<GAttachment> = emptyList())
@Serializable data class GHistory(val messages: List<GMessage> = emptyList())

enum class GideonTier(val key: String, val label: String) { ASTRA("astra", "Astra"), LUNA("luna", "Luna"), TERRA("terra", "Terra"), EXPERIMENTAL("experimental", "Experimental") }

/** What goes with a question: an image (base64 JPEG) or a document (≤ 10 MB, known extensions). */
sealed interface GUpload {
    data class Image(val jpeg: ByteArray) : GUpload
    data class Document(val name: String, val mime: String, val bytes: ByteArray) : GUpload
}

object GideonRules {
    const val MAX_DOC = 10L shl 20
    val DOC_EXTENSIONS = setOf("pdf", "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html", "docx", "doc", "xlsx", "xls",
        "pptx", "ppt", "odt", "ods", "odp", "rtf", "epub", "ipynb")

    fun acceptsDocument(name: String) = name.substringAfterLast('.', "").lowercase() in DOC_EXTENSIONS

    /** SSE frames `data: {"type":…,"content":…}`: text is appended, error is the sentence, done stops; bad frames are skipped. */
    fun parse(raw: String, decode: (String) -> JsonObject?): Pair<String, String?> {
        val text = StringBuilder(); var error: String? = null
        for (line in raw.lineSequence()) {
            val l = line.trim()
            if (!l.startsWith("data:")) continue
            val o = decode(l.removePrefix("data:").trim()) ?: continue
            val content = (o["content"] as? JsonPrimitive)?.contentOrNull
            when ((o["type"] as? JsonPrimitive)?.contentOrNull) {
                "text" -> content?.let(text::append)
                "error" -> error = content
                "done" -> break
            }
        }
        return text.toString() to error
    }
}

/**
 * The transcript lives here, outside the screen: closing GIDEON does not cancel the server's
 * work, and the answer lands when it comes. Cleared on logout (AppContainer).
 */
class GideonChat(private val api: ApiClient, private val scope: CoroutineScope) {
    data class State(val messages: List<GMessage> = emptyList(), val loaded: Boolean = false, val thinking: Boolean = false,
                     val error: String? = null, val tier: GideonTier = GideonTier.LUNA)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        if (_state.value.loaded) return
        scope.launch {
            runCatching { api.get("/api/gideon/history", GHistory.serializer()) }.getOrNull()?.let { h ->
                _state.update { it.copy(messages = h.messages.map { m -> m.copy(attachments = m.attachments.filter { a -> a.url != null }) }, loaded = true) }
            }
        }
    }

    fun setTier(t: GideonTier) = _state.update { it.copy(tier = t) }
    fun dismissError() = _state.update { it.copy(error = null) }

    fun ask(text: String, upload: GUpload?, sentences: (Int) -> String) {
        if (_state.value.thinking || (text.isBlank() && upload == null)) return
        val q = GMessage("user", text.trim(), attachments = when (upload) {
            is GUpload.Image -> listOf(GAttachment("image", name = "image"))
            is GUpload.Document -> listOf(GAttachment("document", name = upload.name, mime = upload.mime))
            null -> emptyList()
        })
        val history = _state.value.messages + q
        _state.update { it.copy(messages = history, thinking = true, error = null) }
        scope.launch {
            try {
                val body = buildJsonObject {
                    put("messages", buildJsonArray { history.takeLast(30).forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) } })
                    put("model", _state.value.tier.key)
                    when (upload) {
                        is GUpload.Image -> put("image", "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(upload.jpeg))
                        is GUpload.Document -> put("file", buildJsonObject { put("name", upload.name); put("type", upload.mime); put("data", java.util.Base64.getEncoder().encodeToString(upload.bytes)) })
                        null -> Unit
                    }
                }
                val raw = api.sendText(Request.Builder().url(api.url("/api/gideon")).header("Accept", "text/event-stream")
                    .post(body.toString().toJsonBody()).build(), readTimeoutMs = 180_000)
                val (answer, err) = GideonRules.parse(raw) { runCatching { api.json.parseToJsonElement(it).jsonObject }.getOrNull() }
                _state.update { s -> s.copy(messages = if (answer.isNotBlank()) s.messages + GMessage("assistant", answer) else s.messages, error = err) }
            } catch (e: ApiError) {
                val http = e as? ApiError.Http
                val msg = when {
                    http?.status == 413 -> http.serverMessage ?: sentences(0)
                    http?.status == 415 -> http.serverMessage ?: sentences(1)
                    else -> http?.serverMessage ?: sentences(2)
                }
                _state.update { it.copy(error = msg) }
            }
            _state.update { it.copy(thinking = false) }
        }
    }

    fun clear(onError: (String) -> Unit) = scope.launch {
        try {
            api.send(Request.Builder().url(api.url("/api/gideon/history")).delete().build(), JsonObject.serializer())
            _state.update { it.copy(messages = emptyList()) }
        } catch (e: ApiError) { onError((e as? ApiError.Http)?.serverMessage ?: e.message.orEmpty()) }
    }

    /** Logout: the next person never sees this transcript. */
    fun reset() { _state.value = State() }
}
