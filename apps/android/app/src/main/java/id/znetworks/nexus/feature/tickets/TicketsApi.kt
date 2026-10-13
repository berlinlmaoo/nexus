package id.znetworks.nexus.feature.tickets

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// API.md §2.5 Tickets ("complaints": a private line to the BoD) and attendance corrections.

@Serializable data class TPerson(val id: String? = null, val name: String? = null, val avatar: String? = null)
@Serializable data class TAttachment(val id: String? = null, val url: String, val mimeType: String? = null, val size: Long? = null)

@Serializable
data class Ticket(
    val id: String,
    val category: String? = null,
    val subject: String = "",
    val evidenceUrl: String? = null,
    val attachments: List<TAttachment> = emptyList(),
    val status: String = "OPEN",
    val lastMessageAt: String? = null,
    val resolvedAt: String? = null,
    val createdAt: String? = null,
    /** Null = anonymous to this viewer. */
    val reporter: TPerson? = null,
    val messageCount: Int = 0,
    val gideonReplied: Boolean = false,
    val pendingCorrection: Boolean = false,
    val isMine: Boolean = false,
    val canReply: Boolean = false,
    val canManage: Boolean = false,
    // Detail only:
    val resolvedBy: TPerson? = null,
    val messages: List<TMessage> = emptyList(),
) {
    val photos: List<String> get() = attachments.map { it.url }.ifEmpty { listOfNotNull(evidenceUrl) }
    val closed: Boolean get() = status == "CLOSED"
}

@Serializable
data class TMessage(val id: String, val body: String = "", val fromReviewer: Boolean = false, val createdAt: String? = null,
                    val author: TPerson? = null, val mine: Boolean = false, val fromGideon: Boolean = false)

@Serializable
data class TicketList(val complaints: List<Ticket> = emptyList(), val counts: Map<String, Int> = emptyMap(), val viewerIsBod: Boolean = false)

@Serializable
data class Before(val recordId: String? = null, val checkInAt: String? = null, val checkOutAt: String? = null, val status: String? = null)

@Serializable
data class Correction(
    val id: String,
    val status: String = "PENDING",
    val kind: String = "TIME_CORRECTION",
    val date: String? = null,
    val user: TPerson? = null,
    val proposedCheckInAt: String? = null,
    val proposedCheckOutAt: String? = null,
    val reason: String? = null,
    val proposedBy: TPerson? = null,
    val before: Before? = null,
    val beforePenaltyXp: Int? = null,
    val beforeAutoDayOffs: Int? = null,
    val decidedBy: TPerson? = null,
    val decidedAt: String? = null,
    val decisionNote: String? = null,
)

@Serializable
data class Corrections(val corrections: List<Correction> = emptyList(), val canDecide: Boolean = false)

object TicketRules {
    val CATEGORIES = listOf("ATTENDANCE", "EXP", "DAY_OFF", "OTHER")
    val SETTABLE = listOf("OPEN", "IN_REVIEW", "RESOLVED", "CLOSED")
    const val SUBJECT_MIN = 4
    const val SUBJECT_MAX = 140
    const val BODY_MIN = 10
    const val BODY_MAX = 4000
    const val MAX_PHOTOS = 5
    const val MAX_PHOTO_BYTES = 8L shl 20

    /** iOS filter "In review" also holds tickets waiting on a decision. */
    fun inFilter(t: Ticket, filter: String) = when (filter) {
        "ALL" -> true
        "IN_REVIEW" -> t.status == "IN_REVIEW" || t.status == "AWAITING_DECISION"
        else -> t.status == filter
    }

    /**
     * The BoD's queues (web complaints.tsx, 13 Oct): Inbox = unclaimed (OPEN), In review = taken on or answered by
     * GIDEON (IN_REVIEW, AWAITING_DECISION) plus a closed or resolved ticket whose attendance fix still waits for a
     * decision (the server's REVIEW queue: it "stays under In review until someone approves or rejects it"), All.
     */
    enum class Queue { INBOX, REVIEW, ALL }

    fun inQueue(t: Ticket, q: Queue) = when (q) {
        Queue.INBOX -> t.status == "OPEN"
        Queue.REVIEW -> t.status == "IN_REVIEW" || t.status == "AWAITING_DECISION" || (t.pendingCorrection && t.status != "OPEN")
        Queue.ALL -> true
    }

