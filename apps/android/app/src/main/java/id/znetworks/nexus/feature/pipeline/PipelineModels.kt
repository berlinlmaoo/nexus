package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.R
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

// Pipeline Dashboard (Project.type "PIPELINE", Berlin 9 Oct; PIPELINE-DASHBOARD.md §8, web 0733d04, iOS 8b698df).
// The GM's "Control Tower TZN" inside a NEXUS project: one deal per client job. Health, phases, days overdue and
// the KPI summary are computed by the SERVER on every read, so nothing here ports the GM's formulas. Everything
// is read leniently from raw JSON: a new field or option is shown as-is and never costs the whole pipeline.
// Stored values are the GM's English keys (the dash in "Won – …" is an EN DASH, U+2013).

internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }

data class PipelinePerson(val id: String, val name: String?, val avatar: String?) {
    companion object {
        fun of(e: JsonElement?): PipelinePerson? = (e as? JsonObject)?.let { o -> o["id"].str()?.let { PipelinePerson(it, o["name"].str(), o["avatar"].str()) } }
    }
}

/**
 * One "Documents & links" entry (§13.1): a pasted link, or an attached file whose [url] is RELATIVE
 * (`/api/projects/:pid/pipeline/:dealId/documents/:docId`, session needed). An older server sends no `kind` = link.
 */
data class PipelineLink(val id: String, val type: String, val label: String, val url: String, val kind: String = "link",
                        val fileName: String? = null, val mimeType: String? = null, val size: Long? = null, val raw: JsonObject? = null) {
    val isFile get() = kind == "file"
    /** What a row is called: its label, else the file's name, else the link. */
    val shownName get() = label.ifBlank { fileName ?: url }
    /** Sent back as received (a PATCH may relabel / retype a file entry, matched by id), with the edited fields over it. */
    fun json() = JsonObject((raw ?: emptyMap()) + mapOf("id" to JsonPrimitive(id), "type" to JsonPrimitive(type), "label" to JsonPrimitive(label),
        "url" to JsonPrimitive(url)) + if (raw == null) mapOf("kind" to JsonPrimitive(kind)) else emptyMap())

    companion object {
        fun of(o: JsonObject): PipelineLink {
            val url = o["url"].str().orEmpty()
            return PipelineLink(o["id"].str() ?: url, o["type"].str() ?: "Lainnya", o["label"].str().orEmpty(), url, o["kind"].str() ?: "link",
                o["fileName"].str(), o["mimeType"].str(), o["size"].num()?.toLong(), o)
        }
    }
}

data class PipelinePhase(val key: String, val state: String, val blocked: Boolean = false)

data class PipelineReason(val code: String, val days: Int?, val text: String?)

