package id.znetworks.nexus.feature.legal

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * New document (owner, 14 Oct 2026; web NewDocumentDialog, iOS LegalNewDocumentSheet): pick a template (and the
 * company, when the template is for any company) → the form made from its {{PLACEHOLDERS}} → the number is taken only
 * when it is generated. [parentId]: Create addendum on that signed document (addendum templates only; company, kop and
 * number follow the parent; the form starts from its parties). [requestId]: Create document from a Legal request (its
 * template and company are picked, the form starts with what the requester filled, the document is linked to it).
 */
@Composable
fun LegalNewDocumentScreen(parentId: String?, requestId: String?, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var templates by remember { mutableStateOf<List<LgTemplate>?>(null) }
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var listError by remember { mutableStateOf<Throwable?>(null) }
    var templateId by remember { mutableStateOf<String?>(null) }
    var companyId by remember { mutableStateOf<String?>(null) }
    var parent by remember { mutableStateOf(parentId) }
    var fromRequest by remember { mutableStateOf<Map<String, LgValue>>(emptyMap()) }
    var parentNumber by remember { mutableStateOf<String?>(null) }
    var formStep by remember { mutableStateOf(false) }

    var prepared by remember { mutableStateOf<LgPrepared?>(null) }
    var prepareError by remember { mutableStateOf<String?>(null) }
    val values = remember { mutableStateMapOf<String, LgValue>() }
    var title by remember { mutableStateOf("") }
    var counterparty by remember { mutableStateOf("") }
    var link by remember { mutableStateOf<LgLink?>(null) }
    var preview by remember { mutableStateOf<String?>(null) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var problems by remember { mutableStateOf<List<String>>(emptyList()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var generating by remember { mutableStateOf(false) }
    var loadTick by remember { mutableStateOf(0) }

    val template = templates?.firstOrNull { it.id == templateId }
    val effectiveCompany = template?.company?.id ?: companyId
    val canContinue = template != null && (parent != null || effectiveCompany != null)
    val offered = templates?.let { LegalLogic.offeredTemplates(it, parent != null) }

    // Reads the state afresh: it is also called from the loading effect, before this composition's vals caught up.
    fun startForm() {
        val tid = templateId ?: return
        val tpl = templates?.firstOrNull { it.id == tid } ?: return
        val company = tpl.company?.id ?: companyId
        if (parent == null && company == null) return
        formStep = true
        prepared = null; prepareError = null; preview = null
        values.clear(); errors = emptyMap(); problems = emptyList(); formError = null
        scope.launch {
            try {
                val p = api.prepare(tid, company, parentDocumentId = parent)
                prepared = p
                preview = p.numberPreview
                values.putAll(LegalLogic.startValues(fromRequest, LgValue.values(p.prefill), LegalLogic.todayJakarta()))
            } catch (e: ApiError) { prepareError = legalMessage(ctx, e) }
        }
    }

    LaunchedEffect(loadTick) {
        listError = null
        try { templates = api.templates() } catch (e: ApiError) { listError = e; return@LaunchedEffect }
        runCatching { companies = api.companies() }
        try {
            // From a request: its template, company, values and link; an addendum request also its parent.
            if (requestId != null) {
                val d = api.boardRequest(requestId)
                val r = d.request
                val pre = d.prefill
                fromRequest = LgValue.values(pre?.values?.takeIf { it.isNotEmpty() } ?: r?.fieldValues ?: kotlinx.serialization.json.JsonObject(emptyMap()))
                if (r?.isAddendum == true) parent = pre?.parentDocumentId ?: r.parent?.id
                link = when {
                    pre?.dealId != null -> r?.deal?.let { LgLink.Deal(it.id, "${it.code} · ${it.name}") }
                    pre?.projectId != null -> r?.project?.let { LgLink.Project(it.id, it.name) }
                    else -> null
                }
                val tid = pre?.templateId ?: r?.templateId
                val tpl = templates?.firstOrNull { it.id == tid && !it.archived }
                companyId = tpl?.company?.id ?: pre?.companyId?.ifEmpty { null } ?: r?.company?.id
                // An archived template stays on Pick.
                if (tpl != null) { templateId = tpl.id; startForm() }
            } else if (parent != null) {
                LegalLogic.offeredTemplates(templates.orEmpty(), true).singleOrNull()?.let { templateId = it.id }
            }
        } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
        // The pick step names the signed document an addendum amends.
        parent?.let { id -> runCatching { parentNumber = api.document(id).number } }
    }

    // The number preview is asked again (debounced) when the document date or a field the series format reads changes.
    val inputs = LegalLogic.numberInputs(values.toMap(), prepared?.series?.format)
    val numberKey = LegalLogic.numberKey(inputs)
    LaunchedEffect(numberKey, formStep) {
        val tid = templateId
        if (!formStep || prepared == null || tid == null) return@LaunchedEffect
        delay(400)
        runCatching { api.prepare(tid, effectiveCompany, inputs, parent) }.getOrNull()?.let { preview = it.numberPreview }
    }

    fun generate() {
        val tid = templateId ?: return
        if (generating) return
        generating = true; formError = null
        scope.launch {
            try {
                val res = api.generate(tid, effectiveCompany, values.toMap(), title.trim(), counterparty.trim(), link?.projectId, link?.dealId, parent, requestId)
                LegalToasts.success(ctx.getString(R.string.lg_doc_made, res.number))
                LegalToasts.pdfWarning(ctx, res.pdfError)
                onCreated(res.id)
            } catch (e: ApiError) {
                errors = e.legalFieldErrors()
                problems = e.legalProblems()
                if (errors.isEmpty() && problems.isEmpty()) { formError = legalMessage(ctx, e); LegalToasts.failure(formError!!) }
                else LegalToasts.failure(ctx.getString(R.string.lg_fields_need_attention))
            }
            generating = false
        }
    }

    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(if (parent != null) R.string.lg_create_addendum else R.string.lg_new_document),
                onBack = { if (formStep && requestId == null) { formStep = false; errors = emptyMap(); problems = emptyList(); formError = null } else onBack() })
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp).widthIn(max = 720.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (!formStep) {
                    Text(parentNumber?.let { stringResource(R.string.lg_addendum_pick, it) }
                        ?: if (parent != null) stringResource(R.string.lg_addendum_pick_plain) else stringResource(R.string.lg_pick_template_company),
                        fontSize = 13.sp, color = c.mutedFg)
                    val offeredNow = offered
                    when {
                        listError != null -> LgLoadError(listError!!, stringResource(R.string.lg_templates_failed), { loadTick++ }, onBack)
                        offeredNow == null -> LgLoadingRow()
                        offeredNow.isEmpty() -> EmptyState(Icons.Filled.Description,
                            stringResource(if (parent != null) R.string.lg_no_addendum_template else R.string.lg_no_templates),
                            stringResource(if (parent != null) R.string.lg_no_addendum_template_body else R.string.lg_no_templates_body),
                            stringResource(R.string.back), onBack)
                        else -> {
                            LgListCard(offeredNow) { tpl ->
                                val on = templateId == tpl.id
                                Row(Modifier.fillMaxWidth().background(if (on) c.accentBg else c.card).clickable { templateId = tpl.id; companyId = tpl.company?.id }
                                    .padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.Description, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(tpl.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text("${lgDocType(tpl.docType)} · ${tpl.company?.name ?: stringResource(R.string.lg_any_company)}", fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
                                    }
                                    if (on) Icon(Icons.Filled.CheckCircle, null, tint = c.violetText)
                                }
                            }
                            if (template != null && template.company == null && parent == null) {
                                LgFormRow(stringResource(R.string.lg_issuing_company)) {
                                    LgMenuPicker(companies.filter { it.active }.map { it.id to it.name }, companyId, { companyId = it }, placeholder = stringResource(R.string.lg_pick_company))
                                }
                            }
                            NxButton(stringResource(R.string.lg_continue), ::startForm, kind = NxButtonKind.PRIMARY, enabled = canContinue, modifier = Modifier.fillMaxWidth())
                        }
                    }
                } else {
                    val p = prepared
                    Text("${template?.name.orEmpty()} · ${p?.company?.name.orEmpty()}", fontSize = 13.sp, color = c.mutedFg)
                    when {
                        prepareError != null -> EmptyState(Icons.Filled.Warning, stringResource(R.string.lg_form_failed), prepareError!!, stringResource(R.string.try_again), ::startForm)
                        p == null -> LgLoadingRow()
                        else -> {
                            NumberCard(p, preview)
                            if (p.company?.hasKop == false) Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Warning, null, tint = c.warningFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.lg_no_kop_warning), fontSize = 12.sp, color = c.warningFg)
                            }
                            LgCard {
                                LgFormRow(stringResource(R.string.lg_title_in_archive)) { LgTextField(title, { title = it }, placeholder = template?.name) }
                                LgFormRow(stringResource(R.string.lg_counterparty)) { LgTextField(counterparty, { counterparty = it }, placeholder = stringResource(R.string.lg_counterparty_hint)) }
                                LgFormRow(stringResource(R.string.lg_belongs_to)) { LgLinkButton(link, { link = it }) }
                            }
                            if (p.fields.isNotEmpty()) LgCard {
                                p.fields.forEach { f ->
                                    LgFieldInput(f, values[f.name], errors, f.name) { v ->
                                        if (v == null) values.remove(f.name) else values[f.name] = v
                                        errors = errors - f.name
                                    }
                                }
                            }
                            LgProblemList(problems + LegalLogic.extraErrors(errors, p.fields).map { "${it.first}: ${it.second}" })
                            formError?.let { Text(it, fontSize = 13.sp, color = c.danger) }
                            NxButton(stringResource(if (generating) R.string.lg_generating else R.string.lg_generate), ::generate, kind = NxButtonKind.PRIMARY,
                                enabled = !generating, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
                Spacer(Modifier.size(60.dp))
            }
        }
    }
}

/** The number the document would take now; it is taken only when it is generated. */
@Composable
private fun NumberCard(p: LgPrepared, preview: String?) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.muted.copy(alpha = 0.6f)).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Tag, null, tint = c.mutedFg, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(preview ?: p.numberPreview, fontSize = 15.sp, fontWeight = FontWeight.Medium, fontFamily = LgMono, color = c.foreground)
            Text(p.parent?.let { stringResource(R.string.lg_addendum_number_hint, it.addendumNo, it.number) }
                ?: stringResource(R.string.lg_next_number_hint, p.series?.label.orEmpty()), fontSize = 12.sp, color = c.mutedFg)
        }
    }
}

