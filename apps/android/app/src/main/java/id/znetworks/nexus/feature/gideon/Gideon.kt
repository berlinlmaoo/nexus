package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

// API.md §2.6 GIDEON, redesigned 13 Oct 2026 after the dev web (Notion AI's chat page): conversations with
// search, a fresh chat on every open, markdown answers, tool steps in plain words. Sent through the common
// client (headers, cookie, LAN, 426).

@Serializable data class GAttachment(val kind: String? = null, val url: String? = null, val name: String? = null, val mime: String? = null)

/** One tool step of an answer (server gideon-runs.ts): `tool` is never shown as is — see [GideonSteps]. */
@Serializable data class GStep(val id: String = "", val tool: String = "", val arg: String? = null, val label: String? = null, val status: String? = null)

/** Something GIDEON made or changed (with "Don't ask", or after Apply): server GideonCard. */
@Serializable data class GCard(val kind: String? = null, val action: String? = null, val id: String = "", val title: String? = null,
                               val projectName: String? = null, val status: String? = null)

/** One row of a proposal's diff; `from` / `to` may arrive as a string, a number, a bool or null. */
@Serializable data class GDiffRow(val field: String? = null, val from: JsonElement? = null, val to: JsonElement? = null) {
    val fromText: String? get() = GideonReview.loose(from)
    val toText: String? get() = GideonReview.loose(to)
}

/** A write GIDEON holds for the person's Apply / Discard (server proposalView; iOS GideonProposal). */
@Serializable data class GProposal(val id: String, val action: String? = null, val summary: String? = null, val status: String = "PENDING",
                                   val error: String? = null, val diff: List<GDiffRow> = emptyList(), val card: GCard? = null) {
    val isPending: Boolean get() = status == "PENDING"
}

@Serializable data class GMeta(val steps: List<GStep> = emptyList(), val cards: List<GCard> = emptyList(), val proposals: List<GProposal> = emptyList())

@Serializable
data class GMessage(
    val role: String,
    val content: String = "",
    val tools: List<String> = emptyList(),
    val attachments: List<GAttachment> = emptyList(),
    val meta: GMeta? = null,
) {
    val steps: List<GStep> get() = meta?.steps.orEmpty()
    val cards: List<GCard> get() = meta?.cards.orEmpty()
    val proposals: List<GProposal> get() = meta?.proposals.orEmpty()
}

@Serializable data class GProposalEnvelope(val proposal: GProposal? = null, val error: String? = null)

@Serializable data class GChatRef(val id: String, val title: String? = null)
@Serializable data class GHistory(val messages: List<GMessage> = emptyList(), val chat: GChatRef? = null)

/** A saved conversation (GET /api/gideon/chats?q=). [match] = the line that matched a search. */
@Serializable data class GChatRow(val id: String, val title: String? = null, val createdAt: String? = null, val updatedAt: String? = null,
                                  val messages: Int = 0, val match: String? = null)
@Serializable data class GChats(val chats: List<GChatRow> = emptyList())

enum class GideonTier(val key: String, val label: String) { ASTRA("astra", "Astra"), LUNA("luna", "Luna"), TERRA("terra", "Terra"), EXPERIMENTAL("experimental", "Experimental") }

/** What goes with a question: an image (base64 JPEG) or a document (≤ 10 MB, known extensions). */
sealed interface GUpload {
    data class Image(val jpeg: ByteArray) : GUpload
    data class Document(val name: String, val mime: String, val bytes: ByteArray) : GUpload
}

/** What one streamed answer amounted to (all frames read). */
data class GStream(val text: String, val steps: List<GStep>, val chatId: String?, val chatTitle: String?, val error: String?,
                   val cards: List<GCard> = emptyList(), val proposals: List<GProposal> = emptyList()) {
    /** Text, a change made, or a change waiting for Apply: anything else is "GIDEON didn't answer". */
    val answered: Boolean get() = text.isNotBlank() || cards.isNotEmpty() || proposals.isNotEmpty()
}

object GideonRules {
    const val MAX_DOC = 10L shl 20
    val DOC_EXTENSIONS = setOf("pdf", "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html", "docx", "doc", "xlsx", "xls",
        "pptx", "ppt", "odt", "ods", "odp", "rtf", "epub", "ipynb")

