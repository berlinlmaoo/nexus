package id.znetworks.nexus.feature.attendance.history

import android.app.Application
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Route
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.requests.AttachmentChip
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

data class BoardState(
    val offset: Int = 0,
    val rows: List<HistoryRow> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val selected: HistoryRow? = null,
    val trailFor: HistoryRow? = null,
    val trail: TrailResponse? = null,
    val trailError: String? = null,
    val busy: Boolean = false,
    val message: String? = null,
)

class BoardViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = HistoryApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(BoardState())
    val state = _state.asStateFlow()

    var today: AttendanceToday? = null
        private set
    val wide get() = today?.canManageAttendance == true || today?.canReviewAttendanceRequests == true
    val canManage get() = today?.canManageAttendance == true
    private var loadedWide: Boolean? = null

    fun onToday(t: AttendanceToday?) {
        today = t
        if (t != null && loadedWide != wide) { loadedWide = wide; load() }
    }

    fun shift(delta: Int) {
        _state.update { it.copy(offset = (it.offset + delta).coerceAtMost(0)) }
        load()
    }

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true, error = null) }
        val period = BoardModel.periodKey(_state.value.offset)
        try {
            val rows = api.history(if (wide) "workspace" else "me", period)
            _state.update { it.copy(rows = rows, loading = false) }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(res)) }
        }
    }

    fun select(r: HistoryRow?) = _state.update { it.copy(selected = r) }

    fun openTrail(r: HistoryRow) {
        _state.update { it.copy(trailFor = r, trail = null, trailError = null) }
        val id = r.id ?: return
        viewModelScope.launch {
            try {
                val t = api.trail(id)
                _state.update { it.copy(trail = t) }
            } catch (e: ApiError) {
                _state.update { it.copy(trailError = e.describe(res)) }
            }
        }
    }

    fun closeTrail() = _state.update { it.copy(trailFor = null, trail = null) }

    fun deleteRecord(r: HistoryRow, checkoutOnly: Boolean) {
        val id = r.id ?: return
        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                api.deleteRecord(id, checkoutOnly)
                _state.update { it.copy(busy = false, selected = null, message = res.getString(if (checkoutOnly) R.string.board_checkout_cleared else R.string.board_record_deleted)) }
                load()
            } catch (e: ApiError) {
                _state.update { it.copy(busy = false, message = e.describe(res)) }
            }
        }
    }

    fun dismissMessage() = _state.update { it.copy(message = null) }

    /** The month as xlsx, shared through the system sheet (managers). */
    fun export(onFile: (File) -> Unit) {
        val period = BoardModel.periodKey(_state.value.offset)
        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                val bytes = api.exportXlsx(period)
                val file = withContext(Dispatchers.IO) {
                    File(File(getApplication<Application>().cacheDir, "shared").apply { mkdirs() }, "absensi-$period.xlsx").apply { writeBytes(bytes) }
                }
                _state.update { it.copy(busy = false) }
                onFile(file)
            } catch (e: ApiError) {
                _state.update { it.copy(busy = false, message = e.describe(res)) }
            }
        }
    }
}

@Composable
fun toneColor(t: AttTone): Color = when (t) {
    AttTone.PRESENT, AttTone.PERMIT -> Color(0xFF34D399).copy(alpha = 0.75f)
    AttTone.WFH -> Nx.colors.blue.copy(alpha = 0.5f)
    AttTone.LEAVE -> Color(0xFFFCD34D).copy(alpha = 0.85f)
    AttTone.SICK -> Color(0xFFFB923C).copy(alpha = 0.85f)
    AttTone.DAYOFF -> Color(0xFFA78BFA).copy(alpha = 0.75f)
    AttTone.ABSENT -> Color(0xFFF43F5E).copy(alpha = 0.8f)
    AttTone.NONE -> Nx.colors.muted
}

