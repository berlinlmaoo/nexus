package id.znetworks.nexus.feature.legal

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Attachment
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.ConfirmDialog
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PdfPages
import id.znetworks.nexus.ui.components.PdfViewerDialog
import id.znetworks.nexus.ui.components.PendingConfirm
import id.znetworks.nexus.ui.components.Segmented
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/** The document, shared by the overview, the editor and GIDEON so a new version shows everywhere at once. */
@Stable
class LgDocModel(private val api: LegalApi, private val context: Context, val id: String) {
    var doc by mutableStateOf<LgDocument?>(null)
        private set
    var error by mutableStateOf<Throwable?>(null)

    /** [quiet]: a background re-read (waiting for a PDF) that says nothing when it fails. */
    suspend fun load(quiet: Boolean = false) {
        try { doc = api.document(id); error = null }
        catch (e: ApiError) { if (doc == null) error = e else if (!quiet) LegalToasts.failure(context, e) }
    }

    /** PATCH; the answer replaces the document. Says "Saved" unless [quiet]. */
    suspend fun patch(body: kotlinx.serialization.json.JsonObject, quiet: Boolean = false): Boolean = try {
        api.updateDocument(id, body)?.let { doc = it } ?: load(true)
        if (!quiet) LegalToasts.success(context.getString(R.string.lg_saved))
        true
    } catch (e: ApiError) { LegalToasts.failure(context, e); false }

    /** A version write the server refused. A 409 means someone else saved first: show the newer version. */
    suspend fun versionRefused(e: ApiError) {
        if (e.legalConflict()) { load(); LegalToasts.warning(context.getString(R.string.lg_conflict)) }
        else LegalToasts.failure(context, e)
    }
}

