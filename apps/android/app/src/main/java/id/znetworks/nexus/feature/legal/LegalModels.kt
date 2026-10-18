package id.znetworks.nexus.feature.legal

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

// Legal (owner, 14 Oct 2026): invitation-only document assembly + archive, and the requests people send Legal
// through a link. Contract: docs/legal-api.md; iOS LegalModels.swift / LegalRequestModels.swift. Every field has a
// default so an older or newer server never blanks a screen (NexusJson ignores unknown keys and coerces nulls).

@Serializable data class LgPerson(val id: String = "", val name: String = "", val avatar: String? = null)

// ── Access & members ──

@Serializable data class LgMe(val access: Boolean = false, val isRoot: Boolean = false, val invitePower: String = "NONE")

@Serializable
data class LgMember(
    val userId: String = "",
    val name: String = "",
    val email: String = "",
    val avatar: String? = null,
    val orgRole: String? = null,
    val isRoot: Boolean = false,
    val active: Boolean = false,
    val invitedAt: String? = null,
    val invitedBy: LgPerson? = null,
    val revokedAt: String? = null,
    val revokedBy: LgPerson? = null,
    val canRevoke: Boolean = false,
    val invitePower: String = "NONE",
) { val shownName: String get() = name.ifBlank { email } }

@Serializable data class LgMembers(val members: List<LgMember> = emptyList(), val invitePower: String = "NONE")

@Serializable
data class LgCandidate(val userId: String = "", val name: String = "", val email: String = "", val avatar: String? = null, val orgRole: String? = null)

@Serializable data class LgCandidates(val candidates: List<LgCandidate> = emptyList())

// ── Companies & numbering ──

@Serializable
data class LgSeries(
    val id: String = "",
    val key: String = "",
    val docType: String = "OTHER",
    val label: String = "",
    val format: String = "",
    /** YEAR or MONTH. */
    val resetPeriod: String = "YEAR",
    val active: Boolean = true,
)

@Serializable
data class LgCompany(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val legalName: String = "",
    val address: String = "",
    val hasKop: Boolean = false,
    val kopFileName: String? = null,
    val kopUpdatedAt: String? = null,
    val active: Boolean = true,
    val documentCount: Int = 0,
    val series: List<LgSeries> = emptyList(),
)

@Serializable data class LgCompanies(val companies: List<LgCompany> = emptyList())
@Serializable data class LgCompanyOne(val company: LgCompany? = null)
@Serializable data class LgSeriesOne(val series: LgSeries? = null)
/** GET /api/legal/series/:id: how many numbers the series issued, and today's next one. */
@Serializable data class LgSeriesInfo(val series: LgSeries? = null, val issued: Int = 0, val next: String = "")

// ── Templates ──

/** One form field of a template. A `list` field's value is an array of rows keyed by its [columns]. */
@Serializable
data class LgField(
    val name: String = "",
    val label: String = "",
    /** text | longtext | date | number | money | select | boolean | list */
    val type: String = "text",
    val required: Boolean = false,
    val help: String? = null,
    val options: List<String>? = null,
    val columns: List<LgField>? = null,
) { val shownLabel: String get() = label.ifBlank { name } }

@Serializable data class LgCompanyRef(val id: String = "", val code: String = "", val name: String = "")
@Serializable data class LgSeriesRef(val id: String = "", val key: String = "", val label: String = "", val format: String = "")

@Serializable
data class LgTemplateVersion(
    val version: Int = 0,
    val fileName: String = "",
    val size: Long = 0,
    val note: String = "",
    val fieldCount: Int = 0,
    val createdBy: LgPerson? = null,
    val createdAt: String? = null,
)

@Serializable
data class LgTemplate(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val docType: String = "OTHER",
    val company: LgCompanyRef? = null,
    val series: LgSeriesRef? = null,
    val currentVersion: Int = 1,
    val archived: Boolean = false,
    val fields: List<LgField> = emptyList(),
    val createdBy: LgPerson? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val versions: List<LgTemplateVersion> = emptyList(),
)

