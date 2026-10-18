package id.znetworks.nexus.feature.legal

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

// Templates (owner, 14 Oct 2026; web LegalTemplates, iOS LegalTemplatesView): a .docx with {{PLACEHOLDERS}} uploaded
// here; the server finds the fields, and each upload of the same template is a new version. Documents keep the
// version they were made from.

@Composable
fun LegalTemplatesPane(nav: LegalNav) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    var archived by rememberSaveable { mutableStateOf(false) }
    var templates by remember { mutableStateOf<List<LgTemplate>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(archived, tick) {
        loading = true
        try { templates = api.templates(archived); error = null }
        catch (e: ApiError) { if (templates == null) error = legalMessage(ctx, e) else LegalToasts.failure(ctx, e) }
        loading = false
    }
    OnResume { tick++ }
    PullToRefreshBox(loading && templates != null, { tick++ }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                LgSectionHeader(stringResource(R.string.lg_tab_templates), stringResource(R.string.lg_templates_sub)) {
                    NxButton(stringResource(R.string.lg_upload_template), nav.newTemplate, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.FileUpload, compact = true)
                }
            }
            item { LgToggle(stringResource(R.string.lg_show_archived), archived, { archived = it }, Modifier.widthIn(max = 320.dp)) }
            val l = templates
            when {
                l == null && error == null -> item { LgLoadingRow() }
                l == null -> item { EmptyState(Icons.Filled.Description, stringResource(R.string.lg_templates_failed), error!!, stringResource(R.string.try_again), { tick++ }) }
                l.isEmpty() -> item {
                    EmptyState(Icons.Filled.Description, stringResource(R.string.lg_no_templates_title), stringResource(R.string.lg_no_templates_upload),
                        stringResource(R.string.lg_upload_template), nav.newTemplate)
                }
                else -> item {
                    LgListCard(l) { tpl ->
                        Row(Modifier.fillMaxWidth().clickable { nav.openTemplate(tpl.id) }.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Description, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(tpl.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false))
                                    if (tpl.archived) LgChip(stringResource(R.string.lg_archived), lgTone("neutral"))
                                }
                                Text(listOf(lgDocType(tpl.docType), tpl.company?.name ?: stringResource(R.string.lg_any_company), "REV ${tpl.currentVersion}",
                                    pluralStringResource(R.plurals.lg_fields_n, tpl.fields.size, tpl.fields.size)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1,
                                    overflow = TextOverflow.Ellipsis)
                            }
                            Text(lgDate(tpl.updatedAt), fontSize = 12.sp, color = c.mutedFg)
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                        }
                    }
                }
            }
            item { LegalPlaceholderHelp() }
        }
    }
}

/** The company a template is for ("Any company") and its numbering series, filtered by company and type. */
@Composable
private fun CompanySeriesPickers(companies: List<LgCompany>, docType: String?, companyId: String?, seriesId: String?, onCompany: (String?) -> Unit, onSeries: (String?) -> Unit) {
    val company = companies.firstOrNull { it.id == companyId }
    val series = company?.series.orEmpty().filter { it.active && (docType == null || it.docType == docType) }
    LgFormRow(stringResource(R.string.lg_company)) {
        LgMenuPicker(companies.filter { it.active }.map { it.id to it.name }, companyId, { onCompany(it); onSeries(null) }, noneLabel = stringResource(R.string.lg_any_company))
    }
    LgFormRow(stringResource(R.string.lg_numbering)) {
        LgMenuPicker(series.map { it.id to "${it.label} — ${it.format}" }, seriesId, onSeries, noneLabel = stringResource(R.string.lg_company_series), enabled = company != null)
    }
}

// ── Upload template ──

