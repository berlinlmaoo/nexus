package id.znetworks.nexus.feature.pipeline

import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.runtime.collectAsState
import kotlinx.serialization.json.contentOrNull
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

private fun one(k: String, v: JsonElement) = JsonObject(mapOf(k to v))
private fun str(s: String?) = s?.let(::JsonPrimitive) ?: JsonNull

/**
 * One deal, full screen (the web's drawer; iOS PipelineDealView): the GM's division sections, each field saved
 * when it is left, BD / PM from the board project's members, payment terms, links, who changed it last, its History, Delete.
 */
@Composable
fun DealSheet(deal: PipelineDeal, data: PipelineData, people: List<PipelinePerson>, vm: PipelineViewModel, onOpenProject: (String) -> Unit = {}, onOpenFolder: (String) -> Unit = {}, onClose: () -> Unit) {
    val c = Nx.colors
    var tab by remember { mutableStateOf(0) }
    var confirmDelete by remember { mutableStateOf(false) }
    var laterOpen by remember(deal.id) { mutableStateOf(false) }
    val save = { fields: JsonObject -> vm.update(deal.id, fields) }
    val v = data.vocab
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.close)) }
                // Code + stage chip + health (§14.3).
                Text(deal.code, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) { StageChip(deal.stage) }
                HealthPill(deal.healthKey); Spacer(Modifier.width(8.dp))
            }
            PrimaryTabRow(selectedTabIndex = tab, containerColor = c.background) {
                Tab(tab == 0, { tab = 0 }, text = { Text(stringResource(R.string.pl_details)) })
                Tab(tab == 1, { tab = 1 }, text = { Text(stringResource(R.string.pl_history)) })
            }
            if (tab == 1) { History(vm, deal); return@Column }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                TextSave(stringResource(R.string.pl_f_name), deal.name, big = true) { save(one("name", JsonPrimitive(it))) }
                // The blocker first, then the reasons (minus BLOCKER when the banner says it), then the stepper on every deal (§14.3).
                val blocker = deal.blockerText
                if (blocker != null) BlockerBanner(blocker, deal.healthKey == "CRITICAL")
                deal.reasons.filter { blocker == null || it.code != "BLOCKER" }.forEach { r -> Text("• " + reasonText(r), fontSize = 12.sp, color = healthColor(deal.healthKey)) }
                PhaseStepper(deal)
                Text(stringResource(R.string.pl_saves_on_leave), fontSize = 11.sp, color = c.mutedFg)
                ExecutionBox(deal, vm.state.collectAsState().value.busy, onOpenFolder, onOpenProject) { vm.execution(deal, onOpenFolder, onOpenProject) }
                Group(stringResource(R.string.pl_s_commercial), stringResource(R.string.pl_s_bd)) {
                    TextSave(stringResource(R.string.pl_f_brand), deal.brand) { save(one("brand", JsonPrimitive(it))) }
                    ServicesRow(deal, data) { save(one("services", JsonArray(it.map(::JsonPrimitive)))) }
                    PersonPick(stringResource(R.string.pl_f_bd), deal.bdUserId, deal.bdShown, people, "bd", save)
                    Pick(stringResource(R.string.pl_f_stage), deal.stage, v.stages, label = { stageLabel(it) }) { save(one("stage", JsonPrimitive(it))) }
                    Pick(stringResource(R.string.pl_f_probability), PipelineFormat.pct(deal.probability), v.probabilities.map { PipelineFormat.pct(it) }) { p ->
                        v.probabilities.firstOrNull { PipelineFormat.pct(it) == p }?.let { save(one("probability", JsonPrimitive(it))) } }
                    Money(stringResource(R.string.pl_f_contract_value), deal.contractValue) { save(one("contractValue", JsonPrimitive(it))) }
                    Money(stringResource(R.string.pl_f_net_value), deal.netValue) { save(one("netValue", JsonPrimitive(it))) }
                    DateSave(stringResource(R.string.pl_f_main_date), deal.date("mainDate")) { save(one("mainDate", str(it))) }
                }
                // Open or lost: what Legal, PM and Finance fill in after the win folds under one row (tap opens).
                if (deal.isWon || laterOpen) {
                    Group(stringResource(R.string.pl_ph_contract), "Legal") {
                        Pick(stringResource(R.string.pl_f_contract_status), deal.text("contractStatus"), v.contractStatuses) { save(one("contractStatus", JsonPrimitive(it))) }
                    }
                    Group(stringResource(R.string.pl_f_vreg), "Admin") {
                        Pick(stringResource(R.string.pl_f_vreg), deal.text("vregStatus"), v.vregStatuses) { save(one("vregStatus", JsonPrimitive(it))) }
                    }
                    Group(stringResource(R.string.pl_s_readiness), stringResource(R.string.pl_s_pm)) {
                        PersonPick("PM", deal.pmUserId, deal.pmShown, people, "pm", save)
                        Pick(stringResource(R.string.pl_f_readiness), deal.text("readiness"), v.readiness) { save(one("readiness", JsonPrimitive(it))) }
                        Pick(stringResource(R.string.pl_f_deliv_status), deal.text("deliverableStatus"), v.deliverableStatuses) { save(one("deliverableStatus", JsonPrimitive(it))) }
                        Pick(stringResource(R.string.pl_f_deliv_risk), deal.text("deliverableRisk"), v.deliverableRisks, label = { k -> PipelineText.risk(k)?.let { stringResource(it) } ?: k }) {
                            save(one("deliverableRisk", JsonPrimitive(it))) }
                    }
                    Group(stringResource(R.string.pl_s_billing), "Finance") {
                        Money(stringResource(R.string.pl_f_invoice_value), deal.invoiceValue) { save(one("invoiceValue", JsonPrimitive(it))) }
                        val ts = deal.termSummary
                        if (ts != null) {
                            // With terms these are the terms' (server-computed), read-only (§11.2).
                            ReadOnly(stringResource(R.string.pl_f_payment_status), ts.paymentStatus)
                            ReadOnly(stringResource(R.string.pl_f_receivable), PipelineFormat.idrFull(ts.outstanding))
                            ReadOnly(stringResource(R.string.pl_t_next_due), ts.nextDueDate?.let(::dayLabel) ?: "–")
                            Text(if (deal.daysOverdue > 0) pluralStringResource(R.plurals.pl_days_counted, deal.daysOverdue, deal.daysOverdue)
                                else stringResource(R.string.pl_not_overdue), fontSize = 12.sp, color = if (deal.daysOverdue > 0) c.danger else c.mutedFg)
                            Text(stringResource(R.string.pl_t_from_terms), fontSize = 11.sp, color = c.mutedFg)
                        } else {
                            Pick(stringResource(R.string.pl_f_payment_status), deal.text("paymentStatus"), v.paymentStatuses) { save(one("paymentStatus", JsonPrimitive(it))) }
                            Money(stringResource(R.string.pl_f_receivable), deal.outstandingReceivable) { save(one("outstandingReceivable", JsonPrimitive(it))) }
                            DateSave(stringResource(R.string.pl_f_due_date), deal.date("paymentDueDate")) { save(one("paymentDueDate", str(it))) }
                            // A due date keeps the days true; without one, the GM's typed number.
                            if (deal.date("paymentDueDate") != null) Text(if (deal.daysOverdue > 0) pluralStringResource(R.plurals.pl_days_counted, deal.daysOverdue, deal.daysOverdue)
                                else stringResource(R.string.pl_not_overdue), fontSize = 12.sp, color = if (deal.daysOverdue > 0) c.danger else c.mutedFg)
                            else TextSave(stringResource(R.string.pl_f_days_typed), deal.maxDaysOverdue.toString(), number = true) { t ->
                                t.trim().toIntOrNull()?.takeIf { it >= 0 }?.let { save(one("maxDaysOverdue", JsonPrimitive(it))) } }
                        }
                        Money(stringResource(R.string.pl_f_net_cash), deal.netCash, allowNegative = true) { save(one("netCash", JsonPrimitive(it))) }
                    }
                    Group(stringResource(R.string.pl_t_terms), "Finance") { PaymentTerms(deal, vm) }
                    // Real cost & margin (Control Tower v4, 14 Oct 2026), after billing and its terms; read-only for Can comment / Can view.
                    Group(stringResource(R.string.pc_title), "Finance") { RealCost(deal, data.canEdit) { edit -> vm.editCosts(deal.id, edit) } }
                    Group(stringResource(R.string.pl_ph_closing), "Finance") {
                        Pick(stringResource(R.string.pl_f_closing_status), deal.text("closingStatus"), v.closingStatuses) { save(one("closingStatus", JsonPrimitive(it))) }
                    }
                } else Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
                    .clickable { laterOpen = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.pl_fold), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                        Text(stringResource(R.string.pl_fold_note), fontSize = 12.sp, color = c.mutedFg)
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                }
                Group(stringResource(R.string.pl_s_followup), stringResource(R.string.pl_s_every)) {
                    TextSave(stringResource(R.string.pl_f_next_action), deal.text("nextAction")) { save(one("nextAction", JsonPrimitive(it))) }
                    DateSave(stringResource(R.string.pl_f_next_date), deal.date("nextActionDate")) { save(one("nextActionDate", str(it))) }
                    TextSave(stringResource(R.string.pl_f_blocker), deal.text("blocker"), multiline = true) { save(one("blocker", JsonPrimitive(it))) }
                    TextSave(stringResource(R.string.pl_f_notes), deal.text("notes"), multiline = true) { save(one("notes", JsonPrimitive(it))) }
                }
                Group(stringResource(R.string.pl_f_links), null) { Documents(deal, v.linkTypes, vm) { save(one("links", JsonArray(it.map(PipelineLink::json)))) } }
                val who = deal.updatedBy?.name
                deal.updatedAt?.let { at -> Text(if (who != null) stringResource(R.string.pl_last_by, who, stamp(at)) else stringResource(R.string.pl_last, stamp(at)), fontSize = 11.sp, color = c.mutedFg) }
                TextButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, null, tint = c.dangerText); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.pl_delete), color = c.dangerText) }
            }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.pl_delete_q, deal.name.ifBlank { stringResource(R.string.pl_untitled) })) },
        text = { Text(stringResource(R.string.pl_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(deal) }) { Text(stringResource(R.string.pl_delete), color = c.dangerText, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
}

/**
 * "Phase progress": six rows, each a mark (done = green check, active = amber ring, bad = red "!", pending = grey
 * ring) on a connector line (green under a done phase), the phase name, its detail line (red when bad), and under the
 * phase the blocker holds up, the blocker in red.
 */
@Composable
private fun PhaseStepper(deal: PipelineDeal) {
    val c = Nx.colors
    val phases = deal.progressPhases
    if (phases.isEmpty()) return
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp)) {
        Text(stringResource(R.string.pl_phase_progress), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        Spacer(Modifier.height(8.dp))
        phases.forEachIndexed { i, p ->
            val col = phaseColor(p.state)
            Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
                Column(Modifier.width(24.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(20.dp).then(when (p.state) {
                        "done", "bad" -> Modifier.background(col, CircleShape)
                        else -> Modifier.border(2.dp, if (p.state == "active") c.warning else c.border, CircleShape)
                    }), contentAlignment = Alignment.Center) {
                        when (p.state) {
                            "done" -> Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(13.dp))
                            "bad" -> Text("!", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        }
                    }
                    if (i < phases.lastIndex) Box(Modifier.width(2.dp).weight(1f).background(if (p.state == "done") c.success else c.border))
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f).padding(bottom = if (i < phases.lastIndex) 12.dp else 0.dp)) {
                    Text(PipelineText.phase(p.key)?.let { stringResource(it) } ?: p.key, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text(phaseDetailText(deal, p.key), fontSize = 12.sp, color = if (p.state == "bad") c.danger else c.mutedFg)
                    if (p.blocked) deal.blockerText?.let { b ->
                        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(top = 2.dp)) {
                            Icon(Icons.Filled.Warning, null, tint = c.danger, modifier = Modifier.size(13.dp).padding(top = 1.dp)); Spacer(Modifier.width(4.dp))
                            Text(b, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
                        }
                    }
                }
            }
        }
    }
}