@Serializable data class LgTemplates(val templates: List<LgTemplate> = emptyList())
@Serializable data class LgTemplateOne(val template: LgTemplate? = null)

// ── Documents ──

@Serializable data class LgProjectRef(val id: String = "", val name: String = "")
@Serializable data class LgDealRef(val id: String = "", val code: String = "", val name: String = "", val projectId: String? = null, val brand: String? = null)

/** Another document a document points at: its parent, an addendum, the one that took its number. */
@Serializable
data class LgDocRef(
    val id: String = "",
    val number: String = "",
    val title: String = "",
    val status: String? = null,
    val docType: String? = null,
    val docDate: String? = null,
    val signedAt: String? = null,
    val numberReleased: Boolean = false,
)

/** One archive row. */
@Serializable
data class LgDocSummary(
    val id: String = "",
    val number: String = "",
    val docType: String = "OTHER",
    val title: String = "",
    val counterparty: String = "",
    /** YYYY-MM-DD */
    val docDate: String? = null,
    val status: String = "DRAFT",
    /** GENERATED or UPLOADED */
    val source: String = "GENERATED",
    val company: LgCompanyRef? = null,
    val project: LgProjectRef? = null,
    val deal: LgDealRef? = null,
    val linkHidden: Boolean = false,
    val currentVersion: Int = 1,
    val createdAt: String? = null,
    val signedAt: String? = null,
    val signedBy: LgPerson? = null,
    val numberReleased: Boolean = false,
    val numberReusedBy: LgDocRef? = null,
    val parent: LgDocRef? = null,
    val addendumNo: Int? = null,
    val addendaCount: Int = 0,
)

@Serializable data class LgDocsPage(val documents: List<LgDocSummary> = emptyList(), val total: Int = 0, val page: Int = 1, val pageSize: Int = 50)

@Serializable
data class LgVersion(
    val version: Int = 0,
    /** GENERATED | MANUAL | GIDEON | UPLOAD | RESTORE */
    val kind: String = "GENERATED",
    val fileName: String = "",
    val mimeType: String = "",
    val size: Long = 0,
    val hasDocx: Boolean = false,
    val hasPdf: Boolean = false,
    val hasFile: Boolean = false,
    val note: String = "",
    val author: LgPerson? = null,
    val createdAt: String? = null,
    /** "REV n" / "FINAL" / "SIGNED"; the download is named "<number> - <title> <label>". */
    val label: String = "",
    val downloadName: String = "",
) { val shownLabel: String get() = label.ifBlank { "REV $version" } }

@Serializable data class LgTemplateUse(val id: String = "", val name: String = "", val version: Int = 1)

/** One document: the archive row plus its notes, numbering, template and versions. */
@Serializable
data class LgDocument(
    val id: String = "",
    val number: String = "",
    val docType: String = "OTHER",
    val title: String = "",
    val counterparty: String = "",
    val docDate: String? = null,
    val status: String = "DRAFT",
    val source: String = "GENERATED",
    val company: LgCompanyRef? = null,
    val project: LgProjectRef? = null,
    val deal: LgDealRef? = null,
    val linkHidden: Boolean = false,
    val currentVersion: Int = 1,
    val createdBy: LgPerson? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val notes: String = "",
    val series: LgSeriesRef? = null,
    val template: LgTemplateUse? = null,
    val finalVersion: Int? = null,
    val hasNumber: Boolean = false,
    val versions: List<LgVersion> = emptyList(),
    val signedAt: String? = null,
    val signedBy: LgPerson? = null,
    /** The signed copy's version: the primary download once signed. */
    val signedVersion: Int? = null,
    val numberReleased: Boolean = false,
    val numberReusedBy: LgDocRef? = null,
    val numberReusedFrom: List<LgDocRef> = emptyList(),
    val parent: LgDocRef? = null,
    val addendumNo: Int? = null,
    val addenda: List<LgDocRef> = emptyList(),
)

@Serializable data class LgDocumentOne(val document: LgDocument? = null)