@Composable
fun LegalUploadTemplateScreen(onBack: () -> Unit, onCreated: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var file by remember { mutableStateOf<LgPicked?>(null) }
    var name by remember { mutableStateOf("") }
    var docType by remember { mutableStateOf<String?>(null) }
    var companyId by remember { mutableStateOf<String?>(null) }
    var seriesId by remember { mutableStateOf<String?>(null) }
    var description by remember { mutableStateOf("") }
    var problems by remember { mutableStateOf<List<String>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { companies = api.companies() } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(api::describe)?.let { f ->
            file = f; problems = emptyList()
            if (name.isEmpty()) name = f.name.substringBeforeLast('.').replace('_', ' ')
        }
    }
    fun upload() {
        val f = file ?: return
        val t = docType ?: return
        sending = true; error = null
        scope.launch {
            try {
                val tpl = api.createTemplate(f, name.trim(), t, companyId, seriesId, description.trim())
                LegalToasts.success(ctx.resources.getQuantityString(R.plurals.lg_template_uploaded, tpl?.fields?.size ?: 0, tpl?.fields?.size ?: 0))
                tpl?.let { onCreated(it.id) } ?: onBack()
            } catch (e: ApiError) {
                problems = e.legalProblems()
                if (problems.isEmpty()) error = legalMessage(ctx, e)
            }
            sending = false
        }
    }
    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(R.string.lg_upload_template), onBack = onBack)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp).widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.lg_upload_template_body), fontSize = 13.sp, color = c.mutedFg)
                LgFormRow(stringResource(R.string.lg_word_file)) { LgPickFileField(file) { pick.launch(LegalApi.DOCX_TYPES) } }
                LgFormRow(stringResource(R.string.lg_name)) { LgTextField(name, { name = it }) }
                LgFormRow(stringResource(R.string.lg_document_type)) {
                    LgMenuPicker(lgDocTypeOptions(), docType, { docType = it; seriesId = null }, placeholder = stringResource(R.string.lg_pick_type))
                }
                CompanySeriesPickers(companies, docType, companyId, seriesId, { companyId = it }, { seriesId = it })
                LgFormRow(stringResource(R.string.lg_description_optional)) { LgTextField(description, { description = it }, singleLine = false, minLines = 2) }
                LgProblemList(problems, stringResource(R.string.lg_fix_in_word))
                error?.let { Text(it, fontSize = 13.sp, color = c.danger) }
                Box(Modifier.fillMaxWidth()) {
                    NxButton(stringResource(R.string.lg_upload), ::upload, kind = NxButtonKind.PRIMARY,
                        enabled = file != null && name.isNotBlank() && docType != null && !sending, modifier = Modifier.fillMaxWidth())
                    if (sending) CircularProgressIndicator(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(18.dp), strokeWidth = 2.dp)
                }
                Spacer(Modifier.height(60.dp))
            }
        }
    }
}

// ── Template detail ──

/** What the detail edits before Save. */
private data class TplDraft(val name: String, val description: String, val docType: String?, val companyId: String?, val seriesId: String?, val fields: List<LgField>) {
    constructor(t: LgTemplate) : this(t.name, t.description, t.docType, t.company?.id, t.series?.id, t.fields)
}

