package id.znetworks.nexus.feature.legal

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Legal's rules and the pure helpers shared with the web (diff-words.ts, NewDocumentDialog.tsx, LegalFieldInput.tsx)
 * and iOS (LegalText, LegalDocument): kept here, free of Android, so the JVM tests cover them.
 */
object LegalLogic {
    val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")

    val DOC_TYPES = listOf("SURAT", "SP", "SK", "PKS", "SPK", "NDA", "MOU", "ADD", "INVOICE", "PJM", "PGB", "OTHER")
    /** An addendum: made from a signed document, numbered after it (…/ADD-n). */
    const val ADDENDUM = "ADD"
    val STATUSES = listOf("DRAFT", "FINAL", "SENT", "SIGNED", "VOID")
    /** The field types a person may switch a scalar field between (lists and switches come from the file). */
    val SCALAR_TYPES = listOf("text", "longtext", "date", "number", "money", "select")
    /** The document date: asked in every form, it decides the number's month and year; its type and required flag are fixed. */
    const val DOCUMENT_DATE = "TANGGAL_DOKUMEN"
    val BOARD_COLUMNS = listOf("TODO", "IN_PROGRESS", "DONE")
    /** The request form takes up to 5 files of 50 MB each (Legal's upload rules). */
    const val MAX_ATTACHMENTS = 5
    const val MAX_ATTACHMENT_BYTES = 50L shl 20
    const val PAGE_SIZE = 50
    /** How long a missing PDF of a fresh Word version is still waited for (the server makes it in the background). */
    const val PDF_WAIT_MS = 180_000L

    // ── Access ──

    /** Who may invite whom (GET /api/legal/me): the owner anyone, an invited BoD member staff, everyone else nobody. */
    fun canInvite(power: String?): Boolean = power == "ANY" || power == "STAFF"
    /** Companies, kops and series are changed only by those who may invite (the server answers 403 otherwise). */
    fun canEditSettings(power: String?): Boolean = canInvite(power)

    // ── Document status (owner, 14 Oct 2026) ──

    /**
     * The statuses a person may pick now: VOID is one-way, SIGNED is locked and only voided, and a generated
     * document becomes SIGNED only by uploading its signed copy (an uploaded one may be set SIGNED by hand).
     */
    fun statusChoices(status: String, source: String): List<String> = when (status) {
        "VOID" -> listOf("VOID")
        "SIGNED" -> listOf("SIGNED", "VOID")
        else -> STATUSES.filter { it != "SIGNED" || source == "UPLOADED" }
    }

    /** SIGNED: no edits, GIDEON, restore, new versions or PDF remake (the server refuses them too). */
    fun isLocked(d: LgDocument) = d.status == "SIGNED"
    /** Nothing changes on a void document either. */
    fun isFrozen(d: LgDocument) = d.status == "SIGNED" || d.status == "VOID"
    /** Voiding gives the number back to its series only when the document holds one and was never signed. */
    fun voidReleasesNumber(d: LgDocument) = d.hasNumber && d.signedAt == null && d.status != "SIGNED"
    /** "Upload signed copy" is offered on a final or sent document. */
    fun canUploadSignedCopy(status: String) = status == "FINAL" || status == "SENT"
    /** "Create addendum" is offered on a signed document. */
    fun canCreateAddendum(status: String) = status == "SIGNED"

    enum class VoidOutcome { RELEASED, RETIRED, PLAIN }
    /** What the void confirmation says happens to the number. */
    fun voidOutcome(d: LgDocument): VoidOutcome = when {
        voidReleasesNumber(d) -> VoidOutcome.RELEASED
        d.signedAt != null -> VoidOutcome.RETIRED
        else -> VoidOutcome.PLAIN
    }

    /** The version whose files the document shows: the signed copy, else the final one, else the newest. */
    fun shownVersion(d: LgDocument): LgVersion? {
        val v = d.signedVersion ?: d.finalVersion ?: d.currentVersion
        return d.versions.firstOrNull { it.version == v } ?: d.versions.firstOrNull()
    }

    fun current(d: LgDocument): LgVersion? = d.versions.firstOrNull { it.version == d.currentVersion }