/** POST /api/legal/documents/prepare: the form, the company and series it will use, the next number. */
@Serializable
data class LgPrepared(
    val template: LgPrepTemplate? = null,
    val company: LgPrepCompany? = null,
    val series: LgPrepSeries? = null,
    val fields: List<LgField> = emptyList(),
    val numberPreview: String = "",
    val parent: LgPrepParent? = null,
    /** Starting values (an addendum's parties, read from its parent). */
    val prefill: JsonObject = JsonObject(emptyMap()),
)
@Serializable data class LgPrepTemplate(val id: String = "", val name: String = "", val docType: String = "OTHER", val version: Int = 1)
@Serializable data class LgPrepCompany(val id: String = "", val code: String = "", val name: String = "", val hasKop: Boolean = false)
@Serializable data class LgPrepSeries(val id: String = "", val key: String = "", val label: String = "", val format: String = "", val resetPeriod: String = "YEAR")
@Serializable data class LgPrepParent(val id: String = "", val number: String = "", val title: String = "", val addendumNo: Int = 1)

@Serializable data class LgGenerated(val id: String = "", val number: String = "", val pdfError: String? = null)
@Serializable data class LgUploaded(val id: String = "", val pdfError: String? = null)
/** A new version (edits, an upload, a restore). */
@Serializable data class LgVersionCreated(val version: Int = 0, val pdfError: String? = null, val signed: Boolean = false)
@Serializable data class LgLinks(val projects: List<LgProjectRef> = emptyList(), val deals: List<LgDealRef> = emptyList())

// ── Review, versions, GIDEON ──

@Serializable
data class LgParagraph(
    val index: Int = 0,
    val text: String = "",
    val editable: Boolean = false,
    /** "number" or "complex" when locked; "empty" for a blank line, which the editor does not draw. */
    val lockReason: String? = null,
    val style: String? = null,
    val inTable: Boolean = false,
    val layout: LgParagraphLayout? = null,
) { val isBlank: Boolean get() = lockReason == "empty" || (editable && text.isBlank()) }

@Serializable data class LgRun(val text: String = "", val b: Boolean = false, val i: Boolean = false, val u: Boolean = false)
@Serializable data class LgCell(val table: Int = 0, val row: Int = 0, val col: Int = 0)
@Serializable data class LgParagraphLayout(
    val align: String? = null, val indentLeft: Double = 0.0, val hanging: Double = 0.0, val firstLine: Double = 0.0,
    val spaceBefore: Double = 0.0, val spaceAfter: Double = 0.0, val lineHeight: Double = 1.0, val size: Double? = null,
    val marker: String? = null, val runs: List<LgRun>? = null, val cell: LgCell? = null,
)
@Serializable data class LgPage(val width: Double = 595.3, val marginLeft: Double = 72.0, val marginRight: Double = 72.0,
    val marginTop: Double = 72.0, val font: String? = null, val size: Double = 11.0)
@Serializable data class LgParagraphs(val version: Int = 0, val current: Int = 0, val paragraphs: List<LgParagraph> = emptyList(), val page: LgPage? = null)

/** Consecutive paragraphs in a table stay together; multiple paragraphs in a cell retain order. */
object LegalPageBlocks {
    fun of(paragraphs: List<LgParagraph>): List<List<LgParagraph>> {
        val blocks = mutableListOf<MutableList<LgParagraph>>()
        for (p in paragraphs) {
            val table = p.layout?.cell?.table
            if (table != null && blocks.lastOrNull()?.lastOrNull()?.layout?.cell?.table == table) blocks.last().add(p)
            else blocks.add(mutableListOf(p))
        }
        return blocks
    }
}

/** A run of words: kept ("same"), removed ("del", struck red) or added ("ins", green). */
@Serializable data class LgSegment(val type: String = "same", val text: String = "")

/** One paragraph of a compare: `same`, `removed`, `added` or `changed` (with the word diff). */
@Serializable
data class LgDiff(
    val type: String = "same",
    val a: Int? = null,
    val b: Int? = null,
    val text: String = "",
    val before: String = "",
    val after: String = "",
    val segments: List<LgSegment> = emptyList(),
)

@Serializable data class LgCompare(val a: Int = 0, val b: Int = 0, val diff: List<LgDiff> = emptyList())

