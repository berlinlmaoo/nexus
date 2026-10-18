package id.znetworks.nexus.feature.outlet

import android.app.Application
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
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
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth

/** The four Outlet Sales tabs (§7); the project screen maps them to its tab bar. */
enum class OutletView { OVERVIEW, CALENDAR, BOARD, FORM }

data class OutletState(
    val data: OutletMonth? = null,
    /** "YYYY-MM" shown; null until the server says which month "this month" is. */
    val month: String? = null,
    val loading: Boolean = true,
    /** 403: the outlet is for its project members. */
    val forbidden: Boolean = false,
    val error: String? = null,
    val busy: Boolean = false,
    /** A line to toast once. */
    val notice: String? = null,
    /** The calendar's chosen day, "YYYY-MM-DD". */
    val day: String? = null,
    /** The form's event (null = a new one) and a new event's date. */
    val formEventId: String? = null,
    val formDate: String? = null,
    /** Bumped to make the form re-read its event (picked from elsewhere). */
    val formTick: Int = 0,
)

class OutletViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    val api = OutletApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(OutletState())
    val state = _state.asStateFlow()

    init { load() }

    /** A reload keeps what is on screen; only a first load says it failed. */
    fun load() = viewModelScope.launch {
        try {
            val d = api.month(projectId, _state.value.month)
            _state.update { s -> s.copy(data = d, month = d.month, loading = false, error = null, forbidden = false, day = s.day?.takeIf { it.startsWith(d.month) } ?: defaultDay(d)) }
        } catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(loading = false, forbidden = h?.status == 403, error = if (it.data == null) e.describe(res) else null) }
        }
    }

    /** Today when it is in the month, else the month's first event, else the 1st. */
    private fun defaultDay(d: OutletMonth): String =
        d.today?.takeIf { it.startsWith(d.month) } ?: d.events.firstOrNull()?.date ?: "${d.month}-01"

    fun setMonth(ym: String) {
        if (ym == _state.value.month) return
        _state.update { it.copy(month = ym, day = null) }
        load()
    }

    fun shiftMonth(by: Long) = _state.value.month?.let { runCatching { YearMonth.parse(it) }.getOrNull() }?.let { setMonth(it.plusMonths(by).toString()) }
    fun thisMonth() = _state.value.data?.today?.take(7)?.let(::setMonth)

    fun pickDay(iso: String) {
        if (!iso.startsWith(_state.value.month.orEmpty())) { _state.update { it.copy(month = iso.take(7), day = iso) }; load() }
        else _state.update { it.copy(day = iso) }
    }

    /** Open the form on [eventId] (null = new, on [date]). */
    fun openForm(eventId: String?, date: String? = null) = _state.update { it.copy(formEventId = eventId, formDate = date, formTick = it.formTick + 1) }

    fun saveTarget(sales: Double?, pax: Double?, onDone: () -> Unit) = viewModelScope.launch {
        val m = _state.value.month ?: return@launch
        _state.update { it.copy(busy = true) }
        try { api.setTarget(projectId, m, sales, pax); onDone(); load() }
        catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(notice = if (h?.code == "TARGETS_FORBIDDEN") res.getString(R.string.os_targets_forbidden) else e.describe(res)) }
        }
        _state.update { it.copy(busy = false) }
    }

    /** A new event (all filled boxes) or only what changed on an existing one; [onSaved] gets the event back. */
    private val createRequests = mutableMapOf<String, String>()
    fun save(eventId: String?, fields: kotlinx.serialization.json.JsonObject, onSaved: (OutletEvent) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            // A no-op PATCH returns the event and writes no audit row, so an unchanged save is harmless.
            val e = if (eventId == null) {
                val key = fields.toString()
                val id = createRequests.getOrPut(key) { java.util.UUID.randomUUID().toString() }
                api.create(projectId, kotlinx.serialization.json.JsonObject(fields + ("clientRequestId" to kotlinx.serialization.json.JsonPrimitive(id)))).also { createRequests.remove(key) }
            } else api.update(projectId, eventId, fields)
            _state.update { it.copy(notice = when {
                e.isReported -> res.getString(R.string.os_saved_reported, e.name)
                eventId == null -> res.getString(R.string.os_saved_new, e.name)
                else -> res.getString(R.string.os_saved)
            }, month = e.date.take(7), day = e.date, formEventId = e.id) }
            onSaved(e)
            load()
        } catch (e: ApiError) {
            _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res)) }
        }
        _state.update { it.copy(busy = false) }
    }

    fun delete(e: OutletEvent, onDone: () -> Unit = {}) = viewModelScope.launch {
        try {
            api.delete(projectId, e.id)
            _state.update { it.copy(notice = res.getString(R.string.os_deleted, e.name), formEventId = if (it.formEventId == e.id) null else it.formEventId, formTick = it.formTick + 1) }
            onDone(); load()
        } catch (x: ApiError) { _state.update { it.copy(notice = x.describe(res)) } }
    }

    fun noticeShown() = _state.update { it.copy(notice = null) }
}

