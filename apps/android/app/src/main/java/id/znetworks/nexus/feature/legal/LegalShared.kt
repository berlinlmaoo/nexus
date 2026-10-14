package id.znetworks.nexus.feature.legal

import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Work
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
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// Legal's shared pieces (owner, 14 Oct 2026; iOS LegalShared.swift, web legal-labels.ts): labels and colours, the
// toast, the status chip, form rows, the menu picker, the "Belongs to" picker, word-diff text and file hand-off.

@Composable
fun rememberLegalApi(): LegalApi {
    val ctx = LocalContext.current
    val c = (ctx.applicationContext as NexusApplication).container
    return remember { LegalApi(ctx.applicationContext, c.api) }
}

/** A failed Legal call in words: the server's sentence, else the house fallback. */
fun legalMessage(context: Context, e: Throwable): String =
    (e as? ApiError)?.describe(context.resources) ?: context.getString(R.string.lg_something_wrong)

// ── Labels ──

@Composable
fun lgDocType(type: String): String = when (type) {
    "SURAT" -> stringResource(R.string.lg_type_surat)
    "SP" -> stringResource(R.string.lg_type_sp)
    "SK" -> stringResource(R.string.lg_type_sk)
    "PKS" -> stringResource(R.string.lg_type_pks)
    "SPK" -> stringResource(R.string.lg_type_spk)
    "NDA" -> stringResource(R.string.lg_type_nda)
    "MOU" -> stringResource(R.string.lg_type_mou)
    "ADD" -> stringResource(R.string.lg_type_add)
    "INVOICE" -> stringResource(R.string.lg_type_invoice)
    "PJM" -> stringResource(R.string.lg_type_pjm)
    "PGB" -> stringResource(R.string.lg_type_pgb)
    "OTHER" -> stringResource(R.string.lg_type_other)
    else -> type
}

@Composable
fun lgDocTypeOptions(): List<Pair<String, String>> = LegalLogic.DOC_TYPES.map { it to lgDocType(it) }

@Composable
fun lgStatus(status: String): String = when (status) {
    "DRAFT" -> stringResource(R.string.lg_status_draft)
    "FINAL" -> stringResource(R.string.lg_status_final)
    "SENT" -> stringResource(R.string.lg_status_sent)
    "SIGNED" -> stringResource(R.string.lg_status_signed)
    "VOID" -> stringResource(R.string.lg_status_void)
    else -> status
}

@Composable
fun lgStatusOptions(): List<Pair<String, String>> = LegalLogic.STATUSES.map { it to lgStatus(it) }

@Composable
fun lgFieldType(type: String): String = when (type) {
    "text" -> stringResource(R.string.lg_ft_text)
    "longtext" -> stringResource(R.string.lg_ft_longtext)
    "date" -> stringResource(R.string.lg_ft_date)
    "number" -> stringResource(R.string.lg_ft_number)
    "money" -> stringResource(R.string.lg_ft_money)
    "select" -> stringResource(R.string.lg_ft_select)
    "boolean" -> stringResource(R.string.lg_ft_boolean)
    "list" -> stringResource(R.string.lg_ft_list)
    else -> type
}

@Composable
fun lgVersionKind(kind: String): String = when (kind) {
    "GENERATED" -> stringResource(R.string.lg_kind_generated)
    "MANUAL" -> stringResource(R.string.lg_kind_manual)
    "GIDEON" -> "GIDEON"
    "UPLOAD" -> stringResource(R.string.lg_kind_upload)
    "RESTORE" -> stringResource(R.string.lg_kind_restore)
    else -> kind
}

@Composable
fun lgResetPeriod(p: String): String = stringResource(if (p == "MONTH") R.string.lg_monthly else R.string.lg_yearly)