/**
 * One legal document (owner, 14 Oct 2026; web LegalDocumentSheet, iOS LegalDocumentView): its archive fields, files and
 * versions, and, for a Word version, Review & edit (paragraph edits, GIDEON's precise edit) and Compare. SIGNED and
 * VOID documents hide every edit (the server refuses them too).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LegalDocumentScreen(docId: String, onBack: () -> Unit, onOpenDoc: (String) -> Unit, onCreateAddendum: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val model = remember(docId) { LgDocModel(api, ctx.applicationContext, docId) }
    val editor = remember(docId) { LgEditorModel() }
    var pane by rememberSaveable { mutableStateOf("overview") }
    var confirm by remember { mutableStateOf<PendingConfirm?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }

    LaunchedEffect(docId) { model.load() }
    // Back from an addendum or another document: this one may have changed (its addenda list).
    OnResume(docId) { if (model.doc != null) model.load(quiet = true) }
    // PDFs are made in the background after generate / save / upload / approve: while a recent Word version has none
    // yet, ask again every 4 s, for at most 3 minutes after it was made.
    val doc = model.doc
    val pollKey = doc?.let { d -> LegalLogic.versionsAwaitingPdf(d).joinToString(",") { "${it.version}" } }.orEmpty()
    LaunchedEffect(pollKey) {
        while (true) {
            val d = model.doc ?: break
            if (LegalLogic.versionsAwaitingPdf(d).isEmpty()) break
            delay(4000)
            model.load(quiet = true)
        }
    }
    LaunchedEffect(doc?.status) { if ((doc?.status == "SIGNED" || doc?.status == "VOID") && pane == "edit") pane = "overview" }
    LaunchedEffect(doc?.currentVersion) { editor.selected.clear() }

    /** [signed]: the signed copy of a final document; it becomes SIGNED and locked. */
    fun uploadVersion(f: LgPicked, signed: Boolean) {
        val d = model.doc ?: return
        uploading = true
        scope.launch {
            try {
                val res = api.uploadVersion(d.id, d.currentVersion, f, "", if (signed) "SIGNED" else null)
                LegalToasts.success(if (signed) ctx.getString(R.string.lg_signed_uploaded_locked) else ctx.getString(R.string.lg_uploaded_as_version, res.version))
                LegalToasts.pdfWarning(ctx, res.pdfError)
                model.load()
            } catch (e: ApiError) { model.versionRefused(e) }
            uploading = false
        }
    }
    val pickSigned = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(api::describe)?.let { uploadVersion(it, true) } }
    val pickVersion = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(api::describe)?.let { uploadVersion(it, false) } }

    fun saveEdits() {
        val d = model.doc ?: return
        val edits = editor.pending().toSortedMap().map { it.key to it.value }
        scope.launch {
            editor.saving = true
            try {
                val res = api.saveEdits(d.id, d.currentVersion, edits, editor.note.trim())
                LegalToasts.success(ctx.getString(R.string.lg_saved_as_version, res.version))
                LegalToasts.pdfWarning(ctx, res.pdfError)
                editor.reset()
                model.load()
            } catch (e: ApiError) {
                if (e.legalConflict()) editor.reset()
                model.versionRefused(e)
            }
            editor.saving = false
        }
    }

    LgPage {
        Column(Modifier.fillMaxSize()) {
            // The number and title are in the page below; the bar carries a short word, as on iOS.
            PageHeader(stringResource(R.string.lg_document), onBack = onBack)
            val e = model.error
            when {
                doc == null && e == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                doc == null -> LgLoadError(e!!, stringResource(R.string.lg_doc_open_failed), { scope.launch { model.load() } }, onBack, Modifier.fillMaxSize())
                else -> Box(Modifier.weight(1f)) {
                    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; model.load(); refreshing = false } }, Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            // Header: the number (struck through when given back), the title, type · company · date · template vN.
                            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(doc.number.ifEmpty { stringResource(R.string.lg_no_number) }, fontSize = 13.sp, fontFamily = LgMono, color = c.mutedFg,
                                    textDecoration = if (doc.numberReleased) TextDecoration.LineThrough else null)
                                Text(doc.title, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                Text(listOfNotNull(lgDocType(doc.docType), doc.company?.name ?: "—", lgDay(doc.docDate),
                                    doc.template?.let { stringResource(R.string.lg_from_template, it.name, it.version) }).joinToString(" · "), fontSize = 13.sp, color = c.mutedFg)
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                                StatusControl(doc) { s ->
                                    if (s == "VOID") confirm = PendingConfirm(
                                        ctx.getString(R.string.lg_void_title, doc.number.ifEmpty { doc.title }),
                                        when (LegalLogic.voidOutcome(doc)) {
                                            LegalLogic.VoidOutcome.RELEASED -> ctx.getString(R.string.lg_void_released, doc.number)
                                            LegalLogic.VoidOutcome.RETIRED -> ctx.getString(R.string.lg_void_retired)
                                            LegalLogic.VoidOutcome.PLAIN -> ctx.getString(R.string.lg_void_plain)
                                        },
                                        ctx.getString(R.string.lg_void_action),
                                    ) { scope.launch { model.patch(lgBody("status" to "VOID")) } }
                                    else scope.launch { model.patch(lgBody("status" to s)) }
                                }
                                if (LegalLogic.canUploadSignedCopy(doc.status)) NxButton(stringResource(R.string.lg_upload_signed), { pickSigned.launch(LegalApi.SIGNED_TYPES) },
                                    icon = Icons.Filled.Draw, compact = true, enabled = !uploading)
                                if (LegalLogic.canCreateAddendum(doc.status)) NxButton(stringResource(R.string.lg_create_addendum), { onCreateAddendum(doc.id) },
                                    icon = Icons.Filled.NoteAdd, compact = true)
                                if (uploading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            }
                            DocumentFacts(doc, onOpenDoc)
                            if (LegalLogic.canReview(doc)) {
                                val options = buildList {
                                    add("overview" to stringResource(R.string.lg_overview)); add("edit" to stringResource(R.string.lg_review_edit))
                                    if (LegalLogic.canCompare(doc)) add("compare" to stringResource(R.string.lg_compare))
                                }
                                if (options.none { it.first == pane }) pane = "overview"
                                Segmented(options, pane, { pane = it })
                            }
                            when (if (LegalLogic.canReview(doc)) pane else "overview") {
                                "edit" -> if (LegalLogic.current(doc)?.hasDocx == true) {
                                    LegalGideonPanel(model, doc, editor)
                                    LegalParagraphEditor(doc, editor)
                                } else Text(stringResource(R.string.lg_not_word), fontSize = 14.sp, color = c.mutedFg)
                                "compare" -> LegalCompare(doc)
                                else -> DocumentOverview(model, doc) { pickVersion.launch(LegalApi.DOCUMENT_TYPES) }
                            }
                            Spacer(Modifier.height(if (pane == "edit" && editor.pending().isNotEmpty()) 140.dp else 40.dp))
                        }
                    }
                    if (pane == "edit" && editor.pending().isNotEmpty()) Box(Modifier.align(Alignment.BottomCenter)) { LegalSaveEditsBar(editor, ::saveEdits) }
                }
            }
        }
    }
    ConfirmDialog(confirm) { confirm = null }
}