    fun acceptsDocument(name: String) = name.substringAfterLast('.', "").lowercase() in DOC_EXTENSIONS

    /**
     * SSE frames `data: {...}` of the streaming contract (web lib/gideon.ts): `text`/`delta` append, `reset` drops
     * the interim text (a tool round started), `final` is the authoritative answer, `step` upserts a step by id,
     * `chat` names the conversation, `error` is a sentence, `done` stops. Bad frames are skipped.
     */
    fun parse(raw: String, decode: (String) -> JsonObject?): GStream {
        val text = StringBuilder(); var error: String? = null
        val steps = LinkedHashMap<String, GStep>()
        var chatId: String? = null; var chatTitle: String? = null
        val cards = ArrayList<GCard>()
        val proposals = LinkedHashMap<String, GProposal>()
        fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
        loop@ for (line in raw.lineSequence()) {
            val l = line.trim()
            if (!l.startsWith("data:")) continue
            val o = decode(l.removePrefix("data:").trim()) ?: continue
            when (o.s("type")) {
                "text", "delta" -> o.s("content")?.let(text::append)
                "reset" -> text.setLength(0)
                "final" -> { text.setLength(0); o.s("content")?.let(text::append) }
                "step" -> (o["step"] as? JsonObject)?.let { st ->
                    val id = st.s("id") ?: "s${steps.size}"
                    steps[id] = GStep(id, st.s("tool").orEmpty(), st.s("arg"), st.s("label"), st.s("status"))
                }
                "card" -> (o["card"] as? JsonObject)?.let { j -> runCatching { NexusJson.decodeFromJsonElement(GCard.serializer(), j) }.getOrNull() }?.let(cards::add)
                // Review before writing: a write held for Apply / Discard; a later frame for the same id replaces it.
                "proposal" -> (o["proposal"] as? JsonObject)?.let { j -> runCatching { NexusJson.decodeFromJsonElement(GProposal.serializer(), j) }.getOrNull() }
                    ?.let { proposals[it.id] = it }
                "chat" -> { chatId = o.s("id") ?: chatId; chatTitle = chatTitle ?: o.s("title") }
                "error" -> error = o.s("content").orEmpty()
                "done" -> break@loop
            }
        }
        // A run that finished has no step left running.
        val done = steps.values.map { if (it.status == "running") it.copy(status = "done") else it }
        val answer = text.toString().let { if (GideonProblem.isEmptyPlaceholder(it)) "" else it }
        return GStream(answer, done, chatId, chatTitle, error, cards, proposals.values.toList())
    }
}

/**
 * A failure in words (iOS GideonProblem, web 13 Oct): never "Gideon error (503)." or the Indonesian-only
 * route sentences. [kind] picks the app-language sentence; [raw] is a server sentence kept for OTHER.
 */
data class GideonProblem(val kind: Kind, val retryable: Boolean, val raw: String? = null) {
    enum class Kind { UNREACHABLE, BUSY, NOT_CONNECTED, NO_ANSWER, TOO_LARGE, UNSUPPORTED, RATE_LIMITED, NO_DOCUMENTS, COULDNT_ANSWER, FAILED, OTHER }

