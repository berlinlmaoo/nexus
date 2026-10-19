package id.znetworks.nexus.feature.presence

import id.znetworks.nexus.ui.components.NxTextField

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.*
import java.time.format.DateTimeFormatter

@Composable internal fun personPresence(userId: String?): PersonPresence? {
    val container = (LocalContext.current.applicationContext as? NexusApplication)?.container ?: return null
    val snapshot by container.presenceStatuses.state.collectAsStateWithLifecycle()
    return if (snapshot.enabled) snapshot.statuses[userId] else null
}
private fun dotColor(tone: String) = Color(when (tone) { "green" -> 0xFF10B981; "yellow" -> 0xFFFBBF24; "red" -> 0xFFF43F5E; "grey" -> 0xFF94A3B8; else -> 0xFF64748B })
@Composable internal fun PresenceDot(status: PersonPresence, size: Dp = 8.dp, outline: Boolean = false) {
    Box(Modifier.size(if (outline) size + 4.dp else size).then(if (outline) Modifier.border(2.dp, Nx.colors.background, CircleShape).padding(2.dp) else Modifier)
        .then(if (status.tone == "grey") Modifier.background(Nx.colors.background, CircleShape).border(2.dp, dotColor("grey"), CircleShape) else Modifier.background(dotColor(status.tone), CircleShape)))
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun PresenceAvatar(userId: String?, name: String?, size: Dp, content: @Composable () -> Unit) {
    val status = if (userId != null && size >= 16.dp) personPresence(userId) else null
    if (status == null) { content(); return }
    val language = ConfigBody.lang(LocalConfiguration.current.locales[0])
    val description = listOfNotNull(name?.takeIf { it.isNotBlank() }, status.label(language)).joinToString(" · ")
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(description) } }, state = rememberTooltipState()) {
        Box(Modifier.size(size).semantics(mergeDescendants = true) { contentDescription = description }) {
            content()
            Box(Modifier.align(Alignment.BottomEnd)) { PresenceDot(status, (size.value * .3f).coerceIn(7f, 16f).dp, outline = true) }
        }
    }
}
@Composable fun PresenceLine(userId: String?, chip: Boolean = false, showUntil: Boolean = true) {
    val status = personPresence(userId) ?: return
    val locale = LocalConfiguration.current.locales[0]
    val c = Nx.colors
    val until = if (showUntil) PresenceTimes.until(status.until, locale) else null
    Row(Modifier.then(if (chip) Modifier.background(dotColor(status.tone).copy(alpha = .08f), CircleShape).border(1.dp, dotColor(status.tone).copy(alpha = .2f), CircleShape).padding(horizontal = 10.dp, vertical = 5.dp) else Modifier),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        PresenceDot(status)
        Text(status.label(ConfigBody.lang(locale)) + (until?.let { " · " + stringResource(R.string.prs_until, it) } ?: ""), Modifier.weight(1f, fill = false), color = c.mutedFg, fontSize = 12.sp, softWrap = true)
    }
}
/** [card]: drawn as one of the More sheet's footer cards (web: the phone More sheet's "Set a status" row). */
@Composable fun SetStatusEntry(card: Boolean = false, home: Boolean = false) {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val snapshot by container.presenceStatuses.state.collectAsStateWithLifecycle()
    var open by remember { mutableStateOf(false) }
    if (!snapshot.enabled) return
    val status = snapshot.statuses[container.sessionStore.current?.userId]
    val shape = RoundedCornerShape(if (home) 18.dp else 12.dp)
    val frame = if (card || home) Modifier.fillMaxWidth().clip(shape).background(Nx.colors.card).border(1.dp, Nx.colors.border, shape).clickable { open = true }
        .defaultMinSize(minHeight = if (home) 72.dp else 52.dp).padding(horizontal = if (home) 14.dp else 12.dp, vertical = 8.dp)
    else Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 12.dp)
    Row(frame, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.then(if (home) Modifier.size(44.dp).background(dotColor(status?.tone ?: "grey").copy(alpha = .14f), RoundedCornerShape(14.dp)) else Modifier.size(24.dp)), contentAlignment = Alignment.Center) {
            if (status != null) PresenceDot(status, 12.dp)
            else Icon(Icons.Outlined.Circle, null, tint = Nx.colors.mutedFg)
        }
        Text(stringResource(R.string.prs_set), Modifier.weight(1f), color = Nx.colors.foreground)
        status?.let {
            Text(it.label(ConfigBody.lang(LocalConfiguration.current.locales[0])), Modifier.weight(1f),
                color = Nx.colors.mutedFg, fontSize = 12.sp, maxLines = 3,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                textAlign = androidx.compose.ui.text.style.TextAlign.End)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Nx.colors.mutedFg, modifier = Modifier.size(18.dp))
    }
    if (open) SetStatusDialog { open = false }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun SetStatusDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val snapshot by container.presenceStatuses.state.collectAsStateWithLifecycle()
    val manual = remember { snapshot.statuses[container.sessionStore.current?.userId]?.manual }
    val initial = remember { PresenceDraft.split(manual?.text.orEmpty()) }
    var text by remember { mutableStateOf(initial.second) }
    var emoji by remember { mutableStateOf(initial.first) }
    var availability by remember { mutableStateOf(manual?.availability?.lowercase()?.takeIf { it in listOf("online", "away", "dnd") }) }
    var quickPicked by remember { mutableStateOf(false) }
    var emojiMenu by remember { mutableStateOf(false) }
    var durationMenu by remember { mutableStateOf(false) }
    var startMenu by remember { mutableStateOf(false) }
    var later by remember { mutableStateOf(false) }
    var now by remember { mutableStateOf(Instant.now()) }
    var start by remember { mutableStateOf(LocalDateTime.ofInstant(now, PresenceTimes.zone)) }
    var picked by remember { mutableStateOf(start.plusHours(1)) }
    var option by remember { mutableStateOf("1h") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val c = Nx.colors
    val locale = LocalConfiguration.current.locales[0]
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = Instant.now() } }
    val from = if (later) start.atZone(PresenceTimes.zone).toInstant() else now
    val end = PresenceTimes.end(from, option, picked)
    val payload = PresenceDraft.statusText(emoji, text)
    val canSave = !busy && snapshot.enabled && PresenceDraft.canSave(payload, availability) && end > from && end > now
    fun submit(clear: Boolean) { busy = true; error = null; scope.launch {
        try { if (clear) manual?.id?.let { container.presenceStatuses.clear(it) } else container.presenceStatuses.set(payload, if (later) from else null, end, availability ?: "away"); onDismiss() }
        catch (e: ApiError) { error = (e as? ApiError.Http)?.serverMessage ?: context.getString(R.string.prs_failed); if ((e as? ApiError.Http)?.code == "PRESENCE_OFF") container.presenceStatuses.refresh() }
        finally { busy = false }
    } }
    val durations = listOf("30m" to R.string.prs_30m, "1h" to R.string.prs_1h, "2h" to R.string.prs_2h,
        "4h" to R.string.rev_status_4h, "today" to R.string.prs_today, "week" to R.string.rev_status_week, "pick" to R.string.prs_pick) +
        (if (option == "3h") listOf("3h" to R.string.ui_status_3h) else emptyList())
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.background) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) }
                Text(stringResource(R.string.ui_status_title), Modifier.weight(1f), color = c.foreground, textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontSize = 18.sp)
                TextButton(onClick = { submit(false) }, enabled = canSave) { Text(stringResource(R.string.gm_save), color = if (canSave) c.violetText else c.mutedFg) }
            }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                NxTextField(text, { text = it.take(80); quickPicked = false }, placeholder = { Text(stringResource(R.string.ui_status_placeholder)) },
                    leadingIcon = { Box {
                        TextButton(onClick = { emojiMenu = true }, enabled = !busy, modifier = Modifier.semantics { contentDescription = context.getString(R.string.ui_status_emoji) }) { Text(emoji.ifBlank { "☺" }, fontSize = 22.sp) }
                        DropdownMenu(emojiMenu, { emojiMenu = false }) {
                            listOf("🗓️", "🍽️", "🎬", "🚗", "").forEach { e -> DropdownMenuItem(text = { Text(e.ifBlank { context.getString(R.string.ui_status_no_emoji) }) }, onClick = { emoji = e; emojiMenu = false }) }
                        }
                    } }, supportingText = { Text("${payload.length}/80", color = if (payload.length > 80) c.dangerText else c.mutedFg) }, enabled = !busy, isError = payload.length > 80, modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.ui_status_availability), color = c.mutedFg, fontSize = 12.sp)
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    // Material measures the label with the whole segment width; reserve its icon and padding.
                    val labelWidth = (maxWidth / 3 - 16.dp - SegmentedButtonDefaults.IconSize - 8.dp).coerceAtLeast(1.dp)
                    val labelHeight = with(androidx.compose.ui.platform.LocalDensity.current) { 32.sp.toDp() }
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        listOf(Triple("online", R.string.ui_status_online, "green"), Triple("away", R.string.ui_status_away, "yellow"), Triple("dnd", R.string.ui_status_dnd, "red")).forEachIndexed { index, (value, label, tone) ->
                            SegmentedButton(selected = availability == value, onClick = { availability = value; if (quickPicked) { text = ""; emoji = ""; quickPicked = false } }, enabled = !busy,
                                modifier = Modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
                                shape = SegmentedButtonDefaults.itemShape(index, 3), icon = { Box(Modifier.requiredSize(7.dp).background(dotColor(tone), CircleShape)) }) {
                                // Its intrinsic-height layout otherwise reserves only the first wrapped line.
                                Box(Modifier.widthIn(max = labelWidth).height(labelHeight), contentAlignment = Alignment.Center) {
                                    Text(stringResource(label), maxLines = 2, softWrap = true, fontSize = 12.sp, lineHeight = 16.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                                }
                            }
                        }
                    }
                }
                Text(stringResource(R.string.ui_status_quick), color = c.mutedFg, fontSize = 12.sp)
                Column {
                    listOf(Triple("🗓️", R.string.prs_meeting, "1h"), Triple("🍽️", R.string.prs_lunch, "1h"), Triple("🎬", R.string.prs_shoot, "3h"), Triple("🚗", R.string.ui_status_road, "1h")).forEach { (e, label, duration) ->
                        val suggestion = stringResource(label)
                        ListItem(headlineContent = { Text(suggestion) }, leadingContent = { Text(e, fontSize = 22.sp) },
                            trailingContent = { Text(stringResource(if (duration == "3h") R.string.ui_status_3h else R.string.prs_1h), color = c.mutedFg, fontSize = 12.sp) },
                            colors = ListItemDefaults.colors(containerColor = c.background), modifier = Modifier.clickable(enabled = !busy) { text = suggestion; emoji = e; option = duration; availability = "away"; quickPicked = true })
                    }
                }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).padding(horizontal = 12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.prs_clear_after), Modifier.weight(1f), color = c.foreground)
                    Box {
                        TextButton(onClick = { durationMenu = true }, enabled = !busy) { Text(stringResource(durations.first { it.first == option }.second) + " ▾") }
                        DropdownMenu(durationMenu, { durationMenu = false }) { durations.forEach { (key, label) -> DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = { option = key; durationMenu = false }) } }
                    }
                }
                if (option == "pick") PresenceDateTime(picked, !busy) { picked = it }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.ui_status_starts), Modifier.weight(1f), color = c.foreground)
                    Box {
                        TextButton(onClick = { startMenu = true }, enabled = !busy) { Text(stringResource(if (later) R.string.prs_later else R.string.prs_now) + " ▾") }
                        DropdownMenu(startMenu, { startMenu = false }) {
                            listOf(false to R.string.prs_now, true to R.string.prs_later).forEach { (value, label) -> DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = { later = value; startMenu = false }) }
                        }
                    }
                }
                if (later) PresenceDateTime(start, !busy) { start = it }
                }
                val format = remember(locale) { DateTimeFormatter.ofPattern("EEE d MMM HH:mm", locale) }
                Text(if (later) from.atZone(PresenceTimes.zone).format(format) + " – " + end.atZone(PresenceTimes.zone).format(format) + " WIB"
                    else stringResource(R.string.ui_status_until, end.atZone(PresenceTimes.zone).format(format) + " WIB"), color = c.mutedFg, fontSize = 12.sp)
                error?.let { Text(it, color = c.dangerText) }
                if (manual != null) TextButton(onClick = { submit(true) }, enabled = !busy) { Text(stringResource(R.string.prs_clear), color = c.dangerText) }
            }
        }
    }
}
@Composable private fun PresenceDateTime(value: LocalDateTime, enabled: Boolean, change: (LocalDateTime) -> Unit) {
    val context = LocalContext.current
    Row {
        TextButton(onClick = { DatePickerDialog(context, { _, y, m, d -> change(LocalDateTime.of(LocalDate.of(y, m + 1, d), value.toLocalTime())) }, value.year, value.monthValue - 1, value.dayOfMonth).show() }, enabled = enabled) { Text(value.toLocalDate().toString()) }
        TextButton(onClick = { TimePickerDialog(context, { _, h, m -> change(value.withHour(h).withMinute(m)) }, value.hour, value.minute, true).show() }, enabled = enabled) { Text(value.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")) + " WIB") }
    }
}
