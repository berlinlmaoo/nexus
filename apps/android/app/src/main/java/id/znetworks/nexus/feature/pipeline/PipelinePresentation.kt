package id.znetworks.nexus.feature.pipeline

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

/** A display policy only: source values, edits and exports retain their ordinary representation. */
internal object PipelinePresentation {
    const val MASK = "Rp ••••"
    private val monetaryFields = setOf(
        "contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash",
        "costs", "costTotal", "margin", "marginPct", "amount", "paidAmount",
    )

    fun isMoney(field: String) = field in monetaryFields
    fun amount(value: Double, hidden: Boolean, full: Boolean = false,
               id: Boolean = java.util.Locale.getDefault().language.let { it == "in" || it == "id" }): String =
        if (hidden) MASK else if (full) PipelineFormat.idrFull(value, id) else PipelineFormat.idr(value, id)
}

internal val LocalPipelinePresentation = staticCompositionLocalOf { false }

@Composable
internal fun pipelineMoney(value: Double, full: Boolean = false): String =
    PipelinePresentation.amount(value, LocalPipelinePresentation.current, full)

@Composable
internal fun pipelineFullMoney(value: Double): String = pipelineMoney(value, full = true)