    companion object {
        val unreachable = GideonProblem(Kind.UNREACHABLE, true)
        val busy = GideonProblem(Kind.BUSY, true)
        val notConnected = GideonProblem(Kind.NOT_CONNECTED, false)
        val noAnswer = GideonProblem(Kind.NO_ANSWER, true)

        /** A refusal as an HTTP status, before any answer streamed; [code] / [message] from the JSON body. */
        fun http(status: Int, code: String?, message: String?): GideonProblem {
            when (code.orEmpty().lowercase()) {
                "file_too_large" -> return GideonProblem(Kind.TOO_LARGE, false)
                "unsupported_file_type" -> return GideonProblem(Kind.UNSUPPORTED, false)
                "not_configured", "gideon_unavailable" -> return notConnected
                "gideon_no_answer" -> return noAnswer
                "rate_limited" -> return GideonProblem(Kind.RATE_LIMITED, false)
            }
            return when (status) {
                413 -> GideonProblem(Kind.TOO_LARGE, false)
                415 -> GideonProblem(Kind.UNSUPPORTED, false)
                429 -> busy
                503 -> if (message.orEmpty().lowercase().let { "not connected" in it || "isn't connected" in it }) notConnected else unreachable
                502, 504, in 520..527, 530 -> unreachable
                else -> if (!message.isNullOrBlank()) stream(message).copy(retryable = status >= 500) else GideonProblem(Kind.COULDNT_ANSWER, status >= 500)
            }
        }

        /** An `error` event inside the stream: fixed server sentences (some Indonesian only) and "Gideon error (NNN).". */
        fun stream(content: String): GideonProblem {
            val s = content.trim(); val lower = s.lowercase()
            Regex("^gideon error \\((\\d{3})\\)").find(lower)?.groupValues?.get(1)?.toIntOrNull()?.let { status ->
                return when (status) {
                    429 -> busy
                    415 -> GideonProblem(Kind.UNSUPPORTED, false)
                    413 -> GideonProblem(Kind.TOO_LARGE, false)
                    in 500..599 -> unreachable
                    else -> GideonProblem(Kind.COULDNT_ANSWER, true)
                }
            }
            return when {
                "dokumen belum bisa dibaca" in lower -> GideonProblem(Kind.NO_DOCUMENTS, false)
                "gak bisa dihubungi" in lower || "can't be reached" in lower || "cannot be reached" in lower -> unreachable
                "isn't connected" in lower || "not connected" in lower -> notConnected
                "file terlalu besar" in lower -> GideonProblem(Kind.TOO_LARGE, false)
                s.isEmpty() || lower == "gideon failed." -> GideonProblem(Kind.FAILED, true)
                else -> GideonProblem(Kind.OTHER, true, s)
            }
        }

        fun from(e: ApiError): GideonProblem = when (e) {
            is ApiError.Http -> http(e.status, e.code, e.serverMessage)
            is ApiError.Transport -> unreachable
            else -> GideonProblem(Kind.FAILED, true)
        }

        /** "(Gideon balas kosong — coba ulang.)": an empty answer, not an answer. */
        fun isEmptyPlaceholder(text: String): Boolean { val l = text.lowercase(); return "balas kosong" in l && l.length < 60 }
    }
}

/** A tool step in plain words (web GideonPanel stepText): which sentence, and the name / query it carries. */
object GideonSteps {
    enum class Kind {
        LIST_PROJECTS, LOOKUP_PEOPLE, LIST_TASKS, SEARCH_TASKS, SEARCH_WORKSPACE, READ_PROJECT, READ_NAMED, READ_FIELDS, READ_TASK,
        SEARCH_DOCS, READ_DOC, CREATE_TASK, UPDATE_TASK, COMMENT, WRITE_DOC, LOOK_IMAGE, LABEL, WORKING,
    }

    /** [arg] is the step's own handle (≤ 60 chars) or null when the sentence has none. */
    data class Text(val kind: Kind, val arg: String?)

    fun text(s: GStep): Text {
        val a = s.arg?.trim()?.take(60)?.takeIf { it.isNotEmpty() }
        fun t(k: Kind, withArg: Boolean = true) = Text(k, if (withArg) a else null)
        return when (s.tool) {
            "list_projects" -> t(Kind.LIST_PROJECTS, false)
            "list_members" -> t(Kind.LOOKUP_PEOPLE, false)
            "list_tasks" -> t(Kind.LIST_TASKS)
            "search_tasks" -> t(Kind.SEARCH_TASKS)
            "search_workspace" -> t(Kind.SEARCH_WORKSPACE)
            "get_project_summary" -> t(Kind.READ_PROJECT)
            "read_context" -> if (a != null) t(Kind.READ_NAMED) else Text(Kind.READ_PROJECT, null)
            "list_custom_fields" -> t(Kind.READ_FIELDS, false)
            "get_task" -> t(Kind.READ_TASK)
            "search_docs" -> t(Kind.SEARCH_DOCS)
            "get_doc" -> t(Kind.READ_DOC)
            "create_task" -> t(Kind.CREATE_TASK)
            "update_task" -> t(Kind.UPDATE_TASK)
            "add_task_comment" -> t(Kind.COMMENT)
            "create_document" -> t(Kind.WRITE_DOC)
            "vision_analyze", "vision" -> t(Kind.LOOK_IMAGE, false)
            // An unknown tool: the server's own label when it reads as words, never a raw tool name.
            else -> s.label?.trim()?.takeIf { it.isNotEmpty() && !looksLikeToolName(it) && it != s.tool }?.let { Text(Kind.LABEL, it) } ?: Text(Kind.WORKING, null)
        }
    }