/** One Outlet Sales tab of the project screen; all four share the month and the chosen day. */
@Composable
fun OutletTab(view: OutletView, goTo: (OutletView) -> Unit, vm: OutletViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    // A ping on the project room: refetch whatever month is shown (an event may have moved between months).
    LiveRefresh(vm.projectId, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == RealtimeEvents.OUTLET_SALES_CHANGED && (it.projectId == null || it.projectId == vm.projectId) }) { vm.load().join() }
    LaunchedEffect(s.notice) { s.notice?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show(); vm.noticeShown() } }
    var detail by remember { mutableStateOf<OutletEvent?>(null) }
    val d = s.data
    val addEvent = { date: String? -> vm.openForm(null, date ?: d?.today?.takeIf { it.startsWith(s.month.orEmpty()) } ?: s.day); goTo(OutletView.FORM) }
    val fill = { e: OutletEvent -> detail = null; vm.openForm(e.id); goTo(OutletView.FORM) }
    when {
        s.loading && d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        s.forbidden && d == null -> EmptyState(Icons.Filled.Lock, stringResource(R.string.os_forbidden), stringResource(R.string.os_forbidden_sub),
            stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        d == null -> EmptyState(Icons.Filled.Storefront, stringResource(R.string.os_load_failed), s.error.orEmpty(), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        else -> Column(Modifier.fillMaxSize()) {
            if (view != OutletView.FORM) MonthBar(d, vm, onAdd = { addEvent(if (view == OutletView.CALENDAR) s.day else null) })
            when (view) {
                OutletView.OVERVIEW -> Overview(d, vm, s.busy, onOpen = { detail = it }, onFill = fill, onAdd = { addEvent(null) })
                OutletView.CALENDAR -> Calendar(d, s.day, vm, onFill = fill, onAdd = { addEvent(it) })
                OutletView.BOARD -> Board(d, onOpen = { detail = it }, onAdd = { addEvent(null) })
                OutletView.FORM -> OutletReportForm(d, s, vm, onSaved = { goTo(OutletView.CALENDAR) })
            }
        }
    }
    detail?.let { e -> EventSheet(e, d?.form ?: OutletForm.DEFAULT, d?.today, onFill = { fill(e) }, onClose = { detail = null }) }
}

/** ‹ Oktober 2026 › (+ This month), Copy form link, Add event — shared by Overview, Calendar and Board. */
@Composable
private fun MonthBar(d: OutletMonth, vm: OutletViewModel, onAdd: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { vm.shiftMonth(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.os_prev_month)) }
        Text(OutletFormat.monthLabel(d.month), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, maxLines = 1)
        IconButton(onClick = { vm.shiftMonth(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.os_next_month)) }
        if (d.today != null && !d.today!!.startsWith(d.month)) TextButton(onClick = vm::thisMonth) { Text(stringResource(R.string.os_this_month), fontSize = 12.sp) }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = { copyFormLink(context, vm.projectId, null) }) { Icon(Icons.Filled.Link, stringResource(R.string.os_copy_link), tint = c.mutedFg) }
        Button(onClick = onAdd, colors = ButtonDefaults.buttonColors(containerColor = c.violet), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
            Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.os_add_event), fontSize = 13.sp)
        }
    }
}

/** NEXUS link to the form (§8): it needs a login and project access; there is no public form. */
internal fun copyFormLink(context: android.content.Context, projectId: String, eventId: String?) {
    val url = id.znetworks.nexus.core.net.NexusConfig.base + "/projects/$projectId?view=form" + (eventId?.let { "&event=$it" } ?: "")
    val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    cm.setPrimaryClip(android.content.ClipData.newPlainText("NEXUS", url))
    Toast.makeText(context, context.getString(R.string.os_link_copied), Toast.LENGTH_LONG).show()
}

