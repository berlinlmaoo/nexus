package id.znetworks.nexus.feature.forms

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.projects.CustomFieldDef
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

// The pieces of the form studio's canvas (iOS FormStudioViews.swift, web FormStudio.tsx, "copy Notion's"): a page that
// looks like the form people fill in — cover, emoji, big title, description — then each question as a card with its
// real input. FormBuilderScreen owns the state and the saving; everything here is drawn from values and callbacks.

/** The type menu's glyph for a kind. */
fun kindIcon(k: FormQuestionKind): ImageVector = when (k) {
    FormQuestionKind.TEXT -> Icons.Outlined.TextFields
    FormQuestionKind.TEXTAREA -> Icons.AutoMirrored.Outlined.Article
    FormQuestionKind.DROPDOWN -> Icons.Outlined.RadioButtonChecked
    FormQuestionKind.MULTI_SELECT -> Icons.Outlined.Checklist
    FormQuestionKind.CHECKBOX -> Icons.Outlined.CheckBox
    FormQuestionKind.NUMBER -> Icons.Outlined.Tag
    FormQuestionKind.RUPIAH -> Icons.Outlined.AccountBalanceWallet
    FormQuestionKind.DATE -> Icons.Outlined.CalendarMonth
    FormQuestionKind.EMAIL -> Icons.Outlined.AlternateEmail
    FormQuestionKind.PHONE -> Icons.Outlined.Phone
    FormQuestionKind.URL -> Icons.Outlined.Link
    FormQuestionKind.FILE -> Icons.Filled.AttachFile
}

/** A dashed outline (an upload box, the "options follow the sections" note). */
fun Modifier.dashedBorder(color: Color, radius: Dp): Modifier = drawBehind {
    drawRoundRect(color, style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
        cornerRadius = CornerRadius(radius.toPx()))
}

// region Top bar

/** "✓ Saved", "Saving…", "Unsaved changes", "Couldn't save — Retry". */
@Composable
fun FormSaveIndicator(state: FormSaveState, hasId: Boolean, onRetry: () -> Unit) {
    val c = Nx.colors
    val failed = state is FormSaveState.Failed
    val label = stringResource(when (state) {
        FormSaveState.Saving -> R.string.fs_saving
        FormSaveState.Pending -> R.string.fs_unsaved
        is FormSaveState.Failed -> R.string.fs_save_failed
        FormSaveState.Saved -> R.string.fs_saved
        FormSaveState.Idle -> if (hasId) R.string.fs_saved else R.string.fs_draft
    })
    val tint = if (failed) c.dangerText else c.mutedFg
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label }) {
        when (state) {
            FormSaveState.Saving -> CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp, color = c.mutedFg)
            is FormSaveState.Failed -> Icon(Icons.Outlined.ErrorOutline, null, tint = tint, modifier = Modifier.size(14.dp))
            FormSaveState.Pending -> Box(Modifier.size(6.dp).background(c.warning, CircleShape))
            else -> Icon(Icons.Filled.Check, null, tint = tint, modifier = Modifier.size(13.dp))
        }
        Text(label, fontSize = 13.sp, color = tint, maxLines = 1)
        if (failed) Text(stringResource(R.string.fs_retry), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = tint,
            textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
            modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable(role = Role.Button, onClick = onRetry).padding(2.dp))
    }
}

// endregion

// region Canvas head

/** The cover band across the top of the canvas: a preset gradient or an image. */
@Composable
fun FormCoverBand(branding: FormBranding, height: Dp = 128.dp) {
    val preset = branding.preset
    when {
        preset != null -> Box(Modifier.fillMaxWidth().height(height).background(Brush.linearGradient(preset.colors.map { Color(it) })))
        branding.cover.isNotEmpty() -> RemoteImage(branding.cover, Modifier.fillMaxWidth().height(height).background(Nx.colors.muted), maxPx = 1200)
    }
}