@Composable
fun lgStage(stage: String): String = when (stage) {
    "RECEIVED" -> stringResource(R.string.lg_stage_received)
    "IN_PROGRESS" -> stringResource(R.string.lg_stage_in_progress)
    "REVISION" -> stringResource(R.string.lg_stage_revision)
    "FINAL" -> stringResource(R.string.lg_status_final)
    "SIGNED" -> stringResource(R.string.lg_status_signed)
    "DONE" -> stringResource(R.string.lg_stage_done)
    "REJECTED" -> stringResource(R.string.lg_rejected)
    else -> stage
}

@Composable
fun lgColumn(col: String): String = when (col) {
    "TODO" -> stringResource(R.string.lg_col_todo)
    "IN_PROGRESS" -> stringResource(R.string.lg_col_in_progress)
    "DONE" -> stringResource(R.string.lg_col_done)
    else -> col
}

/** A tone: text colour and its soft background. */
data class LgTone(val fg: Color, val bg: Color)

@Composable
fun lgTone(kind: String): LgTone {
    val c = Nx.colors
    return when (kind) {
        "info" -> LgTone(c.blue, c.blue.copy(alpha = 0.12f))
        "warning" -> LgTone(c.warningFg, c.warning.copy(alpha = 0.16f))
        "success" -> LgTone(c.success, c.success.copy(alpha = 0.14f))
        "danger" -> LgTone(c.dangerText, c.danger.copy(alpha = 0.12f))
        "accent" -> LgTone(c.violetText, c.violet.copy(alpha = 0.14f))
        else -> LgTone(c.mutedFg, c.muted)
    }
}

/** A quiet draft, a blue final, an amber sent, a green signed, a struck-through void. */
@Composable
fun lgStatusTone(status: String): LgTone = when (status) {
    "FINAL" -> lgTone("info")
    "SENT" -> lgTone("warning")
    "SIGNED" -> lgTone("success")
    "DRAFT" -> LgTone(Nx.colors.foreground, Nx.colors.muted)
    else -> lgTone("neutral")
}

@Composable
fun lgStageTone(stage: String): LgTone = when (stage) {
    "IN_PROGRESS", "REVISION" -> lgTone("info")
    "FINAL" -> lgTone("accent")
    "SIGNED", "DONE" -> lgTone("success")
    "REJECTED" -> lgTone("danger")
    else -> lgTone("neutral")
}

/** "2026-09-30" → "30 Sep 2026" in the interface language. */
fun lgDay(day: String?): String = LegalLogic.parseDay(day)?.let { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(it) } ?: "—"

/** An ISO timestamp → "14 Oct" this year, "14 Oct 2025" otherwise, in Jakarta. */
fun lgDate(iso: String?): String {
    val d = LegalLogic.parseInstant(iso)?.atZone(LegalLogic.JAKARTA) ?: return "—"
    val thisYear = d.year == Instant.now().atZone(LegalLogic.JAKARTA).year
    return DateTimeFormatter.ofPattern(if (thisYear) "d MMM" else "d MMM yyyy", Locale.getDefault()).format(d)
}

fun lgBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${Math.round(n / 1024.0)} KB"
    else -> String.format(Locale.US, "%.1f MB", n / 1024.0 / 1024.0)
}

val LgMono = FontFamily.Monospace

// ── Toasts ──

/** One line of feedback after a write: green done, amber warning (e.g. the PDF couldn't be made), red failure. */
object LegalToasts {
    enum class Tone { SUCCESS, WARNING, FAILURE }
    data class Item(val text: String, val tone: Tone, val at: Long = System.nanoTime())
    val item = MutableStateFlow<Item?>(null)
    fun success(text: String) { item.value = Item(text, Tone.SUCCESS) }
    fun warning(text: String) { item.value = Item(text, Tone.WARNING) }
    fun failure(text: String) { item.value = Item(text, Tone.FAILURE) }
    fun failure(context: Context, e: Throwable) = failure(legalMessage(context, e))
    /** A non-null `pdfError` from a write: the DOCX is there, the PDF can be retried. */
    fun pdfWarning(context: Context, reason: String?) {
        if (!reason.isNullOrBlank()) warning(context.getString(R.string.lg_pdf_not_yet, reason))
    }
}