@Composable
internal fun statusColor(status: String): Color = when (status) {
    OutletStatus.REPORTED -> Nx.colors.success
    OutletStatus.WAITING -> Nx.colors.warning
    else -> Nx.colors.blue
}

@Composable
internal fun statusLabel(status: String) = stringResource(when (status) {
    OutletStatus.REPORTED -> R.string.os_st_reported
    OutletStatus.WAITING -> R.string.os_st_waiting
    else -> R.string.os_st_upcoming
})

@Composable
internal fun StatusPill(status: String) {
    val tone = statusColor(status)
    Row(Modifier.background(tone.copy(alpha = 0.14f), CircleShape).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).background(tone, CircleShape)); Spacer(Modifier.width(5.dp))
        Text(statusLabel(status), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = tone, maxLines = 1)
    }
}

@Composable
private fun missingText(e: OutletEvent): String? = when {
    "sales" in e.missing && "pax" in e.missing -> stringResource(R.string.os_missing_both)
    "sales" in e.missing -> stringResource(R.string.os_missing_sales)
    "pax" in e.missing -> stringResource(R.string.os_missing_pax)
    else -> null
}

private fun year(d: OutletMonth) = OutletFormat.parseDate(d.today)?.year ?: LocalDate.now().year

// region Overview

@Composable
private fun Overview(d: OutletMonth, vm: OutletViewModel, busy: Boolean, onOpen: (OutletEvent) -> Unit, onFill: (OutletEvent) -> Unit, onAdd: () -> Unit) {
    val c = Nx.colors
    val s = d.summary
    val monthName = OutletFormat.monthLabel(d.month)
    var editing by rememberSaveable(d.month) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BoxWithConstraints {
            val wide = maxWidth >= 600.dp
            val sales = @Composable { m: Modifier -> TotalCard(stringResource(R.string.os_sales_of, monthName), stringResource(R.string.os_sales_hint), s.sales, s.salesTarget, s.salesPct, true, m) }
            val pax = @Composable { m: Modifier -> TotalCard(stringResource(R.string.os_pax_of, monthName), stringResource(R.string.os_pax_hint), s.pax, s.paxTarget, s.paxPct, false, m) }
            if (wide) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { sales(Modifier.weight(1f)); pax(Modifier.weight(1f)) }
            else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { sales(Modifier.fillMaxWidth()); pax(Modifier.fillMaxWidth()) }
        }
        // Who set the target, or that there is none; managers change it here.
        val t = d.target
        val hasTarget = t != null && (t.salesTarget != null || t.paxTarget != null)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(when {
                hasTarget && t?.updatedBy?.name != null -> stringResource(R.string.os_target_by, t.updatedBy!!.name!!)
                hasTarget -> ""
                else -> stringResource(R.string.os_no_target_month, monthName) + if (!d.canManageTargets) " " + stringResource(R.string.os_target_who) else ""
            }, fontSize = 12.sp, color = c.mutedFg)
            if (d.canManageTargets && !editing) TextButton(onClick = { editing = true }) { Text(stringResource(if (hasTarget) R.string.os_change_target else R.string.os_set_target)) }
        }
        if (editing) TargetEditor(d, monthName, busy, onCancel = { editing = false }) { sales, pax -> vm.saveTarget(sales, pax) { editing = false } }
        // Events · Reported · Waiting report · RSVP · Hosting
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat(stringResource(R.string.os_stat_events), "${s.eventCount}")
            Stat(stringResource(R.string.os_st_reported), "${s.reportedCount}")
            Stat(stringResource(R.string.os_st_waiting), "${s.waitingCount}")
            Stat("RSVP", OutletFormat.count(s.rsvpTotal))
            Stat("Hosting", OutletFormat.count(s.hostingTotal))
        }
        val waiting = d.allWaiting
        if (waiting.isNotEmpty()) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.warning.copy(alpha = 0.12f))
            .border(1.dp, c.warning.copy(alpha = 0.4f), RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(pluralStringResource(R.plurals.os_waiting_nights, waiting.size, waiting.size), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = c.foreground)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                waiting.forEach { e ->
                    Text("${OutletFormat.shortDay(e.date, year(d))} ${e.name}", fontSize = 12.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clip(CircleShape).background(c.card).clickable { onFill(e) }.padding(horizontal = 10.dp, vertical = 5.dp))
                }
            }
        }
        Text(stringResource(R.string.os_events_in, monthName), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        if (d.events.isEmpty()) EmptyState(Icons.Filled.Storefront, stringResource(R.string.os_no_events), stringResource(R.string.os_no_events_sub),
            stringResource(R.string.os_add_event), onAdd)
        d.events.forEach { e -> EventRow(e, year(d)) { onOpen(e) } }
    }
}

