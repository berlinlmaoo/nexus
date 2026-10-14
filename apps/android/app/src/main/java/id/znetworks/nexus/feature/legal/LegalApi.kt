package id.znetworks.nexus.feature.legal

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.util.UUID

// Legal endpoints (owner, 14 Oct 2026): /api/legal/** and the requester's /api/legal-requests/**. Contract:
// docs/legal-api.md. Every /api/legal route answers 403 {code: LEGAL_NOT_INVITED} to someone without Legal. Writes
// go straight through (no offline queue), like Pipeline: a numbered document must never be made twice.

/** Someone who was never invited (or was removed) asking for Legal. */
fun ApiError.legalNotInvited(): Boolean = this is ApiError.Http && status == 403 && (code == "LEGAL_NOT_INVITED" || code == null)

/** The per-field errors of a Legal 422 (`ROWS.0.CELL` for a table cell); empty for anything else. */
fun ApiError.legalFieldErrors(): Map<String, String> = ((this as? ApiError.Http)?.body?.get("fieldErrors") as? JsonObject)
    ?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }?.toMap().orEmpty()

/** The problems of a template file in a Legal 422, one line each; empty for anything else. */
fun ApiError.legalProblems(): List<String> = ((this as? ApiError.Http)?.body?.get("problems") as? JsonArray)
    ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()

/** Someone else saved a version first. */
fun ApiError.legalConflict(): Boolean = this is ApiError.Http && status == 409

/** A file picked from the phone: what it is called, its type and size (for the 50 MB check). */
data class LgPicked(val uri: Uri, val name: String, val mime: String, val size: Long)

class LegalApi(private val context: Context, private val api: ApiClient) {
    private val json = api.json

    private fun enc(s: String) = Uri.encode(s, "-._~")
    private fun doc(id: String) = "/api/legal/documents/${enc(id)}"

    private fun url(path: String, params: List<Pair<String, String>> = emptyList()): HttpUrl =
        api.url(path).newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun <T> get(path: String, ser: KSerializer<T>, params: List<Pair<String, String>> = emptyList()): T =
        api.send(Request.Builder().url(url(path, params)).get().build(), ser)

    private suspend fun <T> send(method: String, path: String, body: JsonObject?, ser: KSerializer<T>): T {
        val rb = (body ?: JsonObject(emptyMap())).toString().toJsonBody()
        return api.send(Request.Builder().url(api.url(path)).method(method, if (method == "DELETE" && body == null) null else rb).build(), ser)
    }

    private val any = JsonElement.serializer()

    // ── Access & members ──

    suspend fun me() = get("/api/legal/me", LgMe.serializer())
    suspend fun members() = get("/api/legal/members", LgMembers.serializer())
    /** Only the people the viewer may invite. */
    suspend fun candidates(q: String) = get("/api/legal/members/candidates", LgCandidates.serializer(), listOf("q" to q.trim())).candidates
    suspend fun invite(userId: String) { send("POST", "/api/legal/members", lgBody("userId" to userId), any) }
    suspend fun revoke(userId: String) { send("DELETE", "/api/legal/members/${enc(userId)}", null, any) }

    // ── Companies & numbering ──

    suspend fun companies() = get("/api/legal/companies", LgCompanies.serializer()).companies
    /** `{name?, legalName?, address?, code?, active?}`; `code` gets a 409 once numbers exist. */
    suspend fun updateCompany(id: String, body: JsonObject) = send("PATCH", "/api/legal/companies/${enc(id)}", body, LgCompanyOne.serializer()).company
    suspend fun uploadKop(companyId: String, file: LgPicked) =
        multipart("/api/legal/companies/${enc(companyId)}/kop", emptyList(), listOf(file), LgCompanyOne.serializer()).company
    suspend fun downloadKop(companyId: String) = download("/api/legal/companies/${enc(companyId)}/kop", null, "kop.docx")
    suspend fun addSeries(companyId: String, docType: String, label: String, format: String, resetPeriod: String) =
        send("POST", "/api/legal/companies/${enc(companyId)}/series",
            lgBody("docType" to docType, "label" to label, "format" to format, "resetPeriod" to resetPeriod), LgSeriesOne.serializer()).series
    /** The series, how many numbers it issued, and today's next number. */
    suspend fun series(id: String) = get("/api/legal/series/${enc(id)}", LgSeriesInfo.serializer())
    /** `{label?, format?, resetPeriod?, active?}`. */
    suspend fun updateSeries(id: String, body: JsonObject) = send("PATCH", "/api/legal/series/${enc(id)}", body, LgSeriesOne.serializer()).series

    // ── Templates ──

