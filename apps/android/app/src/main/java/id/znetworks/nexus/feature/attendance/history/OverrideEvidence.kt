package id.znetworks.nexus.feature.attendance.history

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import id.znetworks.nexus.feature.attendance.requests.Attachment
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.feature.attendance.requests.AttachmentChip
import id.znetworks.nexus.ui.components.rememberCameraCapture
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

object OverrideEvidence {
    fun from(row: HistoryRow): String {
        val approved = row.requestStatus == "APPROVED"
        if (approved && row.requestType == "PERMIT") return "PERMIT"
        if (row.checkInAt != null) return "PRESENT"
        if (approved) when (row.requestType) {
            "SICK" -> return "SICK"
            "LEAVE" -> return "LEAVE"
            "DAY_OFF", "RED_DATE" -> return if (row.notes.orEmpty().startsWith("Auto:")) "ABSENT" else "DAY_OFF"
        }
        return if (row.recordKind == "ABSENT") "ABSENT" else "NONE"
    }
    fun asked(row: HistoryRow, target: String): String? = when (target) {
        "SICK" -> "SICK_NOTE"
        "PERMIT" -> "PERMIT_EVIDENCE"
        "PRESENT" -> if (from(row) in setOf("PERMIT", "ABSENT", "NONE")) "PRESENT_EVIDENCE" else null
        else -> null
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OverrideEvidenceStep(row: HistoryRow, action: String, title: String, busy: Boolean,
    dismiss: () -> Unit, save: (Attachment?, String?, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var attachment by remember(row, action) { mutableStateOf<Attachment?>(null) }
    var reading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Filling a day without a record can also supply custom office times.
    val customTimes = action == "PRESENT" && row.checkInAt == null
    var custom by remember { mutableStateOf(false) }
    var checkIn by remember { mutableStateOf("09:00") }
    var checkOut by remember { mutableStateOf("18:00") }
    fun instant(time: String) = runCatching { LocalDate.parse(row.dayKey).atTime(LocalTime.parse(time)).atZone(ZoneId.of("Asia/Jakarta")).toInstant().toString() }.getOrNull()
    fun attach(uri: android.net.Uri) { scope.launch {
        reading = true; error = null
        val result = withContext(Dispatchers.IO) { AttachmentReader.readEvidence(context, uri) }
        when (result) {
            is AttachmentReader.Result.Ok -> attachment = result.attachment
            AttachmentReader.Result.TooBig -> error = context.getString(R.string.attach_too_big)
            AttachmentReader.Result.Unsupported -> error = context.getString(R.string.attach_unsupported)
            AttachmentReader.Result.Unreadable -> error = context.getString(R.string.attach_unreadable)
        }
        reading = false
    } }
    val camera = rememberCameraCapture("override-evidence", ::attach)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(::attach) }
    ModalBottomSheet(onDismissRequest = { if (!busy && !reading) dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(stringResource(if (action == "SICK") R.string.override_sick_hint else R.string.override_evidence_hint))
            Text(stringResource(R.string.override_evidence_optional), color = Nx.colors.mutedFg)
            Row {
                TextButton(onClick = camera, enabled = !busy && !reading) { Text(stringResource(R.string.override_take_photo)) }
                TextButton(onClick = { picker.launch(arrayOf("image/*", "application/pdf")) }, enabled = !busy && !reading) { Text(stringResource(R.string.override_choose_file)) }
            }
            attachment?.let { file -> Row {
                Text(file.fileName, Modifier.weight(1f))
                TextButton(onClick = { attachment = null }, enabled = !busy && !reading) { Text("✕") }
            } }
            if (reading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = Nx.colors.dangerText) }
            if (customTimes) {
                Row { id.znetworks.nexus.ui.components.NxCheckbox(custom, { custom = it }); Text(stringResource(R.string.override_custom_times)) }
                if (custom) {
                    id.znetworks.nexus.ui.components.NxTextField(checkIn, { checkIn = it }, label = { Text(stringResource(R.string.override_check_in_time)) }, singleLine = true)
                    id.znetworks.nexus.ui.components.NxTextField(checkOut, { checkOut = it }, label = { Text(stringResource(R.string.override_check_out_time)) }, singleLine = true)
                }
            }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = dismiss, enabled = !busy && !reading) { Text(stringResource(R.string.cancel)) }
        TextButton(enabled = !busy && !reading && (!custom || (instant(checkIn) != null && (checkOut.isBlank() || instant(checkOut) != null))), onClick = {
            save(attachment, if (custom) instant(checkIn) else null, if (custom) (if (checkOut.isBlank()) "" else instant(checkOut)) else null)
        }) { Text(stringResource(if (attachment == null) R.string.override_save_without else R.string.gm_save)) }
        }
        }
    }
}

@Composable
fun EvidenceDisplay(url: String?, name: String?, missing: Boolean, correction: Boolean) {
    if (url != null || missing) {
        Text(stringResource(if (correction) R.string.override_correction_evidence else R.string.override_evidence))
        if (url != null) AttachmentChip(url, name, null)
        else Text(stringResource(R.string.override_no_evidence), color = Nx.colors.warning)
    }
}
