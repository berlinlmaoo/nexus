package id.znetworks.nexus.feature.pipeline

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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxOutlinedButton
import id.znetworks.nexus.ui.components.NxTextField
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Server-owned item lists: each field PATCH changes one key and every answer replaces the entire deal. */
@Composable
internal fun PipelineItems(deal: PipelineDeal, kind: String, data: PipelineData, vm: PipelineViewModel, onClose: () -> Unit) {
    if (LocalPipelinePresentation.current && kind != "contact") return
    val c = Nx.colors
    val canEdit = data.canEdit && LocalPipelineCanEdit.current
    val busy = vm.state.collectAsState().value.busy
    val items = when (kind) { "cashback" -> deal.cashback; "budget" -> deal.budgets; else -> deal.contacts }
    val title = stringResource(itemTitle(kind))
    val addLabel = stringResource(when (kind) { "cashback" -> R.string.pv8_add_recipient; "budget" -> R.string.pv8_add_category; else -> R.string.pv8_add_contact })
    val add = { vm.addItem(deal.id, kind) }
    if (items.isEmpty()) {
        EmptyState(
            icon = when (kind) { "cashback" -> Icons.Filled.Savings; "budget" -> Icons.Filled.AccountBalanceWallet; else -> Icons.Filled.Contacts },
            title = title,
            message = stringResource(when (kind) {
                "cashback" -> if (canEdit) R.string.pv8_cashback_empty else R.string.pv8_cashback_empty_read
                "budget" -> if (canEdit) R.string.pv8_budget_empty else R.string.pv8_budget_empty_read
                else -> if (canEdit) R.string.pv8_contacts_empty else R.string.pv8_contacts_empty_read
            }),
            actionLabel = if (canEdit) addLabel else stringResource(R.string.close),
            onAction = if (canEdit) add else onClose,
            actionEnabled = !canEdit || !busy,
        )
    }
    items.forEach { item -> key(item.id) {
        val update = { field: String, value: JsonPrimitive -> vm.updateItem(deal.id, item.id, JsonObject(mapOf(field to value))) }
        Column(Modifier.fillMaxWidth().background(c.background, RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (kind == "contact") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Pick(stringResource(R.string.pv8_contact_role), item.role, data.vocab.contactRoles, label = { contactRoleLabel(it) }) { update("role", JsonPrimitive(it)) } }
                    if (canEdit) IconButton(onClick = { vm.deleteItem(deal.id, item.id) }, enabled = !busy) { Icon(Icons.Filled.Delete, stringResource(R.string.pv8_delete_contact), tint = c.dangerText) }
                }
                ItemField(item.name, stringResource(R.string.signup_name), maxLength = 120, canEdit = canEdit) { update("name", JsonPrimitive(it)) }
                ItemField(item.phone, stringResource(R.string.pv8_phone), maxLength = 40, canEdit = canEdit, phone = true) { update("phone", JsonPrimitive(it)) }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ItemField(item.name, stringResource(if (kind == "cashback") R.string.pv8_recipient_name else R.string.pv8_category_name), maxLength = 120,
                        canEdit = canEdit, modifier = Modifier.weight(1f), placeholder = if (kind == "budget") stringResource(R.string.pv8_category_hint) else "") { update("name", JsonPrimitive(it)) }
                    if (canEdit) IconButton(onClick = { vm.deleteItem(deal.id, item.id) }, enabled = !busy) { Icon(Icons.Filled.Delete,
                        stringResource(if (kind == "cashback") R.string.pv8_delete_recipient else R.string.pv8_delete_category), tint = c.dangerText) }
                }
                ItemField(if (item.amount == 0.0) "" else PipelineFormat.idrFull(item.amount).removePrefix("Rp").trim(), stringResource(R.string.pl_t_amount), maxLength = 30,
                    money = true, canEdit = canEdit) { PipelineFormat.parseMoney(it)?.let { n -> update("amount", JsonPrimitive(n)) } }
                if (kind == "budget") {
                    Text(stringResource(R.string.pv8_used, PipelineFormat.idrFull(item.spent)), fontSize = 12.sp, color = c.mutedFg)
                    Text(stringResource(if (item.remaining < 0) R.string.pv8_over_by else R.string.pv8_remaining, PipelineFormat.idrFull(kotlin.math.abs(item.remaining))),
                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (item.remaining < 0) c.dangerText else c.success)
                }
            }
        }
    } }
    if (canEdit && items.isNotEmpty()) NxOutlinedButton(onClick = add, enabled = !busy && items.size < 100) {
        Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(addLabel)
    }
    if (kind != "contact") {
        Row(Modifier.fillMaxWidth().background(c.background, RoundedCornerShape(10.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(if (kind == "budget") R.string.pv8_budget_total else R.string.pv8_cashback_total), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
            Text(PipelineFormat.idrFull(if (kind == "budget") deal.budgetTotal else deal.cashbackTotal), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        }
        if (kind == "budget") Text(stringResource(R.string.pv8_budget_hint), fontSize = 12.sp, color = c.mutedFg)
    }
}

@Composable
private fun ItemField(value: String, label: String, maxLength: Int, canEdit: Boolean, modifier: Modifier = Modifier,
                      placeholder: String = "", money: Boolean = false, phone: Boolean = false, onSave: (String) -> Unit) {
    if (!canEdit) {
        Column(modifier) { ReadOnly(label, if (money) PipelineFormat.idrFull(PipelineFormat.parseMoney(value) ?: 0.0) else value.ifBlank { "–" }) }
        return
    }
    var draft by remember { mutableStateOf(PipelineFieldDraft(value)) }
    LaunchedEffect(value) { draft = draft.refresh(value) }
    var focused by remember { mutableStateOf(false) }
    val valid = !money || PipelineFormat.parseMoney(draft.text)?.let { it.isFinite() && it in 0.0..1e15 } == true
    fun commit() { if (valid) draft.pending()?.let(onSave) }
    NxTextField(draft.text, { draft = draft.edit(it.take(maxLength)) }, label = { Text(label) }, placeholder = { Text(if (money) "0" else placeholder) },
        prefix = if (money) { { Text("Rp ") } } else null,
        isError = !valid, supportingText = if (!valid) { { Text(stringResource(R.string.pv8_invalid_amount)) } } else null,
        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = when { money -> KeyboardType.Number; phone -> KeyboardType.Phone; else -> KeyboardType.Text }, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }), modifier = modifier.fillMaxWidth().onFocusChanged { if (focused && !it.isFocused) commit(); focused = it.isFocused })
}

