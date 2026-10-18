package id.znetworks.nexus.feature.legal

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QuestionAnswer
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Review & edit (owner, 14 Oct 2026; web LegalDocumentEditor + LegalGideonPanel + LegalDiffView, iOS LegalReviewView):
// tap a paragraph to change its text, every save is a new version with your name on it. The number's paragraph and
// paragraphs with a field, image or link are locked. Tick paragraphs and GIDEON proposes before → after for those only;
// nothing changes until it is approved. Compare shows two Word versions as one flow.

/** The editor's state, held by the document screen so its bottom bar and GIDEON's ticks share it. */
@Stable
class LgEditorModel {
    var paragraphs by mutableStateOf<List<LgParagraph>>(emptyList())
    var page by mutableStateOf(LgPage())
    var loadedKey by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    /** Typed text by paragraph index. */
    val edits = mutableStateMapOf<Int, String>()
    var editing by mutableStateOf<Int?>(null)
    var note by mutableStateOf("")
    var saving by mutableStateOf(false)
    /** Paragraphs ticked for GIDEON. */
    val selected = mutableStateListOf<Int>()

    /** The edits that differ from the paragraph as saved. */
    fun pending(): Map<Int, String> = edits.filter { (i, t) -> paragraphs.firstOrNull { it.index == i }?.text != t }

    fun reset() { edits.clear(); editing = null; note = "" }
    fun toggle(i: Int) { if (i in selected) selected.remove(i) else selected.add(i) }
}