/** "9 Okt 2026" for a yyyy-MM-dd day. */
internal fun dayLabel(iso: String): String =
    runCatching { java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", java.util.Locale.getDefault()).format(LocalDate.parse(iso.take(10))) }.getOrDefault(iso)

/** A value the server works out: shown, not edited. */
@Composable
internal fun ReadOnly(label: String, value: String) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
    }
}

/** "9 Okt 2026, 15:35" in Jakarta time. */
internal fun stamp(iso: String?): String = iso?.let { runCatching {
    java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", java.util.Locale.getDefault()).format(Instant.parse(it).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE))
}.getOrNull() }.orEmpty()

@Composable
internal fun Group(title: String, who: String?, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
            who?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
        }
        content()
    }
}

/** Saved when the field is left (or Done), only if it changed. */
@Composable
internal fun TextSave(label: String, value: String, big: Boolean = false, multiline: Boolean = false, number: Boolean = false, onSave: (String) -> Unit) {
    var t by remember(value) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    fun commit() { if (t != value) onSave(t) }
    OutlinedTextField(t, { t = it }, label = { Text(label) }, singleLine = !multiline, minLines = if (multiline) 2 else 1, maxLines = if (multiline) 6 else 1,
        textStyle = androidx.compose.material3.LocalTextStyle.current.let { if (big) it.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp) else it },
        keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Number else KeyboardType.Text, imeAction = if (multiline) ImeAction.Default else ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        modifier = Modifier.fillMaxWidth().onFocusChanged { f -> if (focused && !f.isFocused) commit(); focused = f.isFocused })
}