/** Legal's toasts, at the bottom of the screen that draws this. */
@Composable
fun BoxScope.LegalToastHost() {
    val item by LegalToasts.item.collectAsState()
    val c = Nx.colors
    LaunchedEffect(item) {
        val shown = item ?: return@LaunchedEffect
        delay(4500)
        if (LegalToasts.item.value == shown) LegalToasts.item.value = null
    }
    AnimatedVisibility(item != null, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).imePadding()) {
        val t = item ?: return@AnimatedVisibility
        val (icon, tint) = when (t.tone) {
            LegalToasts.Tone.SUCCESS -> Icons.Filled.CheckCircle to c.success
            LegalToasts.Tone.WARNING -> Icons.Filled.Warning to c.warning
            LegalToasts.Tone.FAILURE -> Icons.Filled.Error to c.danger
        }
        Row(Modifier.padding(16.dp).widthIn(max = 520.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card)
            .border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text(t.text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.Close, stringResource(R.string.close), tint = c.mutedFg,
                modifier = Modifier.size(18.dp).clickable { LegalToasts.item.value = null })
        }
    }
}

// ── Small pieces ──

@Composable
fun LgChip(text: String, tone: LgTone, struck: Boolean = false) {
    Text(text, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = tone.fg, maxLines = 1,
        textDecoration = if (struck) TextDecoration.LineThrough else null,
        modifier = Modifier.clip(CircleShape).background(tone.bg).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
fun LgStatusChip(status: String) = LgChip(lgStatus(status), lgStatusTone(status), struck = status == "VOID")

@Composable
fun LgStageChip(stage: String) = LgChip(lgStage(stage), lgStageTone(stage))

/** A rounded hairline card (the web's `rounded-lg border bg-card`). */
@Composable
fun LgCard(modifier: Modifier = Modifier, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(padding),
        verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

/** List rows in one card, hairlines between them. */
@Composable
fun <T> LgListCard(items: List<T>, modifier: Modifier = Modifier, row: @Composable (T) -> Unit) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
        items.forEachIndexed { i, t ->
            if (i > 0) HorizontalDivider(color = c.border)
            row(t)
        }
    }
}

/** A labelled form row: the label above the control, an optional hint or error below. */
@Composable
fun LgFormRow(label: String, required: Boolean = false, mono: String? = null, hint: String? = null, error: String? = null, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            if (required) Text(" *", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.danger)
            if (mono != null) Text("  $mono", fontSize = 10.sp, fontFamily = LgMono, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        content()
        if (!error.isNullOrEmpty()) Text(error, fontSize = 12.sp, color = c.danger)
        else if (!hint.isNullOrEmpty()) Text(hint, fontSize = 12.sp, color = c.mutedFg)
    }
}

/** Legal's text field: a compact outlined box on the page's background. */
@Composable
fun LgTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    invalid: Boolean = false,
    enabled: Boolean = true,
    mono: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    prefix: String? = null,
    label: String? = null,
) {
    val c = Nx.colors
    OutlinedTextField(
        value, onValueChange, modifier.fillMaxWidth(), enabled = enabled, singleLine = singleLine, minLines = minLines,
        maxLines = if (singleLine) 1 else 8, isError = invalid,
        textStyle = TextStyle(fontSize = 14.sp, color = c.foreground, fontFamily = if (mono) LgMono else null),
        placeholder = placeholder?.let { p -> { Text(p, fontSize = 14.sp, color = c.mutedFg) } },
        label = label?.let { l -> { Text(l) } },
        prefix = prefix?.let { p -> { Text(p, fontSize = 14.sp, color = c.mutedFg) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        shape = RoundedCornerShape(10.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.violet, unfocusedBorderColor = c.border,
            focusedContainerColor = c.background, unfocusedContainerColor = c.background, disabledContainerColor = c.muted.copy(alpha = 0.4f)),
    )
}

/** The chrome of a field-like button (menus, pickers): bordered, rounded, 44 dp. */
@Composable
fun LgFieldBox(modifier: Modifier = Modifier, invalid: Boolean = false, enabled: Boolean = true, onClick: () -> Unit, content: @Composable RowScope.() -> Unit) {
    val c = Nx.colors
    Row(modifier.clip(RoundedCornerShape(10.dp)).background(c.background)
        .border(1.dp, if (invalid) c.danger.copy(alpha = 0.7f) else c.border, RoundedCornerShape(10.dp))
        .clickable(enabled = enabled, onClick = onClick).defaultMinSize(minHeight = 44.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
}

/** A menu that picks one of [options] (value, label), or "all" / nothing when [noneLabel] is given. */
@Composable
fun LgMenuPicker(
    options: List<Pair<String, String>>,
    selection: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    noneLabel: String? = null,
    placeholder: String = "",
    invalid: Boolean = false,
    compact: Boolean = false,
    enabled: Boolean = true,
) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.first == selection }?.second ?: noneLabel ?: placeholder
    Box(modifier) {
        LgFieldBox(if (compact) Modifier else Modifier.fillMaxWidth(), invalid = invalid, enabled = enabled, onClick = { open = true }) {
            Text(current, fontSize = if (compact) 13.sp else 14.sp, fontWeight = if (compact) FontWeight.Medium else FontWeight.Normal,
                color = if (selection == null && noneLabel == null) c.mutedFg else c.foreground.copy(alpha = if (enabled) 1f else 0.5f),
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = if (compact) Modifier.widthIn(max = 220.dp) else Modifier.weight(1f))
            Icon(Icons.Filled.UnfoldMore, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(open, { open = false }) {
            if (noneLabel != null) DropdownMenuItem(text = { Text(noneLabel) }, onClick = { open = false; onSelect(null) },
                leadingIcon = { if (selection == null) Icon(Icons.Filled.Check, null) })
            options.forEach { (v, l) ->
                DropdownMenuItem(text = { Text(l) }, onClick = { open = false; onSelect(v) }, leadingIcon = { if (selection == v) Icon(Icons.Filled.Check, null) })
            }
        }
    }
}

/** A switch with its label (the web's `<Switch/> label`). */
@Composable
fun LgToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = Nx.colors
    Row(modifier.clickable(enabled = enabled) { onChange(!checked) }.defaultMinSize(minHeight = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f, fill = false).padding(end = 10.dp))
        Switch(checked, onChange, enabled = enabled, colors = SwitchDefaults.colors(checkedTrackColor = c.violet))
    }
}

/** A red box listing what to fix (a template's problems, form errors not tied to a field). */
@Composable
fun LgProblemList(lines: List<String>, title: String? = null) {
    if (lines.isEmpty()) return
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.danger.copy(alpha = 0.06f))
        .border(1.dp, c.danger.copy(alpha = 0.35f), RoundedCornerShape(10.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, null, tint = c.danger, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
        }
        lines.forEach { Text("•  $it", fontSize = 13.sp, color = c.danger) }
    }
}

/** A section heading inside a Legal pane: title, a muted line under it, and an action on the right. */
@Composable
fun LgSectionHeader(title: String, subtitle: String? = null, trailing: @Composable RowScope.() -> Unit = {}) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, fontSize = 13.sp, color = c.mutedFg)
        }
        trailing()
    }
}