/** Add icon / Add cover, the emoji, the big title, "Add a description" and the access banner. */
@Composable
fun FormStudioHead(
    name: String, description: String, branding: FormBranding, isPublic: Boolean,
    onName: (String) -> Unit, onDescription: (String) -> Unit, onBranding: (FormBranding) -> Unit, onChangeAccess: () -> Unit,
) {
    val c = Nx.colors
    var iconPicker by remember { mutableStateOf(false) }
    var coverPicker by remember { mutableStateOf(false) }
    val hasCover = branding.cover.isNotEmpty()
    Column(Modifier.fillMaxWidth()) {
        if (branding.icon.isNotEmpty()) {
            val label = stringResource(R.string.fs_change_icon)
            Text(branding.icon, fontSize = 50.sp, lineHeight = 60.sp,
                modifier = Modifier.offset(y = if (hasCover) (-30).dp else 0.dp).padding(top = if (hasCover) 0.dp else 28.dp)
                    .clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClickLabel = label) { iconPicker = true }
                    .semantics { contentDescription = label })
        }
        Row(Modifier.padding(top = if (branding.icon.isNotEmpty()) 0.dp else if (hasCover) 16.dp else 24.dp).offset(x = (-8).dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (branding.icon.isEmpty()) HeadButton(stringResource(R.string.fs_add_icon), Icons.Outlined.EmojiEmotions) { iconPicker = true }
            HeadButton(stringResource(if (hasCover) R.string.fs_change_cover else R.string.fs_add_cover), Icons.Outlined.Image) { coverPicker = true }
        }
        PlainField(name, { onName(it.replace("\n", " ")) }, stringResource(R.string.fs_untitled_form),
            TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp, color = c.foreground),
            Modifier.padding(top = 8.dp), contentDescription = stringResource(R.string.fs_form_title))
        PlainField(description, onDescription, stringResource(R.string.fs_add_description),
            TextStyle(fontFamily = TextFont, fontSize = 16.sp, lineHeight = 22.sp, color = c.mutedFg), Modifier.padding(top = 8.dp),
            singleLine = false, contentDescription = stringResource(R.string.fs_form_description))
        // Who can fill it in, one tap from Settings.
        Row(Modifier.padding(top = 20.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.muted.copy(alpha = 0.7f))
            .clickable(role = Role.Button, onClick = onChangeAccess).padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(if (isPublic) Icons.Outlined.Link else Icons.Outlined.Group, null, tint = c.mutedFg, modifier = Modifier.size(15.dp))
            Text(stringResource(if (isPublic) R.string.fs_access_public else R.string.fs_access_members), fontSize = 13.sp, color = c.mutedFg,
                modifier = Modifier.weight(1f))
            Text(stringResource(R.string.fs_change), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
    }
    if (iconPicker) IconPickerDialog(branding.icon, onDismiss = { iconPicker = false }) { onBranding(branding.copy(icon = it)); iconPicker = false }
    if (coverPicker) CoverPickerDialog(branding.cover, onDismiss = { coverPicker = false }) { onBranding(branding.copy(cover = it)); coverPicker = false }
}

@Composable
private fun HeadButton(text: String, icon: ImageVector, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(15.dp))
        Text(text, fontSize = 13.sp, color = c.mutedFg)
    }
}