/** One control: the current status, tinted as its chip, opens the status menu; a void document shows the chip alone. */
@Composable
private fun StatusControl(doc: LgDocument, onPick: (String) -> Unit) {
    if (doc.status == "VOID") { LgStatusChip(doc.status); return }
    var open by remember { mutableStateOf(false) }
    val tone = lgStatusTone(doc.status)
    Box {
        Row(Modifier.clip(CircleShape).background(tone.bg).clickable { open = true }.defaultMinSize(minHeight = 34.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(lgStatus(doc.status), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = tone.fg)
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Filled.UnfoldMore, stringResource(R.string.lg_status), tint = tone.fg, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(open, { open = false }) {
            LegalLogic.statusChoices(doc.status, doc.source).forEach { s ->
                DropdownMenuItem(text = { Text(lgStatus(s)) }, onClick = { open = false; if (s != doc.status) onPick(s) },
                    leadingIcon = { if (s == doc.status) Icon(Icons.Filled.CheckCircle, null) })
            }
        }
    }
}

/** Who uploaded the signed copy and when, what became of a void number, an addendum's parent and the addenda (web DocumentFacts). */
@Composable
private fun DocumentFacts(doc: LgDocument, open: (String) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        doc.signedAt?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Draw, null, tint = c.success, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.lg_signed_copy_by, lgDate(it), doc.signedBy?.name ?: "—"), fontSize = 13.sp, color = c.success)
            }
        }
        if (doc.status == "VOID") {
            val by = doc.numberReusedBy
            if (by != null) RefRow(stringResource(R.string.lg_void_reused_by), by, open)
            else Text(stringResource(when {
                doc.numberReleased -> R.string.lg_void_free
                doc.signedAt != null -> R.string.lg_void_signed_retired
                else -> R.string.lg_status_void
            }), fontSize = 13.sp, color = c.mutedFg)
        }
        doc.numberReusedFrom.forEach { RefRow(stringResource(R.string.lg_reused_from), it, open) }
        doc.parent?.let { RefRow(stringResource(R.string.lg_addendum_n_to, doc.addendumNo ?: 0), it, open) }
        if (doc.addenda.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.AccountTree, null, tint = c.foreground, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.lg_addenda), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            }
            LgListCard(doc.addenda) { a ->
                Row(Modifier.fillMaxWidth().clickable { open(a.id) }.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(a.number, fontSize = 12.sp, fontFamily = LgMono, color = c.foreground, maxLines = 1,
                            textDecoration = if (a.numberReleased) TextDecoration.LineThrough else null)
                        Text("${a.title} · ${lgDay(a.docDate)}", fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    LgStatusChip(a.status ?: "DRAFT")
                }
            }
        }
    }
}