/** One form field of a template, by its type. [errors] is keyed like the server's ("ROWS.0.CELL"). */
@Composable
fun LgFieldInput(field: LgField, value: LgValue?, errors: Map<String, String>, path: String, hideName: Boolean = false, onChange: (LgValue?) -> Unit) {
    val c = Nx.colors
    val error = errors[path]
    val str = value?.string.orEmpty()
    when (field.type) {
        "boolean" -> Column {
            LgToggle(field.shownLabel, value == LgValue.Bool(true), { onChange(LgValue.Bool(it)) }, Modifier.fillMaxWidth())
            if (error != null) Text(error, fontSize = 12.sp, color = c.danger)
        }
        "list" -> {
            val rows = value?.rowList.orEmpty()
            val cols = field.columns.orEmpty()
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(field.shownLabel, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    if (field.required) Text(" *", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.danger)
                    if (!hideName) Text("  ${field.name}", fontSize = 10.sp, fontFamily = LgMono, color = c.mutedFg)
                }
                rows.forEachIndexed { i, row ->
                    Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.lg_row_n, i + 1), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, modifier = Modifier.weight(1f))
                            IconButton(onClick = { onChange(LgValue.Rows(rows.filterIndexed { k, _ -> k != i })) }) {
                                Icon(Icons.Filled.Delete, stringResource(R.string.lg_remove_row), tint = c.mutedFg, modifier = Modifier.size(18.dp))
                            }
                        }
                        cols.forEach { col ->
                            LgFieldInput(col, row[col.name], errors, "$path.$i.${col.name}", hideName) { v ->
                                val next = rows.toMutableList()
                                if (i in next.indices) {
                                    next[i] = if (v == null) next[i] - col.name else next[i] + (col.name to v)
                                    onChange(LgValue.Rows(next))
                                }
                            }
                        }
                    }
                }
                NxButton(stringResource(R.string.lg_add_row), { onChange(LgValue.Rows(rows + listOf(emptyMap()))) }, icon = Icons.Filled.Add, compact = true)
                if (error != null) Text(error, fontSize = 12.sp, color = c.danger)
                else if (!field.help.isNullOrEmpty()) Text(field.help, fontSize = 12.sp, color = c.mutedFg)
            }
        }
        else -> LgFormRow(field.shownLabel, field.required, if (hideName) null else field.name, field.help, error) {
            when (field.type) {
                "longtext" -> LgTextField(str, { onChange(LgValue.Text(it)) }, singleLine = false, minLines = 3, invalid = error != null)
                "date" -> LgDayField(str.ifEmpty { null }, { onChange(it?.let(LgValue::Text)) }, clearable = field.name != LegalLogic.DOCUMENT_DATE, invalid = error != null)
                // "Rp" before, thousands grouped with "." while typing; the digits are what is sent.
                "money" -> LgTextField(LegalLogic.moneyShown(str), { onChange(LgValue.Text(LegalLogic.ungroup(LegalLogic.groupDigits(it)))) },
                    keyboardType = KeyboardType.Decimal, prefix = "Rp ", invalid = error != null)
                "number" -> LgTextField(str, { onChange(LgValue.Text(LegalLogic.numberChars(it))) }, keyboardType = KeyboardType.Number, invalid = error != null)
                "select" -> LgMenuPicker(field.options.orEmpty().map { it to it }, str.ifEmpty { null }, { onChange(it?.let(LgValue::Text)) },
                    placeholder = stringResource(R.string.lg_pick_one), invalid = error != null)
                else -> LgTextField(str, { onChange(LgValue.Text(it)) }, invalid = error != null)
            }
        }
    }
}