/** A borderless text field with a muted placeholder (the canvas's title, description, option rows). */
@Composable
fun PlainField(
    value: String, onChange: (String) -> Unit, placeholder: String, style: TextStyle, modifier: Modifier = Modifier,
    singleLine: Boolean = false, contentDescription: String? = null,
) {
    val c = Nx.colors
    BasicTextField(value, onChange, singleLine = singleLine, textStyle = style, cursorBrush = SolidColor(c.foreground),
        modifier = modifier.fillMaxWidth().then(if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) Text(placeholder, style = style.copy(color = c.mutedFg.copy(alpha = 0.6f)), maxLines = if (singleLine) 1 else Int.MAX_VALUE)
                inner()
            }
        })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IconPickerDialog(current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.fs_icon)) },
        text = {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FormBranding.ICONS.forEach { e ->
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(if (current == e) c.muted else Color.Transparent)
                        .clickable(role = Role.Button) { onPick(e) }, contentAlignment = Alignment.Center) { Text(e, fontSize = 22.sp) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        dismissButton = { if (current.isNotEmpty()) TextButton(onClick = { onPick("") }) { Text(stringResource(R.string.fs_remove), color = c.dangerText) } })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoverPickerDialog(current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.fs_cover)) },
        text = {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
                FormBranding.COVERS.forEach { p ->
                    val value = "preset:${p.key}"
                    val label = stringResource(p.label)
                    Box(Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(6.dp)).background(Brush.linearGradient(p.colors.map { Color(it) }))
                        .border(2.dp, if (current == value) c.foreground else Color.Transparent, RoundedCornerShape(6.dp))
                        .clickable(role = Role.Button, onClickLabel = label) { onPick(value) }.semantics { contentDescription = label })
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        dismissButton = { if (current.isNotEmpty()) TextButton(onClick = { onPick("") }) { Text(stringResource(R.string.fs_remove), color = c.dangerText) } })
}

// endregion

// region Question card

enum class ChipTone { MUTED, ACCENT, WARN }