@Composable
private fun toneLabel(t: AttTone): String = stringResource(
    when (t) {
        AttTone.PRESENT -> R.string.tone_present
        AttTone.PERMIT -> R.string.req_permit
        AttTone.WFH -> R.string.tone_wfh
        AttTone.LEAVE -> R.string.req_leave
        AttTone.SICK -> R.string.req_sick
        AttTone.DAYOFF -> R.string.tone_dayoff
        AttTone.ABSENT -> R.string.tone_absent
        AttTone.NONE -> R.string.tone_none
    },
)

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
private fun hhmm(iso: String?) = iso?.let { runCatching { HHMM.format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull() } ?: "--:--"

/** Crew streak board (iOS `StreakBoardCard`): the 28→27 period, scrolled to today. */
@Composable
fun CrewBoardCard(vm: BoardViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    val period = BoardModel.periodKey(s.offset)
    val days = remember(period) { BoardModel.days(period) }
    val today = OfficeTime.today()
    val session = (context.applicationContext as NexusApplication).container.sessionStore.current
    val members = remember(s.rows) { BoardModel.members(s.rows, vm.today?.viewerId ?: session?.userId, session?.userName.orEmpty()) }
    var full by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(24.dp)).border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(if (vm.wide) R.string.board_title else R.string.board_title_me), fontFamily = DisplayFont,
                    fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
                Text("${DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()).format(days.first())} – " +
                    DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(days.last()), fontSize = 11.sp, color = c.mutedFg)
            }
            IconButton(onClick = { vm.shift(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
            IconButton(onClick = { vm.shift(1) }, enabled = s.offset < 0) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) }
            if (members.size > 1) IconButton(onClick = { full = true }) { Icon(Icons.Filled.GridView, stringResource(R.string.board_full)) }
            if (vm.wide) IconButton(onClick = { vm.export { shareFile(context, it) } }, enabled = !s.busy) { Icon(Icons.Filled.Download, stringResource(R.string.board_export)) }
        }
        when {
            s.loading && s.rows.isEmpty() -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            s.error != null && s.rows.isEmpty() -> EmptyState(Icons.Filled.GridView, stringResource(R.string.board_load_failed), s.error!!,
                stringResource(R.string.try_again), { vm.load() })
            members.isEmpty() -> EmptyState(Icons.Filled.GridView, stringResource(R.string.board_empty), stringResource(R.string.board_empty_sub),
                stringResource(R.string.previous_period), { vm.shift(-1) })
            else -> Grid(members, days, today, onCell = vm::select, compact = true)
        }
        Legend()
    }

    if (full) {
        Dialog(onDismissRequest = { full = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding().padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.board_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                    IconButton(onClick = { full = false }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                }
                Column(Modifier.verticalScroll(rememberScrollState())) { Grid(members, days, today, onCell = { full = false; vm.select(it) }, compact = false); Legend() }
            }
        }
    }
    s.selected?.let { DayDetail(vm, it) }
    s.trailFor?.let { TrailDialog(vm, it, s.trail, s.trailError) }
    s.message?.let { msg ->
        AlertDialog(onDismissRequest = vm::dismissMessage, text = { Text(msg) }, confirmButton = { TextButton(onClick = vm::dismissMessage) { Text("OK") } })
    }
}