/** One deal, read from its raw JSON (every getter has a default). */
data class PipelineDeal(val raw: JsonObject) {
    private fun s(k: String, d: String = "") = raw[k].str() ?: d
    private fun n(k: String) = raw[k].num() ?: 0.0
    val id get() = s("id")
    val code get() = s("code")
    val position get() = n("position")
    val name get() = s("name")
    val brand get() = s("brand")
    val service get() = s("service")
    /** Several services, presets and typed ones, in order (§13.2); an older server has only `service`. */
    val services: List<String> get() = (raw["services"] as? JsonArray)?.mapNotNull { it.str()?.trim()?.takeIf(String::isNotEmpty) }
        ?: listOfNotNull(service.takeIf { it.isNotBlank() })
    val bdUserId get() = raw["bdUserId"].str()
    val bdName get() = raw["bdName"].str()
    val bd get() = PipelinePerson.of(raw["bd"])
    val pmUserId get() = raw["pmUserId"].str()
    val pmName get() = raw["pmName"].str()
    val pm get() = PipelinePerson.of(raw["pm"])
    val stage get() = s("stage", "Incoming")
    val probability get() = n("probability")
    val contractValue get() = n("contractValue")
    val netValue get() = n("netValue")
    val invoiceValue get() = n("invoiceValue")
    val outstandingReceivable get() = n("outstandingReceivable")
    val netCash get() = n("netCash")
    val maxDaysOverdue get() = n("maxDaysOverdue").toInt()
    val daysOverdue get() = n("daysOverdue").toInt()
    fun text(k: String) = s(k)
    fun date(k: String) = raw[k].str()?.take(10)
    val stageGroup get() = s("stageGroup", PipelineVocab.group(stage))
    val createdAt get() = raw["createdAt"].str()
    val updatedAt get() = raw["updatedAt"].str()
    val updatedBy get() = PipelinePerson.of(raw["updatedBy"])
    val createdBy get() = PipelinePerson.of(raw["createdBy"])
    val healthKey get() = (raw["health"] as? JsonObject)?.get("key").str() ?: "NONE"
    val reasons: List<PipelineReason> get() = ((raw["health"] as? JsonObject)?.get("reasons") as? JsonArray).orEmpty().mapNotNull { r ->
        (r as? JsonObject)?.let { PipelineReason(it["code"].str().orEmpty(), it["days"].num()?.toInt(), it["text"].str()) }
    }
    /** The six phases with `blocked` (§14.1: the phase the blocker holds up; absent from an older server). */
    val phaseList: List<PipelinePhase> get() = (raw["phases"] as? JsonArray).orEmpty().mapNotNull { p ->
        (p as? JsonObject)?.let { o -> o["key"].str()?.let { k -> PipelinePhase(k, o["state"].str() ?: "pending", (o["blocked"] as? JsonPrimitive)?.content == "true") } }
    }
    /** The blocker as written, or null when there is none. */
    val blockerText get() = text("blocker").trim().ifEmpty { null }
    /**
     * The phases with the blocker's phase marked. The server sends `blocked` (since 10 Oct a written blocker always
     * holds the phase the deal is at, server 3eb63d6); nothing here reads the blocker's words. An older server doesn't
     * mark it: then the same rule runs here — the phase already bad, else the active one, else the first not done,
     * else the last.
     */
    val progressPhases: List<PipelinePhase> get() {
        val ps = phaseList
        if (blockerText == null || ps.isEmpty() || ps.any { it.blocked }) return ps
        val held = ps.firstOrNull { it.state == "bad" } ?: ps.firstOrNull { it.state == "active" } ?: ps.firstOrNull { it.state != "done" } ?: ps.last()
        return ps.map { if (it.key == held.key) it.copy(state = "bad", blocked = true) else it }
    }
    /** The six phases (commercial … closing), each done | active | pending | bad. */
    val phases: List<Pair<String, String>> get() = (raw["phases"] as? JsonArray).orEmpty().mapNotNull { p ->
        (p as? JsonObject)?.let { (it["key"].str() ?: return@let null) to (it["state"].str() ?: "pending") }
    }
    val links: List<PipelineLink> get() = (raw["links"] as? JsonArray).orEmpty().mapNotNull { l ->
        (l as? JsonObject)?.let(PipelineLink::of)
    }
    /** The "<deal>: Master Task" project (§15; a 9 Oct deal's only project); null until one is made by hand. */
    val executionProjectId get() = raw["executionProjectId"].str() ?: (raw["executionProject"] as? JsonObject)?.get("id").str()
    val executionProjectName get() = (raw["executionProject"] as? JsonObject)?.get("name").str()
    /** The deal's execution folder and its "<deal>: Master Calendar" (§15); null before 10 Oct and until made. */
    val executionFolderId get() = raw["executionFolderId"].str() ?: (raw["executionFolder"] as? JsonObject)?.get("id").str()
    val executionFolderName get() = (raw["executionFolder"] as? JsonObject)?.get("name").str()
    val executionCalendarProjectId get() = raw["executionCalendarProjectId"].str() ?: (raw["executionCalendarProject"] as? JsonObject)?.get("id").str()
    /** Payments per term (§11.2), in order; empty on a deal without terms and from an older server. */
    val terms: List<PipelineTerm> get() = (raw["terms"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::PipelineTerm)?.takeIf { t -> t.id.isNotEmpty() } }
        .sortedBy { it.position }
    /** The payment worked out from the terms; null when there are none — then the manual fields count. */
    val termSummary: PipelineTermSummary? get() = (raw["termSummary"] as? JsonObject)?.let(::PipelineTermSummary)
    /** With terms the receivable, payment status and next due date are the terms' (server-computed). */
    val receivable get() = termSummary?.outstanding ?: outstandingReceivable
    val paymentStatusShown get() = termSummary?.paymentStatus ?: text("paymentStatus")
    val paymentDueShown get() = termSummary.let { if (it != null) it.nextDueDate else date("paymentDueDate") }
    /** Real cost lines (Control Tower v4, 14 Oct 2026); none on a deal without them and from an older server. */
    val costs: List<PipelineCost> get() = PipelineCosts.of(raw["costs"])
    /**
     * Σ cost lines, the margin on the net value (null without one) and margin ÷ net value. The server sends the same
     * (costTotal, margin, marginPct); worked out here from the lines so an edit shows at once, before it answers.
     */
    val costTotal get() = PipelineCosts.total(costs)
    val margin get() = PipelineCosts.margin(netValue, costTotal)
    val marginPct get() = PipelineCosts.marginPct(netValue, costTotal)
    /** What the terms are checked against: the invoice value, else the contract value (as the web). */
    val termsReference get() = if (invoiceValue > 0) invoiceValue else contractValue