/** A small label under a question: where its answer goes, its logic, its routing, autofill. */
@Composable
fun StudioChip(text: String, icon: ImageVector, tone: ChipTone = ChipTone.MUTED) {
    val c = Nx.colors
    val fg = when (tone) { ChipTone.ACCENT -> c.accentFg; ChipTone.WARN -> c.warningFg; ChipTone.MUTED -> c.mutedFg }
    val bg = when (tone) { ChipTone.ACCENT -> c.accentBg; ChipTone.WARN -> c.warning.copy(alpha = 0.12f); ChipTone.MUTED -> c.muted }
    Row(Modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(11.dp))
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** The operator as the studio words it ("is", "is not", …). */
@Composable
fun operatorLabel(op: String): String = FormVocab.OPERATORS.firstOrNull { it.first == op }?.let { stringResource(it.second) } ?: op

@Composable
fun mappingText(m: MappingLabel): String = when (m) {
    is MappingLabel.Named -> m.name
    is MappingLabel.Vocab -> stringResource(m.res)
    is MappingLabel.Raw -> m.target
}

/**
 * One question as the respondent sees it (iOS FormQuestionCard, compact): the title drawn (a tap on the card opens the
 * question's settings), the real input, inline option editing for choice questions, and the chips. The tools always
 * show: settings, duplicate, delete.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FormQuestionCard(
    field: BuilderField, index: Int, others: List<BuilderField>, customFields: List<CustomFieldDef>, sections: List<String>,
    onOpen: () -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit, onOptions: (List<String>) -> Unit,
) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    val sectionCategory = FormCategory.fieldForSectionQuestion(field.type, field.mappingTarget, field.options, customFields, sections)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape)
        .clickable(onClickLabel = stringResource(R.string.fs_question_settings), onClick = onOpen)
        .padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 16.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 4.dp)) {
                val untitled = field.name.isBlank()
                Row {
                    Text(if (untitled) stringResource(R.string.fs_untitled_question) else field.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        color = if (untitled) c.mutedFg else c.foreground, modifier = Modifier.weight(1f, fill = false))
                    if (field.required) Text(" *", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                }
                field.description?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 14.sp, color = c.mutedFg, modifier = Modifier.padding(top = 2.dp)) }
            }
            ToolButton(Icons.Outlined.Tune, stringResource(R.string.fs_question_settings), onClick = onOpen)
            ToolButton(Icons.Outlined.ContentCopy, stringResource(R.string.fs_duplicate_question), onClick = onDuplicate)
            ToolButton(Icons.Outlined.Delete, stringResource(R.string.fs_delete_question), destructive = true, onClick = onDelete)
        }
        Column(Modifier.padding(top = 10.dp, end = 10.dp)) {
            when {
                field.hasOptions && field.mappingTarget == "task_list" && sectionCategory == null -> Text(
                    stringResource(R.string.fs_options_follow, sections.joinToString(", ").ifEmpty { "—" }), fontSize = 14.sp, color = c.mutedFg,
                    modifier = Modifier.fillMaxWidth().dashedBorder(c.border, 8.dp).padding(horizontal = 12.dp, vertical = 10.dp))
                field.hasOptions -> InlineOptions(field.options, multi = field.type == "multi_select", onChange = onOptions)
                field.type == "checkbox" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(18.dp).border(1.dp, c.mutedFg.copy(alpha = 0.5f), RoundedCornerShape(4.dp)))
                    Text(field.name.ifBlank { stringResource(R.string.fs_checkbox) }, fontSize = 15.sp, color = c.mutedFg)
                }
                else -> CanvasControl(field)
            }
            if (field.attachmentEnabled && field.type != "file") Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Filled.AttachFile, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
                Text(stringResource(R.string.fs_attach_optional), fontSize = 13.sp, color = c.mutedFg)
            }
            val chips = questionChips(field, others, customFields, sections)
            if (chips.isNotEmpty()) FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                chips.forEach { (text, icon, tone) -> StudioChip(text, icon, tone) }
            }
        }
    }
}

/** The card's chips: mapping, logic (or what's wrong with it), routing, autofill. */
@Composable
private fun questionChips(field: BuilderField, others: List<BuilderField>, customFields: List<CustomFieldDef>, sections: List<String>): List<Triple<String, ImageVector, ChipTone>> {
    val out = mutableListOf<Triple<String, ImageVector, ChipTone>>()
    FormStudioLogic.mappingLabel(field, customFields, sections)?.let { out += Triple(mappingText(it), Icons.AutoMirrored.Filled.ArrowForward, ChipTone.ACCENT) }
    val cond = field.showIf
    val parent = cond?.let { k -> others.firstOrNull { it.id == k.fieldId } }
    if (cond != null && parent != null) {
        val q = parent.name.trim().ifEmpty { stringResource(R.string.fs_question) }
        val needs = FormVocab.needsValue(cond.op)
        out += when {
            needs && cond.value.isBlank() -> Triple(stringResource(R.string.fs_logic_unset), Icons.Outlined.AccountTree, ChipTone.WARN)
            FormStudioLogic.staleOption(parent, cond.op, cond.value) -> Triple(stringResource(R.string.fs_logic_stale, cond.value, q), Icons.Outlined.ErrorOutline, ChipTone.WARN)
            else -> Triple(stringResource(R.string.fs_shown_when, q, operatorLabel(cond.op), if (needs) "“${cond.value}”" else "").trim(), Icons.Outlined.AccountTree, ChipTone.MUTED)
        }
    }
    if (field.rules.isNotEmpty()) {
        val stale = field.rules.count { FormStudioLogic.staleOption(field, it.op, it.value) }
        out += if (stale > 0) Triple(stringResource(R.string.fs_rule_stale), Icons.Outlined.ErrorOutline, ChipTone.WARN)
        else Triple(pluralStringResource(R.plurals.fs_rules_n, field.rules.size, field.rules.size), Icons.Filled.Route, ChipTone.MUTED)
    }
    if (field.autofill.isNotEmpty()) out += Triple(stringResource(if (field.autofill == "email") R.string.fs_auto_email else R.string.fs_auto_name), Icons.Outlined.Person, ChipTone.MUTED)
    return out
}

@Composable
private fun ToolButton(icon: ImageVector, label: String, destructive: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
        .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = if (destructive) c.dangerText.copy(alpha = 0.85f) else c.mutedFg, modifier = Modifier.size(18.dp))
    }
}

