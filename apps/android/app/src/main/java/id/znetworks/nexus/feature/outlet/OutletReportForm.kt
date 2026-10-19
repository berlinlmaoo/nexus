package id.znetworks.nexus.feature.outlet

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * "Report form" (OUTLET-SALES §7): pick the night (or a new one), fill the outlet team's questions as the server's form lists
 * them, save. A new event sends what is filled; an existing one sends only the keys that changed.
 */
@Composable
internal fun OutletReportForm(d: OutletMonth, s: OutletState, vm: OutletViewModel, onSaved: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val id = OutletFormat.isId()
    val thisYear = OutletFormat.parseDate(d.today)?.year ?: LocalDate.now().year
    val known = (d.events + d.waitingEarlier).distinctBy { it.id }
    // An event of another month (a waiting one opened elsewhere): fetched once.
    var fetched by remember(s.formEventId) { mutableStateOf<OutletEvent?>(null) }
    val event = s.formEventId?.let { eid -> known.firstOrNull { it.id == eid } ?: fetched }
    LaunchedEffect(s.formEventId) {
        val eid = s.formEventId ?: return@LaunchedEffect
        if (known.none { it.id == eid }) fetched = runCatching { vm.api.event(vm.projectId, eid) }.getOrNull()
    }
    val form = remember(s.formTick, s.formEventId, event != null) { d.reportForm(event) }
    val newDate = s.formDate ?: d.today ?: LocalDate.now().toString()
    // The working copy; re-read when another event is picked (not on a refresh, which would lose typing).
    var original by remember(s.formTick, s.formEventId, event != null) { mutableStateOf(OutletDraft.of(event, form, newDate)) }
    var draft by remember(s.formTick, s.formEventId, event != null) { mutableStateOf(original) }
    var tried by remember(s.formTick, s.formEventId) { mutableStateOf(false) }
    val dirty = OutletDraft.changes(form, original, draft).isNotEmpty()
    var pendingPick by remember { mutableStateOf<Pair<String?, Boolean>?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    fun pick(eid: String?) { if (dirty) pendingPick = eid to true else vm.openForm(eid) }
    fun num(k: String) = OutletFormat.parseNumber(draft[k].orEmpty())

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.os_form_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.foreground)
                    Text(stringResource(R.string.os_form_sub), fontSize = 12.sp, color = c.mutedFg)
                }
                IconButton(onClick = { copyFormLink(context, vm.projectId, event?.id) }) { Icon(Icons.Filled.Link, stringResource(R.string.os_copy_link), tint = c.mutedFg) }
            }
            EventPicker(d, event, thisYear, ::pick)
            if (event != null) Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(event.status); Spacer(Modifier.width(8.dp))
                event.updatedBy?.name?.let { Text(stringResource(R.string.os_changed_by, it), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            form.sections.forEach { sec ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // A total section says its live sum; Sales and Pax say actual / target on the right.
                        val title = sec.title.pick(id) + (sec.total?.let { ": " + OutletFormat.count(OutletFormat.total(sec.fields.map { f -> num(f.key) })) } ?: "")
                        Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        when (sec.key) {
                            "sales" -> Text(OutletFormat.vsTarget(num("sales"), num("salesTarget"), money = true), fontSize = 12.sp, color = c.mutedFg)
                            "pax" -> Text(OutletFormat.vsTarget(num("pax"), num("paxTarget"), money = false), fontSize = 12.sp, color = c.mutedFg)
                        }
                    }
                    sec.fields.forEach { f ->
                        val v = draft[f.key].orEmpty()
                        val set = { t: String -> draft = draft + (f.key to t) }
                        val error = when {
                            !tried -> null
                            f.key == "name" && v.isBlank() -> stringResource(R.string.os_need_name)
                            f.key == "date" && v.isBlank() -> stringResource(R.string.os_need_date)
                            else -> null
                        }
                        when (f.type) {
                            "money", "count" -> NumberBox(f.label.pick(id), v, money = f.type == "money", hint = f.hint?.pick(id)) { set(it) }
                            "date" -> DateBox(f.label.pick(id), v, thisYear, error) { set(it) }
                            "longtext" -> OutlinedTextField(v, { if (f.max == null || it.length <= f.max) set(it) }, label = { Text(f.label.pick(id)) },
                                minLines = 2, maxLines = 6, modifier = Modifier.fillMaxWidth())
                            else -> OutlinedTextField(v, { if (f.max == null || it.length <= f.max) set(it) }, singleLine = true, label = { Text(f.label.pick(id) + if (f.required) " *" else "") },
                                isError = error != null, supportingText = error?.let { { Text(it) } }, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
            if (event != null) TextButton(onClick = { confirmDelete = true }) { Text(stringResource(R.string.os_delete_event), color = c.danger) }
        }
        // The save button stays above the keyboard and the tab bar.
        HorizontalDivider(color = c.border)
        Button(
            onClick = {
                tried = true
                if (draft["name"].isNullOrBlank() || draft["date"].isNullOrBlank()) return@Button
                val fields = outletValues(if (event == null) OutletDraft.all(form, draft) else OutletDraft.changes(form, original, draft))
                vm.save(event?.id, fields) { original = draft; onSaved() }
            },
            enabled = !s.busy, colors = ButtonDefaults.buttonColors(containerColor = c.violet),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (s.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.card)
            else Text(stringResource(if (event == null) R.string.os_add_event else R.string.os_save_report))
        }
    }
    pendingPick?.let { (eid, _) ->
        AlertDialog(onDismissRequest = { pendingPick = null }, text = { Text(stringResource(R.string.os_discard_q)) },
            confirmButton = { TextButton(onClick = { pendingPick = null; vm.openForm(eid) }) { Text(stringResource(R.string.os_discard), color = c.danger) } },
            dismissButton = { TextButton(onClick = { pendingPick = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (confirmDelete && event != null) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.os_delete_q, event.name)) },
        text = { Text(stringResource(R.string.os_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(event) }) { Text(stringResource(R.string.os_delete_event), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
}

/** "Which event?": New event, then Waiting (oldest first, older months too), Upcoming, Reported. */
@Composable
private fun EventPicker(d: OutletMonth, current: OutletEvent?, thisYear: Int, onPick: (String?) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    fun line(e: OutletEvent) = "${OutletFormat.shortDay(e.date, thisYear)} · ${e.name}"
    Column {
        Text(stringResource(R.string.os_which_event), fontSize = 12.sp, color = c.mutedFg)
        Box {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { open = true }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(current?.let(::line) ?: stringResource(R.string.os_new_event), color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.ArrowDropDown, null, tint = c.mutedFg)
            }
            DropdownMenu(open, { open = false }, modifier = Modifier.heightIn(max = 420.dp)) {
                DropdownMenuItem(text = { Text(stringResource(R.string.os_new_event), fontWeight = FontWeight.SemiBold) }, onClick = { open = false; onPick(null) })
                val groups = listOf(
                    R.string.os_group_waiting to d.allWaiting,
                    R.string.os_st_upcoming to d.events.filter { it.status == OutletStatus.UPCOMING },
                    R.string.os_st_reported to d.events.filter { it.status == OutletStatus.REPORTED },
                )
                groups.forEach { (title, list) ->
                    if (list.isEmpty()) return@forEach
                    HorizontalDivider()
                    Text(stringResource(title), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    list.forEach { e -> DropdownMenuItem(text = { Text(line(e), maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = { open = false; onPick(e.id) }) }
                }
            }
        }
    }
}

/** A day, no time: "Minggu, 4 Oktober" in a box that opens a date picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateBox(label: String, iso: String, thisYear: Int, error: String?, onPick: (String) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label + " *", fontSize = 12.sp, color = if (error != null) c.danger else c.mutedFg)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, if (error != null) c.danger else c.border, RoundedCornerShape(12.dp))
            .clickable { open = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (iso.isBlank()) "—" else OutletFormat.longDay(iso, thisYear), color = c.foreground, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.CalendarMonth, null, tint = c.mutedFg)
        }
        error?.let { Text(it, fontSize = 11.sp, color = c.danger) }
    }
    if (open) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (OutletFormat.parseDate(iso) ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { open = false },
            confirmButton = { TextButton(onClick = {
                st.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; open = false
            }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(st) }
    }
}