    /** `search_tasks`, `getDoc`, `mcp.list`: an identifier, not a sentence. */
    fun looksLikeToolName(s: String) = !s.contains(' ') && (s.contains('_') || s.contains('.') || Regex("[a-z][A-Z]").containsMatchIn(s) || s == s.lowercase())
}

/** Saved titles that were a suggestion chip show in the app's language (web gideon-chat-title.ts, iOS GideonChatTitle). */
object GideonChatTitle {
    val CHIPS = listOf(
        "What's overdue for me?" to "Apa saja task-ku yang terlambat?",
        "Summarize my week across projects" to "Ringkas mingguku di semua project",
        "What did my team decide recently? Cite the sources." to "Apa yang baru diputuskan timku? Sebutkan sumbernya.",
        "Summarize this page" to "Ringkas halaman ini",
        "Find the action items in this page" to "Temukan action item di halaman ini",
        "What questions does this page leave open?" to "Pertanyaan apa yang belum terjawab di halaman ini?",
        "What's the latest on this task?" to "Apa kabar terbaru task ini?",
        "Break this task into subtasks" to "Pecah task ini jadi subtask",
        "Draft a status comment for this task" to "Buatkan draf komentar status untuk task ini",
    )

    fun text(title: String?, indonesian: Boolean): String? {
        val s = title?.trim() ?: return title
        CHIPS.firstOrNull { s == it.first || s == it.second }?.let { return if (indonesian) it.second else it.first }
        return title
    }
}

/** The chat list's groups by last activity, in the viewer's day (web dayBucket). */
object GideonChatGroups {
    enum class Bucket { TODAY, YESTERDAY, WEEK, OLDER }

    fun bucket(iso: String?, today: LocalDate, zone: ZoneId = ZoneId.of("Asia/Jakarta")): Bucket {
        val d = iso?.let { runCatching { Instant.parse(it).atZone(zone).toLocalDate() }.getOrNull() } ?: return Bucket.OLDER
        return when {
            !d.isBefore(today) -> Bucket.TODAY
            d == today.minusDays(1) -> Bucket.YESTERDAY
            !d.isBefore(today.minusDays(7)) -> Bucket.WEEK
            else -> Bucket.OLDER
        }
    }

    fun group(rows: List<GChatRow>, today: LocalDate): List<Pair<Bucket, List<GChatRow>>> =
        Bucket.entries.map { b -> b to rows.filter { bucket(it.updatedAt ?: it.createdAt, today) == b } }.filter { it.second.isNotEmpty() }
}

/**
 * The conversation lives here, outside the screen: closing GIDEON does not cancel the server's work, and the
 * answer lands in its own chat (a generation number keeps a late answer out of a chat started since).
 * Cleared on logout (AppContainer).
 */