@Composable
fun LegalParagraphEditor(doc: LgDocument, editor: LgEditorModel) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    LaunchedEffect(doc.id, doc.currentVersion) {
        val key = "${doc.id}-${doc.currentVersion}"
        if (editor.loadedKey == key) return@LaunchedEffect
        editor.loading = true
        try { val body = api.paragraphs(doc.id); editor.paragraphs = body.paragraphs; editor.page = body.page ?: LgPage(); editor.loadedKey = key; editor.error = null; editor.reset() }
        catch (e: ApiError) { editor.error = legalMessage(ctx, e) }
        editor.loading = false
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.lg_edit_hint), fontSize = 12.sp, color = c.mutedFg)
        when {
            editor.loading && editor.paragraphs.isEmpty() -> LgLoadingRow()
            editor.error != null && editor.paragraphs.isEmpty() -> Text(editor.error!!, fontSize = 13.sp, color = c.mutedFg)
            else -> BoxWithConstraints(Modifier.fillMaxWidth()) {
                val wide = maxWidth >= 560.dp
                val page = editor.page
                val zoom = if (wide) minOf(1.0, maxWidth.value / (page.width * 4 / 3)) else 1.0
                Column(Modifier.width(if (wide) (page.width * 4 / 3 * zoom).dp else maxWidth).background(Color.White).border(1.dp, c.border)
                    .padding(start = if (wide) (page.marginLeft * 4 / 3 * zoom).dp else 4.dp,
                        end = if (wide) (page.marginRight * 4 / 3 * zoom).dp else 12.dp,
                        top = if (wide) (page.marginTop * 4 / 3 * zoom).dp else 24.dp, bottom = 32.dp)) {
                    LegalPageBlocks.of(editor.paragraphs).forEach { block ->
                        if (block.first().layout?.cell == null) ParagraphRow(block.first(), editor, if (wide) zoom else 0.55, zoom)
                        else {
                            val columns = block.maxOf { it.layout!!.cell!!.col } + 1
                            block.groupBy { it.layout!!.cell!!.row }.toSortedMap().values.forEach { row ->
                                Row(Modifier.fillMaxWidth()) {
                                    (0 until columns).forEach { col ->
                                        Column(Modifier.weight(1f).border(0.5.dp, Color.LightGray).padding(2.dp)) {
                                            row.filter { it.layout!!.cell!!.col == col }.forEach { ParagraphRow(it, editor, if (wide) zoom else 0.55, zoom) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ParagraphRow(p: LgParagraph, editor: LgEditorModel, indentScale: Double = 0.55, zoom: Double = 1.0) {
    val c = Nx.colors
    val text = editor.edits[p.index] ?: p.text
    val changed = editor.edits[p.index]?.let { it != p.text } ?: false
    val ticked = p.index in editor.selected
    val heading = Regex("^(Heading|Judul|Title)", RegexOption.IGNORE_CASE).containsMatchIn(p.style.orEmpty())
    val l = p.layout ?: LgParagraphLayout()
    val size = ((l.size ?: editor.page.size) * 4 / 3 * zoom).sp
    val lineHeight = (size.value * l.lineHeight * 1.15).sp
    if (p.isBlank) { Spacer(Modifier.height((lineHeight.value + (l.spaceBefore + l.spaceAfter) * 4 / 3 * zoom).dp)); return }
    val align = when (l.align) { "center" -> TextAlign.Center; "right" -> TextAlign.Right; "justify" -> TextAlign.Justify; else -> TextAlign.Left }
    val family = if (editor.page.font?.contains("Times", true) == true) FontFamily.Serif else FontFamily.SansSerif
    val typography = TextStyle(fontSize = size, lineHeight = lineHeight, textAlign = align, fontFamily = family,
        color = Color(0xFF171717), textIndent = TextIndent((l.firstLine * 4 / 3 * indentScale).sp))
    val weight = if (heading) FontWeight.SemiBold else FontWeight.Normal
    val lockReason = stringResource(if (p.lockReason == "number") R.string.lg_lock_number else R.string.lg_lock_complex)
    Row(Modifier.fillMaxWidth().background(if (changed) c.warning.copy(alpha = 0.12f) else Color.White)
        .then(if (ticked) Modifier.border(1.dp, c.violet.copy(alpha = 0.45f), RoundedCornerShape(8.dp)) else Modifier)
        .padding(top = (l.spaceBefore * 4 / 3 * zoom).dp, bottom = (l.spaceAfter * 4 / 3 * zoom).dp), verticalAlignment = Alignment.Top) {
        if (!p.editable) Box(Modifier.width(28.dp).padding(top = 3.dp)) { Icon(Icons.Filled.Lock, lockReason, tint = Color.Gray, modifier = Modifier.size(12.dp)) }
        else IconButton(onClick = { editor.toggle(p.index) }, modifier = Modifier.size(28.dp)) {
            Icon(if (ticked) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, stringResource(R.string.lg_select_paragraph, p.index + 1),
                tint = (if (ticked) c.violetText else c.mutedFg).copy(alpha = if (p.editable) 1f else 0.3f), modifier = Modifier.size(20.dp))
        }
        Box(Modifier.weight(1f).padding(start = (l.indentLeft.coerceAtLeast(0.0) * 4 / 3 * indentScale).dp)) {
            when {
                editor.editing == p.index -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val runs = l.runs.orEmpty().filter { it.text.isNotBlank() }
                    OutlinedTextField(text, { editor.edits[p.index] = it }, textStyle = typography.copy(
                        fontWeight = if (runs.isNotEmpty() && runs.all { it.b }) FontWeight.Bold else weight,
                        fontStyle = if (runs.isNotEmpty() && runs.all { it.i }) FontStyle.Italic else FontStyle.Normal,
                        textDecoration = if (runs.isNotEmpty() && runs.all { it.u }) TextDecoration.Underline else TextDecoration.None), modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        NxButton(stringResource(R.string.lg_undo), { editor.edits.remove(p.index); editor.editing = null }, kind = NxButtonKind.GHOST, compact = true)
                        Spacer(Modifier.weight(1f))
                        NxButton(stringResource(R.string.lg_done), { editor.editing = null }, compact = true)
                    }
                }
                else -> Row {
                    l.marker?.let { Text(it + " ", style = typography, modifier = Modifier.width((maxOf(l.hanging, 12.0) * 4 / 3 * indentScale).dp)) }
                    val body = if (changed) lgSegments(LegalLogic.diffWords(p.text, text)) else buildAnnotatedString {
                        if (l.runs == null) append(text)
                        else l.runs.forEach { r -> withStyle(SpanStyle(fontWeight = if (r.b) FontWeight.Bold else weight,
                            fontStyle = if (r.i) FontStyle.Italic else FontStyle.Normal, textDecoration = if (r.u) TextDecoration.Underline else TextDecoration.None)) { append(r.text) } }
                    }
                    Text(body, style = typography, fontWeight = weight, modifier = Modifier.weight(1f).clickable {
                        if (p.editable) editor.editing = p.index else LegalToasts.warning(lockReason)
                    })
                }
            }
        }
    }
}

/** "N paragraphs changed", what changed, Discard, Save as new version. */
@Composable
fun LegalSaveEditsBar(editor: LgEditorModel, onSave: () -> Unit) {
    val c = Nx.colors
    val n = editor.pending().size
    Column(Modifier.fillMaxWidth().background(c.card)) {
        HorizontalDivider(color = c.border)
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(pluralStringResource(R.plurals.lg_paragraphs_changed, n, n), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            LgTextField(editor.note, { editor.note = it }, placeholder = stringResource(R.string.lg_what_changed))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                NxButton(stringResource(R.string.lg_discard), { editor.reset() }, kind = NxButtonKind.GHOST, icon = Icons.AutoMirrored.Filled.Undo, compact = true)
                NxButton(stringResource(R.string.lg_save_new_version), onSave, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Save, compact = true, enabled = !editor.saving)
            }
        }
    }
}

// ── GIDEON precise edit ──

@Composable
fun LegalGideonPanel(model: LgDocModel, doc: LgDocument, editor: LgEditorModel) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var instruction by remember { mutableStateOf("") }
    var proposals by remember { mutableStateOf<List<LgProposal>>(emptyList()) }
    var asking by remember { mutableStateOf(false) }
    val shown = LegalLogic.shownProposal(proposals, doc.currentVersion)

    suspend fun loadProposals() { runCatching { proposals = api.proposals(doc.id) } }
    LaunchedEffect(doc.id, doc.currentVersion) { loadProposals() }
    // APPLYING is transient: look again until it settles (and the new version arrives).
    LaunchedEffect(shown?.id, shown?.status) {
        if (shown?.status != "APPLYING") return@LaunchedEffect
        while (LegalLogic.shownProposal(proposals, doc.currentVersion)?.status == "APPLYING") { delay(3000); loadProposals() }
        model.load()
    }

    fun ask(replyTo: String?, answer: String?) {
        asking = true
        scope.launch {
            try {
                val p = api.askGideon(doc.id, doc.currentVersion, if (replyTo == null) instruction.trim() else "",
                    if (replyTo == null) editor.selected.sorted() else emptyList(), replyTo, answer)
                if (p != null) {
                    proposals = listOf(p) + proposals.filter { it.id != p.id }
                    if (p.status == "PENDING") instruction = ""
                }
            } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            asking = false
        }
    }

    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.45f)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.lg_ask_gideon), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (editor.selected.isEmpty()) stringResource(R.string.lg_gideon_hint)
                else pluralStringResource(R.plurals.lg_gideon_ticked, editor.selected.size, editor.selected.size), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
            if (editor.selected.isNotEmpty()) NxButton(stringResource(R.string.lg_clear), { editor.selected.clear() }, kind = NxButtonKind.GHOST, compact = true)
        }
        LgTextField(instruction, { instruction = it }, singleLine = false, minLines = 2, placeholder = stringResource(R.string.lg_gideon_placeholder))
        NxButton(stringResource(if (asking) R.string.lg_gideon_reading else R.string.lg_propose_change), { ask(null, null) }, kind = NxButtonKind.PRIMARY,
            icon = Icons.Filled.AutoAwesome, compact = true, enabled = instruction.isNotBlank() && !asking)
        if (shown != null) androidx.compose.runtime.key(shown.id + shown.status) {
            ProposalCard(doc, shown, asking, onAnswer = { ask(shown.id, it) }) { scope.launch { loadProposals(); model.load() } }
        }
    }
}

@Composable
private fun ProposalCard(doc: LgDocument, proposal: LgProposal, answering: Boolean, onAnswer: (String) -> Unit, onDone: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val shape = RoundedCornerShape(10.dp)
    when (proposal.status) {
        "CLARIFY" -> {
            var answer by remember { mutableStateOf("") }
            Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.violet.copy(alpha = 0.35f), shape).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.QuestionAnswer, null, tint = c.violetText, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
                    Text(proposal.question.orEmpty(), fontSize = 14.sp, color = c.foreground)
                }
                LgTextField(answer, { answer = it }, placeholder = stringResource(R.string.lg_your_answer))
                NxButton(stringResource(R.string.lg_reply), { answer.trim().takeIf { it.isNotEmpty() && !answering }?.let(onAnswer) }, kind = NxButtonKind.PRIMARY,
                    compact = true, enabled = answer.isNotBlank() && !answering)
            }
        }
        "APPLYING" -> Row(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            LgSmallSpinner(); Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.lg_applying), fontSize = 13.sp, color = c.mutedFg)
        }
        "FAILED" -> Text(stringResource(R.string.lg_gideon_refused, proposal.summary.ifEmpty { "—" }), fontSize = 13.sp, color = c.danger,
            modifier = Modifier.fillMaxWidth().clip(shape).background(c.danger.copy(alpha = 0.06f)).border(1.dp, c.danger.copy(alpha = 0.35f), shape).padding(12.dp))
        else -> {
            val chosen = remember { mutableStateListOf<Int>().apply { addAll(proposal.changes.map { it.index }) } }
            var deciding by remember { mutableStateOf(false) }
            fun decide(approve: Boolean) {
                deciding = true
                scope.launch {
                    try {
                        val res = api.decide(doc.id, proposal.id, approve, if (approve) chosen.sorted() else null)
                        if (approve) LegalToasts.success(ctx.getString(R.string.lg_applied_as, res.version ?: 0))
                        LegalToasts.pdfWarning(ctx, res.pdfError)
                    } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                    deciding = false
                    onDone()
                }
            }
            Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.warning.copy(alpha = 0.5f), shape).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(proposal.summary.ifEmpty { proposal.instruction }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                proposal.changes.forEach { ch ->
                    Row(verticalAlignment = Alignment.Top) {
                        val on = ch.index in chosen
                        IconButton(onClick = { if (on) chosen.remove(ch.index) else chosen.add(ch.index) }, modifier = Modifier.size(36.dp)) {
                            Icon(if (on) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, stringResource(R.string.lg_apply_to_paragraph, ch.index + 1),
                                tint = if (on) c.violetText else c.mutedFg, modifier = Modifier.size(20.dp))
                        }
                        Column(Modifier.weight(1f).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(stringResource(R.string.lg_paragraph_n, ch.index + 1), fontSize = 11.sp, color = c.mutedFg)
                            Text(lgSegments(ch.segments.ifEmpty { LegalLogic.diffWords(ch.before, ch.after) }), fontSize = 14.sp, color = c.foreground, lineHeight = 21.sp)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxButton(if (chosen.size == proposal.changes.size) stringResource(R.string.lg_approve) else stringResource(R.string.lg_approve_n_of, chosen.size, proposal.changes.size),
                        { decide(true) }, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Check, compact = true, enabled = chosen.isNotEmpty() && !deciding)
                    NxButton(stringResource(R.string.lg_discard), { decide(false) }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Close, compact = true, enabled = !deciding)
                }
            }
        }
    }
}

