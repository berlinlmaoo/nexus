package id.znetworks.nexus.feature.pipeline

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Real cost & margin (Control Tower v4–v6, owner 14 Oct 2026; server pipeline-server.ts costsOf / normalizeCosts,
// iOS PipelineRealCost). A deal's real cost is a list of open lines; the margin is on its NET value, live, never
// stored. The whole list goes back in one PATCH `{ "costs": [...] }`, like the links.

/** One real-cost line: "Vendor sound", Rp12.000.000. The id is made by the client that adds it and kept by the server. */
data class PipelineCost(val id: String, val label: String, val amount: Double) {
    /** What a PATCH of `costs` sends back for this line. */
    fun json() = JsonObject(mapOf("id" to JsonPrimitive(id), "label" to JsonPrimitive(label), "amount" to JsonPrimitive(amount.toLong())))

    companion object {
        /** A line without an id is dropped (as the server does); a missing label is "", a missing amount 0. */
        fun of(e: JsonElement?): PipelineCost? = (e as? JsonObject)?.let { o ->
            o["id"].str()?.let { PipelineCost(it, o["label"].str().orEmpty(), o["amount"].num()?.takeIf { a -> a.isFinite() } ?: 0.0) }
        }
    }
}

object PipelineCosts {
    /** The server's guards: at most 100 lines, each label at most 120 characters, amounts whole rupiah ≥ 0. */
    const val MAX_LINES = 100
    const val LABEL_MAX = 120

    private val HEX = "0123456789abcdef"

    /** A new line's id, in the shape the server makes: "c_" + 16 hex characters. */
    fun newId(random: kotlin.random.Random = kotlin.random.Random.Default): String =
        "c_" + (1..16).map { HEX[random.nextInt(16)] }.joinToString("")

    /** The lines as received; anything that is not a list (an older server) reads as none. */
    fun of(e: JsonElement?): List<PipelineCost> = (e as? JsonArray).orEmpty().mapNotNull(PipelineCost::of)

    /** "Add cost": a blank line at the end; null once the deal has [MAX_LINES]. */
    fun add(list: List<PipelineCost>, id: String = newId()): List<PipelineCost>? =
        if (list.size >= MAX_LINES) null else list + PipelineCost(id, "", 0.0)

    /** A line's description as the server stores it: trimmed, inner runs of spaces as one, at most [LABEL_MAX]. */
    fun cleanLabel(text: String) = text.trim().replace(Regex("\\s+"), " ").take(LABEL_MAX)

    fun relabel(list: List<PipelineCost>, id: String, text: String) = list.map { if (it.id == id) it.copy(label = cleanLabel(text)) else it }

    /** A typed amount: whole rupiah; a negative or garbage one is refused (null) rather than sent. */
    fun reprice(list: List<PipelineCost>, id: String, amount: Double?): List<PipelineCost>? =
        amount?.takeIf { it.isFinite() && it >= 0 }?.let { a -> list.map { if (it.id == id) it.copy(amount = Math.round(a).toDouble()) else it } }

    fun remove(list: List<PipelineCost>, id: String) = list.filterNot { it.id == id }

    /** Would the server take this list? (It answers 400 INVALID_FIELD "costs" otherwise.) */
    fun valid(list: List<PipelineCost>) = list.size <= MAX_LINES &&
        list.all { it.label.length <= LABEL_MAX && it.amount.isFinite() && it.amount >= 0 && it.amount == Math.round(it.amount).toDouble() }

    /** The PATCH body for the whole list. */
    fun patch(list: List<PipelineCost>) = JsonObject(mapOf("costs" to JsonArray(list.map(PipelineCost::json))))

    fun total(list: List<PipelineCost>) = list.sumOf { it.amount }

    /** Net value − real cost; null while the deal has no net value (no misleading 100% or 0). Server: marginOf. */
    fun margin(netValue: Double, costTotal: Double): Double? = if (netValue > 0) netValue - costTotal else null

    /** margin ÷ net value (0.25 = 25%); null with the margin. */
    fun marginPct(netValue: Double, costTotal: Double): Double? = margin(netValue, costTotal)?.let { it / netValue }

    enum class Tone { NEGATIVE, POSITIVE, NEUTRAL }

    /** Red below zero, green above, plain at zero or without a margin. */
    fun tone(margin: Double?) = when { margin == null || margin == 0.0 -> Tone.NEUTRAL; margin < 0 -> Tone.NEGATIVE; else -> Tone.POSITIVE }

    /** The board card's "Margin: Rp… (NN%)": only on a deal with at least one cost line AND a net value. */
    fun cardMargin(d: PipelineDeal): Pair<Double, Double>? {
        if (d.costs.isEmpty()) return null
        val m = d.margin ?: return null
        return m to (d.marginPct ?: 0.0)
    }

    /** A `costs` value in the History tab: (lines, Σ amount); null for nothing / an empty list (shown as "empty"). */
    fun historyLines(e: JsonElement?): Pair<Int, Double>? {
        val a = e as? JsonArray ?: return null
        if (a.isEmpty()) return null
        return a.size to a.sumOf { ((it as? JsonObject)?.get("amount")).num() ?: 0.0 }
    }
}