@Composable
private fun TotalCard(title: String, hint: String, actual: Double, target: Double?, pct: Int?, money: Boolean, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = c.foreground)
        Text(hint, fontSize = 11.sp, color = c.mutedFg)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val f: (Double?) -> String = { if (money) OutletFormat.money(it) else OutletFormat.count(it) }
            Text("${f(actual)} / ${target?.let(f) ?: "—"}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground,
                modifier = Modifier.weight(1f, fill = false))
            if (pct != null) {
                Spacer(Modifier.width(8.dp))
                val tone = if (pct >= 100) c.success else c.violetText
                Text("$pct%", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = tone, modifier = Modifier.background(tone.copy(alpha = 0.14f), CircleShape).padding(horizontal = 8.dp, vertical = 2.dp))
            }
        }
        if (pct != null) LinearProgressIndicator(progress = { (pct / 100f).coerceIn(0f, 1f) }, color = if (pct >= 100) c.success else c.violet, trackColor = c.muted,
            modifier = Modifier.fillMaxWidth().height(7.dp).clip(CircleShape))
        else Text(stringResource(R.string.os_no_target), fontSize = 11.sp, color = c.mutedFg)
    }
}

@Composable
private fun TargetEditor(d: OutletMonth, monthName: String, busy: Boolean, onCancel: () -> Unit, onSave: (Double?, Double?) -> Unit) {
    val c = Nx.colors
    var sales by rememberSaveable(d.month) { mutableStateOf(OutletFormat.box(d.target?.salesTarget)) }
    var pax by rememberSaveable(d.month) { mutableStateOf(OutletFormat.box(d.target?.paxTarget)) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        NumberBox(stringResource(R.string.os_sales_target_for, monthName), sales, money = true) { sales = it }
        NumberBox(stringResource(R.string.os_pax_target_for, monthName), pax, money = false) { pax = it }
        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.cancel)) }
            // An empty box is no target (PUT null).
            TextButton(onClick = { onSave(OutletFormat.parseNumber(sales), OutletFormat.parseNumber(pax)) }, enabled = !busy) { Text(stringResource(R.string.os_save_target)) }
        }
    }
}

/** A money / count box that groups thousands as you type and keeps only digits. */
@Composable
internal fun NumberBox(label: String, value: String, money: Boolean, hint: String? = null, modifier: Modifier = Modifier.fillMaxWidth(), onChange: (String) -> Unit) {
    OutlinedTextField(value, { t -> onChange(OutletFormat.box(OutletFormat.parseNumber(t))) }, singleLine = true, label = { Text(label) },
        prefix = if (money) ({ Text("Rp") }) else null,
        supportingText = hint?.let { { Text(it, fontSize = 11.sp) } },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number), modifier = modifier)
}

@Composable
private fun Stat(label: String, value: String) {
    val c = Nx.colors
    Column(Modifier.clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.5f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(value, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
        Text(label, fontSize = 10.sp, color = c.mutedFg)
    }
}

@Composable
private fun EventRow(e: OutletEvent, thisYear: Int, onClick: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(OutletFormat.shortDay(e.date, thisYear), fontSize = 12.sp, color = c.mutedFg); Spacer(Modifier.width(8.dp))
            Text(e.name, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            StatusPill(e.status)
        }
        Row {
            Text(OutletFormat.vsTarget(e.sales, e.salesTarget, money = true, pct = e.salesPct), fontSize = 12.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.os_n_pax, OutletFormat.count(e.pax)), fontSize = 12.sp, color = c.mutedFg)
        }
    }
}

// endregion

// region Calendar