// ── Compare ──

@Composable
fun LegalCompare(doc: LgDocument) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val word = LegalLogic.wordVersions(doc)
    var a by remember { mutableStateOf(if (word.size >= 2) word[word.size - 2] else word.firstOrNull()) }
    var b by remember { mutableStateOf(word.lastOrNull()) }
    var diff by remember { mutableStateOf<List<LgDiff>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(a, b) {
        val va = a ?: return@LaunchedEffect
        val vb = b ?: return@LaunchedEffect
        if (va == vb) return@LaunchedEffect
        diff = null; error = null
        try { diff = api.compare(doc.id, va, vb).diff } catch (e: ApiError) { error = legalMessage(ctx, e) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LgMenuPicker(word.map { "$it" to "REV $it" }, a?.toString(), { v -> v?.toIntOrNull()?.let { a = it } }, compact = true)
            Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
            LgMenuPicker(word.map { "$it" to "REV $it" }, b?.toString(), { v -> v?.toIntOrNull()?.let { b = it } }, compact = true)
        }
        val d = diff
        when {
            a == b -> Text(stringResource(R.string.lg_pick_two_versions), fontSize = 14.sp, color = c.mutedFg)
            error != null -> Text(error!!, fontSize = 13.sp, color = c.danger)
            d == null -> LgLoadingRow()
            else -> LegalDiffView(d)
        }
    }
}