class GideonChat(private val api: ApiClient, private val scope: CoroutineScope) {
    data class State(
        val chatId: String? = null,
        val chatTitle: String? = null,
        val messages: List<GMessage> = emptyList(),
        val opening: Boolean = false,
        val thinking: Boolean = false,
        val error: GideonProblem? = null,
        /** Opening a saved chat failed: the page says so (not an empty "new chat"). */
        val openFailed: GideonProblem? = null,
        val tier: GideonTier = GideonTier.LUNA,
        val chats: List<GChatRow>? = null,
        val chatsError: GideonProblem? = null,
        val query: String = "",
        /** The project GIDEON was opened from ("Ask GIDEON" on a project page): sent as context until removed. */
        val project: Pair<String, String>? = null,
        /** Pages, tasks and projects added with @ (web chips, at most 8): sent as `context.refs` until removed. */
        val refs: List<GRef> = emptyList(),
        /** "Review before writing": which writes wait for Apply (sent as `approvalMode` with every question). */
        val approval: GideonApprovalMode = GideonApprovalMode.fallback,
        /** Proposals with an Apply / Discard on its way (their buttons wait). */
        val deciding: Set<String> = emptySet(),
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    private var generation = 0
    /** The question that failed, for Try again (nothing is stored server-side for a failed turn). */
    private var failed: Outgoing? = null

    /** A question as it was asked: its @ pages and approval mode go with it, not whatever the chips say later. */
    private data class Outgoing(val text: String, val upload: GUpload?, val refs: List<GRef>, val approval: GideonApprovalMode)

    /** A fresh conversation: every time GIDEON opens, and from "New chat". */
    fun startNew(project: Pair<String, String>? = null) {
        generation++
        failed = null
        _state.update { it.copy(chatId = null, chatTitle = null, messages = emptyList(), thinking = false, opening = false, error = null, openFailed = null,
            project = project, refs = emptyList(), deciding = emptySet()) }
    }

    /** A page picked in the @ picker (once; at most [GideonMention.MAX_REFS]). */
    fun addRef(ref: GRef) = _state.update { it.copy(refs = GideonMention.add(it.refs, ref)) }

    /** A chip's x. */
    fun removeRef(ref: GRef) = _state.update { it.copy(refs = it.refs.filterNot { r -> r.kind == ref.kind && r.id == ref.id }) }

    fun setApproval(mode: GideonApprovalMode) = _state.update { it.copy(approval = mode) }

    /**
     * Apply or Discard a proposal (POST /api/gideon/proposals/:id {decision}); the card shows what came back. The
     * server re-checks access when applying, and a double tap applies once (409 still carries the proposal).
     */
    fun decide(p: GProposal, apply: Boolean) {
        if (p.id in _state.value.deciding) return
        _state.update { it.copy(deciding = it.deciding + p.id, error = null) }
        scope.launch {
            try {
                val updated = try {
                    api.send(Request.Builder().url(api.url("/api/gideon/proposals/" + URLEncoder.encode(p.id, "UTF-8")))
                        .post(GideonReview.body(apply).toString().toJsonBody()).build(), GProposalEnvelope.serializer()).proposal
                } catch (e: ApiError.Http) {
                    val carried = if (GideonReview.carriesProposal(e.status)) (e.body?.get("proposal") as? JsonObject)
                        ?.let { j -> runCatching { api.json.decodeFromJsonElement(GProposal.serializer(), j) }.getOrNull() } else null
                    carried ?: throw e
                }
                if (updated != null) {
                    _state.update { it.copy(messages = GideonReview.replace(it.messages, updated)) }
                    if (apply && !updated.error.isNullOrBlank()) _state.update { it.copy(error = GideonProblem(GideonProblem.Kind.OTHER, false, updated.error)) }
                }
            } catch (e: ApiError) {
                // Not a question to ask again: Try again would re-send the last failed question instead.
                _state.update { it.copy(error = GideonProblem.from(e).copy(retryable = false)) }
            } finally {
                _state.update { it.copy(deciding = it.deciding - p.id) }
            }
        }
    }

    /** The context chip's ×: ask without the project. */
    fun dropProject() = _state.update { it.copy(project = null) }

    fun open(chatId: String) {
        val gen = ++generation
        failed = null
        _state.update { it.copy(chatId = chatId, chatTitle = it.chats?.firstOrNull { c -> c.id == chatId }?.title, messages = emptyList(),
            opening = true, thinking = false, error = null, openFailed = null, refs = emptyList(), deciding = emptySet()) }
        scope.launch {
            try {
                val h = api.get("/api/gideon/history?chatId=" + URLEncoder.encode(chatId, "UTF-8"), GHistory.serializer())
                if (gen != generation) return@launch
                _state.update { it.copy(opening = false, chatTitle = h.chat?.title ?: it.chatTitle,
                    messages = h.messages.map { m -> m.copy(attachments = m.attachments.filter { a -> a.url != null }) }) }
            } catch (e: ApiError) {
                if (gen == generation) _state.update { it.copy(opening = false, openFailed = GideonProblem.from(e)) }
            }
        }
    }

    fun setTier(t: GideonTier) = _state.update { it.copy(tier = t) }
    fun dismissError() = _state.update { it.copy(error = null) }

    fun ask(text: String, upload: GUpload?) = ask(Outgoing(text, upload, _state.value.refs, _state.value.approval))

    private fun ask(out: Outgoing) {
        val (text, upload) = out
        if (_state.value.thinking || (text.isBlank() && upload == null)) return
        val q = GMessage("user", text.trim(), attachments = when (upload) {
            is GUpload.Image -> listOf(GAttachment("image", name = "image"))
            is GUpload.Document -> listOf(GAttachment("document", name = upload.name, mime = upload.mime))
            null -> emptyList()
        })
        val gen = generation
        val history = _state.value.messages + q
        val chatId = _state.value.chatId
        _state.update { it.copy(messages = history, thinking = true, error = null) }
        scope.launch {
            var problem: GideonProblem? = null
            try {
                val body = buildJsonObject {
                    put("messages", buildJsonArray { history.takeLast(30).forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) } })
                    put("model", _state.value.tier.key)
                    put("stream", true)
                    // The interface language, so the answer comes back in it.
                    put("uiLang", AppLanguage.serverCode(AppLanguage.current))
                    // "Review before writing" (web default review; a client that sends nothing gets "don't ask").
                    put("approvalMode", out.approval.key)
                    if (chatId != null) put("chatId", chatId) else put("newChat", true)
                    // The project GIDEON was opened about plus the @ pages (web streamGideon `context`).
                    GideonMention.context(_state.value.project?.first, out.refs)?.let { put("context", it) }
                    when (upload) {
                        is GUpload.Image -> put("image", "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(upload.jpeg))
                        is GUpload.Document -> put("file", buildJsonObject { put("name", upload.name); put("type", upload.mime); put("data", java.util.Base64.getEncoder().encodeToString(upload.bytes)) })
                        null -> Unit
                    }
                }
                val raw = api.sendText(Request.Builder().url(api.url("/api/gideon")).header("Accept", "text/event-stream")
                    .post(body.toString().toJsonBody()).build(), readTimeoutMs = 180_000)
                val r = GideonRules.parse(raw) { runCatching { api.json.parseToJsonElement(it).jsonObject }.getOrNull() }
                if (gen != generation) return@launch
                problem = r.error?.let(GideonProblem::stream) ?: if (!r.answered) GideonProblem.noAnswer else null
                _state.update { s ->
                    s.copy(chatId = r.chatId ?: s.chatId, chatTitle = s.chatTitle ?: r.chatTitle,
                        messages = if (r.answered) s.messages + GMessage("assistant", r.text, meta = GMeta(r.steps, r.cards, r.proposals)) else s.messages)
                }
            } catch (e: ApiError) {
                problem = GideonProblem.from(e)
            }
            if (gen != generation) return@launch
            failed = if (problem != null) out else null
            _state.update { it.copy(thinking = false, error = problem) }
            loadChats()
        }
    }