    /** The Word versions, oldest first: what Review and Compare can read. */
    fun wordVersions(d: LgDocument): List<Int> = d.versions.filter { it.hasDocx }.map { it.version }.sorted()

    /** Review & edit is offered while some version is Word and the document is neither signed nor void. */
    fun canReview(d: LgDocument) = d.versions.any { it.hasDocx } && !isFrozen(d)
    fun canCompare(d: LgDocument) = wordVersions(d).size >= 2

    /**
     * Word versions whose PDF the server is still making (it comes after generate / save / upload / approve), counted
     * only for [PDF_WAIT_MS] after the version was made: after that a missing PDF is taken as not coming.
     */
    fun versionsAwaitingPdf(d: LgDocument, nowMillis: Long = System.currentTimeMillis()): List<LgVersion> =
        d.versions.filter { v ->
            if (!v.hasDocx || v.hasPdf) return@filter false
            val made = parseInstant(v.createdAt) ?: return@filter false
            nowMillis - made.toEpochMilli() < PDF_WAIT_MS
        }

    /** What a shared file is called: the server's name for the version plus the format's extension. */
    fun shareName(v: LgVersion, format: String): String? {
        if (v.downloadName.isBlank()) return null
        val ext = when (format) {
            "docx" -> "docx"
            "pdf" -> "pdf"
            else -> v.fileName.substringAfterLast('.', "").lowercase()
        }
        return if (ext.isEmpty()) v.downloadName else "${v.downloadName}.$ext"
    }

    /** A file name safe on disk: no path separators. */
    fun safeFileName(name: String, fallback: String): String =
        name.trim().replace('/', '-').replace('\\', '-').ifBlank { fallback }

    // ── New document ──

    /** Addendum templates only from a signed document; every other template only from New document. */
    fun offeredTemplates(templates: List<LgTemplate>, addendum: Boolean): List<LgTemplate> =
        templates.filter { !it.archived && (it.docType == ADDENDUM) == addendum }

    /** Field names a number format reads ({KOTA} → KOTA, {KODE:3} → KODE), leaving out the built-in tokens. */
    fun formatFields(format: String): List<String> {
        val builtIn = setOf("SEQ", "ROMAWI", "MM", "BLN", "YYYY", "YY", "CO")
        return Regex("\\{([A-Z][A-Z0-9_]*)(?::\\d+)?\\}").findAll(format).map { it.groupValues[1] }
            .filter { it !in builtIn }.distinct().toList()
    }

    /** The values the number preview reads: the document date plus every field the series format names. */
    fun numberInputs(values: Map<String, LgValue>, format: String?): Map<String, LgValue> {
        val names = setOf(DOCUMENT_DATE) + formatFields(format.orEmpty())
        return values.filterKeys { it in names }
    }

    /** A stable key of [numberInputs], so the preview is asked again only when one of them changes. */
    fun numberKey(inputs: Map<String, LgValue>): String =
        inputs.toSortedMap().entries.joinToString("|") { "${it.key}=${it.value.string}" }

    /** Errors the server gave for something that is not one of the form's fields (shown in the problem list). */
    fun extraErrors(errors: Map<String, String>, fields: List<LgField>): List<Pair<String, String>> =
        errors.filter { (k, _) -> fields.none { f -> k == f.name || k.startsWith("${f.name}.") } }.toSortedMap().toList()

    /**
     * The form's starting values: what the requester filled wins, then an addendum's parties from its parent, and
     * the document date defaults to today in Jakarta.
     */
    fun startValues(fromRequest: Map<String, LgValue>, prefill: Map<String, LgValue>, today: String): Map<String, LgValue> {
        val out = LinkedHashMap<String, LgValue>()
        fromRequest.forEach { (k, v) -> out.putIfAbsent(k, v) }
        prefill.forEach { (k, v) -> out.putIfAbsent(k, v) }
        out.putIfAbsent(DOCUMENT_DATE, LgValue.Text(today))
        return out
    }

    // ── Money input ──

    /** "25000000" → "25.000.000" while typing (Indonesian grouping, "," before up to two decimals). */
    fun groupDigits(v: String): String {
        val kept = v.filter { (it in '0'..'9') || it == ',' }
        val parts = kept.split(',', limit = 2)
        val int = parts[0].trimStart('0').ifEmpty { if (parts[0].isNotEmpty()) "0" else "" }
        val grouped = int.reversed().chunked(3).joinToString(".").reversed()
        return if (parts.size > 1) grouped + "," + parts[1].replace(",", "").take(2) else grouped
    }