    /**
     * A queue's badge: the server's own count (GET /api/complaints `counts.INBOX` / `counts.REVIEW`, the same numbers
     * the web shows) when it sends one, else counted here. All = the literal statuses summed, like the web.
     */
    fun queueCount(counts: Map<String, Int>, tickets: List<Ticket>, q: Queue): Int = when (q) {
        Queue.INBOX -> counts["INBOX"] ?: counts["OPEN"]
        Queue.REVIEW -> counts["REVIEW"]
        Queue.ALL -> counts.filterKeys { it != "INBOX" && it != "REVIEW" }.values.sum().takeIf { counts.isNotEmpty() }
    } ?: tickets.count { inQueue(it, q) }

    /** Lands on the first queue with something in it (Inbox → In review → All), never an empty Inbox while tickets wait. */
    fun landing(tickets: List<Ticket>): Queue = when {
        tickets.any { inQueue(it, Queue.INBOX) } -> Queue.INBOX
        tickets.any { inQueue(it, Queue.REVIEW) } -> Queue.REVIEW
        else -> Queue.ALL
    }

    /** Tickets with a decision waiting float to the top; the rest keep the server's order (stable). */
    fun ordered(tickets: List<Ticket>) = tickets.sortedByDescending { it.pendingCorrection }

    /** Corrections belong to attendance and XP tickets only (server rule). */
    fun canPropose(t: Ticket) = t.category == "ATTENDANCE" || t.category == "EXP"

    /** "08:05" from the record, in office time; "" when absent. */
    fun hhmm(iso: String?): String = iso?.let {
        runCatching { java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(java.time.Instant.parse(it).atZone(java.time.ZoneId.of("Asia/Jakarta"))) }.getOrNull()
    }.orEmpty()
}

class TicketsApi(private val api: ApiClient) {
    suspend fun list() = api.getCached("/api/complaints?status=ALL", "complaints", TicketList.serializer())

    suspend fun detail(id: String) = api.get("/api/complaints/$id", Ticket.serializer())

    /** Multipart: 1–5 `evidence` photos (image/jpeg), each ≤ 8 MB. */
    suspend fun create(category: String, subject: String, body: String, photos: List<ByteArray>): Ticket {
        val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("category", category).addFormDataPart("subject", subject.trim()).addFormDataPart("body", body.trim())
            .apply { photos.forEachIndexed { i, b -> addFormDataPart("evidence", "evidence-$i.jpg", b.toRequestBody("image/jpeg".toMediaType())) } }
            .build()
        return api.send(Request.Builder().url(api.url("/api/complaints")).post(mp).build(), Ticket.serializer())
    }

    suspend fun reply(id: String, body: String) = send("POST", "/api/complaints/$id/messages", buildJsonObject { put("body", body.trim()) }, Ticket.serializer())

    suspend fun setStatus(id: String, status: String) = send("PATCH", "/api/complaints/$id", buildJsonObject { put("status", status) }, Ticket.serializer())

    suspend fun corrections(id: String) = api.get("/api/complaints/$id/correction", Corrections.serializer())

    /** Omit a time that is not changing (never send null). PENALTY_CANCELLATION takes no times. */
    suspend fun propose(id: String, date: String, checkIn: String?, checkOut: String?, reason: String, kind: String) =
        send("POST", "/api/complaints/$id/correction", buildJsonObject {
            put("decision", "PROPOSE"); put("date", date); put("reason", reason.trim()); put("kind", kind)
            if (kind == "TIME_CORRECTION") { checkIn?.let { put("checkInAt", it) }; checkOut?.let { put("checkOutAt", it) } }
        }, JsonObject.serializer())

    suspend fun decide(id: String, correctionId: String, approve: Boolean, note: String?) =
        send("POST", "/api/complaints/$id/correction", buildJsonObject {
            put("decision", if (approve) "APPROVE" else "REJECT"); put("correctionId", correctionId)
            note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
        }, JsonObject.serializer())

    private suspend fun <T> send(method: String, path: String, body: JsonObject, ser: kotlinx.serialization.KSerializer<T>): T =
        api.send(Request.Builder().url(api.url(path)).method(method, body.toString().toJsonBody()).build(), ser)
}
