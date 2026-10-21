package id.znetworks.nexus.feature.pipeline

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

/** A display policy only: source values, edits and exports retain their ordinary representation. */
internal object PipelinePresentation {
    const val MASK = "Rp ••••"
    private val monetaryFields = setOf(
        "contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash",
        "costs", "costTotal", "margin", "marginPct", "amount", "paidAmount",
        "barterValue", "cashbackTotal", "budgetTotal", "cashback.amount", "budget.amount",
    )

    fun isMoney(field: String) = field in monetaryFields
    /** Only these item kinds contain money; a contact snapshot must never expose an accidental amount key. */
    fun itemHistoryAmount(kind: String, value: Double?, hidden: Boolean): String? =
        if (kind !in setOf("cashback", "budget") || value == null) null else amount(value, hidden, full = true)
    fun amount(value: Double, hidden: Boolean, full: Boolean = false,
               id: Boolean = java.util.Locale.getDefault().language.let { it == "in" || it == "id" }): String =
        if (hidden) MASK else if (full) PipelineFormat.idrFull(value, id) else PipelineFormat.idr(value, id)
}

internal val LocalPipelinePresentation = staticCompositionLocalOf { false }
internal val LocalPipelineCanEdit = staticCompositionLocalOf { true }

@Composable
internal fun pipelineMoney(value: Double, full: Boolean = false): String =
    PipelinePresentation.amount(value, LocalPipelinePresentation.current, full)

@Composable
internal fun pipelineFullMoney(value: Double): String = pipelineMoney(value, full = true)
