package id.znetworks.nexus.feature.attendance.history

import android.app.Application
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.scrollable
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
import id.znetworks.nexus.feature.attendance.AttendancePlace
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.requests.AttachmentChip
import id.znetworks.nexus.feature.attendance.requests.PersonRef
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
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
    /** The period [rows] and [roster] belong to: another period's rows are never drawn (audit T6). */
    val rowsPeriod: String? = null,
    /** Everyone who belongs on the board, rows or not (scope=workspace). */
    val roster: List<id.znetworks.nexus.feature.attendance.requests.PersonRef> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val selected: HistoryRow? = null,
    val trailFor: HistoryRow? = null,
    val trail: TrailResponse? = null,
    val trailError: String? = null,
    val busy: Boolean = false,
    val message: String? = null,
    /** The override just applied (shown in the day sheet), and the multi-day warning. */
    val overrideDone: String? = null,
    val multiDayLeft: Int? = null,
    val overrideError: String? = null,
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

    private var loadJob: Job? = null

    /** The latest request wins: a slower answer for the period left behind is cancelled, not drawn. */
    fun load() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            val period = BoardModel.periodKey(_state.value.offset)
            try {
                val r = api.history(if (wide) "workspace" else "me", period)
                _state.update { it.copy(rows = r.records, roster = r.roster, rowsPeriod = period, loading = false) }
            } catch (e: ApiError) {
                _state.update { it.copy(loading = false, error = e.describe(res)) }
            }
        }
    }

    fun select(r: HistoryRow?) = _state.update { it.copy(selected = r, overrideDone = null, overrideError = null) }

    /**
     * A tapped board cell. Returns whether a day sheet opened. Everyone opens days that have a row;
     * the BoD also opens empty past days up to today (to change their status), never future ones,
     * and never the unnamed "me" group.
     */
    fun selectCell(m: BoardMember, day: LocalDate): Boolean {
        val row = m.rows[day.toString()]
        if (row != null) { select(row); return true }
        if (!canManage || day.isAfter(OfficeTime.today()) || m.id == "me") return false
        select(HistoryRow(attendanceDate = "${day}T00:00:00.000Z", user = PersonRef(id = m.id, name = m.name)))
        return true
    }

    fun applyOverride(r: HistoryRow, action: String, doneText: (OverrideResponse) -> String) {
        val uid = r.user?.id ?: return
        _state.update { it.copy(busy = true, overrideError = null, overrideDone = null) }
        viewModelScope.launch {
            try {
                val res = api.override(uid, r.dayKey, action)
                _state.update { it.copy(busy = false, overrideDone = doneText(res), multiDayLeft = res.multiDayRequestsLeft?.takeIf { n -> n > 0 }) }
                load()
            } catch (e: ApiError) {
                _state.update { it.copy(busy = false, overrideError = e.describe(res)) }
            }
        }
    }

    fun clearOverrideNotes() = _state.update { it.copy(overrideDone = null, overrideError = null, multiDayLeft = null) }

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
    // Only this period's rows: while another period's are still in the state they are not shown.
    val rows = BoardModel.rowsFor(period, s.rowsPeriod, s.rows)
    val roster = if (s.rowsPeriod == period) s.roster else emptyList()
    val members = remember(rows, roster) { BoardModel.members(rows, vm.today?.viewerId ?: session?.userId, session?.userName.orEmpty(), roster) }
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
            s.loading && rows.isEmpty() -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            s.error != null && rows.isEmpty() -> EmptyState(Icons.Filled.GridView, stringResource(R.string.board_load_failed), s.error!!,
                stringResource(R.string.try_again), { vm.load() })
            members.isEmpty() -> EmptyState(Icons.Filled.GridView, stringResource(R.string.board_empty), stringResource(R.string.board_empty_sub),
                stringResource(R.string.previous_period), { vm.shift(-1) })
            else -> Grid(members, days, today, onCell = { m, d -> vm.selectCell(m, d) }, compact = true)
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
                // The grid scrolls vertically under its own pinned header; the legend stays below.
                Grid(members, days, today, onCell = { m, d -> if (vm.selectCell(m, d)) full = false }, compact = false,
                    modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.height(8.dp))
                Legend()
            }
        }
    }
    s.selected?.let { DayDetail(vm, it) }
    s.trailFor?.let { TrailDialog(vm, it, s.trail, s.trailError) }
    s.message?.let { msg ->
        AlertDialog(onDismissRequest = vm::dismissMessage, text = { Text(msg) }, confirmButton = { TextButton(onClick = vm::dismissMessage) { Text("OK") } })
    }
}

/**
 * Freeze panes, as on the web board and iOS a9ca4f4: the date row (weekday abbreviation above the
 * day number) stays on top, names stay left, Score stays right; only the day cells scroll sideways,
 * all rows together. Today is highlighted.
 */