@Composable
fun LgLoadingRow() {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(8.dp))
        Text(stringResource(R.string.lg_loading), fontSize = 13.sp, color = c.mutedFg)
    }
}

@Composable
fun LgSmallSpinner(color: Color = Nx.colors.mutedFg) = CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = color)

/** "Legal is by invitation only": a refused /api/legal call (403 LEGAL_NOT_INVITED) or no Legal in the roster. */
@Composable
fun LgNotInvited(onBack: () -> Unit, modifier: Modifier = Modifier) =
    EmptyState(Icons.Filled.Lock, stringResource(R.string.lg_not_invited_title), stringResource(R.string.lg_not_invited_body),
        stringResource(R.string.back), onBack, modifier)

/** A failed load: invitation-only for a 403, else the reason with Try again. */
@Composable
fun LgLoadError(error: Throwable, title: String, onRetry: () -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    if ((error as? ApiError)?.legalNotInvited() == true) LgNotInvited(onBack, modifier)
    else EmptyState(Icons.Filled.Warning, title, legalMessage(ctx, error), stringResource(R.string.try_again), onRetry, modifier)
}

/** Words removed struck through in red, words added highlighted in green. */
@Composable
fun lgSegments(segments: List<LgSegment>): AnnotatedString {
    val c = Nx.colors
    return buildAnnotatedString {
        segments.forEach { s ->
            when (s.type) {
                "del" -> pushStyle(SpanStyle(color = c.dangerText, background = c.danger.copy(alpha = 0.14f), textDecoration = TextDecoration.LineThrough))
                "ins" -> pushStyle(SpanStyle(color = c.success, background = c.success.copy(alpha = 0.16f)))
                else -> pushStyle(SpanStyle())
            }
            append(s.text)
            pop()
        }
    }
}

