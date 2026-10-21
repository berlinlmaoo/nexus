package id.znetworks.nexus.feature.tickets

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.ui.components.NxTextField

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

data class TicketDetailState(
    val ticket: Ticket? = null,
    val corrections: Corrections = Corrections(),
    val loading: Boolean = true,
    val error: String? = null,
    /** 404: gone or a wrong link; 403: someone else's ticket (web 6720b8c). */
    val missing: Boolean = false,
    val notYours: Boolean = false,
    val busy: Boolean = false,
    val notice: String? = null,
)

class TicketDetailViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val id: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    private val api = TicketsApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(TicketDetailState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        try {
            val t = async { api.detail(id) }
            val cr = async { runCatching { api.corrections(id) }.getOrNull() }
            _state.update { it.copy(ticket = t.await(), corrections = cr.await() ?: it.corrections, loading = false, error = null) }
        } catch (e: ApiError) {
            val st = (e as? ApiError.Http)?.status
            _state.update { it.copy(loading = false, error = e.describe(res), missing = st == 404, notYours = st == 403) }
        }
    }

    fun dismiss() = _state.update { it.copy(notice = null) }

    private fun act(fallback: Int, block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try { block() } catch (e: ApiError) {
            val http = e as? ApiError.Http
            // The optimistic lock: the day moved since the proposal; re-sending it would keep failing.
            val msg = if (http?.status == 409 && fallback == R.string.tk_decide_failed) res.getString(R.string.tk_decide_moved)
            else http?.serverMessage ?: res.getString(fallback)
            _state.update { it.copy(notice = msg) }
        }
        _state.update { it.copy(busy = false) }
    }

    fun reply(body: String, onDone: () -> Unit) {
        if (body.trim().length < TicketRules.BODY_MIN) { _state.update { it.copy(notice = res.getString(R.string.tk_reply_min)) }; return }
        act(R.string.tk_reply_failed) { val t = api.reply(id, body); _state.update { it.copy(ticket = t) }; onDone() }
    }

    fun setStatus(s: String) = act(R.string.tk_status_failed) { val t = api.setStatus(id, s); _state.update { it.copy(ticket = t) } }

    fun propose(date: LocalDate, checkIn: String?, checkOut: String?, reason: String, kind: String, onDone: () -> Unit) {
        if (kind == "TIME_CORRECTION" && checkIn == null && checkOut == null) { _state.update { it.copy(notice = res.getString(R.string.tk_set_one_time)) }; return }
        act(R.string.tk_propose_failed) { api.propose(id, date.toString(), checkIn, checkOut, reason, kind); onDone(); load() }
    }

    fun decide(corr: Correction, approve: Boolean, note: String?) = act(R.string.tk_decide_failed) { api.decide(id, corr.id, approve, note); load() }
}