@Serializable data class LgChange(val index: Int = 0, val before: String = "", val after: String = "", val segments: List<LgSegment> = emptyList())

@Serializable
data class LgProposal(
    val id: String = "",
    /** PENDING | CLARIFY | APPLYING | APPLIED | DISCARDED | FAILED */
    val status: String = "PENDING",
    val baseVersion: Int = 0,
    val instruction: String = "",
    val question: String? = null,
    val summary: String = "",
    val changes: List<LgChange> = emptyList(),
    val appliedVersion: Int? = null,
    val createdAt: String? = null,
)

@Serializable data class LgProposals(val proposals: List<LgProposal> = emptyList())
@Serializable data class LgProposalOne(val proposal: LgProposal? = null)
@Serializable data class LgDecision(val proposal: LgProposal? = null, val version: Int? = null, val pdfError: String? = null)

// ── Requests: the form behind a link ──

@Serializable
data class LgFormTemplate(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val docType: String = "OTHER",
    val companyId: String? = null,
    val isAddendum: Boolean = false,
    /** All optional for the requester; no TANGGAL_DOKUMEN (Legal sets the date). */
    val fields: List<LgField> = emptyList(),
)

@Serializable data class LgFormLink(val company: LgCompanyRef? = null, val accepting: Boolean = false)

@Serializable
data class LgFormInfo(
    val link: LgFormLink? = null,
    val signedIn: Boolean = false,
    val companies: List<LgCompanyRef> = emptyList(),
    val templates: List<LgFormTemplate> = emptyList(),
) {
    /** The company the link fixes, or null (the general link: picked in the form). */
    val lockedCompany: LgCompanyRef? get() = link?.company
    val accepting: Boolean get() = link?.accepting == true
}

@Serializable data class LgSent(val id: String = "")

// ── Requests: mine ──

@Serializable data class LgAttachment(val id: String = "", val fileName: String = "", val mimeType: String = "", val size: Long = 0)

@Serializable
data class LgAnswer(val name: String = "", val label: String = "", val type: String = "text", val value: JsonElement = JsonNull, val columns: List<LgField> = emptyList())

@Serializable data class LgMyDoc(val number: String = "", val title: String = "", val status: String = "DRAFT")

/** One of my requests (GET /api/legal-requests/mine[/id]); the detail adds [answers]. */
@Serializable
data class LgMyRequest(
    val id: String = "",
    val createdAt: String? = null,
    val company: LgCompanyRef? = null,
    val templateName: String = "",
    val docType: String = "OTHER",
    val isAddendum: Boolean = false,
    val parentNumberText: String = "",
    /** YYYY-MM-DD */
    val deadline: String? = null,
    /** RECEIVED | IN_PROGRESS | REVISION | FINAL | SIGNED | DONE | REJECTED */
    val stage: String = "RECEIVED",
    val rejectReason: String? = null,
    val pic: LgPerson? = null,
    /** The document this request produced (only that one). */
    val document: LgMyDoc? = null,
    val canDownload: Boolean = false,
    val purpose: String = "",
    val attachments: List<LgAttachment> = emptyList(),
    val project: LgProjectRef? = null,
    val deal: LgDealRef? = null,
    val answers: List<LgAnswer> = emptyList(),
)

@Serializable data class LgMyRequests(val requests: List<LgMyRequest> = emptyList())
@Serializable data class LgMyRequestOne(val request: LgMyRequest? = null)

// ── Requests: Legal's board ──

@Serializable data class LgBoardDoc(val id: String = "", val number: String = "", val title: String = "", val status: String = "DRAFT", val docType: String? = null, val signedAt: String? = null)
@Serializable data class LgBoardParent(val id: String = "", val number: String? = null, val title: String? = null, val status: String? = null)