@Composable
private fun Grid(members: List<BoardMember>, days: List<LocalDate>, today: LocalDate, onCell: (HistoryRow) -> Unit, compact: Boolean) {
    val c = Nx.colors
    val cell = if (compact) 22.dp else 26.dp
    val scroll = rememberScrollState()
    val density = androidx.compose.ui.platform.LocalDensity.current
    // Opens on today, not on the 28th of last month.
    LaunchedEffect(days) {
        val idx = days.indexOf(today)
        if (idx > 3) with(density) { scroll.scrollTo(((cell + 3.dp) * (idx - 3)).roundToPx()) }
    }
    Row {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Spacer(Modifier.height(cell))
            members.forEach { m ->
                Box(Modifier.height(cell).width(if (compact) 72.dp else 96.dp), contentAlignment = Alignment.CenterStart) {
                    Text(m.name, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.foreground)
                }
            }
        }
        Column(Modifier.horizontalScroll(scroll), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                days.forEach { d ->
                    Box(Modifier.size(cell), contentAlignment = Alignment.Center) {
                        Text("${d.dayOfMonth}", fontSize = 10.sp, fontWeight = if (d == today) FontWeight.Bold else FontWeight.Normal,
                            color = if (d == today) c.violetText else c.mutedFg)
                    }
                }
            }
            members.forEach { m ->
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    days.forEach { d ->
                        val key = d.toString()
                        val row = m.rows[key]
                        Box(
                            Modifier.size(cell).background(toneColor(m.cells[key] ?: AttTone.NONE), RoundedCornerShape(5.dp))
                                .then(if (d == today) Modifier.border(1.5.dp, c.violet, RoundedCornerShape(5.dp)) else Modifier)
                                .then(if (row != null) Modifier.clickable { onCell(row) } else Modifier),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Legend() {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(AttTone.PRESENT, AttTone.SICK, AttTone.DAYOFF, AttTone.LEAVE, AttTone.ABSENT).forEach { t ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(toneColor(t), RoundedCornerShape(3.dp)))
                Spacer(Modifier.size(4.dp))
                Text(if (t == AttTone.PRESENT) stringResource(R.string.tone_present_permit) else toneLabel(t), fontSize = 10.sp, color = Nx.colors.mutedFg)
            }
        }
    }
}

/** One day: status, times, place, selfies, evidence, correction, and the trail (iOS day detail). */
@Composable
private fun DayDetail(vm: BoardViewModel, r: HistoryRow) {
    val c = Nx.colors
    var confirm by remember { mutableStateOf<Boolean?>(null) } // true = check-out only, false = whole record
    Dialog(onDismissRequest = { vm.select(null) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding()) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.select(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                Column(Modifier.weight(1f)) {
                    Text(r.user?.name.orEmpty(), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(runCatching { DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.getDefault()).format(LocalDate.parse(r.dayKey)) }.getOrDefault(r.dayKey),
                        fontSize = 12.sp, color = c.mutedFg)
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val tone = AttTone.of(r)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(14.dp).background(toneColor(tone), CircleShape))
                    Spacer(Modifier.size(8.dp))
                    Text(listOfNotNull(toneLabel(tone).takeIf { it.isNotEmpty() }, r.status?.lowercase()?.replaceFirstChar(Char::titlecase)).joinToString(" · "),
                        fontWeight = FontWeight.SemiBold)
                }
                if (r.isRecord) {
                    Fact(stringResource(R.string.detail_times), "IN ${hhmm(r.checkInAt)} · OUT ${hhmm(r.checkOutAt)}" +
                        (r.lateMinutes?.takeIf { it > 0 }?.let { " · " + stringResource(R.string.detail_late, it) } ?: ""))
                    r.workedMinutes?.let { Fact(stringResource(R.string.detail_worked), "${it / 60}h ${it % 60}m") }
                    if (r.effectiveShiftStartTime != null) Fact(stringResource(R.string.my_schedule), "${r.effectiveShiftStartTime} – ${r.effectiveShiftEndTime}")
                    r.officeLocation?.name?.let { Fact(stringResource(R.string.metric_office), it) }
                    r.checkInAddress?.let { Fact(stringResource(R.string.detail_in_place), it + (r.checkInDistanceMeters?.let { d -> " · ±${d.toInt()} m" } ?: "")) }
                    r.checkOutAddress?.let { Fact(stringResource(R.string.detail_out_place), it + (r.checkOutDistanceMeters?.let { d -> " · ±${d.toInt()} m" } ?: "")) }
                    if (r.checkOutOffsite == true) Fact(stringResource(R.string.offsite_checkout), listOfNotNull(r.checkOutApproval, r.checkOutReason).joinToString(" · "))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        r.checkInPhotoUrl?.let { Selfie(it, "IN", Modifier.weight(1f)) }
                        r.checkOutPhotoUrl?.let { Selfie(it, "OUT", Modifier.weight(1f)) }
                    }
                    r.checkOutReflection?.takeIf { it.isNotBlank() }?.let { Fact(stringResource(R.string.reflection_title), it) }
                    if (r.isCorrected == true) Fact(stringResource(R.string.detail_corrected), r.correctionReason.orEmpty())
                    if (r.locationTrackingState == "denied") Text(stringResource(R.string.trail_location_off), color = c.warning, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    OutlinedButton(onClick = { vm.openTrail(r) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Route, null, Modifier.size(18.dp)); Spacer(Modifier.size(6.dp)); Text(stringResource(R.string.trail_open))
                    }
                } else {
                    r.requestType?.let { Fact(stringResource(R.string.req_type), it + (r.requestStatus?.let { s -> " · $s" } ?: "")) }
                    r.reviewedBy?.name?.let { Fact(stringResource(R.string.detail_approver), it) }
                    r.supportingDocumentUrl?.let { AttachmentChip(it, r.supportingDocumentName, r.requestType) }
                }
                // BoD record actions, confirmed and audited server-side.
                if (vm.canManage && r.isRecord) {
                    Spacer(Modifier.height(8.dp))
                    if (r.checkOutAt != null) TextButton(onClick = { confirm = true }) { Text(stringResource(R.string.board_clear_checkout), color = c.danger) }
                    TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.board_delete_record), color = c.danger) }
                }
            }
        }
    }
    confirm?.let { checkoutOnly ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(if (checkoutOnly) R.string.board_clear_checkout else R.string.board_delete_record)) },
            text = { Text(stringResource(if (checkoutOnly) R.string.board_clear_checkout_body else R.string.board_delete_record_body)) },
            confirmButton = { TextButton(onClick = { confirm = null; vm.deleteRecord(r, checkoutOnly) }) { Text(stringResource(R.string.confirm), color = Nx.colors.danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Column {
        Text(label.uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Nx.colors.mutedFg, letterSpacing = 1.sp)
        Text(value, fontSize = 14.sp, color = Nx.colors.foreground)
    }
}

/** A selfie from `/api/files/attendance/…`, fetched with the session. */
@Composable
private fun Selfie(path: String, label: String, modifier: Modifier) {
    val context = LocalContext.current
    val api = (context.applicationContext as NexusApplication).container.api
    var img by remember(path) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(path) {
        img = withContext(Dispatchers.IO) { runCatching { api.bytes(path).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull() }
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().height(180.dp).background(Nx.colors.muted, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
            val i = img
            if (i != null) Image(i, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Nx.colors.mutedFg)
    }
}

/** Where somebody went between check-in and check-out (iOS `LocationTrailView`). */
@Composable
private fun TrailDialog(vm: BoardViewModel, r: HistoryRow, trail: TrailResponse?, error: String?) {
    val c = Nx.colors
    Dialog(onDismissRequest = vm::closeTrail, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding()) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = vm::closeTrail) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                Text(stringResource(R.string.trail_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            when {
                error != null && trail == null -> EmptyState(Icons.Filled.Route, stringResource(R.string.trail_load_failed), error, stringResource(R.string.try_again), { vm.openTrail(r) })
                trail == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> {
                    val office = trail.record?.office
                    val points = trail.points
                    // Hourly checks inside the office are not movement: faint dots, off the line.
                    val insideChecks = points.filter { it.event == "presence" && it.inside == true }
                    val linePoints = points.filterNot { it.event == "presence" && it.inside == true }
                    OsmMap(
                        Modifier.fillMaxWidth().height(320.dp),
                        circle = office?.let { MapCircle(it.lat, it.lng, it.radiusMeters ?: 100.0) },
                        path = linePoints.map { it.lat to it.lng },
                        dots = insideChecks.map { it.lat to it.lng },
                        pins = points.filter { it.event == "exit" || it.event == "enter" }.map {
                            MapPin(it.lat, it.lng, "${if (it.event == "exit") "↗" else "↘"} ${hhmm(it.at)}")
                        },
                    )
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if ((trail.record?.locationTrackingState ?: r.locationTrackingState) == "denied") {
                            Text(stringResource(R.string.trail_location_off), color = c.warning, fontWeight = FontWeight.SemiBold)
                        }
                        if (trail.presence.isNotEmpty()) PresenceCard(trail.presence)
                        if (points.isEmpty() && trail.outsideSpans.isEmpty()) {
                            // Inside all day, or nothing recorded: say which it can be.
                            EmptyState(Icons.Filled.Route, stringResource(R.string.trail_empty), stringResource(R.string.trail_empty_sub),
                                stringResource(R.string.try_again), { vm.openTrail(r) })
                        }
                        trail.outsideSpans.forEach { sp ->
                            val mins = sp.to?.let { runCatching { (Instant.parse(it).epochSecond - Instant.parse(sp.from).epochSecond) / 60 }.getOrNull() }
                            Text(stringResource(R.string.trail_span, hhmm(sp.from), sp.to?.let { hhmm(it) } ?: stringResource(R.string.trail_still_out),
                                mins?.let { "${it / 60}h ${it % 60}m" } ?: "…"), fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

/** "Presence checks": one chip per clock hour (iOS 64b1bfb, web LocationTrail.tsx). */
@Composable
private fun PresenceCard(hours: List<PresenceHour>) {
    val c = Nx.colors
    val decided = hours.filter { it.status != "pending" }
    val atOffice = decided.count { it.status == "inside" }
    Column(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(20.dp)).border(1.dp, c.border, RoundedCornerShape(20.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.presence_checks).uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold,
            color = c.mutedFg, letterSpacing = 1.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            hours.forEach { h ->
                val (glyph, fg, bg) = when (h.status) {
                    "inside" -> Triple("✓", Color.White, c.success)
                    "outside" -> Triple("✗", Color.White, Color(0xFFF97316))
                    "pending" -> Triple("…", c.mutedFg, Color.Transparent)
                    "gap" -> Triple("–", c.mutedFg, Color.Transparent)
                    else -> Triple("?", c.mutedFg, c.mutedFg.copy(alpha = 0.15f))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(26.dp).background(bg, CircleShape).border(1.dp, c.border, CircleShape), contentAlignment = Alignment.Center) {
                        Text(glyph, color = fg, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                    Text(h.label ?: hhmm(h.from).take(2), fontSize = 10.sp, color = c.mutedFg, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (decided.isNotEmpty()) {
            Text(stringResource(R.string.presence_hours_at_office, atOffice, decided.size), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
        Text(stringResource(R.string.presence_legend), fontSize = 11.sp, color = c.mutedFg)
    }
}

private fun shareFile(context: android.content.Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    runCatching {
        context.startActivity(Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null,
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