/** The options of a choice question, edited in place: a circle (or a box) per option, × to remove, Add option. */
@Composable
fun InlineOptions(options: List<String>, multi: Boolean, onChange: (List<String>) -> Unit) {
    val c = Nx.colors
    val rows = options.ifEmpty { listOf("") }
    Column {
        rows.forEachIndexed { i, o ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.defaultMinSize(minHeight = 40.dp)) {
                Box(Modifier.size(16.dp).border(1.dp, c.mutedFg.copy(alpha = 0.5f), if (multi) RoundedCornerShape(4.dp) else CircleShape))
                PlainField(o, { v -> onChange(if (options.isEmpty()) listOf(v) else options.toMutableList().also { it[i] = v }) },
                    stringResource(R.string.fb_option_n, i + 1), TextStyle(fontFamily = TextFont, fontSize = 15.sp, color = c.foreground),
                    Modifier.weight(1f), singleLine = true)
                if (rows.size > 1) {
                    val label = stringResource(R.string.fs_delete_option)
                    Box(Modifier.size(32.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = label) {
                        if (i < options.size) onChange(options.filterIndexed { k, _ -> k != i })
                    }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
        Row(Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { onChange(if (options.isEmpty()) listOf("", "") else options + "") }
            .padding(vertical = 6.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Add, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
            Text(stringResource(R.string.fb_add_option), fontSize = 14.sp, color = c.mutedFg)
        }
    }
}

/** The real input of a question, drawn disabled (the web's `QuestionControl disabled`). */
@Composable
fun CanvasControl(field: BuilderField) {
    val c = Nx.colors
    val locked = field.autofill.isNotEmpty()
    when (field.type) {
        "file" -> Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).dashedBorder(c.border, 10.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.AttachFile, null, tint = c.mutedFg, modifier = Modifier.size(15.dp))
            Text(stringResource(R.string.fb_choose_file), fontSize = 15.sp, color = c.mutedFg)
        }
        "textarea" -> ControlBox(stringResource(R.string.fs_your_answer), height = 96.dp)
        "date" -> ControlBox(stringResource(R.string.fb_pick_date), icon = Icons.Outlined.CalendarMonth)
        "number" -> ControlBox(if (field.numberFormat == "currency-idr") "Rp 0" else "0")
        "email" -> ControlBox(if (locked) stringResource(R.string.fb_filled_from_account) else "name@company.com", icon = if (locked) Icons.Filled.Lock else null)
        "url" -> ControlBox("company.com")
        else -> ControlBox(if (locked) stringResource(R.string.fb_filled_from_account) else stringResource(R.string.fs_your_answer), icon = if (locked) Icons.Filled.Lock else null)
    }
}

@Composable
private fun ControlBox(placeholder: String, icon: ImageVector? = null, height: Dp = 46.dp) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    Row(Modifier.fillMaxWidth().heightIn(min = height).clip(shape).background(c.background).border(1.dp, c.border, shape)
        .padding(horizontal = 14.dp, vertical = if (height > 50.dp) 12.dp else 0.dp),
        verticalAlignment = if (height > 50.dp) Alignment.Top else Alignment.CenterVertically) {
        Text(placeholder, fontSize = 15.sp, color = c.mutedFg.copy(alpha = 0.85f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).then(if (height > 50.dp) Modifier else Modifier.padding(vertical = 12.dp)))
        if (icon != null) Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(15.dp).then(if (height > 50.dp) Modifier.padding(top = 2.dp) else Modifier))
    }
}

/** "+ Add question": the type menu, Basic then Specific, each with its hint. */
@Composable
fun AddQuestionMenu(onPick: (FormQuestionKind) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) { open = true }.padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Add, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.fs_add_question), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
        }
        DropdownMenu(open, { open = false }) {
            listOf(true to R.string.fs_basic, false to R.string.fs_specific).forEachIndexed { n, (basic, title) ->
                if (n > 0) HorizontalDivider(color = c.border)
                Text(stringResource(title).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                    modifier = Modifier.padding(start = 16.dp, top = 10.dp, bottom = 4.dp))
                FormQuestionKind.entries.filter { it.basic == basic }.forEach { k ->
                    DropdownMenuItem(
                        leadingIcon = { Icon(kindIcon(k), null, tint = c.mutedFg, modifier = Modifier.size(18.dp)) },
                        text = {
                            Column {
                                Text(stringResource(k.label), fontSize = 15.sp, color = c.foreground)
                                Text(k.literalHint ?: stringResource(k.hint), fontSize = 12.sp, color = c.mutedFg)
                            }
                        },
                        onClick = { open = false; onPick(k) })
                }
            }
        }
    }
}

