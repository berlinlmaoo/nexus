package id.znetworks.nexus.feature.pipeline

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

data class PipelineLink(val id: String, val type: String, val label: String, val url: String) {
    fun json() = JsonObject(mapOf("id" to JsonPrimitive(id), "type" to JsonPrimitive(type), "label" to JsonPrimitive(label), "url" to JsonPrimitive(url)))
}

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
    /** The six phases (commercial … closing), each done | active | pending | bad. */
    val phases: List<Pair<String, String>> get() = (raw["phases"] as? JsonArray).orEmpty().mapNotNull { p ->
        (p as? JsonObject)?.let { (it["key"].str() ?: return@let null) to (it["state"].str() ?: "pending") }
    }
    val links: List<PipelineLink> get() = (raw["links"] as? JsonArray).orEmpty().mapNotNull { l ->
        (l as? JsonObject)?.let { o -> val url = o["url"].str().orEmpty(); PipelineLink(o["id"].str() ?: url, o["type"].str() ?: "Lainnya", o["label"].str().orEmpty(), url) }
    }
    /** The TASK project made for a won deal (§10.3); null until there is one. */
    val executionProjectId get() = raw["executionProjectId"].str() ?: (raw["executionProject"] as? JsonObject)?.get("id").str()
    val executionProjectName get() = (raw["executionProject"] as? JsonObject)?.get("name").str()
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

data class PipelineChange(val id: String, val field: String, val before: JsonElement?, val after: JsonElement?, val createdAt: String?, val user: PipelinePerson?)

/** GET …/pipeline: everything the tab draws. */
data class PipelineData(val deals: List<PipelineDeal>, val summary: PipelineSummary, val vocab: PipelineVocab, val today: String, val workspaceId: String?) {
    companion object {
        fun of(o: JsonObject) = PipelineData(
            deals = (o["deals"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::PipelineDeal) },
            summary = PipelineSummary(o["summary"] as? JsonObject ?: JsonObject(emptyMap())),
            vocab = PipelineVocab(o["vocab"] as? JsonObject ?: JsonObject(emptyMap())),
            today = o["today"].str()?.take(10) ?: java.time.LocalDate.now(id.znetworks.nexus.core.time.OfficeTime.ZONE).toString(),
            workspaceId = (o["project"] as? JsonObject)?.get("workspaceId").str(),
        )
    }
}

/** Filters of the toolbar (search, PM, BD, health) — over the loaded deals. */
object PipelineFilter {
    fun apply(deals: List<PipelineDeal>, q: String, pm: String?, bd: String?, health: String?): List<PipelineDeal> {
        val t = q.trim().lowercase()
        return deals.filter { d ->
            (t.isEmpty() || listOf(d.name, d.code, d.brand, d.bdShown.orEmpty(), d.pmShown.orEmpty()).any { it.lowercase().contains(t) }) &&
                (pm == null || (d.pmUserId ?: d.pmShown) == pm) &&
                (bd == null || (d.bdUserId ?: d.bdShown) == bd) &&
                (health == null || d.healthKey == health)
        }
    }

    /** "Next actions": a written next action due within 7 days (or overdue), soonest first, Lost/Closed left out. */
    fun nextActions(deals: List<PipelineDeal>, today: String): List<PipelineDeal> {
        val limit = runCatching { java.time.LocalDate.parse(today).plusDays(7).toString() }.getOrDefault(today)
        return deals.filter { d -> d.stageGroup != "Lost" && d.stageGroup != "Closed" && d.date("nextActionDate")?.let { it <= limit } == true }
            .sortedBy { it.date("nextActionDate") }
    }
}

/** Rupiah and percentages the way the web writes them, in the app's language. */
object PipelineFormat {
    private fun isId() = java.util.Locale.getDefault().language.let { it == "in" || it == "id" }

    /** Compact: Rp950Jt / Rp1,2M (Indonesian) or Rp950M / Rp1.2B (English) — the GM's fmtIDR. */
    fun idr(n: Double, id: Boolean = isId()): String {
        val abs = kotlin.math.abs(n)
        val (b, m, k) = if (id) Triple("M", "Jt", "Rb") else Triple("B", "M", "K")
        val (v, s) = when { abs >= 1e9 -> abs / 1e9 to b; abs >= 1e6 -> abs / 1e6 to m; abs >= 1e3 -> abs / 1e3 to k; else -> abs to "" }
        val nf = java.text.NumberFormat.getNumberInstance(if (id) java.util.Locale.forLanguageTag("id-ID") else java.util.Locale.UK)
            .apply { maximumFractionDigits = if (s.isNotEmpty() && v < 10) 1 else 0; minimumFractionDigits = 0 }
        return (if (n < 0) "-" else "") + "Rp" + nf.format(v) + s
    }

    /** Full: Rp950.000.000. */
    fun idrFull(n: Double, id: Boolean = isId()): String =
        (if (n < 0) "-" else "") + "Rp" + java.text.NumberFormat.getNumberInstance(if (id) java.util.Locale.forLanguageTag("id-ID") else java.util.Locale.UK)
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
        "notes" -> R.string.pl_f_notes; "links" -> R.string.pl_f_links
        else -> null
    }
}