@Composable
fun LegalTemplateScreen(templateId: String, onBack: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var template by remember { mutableStateOf<LgTemplate?>(null) }
    var draft by remember { mutableStateOf<TplDraft?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var archiving by remember { mutableStateOf(false) }
    var versionFile by remember { mutableStateOf<LgPicked?>(null) }
    var versionNote by remember { mutableStateOf("") }
    var versionProblems by remember { mutableStateOf<List<String>>(emptyList()) }
    var addingVersion by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf<Int?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    fun apply(t: LgTemplate?) { if (t != null) { template = t; draft = TplDraft(t) } }
    LaunchedEffect(tick) {
        try { apply(api.template(templateId)); error = null } catch (e: ApiError) { if (template == null) error = e else LegalToasts.failure(ctx, e) }
        runCatching { companies = api.companies() }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(api::describe)?.let { versionFile = it; versionProblems = emptyList() }
    }
    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(template?.name ?: stringResource(R.string.lg_template), onBack = onBack)
            val t = template
            val d = draft
            when {
                t == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                t == null || d == null -> LgLoadError(error!!, stringResource(R.string.lg_template_open_failed), { tick++ }, onBack, Modifier.fillMaxSize())
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Text("${lgDocType(t.docType)} · REV ${t.currentVersion}" + if (t.archived) " · ${stringResource(R.string.lg_archived)}" else "", fontSize = 13.sp, color = c.mutedFg)
                    LgCard {
                        LgFormRow(stringResource(R.string.lg_name)) { LgTextField(d.name, { draft = d.copy(name = it) }) }
                        LgFormRow(stringResource(R.string.lg_document_type)) { LgMenuPicker(lgDocTypeOptions(), d.docType, { draft = d.copy(docType = it, seriesId = null) }) }
                        CompanySeriesPickers(companies, d.docType, d.companyId, d.seriesId, { v -> draft = draft?.copy(companyId = v) }, { v -> draft = draft?.copy(seriesId = v) })
                        LgFormRow(stringResource(R.string.lg_description_optional)) { LgTextField(d.description, { draft = d.copy(description = it) }, singleLine = false, minLines = 2) }
                    }
                    LgSectionHeader(stringResource(R.string.lg_form_fields), stringResource(R.string.lg_form_fields_sub))
                    FieldEditorList(d.fields, emptyList()) { path, change -> draft = draft?.let { it.copy(fields = LegalLogic.updateField(it.fields, path, change)) } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        NxButton(stringResource(R.string.save), {
                            saving = true
                            scope.launch {
                                try {
                                    apply(api.updateTemplate(t.id, lgBody("name" to d.name.trim(), "description" to d.description, "docType" to (d.docType ?: t.docType),
                                        "companyId" to d.companyId, "seriesId" to d.seriesId, "fields" to api.fieldsJson(d.fields))))
                                    LegalToasts.success(ctx.getString(R.string.lg_saved))
                                } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                saving = false
                            }
                        }, kind = NxButtonKind.PRIMARY, enabled = TplDraft(t) != d && d.name.isNotBlank() && !saving)
                        NxButton(stringResource(if (t.archived) R.string.lg_restore else R.string.lg_archive), {
                            archiving = true
                            scope.launch {
                                try {
                                    val u = api.updateTemplate(t.id, lgBody("archived" to !t.archived))
                                    apply(u)
                                    LegalToasts.success(ctx.getString(if (u?.archived == true) R.string.lg_template_archived else R.string.lg_template_restored))
                                } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                archiving = false
                            }
                        }, icon = if (t.archived) Icons.Filled.Unarchive else Icons.Filled.Archive, enabled = !archiving)
                    }
                    LgSectionHeader(stringResource(R.string.lg_versions))
                    LgListCard(t.versions) { v ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("REV ${v.version}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.width(64.dp))
                            Column(Modifier.weight(1f)) {
                                Text(v.fileName, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text((listOf(lgBytes(v.size), pluralStringResource(R.plurals.lg_fields_n, v.fieldCount, v.fieldCount), v.createdBy?.name ?: "—", lgDate(v.createdAt))
                                    + listOfNotNull(v.note.ifEmpty { null })).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 2)
                            }
                            IconButton(onClick = {
                                downloading = v.version
                                scope.launch {
                                    try { LegalFiles.share(ctx, api.downloadTemplate(t.id, v.version, v.fileName)) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                    downloading = null
                                }
                            }, enabled = downloading == null) {
                                if (downloading == v.version) LgSmallSpinner() else Icon(Icons.Filled.FileDownload, stringResource(R.string.lg_download), tint = c.mutedFg)
                            }
                        }
                    }
                    Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(R.string.lg_upload_new_version), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        LgPickFileField(versionFile) { pick.launch(LegalApi.DOCX_TYPES) }
                        LgTextField(versionNote, { versionNote = it }, placeholder = stringResource(R.string.lg_what_changed))
                        LgProblemList(versionProblems, stringResource(R.string.lg_fix_in_word))
                        NxButton(stringResource(R.string.lg_upload), {
                            val f = versionFile ?: return@NxButton
                            addingVersion = true
                            scope.launch {
                                try {
                                    val u = api.addTemplateVersion(t.id, f, versionNote.trim())
                                    apply(u); versionFile = null; versionNote = ""; versionProblems = emptyList()
                                    LegalToasts.success(ctx.getString(R.string.lg_version_uploaded, u?.currentVersion ?: 0))
                                } catch (e: ApiError) {
                                    versionProblems = e.legalProblems()
                                    if (versionProblems.isEmpty()) LegalToasts.failure(ctx, e)
                                }
                                addingVersion = false
                            }
                        }, icon = Icons.Filled.FileUpload, compact = true, enabled = versionFile != null && !addingVersion)
                    }
                    LegalPlaceholderHelp()
                    Spacer(Modifier.height(60.dp))
                }
            }
        }
    }
}