// ── Upload document ──

/** Put a document made elsewhere into the archive (web UploadDocumentDialog): a signed contract, an outside invoice, a scan. */
@Composable
fun LegalUploadDocumentScreen(onBack: () -> Unit, onCreated: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var file by remember { mutableStateOf<LgPicked?>(null) }
    var companyId by remember { mutableStateOf<String?>(null) }
    var docType by remember { mutableStateOf<String?>(null) }
    var title by remember { mutableStateOf("") }
    var number by remember { mutableStateOf("") }
    var counterparty by remember { mutableStateOf("") }
    var docDate by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>("SIGNED") }
    var link by remember { mutableStateOf<LgLink?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { companies = api.companies() } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(api::describe)?.let { f ->
            file = f
            if (title.isEmpty()) title = f.name.substringBeforeLast('.')
        }
    }
    val canUpload = file != null && companyId != null && docType != null && title.isNotBlank() && !uploading

    fun upload() {
        val f = file ?: return
        uploading = true; error = null
        scope.launch {
            try {
                val res = api.uploadDocument(f, buildMap {
                    put("companyId", companyId!!); put("docType", docType!!); put("title", title.trim()); put("number", number.trim())
                    put("counterparty", counterparty.trim()); put("status", status ?: "SIGNED")
                    docDate?.let { put("docDate", it) }; link?.projectId?.let { put("projectId", it) }; link?.dealId?.let { put("dealId", it) }
                })
                LegalToasts.success(ctx.getString(R.string.lg_added_to_archive))
                LegalToasts.pdfWarning(ctx, res.pdfError)
                onCreated(res.id)
            } catch (e: ApiError) { error = legalMessage(ctx, e) }
            uploading = false
        }
    }

    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(R.string.lg_upload_document), onBack = onBack)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp).widthIn(max = 640.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.lg_upload_document_body), fontSize = 13.sp, color = c.mutedFg)
                LgFormRow(stringResource(R.string.lg_file_any)) { LgPickFileField(file) { pick.launch(LegalApi.DOCUMENT_TYPES) } }
                LgFormRow(stringResource(R.string.lg_company)) { LgMenuPicker(companies.map { it.id to it.name }, companyId, { companyId = it }, placeholder = stringResource(R.string.lg_pick_company)) }
                LgFormRow(stringResource(R.string.lg_document_type)) { LgMenuPicker(lgDocTypeOptions(), docType, { docType = it }, placeholder = stringResource(R.string.lg_pick_type)) }
                LgFormRow(stringResource(R.string.lg_title_label)) { LgTextField(title, { title = it }) }
                LgFormRow(stringResource(R.string.lg_number_on_document)) { LgTextField(number, { number = it.uppercase() }, mono = true) }
                LgFormRow(stringResource(R.string.lg_counterparty)) { LgTextField(counterparty, { counterparty = it }) }
                LgFormRow(stringResource(R.string.lg_date)) { LgDayField(docDate, { docDate = it }) }
                LgFormRow(stringResource(R.string.lg_status)) { LgMenuPicker(lgStatusOptions(), status, { status = it }) }
                LgFormRow(stringResource(R.string.lg_belongs_to)) { LgLinkButton(link, { link = it }) }
                error?.let { Text(it, fontSize = 13.sp, color = c.danger) }
                Box(Modifier.fillMaxWidth()) {
                    NxButton(stringResource(R.string.lg_upload), ::upload, kind = NxButtonKind.PRIMARY, enabled = canUpload, modifier = Modifier.fillMaxWidth())
                    if (uploading) CircularProgressIndicator(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(18.dp), strokeWidth = 2.dp)
                }
                Spacer(Modifier.size(60.dp))
            }
        }
    }
}