    suspend fun templates(archived: Boolean = false) =
        get("/api/legal/templates", LgTemplates.serializer(), if (archived) listOf("archived" to "1") else emptyList()).templates
    suspend fun template(id: String) = get("/api/legal/templates/${enc(id)}", LgTemplateOne.serializer()).template
    /** A new template from a .docx. A file the server can't read answers 422 with `problems`. */
    suspend fun createTemplate(file: LgPicked, name: String, docType: String, companyId: String?, seriesId: String?, description: String) =
        multipart("/api/legal/templates", buildList {
            add("name" to name); add("docType" to docType)
            companyId?.takeIf { it.isNotEmpty() }?.let { add("companyId" to it) }
            seriesId?.takeIf { it.isNotEmpty() }?.let { add("seriesId" to it) }
            if (description.isNotEmpty()) add("description" to description)
        }, listOf(file), LgTemplateOne.serializer()).template
    /** `{name?, description?, docType?, companyId?, seriesId?, archived?, fields?}`; a JSON null clears the company / series. */
    suspend fun updateTemplate(id: String, body: JsonObject) = send("PATCH", "/api/legal/templates/${enc(id)}", body, LgTemplateOne.serializer()).template
    suspend fun addTemplateVersion(id: String, file: LgPicked, note: String) =
        multipart("/api/legal/templates/${enc(id)}/versions", if (note.isNotEmpty()) listOf("note" to note) else emptyList(), listOf(file), LgTemplateOne.serializer()).template
    suspend fun downloadTemplate(id: String, version: Int, name: String) =
        download("/api/legal/templates/${enc(id)}/versions/$version/file", name.ifBlank { null }, "template.docx")