@Composable
private fun RefRow(text: String, ref: LgDocRef, open: (String) -> Unit) {
    val c = Nx.colors
    Row(Modifier.clickable { open(ref.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("$text ", fontSize = 13.sp, color = c.mutedFg)
        Text(ref.number.ifEmpty { ref.title }, fontSize = 13.sp, fontFamily = LgMono, color = c.violetText, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ── Overview ──

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DocumentOverview(model: LgDocModel, doc: LgDocument, onUploadVersion: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var title by remember(doc.updatedAt) { mutableStateOf(doc.title) }
    var counterparty by remember(doc.updatedAt) { mutableStateOf(doc.counterparty) }
    var notes by remember(doc.updatedAt) { mutableStateOf(doc.notes) }
    var saving by remember { mutableStateOf(false) }
    var restoring by remember { mutableStateOf<Int?>(null) }
    val dirty = title != doc.title || counterparty != doc.counterparty || notes != doc.notes
    val frozen = LegalLogic.isFrozen(doc)

    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        LegalLogic.shownVersion(doc)?.let { shown ->
            FileButtons(model, doc, shown)
            if (shown.hasPdf) PdfPreview(doc, shown)
        }
        LgCard {
            LgFormRow(stringResource(R.string.lg_title_label)) { LgTextField(title, { title = it }) }
            LgFormRow(stringResource(R.string.lg_counterparty)) { LgTextField(counterparty, { counterparty = it }) }
            LgFormRow(stringResource(R.string.lg_notes)) { LgTextField(notes, { notes = it }, singleLine = false, minLines = 2) }
            NxButton(stringResource(R.string.save), {
                saving = true
                scope.launch { model.patch(lgBody("title" to title.trim(), "counterparty" to counterparty, "notes" to notes)); saving = false }
            }, kind = NxButtonKind.PRIMARY, enabled = dirty && title.isNotBlank() && !saving)
            LgFormRow(stringResource(R.string.lg_belongs_to)) {
                // A link the viewer can't open comes back as null project / deal with linkHidden: say so rather than "not linked".
                LgLinkButton(LgLink.of(doc.project, doc.deal), { v ->
                    scope.launch {
                        model.patch(when (v) {
                            is LgLink.Deal -> lgBody("dealId" to v.id, "projectId" to null)
                            is LgLink.Project -> lgBody("projectId" to v.id, "dealId" to null)
                            null -> lgBody("projectId" to null, "dealId" to null)
                        })
                    }
                }, placeholder = if (doc.linkHidden) stringResource(R.string.lg_link_hidden) else null)
            }
        }
        LgSectionHeader(stringResource(R.string.lg_versions)) {
            if (LegalLogic.isLocked(doc)) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.lg_signed_locked), fontSize = 12.sp, color = c.mutedFg)
            } else if (doc.status != "VOID") NxButton(stringResource(R.string.lg_upload_new_version), onUploadVersion, icon = Icons.Filled.FileUpload, compact = true)
        }
        LgListCard(doc.versions) { v ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(v.label.ifBlank { "REV ${v.version}" }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.width(64.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(lgVersionKind(v.kind) + if (v.note.isEmpty()) "" else " — ${v.note}", fontSize = 14.sp, color = c.foreground, maxLines = 2,
                                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                            if (doc.signedVersion == v.version) LgChip(stringResource(R.string.lg_signed_copy), lgTone("success"))
                            if (doc.finalVersion == v.version) LgChip(stringResource(R.string.lg_status_final), lgTone("accent"))
                        }
                        Text(listOf(v.shownLabel, v.author?.name ?: "—", lgDate(v.createdAt), lgBytes(v.size)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FileButtons(model, doc, v)
                    if (doc.finalVersion != v.version && !frozen) NxButton(stringResource(R.string.lg_mark_final), {
                        scope.launch { model.patch(if (doc.status == "DRAFT") lgBody("finalVersion" to v.version, "status" to "FINAL") else lgBody("finalVersion" to v.version)) }
                    }, kind = NxButtonKind.GHOST, icon = Icons.Filled.CheckCircle, compact = true)
                    if (v.version != doc.currentVersion && !frozen) NxButton(stringResource(R.string.lg_restore), {
                        restoring = v.version
                        scope.launch {
                            try {
                                val res = api.restore(doc.id, v.version, doc.currentVersion)
                                LegalToasts.success(ctx.getString(R.string.lg_restored_as, res.version))
                                model.load()
                            } catch (e: ApiError) { model.versionRefused(e) }
                            restoring = null
                        }
                    }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Restore, compact = true, enabled = restoring == null)
                }
            }
        }
    }
}

/** DOCX / PDF / the original file of one version (downloaded under its own name → share sheet), or "Make PDF". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FileButtons(model: LgDocModel, doc: LgDocument, v: LgVersion) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var making by remember { mutableStateOf(false) }
    fun fetch(format: String) {
        busy = format
        scope.launch {
            try { LegalFiles.share(ctx, api.downloadVersion(doc.id, v.version, format, LegalLogic.shareName(v, format))) }
            catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            busy = null
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        if (v.hasDocx) NxButton("DOCX", { fetch("docx") }, icon = Icons.Filled.FileDownload, compact = true, enabled = busy == null)
        when {
            v.hasPdf -> NxButton("PDF", { fetch("pdf") }, icon = Icons.Filled.PictureAsPdf, compact = true, enabled = busy == null)
            // The server is making it in the background; the document screen polls until it lands.
            LegalLogic.versionsAwaitingPdf(doc).any { it.version == v.version } -> Row(verticalAlignment = Alignment.CenterVertically) {
                LgSmallSpinner(); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.lg_making_pdf), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
            }
            v.hasDocx && !LegalLogic.isLocked(doc) -> NxButton(stringResource(R.string.lg_make_pdf), {
                making = true
                scope.launch {
                    try { api.makePdf(doc.id, v.version); LegalToasts.success(ctx.getString(R.string.lg_pdf_made)); model.load() }
                    catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                    making = false
                }
            }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Refresh, compact = true, enabled = !making)
        }
        if (v.hasFile) NxButton(stringResource(R.string.lg_file), { fetch("original") }, icon = Icons.Filled.Attachment, compact = true, enabled = busy == null)
        if (busy != null || making) LgSmallSpinner()
    }
}

/** The shown version's PDF drawn in place (the web's iframe), with a full-screen viewer. */
@Composable
private fun PdfPreview(doc: LgDocument, v: LgVersion) {
    val api = rememberLegalApi()
    val c = Nx.colors
    var file by remember(doc.id, v.version, v.hasPdf) { mutableStateOf<File?>(null) }
    var failed by remember(doc.id, v.version, v.hasPdf) { mutableStateOf(false) }
    var full by remember { mutableStateOf(false) }
    LaunchedEffect(doc.id, v.version, v.hasPdf) {
        try { file = api.downloadVersion(doc.id, v.version, "pdf", LegalLogic.shareName(v, "pdf"), inline = true) } catch (e: Exception) { failed = true }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(460.dp).clip(RoundedCornerShape(12.dp)).background(c.muted).border(1.dp, c.border, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center) {
            val f = file
            when {
                failed -> Text(stringResource(R.string.lg_cant_open_file), fontSize = 13.sp, color = c.mutedFg)
                f == null -> CircularProgressIndicator()
                else -> PdfPages(f) { failed = true }
            }
        }
        NxButton(stringResource(R.string.lg_full_screen), { full = true }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Fullscreen, compact = true)
    }
    if (full) PdfViewerDialog("/api/legal/documents/${android.net.Uri.encode(doc.id)}/versions/${v.version}/file?format=pdf&inline=1",
        LegalLogic.shareName(v, "pdf") ?: "document-v${v.version}.pdf") { full = false }
}
