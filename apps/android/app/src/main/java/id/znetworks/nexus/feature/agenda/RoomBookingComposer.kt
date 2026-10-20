package id.znetworks.nexus.feature.agenda

import id.znetworks.nexus.ui.components.NxTextField

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * New / edit booking like the web (room-booking.tsx BookingComposer, QA S-13): the three rooms, a title, a day,
 * start and end every 15 minutes (24-hour), notes. A new booking for today starts at the next quarter hour once
 * 09:00 has gone; one that has already ended can't be made; the server's refusals said in the app's language.
 */
object BookingLogic {
    /** Stored values the server validates against (web ROOM_BOOKING_ROOMS); the UI shows [roomLabel]. */
    val ROOMS = listOf("Ruang Meeting VIP", "Ruang Meeting", "Studio")
    val TIMES: List<String> = (0 until 96).map { "%02d:%02d".format(it / 4, (it % 4) * 15) }

    /** The first slot offered: 09:00–10:00, or for today after 09:00 the next quarter hour and one hour on. */
    fun defaultSlot(date: LocalDate, now: Instant = Instant.now()): Pair<String, String> {
        val z = now.atZone(OfficeTime.ZONE)
        if (date != z.toLocalDate()) return "09:00" to "10:00"
        val q = Math.ceil((z.hour * 60 + z.minute) / 15.0).toInt()
        if (q <= 36 || q >= 95) return "09:00" to "10:00"
        return TIMES[q] to TIMES[minOf(q + 4, 95)]
    }

    /** When the start moves past the end, the end follows one hour later (web). */
    fun endAfter(start: String, end: String): String = if (end > start) end else TIMES[minOf(TIMES.indexOf(start).coerceAtLeast(0) + 4, 95)]

    fun instant(date: LocalDate, time: String): Instant = date.atTime(LocalTime.parse(time)).atZone(OfficeTime.ZONE).toInstant()

    enum class Problem { END_BEFORE_START, IN_PAST, NO_TITLE }

    /** What stops Save, in the web's order; null = it can be saved. Times not changed on an edit may be in the past. */
    fun problem(title: String, date: LocalDate, start: String, end: String, timesChanged: Boolean, now: Instant = Instant.now()): Problem? = when {
        end <= start -> Problem.END_BEFORE_START
        timesChanged && !instant(date, end).isAfter(now) -> Problem.IN_PAST
        title.isBlank() -> Problem.NO_TITLE
        else -> null
    }

    enum class Refusal { TAKEN, IN_PAST, NOT_YOURS, BAD_TIMES, OTHER }

    /** The server's refusal (its text is Indonesian) as a kind; [conflictTitle] names the booking in the way. */
    fun refusal(e: ApiError): Pair<Refusal, String?> {
        val http = e as? ApiError.Http ?: return Refusal.OTHER to null
        val conflict = runCatching { http.body?.get("conflict")?.jsonObject?.get("title")?.jsonPrimitive?.contentOrNull }.getOrNull()
        return when {
            http.status == 409 -> Refusal.TAKEN to conflict
            http.code == "BOOKING_IN_PAST" -> Refusal.IN_PAST to null
            http.status == 403 -> Refusal.NOT_YOURS to null
            http.status == 400 -> Refusal.BAD_TIMES to null
            else -> Refusal.OTHER to null
        }
    }
}

