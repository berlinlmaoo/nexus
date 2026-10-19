package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.NxTextField

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Control Room › Announcements › New (Batch 2, owner 29 Sep; iOS CreateAnnouncementSheet 78bfe37):
 * everyone or selected people (roster with search), an optional PDF that makes it an SP, tone, repeat.
 * A refused post keeps the sheet open with the server's reason, never closes as if it had worked.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnnouncementComposer(api: AdminMoreApi, onDismiss: () -> Unit, onPosted: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val admin = remember { AdminApi(container.api) }
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var tone by rememberSaveable { mutableStateOf("info") }
    var repeat by rememberSaveable { mutableIntStateOf(0) }
    var at by rememberSaveable { mutableStateOf("09:00") }
    var pickTime by remember { mutableStateOf(false) }
    var everyone by rememberSaveable { mutableStateOf(true) }
    var picked by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var search by rememberSaveable { mutableStateOf("") }
    var roster by remember { mutableStateOf<List<WsMember>?>(null) }
    var pdf by remember { mutableStateOf<AnnounceAttachment?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(everyone) {
        if (!everyone && roster == null) roster = runCatching { admin.roster(includeRegistered = false).members }.getOrDefault(emptyList())
    }
    val pickPdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true; problem = null
            try {
                val size = runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } }.getOrNull()
                if (size != null && size > AnnounceRules.PDF_MAX_BYTES) { problem = res.getString(R.string.an_pdf_too_big); return@launch }
                val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                if (bytes == null) { problem = res.getString(R.string.an_pdf_unreadable); return@launch }
                if (bytes.size > AnnounceRules.PDF_MAX_BYTES) { problem = res.getString(R.string.an_pdf_too_big); return@launch }
                val name = runCatching {
                    context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cur -> if (cur.moveToFirst()) cur.getString(0) else null }
                }.getOrNull() ?: "SP.pdf"
                pdf = api.uploadAttachment(name, bytes)
            } catch (e: ApiError) {
                problem = when ((e as? ApiError.Http)?.status) { 413 -> res.getString(R.string.an_pdf_too_big); 415 -> res.getString(R.string.an_pdf_not_pdf); else -> (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
            } finally { uploading = false }
        }
    }
    fun post() = scope.launch {
        busy = true; problem = null
        try { api.announce(title, body, tone, repeat, at, if (everyone) emptyList() else picked, pdf); onPosted() }
        catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        busy = false
    }

    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().imePadding()) {
            Box(Modifier.fillMaxWidth().padding(4.dp), contentAlignment = Alignment.Center) {
                TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.align(Alignment.CenterStart)) { Text(stringResource(R.string.cancel)) }
                Text(stringResource(R.string.an_new), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = c.foreground)
            }
            Column(Modifier.fillMaxSize().dismissKeyboardOnTapOrDrag().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Field(stringResource(R.string.an_f_title)) {
                    NxTextField(title, { title = it }, singleLine = true, placeholder = { Text(stringResource(R.string.an_title)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
                }
                Field(stringResource(R.string.an_f_body)) {
                    NxTextField(body, { body = it }, minLines = 3, maxLines = 8, placeholder = { Text(stringResource(R.string.an_body)) }, modifier = Modifier.fillMaxWidth())
                }
                Field(stringResource(R.string.an_f_audience)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip(stringResource(R.string.an_everyone), everyone) { everyone = true }
                        Chip(stringResource(R.string.an_selected), !everyone) { everyone = false }
                    }
                    if (!everyone) {
                        NxTextField(search, { search = it }, singleLine = true, placeholder = { Text(stringResource(R.string.an_search)) },
                            modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
                        if (picked.isNotEmpty()) Text(stringResource(R.string.an_n_selected, picked.size), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                        val r = roster
                        if (r == null) CircularProgressIndicator(Modifier.size(20.dp))
                        else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
                            val rows = AnnounceRules.rosterRows(r, search)
                            rows.forEachIndexed { i, m ->
                                val on = m.userId in picked
                                Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - m.userId else picked + m.userId }.padding(horizontal = 12.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically) {
                                    Icon(if (on) Icons.Filled.CheckCircle else Icons.Outlined.Circle, null, tint = if (on) c.violet else c.mutedFg, modifier = Modifier.size(20.dp))
                                    Spacer(Modifier.width(10.dp))
                                    Text(m.displayName, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                if (i < rows.lastIndex) HorizontalDivider(color = c.border)
                            }
                        }
                    }
                }
                Field(stringResource(R.string.an_f_pdf)) {
                    val p = pdf
                    if (p != null) Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Description, null, tint = c.danger, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(p.name ?: "SP.pdf", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.danger, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        IconButton(onClick = { pdf = null }) { Icon(Icons.Filled.Cancel, stringResource(R.string.delete), tint = c.mutedFg) }
                    } else Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.clip(CircleShape).background(c.card).border(1.dp, c.border, CircleShape).clickable(enabled = !uploading) { pickPdf.launch(arrayOf("application/pdf")) }
                            .padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (uploading) { CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(6.dp)) }
                            Text(stringResource(if (uploading) R.string.an_uploading else R.string.an_attach_pdf), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                        }
                    }
                }
                Field(stringResource(R.string.an_f_tone)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("info" to "Info", "success" to "Success", "warning" to "Warning").forEach { (k, label) -> Chip(label, tone == k) { tone = k } }
                    }
                }
                Field(stringResource(R.string.an_repeat).uppercase()) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AnnounceRules.REPEAT.forEach { d -> Chip(if (d == 0) stringResource(R.string.an_once) else stringResource(R.string.an_plus_days, d), repeat == d) { repeat = d } }
                    }
                    if (repeat > 0) {
                        TextButton(onClick = { pickTime = true }) { Text(stringResource(R.string.an_time_wib, at)) }
                        Text(stringResource(R.string.an_repeat_note), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
                val missing = AnnounceRules.missing(title, body, everyone, picked.toSet())
                Button(onClick = { post() }, enabled = !busy && !uploading && missing == null, modifier = Modifier.fillMaxWidth()) {
                    if (busy) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White); Spacer(Modifier.width(8.dp)) }
                    Text(stringResource(if (busy) R.string.an_posting else R.string.th_post))
                }
                missing?.let {
                    Text(stringResource(when (it) { AnnounceRules.Missing.TITLE -> R.string.an_missing_title; AnnounceRules.Missing.BODY -> R.string.an_missing_body; AnnounceRules.Missing.PEOPLE -> R.string.an_missing_people }),
                        fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.warning, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                }
                problem?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
    if (pickTime) {
        val st = rememberTimePickerState(at.substringBefore(':').toInt(), at.substringAfter(':').toInt(), is24Hour = true)
        AlertDialog(onDismissRequest = { pickTime = false }, text = { TimePicker(st) },
            confirmButton = { TextButton(onClick = { at = "%02d:%02d".format(st.hour, st.minute); pickTime = false }) { Text("OK") } })
    }
}

@Composable
private fun Field(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Nx.colors.mutedFg)
        content()
    }
}

@Composable
private fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg,
        modifier = Modifier.clip(CircleShape).background(if (on) c.violet else c.card).border(1.dp, if (on) Color.Transparent else c.border, CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp))
}