    /** Won: Pre-Execution, Execution or Closed — the stages an execution project belongs to. */
    val isWon get() = stageGroup in setOf("Pre-Execution", "Execution", "Closed")

    /** Shown value: net if any, else the contract (the GM's rule for the board). */
    val value get() = if (netValue > 0) netValue else contractValue
    /** The person in a role: a NEXUS user wins over the typed name. */
    val bdShown get() = bd?.name ?: bdName?.takeIf { it.isNotBlank() }
    val pmShown get() = pm?.name ?: pmName?.takeIf { it.isNotBlank() }

    /** An optimistic edit: the fields laid over the deal until the server answers. */
    fun with(fields: JsonObject) = PipelineDeal(JsonObject(raw + fields))

    companion object {
        /** Inside a column: most urgent first, then the biggest (the GM's order). */
        val SEVERITY = mapOf("CRITICAL" to 0, "ATTENTION" to 1, "HEALTHY" to 2, "NOT_STARTED" to 3, "NONE" to 4)
        val bySeverity = compareBy<PipelineDeal>({ SEVERITY[it.healthKey] ?: 9 }, { -it.netValue })
    }
}

/** One payment term ("DP", "Termin 1" …). Status, outstanding and days overdue are the server's. */
data class PipelineTerm(val raw: JsonObject) {
    val id get() = raw["id"].str().orEmpty()
    val position get() = raw["position"].num() ?: 0.0
    val label get() = raw["label"].str().orEmpty()
    val amount get() = raw["amount"].num() ?: 0.0
    val dueDate get() = raw["dueDate"].str()?.takeIf { it.isNotBlank() }?.take(10)
    val invoiceNo get() = raw["invoiceNo"].str().orEmpty()
    val invoiceDate get() = raw["invoiceDate"].str()?.takeIf { it.isNotBlank() }?.take(10)
    val paidAmount get() = raw["paidAmount"].num() ?: 0.0
    val paidAt get() = raw["paidAt"].str()?.takeIf { it.isNotBlank() }?.take(10)
    val note get() = raw["note"].str().orEmpty()
    /** Not Invoiced | Invoiced | Partial | Paid | Overdue (an unknown one is shown as-is). */
    val status get() = raw["status"].str() ?: "Not Invoiced"
    val outstanding get() = raw["outstanding"].num() ?: maxOf(0.0, amount - paidAmount)
    val daysOverdue get() = (raw["daysOverdue"].num() ?: 0.0).toInt()
    val isPaid get() = status == "Paid"
}

/** The deal's payment from its terms (server: termSummaryOf). */
data class PipelineTermSummary(val raw: JsonObject) {
    private fun n(k: String) = raw[k].num() ?: 0.0
    val count get() = n("count").toInt()
    val paidCount get() = n("paidCount").toInt()
    val totalAmount get() = n("totalAmount")
    val totalPaid get() = n("totalPaid")
    val outstanding get() = n("outstanding")
    val maxDaysOverdue get() = n("maxDaysOverdue").toInt()
    val paymentStatus get() = raw["paymentStatus"].str() ?: "Not Yet"
    val nextDueDate get() = raw["nextDueDate"].str()?.takeIf { it.isNotBlank() }?.take(10)
}

