package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate

private fun f(vararg p: Pair<String, JsonElement>) = JsonObject(mapOf(*p))
private fun day(s: String?): JsonElement = s?.let(::JsonPrimitive) ?: JsonNull
private fun moneyText(v: Double) = if (v == 0.0) "" else PipelineFormat.idrFull(v).removePrefix("Rp")

/**
 * Payment terms of a deal (PIPELINE-DASHBOARD §11.2, web 5ff5b6a, iOS f316ef4): DP, Termin 1 … each with its
 * amount, due date, invoice and payment. Status, outstanding and days overdue are the server's; every change
 * answers the whole deal, whose receivable and health then follow the terms.
 */
@Composable
internal fun PaymentTerms(deal: PipelineDeal, vm: PipelineViewModel) {
    val c = Nx.colors
    val terms = deal.terms
    val ts = deal.termSummary
    var adding by remember { mutableStateOf(false) }
    if (ts != null && terms.isNotEmpty()) {
        Text(stringResource(R.string.pl_t_paid_of, pipelineFullMoney(ts.totalPaid), pipelineFullMoney(ts.totalAmount)), fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold, color = c.foreground)
    }
    if (PipelineTerms.mismatch(deal)) {
        val sum = pipelineFullMoney(terms.sumOf { it.amount })
        val ref = pipelineFullMoney(deal.termsReference)
        Text(if (deal.invoiceValue > 0) stringResource(R.string.pl_t_vs_invoice, sum, ref) else stringResource(R.string.pl_t_vs_contract, sum, ref),
            fontSize = 12.sp, color = c.warning)
    }
    if (terms.isEmpty()) Text(stringResource(R.string.pl_t_empty), fontSize = 12.sp, color = c.mutedFg)
    terms.forEach { t -> key(t.id) { TermCard(deal, t, vm) } }
    TextButton(onClick = { adding = true }, enabled = !LocalPipelinePresentation.current) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.pl_t_add)) }
    if (adding && !LocalPipelinePresentation.current) NewTerm(deal, vm) { adding = false }
}

@Composable
internal fun termColor(status: String): Color = when (status) {
    "Paid" -> Nx.colors.success; "Overdue" -> Nx.colors.danger; "Partial" -> Nx.colors.warning; "Invoiced" -> Nx.colors.violetText; else -> Nx.colors.mutedFg
}

