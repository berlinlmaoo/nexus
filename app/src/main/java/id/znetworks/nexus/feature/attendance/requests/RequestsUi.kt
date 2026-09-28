package id.znetworks.nexus.feature.attendance.requests

import android.Manifest
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.rememberCameraCapture
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// region labels

@Composable
fun typeLabel(t: String?): String = when (t.orEmpty().uppercase()) {
    "LEAVE" -> stringResource(R.string.req_leave)
    "SICK" -> stringResource(R.string.req_sick)
    "PERMIT" -> stringResource(R.string.req_permit)
    "DAY_OFF" -> "Day Off"
    "RED_DATE" -> stringResource(R.string.req_red_date)
    else -> t.orEmpty().lowercase().replaceFirstChar(Char::titlecase)
}

@Composable
fun statusLabel(s: String?): String = stringResource(
    when (s.orEmpty().uppercase()) {
        "APPROVED" -> R.string.req_approved
        "REJECTED" -> R.string.req_rejected
        "CANCELED", "CANCELLED" -> R.string.req_canceled
        "ALL" -> R.string.req_all
        else -> R.string.req_pending
    },
)

@Composable
private fun statusTone(s: String?): Color = when (s.orEmpty().uppercase()) {
    "APPROVED" -> Nx.colors.success
    "REJECTED" -> Nx.colors.danger
    "CANCELED", "CANCELLED" -> Nx.colors.mutedFg
    else -> Nx.colors.warning
}

private val DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())
private val STAMP = DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale.getDefault())

/** Date-only columns are stored at 00:00 UTC: read the date part, not a zoned instant. */
fun dayLabel(iso: String?): String =
    iso?.take(10)?.let { runCatching { DAY.format(LocalDate.parse(it)) }.getOrNull() } ?: ""

fun stampLabel(iso: String?): String? =
    iso?.let { runCatching { STAMP.format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull() }

// endregion

/** The "Submissions" card (iOS `AttendanceRequestsCard`): file your own, review the crew's. */
@Composable
fun SubmissionsCard(vm: RequestsViewModel, onFiled: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val filter = vm.activeFilter(s)
    val entries = remember(s.requests, s.offsite) {
        s.requests.map { SubmissionEntry.Req(it) } + s.offsite.map { SubmissionEntry.Offsite(it) }
    }
    val shown = remember(entries, filter, s.window, s.query) {
        SubmissionFilter.apply(entries, filter, s.window, s.query, OfficeTime.today())
    }
    var showAll by rememberSaveable { mutableStateOf(false) }

    Column(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(24.dp)).border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.submissions_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
                Text(
                    stringResource(if (vm.canReview) R.string.submissions_sub_review else R.string.submissions_sub_staff),
                    fontSize = 11.sp, color = c.mutedFg,
                )
            }
            Button(onClick = { vm.openComposer() }, shape = CircleShape, enabled = vm.today != null,
                colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White)) {
                Icon(Icons.Filled.Add, null, Modifier.size(16.dp))
                Spacer(Modifier.size(4.dp))
                Text(stringResource(R.string.req_new), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("PENDING", "APPROVED", "REJECTED", "CANCELED", "ALL").forEach { f ->
                FilterChip(selected = filter == f, onClick = { vm.setFilter(f) }, label = { Text(statusLabel(f), fontSize = 12.sp) })
            }
        }
        if (filter != "PENDING") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(s.window == SubmissionWindow.RECENT, { vm.setWindow(SubmissionWindow.RECENT) }, { Text(stringResource(R.string.window_recent), fontSize = 12.sp) })
                FilterChip(s.window == SubmissionWindow.PERIOD, { vm.setWindow(SubmissionWindow.PERIOD) }, { Text(stringResource(R.string.window_period), fontSize = 12.sp) })
            }
        }
        if (vm.canReview) {
            OutlinedTextField(
                value = s.query, onValueChange = vm::setQuery, singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text(stringResource(R.string.req_search)) },
                modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
            )
        }
        s.actionError?.let { err ->
            Text(err, color = c.danger, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.12f), RoundedCornerShape(10.dp)).padding(10.dp))
        }
        s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, id.znetworks.nexus.feature.attendance.LocalNotifier.hhmm(it)), fontSize = 12.sp, color = Nx.colors.mutedFg) }
        when {
            s.loading -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            s.loadError != null && s.requests.isEmpty() -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.req_load_failed), s.loadError!!,
                stringResource(R.string.try_again), { vm.load() })
            shown.isEmpty() -> EmptyForFilter(vm, s, filter)
            else -> {
                val visible = if (showAll) shown else shown.take(PAGE)
                visible.forEach { e ->
                    when (e) {
                        is SubmissionEntry.Req -> RequestRow(vm, e.r, s.busyId == e.r.id)
                        is SubmissionEntry.Offsite -> OffsiteRow(vm, e.o, s.busyId == e.o.id)
                    }
                }
                if (shown.size > PAGE && !showAll) {
                    TextButton(onClick = { showAll = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.show_all_n, shown.size))
                    }
                }
            }
        }
    }

    s.rejecting?.let { RejectDialog(it, busy = s.busyId == it.id, error = s.actionError, onCancel = vm::cancelReject, onSend = { note -> vm.review(it, "reject", note) }) }
    s.composer?.let { ComposerDialog(vm, it, onFiled) }
    s.focus?.let { entry ->
        // Decided in place: the push lands on this one row, with its buttons.
        AlertDialog(
            onDismissRequest = vm::closeFocus,
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (entry) {
                        is SubmissionEntry.Req -> RequestRow(vm, entry.r, s.busyId == entry.r.id)
                        is SubmissionEntry.Offsite -> OffsiteRow(vm, entry.o, s.busyId == entry.o.id)
                    }
                    s.actionError?.let { Text(it, color = c.danger, fontSize = 12.sp) }
                }
            },
            confirmButton = { TextButton(onClick = vm::closeFocus) { Text(stringResource(R.string.close)) } },
        )
    }
    if (s.focusMissing) {
        AlertDialog(
            onDismissRequest = vm::closeFocus,
            title = { Text(stringResource(R.string.focus_missing_title)) },
            text = { Text(stringResource(R.string.focus_missing_body)) },
            confirmButton = { TextButton(onClick = vm::closeFocus) { Text("OK") } },
        )
    }
}