@Serializable
data class LgBoardRequest(
    val id: String = "",
    val createdAt: String? = null,
    val requester: LgPerson? = null,
    val company: LgCompanyRef? = null,
    val templateId: String? = null,
    val templateName: String = "",
    val docType: String = "OTHER",
    val isAddendum: Boolean = false,
    val parentNumberText: String = "",
    val parent: LgBoardParent? = null,
    val deadline: String? = null,
    /** TODO | IN_PROGRESS | DONE */
    val column: String = "TODO",
    val stage: String = "RECEIVED",
    val rejected: Boolean = false,
    val rejectReason: String = "",
    val pic: LgPerson? = null,
    val document: LgBoardDoc? = null,
    val purpose: String = "",
    val attachments: List<LgAttachment> = emptyList(),
    val project: LgProjectRef? = null,
    val deal: LgDealRef? = null,
    val linkHidden: Boolean = false,
    // Detail only:
    val fieldValues: JsonObject = JsonObject(emptyMap()),
    val fields: List<LgField> = emptyList(),
)

@Serializable data class LgBoard(val requests: List<LgBoardRequest> = emptyList())

@Serializable
data class LgPrefill(
    val requestId: String = "",
    val templateId: String? = null,
    val companyId: String = "",
    val isAddendum: Boolean = false,
    val parentDocumentId: String? = null,
    val values: JsonObject = JsonObject(emptyMap()),
    val projectId: String? = null,
    val dealId: String? = null,
)

@Serializable data class LgBoardDetail(val request: LgBoardRequest? = null, val prefill: LgPrefill? = null)
@Serializable data class LgBoardOne(val request: LgBoardRequest? = null)

@Serializable
data class LgRequestLink(val scope: String = "", val company: LgCompanyRef? = null, val path: String = "", val accepting: Boolean = false, val rotatedAt: String? = null)

@Serializable data class LgRequestLinks(val links: List<LgRequestLink> = emptyList())
@Serializable data class LgRequestLinkOne(val link: LgRequestLink? = null)

// ── Form values ──

/**
 * A value typed into a Legal form: text (also numbers, money digits and YYYY-MM-DD dates), a yes/no switch, or the
 * rows of a table field.
 */
sealed interface LgValue {
    data class Text(val s: String) : LgValue
    data class Bool(val b: Boolean) : LgValue
    data class Rows(val rows: List<Map<String, LgValue>>) : LgValue

    val string: String get() = (this as? Text)?.s ?: ""
    val rowList: List<Map<String, LgValue>> get() = (this as? Rows)?.rows ?: emptyList()

    fun json(): JsonElement = when (this) {
        is Text -> JsonPrimitive(s)
        is Bool -> JsonPrimitive(b)
        is Rows -> buildJsonArray { rows.forEach { r -> add(JsonObject(r.mapValues { it.value.json() })) } }
    }

    companion object {
        fun json(values: Map<String, LgValue>): JsonObject = JsonObject(values.mapValues { it.value.json() })

        /** What a requester typed (any JSON) as a form value: a number reads as its digits ("25000000", no ".0"). */
        fun of(e: JsonElement?): LgValue? = when (e) {
            null, JsonNull -> null
            is JsonPrimitive -> when {
                e.isString -> Text(e.content)
                e.booleanOrNull != null -> Bool(e.booleanOrNull!!)
                e.longOrNull != null -> Text(e.longOrNull.toString())
                e.doubleOrNull != null -> e.doubleOrNull!!.let { d -> Text(if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString()) }
                else -> e.contentOrNull?.let(::Text)
            }
            is JsonArray -> Rows(e.mapNotNull { row -> (row as? JsonObject)?.let { o -> o.mapNotNull { (k, v) -> of(v)?.let { k to it } }.toMap() } })
            is JsonObject -> null
        }

        fun values(o: JsonObject): Map<String, LgValue> = o.mapNotNull { (k, v) -> of(v)?.let { k to it } }.toMap()
    }
}

/** A PATCH body helper: `null` clears a field on the server (explicit JSON null). */
internal fun lgBody(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    pairs.forEach { (k, v) ->
        put(k, when (v) {
            null -> JsonNull
            is JsonElement -> v
            is String -> JsonPrimitive(v)
            is Number -> JsonPrimitive(v)
            is Boolean -> JsonPrimitive(v)
            else -> JsonPrimitive(v.toString())
        })
    }
}