object PipelineTerms {
    /** "Add term" starts at what is left of the invoice value (else the contract value), never below zero. */
    fun suggestedAmount(deal: PipelineDeal): Double = maxOf(0.0, deal.termsReference - deal.terms.sumOf { it.amount })
    /** Σ terms ≠ the reference: worth a warning (only once there are terms and a reference). */
    fun mismatch(deal: PipelineDeal): Boolean {
        val terms = deal.terms
        return terms.isNotEmpty() && deal.termsReference > 0 && kotlin.math.abs(terms.sumOf { it.amount } - deal.termsReference) >= 0.5
    }
}

/** The KPI strip, over every deal of the project (never the filtered view), as the server sums it. */
data class PipelineSummary(val raw: JsonObject) {
    fun n(k: String) = raw[k].num() ?: 0.0
    fun i(k: String) = n(k).toInt()
}

/** Every option list as the server sends it; the GM's lists of 9 Oct are only the fallback. */
data class PipelineVocab(val raw: JsonObject) {
    private fun l(k: String, d: List<String>) = (raw[k] as? JsonArray)?.mapNotNull { it.str() }?.takeIf { it.isNotEmpty() } ?: d
    val stages get() = l("stages", STAGES)
    val services get() = l("services", listOf("Event", "Creative", "Multimedia", "Digital Campaign", "Production", "Activation", "Exhibition", "Other"))
    val probabilities get() = (raw["probabilities"] as? JsonArray)?.mapNotNull { it.num() }?.takeIf { it.isNotEmpty() } ?: listOf(0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0)
    val contractStatuses get() = l("contractStatuses", listOf("Not Started", "Request to Legal", "Legal Drafting", "Internal Review", "Sent to Client",
        "Client Review", "Revision", "Final Review", "Client Signed", "TZN Signed", "Fully Executed", "Cancelled"))
    val vregStatuses get() = l("vregStatuses", listOf("Not Required", "Not Started", "Documents Gathering", "Ready to Submit", "Submitted", "Client Review",
        "Revision Required", "Approved", "Rejected"))
    val readiness get() = l("readiness", listOf("N/A", "Blocked", "Partial", "Ready"))
    val deliverableStatuses get() = l("deliverableStatuses", listOf("Not Started", "Briefing", "In Progress", "Internal Review", "Client Review", "Revision",
        "Approved", "Completed", "Cancelled"))
    val deliverableRisks get() = l("deliverableRisks", listOf("Aman", "At Risk", "Overdue"))
    val paymentStatuses get() = l("paymentStatuses", listOf("Not Yet", "Upcoming", "Due", "Overdue", "Partial", "Paid"))
    val closingStatuses get() = l("closingStatuses", listOf("Not Ready", "In Progress", "Waiting BAST", "Waiting Client Payment", "Waiting Vendor Settlement",
        "Waiting Deliverables", "Ready to Close", "Closed"))
    val termStatuses get() = l("termStatuses", listOf("Not Invoiced", "Invoiced", "Partial", "Paid", "Overdue"))
    val linkTypes get() = l("linkTypes", listOf("SPK", "Kontrak", "MOU", "Invoice", "Lainnya"))

    companion object {
        const val LOST = "Lost / Cancelled"
        val STAGES = listOf("Incoming", "Proposal / Quotation", "Negotiation", "Won – Contract Pending", "Won – In Execution", "Closing", "Closed", LOST)
        fun group(stage: String) = when (stage) {
            "Incoming", "Proposal / Quotation", "Negotiation" -> "Pipeline"
            "Won – Contract Pending" -> "Pre-Execution"
            "Won – In Execution", "Closing" -> "Execution"
            "Closed" -> "Closed"
            LOST -> "Lost"
            else -> "Pipeline"
        }
    }
}

data class PipelineChange(val id: String, val field: String, val before: JsonElement?, val after: JsonElement?, val createdAt: String?, val user: PipelinePerson?,
                          val termId: String? = null, val termLabel: String? = null) {
    /** "term.amount" → "amount" (also "created" / "deleted" / "restored"); null for a change to the deal itself. */
    val termField get() = if (field.startsWith("term.")) field.removePrefix("term.") else null

    companion object {
        /** The entry a `document.added` / `document.removed` row carries. */
        fun doc(e: JsonElement?) = (e as? JsonObject)?.let(PipelineLink::of)
    }
}