private const val PAGE = 20

@Composable
private fun EmptyForFilter(vm: RequestsViewModel, s: RequestsUiState, filter: String) {
    val period = OfficeTime.periodRange(OfficeTime.periodKey(OfficeTime.today()))
    val periodLabel = "${DAY.format(period.start)} – ${DAY.format(period.endInclusive)}"
    when {
        s.query.isNotBlank() -> EmptyState(Icons.Filled.Search, stringResource(R.string.empty_no_matches),
            stringResource(R.string.empty_no_matches_sub, s.query.trim()), stringResource(R.string.clear_search), { vm.setQuery("") })
        filter == "PENDING" -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.empty_pending),
            stringResource(R.string.empty_pending_sub), stringResource(R.string.show_all), { vm.setFilter("ALL") })
        s.window == SubmissionWindow.RECENT -> EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.empty_recent),
            stringResource(R.string.empty_recent_sub), stringResource(R.string.window_show_period), { vm.setWindow(SubmissionWindow.PERIOD) })
        // Nothing this period at all: the next step is filing one.
        else -> EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.empty_period),
            stringResource(R.string.empty_period_sub, periodLabel), stringResource(R.string.req_new), { vm.openComposer() })
    }
}

@Composable
private fun Chip(text: String, tone: Color) {
    Text(text, color = tone, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(tone.copy(alpha = 0.15f), CircleShape).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
private fun RowShell(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Nx.colors.muted.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

@Composable
private fun RequestRow(vm: RequestsViewModel, r: AttendanceRequest, busy: Boolean) {
    val c = Nx.colors
    var expanded by rememberSaveable(r.id) { mutableStateOf(false) }
    RowShell {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(typeLabel(r.type), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Chip(statusLabel(r.status), statusTone(r.status))
        }
        Text(
            listOfNotNull(dayLabel(r.startDate), r.user?.name?.takeIf { vm.canReview }).joinToString(" · "),
            fontSize = 11.sp, color = c.mutedFg,
        )
        r.reason?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontSize = 12.sp, color = c.foreground, maxLines = if (expanded) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.then(if (it.length > 140) Modifier.padding(0.dp) else Modifier))
            if (it.length > 140) TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.show_less else R.string.read_all), fontSize = 11.sp) }
        }
        r.supportingDocumentUrl?.let { AttachmentChip(it, r.supportingDocumentName, r.type) }
        if (!r.isPending) {
            val by = r.reviewedBy?.name
            val verb = statusLabel(r.status)
            Text(listOfNotNull(verb, by?.let { stringResource(R.string.by_name, it) } ?: stringResource(R.string.automatically), stampLabel(r.reviewedAt))
                .joinToString(" · "), fontSize = 10.sp, color = c.mutedFg, fontWeight = FontWeight.SemiBold)
        }
        r.reviewNote?.takeIf { it.isNotBlank() }?.let { note ->
            val rejected = r.statusKey == "REJECTED"
            val tone = if (rejected) c.danger else c.success
            Column(Modifier.fillMaxWidth().background(tone.copy(alpha = 0.1f), RoundedCornerShape(10.dp)).padding(8.dp)) {
                Text(
                    stringResource(
                        when {
                            rejected -> R.string.note_why_rejected
                            r.reviewedBy == null -> R.string.note_automatic
                            else -> R.string.note_from_approver
                        },
                    ),
                    fontSize = 10.sp, fontWeight = FontWeight.Bold, color = tone,
                )
                Text(note, fontSize = 12.sp, color = c.foreground)
            }
        }
        if (r.isPending) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                when {
                    busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    // A reviewer's own request gets what everybody's does: Cancel (never Approve).
                    vm.canReview && !r.isOwn(vm.viewerId) -> {
                        SmallAction(stringResource(R.string.approve), c.success) { vm.review(r, "approve") }
                        SmallAction(stringResource(R.string.reject), c.danger) { vm.startReject(r) }
                    }
                    else -> SmallAction(stringResource(R.string.cancel_it), c.mutedFg) { vm.review(r, "cancel") }
                }
            }
        }
    }
}