@Composable
private fun Grid(
    members: List<BoardMember>,
    days: List<LocalDate>,
    today: LocalDate,
    onCell: (BoardMember, LocalDate) -> Unit,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    val c = Nx.colors
    val cell = if (compact) 22.dp else 26.dp
    val gap = 3.dp
    val nameW = if (compact) 72.dp else 96.dp
    val scoreW = if (compact) 52.dp else 60.dp
    val hScroll = rememberScrollState()
    val vScroll = rememberScrollState()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    val weekday = remember(locale) { DateTimeFormatter.ofPattern("EEE", locale) }
    // Opens on today, not on the 28th of last month.
    LaunchedEffect(days) {
        val idx = days.indexOf(today)
        if (idx > 3) with(density) { hScroll.scrollTo(((cell + gap) * (idx - 3)).roundToPx()) }
    }
    // A drag anywhere on the board moves it (iOS 91d7e98): over the names or the Score column it
    // still scrolls the days sideways, and over the date row it still scrolls the rows. The day
    // cells' own scrollers take their drags first; these catch what lands outside them.
    val layout = androidx.compose.ui.platform.LocalLayoutDirection.current
    val rev = { o: androidx.compose.foundation.gestures.Orientation -> androidx.compose.foundation.gestures.ScrollableDefaults.reverseDirection(layout, o, false) }
    val whole = modifier
        .scrollable(hScroll, androidx.compose.foundation.gestures.Orientation.Horizontal, reverseDirection = rev(androidx.compose.foundation.gestures.Orientation.Horizontal))
        .then(if (compact) Modifier else Modifier.scrollable(vScroll, androidx.compose.foundation.gestures.Orientation.Vertical,
            reverseDirection = rev(androidx.compose.foundation.gestures.Orientation.Vertical)))
    // Rows are a plain Column, never a lazy list: every row is always drawn (iOS 91d7e98 had
    // empty rows from a lazy container inside a two-way scroll).
    Column(whole) {
        // Pinned header row.
        Row(verticalAlignment = Alignment.Bottom) {
            Spacer(Modifier.width(nameW))
            Row(Modifier.weight(1f).horizontalScroll(hScroll), horizontalArrangement = Arrangement.spacedBy(gap)) {
                days.forEach { d ->
                    val isToday = d == today
                    Column(
                        Modifier.width(cell).background(if (isToday) c.accentBg else Color.Transparent, RoundedCornerShape(5.dp)),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(weekday.format(d).uppercase(locale).take(3), fontSize = 7.sp, maxLines = 1,
                            color = if (isToday) c.violetText else c.mutedFg, fontWeight = FontWeight.SemiBold)
                        Text("${d.dayOfMonth}", fontSize = 10.sp, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                            color = if (isToday) c.violetText else c.mutedFg)
                    }
                }
            }
            Text(stringResource(R.string.board_score), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg,
                modifier = Modifier.width(scoreW).padding(start = 4.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
        }
        Spacer(Modifier.height(gap))
        val body = if (compact) Modifier else Modifier.weight(1f, fill = false).verticalScroll(vScroll)
        Column(body, verticalArrangement = Arrangement.spacedBy(gap)) {
            val periodDays = days.size
            members.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.height(cell).width(nameW), contentAlignment = Alignment.CenterStart) {
                        Text(m.name, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.foreground)
                    }
                    Row(Modifier.weight(1f).horizontalScroll(hScroll), horizontalArrangement = Arrangement.spacedBy(gap)) {
                        days.forEach { d ->
                            val key = d.toString()
                            Box(
                                Modifier.size(cell).background(toneColor(m.cells[key] ?: AttTone.NONE), RoundedCornerShape(5.dp))
                                    .then(if (d == today) Modifier.border(1.5.dp, c.violet, RoundedCornerShape(5.dp)) else Modifier)
                                    .clickable { onCell(m, d) },
                            )
                        }
                    }
                    val score = BoardModel.score(m.worked, periodDays, m.quota)
                    Row(Modifier.width(scoreW).padding(start = 4.dp), horizontalArrangement = Arrangement.End) {
                        Text(score.text, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1)
                        if (score.surplus > 0) Text(" +${score.surplus}", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.success, maxLines = 1)
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
                    // Away day (location-free, outside the radius): the address, never the office.
                    if (r.checkedInAway == true) Fact(stringResource(R.string.away_from_office),
                        AttendancePlace.label(true, r.checkInAddress, r.checkInLat, r.checkInLng, null) ?: "—")
                    else r.officeLocation?.name?.let { Fact(stringResource(R.string.metric_office), it) }
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
                } else if (r.recordKind == null && r.requestType == null && r.attendanceDayType == null) {
                    Text(stringResource(R.string.board_nothing_recorded), color = c.mutedFg)
                } else {
                    r.requestType?.let { Fact(stringResource(R.string.req_type), it + (r.requestStatus?.let { s -> " · $s" } ?: "")) }
                    r.reviewedBy?.name?.let { Fact(stringResource(R.string.detail_approver), it) }
                    r.supportingDocumentUrl?.let { AttachmentChip(it, r.supportingDocumentName, r.requestType) }
                }
                if (vm.canManage && r.user?.id != null) ChangeStatusPanel(vm, r)
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

private val OVERRIDE_ACTIONS = listOf("PRESENT", "PERMIT", "LEAVE", "SICK", "DAY_OFF")

@Composable
private fun overrideLabel(action: String) = stringResource(
    when (action) {
        "PRESENT" -> R.string.tone_present
        "PERMIT" -> R.string.req_permit
        "LEAVE" -> R.string.req_leave
        "SICK" -> R.string.req_sick
        "DAY_OFF" -> R.string.tone_dayoff
        else -> R.string.override_clear_penalty
    },
)

/** The exact consequence of each action, said before it happens (iOS overrideConsequence). */
@Composable
private fun overrideConsequence(action: String): String {
    val restored = stringResource(R.string.override_restored_too)
    return when (action) {
        "CLEAR_PENALTY" -> stringResource(R.string.override_clear_consequence)
        "PRESENT" -> stringResource(R.string.override_present_consequence) + " " + restored
        "PERMIT" -> stringResource(R.string.override_permit_consequence) + " " + restored
        else -> stringResource(R.string.override_absence_consequence) + " " + restored
    }
}

/** BoD "Change status" (web StatusOverridePanel, iOS 461cb65), each behind a confirm. */
@Composable
private fun ChangeStatusPanel(vm: BoardViewModel, r: HistoryRow) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var pending by remember { mutableStateOf<String?>(null) }
    val person = r.user?.name ?: stringResource(R.string.override_this_person)
    val date = runCatching { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(LocalDate.parse(r.dayKey)) }.getOrDefault(r.dayKey)
    Column(
        Modifier.fillMaxWidth().background(c.accentBg, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(stringResource(R.string.override_title).uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold,
            color = c.accentFg, letterSpacing = 1.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OVERRIDE_ACTIONS.forEach { a ->
                OutlinedButton(onClick = { pending = a }, enabled = !s.busy) { Text(overrideLabel(a), fontSize = 12.sp) }
            }
        }
        TextButton(onClick = { pending = "CLEAR_PENALTY" }, enabled = !s.busy) { Text(stringResource(R.string.override_clear_full)) }
        Text(stringResource(R.string.override_footer), fontSize = 11.sp, color = c.mutedFg)
        if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        s.overrideDone?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.success) }
        s.overrideError?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger) }
    }
    pending?.let { action ->
        val label = overrideLabel(action)
        val doneClear = stringResource(R.string.override_done_clear, date)
        val doneNone = stringResource(R.string.override_done_none, date)
        val restoredNote = stringResource(R.string.override_penalty_restored)
        AlertDialog(
            onDismissRequest = { pending = null },
            title = {
                Text(if (action == "CLEAR_PENALTY") stringResource(R.string.override_confirm_clear, date, person)
                else stringResource(R.string.override_confirm_change, date, person, label))
            },
            text = { Text(overrideConsequence(action)) },
            confirmButton = {
                TextButton(onClick = {
                    pending = null
                    vm.applyOverride(r, action) { res ->
                        if (action == "CLEAR_PENALTY") (if (res.refunded == true) doneClear else doneNone)
                        else "$person · $date → $label" + (if (res.refunded == true) " · $restoredNote" else "")
                    }
                }) { Text(if (action == "CLEAR_PENALTY") stringResource(R.string.override_clear_penalty) else stringResource(R.string.override_change_to, label)) }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    s.multiDayLeft?.let { n ->
        AlertDialog(
            onDismissRequest = vm::clearOverrideNotes,
            title = { Text(stringResource(R.string.override_heads_up)) },
            text = { Text(stringResource(R.string.override_multi_day, n)) },
            confirmButton = { TextButton(onClick = vm::clearOverrideNotes) { Text("OK") } },
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
                        trailPlace(trail.record, stringResource(R.string.away_from_office))?.let {
                            Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        }
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

/** The trail header's place (iOS LocationTrailView): "Away from the office · <address>", else the office. */
internal fun trailPlace(r: TrailRecord?, awayWord: String): String? {
    if (r?.checkInAt == null) return null
    if (r.checkInAway == true) return awayWord + ((r.placeLabel ?: AttendancePlace.shortAddress(r.checkInAddress))?.let { " · $it" } ?: "")
    return r.placeLabel ?: r.office?.name
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