@Composable
fun TicketDetailScreen(onBack: () -> Unit, vm: TicketDetailViewModel = viewModel()) {
    id.znetworks.nexus.core.realtime.LiveRefresh(vm.id, 120_000, 30_000, { id.znetworks.nexus.core.realtime.RealtimeEvents.complaint(it, vm.id) }, refreshOnResume = true, debounceMs = 400) { vm.load().join() }
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var reply by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var proposing by remember { mutableStateOf(false) }
    val t = s.ticket
    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.tk_ticket), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            if (t?.canManage == true) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    TicketRules.SETTABLE.filter { it != t.status }.forEach { st ->
                        DropdownMenuItem(text = { Pill(if (st == "CLOSED") stringResource(R.string.round3_closed_choice) else ticketStatusLabel(st), ticketStatusColor(st)) }, onClick = { menu = false; vm.setStatus(st) })
                    }
                }
            }
        }
        when {
            s.loading && t == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            t == null && s.missing -> EmptyState(Icons.AutoMirrored.Filled.Send, stringResource(R.string.tq_gone), stringResource(R.string.tq_gone_sub), stringResource(R.string.tq_back), onBack, Modifier.fillMaxSize())
            t == null && s.notYours -> EmptyState(Icons.AutoMirrored.Filled.Send, stringResource(R.string.tq_not_yours), stringResource(R.string.tq_not_yours_sub), stringResource(R.string.tq_back), onBack, Modifier.fillMaxSize())
            t == null -> EmptyState(Icons.AutoMirrored.Filled.Send, stringResource(R.string.tk_load_failed), s.error.orEmpty(), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
            else -> {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pill(ticketStatusLabel(t.status), ticketStatusColor(t.status)); Spacer(Modifier.width(6.dp)); Pill(ticketCategoryLabel(t.category), c.mutedFg)
                    }
                    Text(t.subject.ifBlank { stringResource(R.string.tk_no_subject) }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.foreground)
                    Text(listOfNotNull(t.reporter?.name ?: stringResource(R.string.tk_someone), chatTime(t.createdAt)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                    if (t.photos.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        t.photos.forEach { RemoteImage(it, Modifier.size(120.dp).clip(RoundedCornerShape(12.dp)), ContentScale.Crop, maxPx = 600) }
                    }
                    if (TicketRules.canPropose(t)) CorrectionsCard(t, s, vm) { proposing = true }
                    Label(stringResource(R.string.tk_conversation))
                    if (t.messages.isEmpty()) Text(stringResource(R.string.tk_no_replies), fontSize = 13.sp, color = c.mutedFg)
                    t.messages.forEach { m ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start) {
                            Column(Modifier.widthIn(max = 300.dp).background(if (m.mine) c.violet.copy(alpha = 0.12f) else c.card, RoundedCornerShape(14.dp))
                                .border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(10.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (m.fromGideon) { id.znetworks.nexus.ui.components.GideonMark(12.dp, c.violetText); Spacer(Modifier.width(4.dp)) }
                                    Text(if (m.fromGideon) "GIDEON" else m.author?.name ?: stringResource(R.string.tk_someone), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                        color = if (m.fromReviewer || m.fromGideon) c.violetText else c.foreground)
                                    Spacer(Modifier.width(6.dp)); Text(chatTime(m.createdAt), fontSize = 10.sp, color = c.mutedFg)
                                }
                                Text(m.body, fontSize = 14.sp, color = c.foreground)
                            }
                        }
                    }
                }
                if (t.closed) Text(stringResource(R.string.tk_closed_no_replies), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(16.dp))
                else if (t.canReply) Row(Modifier.fillMaxWidth().background(c.card).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    NxTextField(reply, { reply = it.take(TicketRules.BODY_MAX) }, placeholder = { Text(stringResource(R.string.td_write_comment)) }, maxLines = 5, modifier = Modifier.weight(1f))
                    IconButton(onClick = { vm.reply(reply) { reply = "" } }, enabled = reply.isNotBlank() && !s.busy) { Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = c.violetText) }
                }
            }
        }
    }
    s.notice?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
    if (proposing && t != null) ProposeDialog(onDismiss = { proposing = false }) { d, i, o, r, k -> vm.propose(d, i, o, r, k) { proposing = false } }
}

@Composable
private fun CorrectionsCard(t: Ticket, s: TicketDetailState, vm: TicketDetailViewModel, onPropose: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.tk_correction), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        if (s.corrections.corrections.isEmpty()) Text(stringResource(R.string.tk_no_correction), fontSize = 12.sp, color = c.mutedFg)
        s.corrections.corrections.forEach { corr ->
            var note by rememberSaveable(corr.id) { mutableStateOf("") }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(listOfNotNull(stringResource(R.string.tk_attendance_of), corr.user?.name, corr.date).joinToString(" "), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                    Pill(stringResource(when (corr.status) { "APPROVED" -> R.string.tk_approved; "REJECTED" -> R.string.tk_rejected; else -> R.string.tk_pending }),
                        when (corr.status) { "APPROVED" -> c.success; "REJECTED" -> c.danger; else -> c.warning })
                }
                if (corr.kind == "PENALTY_CANCELLATION") {
                    Text(stringResource(R.string.tk_penalty_cancel_desc), fontSize = 12.sp, color = c.mutedFg)
                    Text(listOfNotNull(corr.beforePenaltyXp?.let { stringResource(R.string.tk_xp_cut, it) }, corr.beforeAutoDayOffs?.takeIf { it > 0 }?.let { stringResource(R.string.tk_day_off_taken, it) }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                } else {
                    TimeLine(stringResource(R.string.tk_check_in), TicketRules.hhmm(corr.before?.checkInAt), TicketRules.hhmm(corr.proposedCheckInAt))
                    TimeLine(stringResource(R.string.tk_check_out), TicketRules.hhmm(corr.before?.checkOutAt), TicketRules.hhmm(corr.proposedCheckOutAt))
                    if (corr.before?.recordId == null) Text(stringResource(R.string.tk_no_record_creates), fontSize = 11.sp, color = c.mutedFg)
                }
                corr.reason?.let { Text("“$it”", fontSize = 12.sp, color = c.foreground) }
                corr.proposedBy?.name?.let { Text(stringResource(R.string.tk_proposed_by, it), fontSize = 11.sp, color = c.mutedFg) }
                corr.decidedBy?.name?.let { Text(stringResource(R.string.tk_decided_by, it) + (corr.decisionNote?.let { n -> " · “$n”" } ?: ""), fontSize = 11.sp, color = c.mutedFg) }
                if (corr.status == "PENDING") {
                    if (s.corrections.canDecide) {
                        Text(stringResource(if (corr.kind == "PENALTY_CANCELLATION") R.string.tk_approve_penalty_note else R.string.tk_approve_time_note), fontSize = 11.sp, color = c.mutedFg)
                        NxTextField(note, { note = it }, singleLine = true, placeholder = { Text(stringResource(R.string.tk_decision_note)) }, modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NxOutlinedButton(onClick = { vm.decide(corr, false, note) }, enabled = !s.busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.tk_reject), color = c.danger) }
                            NxOutlinedButton(onClick = { vm.decide(corr, true, note) }, enabled = !s.busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.tk_approve), color = c.success) }
                        }
                    } else Text(stringResource(R.string.tk_waiting_bod), fontSize = 12.sp, color = c.warning)
                }
            }
        }
        // One live proposal at a time (server rule): offered only when none is pending.
        if (!t.closed && s.corrections.corrections.none { it.status == "PENDING" })
            NxOutlinedButton(onClick = onPropose, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.tk_propose)) }
    }
}