/** Rupiah: typed with any grouping, saved as a plain number; a negative only where allowed (net cash). */
@Composable
internal fun Money(label: String, value: Double, allowNegative: Boolean = false, onSave: (Double) -> Unit) {
    TextSave(label, if (value == 0.0) "" else PipelineFormat.idrFull(value).removePrefix("Rp").removePrefix("-Rp").let { if (value < 0) "-$it" else it }, number = !allowNegative) { t ->
        PipelineFormat.parseMoney(t)?.takeIf { allowNegative || it >= 0 }?.let(onSave)
    }
}

@Composable
internal fun Pick(title: String, current: String, options: List<String>, label: (@Composable (String) -> String)? = null, onPick: (String) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open = true }) {
                // An option this build doesn't know is shown as stored.
                Text(if (current.isBlank()) "–" else label?.invoke(current) ?: current, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(150.dp))
                Icon(Icons.Filled.KeyboardArrowDown, null)
            }
            DropdownMenu(open, { open = false }) {
                options.forEach { o -> DropdownMenuItem(text = { Text(label?.invoke(o) ?: o) }, onClick = { open = false; if (o != current) onPick(o) }) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DateSave(label: String, iso: String?, onSave: (String?) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = { open = true }) {
            Text(iso?.let { runCatching { java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", java.util.Locale.getDefault()).format(LocalDate.parse(it)) }.getOrNull() } ?: "–")
        }
    }
    if (open) {
        val st = rememberDatePickerState(initialSelectedDateMillis = iso?.let { runCatching { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull() })
        DatePickerDialog(onDismissRequest = { open = false }, confirmButton = {
            TextButton(onClick = { open = false; st.selectedDateMillis?.let { onSave(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) } }) { Text("OK") }
        }, dismissButton = { TextButton(onClick = { open = false; if (iso != null) onSave(null) }) { Text(stringResource(R.string.td_clear_date)) } }) { DatePicker(st) }
    }
}

/** BD or PM: a member of the board project, nobody, or someone outside NEXUS by name (a user id wins over the text). */
@Composable
private fun PersonPick(label: String, userId: String?, shown: String?, people: List<PipelinePerson>, role: String, save: (JsonObject) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    var typing by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open = true }) {
                // Set earlier, before the lead added them (or since removed): the server still keeps them.
                val member = userId == null || people.isEmpty() || people.any { it.id == userId }
                Text((shown ?: stringResource(R.string.pl_not_assigned)) + if (!member) " " + stringResource(R.string.pl_not_member) else "", maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.width(150.dp))
                Icon(Icons.Filled.KeyboardArrowDown, null)
            }
            DropdownMenu(open, { open = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.pl_not_assigned)) }, onClick = { open = false; save(JsonObject(mapOf("${role}UserId" to JsonNull, "${role}Name" to JsonNull))) })
                people.sortedBy { (it.name ?: "").lowercase() }.forEach { p ->
                    DropdownMenuItem(text = { Text(p.name ?: "–") }, onClick = { open = false; save(JsonObject(mapOf("${role}UserId" to JsonPrimitive(p.id), "${role}Name" to JsonNull))) })
                }
                DropdownMenuItem(text = { Text(stringResource(R.string.pl_outside)) }, onClick = { open = false; typing = true })
            }
        }
    }
    if (typing) {
        var name by remember { mutableStateOf(if (userId == null) shown.orEmpty() else "") }
        AlertDialog(onDismissRequest = { typing = false }, title = { Text(stringResource(R.string.pl_name_of, label)) },
            text = { OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text(stringResource(R.string.pl_their_name)) }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { typing = false; save(JsonObject(mapOf("${role}UserId" to JsonNull, "${role}Name" to JsonPrimitive(name.trim())))) }, enabled = name.isNotBlank()) {
                Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { typing = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

/** Who changed what, newest first: "Bagas changed Stage: Incoming → Negosiasi". */
@Composable
private fun History(vm: PipelineViewModel, deal: PipelineDeal) {
    val c = Nx.colors
    var list by remember(deal.id) { mutableStateOf<List<PipelineChange>?>(null) }
    var failed by remember(deal.id) { mutableStateOf(false) }
    LaunchedEffect(deal.id, deal.updatedAt) { try { list = vm.api.deal(vm.projectId, deal.id).second } catch (e: ApiError) { failed = true } }
    val l = list
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            failed && l == null -> Text(stringResource(R.string.pl_history_failed), fontSize = 13.sp, color = c.mutedFg)
            l == null -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else -> {
                l.forEach { ch ->
                    val who = ch.user?.name ?: stringResource(R.string.pl_someone)
                    val tf = ch.termField
                    val term = ch.termLabel?.takeIf { it.isNotBlank() } ?: stringResource(R.string.pl_t_term)
                    Column {
                        when {
                            // A document attached or removed (§13.1): "<who> attached SPK · <name>".
                            tf == null && (ch.field == "document.added" || ch.field == "document.removed") -> {
                                val e = PipelineChange.doc(if (ch.field == "document.added") ch.after else ch.before)
                                val what = e?.let { (PipelineText.link(it.type)?.let { r -> stringResource(r) } ?: it.type) + " · " + it.shownName } ?: stringResource(R.string.pl_doc_a)
                                Text(stringResource(if (ch.field == "document.added") R.string.pl_doc_h_added else R.string.pl_doc_h_removed, who, what),
                                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            }
                            tf == null -> {
                                val field = PipelineText.field(ch.field)?.let { stringResource(it) } ?: ch.field
                                Text("$who ${stringResource(R.string.pl_changed)} $field", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                val costs = ch.field == "costs"
                                Text("${if (costs) costsShown(ch.before) else shown(ch.before)} → ${if (costs) costsShown(ch.after) else shown(ch.after)}",
                                    fontSize = 12.sp, color = c.mutedFg, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                            // A payment term (§11.2): added / deleted / restored with its amount, or one of its fields.
                            tf == "created" || tf == "deleted" || tf == "restored" -> {
                                Text(stringResource(when (tf) { "created" -> R.string.pl_t_h_added; "deleted" -> R.string.pl_t_h_deleted; else -> R.string.pl_t_h_restored }, who, term),
                                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                ((if (tf == "deleted") ch.before else ch.after) as? JsonObject)?.get("amount").num()?.let {
                                    Text(PipelineFormat.idrFull(it), fontSize = 12.sp, color = c.mutedFg) }
                            }
                            else -> {
                                val field = PipelineText.termField(tf.orEmpty())?.let { stringResource(it) } ?: tf.orEmpty()
                                val money = tf == "amount" || tf == "paidAmount"
                                Text("$who ${stringResource(R.string.pl_changed)} $term · $field", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                Text("${shown(ch.before, money)} → ${shown(ch.after, money)}", fontSize = 12.sp, color = c.mutedFg, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        Text(stamp(ch.createdAt), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
                deal.createdAt?.let { at ->
                    Text(deal.createdBy?.name?.let { stringResource(R.string.pl_created_by, it, stamp(at)) } ?: stringResource(R.string.pl_created, stamp(at)), fontSize = 12.sp, color = c.mutedFg)
                }
            }
        }
    }
}

@Composable
private fun shown(e: JsonElement?, money: Boolean = false): String = when {
    e == null || e is JsonNull -> stringResource(R.string.pl_empty_value)
    money && e.num() != null -> PipelineFormat.idrFull(e.num()!!)
    e is JsonPrimitive && e.isString -> e.content.ifBlank { stringResource(R.string.pl_empty_value) }.let { PipelineText.stage(it)?.let { r -> stringResource(r) } ?: it }
    e is JsonPrimitive -> e.content
    // Services (§13.2) are words: "a, b, c"; a list of objects (links) is counted.
    e is JsonArray && e.all { it is JsonPrimitive } -> e.joinToString(", ") { (it as JsonPrimitive).content }.ifBlank { stringResource(R.string.pl_empty_value) }
    e is JsonArray -> e.size.toString()
    else -> e.toString()
}

/**
 * Won → execution, by hand (§15, owner 10 Oct: nothing is made when a deal reaches Won). Three states: the
 * folder with its Master Calendar / Master Task shortcuts; a 9 Oct deal's lone project; or, on a won deal,
 * "Create execution project", which makes the folder and opens it.
 */
@Composable
private fun ExecutionBox(deal: PipelineDeal, busy: Boolean, onOpenFolder: (String) -> Unit, onOpenProject: (String) -> Unit, onCreate: () -> Unit) {
    val c = Nx.colors
    val folder = deal.executionFolderId
    val project = deal.executionProjectId ?: deal.executionCalendarProjectId
    if (folder == null && project == null && !deal.isWon) return
    Column(Modifier.fillMaxWidth().background(c.accentBg, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        when {
            folder != null -> {
                TextButton(onClick = { onOpenFolder(folder) }) {
                    Icon(Icons.Filled.Folder, null, Modifier.size(18.dp), tint = c.violetText); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.pl_open_exec_folder), color = c.violetText, fontWeight = FontWeight.SemiBold)
                        deal.executionFolderName?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 1) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    deal.executionCalendarProjectId?.let { id -> ExecShortcut("Master Calendar", Icons.Filled.CalendarMonth) { onOpenProject(id) } }
                    deal.executionProjectId?.let { id -> ExecShortcut("Master Task", Icons.Filled.Checklist) { onOpenProject(id) } }
                }
            }
            project != null -> TextButton(onClick = { onOpenProject(project) }) {
                val name = deal.executionProjectName ?: (deal.raw["executionCalendarProject"] as? kotlinx.serialization.json.JsonObject)?.get("name")?.let { (it as? JsonPrimitive)?.contentOrNull }
                Text(stringResource(R.string.pl_open_exec) + (name?.let { " · $it" } ?: ""), color = c.violetText, fontWeight = FontWeight.SemiBold)
            }
            else -> {
                TextButton(onClick = onCreate, enabled = !busy) {
                    if (busy) { CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                    Text(stringResource(R.string.pl_make_exec), color = c.violetText, fontWeight = FontWeight.SemiBold)
                }
                Text(stringResource(R.string.pl_exec_note), fontSize = 11.sp, color = c.mutedFg)
            }
        }
    }
}

/** One of the execution folder's two projects, opened straight from the deal. The names are not translated. */
@Composable
private fun ExecShortcut(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.clip(RoundedCornerShape(10.dp)).background(c.violet.copy(alpha = 0.06f)).clickable(onClick = onClick)
        .heightIn(min = 44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(16.dp), tint = c.violetText); Spacer(Modifier.width(6.dp))
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1)
    }
}