/** GET …/pipeline: everything the tab draws. */
data class PipelineData(val deals: List<PipelineDeal>, val summary: PipelineSummary, val vocab: PipelineVocab, val today: String, val workspaceId: String?,
                        /** FULL | EDIT | COMMENT | VIEW; null from an older server. */
                        val viewerAccessLevel: String? = null,
                        /** Full / Can edit = true; Can comment / Can view read only. An older server says nothing: true. */
                        val canEdit: Boolean = true) {
    companion object {
        fun of(o: JsonObject) = PipelineData(
            deals = (o["deals"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::PipelineDeal) },
            summary = PipelineSummary(o["summary"] as? JsonObject ?: JsonObject(emptyMap())),
            vocab = PipelineVocab(o["vocab"] as? JsonObject ?: JsonObject(emptyMap())),
            today = o["today"].str()?.take(10) ?: java.time.LocalDate.now(id.znetworks.nexus.core.time.OfficeTime.ZONE).toString(),
            workspaceId = (o["project"] as? JsonObject)?.get("workspaceId").str(),
            viewerAccessLevel = o["viewerAccessLevel"].str(),
            canEdit = (o["canEdit"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toBooleanStrictOrNull() ?: true,
        )
    }
}

/** Filters of the toolbar (search, PM, BD, health) — over the loaded deals. */
object PipelineFilter {
    fun apply(deals: List<PipelineDeal>, q: String, pm: String?, bd: String?, health: String?, service: String? = null): List<PipelineDeal> {
        val t = q.trim().lowercase()
        return deals.filter { d ->
            (t.isEmpty() || (listOf(d.name, d.code, d.brand, d.bdShown.orEmpty(), d.pmShown.orEmpty()) + d.services).any { it.lowercase().contains(t) }) &&
                (service == null || d.services.any { it.equals(service, ignoreCase = true) }) &&
                (pm == null || (d.pmUserId ?: d.pmShown) == pm) &&
                (bd == null || (d.bdUserId ?: d.bdShown) == bd) &&
                (health == null || d.healthKey == health)
        }
    }

    /** Every service the board uses (for the filter, shown when more than one), presets' spelling first, A→Z. */
    fun services(deals: List<PipelineDeal>): List<String> =
        deals.flatMap { it.services }.distinctBy { it.lowercase() }.sortedBy { it.lowercase() }

    /** "Next actions": a written next action due within 7 days (or overdue), soonest first, Lost/Closed left out. */
    fun nextActions(deals: List<PipelineDeal>, today: String): List<PipelineDeal> {
        val limit = runCatching { java.time.LocalDate.parse(today).plusDays(7).toString() }.getOrDefault(today)
        return deals.filter { d -> d.stageGroup != "Lost" && d.stageGroup != "Closed" && d.date("nextActionDate")?.let { it <= limit } == true }
            .sortedBy { it.date("nextActionDate") }
    }
}

/** The services editor (§13.2): presets + typed ones, max 20, each 1–60 characters, a preset typed in any case = the preset. */
object PipelineServices {
    const val MAX = 20
    const val MAX_LEN = 60
    /** [typed] added to [current]: trimmed, a preset's own spelling, no duplicates, within the limits; else null. */
    fun add(current: List<String>, typed: String, presets: List<String>): List<String>? {
        val t = typed.trim().take(MAX_LEN)
        if (t.isEmpty() || current.size >= MAX) return null
        val name = presets.firstOrNull { it.equals(t, ignoreCase = true) } ?: t
        return if (current.any { it.equals(name, ignoreCase = true) }) current else current + name
    }
    fun toggle(current: List<String>, s: String) = if (current.any { it.equals(s, ignoreCase = true) }) current.filterNot { it.equals(s, ignoreCase = true) }
        else if (current.size >= MAX) current else current + s
    /** "Other services": this deal's typed ones + those used on the board's other deals, not presets. */
    fun others(deal: PipelineDeal, all: List<PipelineDeal>, presets: List<String>): List<String> =
        (deal.services + all.flatMap { it.services }).filter { s -> presets.none { it.equals(s, ignoreCase = true) } }.distinctBy { it.lowercase() }
}

/** What a board card shows (§12.3): only what is known. */
object PipelineCard {
    /** A small dot before the code; none for Not started (and Lost). */
    val DOTTED = setOf("CRITICAL", "ATTENTION", "HEALTHY")
    /** The first reason, as a red / amber line, only for Critical / Attention; with how many more there are. */
    fun firstReason(d: PipelineDeal): Pair<PipelineReason, Int>? =
        if (d.healthKey == "CRITICAL" || d.healthKey == "ATTENTION") d.reasons.firstOrNull()?.let { it to d.reasons.size - 1 } else null
    /** "No PM yet" warns on a won deal still to run (not once closed). */
    fun needsPm(d: PipelineDeal) = d.stageGroup == "Pre-Execution" || d.stageGroup == "Execution"
    /** The next-action date chip; none on Closed / Lost. */
    fun nextDate(d: PipelineDeal) = if (d.stageGroup == "Closed" || d.stageGroup == "Lost") null else d.date("nextActionDate")
    enum class Tone { PAST, TODAY, LATER }
    fun dateTone(day: String, today: String) = when { day < today -> Tone.PAST; day == today -> Tone.TODAY; else -> Tone.LATER }
    /** "4 Okt" / "4 Oct": the year goes without saying on a card. */
    fun shortDay(iso: String, id: Boolean = java.util.Locale.getDefault().language.let { it == "in" || it == "id" }): String = runCatching {
        java.time.format.DateTimeFormatter.ofPattern("d MMM", if (id) java.util.Locale.forLanguageTag("id-ID") else AppLanguage.ENGLISH_FORMATS).format(java.time.LocalDate.parse(iso.take(10)))
    }.getOrDefault(iso)
}

/** Rupiah and percentages the way the web writes them, in the app's language. */
object PipelineFormat {
    private fun isId() = java.util.Locale.getDefault().language.let { it == "in" || it == "id" }

    /** Compact: Rp950Jt / Rp1,2M (Indonesian) or Rp950M / Rp1.2B (English) — the GM's fmtIDR. */
    fun idr(n: Double, id: Boolean = isId()): String {
        val abs = kotlin.math.abs(n)
        val (b, m, k) = if (id) Triple("M", "Jt", "Rb") else Triple("B", "M", "K")
        val (v, s) = when { abs >= 1e9 -> abs / 1e9 to b; abs >= 1e6 -> abs / 1e6 to m; abs >= 1e3 -> abs / 1e3 to k; else -> abs to "" }
        val nf = java.text.NumberFormat.getNumberInstance(if (id) java.util.Locale.forLanguageTag("id-ID") else AppLanguage.ENGLISH_FORMATS)
            .apply { maximumFractionDigits = if (s.isNotEmpty() && v < 10) 1 else 0; minimumFractionDigits = 0 }
        return (if (n < 0) "-" else "") + "Rp" + nf.format(v) + s
    }

    /** Full: Rp950.000.000. */
    fun idrFull(n: Double, id: Boolean = isId()): String =
        (if (n < 0) "-" else "") + "Rp" + java.text.NumberFormat.getNumberInstance(if (id) java.util.Locale.forLanguageTag("id-ID") else AppLanguage.ENGLISH_FORMATS)
            .apply { maximumFractionDigits = 0 }.format(kotlin.math.round(kotlin.math.abs(n)))

    /** What someone typed in a money field ("950.000.000", "Rp 950000000", "-5000"); blank = 0, garbage = null. */
    fun parseMoney(text: String): Double? {
        val t = text.trim()
        if (t.isEmpty()) return 0.0
        val digits = t.filter { it.isDigit() }
        if (digits.isEmpty()) return null
        return digits.toDouble().let { if (t.startsWith("-")) -it else it }
    }

    fun pct(p: Double) = "${kotlin.math.round(p * 100).toInt()}%"
}

/** Words for the GM's keys and the server's codes (same wording as the web's id-pipeline.ts). */
object PipelineText {
    /** Three stages the GM named in Indonesian; every other stage key is shown as stored. */
    fun stage(k: String): Int? = when (k) { "Negotiation" -> R.string.pl_stage_negotiation; "Won – Contract Pending" -> R.string.pl_stage_won_pending; "Won – In Execution" -> R.string.pl_stage_won_exec; else -> null }
    fun risk(k: String): Int? = if (k == "Aman") R.string.pl_on_track else null
    fun link(k: String): Int? = when (k) { "SPK" -> R.string.pl_link_spk; "Kontrak" -> R.string.pl_link_contract; "Lainnya" -> R.string.pl_link_other; else -> null }
    fun health(k: String) = when (k) { "CRITICAL" -> R.string.pl_critical; "ATTENTION" -> R.string.pl_attention; "HEALTHY" -> R.string.pl_healthy; "NOT_STARTED" -> R.string.pl_not_started; else -> R.string.pl_lost }
    fun phase(k: String): Int? = when (k) {
        "commercial" -> R.string.pl_ph_commercial; "contract" -> R.string.pl_ph_contract; "readiness" -> R.string.pl_ph_readiness
        "deliverable" -> R.string.pl_ph_deliverable; "payment" -> R.string.pl_ph_payment; "closing" -> R.string.pl_ph_closing; else -> null
    }
    /** A reason code → (string or plural, its argument); an unknown code is shown raw by the caller. */
    sealed interface Words { data class Str(val res: Int, val arg: String? = null) : Words; data class Plural(val res: Int, val n: Int) : Words; data class Raw(val text: String) : Words }
    fun reason(r: PipelineReason): Words = when (r.code) {
        "READINESS_BLOCKED" -> Words.Str(R.string.pl_r_blocked)
        "EXECUTION_WITHOUT_CONTRACT" -> Words.Str(R.string.pl_r_no_contract)
        // The same words for both: the pill's colour already says whether it is critical (> 7 days).
        "RECEIVABLE_OVERDUE", "MINOR_OVERDUE" -> Words.Plural(R.plurals.pl_r_overdue, r.days ?: 0)
        "DELIVERABLE_OVERDUE" -> Words.Str(R.string.pl_r_deliv_overdue)
        "NEGATIVE_CASH" -> Words.Str(R.string.pl_r_neg_cash)
        "READINESS_PARTIAL" -> Words.Str(R.string.pl_r_partial)
        "DELIVERABLE_AT_RISK" -> Words.Str(R.string.pl_r_at_risk)
        "PAYMENT_PARTIAL" -> Words.Str(R.string.pl_r_partly_paid)
        "PAYMENT_DUE" -> Words.Str(R.string.pl_r_payment_due)
        "BLOCKER" -> Words.Str(R.string.pl_r_blocker, r.text.orEmpty())
        "VREG_PENDING" -> Words.Str(R.string.pl_r_vreg)
        else -> Words.Raw(r.code)
    }
    /**
     * The line under a phase in the stepper (§14.3; web usePhaseDetail, iOS phaseDetail): the GM's node words. Never
     * "Overdue 0 days"; an unknown status is shown as stored. [stageWords] = the stage's own label.
     */
    fun phaseDetail(d: PipelineDeal, key: String): Words = when (key) {
        "commercial" -> PipelineVocab.group(d.stage).let { g -> if (g == "Pipeline" || g == "Lost") stage(d.stage)?.let { Words.Str(it) } ?: Words.Raw(d.stage) else Words.Str(R.string.pl_d_won) }
        "contract" -> d.text("contractStatus").let { st -> when (st) {
            "Fully Executed" -> Words.Str(R.string.pl_d_executed); "Cancelled" -> Words.Str(R.string.pl_d_cancelled)
            "", "Not Started" -> Words.Str(R.string.pl_not_started); else -> Words.Raw(st) } }
        "readiness" -> when (d.text("readiness")) {
            "Ready" -> Words.Str(R.string.pl_d_ready); "Blocked" -> Words.Str(R.string.pl_r_blocked); "Partial" -> Words.Str(R.string.pl_r_partial)
            else -> Words.Str(R.string.pl_d_not_relevant) }
        "deliverable" -> d.text("deliverableStatus").let { st -> when {
            st == "Completed" || st == "Approved" -> Words.Str(R.string.pl_d_deliv_done)
            d.text("deliverableRisk") == "Overdue" -> Words.Str(R.string.pl_r_deliv_overdue)
            d.text("deliverableRisk") == "At Risk" -> Words.Str(R.string.pl_r_at_risk)
            st.isEmpty() || st == "Not Started" -> Words.Str(R.string.pl_not_started)
            else -> Words.Raw(st) } }
        "payment" -> when (d.paymentStatusShown) {
            "Paid" -> Words.Str(R.string.pl_d_fully_paid)
            "Overdue" -> if (d.daysOverdue > 0) Words.Plural(R.plurals.pl_d_overdue_days, d.daysOverdue) else Words.Str(R.string.pl_d_payment_overdue)
            "Partial" -> Words.Str(R.string.pl_r_partly_paid); "Due" -> Words.Str(R.string.pl_r_payment_due); "Upcoming" -> Words.Str(R.string.pl_d_upcoming)
            else -> Words.Str(R.string.pl_d_not_billed) }
        "closing" -> d.text("closingStatus").let { st -> when (st) { "Closed" -> Words.Raw("Closed"); "", "Not Ready" -> Words.Str(R.string.pl_not_started); else -> Words.Raw(st) } }
        else -> Words.Raw("")
    }

    /** A payment term's status (server: TERM_STATUSES); an unknown key is shown as stored. */
    fun termStatus(k: String): Int? = when (k) {
        "Not Invoiced" -> R.string.pl_t_not_invoiced; "Invoiced" -> R.string.pl_t_invoiced; "Partial" -> R.string.pl_t_partial
        "Paid" -> R.string.pl_t_paid; "Overdue" -> R.string.pl_t_overdue; else -> null
    }
    /** A payment term's fields in the History tab. */
    fun termField(k: String): Int? = when (k) {
        "label" -> R.string.pl_f_name; "amount" -> R.string.pl_t_amount; "dueDate" -> R.string.pl_f_due_date; "invoiceNo" -> R.string.pl_t_invoice_no
        "invoiceDate" -> R.string.pl_t_invoice_date; "paidAmount" -> R.string.pl_t_paid_amount; "paidAt" -> R.string.pl_t_paid_at; "note" -> R.string.pl_t_note
        else -> null
    }
    /** Field names for the History tab. */
    fun field(k: String): Int? = when (k) {
        "name" -> R.string.pl_f_name; "brand" -> R.string.pl_f_brand; "service" -> R.string.pl_f_service; "bdUserId", "bdName" -> R.string.pl_f_bd
        "pmUserId", "pmName" -> R.string.pl_f_pm; "stage" -> R.string.pl_f_stage; "probability" -> R.string.pl_f_probability
        "contractValue" -> R.string.pl_f_contract_value; "netValue" -> R.string.pl_f_net_value; "invoiceValue" -> R.string.pl_f_invoice_value
        "contractStatus" -> R.string.pl_f_contract_status; "vregStatus" -> R.string.pl_f_vreg; "readiness" -> R.string.pl_f_readiness
        "deliverableStatus" -> R.string.pl_f_deliv_status; "deliverableRisk" -> R.string.pl_f_deliv_risk; "paymentStatus" -> R.string.pl_f_payment_status
        "outstandingReceivable" -> R.string.pl_f_receivable; "paymentDueDate" -> R.string.pl_f_due_date; "maxDaysOverdue" -> R.string.pl_f_days_typed
        "netCash" -> R.string.pl_f_net_cash; "closingStatus" -> R.string.pl_f_closing_status; "mainDate" -> R.string.pl_f_main_date
        "nextAction" -> R.string.pl_f_next_action; "nextActionDate" -> R.string.pl_f_next_date; "blocker" -> R.string.pl_f_blocker
        "notes" -> R.string.pl_f_notes; "links" -> R.string.pl_f_links; "services" -> R.string.pl_f_services; "costs" -> R.string.pc_real_cost
        else -> null
    }
}

/** The answer of "Create execution project" (§15.1): a folder to open, else the project (an older server). */
data class PipelineExecution(val folderId: String?, val projectId: String?, val calendarProjectId: String?, val deal: PipelineDeal?) {
    companion object {
        fun of(o: JsonObject) = PipelineExecution(
            o["folderId"].str(), o["projectId"].str(), o["calendarProjectId"].str(),
            (o["deal"] as? JsonObject)?.let(::PipelineDeal)?.takeIf { it.id.isNotEmpty() },
        )
    }
}