    fun fieldsJson(fields: List<LgField>): JsonElement = json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(LgField.serializer()), fields)

    // ── Documents ──

    suspend fun documents(q: LegalLogic.ArchiveQuery) = get("/api/legal/documents", LgDocsPage.serializer(), q.params())

    /** The form for a template (and the number it would take); re-asked with the values the number reads. */
    suspend fun prepare(templateId: String, companyId: String?, values: Map<String, LgValue>? = null, parentDocumentId: String? = null) =
        send("POST", "/api/legal/documents/prepare", buildMap<String, Any?> {
            put("templateId", templateId)
            companyId?.let { put("companyId", it) }
            parentDocumentId?.let { put("parentDocumentId", it) }
            values?.let { put("values", LgValue.json(it)) }
        }.let { lgBody(*it.toList().toTypedArray()) }, LgPrepared.serializer())

    /** Generate: takes the number. A 422 carries `fieldErrors` / `problems`. `requestId` links it to that Legal request. */
    suspend fun generate(templateId: String, companyId: String?, values: Map<String, LgValue>, title: String, counterparty: String,
                         projectId: String?, dealId: String?, parentDocumentId: String?, requestId: String?) =
        send("POST", "/api/legal/documents", buildMap<String, Any?> {
            put("templateId", templateId); put("values", LgValue.json(values))
            companyId?.let { put("companyId", it) }
            parentDocumentId?.let { put("parentDocumentId", it) }
            requestId?.let { put("requestId", it) }
            if (title.isNotEmpty()) put("title", title)
            if (counterparty.isNotEmpty()) put("counterparty", counterparty)
            put("projectId", projectId); put("dealId", dealId)
        }.let { lgBody(*it.toList().toTypedArray()) }, LgGenerated.serializer())

    /** A document made elsewhere (PDF / DOCX / JPG / PNG) into the archive; empty fields are left out. */
    suspend fun uploadDocument(file: LgPicked, fields: Map<String, String>) =
        multipart("/api/legal/documents/upload", fields.filterValues { it.isNotEmpty() }.toSortedMap().toList(), listOf(file), LgUploaded.serializer())

    suspend fun document(id: String) = get(doc(id), LgDocumentOne.serializer()).document ?: throw ApiError.Decoding(IllegalStateException("No document"))
    /** `{title?, counterparty?, status?, notes?, projectId?, dealId?, finalVersion?}`; a JSON null clears a link. */
    suspend fun updateDocument(id: String, body: JsonObject) = send("PATCH", doc(id), body, LgDocumentOne.serializer()).document

    /** One version's file, saved under the version's own name ("… REV 2.pdf" / "FINAL" / "SIGNED"). */
    suspend fun downloadVersion(id: String, version: Int, format: String, name: String?, inline: Boolean = false) =
        download("${doc(id)}/versions/$version/file?format=$format" + (if (inline) "&inline=1" else ""), name,
            when (format) { "docx" -> "document-v$version.docx"; "pdf" -> "document-v$version.pdf"; else -> "document-v$version" })

    /** Make (or retry) a version's PDF. 502 with the reason when the PDF service fails. */
    suspend fun makePdf(id: String, version: Int) { send("POST", "${doc(id)}/versions/$version/pdf", null, any) }

    /** The projects and Pipeline deals the viewer can open; [own] = the request form's (the requester's own access). */
    suspend fun links(q: String, own: Boolean = false) =
        get(if (own) "/api/legal-requests/links" else "/api/legal/links", LgLinks.serializer(), listOf("q" to q.trim()))

    // ── Review, versions, GIDEON ──

    suspend fun paragraphs(id: String) = get("${doc(id)}/paragraphs", LgParagraphs.serializer())
    /** Paragraph edits as a new version. 409 when someone else saved first. */
    suspend fun saveEdits(id: String, baseVersion: Int, edits: List<Pair<Int, String>>, note: String) =
        send("POST", "${doc(id)}/versions", lgBody(
            "baseVersion" to baseVersion,
            "edits" to JsonArray(edits.map { (i, t) -> lgBody("index" to i, "text" to t) }),
            "note" to note.ifEmpty { null },
        ).let { o -> if (note.isEmpty()) JsonObject(o - "note") else o }, LgVersionCreated.serializer())

    /** A file as a new version; [status] = "SIGNED" uploads the signed copy (FINAL / SENT only, PDF or photo). */
    suspend fun uploadVersion(id: String, baseVersion: Int, file: LgPicked, note: String, status: String?) =
        multipart("${doc(id)}/versions", buildList {
            add("baseVersion" to "$baseVersion")
            if (note.isNotEmpty()) add("note" to note)
            status?.let { add("status" to it) }
        }, listOf(file), LgVersionCreated.serializer())

    suspend fun restore(id: String, version: Int, baseVersion: Int) =
        send("POST", "${doc(id)}/versions/$version/restore", lgBody("baseVersion" to baseVersion), LgVersionCreated.serializer())
    suspend fun compare(id: String, a: Int, b: Int) = get("${doc(id)}/compare", LgCompare.serializer(), listOf("a" to "$a", "b" to "$b"))
    /** GIDEON's proposals for the document, newest first. */
    suspend fun proposals(id: String) = get("${doc(id)}/gideon", LgProposals.serializer()).proposals
    /** Ask GIDEON for a precise edit, or answer its question (`replyTo` + `answer`, empty instruction). */
    suspend fun askGideon(id: String, baseVersion: Int, instruction: String, targets: List<Int>, replyTo: String? = null, answer: String? = null) =
        send("POST", "${doc(id)}/gideon", JsonObject(buildMap {
            put("baseVersion", JsonPrimitive(baseVersion)); put("instruction", JsonPrimitive(instruction))
            put("targets", JsonArray(targets.map { JsonPrimitive(it) }))
            replyTo?.let { put("replyTo", JsonPrimitive(it)) }; answer?.let { put("answer", JsonPrimitive(it)) }
        }), LgProposalOne.serializer()).proposal
    /** Approve all, or the ticked [indexes] (an empty list is refused, so it is never sent), or discard. */
    suspend fun decide(id: String, proposalId: String, approve: Boolean, indexes: List<Int>?) =
        send("POST", "${doc(id)}/proposals/${enc(proposalId)}", JsonObject(buildMap {
            put("decision", JsonPrimitive(if (approve) "approve" else "discard"))
            if (approve && !indexes.isNullOrEmpty()) put("indexes", JsonArray(indexes.map { JsonPrimitive(it) }))
        }), LgDecision.serializer())

    // ── Requests: requester ──

    /** The form behind a link. 404 `LEGAL_LINK_UNKNOWN` for a link that was regenerated or never existed. */
    suspend fun requestForm(linkId: String) = get("/api/legal-requests/form/${enc(linkId)}", LgFormInfo.serializer())

    /** Send a request: the JSON in `data` plus the files; [key] is one per attempt, so a retry never sends it twice. */
    suspend fun sendRequest(linkId: String, input: JsonObject, files: List<LgPicked>, key: String): LgSent {
        val body = multipartBody(listOf("data" to input.toString()), files)
        val req = Request.Builder().url(api.url("/api/legal-requests/form/${enc(linkId)}")).post(body).header("Idempotency-Key", key).build()
        return api.send(req, LgSent.serializer())
    }

    suspend fun myRequests() = get("/api/legal-requests/mine", LgMyRequests.serializer()).requests
    suspend fun myRequest(id: String) = get("/api/legal-requests/mine/${enc(id)}", LgMyRequestOne.serializer()).request
    /** The final / signed file of my own request. */
    suspend fun myRequestFile(id: String) = download("/api/legal-requests/mine/${enc(id)}/file", null, "document.pdf")
    suspend fun myRequestAttachment(id: String, a: LgAttachment) =
        download("/api/legal-requests/mine/${enc(id)}/attachments/${enc(a.id)}", a.fileName.ifBlank { null }, "file")

    // ── Requests: Legal's board ──

    suspend fun board(q: LegalLogic.BoardQuery) = get("/api/legal/requests", LgBoard.serializer(), q.params()).requests
    suspend fun boardRequest(id: String) = get("/api/legal/requests/${enc(id)}", LgBoardDetail.serializer())
    /** `{column?, picId?, parentDocumentId?}`; a JSON null clears picId / parentDocumentId. */
    suspend fun updateRequest(id: String, body: JsonObject) = send("PATCH", "/api/legal/requests/${enc(id)}", body, LgBoardOne.serializer()).request
    suspend fun rejectRequest(id: String, reason: String) = send("POST", "/api/legal/requests/${enc(id)}/reject", lgBody("reason" to reason), LgBoardOne.serializer()).request
    suspend fun requestAttachment(id: String, a: LgAttachment) =
        download("/api/legal/requests/${enc(id)}/attachments/${enc(a.id)}", a.fileName.ifBlank { null }, "file")
    suspend fun requestLinks() = get("/api/legal/request-links", LgRequestLinks.serializer()).links
    suspend fun setLinkAccepting(scope: String, accepting: Boolean) =
        send("PATCH", "/api/legal/request-links/${enc(scope)}", lgBody("accepting" to accepting), LgRequestLinkOne.serializer()).link
    /** A new token: the old link stops working at once. */
    suspend fun regenerateLink(scope: String) = send("POST", "/api/legal/request-links/${enc(scope)}/regenerate", null, LgRequestLinkOne.serializer()).link

    // ── Files ──

    /** What a picked file is: its name, type (by extension when the picker gives none) and size. */
    fun describe(uri: Uri): LgPicked? {
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
        val byExt = mimeFor(clean)
        val type = cr.getType(uri)?.takeIf { it != "application/octet-stream" } ?: byExt
        return LgPicked(uri, clean, type, size)
    }

    /**
     * GET a file into the shared cache (emptied at sign-out) named [preferred] ?: the server's Content-Disposition
     * name ?: [fallback]. Returns the file, ready for a viewer or the share sheet.
     */
    suspend fun download(path: String, preferred: String?, fallback: String): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "shared/legal/${UUID.randomUUID()}").apply { mkdirs() }
        val part = File(dir, "download.part")
        var disposition: String? = null
        api.download(path, part, null, onHeaders = { h -> disposition = h["Content-Disposition"] })
        val name = LegalLogic.safeFileName(preferred ?: dispositionName(disposition) ?: "", fallback)
        val dest = File(dir, name)
        part.renameTo(dest)
        dest
    }

    private suspend fun <T> multipart(path: String, fields: List<Pair<String, String>>, files: List<LgPicked>, ser: KSerializer<T>): T =
        api.send(Request.Builder().url(api.url(path)).post(multipartBody(fields, files)).build(), ser)

    private fun multipartBody(fields: List<Pair<String, String>>, files: List<LgPicked>): MultipartBody =
        MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            files.forEach { f -> addFormDataPart("file", f.name, UriBody(f.mime.toMediaTypeOrNull(), f.size) { context.contentResolver.openInputStream(f.uri)!! }) }
        }.build()

    /** A picked file streamed from disk (never held whole in memory); re-openable for a retry. */
    private class UriBody(private val type: MediaType?, private val length: Long, private val open: () -> java.io.InputStream) : RequestBody() {
        override fun contentType() = type
        override fun contentLength() = length
        override fun writeTo(sink: BufferedSink) { open().use { sink.writeAll(it.source()) } }
    }

    companion object {
        /** The four kinds Legal takes, by extension; anything else goes as bytes. */
        fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "pdf" -> "application/pdf"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            else -> "application/octet-stream"
        }

        /** The picker's types: a document made elsewhere or a new version (PDF, Word, photo). */
        val DOCUMENT_TYPES = arrayOf("application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png")
        /** The signed copy of a final document: a PDF or a photo. */
        val SIGNED_TYPES = arrayOf("application/pdf", "image/jpeg", "image/png")
        val DOCX_TYPES = arrayOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream")

        /** `attachment; filename="x.pdf"; filename*=UTF-8''x%20y.pdf` → the UTF-8 name when there is one. */
        fun dispositionName(header: String?): String? {
            header ?: return null
            Regex("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)").find(header)?.let { m ->
                return runCatching { java.net.URLDecoder.decode(m.groupValues[1].trim().replace("+", "%2B"), "UTF-8") }.getOrNull()?.takeIf { it.isNotBlank() }
            }
            return Regex("filename\\s*=\\s*\"?([^\";]+)\"?").find(header)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotBlank() }
        }
    }
}
