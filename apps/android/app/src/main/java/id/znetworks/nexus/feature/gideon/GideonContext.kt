package id.znetworks.nexus.feature.gideon

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

// GIDEON context (@ pages) and approval (Review before writing), dev web GideonPanel / lib/gideon.ts and
// iOS Gideon.swift + GideonPanelExtras.swift (12-13 Oct 2026).

/** A page added with @ in the composer (server GideonContextRef + the title the chip shows). */
@Serializable data class GRef(val kind: String, val id: String, val title: String? = null, val projectId: String? = null)

/** GET /api/search, only what the @ picker reads (tasks / docs carry their project for the second line). */
@Serializable data class GMentionSearch(
    val projects: List<Project> = emptyList(),
    val docs: List<Doc> = emptyList(),
    val tasks: List<Task> = emptyList(),
) {
    @Serializable data class Name(val name: String? = null)
    @Serializable data class ListRef(val project: Name? = null)
    @Serializable data class Project(val id: String, val name: String = "")
    @Serializable data class Doc(val id: String, val title: String = "", val project: Name? = null)
    @Serializable data class Task(val id: String, val title: String = "", val taskList: ListRef? = null)
}

/** One row of the @ picker: the ref it adds and the project it sits in (for same-named pages). */
data class GMentionHit(val ref: GRef, val sub: String?)

/** The "@query" the composer is typing, and what the picker does with it. */
object GideonMention {
    /** At most this many @ pages ride on a question (web `.slice(0, 8)`, iOS `refs.count < 8`). */
    const val MAX_REFS = 8
    const val DEBOUNCE_MS = 180L

    private val TRAILING = Regex("(^|\\s)@([^\\s@]{0,40})$")
    private val TOKEN = Regex("@([^\\s@]{0,40})$")

    /** The query after a trailing "@" (web `(^|\s)@([^\s@]{0,40})$`), "" right after the "@", or null. */
    fun query(draft: String): String? = TRAILING.find(draft)?.groupValues?.get(2)

    /** The draft without its trailing "@query" (the chip says it now). */
    fun strip(draft: String): String = TOKEN.find(draft)?.let { draft.substring(0, it.range.first) } ?: draft

    /** "+ → Add a page, task or project": an "@" at the end of the draft, after a space when needed. */
    fun start(draft: String): String = draft + if (draft.isEmpty() || draft.endsWith(" ") || draft.endsWith("\n")) "@" else " @"

    /** [refs] with [ref] added once (same kind + id), never more than [MAX_REFS]. */
    fun add(refs: List<GRef>, ref: GRef): List<GRef> =
        if (refs.any { it.kind == ref.kind && it.id == ref.id } || refs.size >= MAX_REFS) refs else refs + ref

    /**
     * The picker's rows (web MentionPicker, iOS GideonMentionPicker): up to 4 projects, 4 docs and 6 tasks, the
     * closest title first; an "Untitled" page only when that is what was typed. [untitled] is the app's word for it.
     */
    fun hits(r: GMentionSearch, query: String, untitled: String = "Untitled"): List<GMentionHit> {
        val low = query.trim().lowercase()
        if (low.isEmpty()) return emptyList()
        fun score(t: String) = t.lowercase().let { if (it == low) 3 else if (it.startsWith(low)) 2 else if (it.contains(low)) 1 else 0 }
        val projects = r.projects.take(4).map { GMentionHit(GRef("project", it.id, it.name, it.id), null) }
        val docs = r.docs.filter { it.title.isNotBlank() && (it.title != "Untitled" || "untitled".startsWith(low) || untitled.lowercase().startsWith(low)) }.take(4)
            .map { GMentionHit(GRef("doc", it.id, if (it.title == "Untitled") untitled else it.title), it.project?.name) }
        val tasks = r.tasks.take(6).map { GMentionHit(GRef("task", it.id, it.title), it.taskList?.project?.name) }
        // sortedByDescending is stable: equal scores keep projects, docs, tasks in that order.
        return (projects + docs + tasks).sortedByDescending { score(it.ref.title.orEmpty()) }
    }

    /**
     * The body's `context` (web streamGideon): the page GIDEON was opened on plus the @ pages as `refs:[{kind,id}]`
     * (titles stay on the phone; the server re-checks each id and drops what this account cannot open). Null when
     * there is nothing to send.
     */
    fun context(projectId: String?, refs: List<GRef>): JsonObject? {
        if (projectId == null && refs.isEmpty()) return null
        return buildJsonObject {
            if (projectId != null) put("projectId", projectId)
            if (refs.isNotEmpty()) put("refs", buildJsonArray { refs.forEach { r -> add(buildJsonObject { put("kind", r.kind); put("id", r.id) }) } })
        }
    }
}

/** Which writes wait for the person (web GIDEON_APPROVAL_MODES; the server's needsApproval ids). */
enum class GideonApprovalMode(val key: String) {
    ALWAYS_ASK("always_ask"), REVIEW("review"), DONT_ASK("dont_ask");

    companion object {
        /** The web's and iOS's default; a client that sends nothing gets the server's "just do it". */
        val fallback = REVIEW
        fun of(key: String?): GideonApprovalMode = entries.firstOrNull { it.key == key } ?: fallback
    }
}

/** Review before writing: deciding a proposal and keeping the transcript in step with the answer. */
object GideonReview {
    /** POST /api/gideon/proposals/:id body; `booking` = the room and slot picked on a book_room card. */
    fun body(apply: Boolean, booking: GBookingChoice? = null): JsonObject = buildJsonObject {
        put("decision", if (apply) "apply" else "discard")
        if (booking != null) put("booking", buildJsonObject { put("room", booking.room); put("startsAt", booking.startsAt); put("endsAt", booking.endsAt) })
    }

    /**
     * A refusal that still carries the proposal is an answer, not a failure: 409 already decided (a double tap),
     * 410 expired, 422 the write failed (status FAILED with its reason).
     */
    fun carriesProposal(status: Int): Boolean = status in 200..299 || status == 409 || status == 410 || status == 422

    /** [messages] with every copy of [p] (same id) replaced by it. */
    fun replace(messages: List<GMessage>, p: GProposal): List<GMessage> = messages.map { m ->
        if (m.proposals.none { it.id == p.id }) m
        else m.copy(meta = (m.meta ?: GMeta()).let { meta -> meta.copy(proposals = meta.proposals.map { if (it.id == p.id) p else it }) })
    }

    /** What the card's status line says once it is no longer waiting. */
    enum class Status { APPLIED, DISCARDED, APPLYING, FAILED, OTHER }

    fun status(p: GProposal): Status = when (p.status) {
        "APPLIED" -> Status.APPLIED; "DISCARDED" -> Status.DISCARDED; "APPLYING" -> Status.APPLYING; "FAILED" -> Status.FAILED
        else -> Status.OTHER
    }

    /** A diff value that may be a string, a number, a bool or null (iOS GideonLoose). */
    fun loose(e: JsonElement?): String? {
        val p = e as? JsonPrimitive ?: return null
        if (p is JsonNull) return null
        if (p.isString) return p.content
        p.content.toDoubleOrNull()?.let { d -> if (d == Math.rint(d) && kotlin.math.abs(d) < 9e15) return d.toLong().toString() }
        return p.contentOrNull
    }
}