    /** "25.000.000,50" → "25000000.50": the value sent. */
    fun ungroup(v: String): String = v.replace(".", "").replace(",", ".")

    /** A stored money value ("25000000.5") as the text the field shows ("25.000.000,5"). */
    fun moneyShown(stored: String): String = groupDigits(stored.replace('.', ','))

    /** A number field keeps digits and . , - only. */
    fun numberChars(v: String): String = v.filter { it.isDigit() || it in ".,-" }

    // ── Dates ──

    /** Today in Jakarta as YYYY-MM-DD (the default document date). */
    fun todayJakarta(now: Instant = Instant.now()): String = now.atZone(JAKARTA).toLocalDate().toString()

    fun parseDay(day: String?): LocalDate? = day?.takeIf { it.length >= 10 }?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }

    fun parseInstant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

    // ── Requests ──

    /** "/f/legal-<24 letters/digits>" is a Legal request link; any other id under /f/ is a form. */
    fun isRequestLinkId(id: String): Boolean {
        if (!id.startsWith("legal-")) return false
        val token = id.removePrefix("legal-")
        return token.length == 24 && token.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }
    }

    /** The request form's document types: those of another company are hidden. */
    fun formTemplates(templates: List<LgFormTemplate>, companyId: String?): List<LgFormTemplate> =
        templates.filter { it.companyId == null || companyId == null || it.companyId == companyId }

    /** A board card is overdue when its deadline passed and it isn't done. */
    fun boardOverdue(r: LgBoardRequest, today: String): Boolean = r.deadline != null && r.column != "DONE" && r.deadline < today

    /** My request is overdue when its deadline passed and it isn't finished. */
    fun myOverdue(r: LgMyRequest, today: String): Boolean =
        r.deadline != null && r.stage !in setOf("SIGNED", "DONE", "REJECTED") && r.deadline < today

    /** The board's cards by column, in column order (a card in an unknown column lands in To Do). */
    fun columns(rows: List<LgBoardRequest>): Map<String, List<LgBoardRequest>> =
        BOARD_COLUMNS.associateWith { col -> rows.filter { (if (it.column in BOARD_COLUMNS) it.column else "TODO") == col } }

    /** The columns a card may be moved to from its long-press menu. */
    fun moveTargets(column: String): List<String> = BOARD_COLUMNS.filter { it != column }

    /** The request has a live document (one that is not void): Open document instead of Create document. */
    fun docLive(r: LgBoardRequest) = r.document != null && r.document.status != "VOID"
    /** An addendum request needs its signed parent picked before a document can be made. */
    fun parentMissing(r: LgBoardRequest) = r.isAddendum && r.parent?.number == null
    fun canCreateFromRequest(r: LgBoardRequest) = !docLive(r) && !r.rejected && !parentMissing(r)
    /** Reject: not twice, and never once its document is signed. */
    fun canReject(r: LgBoardRequest) = !r.rejected && r.document?.status != "SIGNED"
    /** A reject reason is 3+ characters. */
    fun rejectReasonOk(reason: String) = reason.trim().length >= 3

    /** The requester's answered fields, in the template's order (empty text and empty tables left out). */
    fun answered(r: LgBoardRequest): List<LgField> = r.fields.filter { f ->
        when (val v = LgValue.of(r.fieldValues[f.name])) {
            null -> false
            is LgValue.Text -> v.s.isNotEmpty()
            is LgValue.Rows -> v.rows.isNotEmpty()
            is LgValue.Bool -> true
        }
    }

    /** A typed answer as one block of text: a table is one line per cell, rows apart; a switch "Yes" or "—". */
    fun answerText(v: LgValue?, type: String, columns: List<LgField>, yes: String, day: (String) -> String): String = when (v) {
        null -> "—"
        is LgValue.Rows -> v.rows.joinToString("\n\n") { row -> columns.joinToString("\n") { c -> "${c.shownLabel}: ${row[c.name]?.string?.ifEmpty { null } ?: "—"}" } }
        is LgValue.Bool -> if (v.b) yes else "—"
        is LgValue.Text -> if (type == "date") day(v.s) else v.s.ifEmpty { "—" }
    }

    /** The JSON the request form sends (`data` of the multipart body). */
    fun requestInput(templateId: String, companyId: String, values: Map<String, LgValue>, purpose: String, deadline: String?,
                     projectId: String?, dealId: String?, addendum: Boolean, parentNumber: String) =
        lgBody(
            "templateId" to templateId, "companyId" to companyId, "values" to LgValue.json(values), "purpose" to purpose.trim(),
            "deadline" to deadline, "projectId" to projectId, "dealId" to dealId,
        ).let { o -> if (addendum) kotlinx.serialization.json.JsonObject(o + ("parentNumber" to kotlinx.serialization.json.JsonPrimitive(parentNumber.trim()))) else o }

    // ── Compare ──

    sealed interface DiffRow {
        data class Folded(val count: Int) : DiffRow
        data class Change(val diff: LgDiff) : DiffRow
    }

    /** Two versions as one flow: runs of unchanged paragraphs folded into "N unchanged paragraphs". */
    fun diffRows(diff: List<LgDiff>): List<DiffRow> {
        val out = mutableListOf<DiffRow>()
        var folded = 0
        diff.forEach { d ->
            if (d.type == "same") { folded++; return@forEach }
            if (folded > 0) { out += DiffRow.Folded(folded); folded = 0 }
            out += DiffRow.Change(d)
        }
        if (folded > 0) out += DiffRow.Folded(folded)
        return out
    }

    /** The newest proposal, while it still applies to the current version. */
    fun shownProposal(proposals: List<LgProposal>, currentVersion: Int): LgProposal? =
        proposals.firstOrNull()?.takeIf { it.status in setOf("PENDING", "APPLYING", "CLARIFY", "FAILED") && it.baseVersion == currentVersion }

    // ── Word diff (server src/lib/legal/diff.ts, web diffWordsClient, iOS LegalText.diffWords) ──

    fun diffWords(before: String, after: String): List<LgSegment> {
        val a = tokens(before)
        val b = tokens(after)
        val raw = lcsOps(a, b).map { (type, ia, ib) -> LgSegment(type, if (type == "ins") b[ib] else a[ia]) }
        val out = mutableListOf<LgSegment>()
        fun push(type: String, text: String) {
            if (text.isEmpty()) return
            val last = out.lastOrNull()
            if (last != null && last.type == type) out[out.size - 1] = LgSegment(type, last.text + text) else out += LgSegment(type, text)
        }
        var i = 0
        while (i < raw.size) {
            if (raw[i].type == "same") { push("same", raw[i].text); i++; continue }
            var j = i
            val del = StringBuilder()
            val ins = StringBuilder()
            while (true) {
                while (j < raw.size && raw[j].type != "same") {
                    if (raw[j].type == "del") del.append(raw[j].text) else ins.append(raw[j].text)
                    j++
                }
                // Absorb a whitespace-only match only when another change follows it.
                if (j + 1 < raw.size && raw[j].text.isNotEmpty() && raw[j].text.isBlank() && raw[j + 1].type != "same") {
                    del.append(raw[j].text); ins.append(raw[j].text); j++
                    continue
                }
                break
            }
            push("del", del.toString())
            push("ins", ins.toString())
            i = j
        }
        return out
    }

    private fun tokens(s: String): List<String> {
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        var curSpace: Boolean? = null
        for (ch in s) {
            val sp = ch.isWhitespace()
            if (curSpace != null && curSpace != sp) { out += cur.toString(); cur.clear() }
            cur.append(ch)
            curSpace = sp
        }
        if (cur.isNotEmpty()) out += cur.toString()
        return out
    }

    /** Longest-common-subsequence walk over two token lists → (type, index in a, index in b). */
    private fun lcsOps(a: List<String>, b: List<String>): List<Triple<String, Int, Int>> {
        val n = a.size
        val m = b.size
        var head = 0
        while (head < n && head < m && a[head] == b[head]) head++
        var tail = 0
        while (tail < n - head && tail < m - head && a[n - 1 - tail] == b[m - 1 - tail]) tail++
        val aa = a.subList(head, n - tail)
        val bb = b.subList(head, m - tail)
        val cols = bb.size + 1
        val dp = IntArray((aa.size + 1) * cols)
        for (i in aa.indices.reversed()) for (j in bb.indices.reversed()) {
            dp[i * cols + j] = if (aa[i] == bb[j]) dp[(i + 1) * cols + j + 1] + 1 else maxOf(dp[(i + 1) * cols + j], dp[i * cols + j + 1])
        }
        val out = mutableListOf<Triple<String, Int, Int>>()
        for (k in 0 until head) out += Triple("same", k, k)
        var i = 0
        var j = 0
        while (i < aa.size && j < bb.size) {
            when {
                aa[i] == bb[j] -> { out += Triple("same", head + i, head + j); i++; j++ }
                dp[(i + 1) * cols + j] >= dp[i * cols + j + 1] -> { out += Triple("del", head + i, 0); i++ }
                else -> { out += Triple("ins", 0, head + j); j++ }
            }
        }
        while (i < aa.size) { out += Triple("del", head + i, 0); i++ }
        while (j < bb.size) { out += Triple("ins", 0, head + j); j++ }
        for (k in 0 until tail) out += Triple("same", n - tail + k, m - tail + k)
        return out
    }

    // ── Archive query ──

    /** The archive's filters (GET /api/legal/documents). */
    data class ArchiveQuery(
        val q: String = "",
        val companyId: String? = null,
        val docType: String? = null,
        val status: String? = null,
        val source: String? = null,
        val projectId: String? = null,
        val dealId: String? = null,
        val from: String? = null,
        val to: String? = null,
        /** One chain: that document and its addenda. */
        val parentId: String? = null,
        /** "1" = only documents with their signed copy. */
        val signed: String? = null,
        val page: Int = 1,
        val limit: Int = PAGE_SIZE,
    ) {
        /** Any filter other than the search text. */
        val filtered: Boolean get() = listOf(companyId, docType, status, source, projectId, dealId, from, to, parentId, signed).any { !it.isNullOrEmpty() }

        fun params(): List<Pair<String, String>> = buildList {
            fun add(k: String, v: String?) { if (!v.isNullOrBlank()) add(k to v.trim()) }
            add("q", q); add("companyId", companyId); add("docType", docType); add("status", status); add("source", source)
            add("projectId", projectId); add("dealId", dealId); add("from", from); add("to", to); add("parentId", parentId); add("signed", signed)
            add("page" to "$page"); add("limit" to "$limit")
        }
    }

    /** Board filters (GET /api/legal/requests). */
    data class BoardQuery(
        val q: String = "",
        val docType: String? = null,
        val companyId: String? = null,
        /** A Legal member's id, or "none" (unassigned). */
        val picId: String? = null,
        /** overdue | week | none */
        val deadline: String? = null,
    ) {
        val filtered: Boolean get() = listOf(docType, companyId, picId, deadline).any { !it.isNullOrEmpty() }
        fun params(): List<Pair<String, String>> = buildList {
            fun add(k: String, v: String?) { if (!v.isNullOrBlank()) add(k to v.trim()) }
            add("q", q); add("docType", docType); add("companyId", companyId); add("picId", picId); add("deadline", deadline)
        }
    }

    /** The pager's "1–50 of 120" numbers, or null when everything fits on one page. */
    fun pageRange(page: Int, size: Int, total: Int): Triple<Int, Int, Int>? =
        if (total <= size) null else Triple((page - 1) * size + 1, minOf(page * size, total), total)

    // ── Template field editor ──

    /** Changes the field at [path] (indexes into fields, then into a list field's columns). */
    fun updateField(list: List<LgField>, path: List<Int>, change: (LgField) -> LgField): List<LgField> {
        val i = path.firstOrNull() ?: return list
        if (i !in list.indices) return list
        return list.mapIndexed { k, f ->
            when {
                k != i -> f
                path.size == 1 -> change(f)
                else -> f.copy(columns = updateField(f.columns.orEmpty(), path.drop(1), change))
            }
        }
    }

    /** "a, b,c" → ["a", "b", "c"] for a select's choices (blank ones kept while typing, trimmed at the start). */
    fun choices(text: String): List<String> = text.split(',').map { it.trimStart() }
}