/** Two versions as one flow: unchanged paragraphs folded, changes in full, added and removed ones as boxes. */
@Composable
fun LegalDiffView(diff: List<LgDiff>) {
    val c = Nx.colors
    val changes = diff.count { it.type != "same" }
    if (changes == 0) { Text(stringResource(R.string.lg_same_text), fontSize = 14.sp, color = c.mutedFg); return }
    val shape = RoundedCornerShape(10.dp)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(pluralStringResource(R.plurals.lg_paragraphs_changed, changes, changes), fontSize = 12.sp, color = c.mutedFg)
        LegalLogic.diffRows(diff).forEach { row ->
            when (row) {
                is LegalLogic.DiffRow.Folded -> Text(pluralStringResource(R.plurals.lg_unchanged_n, row.count, row.count), fontSize = 12.sp, color = c.mutedFg,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                is LegalLogic.DiffRow.Change -> when (row.diff.type) {
                    "changed" -> Text(lgSegments(row.diff.segments.ifEmpty { LegalLogic.diffWords(row.diff.before, row.diff.after) }), fontSize = 14.sp, color = c.foreground,
                        lineHeight = 21.sp, modifier = Modifier.fillMaxWidth().border(1.dp, c.warning.copy(alpha = 0.5f), shape).padding(horizontal = 12.dp, vertical = 9.dp))
                    "added", "removed" -> {
                        val added = row.diff.type == "added"
                        val tone = lgTone(if (added) "success" else "danger")
                        Column(Modifier.fillMaxWidth().clip(shape).background(tone.bg.copy(alpha = 0.4f)).border(1.dp, tone.fg.copy(alpha = 0.35f), shape)
                            .padding(horizontal = 12.dp, vertical = 9.dp)) {
                            Text(stringResource(if (added) R.string.lg_added else R.string.lg_removed), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tone.fg)
                            Text(row.diff.text, fontSize = 14.sp, color = c.foreground, lineHeight = 21.sp,
                                textDecoration = if (added) null else androidx.compose.ui.text.style.TextDecoration.LineThrough)
                        }
                    }
                    else -> Text(row.diff.text, fontSize = 14.sp, color = c.mutedFg)
                }
            }
        }
    }
}