@Composable
private fun Calendar(d: OutletMonth, day: String?, vm: OutletViewModel, onFill: (OutletEvent) -> Unit, onAdd: (String) -> Unit) {
    val c = Nx.colors
    val ym = runCatching { YearMonth.parse(d.month) }.getOrNull() ?: return
    val byDay = d.events.groupBy { it.date }
    val selected = day ?: "${d.month}-01"
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BoxWithConstraints {
            val wide = maxWidth >= 600.dp
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row {
                    WEEKDAYS(OutletFormat.isId()).forEach { w -> Text(w, fontSize = 11.sp, color = c.mutedFg, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 4.dp)) }
                }
                OutletFormat.grid(ym).chunked(7).forEach { week ->
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        week.forEach { date ->
                            val iso = date.toString()
                            val inMonth = YearMonth.from(date) == ym
                            val isToday = iso == d.today
                            val on = iso == selected
                            val evs = if (inMonth) byDay[iso].orEmpty() else emptyList()
                            Column(Modifier.weight(1f).then(if (wide) Modifier.height(78.dp) else Modifier.aspectRatio(0.85f)).clip(RoundedCornerShape(10.dp))
                                .background(if (on) c.accentBg else Color.Transparent).border(if (on) 1.5.dp else 0.dp, if (on) c.violet else Color.Transparent, RoundedCornerShape(10.dp))
                                .clickable { vm.pickDay(iso) }.padding(4.dp)) {
                                Box(Modifier.size(22.dp).background(if (isToday) c.violet else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) {
                                    Text("${date.dayOfMonth}", fontSize = 12.sp, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                                        color = when { isToday -> Color.White; inMonth -> c.foreground; else -> c.mutedFg.copy(alpha = 0.5f) })
                                }
                                if (wide) {
                                    evs.take(2).forEach { e ->
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Box(Modifier.size(6.dp).background(statusColor(e.status), CircleShape)); Spacer(Modifier.width(3.dp))
                                            Text(e.name, fontSize = 10.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                    if (evs.size > 2) Text(stringResource(R.string.os_n_more, evs.size - 2), fontSize = 10.sp, color = c.mutedFg)
                                } else if (evs.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(top = 2.dp, start = 2.dp)) {
                                    evs.take(3).forEach { e -> Box(Modifier.size(6.dp).background(statusColor(e.status), CircleShape)) }
                                }
                            }
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = c.border)
        Text(OutletFormat.longDay(selected, year(d)), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
        TextButton(onClick = { onAdd(selected) }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.os_add_on_day)) }
        val today = byDay[selected].orEmpty()
        if (today.isEmpty()) Text(stringResource(R.string.os_no_event_day), fontSize = 13.sp, color = c.mutedFg)
        today.forEach { e -> EventCard(e, d.form, d.today) { onFill(e) } }
    }
}

private fun WEEKDAYS(id: Boolean) = if (id) listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min") else listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

// endregion

// region Board

@Composable
private fun Board(d: OutletMonth, onOpen: (OutletEvent) -> Unit, onAdd: () -> Unit) {
    val c = Nx.colors
    val upcoming = d.events.filter { it.status == OutletStatus.UPCOMING }
    val waiting = d.allWaiting
    val reported = d.events.filter { it.status == OutletStatus.REPORTED }
    if (upcoming.isEmpty() && waiting.isEmpty() && reported.isEmpty()) {
        EmptyState(Icons.Filled.Storefront, stringResource(R.string.os_no_events), stringResource(R.string.os_no_events_sub), stringResource(R.string.os_add_event), onAdd, Modifier.fillMaxSize())
        return
    }
    // No drag: a card moves by itself when its night passes or its report is complete. Stacked on a phone.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 720.dp
        val cols = listOf(
            Triple(OutletStatus.UPCOMING, upcoming, R.string.os_empty_upcoming),
            Triple(OutletStatus.WAITING, waiting, R.string.os_empty_waiting),
            Triple(OutletStatus.REPORTED, reported, R.string.os_empty_reported),
        )
        val column = @Composable { st: String, list: List<OutletEvent>, empty: Int, m: Modifier ->
            Column(m.clip(RoundedCornerShape(16.dp)).background(c.muted.copy(alpha = 0.4f)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(statusColor(st), CircleShape)); Spacer(Modifier.width(6.dp))
                    Text(statusLabel(st), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                    Text("${list.size}", fontSize = 12.sp, color = c.mutedFg)
                }
                if (list.isEmpty()) Text(stringResource(empty), fontSize = 12.sp, color = c.mutedFg)
                list.forEach { e -> BoardCard(e, year(d)) { onOpen(e) } }
            }
        }
        if (wide) Row(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            cols.forEach { (st, l, e) -> column(st, l, e, Modifier.weight(1f)) }
        } else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            cols.forEach { (st, l, e) -> column(st, l, e, Modifier.fillMaxWidth()) }
        }
    }
}