@Composable
fun roomLabel(room: String): String = when (room) {
    "Ruang Meeting VIP" -> stringResource(R.string.rb_room_vip)
    "Ruang Meeting" -> stringResource(R.string.rb_room_meeting)
    "Studio" -> stringResource(R.string.rb_room_studio)
    else -> room
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingComposer(booking: Booking?, api: AgendaApi, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    val editing = booking != null
    val startZ = booking?.let { AgendaLogic.zoned(it.startsAt) }
    val endZ = booking?.let { AgendaLogic.zoned(it.endsAt) }
    val hhmm = DateTimeFormatter.ofPattern("HH:mm")
    val initDate = startZ?.toLocalDate() ?: OfficeTime.today()
    val slot = remember { BookingLogic.defaultSlot(initDate) }
    val initStart = startZ?.let { hhmm.format(it) } ?: slot.first
    val initEnd = endZ?.let { hhmm.format(it) } ?: slot.second
    var room by remember { mutableStateOf(booking?.room ?: BookingLogic.ROOMS.first()) }
    var title by remember { mutableStateOf(booking?.title ?: "") }
    var date by remember { mutableStateOf(initDate) }
    var start by remember { mutableStateOf(initStart) }
    var end by remember { mutableStateOf(initEnd) }
    var notes by remember { mutableStateOf(booking?.description ?: "") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var pickDate by remember { mutableStateOf(false) }
    val timesChanged = !editing || date != initDate || start != initStart || end != initEnd
    val problem = BookingLogic.problem(title, date, start, end, timesChanged)

    fun refusal(e: ApiError, fallback: Int): String {
        if ((e as? ApiError.Http)?.code == "ROOMS_NOT_AVAILABLE") return res.getString(R.string.qa_rooms_company_body)
        val (kind, conflict) = BookingLogic.refusal(e)
        return when (kind) {
            BookingLogic.Refusal.TAKEN -> if (conflict != null) res.getString(R.string.rb_taken_by, roomName(res, room), conflict) else res.getString(R.string.rb_taken, roomName(res, room))
            BookingLogic.Refusal.IN_PAST -> res.getString(R.string.rb_in_past)
            BookingLogic.Refusal.NOT_YOURS -> res.getString(R.string.rb_not_yours)
            BookingLogic.Refusal.BAD_TIMES -> res.getString(R.string.rb_bad_times)
            BookingLogic.Refusal.OTHER -> res.getString(fallback)
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.card).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(if (editing) R.string.rb_edit else R.string.rb_new), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.close)) }
            }
            Field(stringResource(R.string.rb_room)) {
                Picker(roomLabel(room), BookingLogic.ROOMS.map { it to it }, { roomLabel(it) }) { room = it }
            }
            Field(stringResource(R.string.rb_title)) {
                NxTextField(title, { title = it }, singleLine = true, placeholder = { Text(stringResource(R.string.rb_title_hint)) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            }
            Field(stringResource(R.string.rb_date)) {
                Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { pickDate = true }
                    .padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
                    Text(AppDateFormats.ofPattern("EEE, d MMM yyyy", Locale.getDefault()).format(date), fontSize = 15.sp, color = c.foreground)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) { Field(stringResource(R.string.rb_start)) { Picker(start, BookingLogic.TIMES.map { it to it }, { it }) { start = it; end = BookingLogic.endAfter(it, end) } } }
                Box(Modifier.weight(1f)) { Field(stringResource(R.string.rb_end)) { Picker(end, BookingLogic.TIMES.map { it to it }, { it }) { end = it } } }
            }
            Field(stringResource(R.string.rb_notes)) {
                NxTextField(notes, { notes = it }, minLines = 2, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            }
            when (problem) {
                BookingLogic.Problem.END_BEFORE_START -> Text(stringResource(R.string.rb_end_before_start), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                BookingLogic.Problem.IN_PAST -> Text(stringResource(R.string.rb_in_past), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                BookingLogic.Problem.NO_TITLE -> Text(stringResource(R.string.rb_need_title), fontSize = 13.sp, color = c.mutedFg)
                null -> {}
            }
            err?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                NxButton(stringResource(if (editing) R.string.rb_update else R.string.rb_book), {
                    err = null; busy = true
                    scope.launch {
                        try {
                            val from = BookingLogic.instant(date, start); val to = BookingLogic.instant(date, end)
                            if (booking == null) api.create(room, title.trim(), from, to, notes.ifBlank { null }) else api.update(booking.id, room, title.trim(), from, to, notes.ifBlank { null })
                            onSaved()
                        } catch (e: ApiError) { err = refusal(e, R.string.rb_save_failed) }
                        busy = false
                    }
                }, Modifier.weight(1f), kind = NxButtonKind.PRIMARY, enabled = problem == null && !busy)
                if (busy) { Spacer(Modifier.width(8.dp)); CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                if (editing) {
                    Spacer(Modifier.width(8.dp))
                    IconButton(onClick = { confirmDelete = true }, enabled = !busy) { Icon(Icons.Outlined.Delete, stringResource(R.string.rb_delete), tint = c.dangerText) }
                }
            }
        }
    }
    if (pickDate) {
        val state = rememberDatePickerState(initialSelectedDateMillis = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { pickDate = false }, confirmButton = {
            TextButton(onClick = { state.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }; pickDate = false }) { Text(stringResource(android.R.string.ok)) }
        }, dismissButton = { TextButton(onClick = { pickDate = false }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(state) }
    }
    // A centred confirmation (house rule), like the web's "Delete this booking?".
    if (confirmDelete && booking != null) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.rb_delete_q)) }, text = { Text(stringResource(R.string.qa_booking_delete_body)) },
        confirmButton = { TextButton(onClick = {
            confirmDelete = false; busy = true
            scope.launch {
                try { api.delete(booking.id); onSaved() } catch (e: ApiError) { err = refusal(e, R.string.rb_delete_failed) }
                busy = false
            }
        }) { Text(stringResource(R.string.rb_delete), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
}

private fun roomName(res: android.content.res.Resources, room: String) = when (room) {
    "Ruang Meeting VIP" -> res.getString(R.string.rb_room_vip)
    "Ruang Meeting" -> res.getString(R.string.rb_room_meeting)
    "Studio" -> res.getString(R.string.rb_room_studio)
    else -> room
}

@Composable
private fun Field(label: String, content: @Composable () -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Nx.colors.mutedFg)
    content()
}

@Composable
private fun Picker(shown: String, options: List<Pair<String, String>>, label: @Composable (String) -> String, onPick: (String) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { open = true }
            .padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(shown, fontSize = 15.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg)
        }
        DropdownMenu(open, { open = false }, Modifier.heightIn(max = 320.dp)) {
            options.forEach { (value, _) -> DropdownMenuItem(text = { Text(label(value)) }, onClick = { open = false; onPick(value) }) }
        }
    }
}