    /** Try again: the failed question once more (its turn leaves the transcript first, so it is not doubled). */
    fun retry() {
        val out = failed ?: return
        _state.update { s ->
            val i = s.messages.indexOfLast { it.role == "user" }
            s.copy(error = null, messages = if (i >= 0 && s.messages.drop(i + 1).none { it.role == "assistant" }) s.messages.take(i) else s.messages)
        }
        failed = null
        ask(out)
    }

    fun setQuery(q: String) { _state.update { it.copy(query = q) } }

    fun loadChats() = scope.launch {
        val q = _state.value.query.trim()
        try {
            val r = api.get("/api/gideon/chats" + (if (q.isNotEmpty()) "?q=" + URLEncoder.encode(q, "UTF-8") else ""), GChats.serializer())
            if (_state.value.query.trim() == q) _state.update { it.copy(chats = r.chats, chatsError = null) }
        } catch (e: ApiError) {
            // A failed list is not "No chats yet": the last rows stay.
            _state.update { it.copy(chatsError = GideonProblem.from(e), chats = it.chats ?: emptyList()) }
        }
    }

    fun deleteChat(id: String, onError: () -> Unit) = scope.launch {
        _state.update { it.copy(chats = it.chats?.filterNot { c -> c.id == id }) }
        try {
            api.send(Request.Builder().url(api.url("/api/gideon/chats/" + URLEncoder.encode(id, "UTF-8"))).delete().build(), JsonObject.serializer())
            if (_state.value.chatId == id) startNew()
        } catch (_: ApiError) { onError() }
        loadChats()
    }

    /** Logout: the next person never sees this transcript. */
    fun reset() { generation++; failed = null; _state.value = State() }
}
