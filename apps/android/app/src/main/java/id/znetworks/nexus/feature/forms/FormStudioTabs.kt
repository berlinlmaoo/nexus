package id.znetworks.nexus.feature.forms

import android.content.ClipData
import android.content.Intent
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.filled.Download
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.vector.ImageVector
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.CompactSearchField
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.Segmented
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

/** A project member the studio can notify or route to. */
data class StudioMember(val id: String, val name: String, val avatar: String?)

// region Settings tab

/** The web's Settings tab (iOS FormStudioSettingsTab): who can fill it in, when it's open, responses, after sending, notify people. */
@Composable
fun FormStudioSettingsTab(draft: FormStudioDraft, projectName: String, members: List<StudioMember>, responseCount: Int,
                          onEdit: ((FormStudioDraft) -> FormStudioDraft) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AccessCard(draft, projectName, onEdit)
        ScheduleCard(draft.schedule) { f -> onEdit { it.copy(schedule = f(it.schedule)) } }
        ResponsesCard(draft.settings, responseCount) { f -> onEdit { it.copy(settings = f(it.settings)) } }
        AfterCard(draft.settings) { f -> onEdit { it.copy(settings = f(it.settings)) } }
        NotifyCard(draft.settings.notifyUserIds, members) { ids -> onEdit { it.copy(settings = it.settings.copy(notifyUserIds = ids)) } }
    }
}

@Composable
private fun AccessCard(draft: FormStudioDraft, projectName: String, onEdit: ((FormStudioDraft) -> FormStudioDraft) -> Unit) {
    StudioCard(stringResource(R.string.fs_who)) {
        AccessOption(draft.isPublic, Icons.Outlined.Link, stringResource(R.string.fs_anyone), stringResource(R.string.fs_anyone_sub)) { onEdit { it.copy(isPublic = true) } }
        AccessOption(!draft.isPublic, Icons.Outlined.Group, stringResource(R.string.fs_members_only),
            stringResource(R.string.fs_members_only_sub, projectName.ifEmpty { stringResource(R.string.fs_this_project) })) { onEdit { it.copy(isPublic = false) } }
        StudioSwitch(stringResource(R.string.fb_require_auth), stringResource(R.string.fb_require_auth_sub), draft.requireAuth) { v -> onEdit { it.copy(requireAuth = v) } }
        if (draft.requireAuth) StudioNote(stringResource(R.string.fs_require_note), icon = Icons.Filled.Lock)
    }
}

@Composable
private fun AccessOption(on: Boolean, icon: ImageVector, title: String, hint: String, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(if (on) c.muted.copy(alpha = 0.6f) else c.card)
        .border(1.dp, if (on) c.foreground.copy(alpha = 0.6f) else c.border, shape)
        .clickable(role = Role.RadioButton, onClick = onClick).semantics { selected = on }.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, null, tint = c.foreground, modifier = Modifier.size(15.dp))
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
            if (on) Icon(Icons.Filled.Check, null, tint = c.foreground, modifier = Modifier.size(16.dp))
        }
        Text(hint, fontSize = 13.sp, color = c.mutedFg)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduleCard(s: BuilderSchedule, edit: ((BuilderSchedule) -> BuilderSchedule) -> Unit) {
    val c = Nx.colors
    var picking by remember { mutableStateOf<String?>(null) } // "start" | "end"
    StudioCard(stringResource(R.string.fs_when), hint = stringResource(R.string.fs_times_in, s.timezone)) {
        Text(stringResource(R.string.fb_status), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
        Segmented(listOf("" to stringResource(R.string.fb_auto), "open" to stringResource(R.string.fb_force_open), "closed" to stringResource(R.string.fb_force_closed)),
            s.override, { v -> edit { it.copy(override = v) } })
        StudioNote(stringResource(when (s.override) { "open" -> R.string.fs_hint_open; "closed" -> R.string.fs_hint_closed; else -> R.string.fs_hint_auto }))
        Column(Modifier.alpha(if (s.override.isEmpty()) 1f else 0.5f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            InstantRow(stringResource(R.string.fs_opens), stringResource(R.string.fs_right_away), s.opensAt) { v -> edit { it.copy(opensAt = v) } }
            InstantRow(stringResource(R.string.fs_closes), stringResource(R.string.fs_never), s.closesAt) { v -> edit { it.copy(closesAt = v) } }
            HorizontalDivider(color = c.border)
            StudioSwitch(stringResource(R.string.fs_certain_days), if (s.override.isNotEmpty()) stringResource(R.string.fs_ignored_forced) else null, s.enabled) { on ->
                edit { it.switched(on) }
            }
            if (s.enabled) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FormVocab.DAYS.forEachIndexed { i, d ->
                        val on = i in s.days
                        Box(Modifier.defaultMinSize(minWidth = 44.dp, minHeight = 34.dp).clip(CircleShape).background(if (on) c.onyx else c.card)
                            .border(1.dp, if (on) c.onyx else c.border, CircleShape)
                            .clickable(role = Role.Checkbox) { edit { sc -> sc.copy(days = if (i in sc.days) sc.days - i else (sc.days + i).sorted()) } }
                            .semantics { selected = on }.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                            Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault()), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                                color = if (on) c.background else c.mutedFg, maxLines = 1)
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NxButton(s.start, { picking = "start" }, compact = true)
                    Text("–", color = c.mutedFg)
                    NxButton(s.end, { picking = "end" }, compact = true)
                }
            }
        }
    }
    picking?.let { which ->
        val cur = if (which == "start") s.start else s.end
        TimeDialog(cur.substringBefore(':').toIntOrNull() ?: 0, cur.substringAfter(':').toIntOrNull() ?: 0,
            title = stringResource(if (which == "start") R.string.fs_from else R.string.fs_until), onDismiss = { picking = null }) { h, m ->
            val v = "%02d:%02d".format(h, m)
            edit { if (which == "start") it.copy(start = v) else it.copy(end = v) }
            picking = null
        }
    }
}

