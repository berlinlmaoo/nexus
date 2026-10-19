package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonElement

/** Red below zero, green above, plain at zero (iOS / web margin tone). */
@Composable
internal fun marginColor(m: Double?): Color = when (PipelineCosts.tone(m)) {
    PipelineCosts.Tone.NEGATIVE -> Nx.colors.danger; PipelineCosts.Tone.POSITIVE -> Nx.colors.success; PipelineCosts.Tone.NEUTRAL -> Nx.colors.foreground
}

/** A `costs` value in the History tab: "3 cost lines · Rp12.500.000", or "empty". */
@Composable
internal fun costsShown(e: JsonElement?): String = PipelineCosts.historyLines(e)?.let { (n, total) ->
    pluralStringResource(R.plurals.pc_h_lines, n, n, PipelineFormat.idrFull(total))
} ?: stringResource(R.string.pl_empty_value)

/**
 * "Real cost & margin" (Control Tower v4, owner 14 Oct 2026; iOS PipelineRealCost, web DealDrawer RealCost): total
 * real cost · margin · margin %, then the lines. Full / Can edit edit them — each line saves when its field is left,
 * the whole list in one PATCH; Can comment / Can view read them. Delete needs no question: History keeps the line.
 */
@Composable
internal fun RealCost(deal: PipelineDeal, canEdit: Boolean, onEdit: ((List<PipelineCost>) -> List<PipelineCost>?) -> Unit) {
    val c = Nx.colors
    val costs = deal.costs
    val margin = deal.margin
    val tone = marginColor(margin)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Figure(stringResource(R.string.pc_total), PipelineFormat.idrFull(deal.costTotal), c.foreground, Modifier.weight(1f))
        Figure(stringResource(R.string.pc_margin), margin?.let { PipelineFormat.idrFull(it) } ?: "–", tone, Modifier.weight(1f))
        Figure(stringResource(R.string.pc_margin_pct), deal.marginPct?.let { PipelineFormat.pct(it) } ?: "–", tone, Modifier.weight(0.7f))
    }
    Text(stringResource(if (margin == null) R.string.pc_hint_no_net else R.string.pc_hint), fontSize = 12.sp, color = c.mutedFg)
    if (costs.isEmpty()) Text(stringResource(if (canEdit) R.string.pc_empty else R.string.pc_empty_read), fontSize = 13.sp, color = c.mutedFg)
    costs.forEach { cost ->
        // Keyed by the line's id, so a field's draft stays with its line when another line goes.
        key(cost.id) {
            if (canEdit) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CostField(cost.label, stringResource(R.string.pc_description), stringResource(R.string.pc_description_hint), money = false, Modifier.weight(1f)) { t ->
                    onEdit { PipelineCosts.relabel(it, cost.id, t) } }
                CostField(if (cost.amount == 0.0) "" else PipelineFormat.idrFull(cost.amount).removePrefix("Rp"), stringResource(R.string.pc_amount), "0",
                    money = true, Modifier.width(130.dp)) { t -> onEdit { PipelineCosts.reprice(it, cost.id, PipelineFormat.parseMoney(t)) } }
                IconButton(onClick = { onEdit { PipelineCosts.remove(it, cost.id) } }) { Icon(Icons.Filled.Delete, stringResource(R.string.pc_delete), tint = c.dangerText) }
            } else {
                val label = cost.label.ifBlank { "–" }
                val amount = PipelineFormat.idrFull(cost.amount)
                Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).semantics(mergeDescendants = true) { contentDescription = "$label, $amount" },
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(label, fontSize = 14.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Text(amount, fontSize = 14.sp, color = c.foreground)
                }
            }
        }
    }
    if (canEdit) NxOutlinedButton(onClick = { onEdit { PipelineCosts.add(it) } }, enabled = costs.size < PipelineCosts.MAX_LINES) {
        Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.pc_add))
    }
}

@Composable
private fun Figure(label: String, value: String, color: Color, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.background, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 8.dp)
        .semantics(mergeDescendants = true) {}) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One line's description or amount: saved when it is left (or Done), only if it changed — the deal sheet's rule. */
@Composable
private fun CostField(value: String, label: String, placeholder: String, money: Boolean, modifier: Modifier, onSave: (String) -> Unit) {
    var t by remember(value) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    fun commit() { if (t != value) onSave(t) }
    NxTextField(t, { t = if (money) it else it.take(PipelineCosts.LABEL_MAX) }, label = { Text(label, maxLines = 1) }, placeholder = { Text(placeholder, maxLines = 1) },
        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = if (money) KeyboardType.Number else KeyboardType.Text, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        modifier = modifier.onFocusChanged { f -> if (focused && !f.isFocused) commit(); focused = f.isFocused })
}