/**
 * The template's fields: label, type (a scalar field, among text/longtext/date/number/money/select), required, the
 * choices of a select and the columns of a table field. The document date's type and required flag are fixed.
 */
@Composable
private fun FieldEditorList(fields: List<LgField>, path: List<Int>, onChange: (List<Int>, (LgField) -> LgField) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        fields.forEachIndexed { i, f ->
            val p = path + i
            val locked = f.name == LegalLogic.DOCUMENT_DATE
            val scalar = f.type != "list" && f.type != "boolean"
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("{{${f.name}}}", fontSize = 11.sp, fontFamily = LgMono, color = c.mutedFg)
                LgTextField(f.label, { v -> onChange(p) { it.copy(label = v) } }, placeholder = stringResource(R.string.lg_label))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) {
                        if (scalar && !locked) LgMenuPicker(LegalLogic.SCALAR_TYPES.map { it to lgFieldType(it) }, f.type, { v -> if (v != null) onChange(p) { it.copy(type = v) } })
                        else Text(lgFieldType(f.type), fontSize = 14.sp, color = c.mutedFg, modifier = Modifier.padding(vertical = 12.dp))
                    }
                    Text(stringResource(R.string.lg_required), fontSize = 14.sp, color = c.foreground)
                    Switch(f.required, { v -> onChange(p) { it.copy(required = v) } }, enabled = !locked, colors = SwitchDefaults.colors(checkedTrackColor = c.violet))
                }
                if (f.type == "select") LgTextField(f.options.orEmpty().joinToString(", "), { v -> onChange(p) { it.copy(options = LegalLogic.choices(v)) } },
                    placeholder = stringResource(R.string.lg_choices))
                f.columns?.let { cols ->
                    Column(Modifier.padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.lg_columns_of_row), fontSize = 12.sp, color = c.mutedFg)
                        Box(Modifier.padding(start = 10.dp)) { FieldEditorList(cols, p, onChange) }
                    }
                }
            }
        }
    }
}

/** "How to write placeholders": the web's table, row for row. */
@Composable
fun LegalPlaceholderHelp() {
    var open by rememberSaveable { mutableStateOf(false) }
    val rows = listOf(
        "{{NAMA_PIHAK_KEDUA}}" to stringResource(R.string.lg_ph_value),
        "{{TANGGAL_TTD | hari}}" to "Rabu",
        "{{TANGGAL_TTD | tanggal}}" to "30 September 2026",
        "{{TANGGAL_TTD | tgl}} {{TANGGAL_TTD | bulan}}" to "30 September",
        "{{TANGGAL_TTD | tahun_terbilang}}" to "Dua Ribu Dua Puluh Enam",
        "{{HONOR | rupiah}}" to "Rp 25.000.000",
        "{{HONOR | terbilang_rupiah | upper}}" to "DUA PULUH LIMA JUTA RUPIAH",
        "{{#BARANG}} … {{NAMA_BARANG}} … {{/BARANG}}" to stringResource(R.string.lg_ph_rows),
        "{{#PAKAI_MATERAI}} … {{/PAKAI_MATERAI}}" to stringResource(R.string.lg_ph_ticked),
        "{{NOMOR}}" to stringResource(R.string.lg_ph_number),
        "{{TANGGAL_DOKUMEN}}" to stringResource(R.string.lg_ph_date),
        "{{PT_PERUSAHAAN}} {{ALAMAT_PERUSAHAAN}}" to stringResource(R.string.lg_ph_company),
    )
    LgHelpCard(stringResource(R.string.lg_ph_title), rows, open) { open = !open }
}

/** A titled code → meaning table in a card; [open] null = always open. */
@Composable
fun LgHelpCard(title: String, rows: List<Pair<String, String>>, open: Boolean?, onToggle: () -> Unit = {}) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
        Row(Modifier.fillMaxWidth().then(if (open != null) Modifier.clickable(onClick = onToggle) else Modifier).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, modifier = Modifier.weight(1f))
            if (open != null) Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = c.mutedFg)
        }
        AnimatedVisibility(open != false) {
            Column {
                rows.forEach { (code, meaning) ->
                    HorizontalDivider(color = c.border)
                    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(code, fontSize = 12.sp, fontFamily = LgMono, color = c.foreground)
                        Text(meaning, fontSize = 13.sp, color = c.mutedFg)
                    }
                }
            }
        }
    }
}