@Composable
private fun OffsiteRow(vm: RequestsViewModel, o: OffsiteCheckout, busy: Boolean) {
    val c = Nx.colors
    val context = LocalContext.current
    val mine = o.user?.id != null && o.user.id == vm.viewerId
    RowShell {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.LocationOn, null, tint = c.violetText, modifier = Modifier.size(14.dp))
            Spacer(Modifier.size(4.dp))
            Text(stringResource(R.string.offsite_checkout), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Chip(statusLabel(o.approval), statusTone(o.approval))
        }
        Text(listOfNotNull(dayLabel(o.attendanceDate), stampLabel(o.checkOutAt)?.substringAfter("· "), o.user?.name).joinToString(" · "),
            fontSize = 11.sp, color = c.mutedFg)
        o.reason?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.foreground) }
        o.address?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 2) }
        o.distanceMeters?.let { Text("±${it.toInt()} m · ${o.officeName ?: stringResource(R.string.office)}", fontSize = 11.sp, color = c.mutedFg) }
        if (o.lat != null && o.lng != null) {
            TextButton(onClick = {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=17/${o.lat}/${o.lng}")))
                }
            }) { Text(stringResource(R.string.view_map), fontSize = 11.sp) }
        }
        if (!o.isPending) o.approverName?.let { Text("· $it", fontSize = 11.sp, color = c.mutedFg) }
        if (o.isPending) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    mine -> Text(stringResource(R.string.cant_approve_own), fontSize = 11.sp, color = c.mutedFg)
                    else -> {
                        SmallAction(stringResource(R.string.approve), c.success) { vm.reviewOffsite(o, "approve") }
                        SmallAction(stringResource(R.string.reject), c.danger) { vm.reviewOffsite(o, "reject") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SmallAction(text: String, tone: Color, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.background(tone.copy(alpha = 0.15f), CircleShape).height(34.dp)) {
        Text(text, color = tone, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * The attachment, fetched WITH the session (the file route refuses anyone without it). A photo is
 * a thumbnail labelled by what it is evidence of; a PDF opens in the phone's viewer.
 */
@Composable
fun AttachmentChip(path: String, name: String?, type: String?) {
    val context = LocalContext.current
    val c = Nx.colors
    val api = (context.applicationContext as NexusApplication).container.api
    val isPdf = (path.substringBefore('?') + " " + name.orEmpty()).lowercase().contains(".pdf")
    var image by remember(path) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(path) { mutableStateOf(false) }
    if (!isPdf) {
        LaunchedEffect(path) {
            image = withContext(Dispatchers.IO) {
                runCatching { api.bytes(path).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
            }
            failed = image == null
        }
    }
    val label = when {
        isPdf -> name ?: "document.pdf"
        type.equals("PERMIT", true) -> stringResource(R.string.permit_photo)
        type.equals("SICK", true) -> stringResource(R.string.sick_note)
        else -> stringResource(R.string.photo)
    }
    var opening by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(open) {
        if (!open) return@LaunchedEffect
        opening = true
        val file = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(context.cacheDir, "shared").apply { mkdirs() }
                File(dir, if (isPdf) "attachment.pdf" else "attachment.jpg").apply { writeBytes(api.bytes(path)) }
            }.getOrNull()
        }
        opening = false
        open = false
        file?.let { viewFile(context, it, if (isPdf) "application/pdf" else "image/jpeg") }
    }
    Row(
        Modifier.background(c.card, RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val img = image
        if (img != null) {
            Image(img, null, contentScale = ContentScale.Crop, modifier = Modifier.size(44.dp).background(c.muted, RoundedCornerShape(8.dp)))
        } else {
            Icon(if (isPdf) Icons.Filled.Description else Icons.Filled.Photo, null, tint = c.mutedFg, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.size(8.dp))
        Text(if (failed) stringResource(R.string.attach_load_failed) else label, fontSize = 12.sp, color = c.foreground)
        Spacer(Modifier.size(8.dp))
        if (opening) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        else TextButton(onClick = { open = true }) { Text(stringResource(R.string.open), fontSize = 12.sp) }
    }
}

private fun viewFile(context: Context, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@Composable
private fun RejectDialog(r: AttendanceRequest, busy: Boolean, error: String?, onCancel: () -> Unit, onSend: (String) -> Unit) {
    var note by rememberSaveable(r.id) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onCancel() },
        title = { Text(stringResource(R.string.reject_title, typeLabel(r.type))) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.reject_help), fontSize = 13.sp)
                OutlinedTextField(note, { note = it }, minLines = 3, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = Nx.colors.danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSend(note) }, enabled = note.trim().length >= 3 && !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.reject), color = Nx.colors.danger)
            }
        },
        dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

// region composer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ComposerDialog(vm: RequestsViewModel, cs: ComposerState, onFiled: () -> Unit) {
    val context = LocalContext.current
    val c = Nx.colors
    val rules = vm.rules()
    var pickingDate by remember { mutableStateOf(false) }

    val camera = rememberCameraCapture("shot") { vm.attach(it) }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::attach) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::attach) }
    val locationPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.lockLocation() }

    Dialog(onDismissRequest = { if (!cs.sending) vm.closeComposer() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = vm::closeComposer, enabled = !cs.sending) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
                Text(stringResource(R.string.req_new_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp,
                    color = c.foreground, modifier = Modifier.weight(1f))
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Label(stringResource(R.string.req_type))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    rules.types.forEach { t -> FilterChip(cs.type == t, { vm.pickType(t) }, { Text(typeLabel(t)) }) }
                }
                Text(typeHint(rules, cs.type, vm), fontSize = 12.sp, color = c.mutedFg)

                // One date control, every type (REQ-ATT-25).
                Label(stringResource(R.string.req_date))
                OutlinedButton(onClick = { pickingDate = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Filled.CalendarMonth, null, Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(DAY.format(cs.date), modifier = Modifier.weight(1f))
                }

                Label(stringResource(R.string.req_reason))
                OutlinedTextField(cs.reason, vm::setReason, minLines = 3, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                    placeholder = { Text(stringResource(R.string.req_reason_placeholder)) })

                if (rules.showsAttachment(cs.type)) {
                    Label(stringResource(if (rules.attachmentRequired(cs.type)) R.string.req_photo_required else R.string.req_photo_optional))
                    val att = cs.attachment
                    if (att != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()
                            .background(c.card, RoundedCornerShape(12.dp)).border(1.dp, c.success.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).padding(10.dp)) {
                            if (att.mime.startsWith("image/")) {
                                val bmp = remember(att) { BitmapFactory.decodeByteArray(att.bytes, 0, att.bytes.size)?.asImageBitmap() }
                                bmp?.let { Image(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(52.dp)) }
                            } else Icon(Icons.Filled.Description, null, Modifier.size(32.dp))
                            Spacer(Modifier.size(10.dp))
                            Text("${att.fileName} · ${att.bytes.size / 1024} KB", fontSize = 12.sp, modifier = Modifier.weight(1f))
                            IconButton(onClick = vm::clearAttachment) { Icon(Icons.Filled.Close, stringResource(R.string.remove)) }
                        }
                    } else {
                        // Camera, gallery and files, as on iOS 0.1.6.
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = camera, modifier = Modifier.weight(1f)) { Icon(Icons.Filled.CameraAlt, null, Modifier.size(16.dp)); Spacer(Modifier.size(4.dp)); Text(stringResource(R.string.camera), fontSize = 12.sp) }
                            OutlinedButton(onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                modifier = Modifier.weight(1f)) { Icon(Icons.Filled.Photo, null, Modifier.size(16.dp)); Spacer(Modifier.size(4.dp)); Text(stringResource(R.string.gallery), fontSize = 12.sp) }
                            OutlinedButton(onClick = { files.launch(arrayOf("image/*", "application/pdf")) },
                                modifier = Modifier.weight(1f)) { Icon(Icons.Filled.AttachFile, null, Modifier.size(16.dp)); Spacer(Modifier.size(4.dp)); Text(stringResource(R.string.files), fontSize = 12.sp) }
                        }
                    }
                    cs.attachmentError?.let { Text(it, color = c.danger, fontSize = 12.sp) }
                }

                if (rules.needsLocation(cs.type)) {
                    Label(stringResource(R.string.req_location))
                    val loc = cs.location
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()
                        .background(c.card, RoundedCornerShape(12.dp)).border(1.dp, if (loc != null) c.success.copy(alpha = 0.5f) else c.border, RoundedCornerShape(12.dp)).padding(12.dp)) {
                        Icon(Icons.Filled.LocationOn, null, tint = if (loc != null) c.success else c.mutedFg)
                        Spacer(Modifier.size(8.dp))
                        Text(
                            when {
                                cs.locating -> stringResource(R.string.flow_locating)
                                loc != null -> stringResource(R.string.location_locked, String.format(Locale.ROOT, "%.5f, %.5f", loc.lat, loc.lng))
                                else -> cs.locationError ?: stringResource(R.string.location_needed)
                            },
                            fontSize = 12.sp, modifier = Modifier.weight(1f),
                        )
                        if (cs.locating) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        else if (loc == null) TextButton(onClick = {
                            locationPerm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        }) { Text(stringResource(R.string.try_again)) }
                    }
                }

                val missing = rules.missing(cs.type, cs.reason, cs.attachment != null, cs.location != null, cs.date, prefillReason = cs.prefillReason)
                if (missing == RequestRules.Missing.QUOTA) {
                    Text(stringResource(R.string.quota_none_left, 1, rules.remainingDays(cs.type) ?: 0), color = c.danger, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                cs.error?.let {
                    Text(it, color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.12f), RoundedCornerShape(10.dp)).padding(10.dp))
                }
                Spacer(Modifier.height(8.dp))
            }
            val missing = rules.missing(cs.type, cs.reason, cs.attachment != null, cs.location != null, cs.date, prefillReason = cs.prefillReason)
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                // Why the button is grey, next to the button.
                missing?.takeIf { it != RequestRules.Missing.QUOTA }?.let {
                    Text(stringResource(
                        when (it) {
                            RequestRules.Missing.REASON -> R.string.missing_reason
                            RequestRules.Missing.ATTACHMENT -> R.string.missing_photo
                            RequestRules.Missing.LOCATION -> R.string.missing_location
                            RequestRules.Missing.DATE -> R.string.missing_date
                            RequestRules.Missing.QUOTA -> R.string.missing_reason
                        },
                    ), fontSize = 11.sp, color = c.mutedFg, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp))
                }
                Button(
                    onClick = { vm.submit(onFiled) },
                    enabled = missing == null && !cs.sending, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White),
                ) {
                    if (cs.sending) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text(stringResource(R.string.req_send), fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    if (pickingDate) {
        val floor = rules.earliest(cs.type)
        val state = rememberDatePickerState(
            initialSelectedDateMillis = cs.date.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                    val d = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                    return floor == null || !d.isBefore(floor)
                }
            },
        )
        DatePickerDialog(
            onDismissRequest = { pickingDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { vm.setDate(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    pickingDate = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { pickingDate = false }) { Text(stringResource(R.string.cancel)) } },
        ) { DatePicker(state) }
    }
}

@Composable
private fun Label(text: String) = Text(text.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
    color = Nx.colors.mutedFg, letterSpacing = 1.sp)

@Composable
private fun typeHint(rules: RequestRules, type: String, vm: RequestsViewModel): String {
    val t = vm.today
    return when (type) {
        "LEAVE" -> {
            val l = t?.annualLeave
            when {
                l == null -> stringResource(R.string.hint_leave)
                l.eligible != true -> l.reason ?: stringResource(R.string.hint_leave_ineligible)
                else -> stringResource(R.string.hint_leave_left, l.remaining ?: 0, l.quota ?: 12)
            }
        }
        "SICK" -> stringResource(R.string.hint_sick)
        "PERMIT" -> stringResource(R.string.hint_permit)
        "DAY_OFF" -> rules.remainingDays(type)?.let { stringResource(R.string.hint_dayoff_left, it, t?.dayOffQuota ?: 0) }
            ?: stringResource(R.string.hint_dayoff)
        else -> rules.remainingDays(type)?.let { stringResource(R.string.hint_red_left, it, t?.redDateQuota ?: 0) }
            ?: stringResource(R.string.hint_red)
    }
}

// endregion