@Composable
private fun BoardCard(e: OutletEvent, thisYear: Int, onClick: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(OutletFormat.shortDay(e.date, thisYear), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
            if (e.status == OutletStatus.WAITING) missingText(e)?.let {
                Text(it, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.warning, maxLines = 1,
                    modifier = Modifier.background(c.warning.copy(alpha = 0.14f), CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
            }
        }
        Text(e.name, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("Sales: " + OutletFormat.vsTarget(e.sales, e.salesTarget, money = true, pct = e.salesPct), fontSize = 12.sp, color = c.foreground)
        Text("Pax: " + OutletFormat.vsTarget(e.pax, e.paxTarget, money = false, pct = e.paxPct), fontSize = 12.sp, color = c.foreground)
    }
}

// endregion

// region Event detail (the outlet team's list, in order)

/** The detail card: status + Fill/Edit, then the outlet team's rows in their order, labels from the form. */
@Composable
internal fun EventCard(e: OutletEvent, form: OutletForm, today: String?, onFill: () -> Unit) {
    val c = Nx.colors
    val id = OutletFormat.isId()
    val thisYear = OutletFormat.parseDate(today)?.year ?: LocalDate.now().year
    fun label(k: String, en: String) = form.field(k)?.label?.pick(id) ?: en
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusPill(e.status); Spacer(Modifier.weight(1f))
            TextButton(onClick = onFill) { Text(stringResource(if (e.isReported) R.string.os_edit_report else R.string.os_fill_report)) }
        }
        DetailRow(label("name", "Event name"), e.name)
        DetailRow(label("date", "Day/Date"), OutletFormat.longDay(e.date, thisYear))
        DetailRow(label("sales", "Sales"), OutletFormat.vsTarget(e.sales, e.salesTarget, money = true, pct = e.salesPct))
        DetailRow(label("pax", "Pax"), OutletFormat.vsTarget(e.pax, e.paxTarget, money = false, pct = e.paxPct))
        form.sections.filter { it.total != null }.forEach { sec ->
            DetailRow(sec.title.pick(id), OutletFormat.count(e.number(sec.total!!)), strong = true)
            sec.fields.forEach { f -> DetailRow(f.label.pick(id), OutletFormat.count(e.number(f.key)), indent = true) }
        }
        form.sections.filter { sec -> sec.fields.all { it.type == "longtext" } }.forEach { sec ->
            Text(sec.title.pick(id), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.foreground, modifier = Modifier.padding(top = 4.dp))
            sec.fields.forEach { f ->
                Text(f.label.pick(id), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(start = 12.dp))
                val v = e.text(f.key)
                Text(v.ifBlank { stringResource(R.string.os_not_filled) }, fontSize = 13.sp, color = if (v.isBlank()) c.mutedFg else c.foreground, modifier = Modifier.padding(start = 12.dp))
            }
        }
        val reported = e.reportedBy?.name?.let { n -> stringResource(R.string.os_reported_by, n) + (OutletFormat.stamp(e.reportedAt)?.let { " · $it" } ?: "") }
        val changed = e.updatedBy?.name?.let { n -> stringResource(R.string.os_changed_by, n) + (OutletFormat.stamp(e.updatedAt)?.let { " · $it" } ?: "") }
        (reported ?: changed)?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(top = 4.dp)) }
    }
}

@Composable
private fun DetailRow(label: String, value: String, strong: Boolean = false, indent: Boolean = false) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(start = if (indent) 12.dp else 0.dp), verticalAlignment = Alignment.Top) {
        Text(label, fontSize = 13.sp, color = if (indent) c.mutedFg else c.foreground, fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(value, fontSize = 13.sp, color = c.foreground, fontWeight = if (strong) FontWeight.Bold else FontWeight.SemiBold)
    }
}

/** An event's detail from Overview / Board: a centred dialog (the app keeps bottom sheets out of these screens). */
@Composable
private fun EventSheet(e: OutletEvent, form: OutletForm, today: String?, onFill: () -> Unit, onClose: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth().padding(16.dp).clip(RoundedCornerShape(20.dp)).background(Nx.colors.background).verticalScroll(rememberScrollState()).padding(8.dp)) {
            EventCard(e, form, today, onFill)
            TextButton(onClick = onClose, modifier = Modifier.align(Alignment.End)) { Text(stringResource(R.string.close)) }
        }
    }
}

// endregion