private val INSTANT_TEXT = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/** Opens / Closes: an ISO instant shown in the phone's time, or nothing ("Right away" / "Never"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InstantRow(title: String, empty: String, value: String, onChange: (String) -> Unit) {
    val c = Nx.colors
    val at = FormInstant.parse(value)
    var step by remember { mutableStateOf(0) } // 1 = date, 2 = time
    var day by remember { mutableStateOf<LocalDate?>(null) }
    val zone = ZoneId.systemDefault()
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, fontSize = 15.sp, color = c.foreground, modifier = Modifier.width(72.dp))
        if (at != null) {
            NxButton(INSTANT_TEXT.withLocale(Locale.getDefault()).format(at.atZone(zone)), { step = 1 }, compact = true, modifier = Modifier.weight(1f, fill = false))
            val clear = stringResource(R.string.fs_clear)
            Box(Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = clear) { onChange("") }
                .semantics { contentDescription = clear }, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Cancel, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
            }
        } else NxButton(empty, { onChange(FormInstant.string(FormInstant.nextHour(Instant.now()))) }, compact = true)
    }
    if (step == 1 && at != null) {
        val local = at.atZone(zone)
        val st = rememberDatePickerState(initialSelectedDateMillis = local.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { step = 0 },
            confirmButton = { TextButton(onClick = {
                day = st.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } ?: local.toLocalDate(); step = 2
            }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(st) }
    }
    if (step == 2 && at != null) {
        val local = at.atZone(zone)
        TimeDialog(local.hour, local.minute, title, onDismiss = { step = 0 }) { h, m ->
            val d = day ?: local.toLocalDate()
            onChange(FormInstant.string(d.atTime(LocalTime.of(h, m)).atZone(zone).toInstant()))
            step = 0
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeDialog(hour: Int, minute: Int, title: String, onDismiss: () -> Unit, onPick: (Int, Int) -> Unit) {
    val st = rememberTimePickerState(hour, minute, is24Hour = true)
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { TimePicker(st) },
        confirmButton = { TextButton(onClick = { onPick(st.hour, st.minute) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun ResponsesCard(st: FormStudioSettings, responseCount: Int, edit: ((FormStudioSettings) -> FormStudioSettings) -> Unit) {
    val c = Nx.colors
    // Clearing the box to type a new number keeps the limit on: only a whole number above 0 is saved.
    var text by remember { mutableStateOf("") }
    StudioCard(stringResource(R.string.fr_title)) {
        StudioSwitch(stringResource(R.string.fs_limit), stringResource(R.string.fs_so_far, responseCount), st.responseLimit > 0) { on ->
            val n = if (on) FormStudioLogic.defaultLimit(responseCount) else 0
            text = if (on) n.toString() else ""
            edit { it.copy(responseLimit = n) }
        }
        if (st.responseLimit > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StudioInput(null, text.ifEmpty { st.responseLimit.toString() }, { v ->
                val digits = v.filter { it.isDigit() }.take(7)
                text = digits
                digits.toIntOrNull()?.takeIf { it > 0 }?.let { n -> edit { s -> s.copy(responseLimit = n) } }
            }, stringResource(R.string.fs_max), keyboard = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(120.dp))
            Text(stringResource(R.string.fs_then_closes), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun AfterCard(st: FormStudioSettings, edit: ((FormStudioSettings) -> FormStudioSettings) -> Unit) {
    StudioCard(stringResource(R.string.fs_after), hint = stringResource(R.string.fs_after_hint)) {
        StudioInput(stringResource(R.string.fs_button_text), st.submitLabel, { v -> edit { it.copy(submitLabel = v.take(FormStudioSettings.MAX_SUBMIT)) } },
            stringResource(R.string.fs_send))
        StudioInput(stringResource(R.string.fs_conf_title), st.confirmationTitle, { v -> edit { it.copy(confirmationTitle = v.take(FormStudioSettings.MAX_TITLE)) } },
            stringResource(R.string.fs_conf_title_ph))
        StudioInput(stringResource(R.string.fs_conf_msg), st.confirmationMessage, { v -> edit { it.copy(confirmationMessage = v.take(FormStudioSettings.MAX_MESSAGE)) } },
            stringResource(R.string.fs_conf_msg_ph), singleLine = false, minHeight = 88.dp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotifyCard(ids: List<String>, members: List<StudioMember>, onChange: (List<String>) -> Unit) {
    val c = Nx.colors
    var who by remember { mutableStateOf("") }
    StudioCard(stringResource(R.string.fs_notify), hint = stringResource(R.string.fs_notify_hint)) {
        if (ids.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ids.forEach { id ->
                val m = members.firstOrNull { it.id == id }
                val name = m?.name ?: stringResource(R.string.fs_former_member)
                Row(Modifier.clip(CircleShape).background(c.muted.copy(alpha = 0.6f)).border(1.dp, c.border, CircleShape).padding(start = 3.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Avatar(name, m?.avatar, size = 20.dp)
                    Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                    val label = stringResource(R.string.fs_remove_person, name)
                    Box(Modifier.size(28.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = label) { onChange(ids - id) }
                        .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, null, tint = c.mutedFg, modifier = Modifier.size(12.dp))
                    }
                }
            }
        }
        CompactSearchField(who, { who = it }, stringResource(R.string.fs_search_members), Modifier.fillMaxWidth())
        val q = who.trim().lowercase()
        val list = members.sortedBy { it.name.lowercase() }.let { all -> if (q.isEmpty()) all else all.filter { it.name.lowercase().contains(q) } }
        val shape = RoundedCornerShape(8.dp)
        Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, c.border, shape).padding(4.dp)) {
            if (list.isEmpty()) Text(stringResource(R.string.fs_no_members_match), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(12.dp))
            list.take(if (q.isEmpty()) 12 else 50).forEach { m ->
                val on = m.id in ids
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
                    .clickable(role = Role.Checkbox) { onChange(if (on) ids - m.id else ids + m.id) }.semantics { selected = on }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(m.name, m.avatar, size = 24.dp)
                    Text(m.name, fontSize = 15.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Icon(if (on) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, null, tint = if (on) c.onyx else c.mutedFg, modifier = Modifier.size(20.dp))
                }
            }
            if (q.isEmpty() && list.size > 12) Text(stringResource(R.string.fs_more_search, list.size - 12), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(10.dp))
        }
    }
}

// endregion

// region Share tab

/** The web's Share tab: the link (copy, open, share), who it works for, and its QR code. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FormStudioShareTab(link: String?, isPublic: Boolean, onOpen: () -> Unit, onGoSettings: () -> Unit, onGoQuestions: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    if (link == null) {
        EmptyState(Icons.Outlined.Link, stringResource(R.string.fs_no_link), stringResource(R.string.fs_no_link_sub), stringResource(R.string.fs_go_questions), onGoQuestions)
        return
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp)) {
        StudioCard(stringResource(R.string.fs_form_link)) {
            Text(link, fontSize = 14.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.muted.copy(alpha = 0.5f))
                    .border(1.dp, c.border, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NxButton(stringResource(if (copied) R.string.fs_copied else R.string.fb_copy_link), {
                    scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("form", link))) }
                    copied = true
                }, kind = NxButtonKind.PRIMARY, icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy)
                NxButton(stringResource(R.string.fs_open), onOpen, icon = Icons.AutoMirrored.Filled.OpenInNew)
                NxButton(stringResource(R.string.fb_share), {
                    runCatching {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), null)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }, icon = Icons.Filled.Share)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(if (isPublic) Icons.Outlined.Link else Icons.Outlined.Group, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
                Text(stringResource(if (isPublic) R.string.fs_link_public else R.string.fs_link_members), fontSize = 13.sp, color = c.mutedFg,
                    modifier = Modifier.weight(1f, fill = false))
                Text(stringResource(R.string.fs_change), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                    modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable(role = Role.Button, onClick = onGoSettings).padding(4.dp))
            }
        }
        Spacer(Modifier.height(16.dp))
        val qr = remember(link) { FormQR.bitmap(link) }
        if (qr != null) StudioCard(stringResource(R.string.fs_qr_title), stringResource(R.string.fs_qr_hint)) {
            val a11y = stringResource(R.string.fs_qr_a11y)
            val shareTitle = stringResource(R.string.fs_qr_title)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Always black on white: phone cameras read that best, in dark mode too.
                Image(qr.asImageBitmap(), a11y, filterQuality = FilterQuality.None,
                    modifier = Modifier.background(Color.White, RoundedCornerShape(10.dp)).padding(12.dp).size(200.dp))
                NxButton(stringResource(R.string.fs_qr_share), { runCatching { FormQR.share(context, qr, shareTitle) } }, compact = true, icon = Icons.Filled.Download)
            }
        }
    }
}

// endregion