/** The status pill, "· n hr" when late (the web's wording). */
@Composable
internal fun TermPill(t: PipelineTerm) {
    val col = termColor(t.status)
    val word = PipelineText.termStatus(t.status)?.let { stringResource(it) } ?: t.status
    Text(if (t.daysOverdue > 0) stringResource(R.string.pl_t_late, word, t.daysOverdue) else word, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = col, maxLines = 1,
        modifier = Modifier.background(col.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
}

/** One term, edited in place: each field saved when it is left, like the rest of the deal. */
@Composable
private fun TermCard(deal: PipelineDeal, t: PipelineTerm, vm: PipelineViewModel) {
    val c = Nx.colors
    var paying by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val save = { fields: JsonObject -> vm.updateTerm(deal.id, t.id, fields) }
    Column(Modifier.fillMaxWidth().background(c.background, RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t.label.ifBlank { stringResource(R.string.pl_t_term) }, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
            TermPill(t)
            IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, stringResource(R.string.pl_t_delete), tint = c.dangerText) }
        }
        Text(if (t.isPaid) stringResource(R.string.pl_t_paid_full, t.paidAt?.let(::dayLabel) ?: "–") else stringResource(R.string.pl_t_still_owed, pipelineFullMoney(t.outstanding)),
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (t.isPaid) c.success else if (t.daysOverdue > 0) c.danger else c.mutedFg)
        TextSave(stringResource(R.string.pl_f_name), t.label) { save(f("label" to JsonPrimitive(it))) }
        if (t.overpaid > 0) Text(stringResource(R.string.qa_term_overpaid, pipelineFullMoney(t.overpaid)), color = c.warningFg, fontSize = 12.sp)
        Money(stringResource(R.string.pl_t_amount), t.amount) { save(f("amount" to JsonPrimitive(it))) }
        DateSave(stringResource(R.string.pl_f_due_date), t.dueDate) { save(f("dueDate" to day(it))) }
        TextSave(stringResource(R.string.pl_t_invoice_no), t.invoiceNo) { save(f("invoiceNo" to JsonPrimitive(it))) }
        DateSave(stringResource(R.string.pl_t_invoice_date), t.invoiceDate) { save(f("invoiceDate" to day(it))) }
        // Amount paid and its date once something is paid; "Mark paid" for the rest.
        if (t.paidAmount > 0 || t.paidAt != null) {
            Money(stringResource(R.string.pl_t_paid_amount), t.paidAmount) { save(f("paidAmount" to JsonPrimitive(it))) }
            DateSave(stringResource(R.string.pl_t_paid_at), t.paidAt) { save(f("paidAt" to day(it))) }
        }
        TextSave(stringResource(R.string.pl_t_note), t.note, multiline = true) { save(f("note" to JsonPrimitive(it))) }
        if (!t.isPaid) TextButton(onClick = { paying = true }, enabled = !LocalPipelinePresentation.current) {
            Icon(Icons.Filled.CheckCircle, null, Modifier.size(16.dp), tint = c.success); Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.pl_t_mark_paid), color = c.success, fontWeight = FontWeight.SemiBold)
        }
    }
    if (paying && !LocalPipelinePresentation.current) MarkPaid(t, onDismiss = { paying = false }) { amount, date ->
        vm.updateTerm(deal.id, t.id, f("paidAmount" to JsonPrimitive(amount), "paidAt" to JsonPrimitive(date))) { ok -> if (ok) paying = false }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.pl_t_delete_q, t.label.ifBlank { stringResource(R.string.pl_t_term) })) },
        text = { Text(stringResource(R.string.pl_t_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteTerm(deal.id, t.id) }) {
            Text(stringResource(R.string.pl_t_delete), color = c.dangerText, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
}

/** "Mark paid": the total received so far (starts at the whole term) and the day, today unless changed. */
@Composable
private fun MarkPaid(t: PipelineTerm, onDismiss: () -> Unit, onSave: (Double, String) -> Unit) {
    var amount by remember { mutableStateOf(moneyText(t.amount)) }
    var date by remember { mutableStateOf(LocalDate.now(OfficeTime.ZONE).toString()) }
    val parsed = PipelineFormat.parseMoney(amount)?.takeIf { it >= 0 }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.pl_t_mark_paid)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NxTextField(amount, { amount = it }, singleLine = true, label = { Text(stringResource(R.string.pl_t_total_received)) },
                    isError = parsed == null, supportingText = if (parsed == null) { { Text(stringResource(R.string.pl_t_number)) } } else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                DateSave(stringResource(R.string.pl_t_paid_at), date) { it?.let { d -> date = d } }
                if (parsed != null && parsed > t.amount) Text(stringResource(R.string.qa_term_overpaid_warning, pipelineFullMoney(parsed - t.amount)), color = Nx.colors.warningFg, fontSize = 12.sp)
            }
        },
        confirmButton = { TextButton(onClick = { parsed?.let { onSave(it, date) } }, enabled = parsed != null) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** "Add term": a name (blank → the server's "Termin n"), the amount left of the invoice (else contract) value, a due date. */
@Composable
private fun NewTerm(deal: PipelineDeal, vm: PipelineViewModel, onClose: () -> Unit) {
    var label by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf(moneyText(PipelineTerms.suggestedAmount(deal))) }
    var due by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val parsed = PipelineFormat.parseMoney(amount)?.takeIf { it >= 0 }
    AlertDialog(onDismissRequest = onClose, title = { Text(stringResource(R.string.pl_t_new)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NxTextField(label, { label = it }, singleLine = true, label = { Text(stringResource(R.string.pl_f_name)) },
                    placeholder = { Text(stringResource(R.string.pl_t_label_hint)) }, modifier = Modifier.fillMaxWidth())
                NxTextField(amount, { amount = it }, singleLine = true, label = { Text(stringResource(R.string.pl_t_amount)) },
                    isError = parsed == null, supportingText = if (parsed == null) { { Text(stringResource(R.string.pl_t_number)) } } else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                DateSave(stringResource(R.string.pl_f_due_date), due) { due = it }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                busy = true
                vm.addTerm(deal.id, f("label" to JsonPrimitive(label.trim()), "amount" to JsonPrimitive(parsed ?: 0.0), "dueDate" to day(due))) { ok -> busy = false; if (ok) onClose() }
            }, enabled = parsed != null && !busy) { Text(stringResource(R.string.pl_t_add)) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.cancel)) } })
}