@Composable
private fun TimeLine(label: String, before: String, after: String) {
    val c = Nx.colors
    Row {
        Text(label, fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.width(90.dp))
        Text(before.ifBlank { "—" }, fontSize = 12.sp, color = c.mutedFg)
        Text("  →  ", fontSize = 12.sp, color = c.mutedFg)
        Text(after.ifBlank { stringResource(R.string.tk_unchanged) }, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (after.isBlank()) c.mutedFg else c.foreground)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ProposeDialog(onDismiss: () -> Unit, onSend: (LocalDate, String?, String?, String, String) -> Unit) {
    val c = Nx.colors
    var kind by rememberSaveable { mutableStateOf("TIME_CORRECTION") }
    var date by remember { mutableStateOf(OfficeTime.today()) }
    var checkIn by rememberSaveable { mutableStateOf<String?>(null) }
    var checkOut by rememberSaveable { mutableStateOf<String?>(null) }
    var reason by rememberSaveable { mutableStateOf("") }
    var picking by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.tk_propose)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.tk_propose_intro), fontSize = 12.sp, color = c.mutedFg)
                // The web offers both kinds; iOS only the first.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(kind == "TIME_CORRECTION", { kind = "TIME_CORRECTION" }, { Text(stringResource(R.string.tk_kind_time), fontSize = 12.sp) })
                    FilterChip(kind == "PENALTY_CANCELLATION", { kind = "PENALTY_CANCELLATION" }, { Text(stringResource(R.string.tk_kind_penalty), fontSize = 12.sp) })
                }
                Label(stringResource(R.string.tk_date))
                NxOutlinedButton(onClick = { picking = "date" }, modifier = Modifier.fillMaxWidth()) { Text(date.toString()) }
                if (kind == "TIME_CORRECTION") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) { Label(stringResource(R.string.tk_check_in)); NxOutlinedButton(onClick = { picking = "in" }, modifier = Modifier.fillMaxWidth()) { Text(checkIn ?: stringResource(R.string.tk_unchanged)) } }
                        Column(Modifier.weight(1f)) { Label(stringResource(R.string.tk_check_out)); NxOutlinedButton(onClick = { picking = "out" }, modifier = Modifier.fillMaxWidth()) { Text(checkOut ?: stringResource(R.string.tk_unchanged)) } }
                    }
                    if (checkIn != null || checkOut != null) TextButton(onClick = { checkIn = null; checkOut = null }) { Text(stringResource(R.string.tk_keep_times)) }
                } else Text(stringResource(R.string.tk_penalty_cancel_desc), fontSize = 12.sp, color = c.mutedFg)
                Label(stringResource(R.string.tk_reason))
                NxTextField(reason, { reason = it }, minLines = 2, placeholder = { Text(stringResource(R.string.tk_reason_ph)) }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(onClick = { onSend(date, checkIn, checkOut, reason, kind) }, enabled = reason.isNotBlank()) { Text(stringResource(R.string.tk_send_proposal)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
    when (picking) {
        "date" -> {
            val st = rememberDatePickerState(initialSelectedDateMillis = date.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
            DatePickerDialog(onDismissRequest = { picking = null }, confirmButton = {
                TextButton(onClick = { st.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }; picking = null }) { Text("OK") }
            }) { DatePicker(st) }
        }
        "in", "out" -> {
            val cur = (if (picking == "in") checkIn else checkOut) ?: if (picking == "in") "09:00" else "18:00"
            val st = rememberTimePickerState(cur.substringBefore(':').toInt(), cur.substringAfter(':').toInt(), is24Hour = true)
            AlertDialog(onDismissRequest = { picking = null }, text = { TimePicker(st) }, confirmButton = {
                TextButton(onClick = {
                    val v = "%02d:%02d".format(st.hour, st.minute)
                    if (picking == "in") checkIn = v else checkOut = v
                    picking = null
                }) { Text("OK") }
            }, dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } })
        }
    }
}