// ── Dates ──

/** A calendar day picker: "Pick a date" until one is set, then the day and (when [clearable]) ✕. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LgDayField(day: String?, onChange: (String?) -> Unit, clearable: Boolean = true, invalid: Boolean = false, modifier: Modifier = Modifier) {
    val c = Nx.colors
    var picking by remember { mutableStateOf(false) }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        LgFieldBox(Modifier.weight(1f), invalid = invalid, onClick = { picking = true }) {
            Icon(Icons.Filled.CalendarMonth, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
            Text(if (day == null) stringResource(R.string.lg_pick_date) else lgDay(day), fontSize = 14.sp,
                color = if (day == null) c.mutedFg else c.foreground, modifier = Modifier.weight(1f))
        }
        if (day != null && clearable) IconButton(onClick = { onChange(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.lg_clear), tint = c.mutedFg) }
    }
    if (picking) {
        val initial = (LegalLogic.parseDay(day) ?: LegalLogic.parseDay(LegalLogic.todayJakarta()))!!
        val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false }, confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                picking = false
            }) { Text(stringResource(android.R.string.ok)) }
        }, dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(state) }
    }
}

// ── Belongs to (a project or a Pipeline deal) ──

sealed interface LgLink {
    val id: String
    val label: String
    data class Project(override val id: String, override val label: String) : LgLink
    data class Deal(override val id: String, override val label: String) : LgLink
    val projectId: String? get() = (this as? Project)?.id
    val dealId: String? get() = (this as? Deal)?.id

    companion object {
        fun of(project: LgProjectRef?, deal: LgDealRef?): LgLink? = when {
            deal != null -> Deal(deal.id, "${deal.code} · ${deal.name}")
            project != null -> Project(project.id, project.name)
            else -> null
        }
    }
}

/** The "Belongs to" control: shows the link, opens the search dialog, ✕ clears it. */
@Composable
fun LgLinkButton(value: LgLink?, onChange: (LgLink?) -> Unit, placeholder: String? = null, own: Boolean = false, modifier: Modifier = Modifier) {
    val c = Nx.colors
    var picking by remember { mutableStateOf(false) }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        LgFieldBox(Modifier.weight(1f), onClick = { picking = true }) {
            Icon(when (value) { is LgLink.Deal -> Icons.Filled.Work; is LgLink.Project -> Icons.Filled.Folder; null -> Icons.Filled.Link }, null,
                tint = c.mutedFg, modifier = Modifier.size(16.dp))
            Text(value?.label ?: placeholder ?: stringResource(R.string.lg_link_placeholder), fontSize = 14.sp,
                color = if (value == null) c.mutedFg else c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        if (value != null) IconButton(onClick = { onChange(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.lg_remove_link), tint = c.mutedFg) }
    }
    if (picking) LgLinkPickerDialog(own, onDismiss = { picking = false }) { picking = false; onChange(it) }
}

/** Search the projects and deals the viewer can open ([own]: the requester's own access, for the request form). */
@Composable
fun LgLinkPickerDialog(own: Boolean, onDismiss: () -> Unit, onPick: (LgLink) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    var q by remember { mutableStateOf("") }
    var links by remember { mutableStateOf<LgLinks?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q.isNotEmpty()) delay(250)
        try { links = api.links(q, own); error = null } catch (e: ApiError) { error = legalMessage(ctx, e) }
    }
    LgSearchDialog(stringResource(R.string.lg_belongs_to), q, { q = it }, stringResource(R.string.lg_search_links), onDismiss) {
        val l = links
        when {
            error != null -> item { Text(error!!, fontSize = 13.sp, color = Nx.colors.danger, modifier = Modifier.padding(16.dp)) }
            l == null -> item { Box(Modifier.padding(horizontal = 16.dp)) { LgLoadingRow() } }
            l.deals.isEmpty() && l.projects.isEmpty() -> item { Text(stringResource(R.string.lg_nothing_found), fontSize = 14.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(16.dp)) }
        }
        if (!l?.deals.isNullOrEmpty()) {
            item { LgDialogSection(stringResource(R.string.lg_pipeline_deals)) }
            items(l!!.deals, key = { "d" + it.id }) { d -> LgDialogRow(Icons.Filled.Work, "${d.code} · ${d.name}") { onPick(LgLink.Deal(d.id, "${d.code} · ${d.name}")) } }
        }
        if (!l?.projects.isNullOrEmpty()) {
            item { LgDialogSection(stringResource(R.string.lg_projects)) }
            items(l!!.projects, key = { "p" + it.id }) { p -> LgDialogRow(Icons.Filled.Folder, p.name) { onPick(LgLink.Project(p.id, p.name)) } }
        }
    }
}

