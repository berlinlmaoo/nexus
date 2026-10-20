package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Multi-select + Duplicate on a project's task cards (PROJECT-CUSTOMIZE-CLEANUP §1, 11 Oct; web task-bulk.tsx):
 * always on, in every project. Long-press a card → its menu (Select multiple / Duplicate / Duplicate + date…);
 * while anything is selected a tap toggles a card and a bar at the bottom duplicates the lot.
 */
object TaskBulkLogic {
    fun toggle(selected: Set<String>, id: String) = if (id in selected) selected - id else selected + id

    /** POST /api/tasks/:id/duplicate body: no date = the copy keeps the task's own due date (key left out). */
    fun body(due: LocalDate?): JsonObject = JsonObject(if (due == null) emptyMap() else mapOf("dueDate" to JsonPrimitive(due.toString())))

    /** Ids in board order, so the copies land in the order they were seen. */
    fun ordered(lanes: List<Lane>, selected: Set<String>) = lanes.flatMap { l -> l.tasks.map { it.id } }.filter { it in selected }.distinct()
}

/** The long-press menu's top rows; the caller adds its own (Move to…) under them. */
@Composable
fun TaskBulkMenuItems(onSelect: () -> Unit, onDuplicate: () -> Unit, onDuplicateDate: () -> Unit) {
    androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.bulk_select)) }, onClick = onSelect)
    androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.bulk_duplicate)) }, onClick = onDuplicate)
    androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.bulk_duplicate_date)) }, onClick = onDuplicateDate)
    androidx.compose.material3.HorizontalDivider(color = Nx.colors.border)
}

/** "3 selected · Duplicate · 📅 · ×", floating at the bottom while selecting. */
@Composable
fun TaskSelectionBar(count: Int, busy: Boolean, onDuplicate: () -> Unit, onDuplicateDate: () -> Unit, onClear: () -> Unit, modifier: Modifier = Modifier) {
    val c = Nx.colors
    Row(modifier.shadow(8.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))
        .padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(pluralStringResource(R.plurals.bulk_selected, count, count), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground,
            modifier = Modifier.padding(horizontal = 6.dp))
        NxOutlinedButton(onClick = onDuplicate, enabled = !busy && count > 0) {
            if (busy) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.ContentCopy, null, Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.bulk_duplicate))
        }
        IconButton(onClick = onDuplicateDate, enabled = !busy && count > 0) { Icon(Icons.Filled.CalendarMonth, stringResource(R.string.bulk_duplicate_date), tint = c.mutedFg) }
        IconButton(onClick = onClear) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.mutedFg) }
    }
}

/** The optional due-date popup: a centred dialog; no date = keep each task's own. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DuplicateDateDialog(count: Int, busy: Boolean, onDismiss: () -> Unit, onConfirm: (LocalDate?) -> Unit) {
    val c = Nx.colors
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var picking by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        icon = { Icon(Icons.Filled.ContentCopy, null, tint = c.violetText) },
        title = { Text(pluralStringResource(R.plurals.bulk_dup_title, count, count)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.bulk_dup_sub), fontSize = 13.sp, color = c.mutedFg)
                Text(stringResource(R.string.bulk_dup_label), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp))
                    .clickable { picking = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(date?.let { AppDateFormats.ofPattern("EEE, d MMM yyyy", Locale.getDefault()).format(it) } ?: stringResource(R.string.bulk_dup_pick),
                        color = if (date == null) c.mutedFg else c.foreground, modifier = Modifier.weight(1f))
                    if (date != null) IconButton(onClick = { date = null }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.bulk_dup_clear), tint = c.mutedFg) }
                    else Icon(Icons.Filled.CalendarMonth, null, tint = c.mutedFg)
                }
                Text(stringResource(R.string.bulk_dup_keep), fontSize = 11.sp, color = c.mutedFg)
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(date) }, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.bulk_duplicate))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
    if (picking) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (date ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton(onClick = {
                st.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }; picking = false
            }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(st) }
    }
}
