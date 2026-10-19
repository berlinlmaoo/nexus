package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AttendanceBulkTools(api: AttendanceAdminApi, changed: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmAbsences by remember { mutableStateOf(false) }
    var pick by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var result by remember { mutableStateOf<String?>(null) }
    TextButton(onClick = { confirmAbsences = true }, enabled = !busy) { Text(stringResource(R.string.bulk_absences)) }
    TextButton(onClick = { pick = true }, enabled = !busy) { Text(stringResource(R.string.bulk_outage)) }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    result?.let { Text(it) }
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (confirmAbsences) AlertDialog(onDismissRequest = { if (!busy) confirmAbsences = false }, title = { Text(stringResource(R.string.bulk_absences_confirm)) },
        text = { Column { Text(stringResource(R.string.bulk_absences_help)); error?.let { Text(it, color = MaterialTheme.colorScheme.error) } } }, confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
            busy = true; error = null
            try { val r = api.deductAbsences(); result = context.getString(R.string.bulk_absences_done, r.number("created")?.toInt() ?: 0, r.number("skipped")?.toInt() ?: 0); confirmAbsences = false; changed() }
            catch (e: ApiError) { error = e.describe(context.resources) }
            busy = false
        } }) { Text(stringResource(R.string.bulk_run)) } }, dismissButton = { TextButton(onClick = { confirmAbsences = false }, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
    if (pick) {
        val state = rememberDatePickerState(initialSelectedDateMillis = OfficeTime.today().minusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(onDismissRequest = { if (!busy) pick = false }, confirmButton = { TextButton(enabled = !busy && state.selectedDateMillis != null, onClick = { scope.launch {
            busy = true; error = null
            val date = Instant.ofEpochMilli(state.selectedDateMillis!!).atZone(ZoneOffset.UTC).toLocalDate().toString()
            try { preview = api.outageRefund(date, true); pick = false }
            catch (e: ApiError) { error = e.describe(context.resources) }
            busy = false
        } }) { Text(stringResource(R.string.bulk_preview)) } }, dismissButton = { TextButton(onClick = { pick = false }, enabled = !busy) { Text(stringResource(R.string.cancel)) } }) {
            Column { DatePicker(state); error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp)) } }
        }
    }
    preview?.let { r -> AlertDialog(onDismissRequest = { if (!busy) preview = null }, title = { Text(stringResource(R.string.bulk_outage_confirm, r.text("date"))) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.bulk_outage_help))
            Text(stringResource(R.string.bulk_preview_totals, r.number("refundedMembers")?.toInt() ?: 0, r.number("totalXpRefunded")?.toInt() ?: 0, r.number("totalDayOffsRestored")?.toInt() ?: 0))
            r.rows("entries").forEach { entry -> Text(entry.text("name") + ": " + (entry.text("excludedReason").takeIf { it.isNotEmpty() } ?: "+${entry.number("xpRefund")?.toInt() ?: 0} XP")) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton(enabled = !busy && (r.number("refundedMembers") ?: 0.0) > 0, onClick = { scope.launch {
            busy = true; error = null
            try {
                val applied = api.outageRefund(r.text("date"), false)
                result = context.getString(R.string.bulk_applied, applied.number("refundedMembers")?.toInt() ?: 0, applied.number("failed")?.toInt() ?: 0)
                preview = null; changed()
            } catch (e: ApiError) { error = e.describe(context.resources) }
            busy = false
        } }) { Text(stringResource(R.string.bulk_refund)) } }, dismissButton = { TextButton(onClick = { preview = null }, enabled = !busy) { Text(stringResource(R.string.cancel)) } }) }
}