/** A full-screen dialog with a title, a search box and a list (the iOS searchable sheet). */
@Composable
fun LgSearchDialog(title: String, q: String, onQ: (String) -> Unit, placeholder: String, onDismiss: () -> Unit,
                   content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    val c = Nx.colors
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 640.dp).padding(16.dp).clip(RoundedCornerShape(16.dp)).background(c.background)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.close), tint = c.mutedFg) }
            }
            id.znetworks.nexus.ui.components.CompactSearchField(q, onQ, placeholder, Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            Spacer(Modifier.height(8.dp))
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), content = content)
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
fun LgDialogSection(text: String) =
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Nx.colors.mutedFg, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))

@Composable
fun LgDialogRow(icon: ImageVector?, text: String, sub: String? = null, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).defaultMinSize(minHeight = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(12.dp)) }
        Column(Modifier.weight(1f)) {
            Text(text, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ── Files ──

/** "Choose a file" / the picked file's name, as a field. */
@Composable
fun LgPickFileField(file: LgPicked?, onClick: () -> Unit) {
    val c = Nx.colors
    LgFieldBox(Modifier.fillMaxWidth(), onClick = onClick) {
        Icon(if (file == null) Icons.Filled.Link else Icons.Filled.Check, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
        Text(file?.name ?: stringResource(R.string.lg_choose_file), fontSize = 14.sp, color = if (file == null) c.mutedFg else c.foreground,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
}

object LegalFiles {
    private fun uri(context: Context, file: File) = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    private fun type(file: File) = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"

    /** Hands a downloaded file to the share sheet (save to Files, WhatsApp, email…). Its name is the server's. */
    fun share(context: Context, file: File) {
        val i = Intent(Intent.ACTION_SEND).setType(type(file)).putExtra(Intent.EXTRA_STREAM, uri(context, file)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { context.startActivity(Intent.createChooser(i, file.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** Opens a downloaded file in a viewer; false when no app on the phone can. */
    fun open(context: Context, file: File): Boolean {
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri(context, file), type(file)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(i) }.isSuccess
    }
}

/** The page body of a Legal screen: the background, and the toast host above it. */
@Composable
fun LgPage(content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Nx.colors.background)) {
        content()
        LegalToastHost()
    }
}