// endregion

// region Shared bits for the settings screens

/** A settings card: title, a muted hint, the controls (iOS FormSettingsCard). */
@Composable
fun StudioCard(title: String, hint: String? = null, content: @Composable () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).padding(16.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        hint?.let { Text(it, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(top = 2.dp)) }
        Spacer(Modifier.height(14.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
    }
}

/** A labelled pick from a short list: the current value on a bordered row, a menu under it. */
@Composable
fun <T> StudioPick(label: String?, value: String, options: List<Pair<T, String>>, modifier: Modifier = Modifier, onPick: (T) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        label?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, modifier = Modifier.padding(bottom = 5.dp)) }
        Box {
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(8.dp)).background(c.background)
                .border(BorderStroke(1.dp, c.border), RoundedCornerShape(8.dp)).clickable(role = Role.Button) { open = true }.padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(value, fontSize = 15.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(open, { open = false }) {
                options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { open = false; onPick(v) }) }
            }
        }
    }
}

/** A bordered input with a label above it (After sending, values). */
@Composable
fun StudioInput(label: String?, value: String, onChange: (String) -> Unit, placeholder: String, singleLine: Boolean = true,
                minHeight: Dp = 44.dp, keyboard: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
                modifier: Modifier = Modifier) {
    val c = Nx.colors
    Column(modifier) {
        label?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, modifier = Modifier.padding(bottom = 5.dp)) }
        BasicTextField(value, onChange, singleLine = singleLine, keyboardOptions = keyboard,
            textStyle = TextStyle(fontFamily = TextFont, fontSize = 15.sp, lineHeight = 21.sp, color = c.foreground), cursorBrush = SolidColor(c.foreground),
            modifier = Modifier.fillMaxWidth().semantics { if (label != null) contentDescription = label },
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().heightIn(min = minHeight).clip(RoundedCornerShape(8.dp)).background(c.background)
                    .border(1.dp, c.border, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 11.dp),
                    contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart) {
                    if (value.isEmpty()) Text(placeholder, fontSize = 15.sp, lineHeight = 21.sp, color = c.mutedFg.copy(alpha = 0.7f))
                    inner()
                }
            })
    }
}

/** A switch row: title, an optional muted line, the switch (near-black when on, like the web's). */
@Composable
fun StudioSwitch(title: String, sub: String? = null, on: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, role = Role.Switch) { onChange(!on) }.padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            Text(title, fontSize = 15.sp, color = c.foreground.copy(alpha = if (enabled) 1f else 0.5f))
            sub?.let { Text(it, fontSize = 13.sp, color = c.mutedFg) }
        }
        androidx.compose.material3.Switch(on, onChange, enabled = enabled, colors = androidx.compose.material3.SwitchDefaults.colors(
            checkedTrackColor = c.onyx, checkedThumbColor = c.background, checkedBorderColor = c.onyx))
    }
}

/** A row to tap, like a list button (Move up, Duplicate, Add rule …). */
@Composable
fun StudioAction(text: String, icon: ImageVector?, enabled: Boolean = true, danger: Boolean = false, accent: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val tint = when { danger -> c.dangerText; accent -> c.violetText; else -> c.foreground }.copy(alpha = if (enabled) 1f else 0.4f)
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (icon != null) Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
        Text(text, fontSize = 15.sp, color = tint, modifier = Modifier.weight(1f))
    }
}

/** A muted or warning note line. */
@Composable
fun StudioNote(text: String, warn: Boolean = false, icon: ImageVector? = null) {
    val c = Nx.colors
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (icon != null) Icon(icon, null, tint = if (warn) c.warningFg else c.mutedFg, modifier = Modifier.size(15.dp).padding(top = 2.dp))
        Text(text, fontSize = 13.sp, fontWeight = if (warn) FontWeight.Medium else FontWeight.Normal, color = if (warn) c.warningFg else c.mutedFg)
    }
}

// endregion