private fun itemTitle(kind: String) = when (kind) { "cashback" -> R.string.pv8_cashback; "budget" -> R.string.pv8_budget; else -> R.string.pv8_contacts }

@Composable
internal fun contactRoleLabel(role: String): String = when (role) {
    "Client" -> stringResource(R.string.pv8_role_client)
    "Vendor" -> stringResource(R.string.pv8_role_vendor)
    "Broker" -> stringResource(R.string.pv8_role_broker)
    "PM (client side)" -> stringResource(R.string.pv8_role_pm)
    "Finance" -> stringResource(R.string.pv8_role_finance)
    "Admin" -> stringResource(R.string.pv8_role_admin)
    "Other" -> stringResource(R.string.pv8_role_other)
    else -> role
}

/** Item history keeps names, roles and phones visible; contact snapshots never render an amount. */
@Composable
internal fun ItemHistory(change: PipelineChange, who: String) {
    val kind = change.itemKind ?: return
    val field = change.itemField.orEmpty()
    val title = stringResource(itemTitle(kind))
    val snapshot = (if (field == "deleted") change.before else change.after) as? JsonObject
    val name = change.termLabel?.takeIf(String::isNotBlank) ?: snapshot?.get("name").str()?.takeIf(String::isNotBlank)
    val subject = title + (name?.let { " · $it" } ?: "")
    val c = Nx.colors
    val verb = when (field) { "created" -> R.string.pv8_history_added; "deleted" -> R.string.pv8_history_deleted; "restored" -> R.string.pv8_history_restored; else -> R.string.pl_changed }
    val label = when (field) { "name" -> stringResource(R.string.signup_name); "amount" -> stringResource(R.string.pl_t_amount); "role" -> stringResource(R.string.pv8_contact_role); "phone" -> stringResource(R.string.pv8_phone); else -> null }
    Text("$who ${stringResource(verb)} $subject" + (label?.let { " · $it" } ?: ""), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
    if (field in setOf("created", "deleted", "restored")) {
        if (kind == "contact") {
            val details = listOfNotNull(snapshot?.get("role").str()?.let { contactRoleLabel(it) }, snapshot?.get("phone").str()?.takeIf(String::isNotBlank)).joinToString(" · ")
            if (details.isNotBlank()) Text(details, fontSize = 12.sp, color = c.mutedFg)
        } else PipelinePresentation.itemHistoryAmount(kind, snapshot?.get("amount").num(), LocalPipelinePresentation.current)?.let { Text(it, fontSize = 12.sp, color = c.mutedFg) }
    } else if (!(kind == "contact" && field == "amount")) {
        @Composable fun value(e: kotlinx.serialization.json.JsonElement?): String = when {
            field == "amount" -> PipelinePresentation.itemHistoryAmount(kind, e.num(), LocalPipelinePresentation.current) ?: stringResource(R.string.pl_empty_value)
            field == "role" -> e.str()?.let { contactRoleLabel(it) } ?: stringResource(R.string.pl_empty_value)
            else -> e.str()?.ifBlank { null } ?: stringResource(R.string.pl_empty_value)
        }
        Text("${value(change.before)} → ${value(change.after)}", fontSize = 12.sp, color = c.mutedFg)
    }
}
